import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const root=resolve(import.meta.dirname,'../..');
async function loadURL(path,replacements={}){
  let code=ts.transpileModule(await readFile(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const[from,to]of Object.entries(replacements))code=code.replaceAll(`'${from}'`,JSON.stringify(to));
  return'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
const rules=await loadURL('api/_lib/rules.ts'),providers=await loadURL('api/_lib/providers.ts',{'./rules.js':rules});
const http=await loadURL('api/_lib/cloud-instant-provider-http.ts',{'./rules.js':rules,'./providers.js':providers});
const databaseStub='data:text/javascript;base64,'+Buffer.from('export function createClient(){throw Error("Uploads must not access the database")}').toString('base64');
const {createCloudProviderAdapter}=await import(await loadURL('api/_lib/cloud-instant-adapters.ts',{'./rules.js':rules,'./providers.js':providers,'./cloud-instant-provider-http.js':http,'@supabase/supabase-js':databaseStub}));
const png=Buffer.from([137,80,78,71,13,10,26,10,1]),uploadUrl='https://storage.googleapis.com/synthetic-upload/place.png';
function fixture(t,info,bytes=png,mime='image/png'){
  const previous={fetch:globalThis.fetch,key:process.env.WORLD_LABS_API_KEY},calls=[];
  process.env.WORLD_LABS_API_KEY='synthetic-worldlabs-key';
  t.after(()=>{globalThis.fetch=previous.fetch;previous.key===undefined?delete process.env.WORLD_LABS_API_KEY:process.env.WORLD_LABS_API_KEY=previous.key;});
  globalThis.fetch=async(url,init)=>{
    calls.push({url:String(url),init});
    if(calls.length===1)return new Response(JSON.stringify({media_asset:{media_asset_id:'synthetic-media-id'},upload_info:{upload_method:'PUT',upload_url:uploadUrl,...info}}));
    assert.equal(init.method,'PUT');return new Response(null,{status:200});
  };
  return {calls,upload:()=>createCloudProviderAdapter(Date.now()+165000).upload('worldlabs',bytes,mime)};
}

test('World Labs accepts absent, null, empty or required headers and uploads exact bytes without starting generation',async t=>{
  for(const [label,info,expected]of[
    ['absent',{}, {'Content-Type':'image/png'}],['null',{required_headers:null},{'Content-Type':'image/png'}],['empty',{required_headers:{}},{'Content-Type':'image/png'}],
    ['required',{required_headers:{'Content-Type':'image/png','x-goog-content-length-range':'0,1048576000'}},{'Content-Type':'image/png','x-goog-content-length-range':'0,1048576000'}],
    ['lowercase',{required_headers:{'content-type':'application/octet-stream','x-goog-meta-test':'fixture'}},{'content-type':'application/octet-stream','x-goog-meta-test':'fixture'}],
    ['mixed-case',{required_headers:{'cOnTeNt-TyPe':'image/png'}},{'cOnTeNt-TyPe':'image/png'}],
    ['other-signed-header',{required_headers:{'x-goog-content-length-range':'0,1048576000'}},{'x-goog-content-length-range':'0,1048576000','Content-Type':'image/png'}],
  ])await t.test(label,async s=>{
    const f=fixture(s,info);assert.equal(await f.upload(),'synthetic-media-id');assert.equal(f.calls.length,2);
    const [prepare,put]=f.calls;
    assert.equal(prepare.url,'https://api.worldlabs.ai/marble/v1/media-assets:prepare_upload');assert.equal(prepare.init.method,'POST');
    assert.deepEqual(JSON.parse(prepare.init.body),{file_name:'place.png',kind:'image',extension:'png'});
    assert.equal(prepare.init.headers['WLT-Api-Key'],'synthetic-worldlabs-key');
    assert.equal(put.url,uploadUrl);assert.equal(put.init.method,'PUT');assert.equal(put.init.redirect,'error');
    assert.deepEqual(Buffer.from(put.init.body),png);assert.deepEqual(put.init.headers,expected);
    assert.ok(put.init.signal instanceof AbortSignal);assert.equal(put.init.headers['WLT-Api-Key'],undefined);
    assert.ok(f.calls.every(({url})=>!url.includes('/worlds:generate')&&!url.includes('/generation/')));
  });
});

test('World Labs MIME fallback uses the verified JPEG MIME and leaves signed content types exact',async t=>{
  const jpeg=Buffer.from([255,216,255,224,0,1]);
  for(const headers of [undefined,null,{}])await t.test(String(headers),async s=>{
    const f=fixture(s,{required_headers:headers},jpeg,'image/jpeg');assert.equal(await f.upload(),'synthetic-media-id');
    assert.equal(f.calls[1].init.headers['Content-Type'],'image/jpeg');assert.deepEqual(Buffer.from(f.calls[1].init.body),jpeg);
    assert.deepEqual(JSON.parse(f.calls[0].init.body),{file_name:'place.jpg',kind:'image',extension:'jpg'});
  });
});

test('World Labs submit respects its persisted recipe and explicit world retry overrides without uploading or regenerating Tripo',async t=>{
  const savedFetch=globalThis.fetch,savedKey=process.env.WORLD_LABS_API_KEY,calls=[];
  process.env.WORLD_LABS_API_KEY='synthetic-worldlabs-key';t.after(()=>{globalThis.fetch=savedFetch;savedKey===undefined?delete process.env.WORLD_LABS_API_KEY:process.env.WORLD_LABS_API_KEY=savedKey;});
  globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return new Response(JSON.stringify({operation_id:'synthetic-world-operation'}));};
  const adapter=createCloudProviderAdapter(Date.now()+165000),job=recipe=>({document:{title:'Synthetic scene',generation:{worldlabs:recipe}}});
  await adapter.submit('worldlabs',job({textPrompt:'A clear test courtyard.'}),'synthetic-media');
  assert.deepEqual(calls.at(-1).body,{display_name:'Synthetic scene',model:'marble-1.1',permission:{public:false},world_prompt:{type:'image',text_prompt:'A clear test courtyard.',is_pano:false,disable_recaption:true,image_prompt:{source:'media_asset',media_asset_id:'synthetic-media'}}});
  const stored=job({model:'marble-1.0',textPrompt:'A clear test courtyard.',isPano:'auto',disableRecaption:false});
  await adapter.submit('worldlabs',stored,'synthetic-media');assert.equal(calls.at(-1).body.model,'marble-1.0');assert.equal(calls.at(-1).body.world_prompt.is_pano,'auto');assert.equal(calls.at(-1).body.world_prompt.disable_recaption,false);
  stored.document.worldRetry={recipeOverride:{isPano:false,disableRecaption:true}};
  await adapter.submit('worldlabs',stored,'synthetic-media');assert.equal(calls.at(-1).body.model,'marble-1.0');assert.equal(calls.at(-1).body.world_prompt.is_pano,false);assert.equal(calls.at(-1).body.world_prompt.disable_recaption,true);
  assert.equal(stored.document.generation.worldlabs.disableRecaption,false,'The immutable original recipe is preserved');
  await adapter.submit('worldlabs',stored,'');assert.deepEqual(calls.at(-1).body.world_prompt,{type:'text',text_prompt:'A clear test courtyard.'});
  const original=job({model:'marble-1.1',textPrompt:'A clear test courtyard.',isPano:false,disableRecaption:true});original.document.worldRetry={recipeOverride:{model:'marble-1.0'}};
  await adapter.submit('worldlabs',original,'synthetic-media');assert.equal(calls.at(-1).body.model,'marble-1.0');assert.equal(original.document.generation.worldlabs.model,'marble-1.1');assert.equal(calls.at(-1).body.world_prompt.disable_recaption,true);
  const plus=job({model:'marble-1.1-plus',textPrompt:'A clear test courtyard.',isPano:false,disableRecaption:true});
  await adapter.submit('worldlabs',plus,'synthetic-media');assert.equal(calls.at(-1).body.model,'marble-1.1-plus');assert.equal(calls.at(-1).body.permission.public,false);
  assert.equal(calls.length,6);assert.ok(calls.every(({url})=>url==='https://api.worldlabs.ai/marble/v1/worlds:generate'));
  for(const recipe of [{model:'untrusted-model',textPrompt:'Test scene'},{textPrompt:'Test scene',disableRecaption:'false'},{textPrompt:'Test scene',isPano:1},{textPrompt:''},{textPrompt:'x'.repeat(16001)}])await assert.rejects(adapter.submit('worldlabs',job(recipe),'synthetic-media'),{code:'INSTANT_INPUT_INVALID'});
  assert.equal(calls.length,6,'Invalid persisted recipes cannot issue paid requests');
});

test('world retry repository forwards both owner and gift capabilities to the dedicated RPCs',async t=>{
  const saved={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,calls:globalThis.__giftWorldRetryRPCCalls};
  process.env.SUPABASE_URL='https://synthetic.supabase.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service-role';globalThis.__giftWorldRetryRPCCalls=[];
  t.after(()=>{for(const [name,value]of[['SUPABASE_URL',saved.url],['SUPABASE_SERVICE_ROLE_KEY',saved.key]])value===undefined?delete process.env[name]:process.env[name]=value;saved.calls===undefined?delete globalThis.__giftWorldRetryRPCCalls:globalThis.__giftWorldRetryRPCCalls=saved.calls;});
  const retryDatabase='data:text/javascript;base64,'+Buffer.from(`export function createClient(){return {rpc:async(name,args)=>{globalThis.__giftWorldRetryRPCCalls.push({name,args});return {data:name==='gp_instant_world_retry_owner'?true:{id:args.p_id},error:null}}}}`).toString('base64');
  const {createCloudInstantRepository}=await import(await loadURL('api/_lib/cloud-instant-adapters.ts',{'./rules.js':rules,'./providers.js':providers,'./cloud-instant-provider-http.js':http,'@supabase/supabase-js':retryDatabase}));
  const repo=createCloudInstantRepository(Date.now()+165000),override={disableRecaption:false},diagnostics={done:true,errorPresent:true,errorShape:'object',errorEmpty:false,errorCode:500,reason:'provider-internal',reasonText:'The provider message indicates an internal provider failure.',taskId:'synthetic-failed-world-operation'};
  assert.deepEqual(await repo.retryWorld('synthetic-job','gift-hash','owner-hash','request-hash',override,diagnostics),{id:'synthetic-job'});
  assert.deepEqual(await repo.retryWorld('synthetic-job','gift-hash','owner-hash','request-hash',override),{id:'synthetic-job'});
  assert.equal(await repo.worldRetryOwner('synthetic-job','gift-hash','owner-hash'),true);
  assert.deepEqual(globalThis.__giftWorldRetryRPCCalls,[
    {name:'gp_instant_retry_world',args:{p_id:'synthetic-job',p_token_hash:'gift-hash',p_owner_hash:'owner-hash',p_request_key_hash:'request-hash',p_recipe_override:override,p_previous_diagnostics:diagnostics}},
    {name:'gp_instant_retry_world',args:{p_id:'synthetic-job',p_token_hash:'gift-hash',p_owner_hash:'owner-hash',p_request_key_hash:'request-hash',p_recipe_override:override,p_previous_diagnostics:null}},
    {name:'gp_instant_world_retry_owner',args:{p_id:'synthetic-job',p_token_hash:'gift-hash',p_owner_hash:'owner-hash'}},
  ]);
});

test('a rejected world retry retains its definitive database domain and status instead of a generic network failure',async t=>{
  const saved={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};
  process.env.SUPABASE_URL='https://synthetic.supabase.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service-role';
  t.after(()=>{for(const [name,value]of[['SUPABASE_URL',saved.url],['SUPABASE_SERVICE_ROLE_KEY',saved.key]])value===undefined?delete process.env[name]:process.env[name]=value;});
  const deniedDatabase='data:text/javascript;base64,'+Buffer.from(`export function createClient(){return {rpc:async()=>({data:null,error:{message:'WORLD_RETRY_UNAVAILABLE',code:'P0001'},status:400})}}`).toString('base64');
  const {createCloudInstantRepository}=await import(await loadURL('api/_lib/cloud-instant-adapters.ts',{'./rules.js':rules,'./providers.js':providers,'./cloud-instant-provider-http.js':http,'@supabase/supabase-js':deniedDatabase}));
  await assert.rejects(createCloudInstantRepository().retryWorld('synthetic-job','gift-hash','owner-hash','request-hash',{}),error=>error.code==='WORLD_RETRY_UNAVAILABLE'&&error.status===409);
});

test('World Labs rejects malformed or credential-bearing headers before any PUT',async t=>{
  for(const headers of [[],['x'],true,7,'Content-Type:image/png',{'Content-Type':null},{'Content-Type':8},{Authorization:'secret'}, {authorization:'secret'}, {Cookie:'secret'}, {'Set-Cookie':'secret'}, {'WLT-Api-Key':'secret'}, {'x-api-key':'secret'}])await t.test(JSON.stringify(headers),async s=>{
    const f=fixture(s,{required_headers:headers});await assert.rejects(f.upload(),{code:'PROVIDER_RESPONSE_INVALID'});
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.method,'POST');assert.ok(f.calls[0].url.endsWith('/media-assets:prepare_upload'));
  });
});

test('World Labs rejects foreign or unsafe upload origins and non-PUT instructions before sending bytes',async t=>{
  for(const url of ['http://storage.googleapis.com/place.png','https://worldlabs.ai.evil.example/place.png','https://googleapis.com.evil.example/place.png','https://user:pass@storage.googleapis.com/place.png','https://storage.googleapis.com:444/place.png','https://127.0.0.1/place.png'])await t.test(url,async s=>{
    const f=fixture(s,{upload_url:url,required_headers:null});await assert.rejects(f.upload(),{code:'PROVIDER_ASSET_ORIGIN_DENIED'});assert.equal(f.calls.length,1);
  });
  for(const method of ['POST','GET','put'])await t.test(method,async s=>{
    const f=fixture(s,{upload_method:method,required_headers:null});await assert.rejects(f.upload(),{code:'PROVIDER_RESPONSE_INVALID'});assert.equal(f.calls.length,1);
  });
});
