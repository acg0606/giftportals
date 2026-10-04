import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createTSLoader,here } from './cloud-instant-test-loader.mjs';
const stub=`export const cloudInstantConfigured=()=>false;export const createCloudInstantRepository=()=>({});export const createCloudProviderAdapter=()=>({});export const createRemoteCloudModerator=()=>({configured:false});`;
const load=createTSLoader(new Map([[resolve(here,'_lib/cloud-instant-adapters.ts'),stub]]));
const {createCloudInstantHandler,cloudInstantRequestFailureMetadata}=await load(resolve(here,'instant-cloud.ts'));
const {AppError}=await load(resolve(here,'_lib/rules.ts'));
const {createCloudTickHandler}=await load(resolve(here,'instant-cloud-tick.ts'));
const {createCloudProviderHTTP,cloudRemaining,cloudProviderFailureMetadata}=await load(resolve(here,'_lib/cloud-instant-provider-http.ts'));
process.env.GIFTPORTALS_CLOUD_ORIGIN='https://gift.example';process.env.CLOUD_DEDUPE_SECRET='offline-unit-test-secret-32characters-min';process.env.CRON_SECRET='offline-cron-secret';process.env.TRIPO_API_KEY='offline-provider-key';process.env.WORLD_LABS_API_KEY='offline-world-key';
const response=()=>({headers:{},statusCode:0,setHeader(name,value){this.headers[name]=value;},end(body){this.body=JSON.parse(body);}});
const request=(action,extra={})=>({method:'POST',url:`/api/instant-cloud?action=${action}`,headers:{host:'gift.example',origin:'https://gift.example','sec-fetch-site':'same-origin','content-type':'application/json','x-instant-token':'A'.repeat(43)},body:{id:'00000000-0000-4000-8000-000000000000'},...extra});
function app(){const calls=[];const service=Object.fromEntries(['status','prepare','finalize','get','advance','retryWorld','tick'].map(method=>[method,async(...values)=>{calls.push([method,...values]);return{method};}]));return{calls,handler:createCloudInstantHandler(service),worker:createCloudTickHandler(service)};}
const reject=(promise,code)=>assert.rejects(promise,error=>error.code===code);

test('public GET status and capability GET job cannot call workers, uploads or submissions',async()=>{const f=app();for(const action of['status','job']){const res=response();await f.handler(request(action,{method:'GET',body:undefined}),res);assert.equal(res.statusCode,200);assert.equal(res.body.ok,true);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.headers['Referrer-Policy'],'no-referrer');}assert.deepEqual(f.calls.map(([kind])=>kind),['status','get']);});
test('capability advance is POST only, same origin and forwards exact id and token',async()=>{const f=app(),res=response();await f.handler(request('advance'),res);assert.equal(res.statusCode,200);assert.deepEqual(f.calls[0].slice(0,3),['advance','00000000-0000-4000-8000-000000000000','A'.repeat(43)]);assert.match(f.calls[0][3],/^[a-f0-9]{64}$/);const denied=response();await f.handler(request('advance',{method:'GET'}),denied);assert.equal(denied.statusCode,405);assert.equal(f.calls.length,1);});
test('writes reject crosssite/missing/wrong origins and foreign hosts before service calls',async()=>{for(const headers of[{host:'gift.example','content-type':'application/json'},{host:'gift.example',origin:'https://evil.example','content-type':'application/json'},{host:'evil.example',origin:'https://gift.example','content-type':'application/json'},{host:'gift.example',origin:'https://gift.example','sec-fetch-site':'cross-site','content-type':'application/json'}]){const f=app(),res=response();await f.handler(request('prepare',{headers}),res);assert.equal(res.statusCode,403);assert.equal(res.body.error.code,'ORIGIN_DENIED');assert.equal(f.calls.length,0);}});
test('small declaration body bound rejects oversized JSON, arrays, malformed JSON and binary MIME',async()=>{for(const extra of[{body:{id:'x'.repeat(17000)}},{body:[]},{body:'{'},{headers:{host:'gift.example',origin:'https://gift.example','content-type':'image/png'},body:'data:image/png;base64,AAAA'}]){const f=app(),res=response();await f.handler(request('prepare',extra),res);assert.equal(res.body.ok,false);assert.equal(f.calls.length,0);}const f=app(),res=response();await f.handler(request('prepare',{body:{id:'x'.repeat(17000)}}),res);assert.equal(res.statusCode,413);});
test('no-login prepare assigns a secure signed owner cookie while capabilities remain explicit',async()=>{const f=app(),res=response();await f.handler(request('prepare'),res);assert.equal(res.statusCode,200);assert.match(res.headers['Set-Cookie'],/^__Host-gp_instant_owner=[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict;/);assert.match(f.calls[0][2],/^[a-f0-9]{64}$/);assert.equal(res.body.data.method,'prepare');});
test('public GET status does not read or mint owner identity on either trusted or foreign requests',async()=>{
  const f=app(),cookie='__Host-gp_instant_owner=private-owner.private-signature';
  for(const headers of [{host:'gift.example','sec-fetch-site':'same-origin',cookie},{host:'gift.example',cookie},{host:'foreign.example',cookie},{host:'gift.example',origin:'https://foreign.example',cookie},{host:'gift.example','sec-fetch-site':'cross-site',cookie}]){
    const res=response();await f.handler(request('status',{method:'GET',headers}),res);assert.equal(res.statusCode,200);assert.deepEqual(f.calls.at(-1),['status']);assert.equal(res.headers['Set-Cookie'],undefined);assert.ok(!JSON.stringify(res.body).includes('private'));
  }
  const count=f.calls.length,wrongMethod=response();await f.handler(request('status',{method:'POST'}),wrongMethod);assert.equal(wrongMethod.statusCode,405);assert.equal(f.calls.length,count);assert.equal(wrongMethod.headers['Set-Cookie'],undefined);
});
test('legacy capacity failures never promise a daily reset; request logs contain only fixed metadata',async t=>{
  const saved=console.error,logs=[];console.error=value=>logs.push(JSON.parse(value));t.after(()=>{console.error=saved;});
  const current=Date.parse('2026-10-04T23:59:58.250Z');
  for(const code of ['GENERATION_QUOTA','GENERATION_BUDGET','STORAGE_LIMIT']){
    const service={prepare:async()=>{throw new AppError(code,429,'private database query and owner token');}},res=response();
    await createCloudInstantHandler(service,()=>current)(request('prepare'),res);assert.equal(res.statusCode,429);assert.equal(res.body.error.code,code);assert.match(res.body.error.message,/photo and story remain/);
    assert.equal(res.headers['Retry-After'],undefined);assert.equal(res.body.error.resetAt,undefined);assert.doesNotMatch(res.body.error.message,/daily|today|reset/);
    assert.deepEqual(logs.at(-1),{event:'cloud_instant_request_error',action:'prepare',errorCode:code,httpStatus:429});
    assert.doesNotMatch(JSON.stringify(res.body)+JSON.stringify(logs),/private|query|owner|token|cookie|signature/);
  }
  assert.deepEqual(cloudInstantRequestFailureMetadata('private-url?token=secret','private-query',NaN),{event:'cloud_instant_request_error',action:'unknown',errorCode:'CLOUD_REQUEST_FAILED',httpStatus:500});
  const res=response();await createCloudInstantHandler({prepare:async()=>{throw Error('secret database row');}},()=>current)(request('prepare'),res);assert.equal(res.statusCode,500);assert.equal(res.body.error.code,'CLOUD_REQUEST_FAILED');assert.doesNotMatch(JSON.stringify(res.body)+JSON.stringify(logs),/secret|database row/);
});
test('authenticated cron GET/POST is the only global worker authority and invalid secret never claims',async()=>{for(const method of['GET','POST']){const f=app(),res=response();await f.worker({method,headers:{authorization:'Bearer offline-cron-secret'}},res);assert.equal(res.statusCode,200);assert.equal(f.calls[0][0],'tick');}const f=app(),res=response();await f.worker({method:'GET',headers:{authorization:'Bearer wrong'}},res);assert.equal(res.statusCode,403);assert.equal(f.calls.length,0);assert.equal(res.body.error.code,'TICK_FORBIDDEN');});
test('provider deadline uses remaining invocation time and fails closed before expired requests',async()=>{assert.equal(cloudRemaining(Date.now()+200000,120000,20000),120000);assert.ok(cloudRemaining(Date.now()+30000,120000,20000)<=10000);assert.throws(()=>cloudRemaining(Date.now()-1,15000),error=>error.code==='CLOUD_TIME_SLICE_ENDED');let fetched=false;const savedFetch=globalThis.fetch;globalThis.fetch=async()=>{fetched=true;throw new Error('must not run');};try{await reject(createCloudProviderHTTP(Date.now()+1000).json('tripo','/generation/image-to-model','POST',{}),'CLOUD_TIME_SLICE_ENDED');assert.equal(fetched,false);}finally{globalThis.fetch=savedFetch;}});
test('paid POST lost response is ambiguous while known GET failure remains retryable',async()=>{const savedFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('offline disconnect');};try{const http=createCloudProviderHTTP(Date.now()+165000);await reject(http.json('tripo','/generation/image-to-model','POST',{}),'SUBMISSION_AMBIGUOUS');await reject(http.json('tripo','/tasks/known-id'),'PROVIDER_NETWORK');await reject(http.json('worldlabs','/media-assets:prepare_upload','POST',{}),'PROVIDER_NETWORK');}finally{globalThis.fetch=savedFetch;}});
test('paid rejection logs only enum and numeric metadata while preserving ambiguity and never retrying',async()=>{const savedFetch=globalThis.fetch,savedError=console.error,logs=[];let calls=0;console.error=value=>logs.push(JSON.parse(value));try{globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({code:1001,message:'private input token secret https://storage.invalid/?token=private',details:{prompt:'private story'}}),{status:400,headers:{'x-tripo-trace-id':'00000000-0000-4000-8000-000000000000'}});};await reject(createCloudProviderHTTP(Date.now()+165000).json('tripo','/generation/image-to-image','POST',{input:'private-file-token',prompt:'private story'}),'PROVIDER_REQUEST_REJECTED');assert.equal(calls,1);assert.equal(logs.length,1);assert.deepEqual({...logs[0],durationMs:0},{event:'cloud_provider_submission_error',provider:'tripo',stage:'tripo-reference',httpStatus:400,providerCode:1001,errorCode:'PROVIDER_REQUEST_REJECTED',durationMs:0,traceId:'00000000-0000-4000-8000-000000000000',requestId:null});assert.doesNotMatch(JSON.stringify(logs),/private|storage\.invalid|prompt|input|Authorization/);logs.length=0;globalThis.fetch=async()=>new Response(JSON.stringify({code:'private-token',message:'secret'}),{status:403,headers:{'x-tripo-trace-id':'private-token'}});await reject(createCloudProviderHTTP(Date.now()+165000).json('tripo','/generation/image-to-image','POST',{}),'PROVIDER_REQUEST_REJECTED');assert.equal(logs[0].providerCode,null);assert.equal(logs[0].traceId,null);}finally{globalThis.fetch=savedFetch;console.error=savedError;}});
test('provider responses reject oversized JSON, invalid envelopes and failed known tasks without accepting a fabricated ID',async()=>{const savedFetch=globalThis.fetch;try{for(const body of['x'.repeat(1024*1024+1),'{','[]',JSON.stringify({code:0,data:[]})]){globalThis.fetch=async()=>new Response(body);await assert.rejects(createCloudProviderHTTP(Date.now()+165000).json('tripo','/tasks/known-id'));}await reject(createCloudProviderHTTP(Date.now()+165000).complete('tripo',{status:'failed'}),'PROVIDER_GENERATION_FAILED');}finally{globalThis.fetch=savedFetch;}});
test('generated asset URLs require approved HTTPS hosts before any download',async()=>{const savedFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not run');};try{for(const url of['http://assets.tripo3d.ai/model.glb','https://tripo3d.ai.evil.example/model.glb','https://user:pass@assets.tripo3d.ai/model.glb','https://127.0.0.1/model.glb'])await reject(createCloudProviderHTTP(Date.now()+165000).complete('tripo',{status:'success',output:{model_url:url}}),'PROVIDER_ASSET_ORIGIN_DENIED');assert.equal(calls,0);}finally{globalThis.fetch=savedFetch;}});
test('actual GLB/SPZ headers, decompressed splat limits and numerical semantics are verified',async()=>{const savedFetch=globalThis.fetch;const glb=Buffer.alloc(12);glb.write('glTF');glb.writeUInt32LE(2,4);glb.writeUInt32LE(12,8);const png=Buffer.from([137,80,78,71,13,10,26,10,1]);const decoded=Buffer.alloc(16);decoded.write('NGSP');decoded.writeUInt32LE(500000,8);const spz=gzipSync(decoded);const world={world_id:'world-1',assets:{splats:{spz_urls:{'500k':'https://assets.worldlabs.ai/world.spz'},semantics_metadata:{metric_scale_factor:2.9049978,ground_plane_offset:1.6893421,private:'not exported'}},imagery:{pano_url:'https://assets.worldlabs.ai/pano.png'},mesh:{collider_mesh_url:'https://assets.worldlabs.ai/collider.glb'}}};try{globalThis.fetch=async url=>new Response(String(url).endsWith('.spz')?spz:String(url).endsWith('.png')?png:glb);const complete=await createCloudProviderHTTP(Date.now()+165000).complete('worldlabs',{done:true,response:world});assert.deepEqual(complete.worldSemantics,{metricScaleFactor:2.9049978,groundPlaneOffset:1.6893421});assert.equal(complete.worldQuality,'500k');assert.equal(complete.colliderStatus,'available');assert.deepEqual(complete.assets.map(a=>a.key),['generated-world','panorama','collider']);decoded.writeUInt32LE(600001,8);globalThis.fetch=async()=>new Response(gzipSync(decoded));await reject(createCloudProviderHTTP(Date.now()+165000).complete('worldlabs',{done:true,response:world}),'PROVIDER_ASSET_INVALID');globalThis.fetch=async()=>new Response('not a GLB');await reject(createCloudProviderHTTP(Date.now()+165000).complete('tripo',{status:'success',output:{model_url:'https://assets.tripo3d.ai/model.glb'}}),'PROVIDER_ASSET_INVALID');}finally{globalThis.fetch=savedFetch;}});

test('World Labs accepts the reference and quickstart world envelopes using GET only and the same world identity',async()=>{
  const savedFetch=globalThis.fetch,decoded=Buffer.alloc(16);decoded.write('NGSP');decoded.writeUInt32LE(500000,8);
  const spz=gzipSync(decoded),png=Buffer.from([137,80,78,71,13,10,26,10,1]);
  const assets={splats:{spz_urls:{'500k':'https://assets.worldlabs.ai/world.spz'}},imagery:{pano_url:'https://assets.worldlabs.ai/pano.png'},mesh:{}};
  const worlds=[{world_id:'same-world',assets},{id:'same-world',assets},{world:{id:'same-world',assets}}];
  try{
    for(const world of worlds){
      const calls=[];globalThis.fetch=async(url,init)=>{calls.push([String(url),init?.method||'GET']);return new Response(String(url).endsWith('.spz')?spz:png);};
      const complete=await createCloudProviderHTTP(Date.now()+165000).complete('worldlabs',{done:true,error:null,response:world,cost:{total_credits:1580}});
      assert.equal(complete.resultId,'same-world');assert.equal(complete.cost,1580);assert.equal(complete.colliderStatus,'unavailable');assert.deepEqual(complete.assets.map(asset=>asset.key),['generated-world','panorama']);
      assert.deepEqual(calls.map(([,method])=>method),['GET','GET']);assert.ok(calls.every(([url])=>url.startsWith('https://assets.worldlabs.ai/')));
    }
    for(const world of worlds){
      const calls=[];globalThis.fetch=async(url,init)=>{calls.push([String(url),init?.method||'GET']);return new Response(String(url).includes('/worlds/')?JSON.stringify(world):String(url).endsWith('.spz')?spz:png);};
      const complete=await createCloudProviderHTTP(Date.now()+165000).complete('worldlabs',{done:true,error:null,response:{id:'same-world'}});
      assert.equal(complete.resultId,'same-world');assert.equal(calls[0][0],'https://api.worldlabs.ai/marble/v1/worlds/same-world');assert.deepEqual(calls.map(([,method])=>method),['GET','GET','GET']);
    }
    let downloads=0;globalThis.fetch=async()=>{downloads++;return new Response(JSON.stringify({world:{id:'another-world',assets}}));};
    await reject(createCloudProviderHTTP(Date.now()+165000).complete('worldlabs',{done:true,error:null,response:{world_id:'same-world'}}),'PROVIDER_RESPONSE_INVALID');assert.equal(downloads,1);
    downloads=0;await reject(createCloudProviderHTTP(Date.now()+165000).complete('worldlabs',{done:true,error:null,response:{world_id:'same-world',id:'another-world',assets}}),'PROVIDER_RESPONSE_INVALID');assert.equal(downloads,0);
  }finally{globalThis.fetch=savedFetch;}
});

test('World Labs pending empty placeholders remain pending and terminal errors stop before assets',async()=>{
  const savedFetch=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('No network is needed for an operation error or pending status');};
  try{
    for(const error of [undefined,null,{}])assert.equal(await createCloudProviderHTTP(Date.now()+165000).complete('worldlabs',{done:false,error,metadata:{progress:{status:'IN_PROGRESS'}}}),null);
    for(const error of [{code:13,message:'upstream generation failure'},{},{code:null,message:null}])await reject(createCloudProviderHTTP(Date.now()+165000).complete('worldlabs',{done:true,error,response:{world_id:'ignored-world'}}),'PROVIDER_GENERATION_FAILED');
    for(const done of [undefined,'true',1])await reject(createCloudProviderHTTP(Date.now()+165000).complete('worldlabs',{done,error:null,response:{id:'ignored-world'}}),'PROVIDER_RESPONSE_INVALID');
    for(const error of [[],false,true,0,'private provider message'])for(const done of [false,true])await reject(createCloudProviderHTTP(Date.now()+165000).complete('worldlabs',{done,error,response:{id:'ignored-world'}}),'PROVIDER_RESPONSE_INVALID');
    await reject(createCloudProviderHTTP(Date.now()+165000).complete('worldlabs',{done:false,error:{code:500,message:'failure'}}),'PROVIDER_GENERATION_FAILED');
    assert.equal(requests,0);
  }finally{globalThis.fetch=savedFetch;}
});

test('World Labs HTTP errors retain only bounded codes and validated request identifiers without automatic resubmission',async t=>{
  const savedFetch=globalThis.fetch,savedError=console.error,logs=[],calls=[];
  t.after(()=>{globalThis.fetch=savedFetch;console.error=savedError;});console.error=value=>logs.push(JSON.parse(value));
  const requestId='00000000-0000-4000-8000-000000000123';
  globalThis.fetch=async(url,init)=>{calls.push([String(url),init.method]);return new Response(JSON.stringify({error:{code:'INTERNAL',message:'private prompt secret image https://private.invalid'},request_id:requestId,detail:{image:'private bytes'}}),{status:500});};
  await reject(createCloudProviderHTTP(Date.now()+165000).json('worldlabs','/worlds:generate','POST',{private:'secret prompt'}),'PROVIDER_REQUEST_REJECTED');
  assert.equal(calls.length,1);assert.equal(logs[0].event,'cloud_provider_submission_error');assert.equal(logs[0].providerCode,'INTERNAL');assert.equal(logs[0].requestId,requestId);assert.equal(logs[0].httpStatus,500);
  await reject(createCloudProviderHTTP(Date.now()+165000).json('worldlabs','/operations/private-operation'),'PROVIDER_REQUEST_REJECTED');assert.equal(calls.length,2);
  assert.equal(logs[1].event,'cloud_provider_request_error');assert.equal(logs[1].stage,'worldlabs');assert.equal(logs[1].requestId,requestId);
  assert.doesNotMatch(JSON.stringify(logs),/private|prompt|secret|image|https?:|bytes|operation/);
  assert.deepEqual(cloudProviderFailureMetadata({code:'private-code',request_id:'private-token'},{get:()=>null}),{providerCode:null,requestId:null});
  for(const code of [-1,1.5,1000000,NaN,'500','CUSTOM_PRIVATE_ERROR'])assert.equal(cloudProviderFailureMetadata({code}).providerCode,null);
  assert.equal(cloudProviderFailureMetadata({code:500,request_id:'req_0123456789ABCDEF'}).requestId,'req_0123456789ABCDEF');
  assert.equal(cloudProviderFailureMetadata({code:500,request_id:'req_'+ 'x'.repeat(81)}).requestId,null);
  assert.equal(cloudProviderFailureMetadata({request_id:'private body' },new Headers({'x-request-id':requestId})).requestId,requestId);
});

test('a definitive world retry refusal returns its domain without claiming submission or invoking generation',async t=>{
  const savedError=console.error,logs=[],calls=[];console.error=value=>logs.push(JSON.parse(value));t.after(()=>{console.error=savedError;});
  const service={retryWorld:async(...args)=>{calls.push(args);throw new AppError('WORLD_RETRY_UNAVAILABLE',409);}},res=response();
  await createCloudInstantHandler(service)(request('retry-world',{body:{id:'00000000-0000-4000-8000-000000000000',retryKey:'synthetic-retry-key'}}),res);
  assert.equal(res.statusCode,409);assert.equal(res.body.ok,false);assert.equal(res.body.error.code,'WORLD_RETRY_UNAVAILABLE');assert.equal(calls.length,1);
  assert.deepEqual(calls[0].slice(0,3),['00000000-0000-4000-8000-000000000000','A'.repeat(43),'synthetic-retry-key']);assert.match(calls[0][3],/^[a-f0-9]{64}$/);
  assert.deepEqual(logs,[{event:'cloud_instant_request_error',action:'retry-world',errorCode:'WORLD_RETRY_UNAVAILABLE',httpStatus:409}]);
});
