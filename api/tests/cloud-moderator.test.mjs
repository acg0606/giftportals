import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'../..');
async function loadURL(path,replacements={}){let code=ts.transpileModule(await readFile(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;for(const[from,to]of Object.entries(replacements))code=code.replaceAll(`'${from}'`,JSON.stringify(to));return'data:text/javascript;base64,'+Buffer.from(code).toString('base64');}
const rules=await loadURL('api/_lib/rules.ts'),providers=await loadURL('api/_lib/providers.ts',{'./rules.js':rules});
const http=await loadURL('api/_lib/cloud-instant-provider-http.ts',{'./rules.js':rules,'./providers.js':providers});
const supabase='data:text/javascript;base64,'+Buffer.from('export function createClient(){throw Error("DATABASE_DISABLED_IN_TESTS")}').toString('base64');
const adapterReplacements={'./rules.js':rules,'./providers.js':providers,'./cloud-instant-provider-http.js':http,'@supabase/supabase-js':supabase};
const {createRemoteCloudModerator,cloudDatabaseFailureMetadata}=await import(await loadURL('api/_lib/cloud-instant-adapters.ts',adapterReplacements));
test('database failure diagnostics preserve only intrinsic stage, SQLSTATE and HTTP status',()=>{
  assert.deepEqual(cloudDatabaseFailureMetadata({code:'23514',message:'private-row-content',status:400},'gp_instant_prepare'),{event:'cloud_rpc_error',operation:'gp_instant_prepare',sqlstate:'23514',httpStatus:400,failureClass:'unknown'});
  assert.deepEqual(cloudDatabaseFailureMetadata({code:'PGRST202',message:'private-query',statusCode:'404'},'storage-sign-upload'),{event:'cloud_operation_error',operation:'storage-sign-upload',sqlstate:'PGRST202',httpStatus:404,failureClass:'function-resolution'});
  const safe=cloudDatabaseFailureMetadata({code:'secret-token-in-code',message:'https://private.example/?token=secret',status:NaN},'https://private.example/?token=secret');
  assert.deepEqual(safe,{event:'cloud_operation_error',operation:'database',sqlstate:null,httpStatus:null,failureClass:'unknown'});
  assert.equal(JSON.stringify(safe).includes('secret'),false);
  assert.equal(cloudDatabaseFailureMetadata({message:'fetch failed'},'gp_instant_prepare',0).httpStatus,0);
});
test('repository logs sanitized RPC errors from fake Supabase without exposing diagnostics to the caller',async t=>{
  const prior={url:process.env.SUPABASE_URL,role:process.env.SUPABASE_SERVICE_ROLE_KEY,error:console.error};
  t.after(()=>{prior.url===undefined?delete process.env.SUPABASE_URL:process.env.SUPABASE_URL=prior.url;prior.role===undefined?delete process.env.SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY=prior.role;console.error=prior.error;});
  process.env.SUPABASE_URL='https://synthetic.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service-role-only-for-unit-test';
  for(const [code,message,status,failureClass] of [['PGRST202','private function hint',404,'function-resolution'],['','TypeError: fetch failed; private-url-token',0,'fetch-failed'],['','AbortError: signal is aborted; private-payload',0,'connection-timeout'],['42703','private column details',400,'schema']]){
    const result={data:null,error:{code,message,details:'private-row',hint:'private-query'},status};
    const fake='data:text/javascript;base64,'+Buffer.from('export function createClient(){return {rpc:async()=>('+JSON.stringify(result)+')}}').toString('base64');
    const {createCloudInstantRepository}=await import(await loadURL('api/_lib/cloud-instant-adapters.ts',{...adapterReplacements,'@supabase/supabase-js':fake}));
    const logs=[];console.error=value=>logs.push(JSON.parse(value));
    await assert.rejects(()=>createCloudInstantRepository().prepare({id:'synthetic',tokenHash:'a',ownerHash:'b',requestKeyHash:'c',inputHash:'d',document:{},storageBytes:0}),error=>error.code==='DATABASE_REQUEST_FAILED'&&error.status===409);
    assert.deepEqual(logs,[{event:'cloud_rpc_error',operation:'gp_instant_prepare',sqlstate:code||null,httpStatus:status,failureClass}]);
    assert.equal(JSON.stringify(logs).includes('private'),false);
  }
});
const host='https://oqmzwznadfuxybtstzzz.supabase.co',url=host+'/storage/v1/object/sign/gp-instant-private/00000000-0000-4000-8000-000000000000/input/original-'+ 'a'.repeat(64)+'.png?token=synthetic-signed-token';
const bytes=Buffer.alloc(6*1024*1024,1),image={id:'original',mime:'image/png',bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
function setup(t){const keys=['GIFTPORTALS_CLOUD_MODERATION_URL','GIFTPORTALS_CLOUD_MODERATION_KEY','SUPABASE_URL'],prior=Object.fromEntries(keys.map(key=>[key,process.env[key]])),priorFetch=globalThis.fetch;t.after(()=>{for(const key of keys){prior[key]===undefined?delete process.env[key]:process.env[key]=prior[key];}globalThis.fetch=priorFetch;});process.env.GIFTPORTALS_CLOUD_MODERATION_URL='https://gift.example/api/cloud-vision';process.env.GIFTPORTALS_CLOUD_MODERATION_KEY='synthetic-unit-test-moderation-secret-32';process.env.SUPABASE_URL=host;}
test('moderation sends only a short private signed URL declaration even for a6MiB image',async t=>{setup(t);let request;globalThis.fetch=async(endpoint,init)=>{request={endpoint:String(endpoint),...init};return new Response(JSON.stringify({protocol:'giftportals-cloud-vision-v1',modelVersion:'giftportals-local-vision-v1:clip-text-q8+clip-vision-fp32+vit-nsfw-q8:policy-3',decision:'allow',results:[]}));};const moderator=createRemoteCloudModerator(Date.now()+165000,{signModerationRead:async supplied=>{assert.equal(supplied,image);return url;}});await moderator.screen([image]);assert.equal(request.endpoint,'https://gift.example/api/cloud-vision');assert.equal(request.redirect,'error');assert.ok(Buffer.byteLength(request.body)<1024);assert.deepEqual(JSON.parse(request.body),{protocol:'giftportals-cloud-vision-v1',images:[{id:image.id,sha256:image.sha256,mime:image.mime,bytes:bytes.length,imageUrl:url}]});assert.ok(!request.body.includes('imageDataUrl'));});
test('moderation cannot send arbitrary, public, credentialed or crossproject URLs',async t=>{setup(t);let requests=0;globalThis.fetch=async()=>{requests++;throw Error('NO_NETWORK_EXPECTED');};for(const denied of['http://oqmzwznadfuxybtstzzz.supabase.co/a',url.replace(host,'https://other.supabase.co'),url.replace('/sign/','/public/'),url.replace('https://','https://user:pass@'),url.split('?')[0]]){const moderator=createRemoteCloudModerator(Date.now()+165000,{signModerationRead:async()=>denied});await assert.rejects(()=>moderator.screen([image]),{code:'PHOTO_SAFETY_UNAVAILABLE'});}assert.equal(requests,0);});
test('unconfigured moderation or a duplicate image role fails closed before outbound calls',async t=>{setup(t);let calls=0;const repository={signModerationRead:async()=>{calls++;return url;}};assert.equal(createRemoteCloudModerator(Date.now()+165000).configured,false);process.env.GIFTPORTALS_CLOUD_MODERATION_KEY='short';const closed=createRemoteCloudModerator(Date.now()+165000,repository);assert.equal(closed.configured,false);await assert.rejects(()=>closed.screen([image]),{code:'PHOTO_SAFETY_UNAVAILABLE'});process.env.GIFTPORTALS_CLOUD_MODERATION_KEY='synthetic-unit-test-moderation-secret-32';await assert.rejects(()=>createRemoteCloudModerator(Date.now()+165000,repository).screen([image,image]),{code:'IMAGE_CONTENT_INVALID'});assert.equal(calls,0);});
