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
function fixture(t,info){
  const previous={fetch:globalThis.fetch,key:process.env.WORLD_LABS_API_KEY},calls=[];
  process.env.WORLD_LABS_API_KEY='synthetic-worldlabs-key';
  t.after(()=>{globalThis.fetch=previous.fetch;previous.key===undefined?delete process.env.WORLD_LABS_API_KEY:process.env.WORLD_LABS_API_KEY=previous.key;});
  globalThis.fetch=async(url,init)=>{
    calls.push({url:String(url),init});
    if(calls.length===1)return new Response(JSON.stringify({media_asset:{media_asset_id:'synthetic-media-id'},upload_info:{upload_method:'PUT',upload_url:uploadUrl,...info}}));
    assert.equal(init.method,'PUT');return new Response(null,{status:200});
  };
  return {calls,upload:()=>createCloudProviderAdapter(Date.now()+165000).upload('worldlabs',png,'image/png')};
}

test('World Labs accepts absent, null, empty or required headers and uploads exact bytes without starting generation',async t=>{
  for(const [label,info,expected]of[
    ['absent',{},{}],['null',{required_headers:null},{}],['empty',{required_headers:{}},{}],
    ['required',{required_headers:{'Content-Type':'image/png','x-goog-content-length-range':'0,1048576000'}},{'Content-Type':'image/png','x-goog-content-length-range':'0,1048576000'}],
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
