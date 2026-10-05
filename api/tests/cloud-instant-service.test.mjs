import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createTSLoader,here } from './cloud-instant-test-loader.mjs';
const load=createTSLoader();
const {createCloudInstantService,cloudInputDocument,verifyCloudSafety,cloudRequestHash,cloudWorldRetryRequestHash,cloudWorldRetryEligible,cloudWorldDiagnostics}=await load(resolve(here,'_lib/cloud-instant-service.ts'));
const {AppError,giftHash}=await load(resolve(here,'_lib/rules.ts'));
const {INSTANT_EXAMPLES}=await load(resolve(here,'../shared/instant-examples.ts'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),copy=structuredClone;
const token='A'.repeat(43),otherToken='B'.repeat(43),secret='test-only-secret-for-offline-tests-123456789';
const png=Buffer.from([137,80,78,71,13,10,26,10,7,1,2,3]),png2=Buffer.from([137,80,78,71,13,10,26,10,9,4,5,6]);
const image=bytes=>({mime:'image/png',bytes:bytes.length,sha256:hash(bytes)});
const input=extra=>({title:'A real memory',worldPrompt:'A calm remembered plaza',story:'My exact story',dedication:'For you',senderName:'Alice',recipientName:'Bob',photoIntent:'object',requestToken:token,dedupeKey:'stable-request-01',consent:true,images:{original:image(png)},...extra});
const report=(images,decision='allow')=>({protocol:'giftportals-cloud-vision-v1',modelVersion:'offline-vision-v1',checkedAt:'2026-10-04T00:00:00.000Z',decision,results:images.map(image=>({id:image.id,sha256:image.sha256,modelVersion:'offline-vision-v1',decision,category:decision==='allow'?'ordinary':decision==='block'?'sexual':'uncertain'}))});
function fixture(options={}){
  const jobs=new Map(),requests=new Map(),bytes=new Map(),journal=[],retries=new Map();let leases=0;
  const checked=(id,cap)=>{const job=jobs.get(id);if(!job||job.tokenHash!==cap)throw new AppError('JOB_UNAVAILABLE',404);return job;};
  const cas=job=>{const old=jobs.get(job.id);if(!old||old.lease_id!==job.lease_id||!old.lease_id||old.revision!==job.revision)throw new AppError('INSTANT_LEASE_CONFLICT',409);return old;};
  const publicJob=job=>{const{tokenHash,requestKeyHash,inputHash,ownerHash,...value}=job;return copy(value);};
  const repository={
    async prepare(v){journal.push(['prepare']);const old=requests.get(v.requestKeyHash);if(old){const job=jobs.get(old);if(job.tokenHash!==v.tokenHash||job.inputHash!==v.inputHash||job.ownerHash!==v.ownerHash)throw new AppError('DEDUPE_MISMATCH',409);return{job:publicJob(job),deduplicated:true};}const job={...v,state:'awaiting_upload',document:copy(v.document),stages:{},assets:{},revision:0,created_at:'2026-10-04T00:00:00Z',updated_at:'2026-10-04T00:00:00Z',expires_at:'2026-10-12T00:00:00Z',lease_id:null};jobs.set(v.id,job);requests.set(v.requestKeyHash,v.id);return{job:publicJob(job),deduplicated:false};},
    async get(id,cap){journal.push(['get',id]);return publicJob(checked(id,cap));},
    async lookup(key,cap){return publicJob(checked(requests.get(key),cap));},
    async finalize(id,cap,assets){const job=checked(id,cap);if(job.state==='awaiting_upload'){job.assets=copy(assets);job.state='queued';job.revision++;}return publicJob(job);},
    async worldRetryOwner(id,cap,owner){return checked(id,cap).ownerHash===owner;},
    async retryWorld(id,cap,owner,key,recipeOverride){const job=checked(id,cap);if(job.ownerHash!==owner)throw new AppError('JOB_UNAVAILABLE',404);if(retries.has(key))return publicJob(job);if(!cloudWorldRetryEligible(job))throw new AppError('WORLD_RETRY_UNAVAILABLE',409);const attempt=(job.document.worldRetry?.attempt||0)+1;retries.set(key,{stage:copy(job.stages.worldlabs),credits:1580,attempt});journal.push(['reserve-world-retry',1580]);delete job.stages.worldlabs;if(job.document.stageFailures)delete job.document.stageFailures.worldlabs;job.document.worldRetry={attempt,recipeOverride:copy(recipeOverride)};job.state='processing';job.revision++;return publicJob(job);},
    async claim(worker,id){journal.push(['claim',id]);const job=[...jobs.values()].find(job=>(!id||job.id===id)&&!job.lease_id&&(['queued','processing'].includes(job.state)||(job.state==='submission_uncertain'&&Object.values(job.stages).some(stage=>stage.state==='processing'&&stage.taskId))));if(!job)return null;job.state=job.state==='submission_uncertain'?job.state:'processing';job.lease_id=`lease-${++leases}`;job.revision++;return publicJob(job);},
    async begin(value,stage){const job=cas(value);assert.equal(job.state,'processing');assert.equal(job.stages[stage],undefined);assert.equal(job.document.stageFailures?.[stage],undefined);assert.equal(job.document.photoSafety?.decision,'allow');job.stages[stage]={state:'submitting',progress:0,submittedAt:'2026-10-04T00:00:01Z'};job.revision++;journal.push(['begin',stage]);return publicJob(job);},
    async update(value,changes){const job=cas(value);job.state=changes.state;job.document=copy(changes.document);job.stages=copy(changes.stages);job.assets=copy(changes.assets);job.revision++;if(changes.releaseLease!==false)job.lease_id=null;journal.push(['update',job.state]);return publicJob(job);},
    async signUpload(asset){return`https://storage.invalid/upload/${asset.path}`;},
    async inputExists(asset){journal.push(['inputExists',asset.id]);return bytes.has(asset.path);},
    async signRead(asset){journal.push(['signRead',asset.id]);return`https://storage.invalid/read/${asset.path}`;},
    async download(asset){journal.push(['download',asset.id]);if(!bytes.has(asset.path))throw new AppError('IMAGE_CONTENT_INVALID');return Buffer.from(bytes.get(asset.path));},
    async upload(asset,value){journal.push(['store',asset.id]);const old=bytes.get(asset.path);if(old)assert.equal(hash(old),hash(value));bytes.set(asset.path,Buffer.from(value));},
    async status(){return{canCreate:options.canCreate!==false,budget:{tripo:{cap:1000},worldlabs:{cap:20000}}};},
  };
  const generated=(key,value,suffix='png',mime='image/png')=>({key,bytes:value,suffix,mime,sha256:hash(value)});
  const providers={
    async credit(provider,reservation){journal.push(['credit',provider,reservation]);if(options.creditError&&options.creditProvider===provider)throw options.creditError;},
    async upload(provider,value,mime){journal.push(['providerUpload',provider,hash(value),mime]);return`uploaded-${provider}`;},
    async submit(stage,job){journal.push(['submit',stage]);assert.equal(jobs.get(job.id).stages[stage].state,'submitting','Durable intent precedes paid submit');if(options.submitError)throw options.submitError;return`task-${stage}`;},
    async poll(stage,id){journal.push(['poll',stage,id]);if(options.pollError)throw options.pollError;return{progress:100};},
    async complete(stage){if(options.incomplete)return null;return stage==='tripo-reference'?{assets:[generated('reference',png2)]}:stage==='tripo'?{assets:[generated('model',Buffer.from('model'),'glb','model/gltf-binary')]}:{assets:[generated('generated-world',Buffer.from('spz'),'spz','application/octet-stream'),generated('panorama',png2),generated('collider',Buffer.from('collider'),'glb','model/gltf-binary')],worldSemantics:options.semantics||{metricScaleFactor:2.9049978,groundPlaneOffset:1.6893421},worldQuality:'500k',colliderStatus:'available'};},
  };
  const moderator={configured:options.moderatorConfigured!==false,async screen(images){journal.push(['moderate',images.map(image=>image.id)]);return options.moderationReport?options.moderationReport(images):report(images,options.decision||'allow');}};
  const service=()=>createCloudInstantService({repository,providers,moderator,settings:()=>({enabled:options.enabled!==false,providers:{tripo:true,worldlabs:true},dedupeSecret:secret})});
  async function prepared(value=input()){const out=await service().prepare(value,'c'.repeat(64));for(const upload of out.uploads)bytes.set(upload.url.replace('https://storage.invalid/upload/',''),Buffer.from(upload.id==='original'?png:png2));return out;}
  async function queued(value=input()){const out=await prepared(value);await service().finalize(out.id,out.token);return out;}
  return{service,repository,providers,moderator,jobs,bytes,journal,retries,prepared,queued};
}
const rejectCode=(promise,code)=>assert.rejects(promise,error=>error.code===code);
async function failedWorldFixture(){
  const f=fixture(),out=await f.queued(),complete=f.providers.complete,poll=f.providers.poll;
  f.providers.poll=async(stage,id)=>stage==='worldlabs'?{done:true,error:{code:500}}:poll(stage,id);
  f.providers.complete=async(stage,result)=>{if(stage==='worldlabs')throw new AppError('PROVIDER_GENERATION_FAILED',502);return complete(stage,result);};
  for(let i=0;i<6;i++)await f.service().tick(`failure-worker-${i}`,out.id);
  assert.equal(f.jobs.get(out.id).state,'partial');assert.equal(f.jobs.get(out.id).stages.tripo.state,'completed');
  f.providers.complete=complete;return{...f,out,successfulPoll:poll};
}

test('World code500 identifies provider-internal failure without inventing its internal cause',()=>{
  const diagnostic=cloudWorldDiagnostics({done:true,error:{code:500}});
  assert.equal(diagnostic.reason,'provider-internal');assert.equal(diagnostic.errorCode,500);
  assert.doesNotMatch(diagnostic.reasonText,/upload|photo|prompt|caption|download/);
  assert.equal(cloudWorldDiagnostics({done:true,error:{code:500,message:'invalid input image'}}).reason,'invalid-input');
});
test('World retry preserves the exact memory, inputs, model and original recipe while reserving only one new World attempt',async()=>{
  const f=await failedWorldFixture(),job=f.jobs.get(f.out.id);job.document.generation.worldlabs.model='marble-1.1';
  const before=copy(job),oldStage=copy(job.stages.worldlabs),journalStart=f.journal.length;
  assert.equal((await f.service().get({id:job.id,token,ownerHash:'c'.repeat(64)})).worldRetry.available,true);
  const pending=await f.service().retryWorld(job.id,token,'world-retry-key-01','c'.repeat(64));
  assert.equal(pending.state,'processing');assert.equal(pending.worldRetry.attempts,1);assert.equal(pending.worldRetry.available,false);
  assert.equal(pending.tripo.state,'completed');assert.ok(pending.assets.modelUrl);assert.equal(pending.story,before.document.story);
  assert.deepEqual(job.assets,before.assets);assert.deepEqual(job.stages.tripo,before.stages.tripo);assert.deepEqual(job.document.generation,before.document.generation);
  assert.deepEqual(job.document.photoSafety,before.document.photoSafety);assert.deepEqual(job.document.images,before.document.images);assert.equal(job.expires_at,before.expires_at);
  assert.deepEqual(job.document.worldRetry.recipeOverride,{model:'marble-1.0'});assert.equal(pending.generation.worldlabs.model,'marble-1.0');
  assert.deepEqual([...f.retries.values()][0].stage,oldStage);assert.equal([...f.retries.values()][0].credits,1580);
  assert.equal(f.journal.slice(journalStart).some(([kind])=>['submit','credit','providerUpload','moderate'].includes(kind)),false,'The explicit retry reserves work; only the leased worker starts the paid POST');
  f.providers.poll=f.successfulPoll;for(let i=0;i<3;i++)await f.service().advance(job.id,token,'c'.repeat(64));
  assert.equal(job.state,'completed');assert.equal(f.journal.filter(([kind,stage])=>kind==='submit'&&stage==='tripo').length,1);
  assert.equal(f.journal.filter(([kind,stage])=>kind==='submit'&&stage==='worldlabs').length,2);
  assert.deepEqual(job.stages.tripo,before.stages.tripo);assert.ok(job.assets['generated-world']);
});
test('lost retry response and concurrent duplicate keys reserve once and cannot repeat a World POST',async()=>{
  const f=await failedWorldFixture(),id=f.out.id,owner='c'.repeat(64);
  const [a,b]=await Promise.all([f.service().retryWorld(id,token,'same-world-retry-01',owner),f.service().retryWorld(id,token,'same-world-retry-01',owner)]);
  assert.equal(a.worldRetry.attempts,1);assert.equal(b.worldRetry.attempts,1);assert.equal(f.retries.size,1);
  await Promise.all([f.service().advance(id,token,owner),f.service().advance(id,token,owner)]);
  await f.service().retryWorld(id,token,'same-world-retry-01',owner);
  assert.equal(f.journal.filter(([kind])=>kind==='reserve-world-retry').length,1);
  assert.equal(f.journal.filter(([kind,stage])=>kind==='submit'&&stage==='worldlabs').length,2);
  await rejectCode(f.service().retryWorld(id,token,'different-world-retry-02',owner),'WORLD_RETRY_UNAVAILABLE');
  assert.notEqual(cloudWorldRetryRequestHash(id,token,'same-world-retry-01',secret),cloudWorldRetryRequestHash(id,token,'different-world-retry-02',secret));
  assert.notEqual(cloudWorldRetryRequestHash(id,token,'same-world-retry-01',secret),cloudWorldRetryRequestHash('00000000-0000-4000-8000-000000000000',token,'same-world-retry-01',secret));
});
test('recipient capability alone cannot authorize World retry and another owner never sees recovery available',async()=>{
  const f=await failedWorldFixture(),id=f.out.id,count=f.journal.length;
  assert.equal((await f.service().get({id,token})).worldRetry.available,false);
  assert.equal((await f.service().get({id,token,ownerHash:'e'.repeat(64)})).worldRetry.available,false);
  await rejectCode(f.service().retryWorld(id,token,'private-world-retry-01','e'.repeat(64)),'JOB_UNAVAILABLE');
  await rejectCode(f.service().retryWorld(id,otherToken,'private-world-retry-01','c'.repeat(64)),'JOB_UNAVAILABLE');
  assert.equal(f.journal.slice(count).some(([kind])=>['reserve-world-retry','submit','credit','providerUpload'].includes(kind)),false);
});
test('World retry rejects uncertain, unfinished, expired and unproven terminal attempts without another charge',async()=>{
  for(const change of[
    job=>{job.state='submission_uncertain';job.stages.worldlabs.state='submission_uncertain';},
    job=>{job.state='processing';job.stages.worldlabs.state='processing';},
    job=>{job.stages.worldlabs.errorCode='JOB_EXPIRED';},
    job=>{job.stages.worldlabs.diagnostics.done=false;},
    job=>{job.lease_id='still-leased';},
    job=>{job.expires_at='2026-10-03T00:00:00Z';},
  ]){
    const f=await failedWorldFixture(),job=f.jobs.get(f.out.id);change(job);
    await rejectCode(f.service().retryWorld(job.id,token,'terminal-world-retry-01','c'.repeat(64)),'WORLD_RETRY_UNAVAILABLE');
    assert.equal(f.retries.size,0);assert.equal(f.journal.some(([kind])=>kind==='reserve-world-retry'),false);
  }
});
test('World recovery rechecks input hash and moderation proof before an atomic reservation',async()=>{
  for(const change of[
    (f,job)=>{job.document.photoSafety.decision='block';},
    (f,job)=>{job.document.photoSafety.results[0].sha256='e'.repeat(64);},
    (f,job)=>{f.bytes.set(job.assets.original.path,png2);},
  ]){
    const f=await failedWorldFixture(),job=f.jobs.get(f.out.id);change(f,job);
    await assert.rejects(f.service().retryWorld(job.id,token,'safe-world-retry-01','c'.repeat(64)));
    assert.equal(f.retries.size,0);assert.equal(f.journal.some(([kind])=>kind==='reserve-world-retry'),false);
  }
});
test('legacy failed state requires a fresh terminal nonempty provider error and never repeats an active or successful operation',async()=>{
  for(const receipt of[
    {done:false,error:{}},
    {done:false,error:{code:500}},
    {done:true,error:null,response:{id:'already-successful-world'}},
    {done:true,error:{},response:{id:'already-successful-world'}},
    {done:true,error:{}},
    {done:true,error:{code:500},response:{id:'contradictory-world'}},
  ]){
    const f=await failedWorldFixture(),job=f.jobs.get(f.out.id);delete job.stages.worldlabs.diagnostics;
    f.providers.poll=async()=>receipt;
    await rejectCode(f.service().retryWorld(job.id,token,'legacy-world-retry-01','c'.repeat(64)),'WORLD_RETRY_UNAVAILABLE');
    assert.equal(f.retries.size,0);assert.equal(f.journal.some(([kind])=>kind==='reserve-world-retry'),false);
  }
  const f=await failedWorldFixture(),job=f.jobs.get(f.out.id);delete job.stages.worldlabs.diagnostics;
  await f.service().retryWorld(job.id,token,'confirmed-legacy-world-01','c'.repeat(64));assert.equal(f.retries.size,1);
});

test('prepare deduplicates the exact immutable recipe without provider calls and rejects changed input',async()=>{const f=fixture(),source=input(),snapshot=copy(source),first=await f.prepared(source),second=await f.service().prepare(source,'c'.repeat(64));assert.equal(first.id,second.id);assert.equal(second.deduplicated,true);assert.equal(f.jobs.size,1);assert.deepEqual(source,snapshot);assert.equal(f.journal.some(([kind])=>['submit','providerUpload','credit','moderate'].includes(kind)),false);await rejectCode(f.service().prepare(input({story:'changed'}),'c'.repeat(64)),'DEDUPE_MISMATCH');assert.equal(cloudRequestHash(token,'stable-request-01',secret),cloudRequestHash(token,'stable-request-01',secret));assert.notEqual(cloudRequestHash(token,'stable-request-01',secret),cloudRequestHash(otherToken,'stable-request-01',secret));});
test('a lost prepare response across the default-model change recovers the older pinned recipe and still rejects changed input or owner',async()=>{
  const f=fixture(),source=input(),first=await f.prepared(source),job=f.jobs.get(first.id);
  job.document.generation.worldlabs.model='marble-1.0';job.inputHash=hash(JSON.stringify(job.document));
  const recovered=await f.service().prepare(source,'c'.repeat(64));assert.equal(recovered.id,first.id);assert.equal(recovered.deduplicated,true);
  assert.equal(job.document.generation.worldlabs.model,'marble-1.0');assert.equal(f.jobs.size,1);
  await rejectCode(f.service().prepare(input({story:'Changed user input'}),'c'.repeat(64)),'DEDUPE_MISMATCH');
  await rejectCode(f.service().prepare(source,'e'.repeat(64)),'DEDUPE_MISMATCH');
  assert.equal(f.journal.some(([kind])=>['submit','providerUpload','credit','moderate'].includes(kind)),false);
  const created=await f.service().prepare(input({dedupeKey:'new-model-request-02'}),'c'.repeat(64));assert.equal(f.jobs.get(created.id).document.generation.worldlabs.model,'marble-1.1');
});
test('metadata enforces consent, image limits, hashes, roles, prompt lengths, explicit recipe and exact story',()=>{const doc=cloudInputDocument(input({photoIntent:'place'}));assert.equal(doc.needsReference,true);assert.equal(doc.generation.tripo.face_limit,30000);assert.equal(doc.generation.worldlabs.model,'marble-1.1');assert.equal(doc.generation.tripoReference.model,'chat_image_2');assert.equal(doc.story,'My exact story');for(const bad of[{consent:false},{photoIntent:'other'},{images:{original:{...image(png),bytes:6*1024*1024+1}}},{images:{original:{...image(png),sha256:'no'}}},{images:{original:null}},{images:{original:image(png),audio:image(png)}},{worldPrompt:'short'},{photoIntent:'place',images:{original:image(png),object:image(png2)}},{photoIntent:'place',objectImageRole:'miniature-reference',images:{original:image(png),object:image(png)}}])assert.throws(()=>cloudInputDocument(input(bad)),error=>Boolean(error.code));});
test('finalize verifies original plus every derivative against actual bytes and leaves all bytes private before moderation',async()=>{const f=fixture(),out=await f.prepared(input({images:{original:image(png),object:image(png2),world:image(png2)}})),job=f.jobs.get(out.id);const badPath=out.uploads.find(v=>v.id==='world').url.replace('https://storage.invalid/upload/','');f.bytes.set(badPath,png);await rejectCode(f.service().finalize(out.id,token),'IMAGE_CONTENT_INVALID');assert.equal(job.state,'awaiting_upload');f.bytes.set(badPath,png2);const dto=await f.service().finalize(out.id,token);assert.equal(dto.state,'processing');assert.equal(dto.assets.photoUrl,'');assert.equal(f.journal.some(([kind])=>kind==='signRead'||kind==='submit'),false);});
test('GET exposes pending uploads without work and finalization changes only the existing job upload state',async()=>{const f=fixture(),out=await f.prepared();const pending=await f.service().get({id:out.id,token});assert.equal(pending.uploadState,'pending');await f.service().advance(out.id,token);assert.equal(f.journal.some(([kind])=>['claim','submit','moderate'].includes(kind)),false);const finalized=await f.service().finalize(out.id,token);assert.equal(finalized.uploadState,'finalized');assert.equal((await f.service().get({id:out.id,token})).uploadState,'finalized');assert.equal(f.jobs.size,1);assert.equal(f.journal.filter(([kind])=>kind==='prepare').length,1);assert.equal(f.journal.some(([kind])=>kind==='submit'),false);});
test('partial upload recovery signs only absent files and verifies existing files before signing anything',async()=>{const f=fixture(),source=input({images:{original:image(png),object:image(png2),world:image(png2)}}),out=await f.prepared(source);const objectPlan=out.uploads.find(value=>value.id==='object'),originalPath=out.uploads.find(value=>value.id==='original').url.replace('https://storage.invalid/upload/','');f.bytes.delete(objectPlan.url.replace('https://storage.invalid/upload/',''));const pending=await f.service().get({id:out.id,token});assert.deepEqual(pending.uploads.map(value=>value.id),['object']);assert.equal(pending.uploads[0].sha256,hash(png2));assert.deepEqual((await f.service().prepare(source,'c'.repeat(64))).uploads.map(value=>value.id),['object']);f.bytes.set(originalPath,png2);let signatures=0;f.repository.signUpload=async()=>{signatures++;return 'must-not-sign-invalid-recovery';};await rejectCode(f.service().get({id:out.id,token}),'IMAGE_CONTENT_INVALID');await rejectCode(f.service().prepare(source,'c'.repeat(64)),'IMAGE_CONTENT_INVALID');assert.equal(signatures,0);assert.equal(f.jobs.size,1);assert.equal(f.journal.some(([kind])=>kind==='submit'),false);});
test('capability cannot read or advance another gift; advance leases only its validated gift',async()=>{const f=fixture(),first=await f.queued(),second=await f.queued(input({requestToken:otherToken,dedupeKey:'second-request-01'}));await rejectCode(f.service().advance(second.id,token),'JOB_UNAVAILABLE');assert.equal(f.journal.filter(([kind])=>kind==='claim').length,0);await f.service().advance(first.id,token);assert.deepEqual(f.journal.filter(([kind])=>kind==='claim').map(([,id])=>id),[first.id]);assert.equal(f.jobs.get(second.id).document.photoSafety,undefined);await rejectCode(f.service().get({id:first.id,token:otherToken}),'JOB_UNAVAILABLE');});
test('all-input moderation blocks or holds review before any provider upload or paid submit',async()=>{for(const decision of['block','review']){const f=fixture({decision}),out=await f.queued(input({images:{original:image(png),object:image(png2),world:image(png2)}}));await f.service().tick('worker');assert.deepEqual(f.journal.find(([kind])=>kind==='moderate')[1],['original','object','world']);assert.equal(f.jobs.get(out.id).state,'failed');assert.equal(f.journal.some(([kind])=>['providerUpload','submit','credit','signRead'].includes(kind)),false);assert.equal((await f.service().get({id:out.id,token})).assets.photoUrl,'');}});
test('pre-stage photo denials and invalid bytes persist their exact failure for both products across restarts without paid work',async()=>{
  for(const photoIntent of['place','object'])for(const scenario of[
    {decision:'block',code:'PHOTO_SAFETY_BLOCKED'},
    {decision:'review',code:'PHOTO_SAFETY_REVIEW_REQUIRED'},
    {decision:'allow',code:'IMAGE_CONTENT_INVALID',invalidBytes:true},
  ]){
    const f=fixture({decision:scenario.decision}),out=await f.queued(input({photoIntent}));
    const original=f.jobs.get(out.id).assets.original;
    if(scenario.invalidBytes)f.bytes.set(original.path,png2);
    const reply=await f.service().tick('first-worker',out.id),stored=f.jobs.get(out.id);
    assert.deepEqual(reply,{processed:true,state:'failed',errorCode:scenario.code});
    assert.equal(stored.state,'failed');assert.equal(stored.lease_id,null);assert.deepEqual(stored.stages,{},'No provider submission intent was invented');
    assert.deepEqual(stored.document.stageFailures,{tripo:scenario.code,worldlabs:scenario.code,...(photoIntent==='place'?{'tripo-reference':scenario.code}:{})});
    if(scenario.invalidBytes)assert.equal(stored.document.photoSafety,undefined,'Invalid bytes cannot acquire a moderation proof');
    else{
      assert.equal(stored.document.photoSafety.decision,scenario.decision);
      assert.equal(stored.document.photoSafety.results[0].id,'original');
      assert.equal(stored.document.photoSafety.results[0].sha256,hash(png));
    }
    const before=f.journal.length,dto=await f.service().advance(out.id,token);
    assert.equal(dto.state,'failed');assert.equal(dto.story,'My exact story');assert.equal(dto.title,'A real memory');
    for(const stage of['tripo','worldlabs',...(photoIntent==='place'?['tripoReference']:[])]){
      assert.equal(dto[stage].state,'failed');assert.equal(dto[stage].errorCode,scenario.code);assert.equal(dto[stage].taskId,undefined);
    }
    assert.deepEqual(dto.assets,{photoUrl:'',modelUrl:undefined,worldUrl:undefined,panoramaUrl:undefined,tripoInputUrl:undefined,colliderUrl:undefined});
    assert.equal(f.journal.some(([kind])=>['begin','providerUpload','submit','credit','signRead'].includes(kind)),false);
    assert.equal(f.journal.slice(before).some(([kind])=>['claim','moderate','download'].includes(kind)),false,'Advancing a rejected gift never retries its photo check or any provider');
    await rejectCode(f.service().get({id:out.id,token:otherToken}),'JOB_UNAVAILABLE');
  }
});
test('individual photo denials override an inconsistent aggregate allow without signing inputs or starting providers',async()=>{
  for(const scenario of[
    {decision:'block',category:'sexual',code:'PHOTO_SAFETY_BLOCKED',effectiveDecision:'block'},
    {decision:'review',category:'uncertain',code:'PHOTO_SAFETY_REVIEW_REQUIRED',effectiveDecision:'review'},
    {decision:'allow',category:'uncertain',code:'PHOTO_SAFETY_REVIEW_REQUIRED',effectiveDecision:'review'},
  ]){
    const moderationReport=images=>({...report(images),results:report(images).results.map(result=>({...result,decision:scenario.decision,category:scenario.category}))});
    const f=fixture({moderationReport}),out=await f.queued();await f.service().tick('worker',out.id);
    const stored=f.jobs.get(out.id);assert.equal(stored.document.photoSafety.decision,scenario.effectiveDecision);
    assert.equal(stored.document.photoSafety.results[0].decision,scenario.decision);assert.equal(stored.document.photoSafety.results[0].category,scenario.category);
    const dto=await f.service().get({id:out.id,token});assert.equal(dto.assets.photoUrl,'');
    for(const provider of['tripo','worldlabs']){assert.equal(dto[provider].state,'failed');assert.equal(dto[provider].errorCode,scenario.code);}
    assert.equal(f.journal.some(([kind])=>['begin','credit','providerUpload','submit','signRead'].includes(kind)),false);
    // Even a legacy contradictory receipt, regardless of terminal state, cannot
    // authorize signed URLs merely through its aggregate decision.
    stored.document.photoSafety.decision='allow';stored.state='processing';
    assert.equal((await f.service().get({id:out.id,token})).assets.photoUrl,'');
    assert.equal(f.journal.some(([kind])=>kind==='signRead'),false);
  }
});
test('moderation proofs require every exact hash and the same named model; malformed proof cannot authorize paid calls',async()=>{const images=[{id:'original',sha256:hash(png),mime:'image/png',bytes:png}];for(const bad of[{...report(images),protocol:'other'},{...report(images),modelVersion:''},{...report(images),results:[]},{...report(images),results:[{...report(images).results[0],sha256:hash(png2)}]},{...report(images),results:[{...report(images).results[0],modelVersion:'other'}]}])assert.throws(()=>verifyCloudSafety(bad,images),error=>error.code==='PHOTO_SAFETY_UNAVAILABLE');const f=fixture({moderationReport:images=>({...report(images),results:[]})}),out=await f.queued();await f.service().tick('worker');assert.equal(f.journal.some(([kind])=>kind==='submit'),false);assert.equal(f.jobs.get(out.id).document.photoSafety,undefined);});
test('full object flow survives a fresh service for every tick, submits each provider once and keeps inputworld separate from generatedworld',async()=>{const f=fixture(),out=await f.queued(input({images:{original:image(png),world:image(png2)}}));for(let i=0;i<6;i++)await f.service().tick(`worker-${i}`);const dto=await f.service().get({id:out.id,token});assert.equal(dto.state,'completed');assert.equal(dto.story,'My exact story');assert.deepEqual(f.journal.filter(([kind])=>kind==='submit').map(([,stage])=>stage),['worldlabs','tripo']);assert.deepEqual(f.journal.filter(([kind])=>kind==='poll').map(([,stage,id])=>[stage,id]),[['tripo','task-tripo'],['worldlabs','task-worldlabs']]);assert.match(dto.assets.worldUrl,/generated\//);assert.match(f.jobs.get(out.id).assets.world.path,/input\/world-/);assert.notEqual(f.jobs.get(out.id).assets.world.path,f.jobs.get(out.id).assets['generated-world'].path);assert.deepEqual(dto.generation.worldlabs.worldSemantics,{metricScaleFactor:2.9049978,groundPlaneOffset:1.6893421});assert.equal('lease_id'in dto,false);assert.equal('document'in dto,false);assert.equal('expires_at'in dto,false);const before=f.journal.length;await f.service().get({id:out.id,token});assert.equal(f.journal.slice(before).some(([kind])=>['submit','poll','claim'].includes(kind)),false);});
test('place flow separately moderates its generated miniature before the model POST',async()=>{const f=fixture(),out=await f.queued(input({photoIntent:'place'}));for(let i=0;i<9;i++)await f.service().tick(`worker-${i}`);const submissions=f.journal.filter(([kind])=>kind==='submit').map(([,stage])=>stage);assert.deepEqual(submissions,['tripo-reference','worldlabs','tripo']);const derived=f.journal.findIndex(([kind,ids])=>kind==='moderate'&&ids.length===1&&ids[0]==='object'),model=f.journal.findIndex(([kind,stage])=>kind==='submit'&&stage==='tripo');assert.ok(derived>=0&&derived<model);assert.equal((await f.service().get({id:out.id,token})).state,'completed');assert.equal(f.journal.filter(([kind])=>kind==='moderate').length,2);});
test('Kyoto catalog keeps its context and original while normal generation screens a new miniature before its model',async()=>{
  const example=INSTANT_EXAMPLES.find(value=>value.id==='kyoto');assert.equal(example.objectImageUrl,undefined);assert.equal(example.objectImageRole,undefined);
  const f=fixture(),out=await f.queued(input({photoIntent:example.photoIntent,exampleId:example.id,title:example.title,worldPrompt:example.worldPrompt,story:example.story}));
  const prepared=f.jobs.get(out.id);assert.equal(prepared.document.needsReference,true);assert.equal(prepared.document.exampleId,'kyoto');
  assert.deepEqual(prepared.document.images.map(value=>value.id),['original']);assert.equal(prepared.document.generation.worldlabs.contextSource,'catalog-selection');
  assert.equal(prepared.document.generation.tripoReference.model,'chat_image_2');
  for(let index=0;index<9;index++)await f.service().tick(`worker-${index}`,out.id);
  const dto=await f.service().get({id:out.id,token});assert.equal(dto.state,'completed');assert.equal(dto.story,example.story);assert.equal(dto.title,example.title);
  assert.equal(dto.tripoReference.state,'completed');assert.equal(f.jobs.get(out.id).assets.original.sha256,hash(png));
  assert.equal(f.jobs.get(out.id).document.photoSafety.decision,'allow');assert.equal(f.jobs.get(out.id).document.objectSafety.decision,'allow');
  assert.deepEqual(f.journal.filter(([kind])=>kind==='moderate').map(([,ids])=>ids),[['original'],['object']]);
  const screen=f.journal.findIndex(([kind,ids])=>kind==='moderate'&&ids[0]==='object'),submit=f.journal.findIndex(([kind,stage])=>kind==='submit'&&stage==='tripo');
  assert.ok(screen>=0&&screen<submit);assert.deepEqual(f.journal.filter(([kind])=>kind==='submit').map(([,stage])=>stage),['tripo-reference','worldlabs','tripo']);
  assert.equal(f.journal.find(([kind,provider])=>kind==='providerUpload'&&provider==='worldlabs')[2],hash(png),'The world still uses the original photograph');
});
test('known insufficient credits persist before submission, never retry the failed stage, and retain the sibling task and original memory',async()=>{
  for(const scenario of[{photoIntent:'object',provider:'worldlabs',failedStage:'worldlabs',sibling:'tripo'},{photoIntent:'object',provider:'tripo',failedStage:'tripo',sibling:'worldlabs'},{photoIntent:'place',provider:'tripo',failedStage:'tripo-reference',sibling:'worldlabs'}]){
    const f=fixture({creditProvider:scenario.provider,creditError:new AppError('PROVIDER_INSUFFICIENT_CREDITS',403)}),out=await f.queued(input({photoIntent:scenario.photoIntent}));
    await f.service().advance(out.id,token);
    if(scenario.failedStage==='tripo')await f.service().advance(out.id,token);
    const existingTask=f.jobs.get(out.id).stages[scenario.sibling]?.taskId;
    const failed=await f.service().advance(out.id,token),failedDTO=scenario.failedStage==='tripo-reference'?failed.tripoReference:failed[scenario.failedStage];
    assert.equal(failedDTO.state,'failed');assert.equal(failedDTO.errorCode,'PROVIDER_INSUFFICIENT_CREDITS');assert.equal(failedDTO.taskId,undefined);
    assert.equal(f.jobs.get(out.id).stages[scenario.failedStage],undefined,'No durable paid intent or invented task before credit approval');
    if(scenario.failedStage==='tripo-reference'){assert.equal(failed.tripo.state,'failed');assert.equal(failed.tripo.errorCode,'PROVIDER_INSUFFICIENT_CREDITS');}
    if(existingTask)assert.equal(failed[scenario.sibling].taskId,existingTask);
    for(let i=0;i<6;i++)await f.service().advance(out.id,token);
    const final=await f.service().get({id:out.id,token});assert.equal(final.state,'partial');assert.equal(final[scenario.sibling].state,'completed');assert.equal(final.story,'My exact story');assert.equal(final.dedication,'For you');assert.match(final.assets.photoUrl,/input\/original-/);
    assert.equal(f.journal.filter(([kind,provider])=>kind==='credit'&&provider===scenario.provider).length,1);
    assert.deepEqual(f.journal.filter(([kind])=>kind==='submit').map(([,stage])=>stage),[scenario.sibling]);
    assert.equal(f.journal.some(([kind,provider])=>kind==='providerUpload'&&provider===scenario.provider),false);
    if(existingTask)assert.equal(final[scenario.sibling].taskId,existingTask);
  }
});
test('blocked generated miniature never reaches model POST while safe world can finish partial',async()=>{const f=fixture({moderationReport:images=>report(images,images[0].id==='object'?'block':'allow')}),out=await f.queued(input({photoIntent:'place'}));for(let i=0;i<9;i++)await f.service().tick(`worker-${i}`);assert.equal(f.journal.some(([kind,stage])=>kind==='submit'&&stage==='tripo'),false);assert.equal(f.jobs.get(out.id).assets.reference,undefined);const dto=await f.service().get({id:out.id,token});assert.equal(dto.state,'partial');assert.equal(dto.tripo.state,'failed');});
test('unknown paid submission remains reserved and cannot resubmit after a process restart',async()=>{const f=fixture({submitError:new AppError('SUBMISSION_AMBIGUOUS',502)}),out=await f.queued();await f.service().tick('moderate');await f.service().tick('submit');for(let i=0;i<3;i++)await f.service().tick('restart');assert.equal(f.jobs.get(out.id).state,'submission_uncertain');assert.equal(f.journal.filter(([kind])=>kind==='submit').length,1);assert.equal((await f.service().get({id:out.id,token})).worldlabs.errorCode,'SUBMISSION_AMBIGUOUS');});
test('uncertain sibling never starves polling of a recorded task and never starts an absent stage',async()=>{const f=fixture(),out=await f.queued();await f.service().tick('moderate');const job=f.jobs.get(out.id);job.state='submission_uncertain';job.stages={'tripo-reference':{state:'submission_uncertain',submittedAt:'now'},worldlabs:{state:'processing',taskId:'known-world',progress:20}};await f.service().advance(out.id,token);assert.deepEqual(f.journal.filter(([kind])=>kind==='poll').map(([,stage,id])=>[stage,id]),[['worldlabs','known-world']]);assert.equal(f.journal.some(([kind])=>kind==='submit'||kind==='providerUpload'),false);assert.equal(f.jobs.get(out.id).state,'submission_uncertain');});
test('parallel invocations share the persistent lease and submit a stage once',async()=>{const f=fixture(),out=await f.queued();await f.service().tick('moderate');await Promise.all([f.service().advance(out.id,token),f.service().advance(out.id,token)]);assert.equal(f.journal.filter(([kind])=>kind==='submit').length,1);assert.equal(f.jobs.get(out.id).stages.worldlabs.taskId,'task-worldlabs');});
test('known task polling retries network failures without replacing ID or repeating POST; moderate checks never invent a floor transform',async()=>{const f=fixture({pollError:new AppError('PROVIDER_NETWORK',502),semantics:{metricScaleFactor:1000,groundPlaneOffset:NaN}}),out=await f.queued();await f.service().tick('moderate');await f.service().tick('world');await f.service().tick('model');const id=f.jobs.get(out.id).stages.tripo.taskId;await f.service().tick('network');assert.equal(f.jobs.get(out.id).stages.tripo.taskId,id);assert.equal(f.journal.filter(([kind])=>kind==='submit').length,2);const job=f.jobs.get(out.id);job.document.worldSemantics={metricScaleFactor:1000,groundPlaneOffset:0};assert.equal((await f.service().get({id:out.id,token})).generation.worldlabs.worldSemantics,undefined);});
test('disabled generation, unavailable moderation and unconfigured database close create but retain example catalog',async()=>{for(const options of[{enabled:false},{moderatorConfigured:false},{canCreate:false}]){const f=fixture(options),status=await f.service().status();assert.equal(status.storage,'cloud');assert.equal(status.localOnly,false);assert.equal(status.available,false);assert.ok(status.examples.length>=3);if(options.enabled===false||options.moderatorConfigured===false)await rejectCode(f.service().prepare(input(),'c'.repeat(64)),'GENERATION_PAUSED');assert.equal(f.journal.some(([kind])=>kind==='submit'),false);}});
test('uncapped creation status retains ledger totals while upload recovery remains free of generation work',async()=>{
  const f=fixture(),out=await f.prepared();
  f.repository.status=async()=>({canCreate:true,budget:{tripo:{committed:10000,nextReservation:100},worldlabs:{committed:100000,nextReservation:1580}}});
  const status=await f.service().status();assert.equal(status.available,true);assert.equal(status.budget.canCreate,true);assert.equal(status.limits,undefined);assert.equal(status.budget.tripo.committed,10000);
  assert.equal((await f.service().get({id:out.id,token})).uploadState,'pending');assert.equal((await f.service().finalize(out.id,token)).uploadState,'finalized');
  assert.equal(f.jobs.size,1);assert.equal(f.journal.filter(([kind])=>kind==='prepare').length,1);assert.equal(f.journal.some(([kind])=>['submit','providerUpload','credit','claim','moderate'].includes(kind)),false);
  f.repository.status=async()=>{throw Error('private database details');};const closed=await f.service().status();assert.equal(closed.available,false);assert.ok(!JSON.stringify(closed).includes('private'));
});
test('generated outputs cannot exceed the reserved100MiB before any storage write',async()=>{const f=fixture(),out=await f.queued();await f.service().tick('moderate');await f.service().tick('world');await f.service().tick('model');const job=f.jobs.get(out.id);job.assets['generated-world']={id:'generated-world',path:`${out.id}/generated/${'c'.repeat(64)}.spz`,mime:'application/octet-stream',bytes:100*1024*1024,sha256:'c'.repeat(64)};const stored=f.journal.filter(([kind])=>kind==='store').length;await f.service().tick('model-complete');assert.equal(f.journal.filter(([kind])=>kind==='store').length,stored);assert.equal(f.jobs.get(out.id).stages.tripo.state,'failed');assert.equal(f.jobs.get(out.id).stages.tripo.errorCode,'GENERATED_ASSET_SIZE_LIMIT');assert.equal(f.journal.filter(([kind])=>kind==='submit').length,2);});
