import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createTSLoader,here } from './cloud-instant-test-loader.mjs';

const adapterStub=`export const cloudInstantConfigured=()=>false;export const createCloudInstantRepository=()=>({});export const createCloudProviderAdapter=()=>({});export const createRemoteCloudModerator=()=>({configured:false});`;
const load=createTSLoader(new Map([[resolve(here,'_lib/cloud-instant-adapters.ts'),adapterStub],[resolve(here,'instant-gallery.ts'),`export const instantGalleryService=()=>({enabled:()=>false,reconcile:async()=>false});`]]));
const {createCloudInstantService,cloudWorldDiagnostics}=await load(resolve(here,'_lib/cloud-instant-service.ts'));
const {createCloudInstantHandler}=await load(resolve(here,'instant-cloud.ts'));
const {AppError,giftHash}=await load(resolve(here,'_lib/rules.ts'));
const id='00000000-0000-4000-8000-000000000001',token='A'.repeat(43),clock=Date.parse('2026-10-04T12:00:00Z');
const forbidden=name=>()=>{throw Error(`Unexpected side effect: ${name}`);};
function fixture(result={done:true,error:{code:3,message:'Invalid image input'}},extra={}){
  const job={id,state:'partial',expires_at:'2026-10-11T12:00:00Z',revision:7,lease_id:null,created_at:'2026-10-04T11:00:00Z',updated_at:'2026-10-04T11:10:00Z',document:{title:'Private title',worldPrompt:'Private prompt'},stages:{tripo:{state:'completed'},worldlabs:{state:'failed',taskId:'stored-world-task',errorCode:'PROVIDER_GENERATION_FAILED',polls:2}},assets:{original:{path:'private-input.png'}},...extra};
  const calls=[],repository=new Proxy({async get(value,cap){calls.push(['get',value,cap]);if(value!==id||cap!==giftHash(token))throw new AppError('JOB_UNAVAILABLE',404);return structuredClone(job);}},{get(target,name){return name in target?target[name]:forbidden(`repo.${String(name)}`);}});
  const providers=new Proxy({async poll(stage,taskId){calls.push(['poll',stage,taskId]);return structuredClone(result);}},{get(target,name){return name in target?target[name]:forbidden(`provider.${String(name)}`);}});
  const service=createCloudInstantService({repository,providers,moderator:{configured:false,screen:forbidden('moderator')},settings:forbidden('settings'),now:()=>clock});
  return {job,calls,repository,providers,service};
}
const response=()=>({headers:{},statusCode:0,setHeader(name,value){this.headers[name]=value;},end(body){this.body=JSON.parse(body);}});
const request=(extra={})=>({method:'GET',url:`/api/instant-cloud?action=world-diagnostics&id=${id}`,headers:{host:'gift.example',origin:'https://gift.example','sec-fetch-site':'same-origin','x-instant-token':token},...extra});
process.env.GIFTPORTALS_CLOUD_ORIGIN='https://gift.example';

test('an existing failed World can be diagnosed with only its capability read and stored-operation poll',async()=>{
  const f=fixture(),before=structuredClone(f.job),result=await f.service.diagnoseWorld(id,token);
  assert.equal(result.done,true);assert.equal(result.errorCode,3);assert.equal(result.reason,'invalid-input');
  assert.deepEqual(f.calls,[['get',id,giftHash(token)],['poll','worldlabs','stored-world-task']]);
  assert.deepEqual(f.job,before,'Diagnosis must not mutate the persisted gift or stages');
  assert.doesNotMatch(JSON.stringify(result),/stored-world-task|private|prompt|00000000|https?:/i);
});

test('wrong capabilities, invalid or expired gifts, and missing or malformed recorded tasks never poll a provider',async()=>{
  for(const [extra,reference,cap,code] of [
    [{},id,'B'.repeat(43),'JOB_UNAVAILABLE'],[{},id,'','GIFT_UNAVAILABLE'],[{},'external-operation',token,'INVALID_ID'],
    [{expires_at:'2026-10-04T12:00:00Z'},id,token,'JOB_UNAVAILABLE'],[{expires_at:'not-a-date'},id,token,'JOB_UNAVAILABLE'],
    [{expires_at:undefined},id,token,'JOB_UNAVAILABLE'],[{state:'expired'},id,token,'JOB_UNAVAILABLE'],
    [{stages:{}},id,token,'WORLD_TASK_UNAVAILABLE'],[{stages:{worldlabs:{state:'failed'}}},id,token,'WORLD_TASK_UNAVAILABLE'],
    [{stages:{worldlabs:{state:'failed',taskId:'https://external.invalid/operation'}}},id,token,'WORLD_TASK_UNAVAILABLE'],
  ]){
    const f=fixture(undefined,extra);
    await assert.rejects(f.service.diagnoseWorld(reference,cap),error=>error.code===code);
    assert.equal(f.calls.some(([kind])=>kind==='poll'),false);
  }
});

test('safe diagnosis distinguishes error presence, empty objects, malformed shapes and bounded provider codes',()=>{
  const cases=[
    [{},false,'absent',null,null], [{error:null},false,'null',true,null], [{error:{}},true,'object',true,null],
    [{error:[]},true,'array',true,null], [{error:'  '},true,'string',true,null], [{error:42},true,'number',null,null],
    [{error:false},true,'boolean',null,null], [{error:{code:0}},true,'object',false,0],
    [{error:{code:999999}},true,'object',false,999999], [{error:{code:1000000}},true,'object',false,null],
    [{error:{code:-1}},true,'object',false,null], [{error:{code:1.5}},true,'object',false,null],
    [{error:{code:'INVALID_ARGUMENT'}},true,'object',false,'INVALID_ARGUMENT'],
    [{error:{code:'private-token'}},true,'object',false,null], [{error:{code:'3'}},true,'object',false,null],
  ];
  for(const [input,errorPresent,errorShape,errorEmpty,errorCode] of cases){
    const result=cloudWorldDiagnostics({...input,done:'true',response:{world_id:'private-world',url:'https://private.invalid'}});
    assert.deepEqual([result.done,result.errorPresent,result.errorShape,result.errorEmpty,result.errorCode],[null,errorPresent,errorShape,errorEmpty,errorCode]);
    assert.equal(result.reason,'unknown');assert.doesNotMatch(JSON.stringify(result),/private|https?:/);
  }
});

test('provider messages map to fixed reason phrases without returning private messages, IDs, URLs or nested data',()=>{
  const cases=[['Content policy violation','content-policy'],['Failed to download input image','input-download'],['Invalid argument: image input','invalid-input'],['Insufficient credits','insufficient-credits'],['Too many requests: rate limit','rate-limit'],['Generation timed out','timeout'],['Internal server error','provider-internal'],['Unrecognized failure','unknown']];
  for(const [message,reason] of cases){
    const result=cloudWorldDiagnostics({done:true,error:{code:7,message:`${message}; private-prompt private-task https://private.invalid/?token=private-token`,details:{body:'private-response'}},response:{world_id:'private-world'}});
    assert.equal(result.reason,reason);assert.equal(typeof result.reasonText,'string');assert.ok(result.reasonText.length<120);
    assert.deepEqual(Object.keys(result).sort(),['done','errorCode','errorEmpty','errorPresent','errorShape','reason','reasonText'].sort());
    assert.doesNotMatch(JSON.stringify(result),/private|https?:|token|prompt|response|details/);
  }
  const huge=cloudWorldDiagnostics({done:false,error:{code:NaN,message:'x'.repeat(8192)+' private credits insufficient'}});
  assert.equal(huge.reason,'unknown');assert.equal(huge.errorCode,null);
});

test('diagnostic GET requires a same-origin request and header capability, and rejects methods or URL capabilities and external task IDs',async t=>{
  const saved=console.error;console.error=()=>{};t.after(()=>{console.error=saved;});
  const f=fixture(),res=response();await createCloudInstantHandler(f.service)(request(),res);
  assert.equal(res.statusCode,200);assert.equal(res.body.ok,true);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.headers['Referrer-Policy'],'no-referrer');assert.equal(res.headers['Set-Cookie'],undefined);
  for(const extra of [
    {method:'POST'},
    {url:`/api/instant-cloud?action=world-diagnostics&id=${id}&token=${token}`},
    {url:`/api/instant-cloud?action=world-diagnostics&id=${id}&taskId=external-task`},
    {headers:{host:'gift.example',origin:'https://foreign.example','x-instant-token':token}},
    {headers:{host:'gift.example','sec-fetch-site':'cross-site','x-instant-token':token}},
    {headers:{host:'foreign.example',origin:'https://gift.example','x-instant-token':token}},
    {headers:{host:'gift.example',origin:'https://gift.example'}},
  ]){
    const denied=fixture(),reply=response();await createCloudInstantHandler(denied.service)(request(extra),reply);
    assert.equal(reply.body.ok,false);assert.equal(denied.calls.some(([kind])=>kind==='poll'),false);
    assert.doesNotMatch(JSON.stringify(reply.body),/private|external-task|A{43}/);
  }
});

test('future World failure logging uses the same safe metadata and preserves the existing worker failure lifecycle',async t=>{
  const raw={done:true,error:{code:13,message:'Internal server error with private-task https://private.invalid/?token=private-token',details:{prompt:'private-prompt'}}},f=fixture(raw,{state:'processing'});
  f.job.document.photoSafety={decision:'allow'};f.job.stages.worldlabs.state='processing';f.job.lease_id='existing-lease';
  f.repository.claim=async()=>structuredClone(f.job);
  let savedJob;
  f.repository.update=async(job,changes)=>{savedJob=structuredClone({...job,...changes});return savedJob;};
  f.providers.complete=async()=>{throw new AppError('PROVIDER_GENERATION_FAILED',502);};
  const saved=console.error,logs=[];console.error=value=>logs.push(JSON.parse(value));t.after(()=>{console.error=saved;});
  const worker=createCloudInstantService({repository:f.repository,providers:f.providers,moderator:{configured:true,screen:forbidden('moderator')},settings:()=>({enabled:true,providers:{tripo:true,worldlabs:true},dedupeSecret:'offline-configuration-never-used-for-generation'}),now:()=>clock});
  const outcome=await worker.tick('offline-worker',id);
  assert.deepEqual(outcome,{processed:true,state:'failed',errorCode:'PROVIDER_GENERATION_FAILED'});
  assert.equal(savedJob.state,'partial');assert.equal(savedJob.stages.worldlabs.state,'failed');assert.equal(savedJob.stages.worldlabs.errorCode,'PROVIDER_GENERATION_FAILED');
  assert.deepEqual(logs,[{event:'cloud_world_operation_failed',...cloudWorldDiagnostics(raw)}]);
  assert.doesNotMatch(JSON.stringify(logs),/private|https?:|task|prompt|token|00000000/);
  assert.deepEqual(f.calls,[['poll','worldlabs','stored-world-task']]);
});
