import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'../..');
async function moduleURL(path,replacements={}) {
  let code=ts.transpileModule(await readFile(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const[from,to]of Object.entries(replacements))code=code.replaceAll(`'${from}'`,JSON.stringify(to));
  return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
const sourceURL=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const rules=await moduleURL('api/_lib/rules.ts');
const client=sourceURL('export const createClient=()=>globalThis.__offlineGalleryStorageClient;');
const gallery=sourceURL("export const PUBLIC_GALLERY_BUCKET='gp-instant-gallery';export const PUBLIC_GALLERY_MEDIA_SECONDS=3600;");
const clock=sourceURL('export const cloudRemaining=()=>30000;');
const {createInstantGalleryRepository}=await import(await moduleURL('api/_lib/instant-gallery-adapters.ts',{
  './rules.js':rules,'@supabase/supabase-js':client,'./instant-gallery.js':gallery,'./cloud-instant-provider-http.js':clock,
}));
const id='00000000-0000-4000-8000-000000000010',bytes=Buffer.from('offline archived world'),hash=createHash('sha256').update(bytes).digest('hex');
const source={id:'generated-world',path:`${id}/generated/${hash}.spz`,mime:'application/octet-stream',bytes:bytes.length,sha256:hash};
const archive={...source,id:'world',path:`${id}/landscape/world-${hash}.spz`};
function fixture(t,options={}) {
  const saved={client:globalThis.__offlineGalleryStorageClient,url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY},calls=[];
  t.after(()=>{globalThis.__offlineGalleryStorageClient=saved.client;for(const[name,value]of[['SUPABASE_URL',saved.url],['SUPABASE_SERVICE_ROLE_KEY',saved.key]])if(value===undefined)delete process.env[name];else process.env[name]=value;});
  process.env.SUPABASE_URL='https://offline.example';process.env.SUPABASE_SERVICE_ROLE_KEY='offline-test-only-key';
  globalThis.__offlineGalleryStorageClient={
    rpc:async(name,values)=>{calls.push(['rpc',name,values]);return{data:name==='gp_gallery_claim'?null:true,error:null};},
    storage:{getBucket:async(name)=>{calls.push(['bucket',name]);return{data:{id:name,public:options.public===true},error:null};},
      from:name=>({
        copy:async(path,destination,opts)=>{calls.push(['copy',name,path,destination,opts]);return options.copyError?{error:options.copyError,data:null}:{data:{path:destination},error:null};},
        download:async(path)=>{calls.push(['download',name,path]);return{data:new Blob([options.bytes||bytes]),error:null};},
        createSignedUrl:async(path,seconds)=>{calls.push(['sign',name,path,seconds]);return{data:{signedUrl:'https://offline.example/public-archive-only?token=media-access'},error:null};},
      }),
    },
  };
  return{calls,repository:createInstantGalleryRepository()};
}
test('archive copies use only the generated source bucket and the new independent private bucket; bytes are verified before completion',async t=>{
  const f=fixture(t);await f.repository.copy(source,archive);
  assert.deepEqual(f.calls,[['bucket','gp-instant-gallery'],['copy','gp-instant-generated',source.path,archive.path,{destinationBucket:'gp-instant-gallery'}],['download','gp-instant-gallery',archive.path]]);
  assert.equal(f.calls.some(call=>JSON.stringify(call).includes('gp-instant-private')),false);
});
test('archive storage refuses a public bucket before copy or signing',async t=>{
  const f=fixture(t,{public:true});await assert.rejects(f.repository.copy(source,archive),error=>error.code==='PUBLIC_GALLERY_UNAVAILABLE');
  await assert.rejects(f.repository.sign(archive),error=>error.code==='PUBLIC_GALLERY_UNAVAILABLE');
  assert.equal(f.calls.some(([kind])=>['copy','download','sign'].includes(kind)),false);
});
test('a lost copy response can reconcile exact existing bytes; an existing wrong digest never becomes publishable',async t=>{
  const f=fixture(t,{copyError:{statusCode:'409',message:'already exists'}});await f.repository.copy(source,archive);
  const bad=fixture(t,{copyError:{statusCode:'409',message:'already exists'},bytes:Buffer.alloc(bytes.length)});
  await assert.rejects(bad.repository.copy(source,archive),error=>error.code==='PUBLIC_GALLERY_ASSET_INVALID');
  assert.equal(bad.calls.some(([kind])=>kind==='rpc'),false);
});
test('ordinary storage failure never falls back to an original private URL or public bucket',async t=>{
  const f=fixture(t,{copyError:{statusCode:'503',message:'offline failure'}});await assert.rejects(f.repository.copy(source,archive),error=>error.code==='PUBLIC_GALLERY_UNAVAILABLE');
  assert.equal(f.calls.some(([kind])=>['download','sign','rpc'].includes(kind)),false);
});
test('archive signing always uses private archive membership media and a one-hour lifetime',async t=>{
  const f=fixture(t);assert.match(await f.repository.sign(archive),/public-archive-only/);
  assert.deepEqual(f.calls,[['bucket','gp-instant-gallery'],['sign','gp-instant-gallery',archive.path,3600]]);
});
test('publication RPCs transmit only source identity, revision, independent manifest and lease; no token or private document',async t=>{
  const f=fixture(t),lease='00000000-0000-4000-8000-000000000099';assert.equal(await f.repository.claim(id,lease),null);
  await f.repository.commit({id,revision:4,document:{story:'private story',senderName:'private person'}},lease,{world:archive});await f.repository.release(id,lease);
  assert.deepEqual(f.calls,[['rpc','gp_gallery_claim',{p_id:id,p_lease_id:lease}],['rpc','gp_gallery_commit',{p_id:id,p_lease_id:lease,p_revision:4,p_assets:{world:archive}}],['rpc','gp_gallery_release',{p_id:id,p_lease_id:lease}]]);
  assert.doesNotMatch(JSON.stringify(f.calls),/private story|private person|token|document/);
});
