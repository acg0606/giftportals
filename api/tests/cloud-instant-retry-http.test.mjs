import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createTSLoader,here } from './cloud-instant-test-loader.mjs';
const stub=`export const cloudInstantConfigured=()=>false;export const createCloudInstantRepository=()=>({});export const createCloudProviderAdapter=()=>({});export const createRemoteCloudModerator=()=>({configured:false});`;
const load=createTSLoader(new Map([[resolve(here,'_lib/cloud-instant-adapters.ts'),stub],[resolve(here,'_lib/instant-gallery-adapters.ts'),'export const createInstantGalleryRepository=()=>({});']]));
const {createCloudInstantHandler}=await load(resolve(here,'instant-cloud.ts'));
const {AppError}=await load(resolve(here,'_lib/rules.ts'));
process.env.GIFTPORTALS_CLOUD_ORIGIN='https://gift.example';process.env.CLOUD_DEDUPE_SECRET='offline-retry-http-test-secret-over32chars';
const id='00000000-0000-4000-8000-000000000000',token='A'.repeat(43);
const response=()=>({headers:{},statusCode:0,setHeader(key,value){this.headers[key]=value;},end(body){this.body=JSON.parse(body);}});
const request=(extra={})=>({method:'POST',url:'/api/instant-cloud?action=retry-world',headers:{host:'gift.example',origin:'https://gift.example','sec-fetch-site':'same-origin','content-type':'application/json','x-instant-token':token},body:{id,retryKey:'explicit-world-retry-01'},...extra});
test('explicit World retry forwards only ID, capability, idempotency key and signed creator identity',async()=>{
  const calls=[],handler=createCloudInstantHandler({retryWorld:async(...args)=>{calls.push(args);return{state:'processing'};}}),first=response();
  await handler(request(),first);assert.equal(first.statusCode,200);assert.deepEqual(calls[0].slice(0,3),[id,token,'explicit-world-retry-01']);assert.match(calls[0][3],/^[a-f0-9]{64}$/);
  const cookie=first.headers['Set-Cookie'].split(';')[0],second=response();await handler(request({headers:{...request().headers,cookie}}),second);
  assert.equal(calls[1][3],calls[0][3]);assert.equal(second.headers['Set-Cookie'],undefined);assert.equal(first.headers['Cache-Control'],'no-store');
});
test('World retry rejects cross-origin, GET and arbitrary provider recipe or task fields before service work',async()=>{
  for(const [extra,expected] of[
    [{method:'GET'},405],
    [{headers:{...request().headers,origin:'https://evil.example'}},403],
    [{body:{id,retryKey:'explicit-world-retry-01',recipeOverride:{disableRecaption:false}}},400],
    [{body:{id,retryKey:'explicit-world-retry-01',taskId:'private-provider-operation'}},400],
  ]){
    let called=false;const res=response();await createCloudInstantHandler({retryWorld:async()=>{called=true;}})(request(extra),res);
    assert.equal(res.statusCode,expected);assert.equal(called,false);
  }
});
test('World retry refuses recipient capability under a different creator cookie and exposes fixed safe errors',async t=>{
  const saved=console.error,logs=[];console.error=value=>logs.push(JSON.parse(value));t.after(()=>{console.error=saved;});
  for(const [code,status] of[['JOB_UNAVAILABLE',404],['WORLD_RETRY_UNAVAILABLE',409]]){
    const res=response();await createCloudInstantHandler({retryWorld:async()=>{throw new AppError(code,status,'private cookie, task ID and provider body');}})(request(),res);
    assert.equal(res.statusCode,status);assert.equal(res.body.error.code,code);assert.deepEqual(logs.at(-1),{event:'cloud_instant_request_error',action:'retry-world',errorCode:code,httpStatus:status});
    assert.doesNotMatch(JSON.stringify(res.body)+JSON.stringify(logs.at(-1)),/private|cookie|provider body|task ID/);
  }
});
