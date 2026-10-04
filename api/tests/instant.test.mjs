import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import ts from 'typescript';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
async function moduleURL(path, replacements = {}) {
 let js = ts.transpileModule(await readFile(resolve(root, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
 for (const [from, to] of Object.entries(replacements)) js = js.replaceAll(`'${from}'`, JSON.stringify(to));
 return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
}
const rulesURL = await moduleURL('api/_lib/rules.ts');
const providersURL = await moduleURL('api/_lib/providers.ts', { './rules.js': rulesURL });
const safetyURL = await moduleURL('api/_lib/image-safety.ts', { './rules.js': rulesURL });
const curiositiesURL=await moduleURL('shared/gift-curiosities.ts');
const examplesURL=await moduleURL('shared/instant-examples.ts');
const examples=await import(examplesURL);
const budgetURL=await moduleURL('api/_lib/quality-trial-budget.ts',{'./rules.js':rulesURL});
const artStyleURL=await moduleURL('shared/gift-art-style.ts');
const cloudRecipesURL=await moduleURL('api/_lib/cloud-instant-recipes.ts',{'../../shared/gift-art-style.js':artStyleURL});
const instantURL = await moduleURL('api/_lib/instant.ts', { './rules.js': rulesURL, './providers.js': providersURL, './image-safety.js': safetyURL,'./quality-trial-budget.js':budgetURL,'./cloud-instant-recipes.js':cloudRecipesURL,'../../shared/gift-curiosities.js':curiositiesURL,'../../shared/instant-examples.js':examplesURL,'../../shared/gift-art-style.js':artStyleURL });
const i = await import(instantURL);
const safetyModule=await import(safetyURL);
// All provider calls are injected. Tests never load credentials or reach the network.
globalThis.fetch = async () => { throw Error('NETWORK_DISABLED_IN_TESTS'); };
const settings = () => ({ enabled: true, providers: { tripo: true, worldlabs: true }, worldModel: 'marble-1.1', tripoBudget: 1500, worldBudget: 10000 });
const image = await readFile(resolve(root, 'public/demo/perdizes-input.png'));
const token = () => randomBytes(32).toString('base64url');
const input = (extra = {}) => ({ title: 'A gift from Rio', worldPrompt: 'A quiet terrace in Rio overlooking Guanabara Bay at sunset.', story: 'A small memory to carry home.', dedication: 'For you.', senderName: 'Ana', recipientName: 'Leo', imageDataUrl: 'data:image/png;base64,' + image.toString('base64'), consent: true, dedupeKey: token(), requestToken: token(), ...extra });
const asset = (suffix, kind, mime, bytes) => ({ suffix, kind, mime, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
const testSafety={status:async()=>({available:true,localOnly:true,protocol:safetyModule.IMAGE_SAFETY_PROTOCOL,modelVersion:'synthetic-test-only'}),screen:async images=>({protocol:safetyModule.IMAGE_SAFETY_PROTOCOL,checkedAt:new Date().toISOString(),modelVersion:'synthetic-test-only',decision:'allow',results:images.map(image=>({id:image.id,sha256:createHash('sha256').update(image.bytes).digest('hex'),decision:'allow',category:'ordinary',modelVersion:'synthetic-test-only',scores:{sexual:0,adultProduct:0},objectHint:'bird',objectConfidence:0.8}))})};
async function fixture(t, overrides = {}) {
 const directory = await mkdtemp(join(tmpdir(), 'giftportals-instant-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
 const calls = [];
 const service = i.createInstantService({ directory, settings,safety:testSafety,
  credit: async (...args) => { calls.push(['credit', ...args]); },
  upload: async (...args) => { calls.push(['upload', args[0], args[2]]); return args[0] === 'tripo' ? 'file_test' : 'media_test'; },
  json: async (provider, path, method = 'GET', body) => { calls.push([provider, path, method, body]); if (method === 'POST') return provider === 'tripo' ? { task_id: 'tripo_task' } : { operation_id: 'world_operation' }; return provider === 'tripo' ? { status: 'success', progress: 100 } : { done: true }; },
  complete: async provider => provider === 'tripo'
   ? { cost: 30, assets: [asset('glb', 'model', 'model/gltf-binary', Buffer.from('synthetic-glb'))] }
   : { cost: 1580, assets: [asset('spz', 'world', 'application/octet-stream', Buffer.from('synthetic-spz')), asset('pano', 'world', 'image/png', image)] },
  ...overrides });
 return { service, calls, directory };
}
test('local settings ignore legacy artificial credit caps, including stale invalid values',()=>{
 const keys=['LOCAL_WORLDLABS_CREDIT_CAP','LOCAL_TRIPO_CREDIT_CAP'],saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{
  for(const value of [undefined,'1','0','NaN','1000',String(Number.MAX_SAFE_INTEGER+1)]){
   for(const key of keys)if(value===undefined)delete process.env[key];else process.env[key]=value;
   const config=i.instantSettings();assert.equal(config.worldBudget,undefined);assert.equal(config.tripoBudget,undefined);
  }
 }finally{for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
});
test('status accounts for pending reservations and settled costs without artificial availability ceilings',async t=>{
 const {service,calls}=await fixture(t,{settings:()=>({...settings(),worldBudget:1,tripoBudget:1}),complete:async()=>null});
 let status=await service.status();assert.equal(status.available,true);assert.deepEqual(status.budget.worldlabs,{committed:0,nextReservation:1580});assert.equal(calls.length,0);
 const first=await service.create(input());await service.get(first.id,first.token);status=await service.status();assert.equal(status.available,true);assert.equal(status.budget.canCreate,true);assert.equal(status.budget.worldlabs.committed,1580);assert.equal(status.budget.worldlabs.remaining,undefined);
 const second=await service.create(input());await service.get(second.id,second.token);assert.equal(calls.filter(call=>call[2]==='POST').length,4);
 const completed=await fixture(t),started=await completed.service.create(input());await completed.service.get(started.id,started.token);
 status=await completed.service.status();assert.equal(status.budget.tripo.committed,30);assert.equal(status.budget.worldlabs.committed,1580);assert.equal(status.available,true);
});
test('local route rejects external host, peer, mismatched origin and cross-site browser POST', () => {
 const check = extra => i.assertLocalInstantRequest({ method: 'POST', headers: { host: '127.0.0.1:4325', origin: 'http://127.0.0.1:4325', 'sec-fetch-site': 'same-origin', ...extra } });
 check({});
 for (const extra of [{ host: 'evil.invalid' }, { origin: 'http://evil.invalid' }, { 'sec-fetch-site': 'cross-site' }, { origin: undefined }]) assert.throws(() => check(extra), e => ['ORIGIN_DENIED', 'LOCAL_GENERATION_ONLY'].includes(e.code));
 assert.throws(() => i.assertLocalInstantRequest({ headers: { host: 'localhost:4325' }, socket: { remoteAddress: '10.0.0.2' } }), e => e.code === 'LOCAL_GENERATION_ONLY');
 i.assertLocalInstantRequest({ method: 'POST', headers: { host: 'localhost:4325' } });
});
test('image ingestion validates MIME, decoded bytes and exact base64 before upload', () => {
 assert.equal(i.parseInstantImage(input().imageDataUrl).bytes.length, image.length);
 for (const value of ['data:image/png;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,AA==', 'https://127.0.0.1/private', 'data:image/png;base64,AAAA=']) assert.throws(() => i.parseInstantImage(value));
 assert.throws(() => i.parseInstantImage('data:image/png;base64,' + 'A'.repeat(i.MAX_INSTANT_IMAGE_BYTES * 4 / 3 + 100)), e => e.code === 'IMAGE_SIZE_LIMIT');
});
test('generation requires enabled providers and explicit consent without issuing any calls', async t => {
 const paused = await fixture(t, { settings: () => ({ ...settings(), enabled: false }) });
 await assert.rejects(() => paused.service.create(input()), e => e.code === 'GENERATION_PAUSED'); assert.equal(paused.calls.length, 0);
 const running = await fixture(t); await assert.rejects(() => running.service.create(input({ consent: false })), e => e.code === 'GENERATION_CONSENT_REQUIRED'); assert.equal(running.calls.length, 0);
});
test('photo creates actual Tripo and standard World Labs requests, publishes protected assets and costs', async t => {
 const { service, calls, directory } = await fixture(t); const source = input(), started = await service.create(source);
 const job = await service.get(started.id, started.token); assert.equal(job.state, 'completed');
 assert.equal(job.title, source.title); assert.equal(job.dedication, 'For you.'); assert.equal(job.tripo.credits, 30); assert.equal(job.worldlabs.credits, 1580);
 const posts = calls.filter(call => call[2] === 'POST'); assert.equal(posts.length, 2);
 assert.equal(posts[0][3].input, 'file_test'); assert.equal(posts[0][3].texture, true); assert.equal(posts[0][3].texture_quality, 'detailed'); assert.equal(posts[0][3].geometry_quality, 'detailed'); assert.equal(posts[0][3].face_limit, 30000); assert.equal(posts[1][3].model, 'marble-1.1'); assert.equal(posts[1][3].permission.public, false);
 assert.equal(job.generation.tripo.orientation, 'align_image'); assert.equal(job.generation.worldlabs.model, 'marble-1.1');
 assert.match(posts[1][3].world_prompt.text_prompt, /Guanabara Bay/); assert.equal(posts[1][3].world_prompt.type, 'text');
 for (const key of ['photoUrl', 'modelUrl', 'worldUrl', 'panoramaUrl']) assert.match(job.assets[key], /action=asset.*token=/);
 const model = await service.asset(job.id, job.token, 'model'); assert.equal(model.mime, 'model/gltf-binary');
 await assert.rejects(() => service.asset(job.id, token(), 'model'), e => e.code === 'JOB_UNAVAILABLE');
 await assert.rejects(() => service.asset(job.id, job.token, '../job.json'), e => e.code === 'ASSET_UNAVAILABLE');
 const saved = await readFile(join(directory, job.id, 'job.json'), 'utf8'); assert.ok(!saved.includes(job.token)); assert.match(saved, /tokenHash/);
});
test('same capability and dedupe key recover an interrupted response without a duplicate paid POST', async t => {
 const { service, calls } = await fixture(t); const source = input();
 const [first, duplicate] = await Promise.all([service.create(source), service.create(source)]);
 assert.equal(first.id, duplicate.id); assert.equal(first.token, source.requestToken);
 await service.get(first.id, first.token); const resumed = await service.create(source); assert.equal(resumed.id, first.id);
 const byRequest = await service.resume(source.dedupeKey, source.requestToken); assert.equal(byRequest.id, first.id);
 assert.equal(calls.filter(call => call[2] === 'POST').length, 2);
 await assert.rejects(() => service.create({ ...source, title: 'Changed title' }), e => e.code === 'DEDUPE_MISMATCH');
 await assert.rejects(() => service.create({ ...source, requestToken: token() }), e => e.code === 'JOB_UNAVAILABLE');
});

test('recovery waits for an accepted create that is still screening before reporting absence', async t => {
 let release, entered;
 const gate = new Promise(resolve => { release = resolve; }), screening = new Promise(resolve => { entered = resolve; });
 const { service, calls } = await fixture(t, { safety: { ...testSafety, screen: async images => { entered(); await gate; return testSafety.screen(images); } } });
 t.after(() => release());
 const source = input(), creation = service.create(source);
 await screening;
 let settled = false;
 const recovery = service.resume(source.dedupeKey, source.requestToken).finally(() => { settled = true; });
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(settled, false); assert.equal(calls.length, 0);
 release();
 const [created, recovered] = await Promise.all([creation, recovery]);
 assert.equal(recovered.id, created.id);
 assert.equal(calls.filter(call => call[2] === 'POST').length, 2);
});

test('recovery reports absence after the accepted create has terminally rejected', async t => {
 let release, entered;
 const gate = new Promise(resolve => { release = resolve; }), screening = new Promise(resolve => { entered = resolve; });
 const { service, calls } = await fixture(t, { safety: { ...testSafety, screen: async images => { entered(); await gate; const report = await testSafety.screen(images); return { ...report, decision: 'block', results: report.results.map(result => ({ ...result, decision: 'block', category: 'adult-product' })) }; } } });
 t.after(() => release());
 const source = input(), creation = assert.rejects(service.create(source), error => error.code === 'PHOTO_SAFETY_BLOCKED');
 await screening;
 const recovery = assert.rejects(service.resume(source.dedupeKey, source.requestToken), error => error.code === 'JOB_UNAVAILABLE');
 release(); await Promise.all([creation, recovery]); assert.equal(calls.length, 0);
});
test('place reference is uploaded separately and combined with world text; original object stays Tripo input', async t => {
 const { service, calls } = await fixture(t); const source = input({ worldImageDataUrl: input().imageDataUrl });
 const first = await service.create(source); const job = await service.get(first.id, first.token); assert.equal(job.state, 'completed', JSON.stringify({tripo:job.tripo,worldlabs:job.worldlabs}));
 assert.deepEqual(calls.filter(call => call[0] === 'upload').map(call => call[1]), ['tripo', 'worldlabs']);
 const world = calls.find(call => call[0] === 'worldlabs' && call[2] === 'POST')[3].world_prompt;
 assert.equal(world.type, 'image'); assert.equal(world.image_prompt.media_asset_id, 'media_test'); assert.match(world.text_prompt, /Guanabara/);
 assert.equal(world.is_pano,false);assert.equal(world.disable_recaption,true);
});
test('V13 status exposes the same ten examples as the UI and returns independent catalog arrays',async t=>{
 const {service}=await fixture(t),status=await service.status();
 assert.deepEqual(status.examples.map(example=>example.id),examples.INSTANT_EXAMPLES.map(example=>example.id));
 assert.equal(status.examples.length,10);assert.equal(status.examples.filter(example=>example.photoIntent==='place').length,5);
 for(const example of status.examples)assert.match(example.imageUrl,/^\/assets\/examples\/v13\/[a-z-]+\.jpg$/);
 status.examples[0].title='tampered';status.examples[0].curiosityIds.push('tampered');
 const again=await service.status();assert.notEqual(again.examples[0].title,'tampered');assert.ok(!again.examples[0].curiosityIds.includes('tampered'));
});
test('V13 Paris preserves original scene and derivative routing with exact composed prompt receipt',async t=>{
 const example=examples.INSTANT_EXAMPLES.find(example=>example.id==='paris'),original=await readFile(resolve(root,'public'+example.imageUrl)),derivative=await readFile(resolve(root,'public/assets/examples/v13/rio.jpg')),uploads=[];
 const {service,calls}=await fixture(t,{upload:async(provider,bytes,mime)=>{uploads.push({provider,sha:createHash('sha256').update(bytes).digest('hex'),mime});return provider==='tripo'?'file_test':'media_test';}});
 const source=input({exampleId:example.id,photoIntent:'place',worldPrompt:example.worldPrompt,imageDataUrl:'data:image/jpeg;base64,'+original.toString('base64'),objectImageDataUrl:'data:image/jpeg;base64,'+derivative.toString('base64'),objectImageRole:'miniature-reference'});
 const started=await service.create(source),job=await service.get(started.id,started.token),world=calls.find(call=>call[0]==='worldlabs'&&call[2]==='POST')[3].world_prompt;
 assert.equal(job.exampleId,'paris');assert.equal(job.photoIntent,'place');assert.equal(job.objectRepresentation,'souvenir-miniature');
 assert.deepEqual(uploads.map(upload=>upload.provider),['tripo','worldlabs']);assert.equal(uploads[0].sha,createHash('sha256').update(derivative).digest('hex'));assert.equal(uploads[1].sha,createHash('sha256').update(original).digest('hex'));
 assert.deepEqual((await service.asset(job.id,job.token,'photo')).bytes,original);
 assert.equal(world.type,'image');assert.equal(world.is_pano,false);assert.equal(world.disable_recaption,true);assert.equal(world.image_prompt.source,'media_asset');
 assert.equal(job.generation.worldlabs.promptVersion,i.WORLD_COMPOSITION_VERSION);assert.equal(job.generation.worldlabs.textPrompt,world.text_prompt);assert.equal(job.generation.worldlabs.contextSource,'catalog-selection');
 for(const text of [example.title,'Foreground:','Middle distance:','Background:','continuous, level floor','illustrative artistic interpretation','does not authenticate'])assert.ok(world.text_prompt.includes(text),text);
 assert.ok(world.text_prompt.includes(example.worldPrompt));assert.equal(job.generation.worldlabs.isPano,false);assert.equal(job.generation.worldlabs.disableRecaption,true);
});
test('V13 historical object uses Tripo photo and a rich imagined text environment without fake image-to-model fields',async t=>{
 const example=examples.INSTANT_EXAMPLES.find(example=>example.id==='antikythera'),original=await readFile(resolve(root,'public'+example.imageUrl));
 const {service,calls}=await fixture(t),started=await service.create(input({exampleId:example.id,worldPrompt:example.worldPrompt,imageDataUrl:'data:image/jpeg;base64,'+original.toString('base64')})),job=await service.get(started.id,started.token);
 const tripo=calls.find(call=>call[0]==='tripo'&&call[2]==='POST')[3],world=calls.find(call=>call[0]==='worldlabs'&&call[2]==='POST')[3].world_prompt;
 assert.deepEqual(calls.filter(call=>call[0]==='upload').map(call=>call[1]),['tripo']);assert.equal(world.type,'text');assert.equal(world.image_prompt,undefined);assert.equal(world.is_pano,undefined);
 assert.equal(tripo.face_limit,30000);assert.equal(tripo.pbr,true);assert.equal(tripo.texture_quality,'detailed');assert.equal(tripo.geometry_quality,'detailed');assert.equal(tripo.prompt,undefined);assert.equal(tripo.text_prompt,undefined);
 assert.equal(job.generation.worldlabs.textPrompt,world.text_prompt);assert.match(world.text_prompt,/small keepsake/);assert.match(world.text_prompt,/photo is not a scene reference/);assert.match(world.text_prompt,/does not authenticate/);
 assert.deepEqual((await service.asset(job.id,job.token,'photo')).bytes,original);
});
test('V13 example metadata cannot bypass safety and changing selected context cannot reuse a paid request',async t=>{
 let screens=0;const {service,calls,directory}=await fixture(t,{safety:{...testSafety,screen:async images=>{screens++;return testSafety.screen(images);}}});
 await assert.rejects(()=>service.create(input({exampleId:'unlisted'})),error=>error.code==='EXAMPLE_ID_INVALID');assert.equal(screens,0);assert.equal(calls.length,0);assert.deepEqual(await readdir(directory),[]);
 const source=input({exampleId:'antikythera'}),started=await service.create(source);await service.get(started.id,started.token);assert.equal(screens,1);
 await assert.rejects(()=>service.create({...source,exampleId:'astrolabe'}),error=>error.code==='DEDUPE_MISMATCH');assert.equal(calls.filter(call=>call[2]==='POST').length,2);
 const personal=i.composeInstantWorldPrompt({worldPrompt:'A workshop filled with brass and warm afternoon light.',photoIntent:'object',hasPlaceReference:false});assert.match(personal,/user-provided creative direction/);assert.match(personal,/no claim of precise geographic reconstruction/);
});
test('ambiguous paid response stays failed after restart and polling never re-submits', async t => {
 let posts = 0;
 const { service, directory } = await fixture(t, { json: async (provider, path, method = 'GET') => {
  if (method === 'POST') { posts++; if (provider === 'tripo') throw Error('Lost provider response'); return { operation_id: 'world_operation' }; }
  return { done: false };
 }, complete: async () => null });
 const first = await service.create(input()), job = await service.get(first.id, first.token);
 assert.equal(job.tripo.state, 'failed'); assert.equal(job.tripo.errorCode, 'SUBMISSION_AMBIGUOUS'); assert.equal(posts, 2);
 const restarted = i.createInstantService({ directory, settings, json: async (provider, path, method = 'GET') => { assert.equal(method, 'GET'); return { done: false }; }, complete: async () => null });
 const recovered = await restarted.get(first.id, first.token); assert.equal(recovered.tripo.errorCode, 'SUBMISSION_AMBIGUOUS'); assert.equal(posts, 2);
});
test('local creation accepts requests beyond active capacity and starts the persisted queue without exceeding concurrency',async t=>{
 const {service,calls,directory}=await fixture(t,{settings:()=>({...settings(),worldBudget:1,tripoBudget:1}),complete:async()=>null});
 const first=await service.create(input()),second=await service.create(input()),thirdInput=input(),third=await service.create(thirdInput);
 await service.get(first.id,first.token);await service.get(second.id,second.token);await service.get(third.id,third.token);
 assert.equal(calls.filter(call=>call[2]==='POST').length,4);assert.deepEqual((await service.status()).queue,{active:2,waiting:1,concurrency:2});
 const replay=await service.create(thirdInput);assert.equal(replay.id,third.id);assert.equal(calls.filter(call=>call[2]==='POST').length,4);
 await assert.rejects(()=>service.get(third.id,token()),error=>error.code==='JOB_UNAVAILABLE');
 const path=join(directory,first.id,'job.json'),stored=JSON.parse(await readFile(path,'utf8'));stored.state='completed';stored.tripo.state='completed';stored.worldlabs.state='completed';await writeFile(path,JSON.stringify(stored));
 const ready=await service.get(third.id,third.token);assert.equal(ready.tripo.state,'processing');assert.equal(ready.worldlabs.state,'processing');assert.equal(calls.filter(call=>call[2]==='POST').length,6);
 assert.deepEqual((await service.status()).queue,{active:2,waiting:0,concurrency:2});
});
test('completed history beyond the former 24-job lifetime ceiling cannot block a new local gift',async t=>{
 const {service,calls,directory}=await fixture(t),first=await service.create(input());await service.get(first.id,first.token);
 const stored=JSON.parse(await readFile(join(directory,first.id,'job.json'),'utf8'));
 for(let index=0;index<24;index++){const id=`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;await (await import('node:fs/promises')).mkdir(join(directory,id));await writeFile(join(directory,id,'job.json'),JSON.stringify({...stored,id,dedupeHash:`history-${index}`}));}
 assert.equal((await service.status()).available,true);const next=await service.create(input());await service.get(next.id,next.token);assert.equal(calls.filter(call=>call[2]==='POST').length,4);
});
test('independent local services share two execution slots while every distinct creation remains accepted',async t=>{
 const f=await fixture(t,{complete:async()=>null});
 const peer=i.createInstantService({directory:f.directory,settings,safety:testSafety,credit:async()=>{},upload:async()=> 'peer-file',json:async(provider,path,method='GET')=>{f.calls.push([provider,path,method]);return method==='POST'?(provider==='tripo'?{task_id:'peer-model'}:{operation_id:'peer-world'}):{};},complete:async()=>null});
 const [one,two,three,four]=await Promise.all([f.service.create(input()),peer.create(input()),f.service.create(input()),peer.create(input())]);
 for(const [service,job]of [[f.service,one],[peer,two],[f.service,three],[peer,four]])await service.get(job.id,job.token);
 assert.deepEqual((await f.service.status()).queue,{active:2,waiting:2,concurrency:2});assert.equal(f.calls.filter(call=>call[2]==='POST').length,4);
});
test('one provider failure leaves the completed gift available with honest partial status', async t => {
 const { service } = await fixture(t, { complete: async provider => {
  if (provider === 'worldlabs') { const e = new Error('Failed'); e.code = 'PROVIDER_GENERATION_FAILED'; throw new (await import(rulesURL)).AppError('PROVIDER_GENERATION_FAILED', 502); }
  return { cost: 30, assets: [asset('glb', 'model', 'model/gltf-binary', Buffer.from('synthetic-glb'))] };
 } });
 const first = await service.create(input()), job = await service.get(first.id, first.token);
 assert.equal(job.state, 'partial'); assert.equal(job.tripo.state, 'completed'); assert.equal(job.worldlabs.state, 'failed'); assert.ok(job.assets.modelUrl); assert.equal(job.assets.worldUrl, undefined);
});
test('collection snapshot authorizes an unfinished local gift without polling, starting providers, reserving credits or rewriting its job', async t => {
 const { service, directory } = await fixture(t);
 const first = await service.create(input()); await service.get(first.id, first.token);
 const path = join(directory, first.id, 'job.json'), stored = JSON.parse(await readFile(path, 'utf8'));
 stored.state = 'processing'; stored.tripo = { state: 'pending', progress: 0 }; stored.worldlabs = { state: 'pending', progress: 0 };
 await writeFile(path, JSON.stringify(stored)); const before = await readFile(path, 'utf8'); let calls = 0;
 const snapshot = i.createInstantService({ directory, settings, safety: testSafety,
  credit: async () => { calls++; throw Error('Snapshot must not reserve credits'); },
  upload: async () => { calls++; throw Error('Snapshot must not upload'); },
  json: async () => { calls++; throw Error('Snapshot must not contact providers'); },
  complete: async () => { calls++; throw Error('Snapshot must not hydrate provider assets'); },
 });
 const gift = await snapshot.snapshot(first.id, first.token);
 assert.equal(gift.state, 'processing'); assert.equal(gift.tripo.state, 'pending'); assert.equal(gift.token, first.token);
 await assert.rejects(snapshot.snapshot(first.id, token()), error => error.code === 'JOB_UNAVAILABLE' && error.status === 404);
 assert.equal(calls, 0); assert.equal(await readFile(path, 'utf8'), before);
});
test('retained service denies missing or wrong capabilities with404 after a constructor reload', async () => {
 const previousRules = await import(rulesURL + '#before-hmr');
 const currentRules = await import(rulesURL);
 assert.notEqual(previousRules.AppError, currentRules.AppError);
 const serviceKey = Symbol.for('giftportals.instant.service'), previousService = globalThis[serviceKey];
 let legacyError = new previousRules.AppError('JOB_UNAVAILABLE', 404, 'private old diagnostic');
 const retainedService = { asset: async () => { throw legacyError; } };
 globalThis[serviceKey] = retainedService;
 try {
  const module = await import(await moduleURL('api/instant.ts', { './_lib/rules.js': rulesURL, './_lib/instant.js': instantURL }));
  assert.equal(module.safeInstantError(legacyError).code,'JOB_UNAVAILABLE');assert.equal(module.safeInstantError(legacyError).status,404);
  for (const query of ['', '&token=wrong']) {
   let body; const res = { statusCode: 0, setHeader() {}, end(value) { body = JSON.parse(value); } };
   await module.default({ method: 'GET', url: '/api/instant?action=asset&id=00000000-0000-0000-0000-000000000000&name=photo' + query, headers: { host: '127.0.0.1:4325' } }, res);
   assert.equal(res.statusCode, 404); assert.equal(body.error.code, 'JOB_UNAVAILABLE'); assert.ok(!body.error.message.includes('private'));
  }
  assert.equal(globalThis[serviceKey], retainedService, 'HMR fix preserves the service and active tasks');
  legacyError = new previousRules.AppError('UNKNOWN_SECRET_CODE', 404, 'provider secret');
  assert.equal(module.safeInstantError(legacyError).code, 'LOCAL_GENERATION_FAILED');
  assert.equal(module.safeInstantError({ code: 'JOB_UNAVAILABLE', status: 404 }).code, 'LOCAL_GENERATION_FAILED');
  assert.equal(module.safeInstantError(new previousRules.AppError('JOB_UNAVAILABLE', 500, 'provider secret')).code, 'LOCAL_GENERATION_FAILED');
 } finally { if (previousService === undefined) delete globalThis[serviceKey]; else globalThis[serviceKey] = previousService; }
});
test('place intent preserves original and routes only explicitly labelled miniature reference to Tripo',async t=>{
 const framed=Buffer.from([255,216,255,225,11,22,33,44]);const uploads=[];
 const {service,directory}=await fixture(t,{upload:async(provider,bytes,mime)=>{uploads.push({provider,bytes,mime});return provider==='tripo'?'framed_file':'original_place';}});
 const source=input({photoIntent:'place',objectImageDataUrl:'data:image/jpeg;base64,'+framed.toString('base64'),objectImageRole:'miniature-reference'});
 const first=await service.create(source),job=await service.get(first.id,first.token);
 assert.equal(job.photoIntent,'place');assert.equal(job.objectRepresentation,'souvenir-miniature');assert.equal(job.generation.worldlabs.reference,'image');
 assert.deepEqual(uploads.find(x=>x.provider==='tripo').bytes,framed);assert.deepEqual(uploads.find(x=>x.provider==='worldlabs').bytes,image);
 assert.deepEqual((await service.asset(job.id,job.token,'photo')).bytes,image);assert.deepEqual((await service.asset(job.id,job.token,'tripo-input')).bytes,framed);
 assert.equal(job.inputProvenance.original.sha256,createHash('sha256').update(image).digest('hex'));assert.equal(job.inputProvenance.tripo.sha256,createHash('sha256').update(framed).digest('hex'));assert.equal(job.inputProvenance.tripoDerived,true);
 assert.match(job.assets.tripoInputUrl,/name=tripo-input/);
 await assert.rejects(()=>service.create({...source,photoIntent:'object'}),e=>e.code==='DEDUPE_MISMATCH');
 const saved=JSON.parse(await readFile(join(directory,job.id,'job.json'),'utf8'));assert.equal(saved.objectPhoto.name,'tripo-input.jpg');assert.equal(saved.worldPhoto.sha256,saved.assets.photo.sha256);
});
test('place intent rejects unlabelled or unchanged derivative before any provider call',async t=>{
 const {service,calls}=await fixture(t);
 await assert.rejects(()=>service.create(input({photoIntent:'place',objectImageDataUrl:input().imageDataUrl})),e=>e.code==='PLACE_OBJECT_IMAGE_ROLE_REQUIRED');
 await assert.rejects(()=>service.create(input({photoIntent:'place',objectImageDataUrl:input().imageDataUrl,objectImageRole:'miniature-reference'})),e=>e.code==='PLACE_OBJECT_IMAGE_INVALID');
 await assert.rejects(()=>service.create(input({photoIntent:'place',objectImageRole:'framed-postcard'})),e=>e.code==='OBJECT_IMAGE_ROLE_INVALID');
 await assert.rejects(()=>service.create(input({photoIntent:'unknown'})),e=>e.code==='PHOTO_INTENT_INVALID');
 assert.equal(calls.length,0);
});

async function souvenirFixture(t,extra={}) {
 const calls=[],referenceImage=Buffer.concat([image,Buffer.from('synthetic-reference')]),referenceCost=extra.referenceCost??10;
 const f=await fixture(t,{json:async(provider,path,method='GET',body,options)=>{
  calls.push([provider,path,method,body,options]);
  if(method==='POST')return provider==='worldlabs'?{operation_id:'world_operation'}:{task_id:path.endsWith('image-to-image')?'reference_task':'model_task'};
  return provider==='worldlabs'?{done:true}:{task_id:path.split('/').at(-1),type:path.endsWith('reference_task')?'image_to_image':'image_to_model',status:'success',progress:100,credits_consumed:path.endsWith('reference_task')?referenceCost:60};
 },reference:async response=>({cost:referenceCost,asset:asset('reference','world','image/png',referenceImage)}),complete:async provider=>provider==='tripo'?{cost:60,assets:[asset('glb','model','model/gltf-binary',Buffer.from('synthetic-glb'))]}:{cost:1580,resultId:'world_result',assets:[asset('spz','world','application/octet-stream',Buffer.from('synthetic-spz'))]},...extra});
 return{...f,posts:calls,referenceImage};
}
test('automatic place creates a sculpted image reference, screens actual bytes, then feeds its task ID to GLB and settles both costs',async t=>{
 const seen=[],f=await souvenirFixture(t,{safety:{...testSafety,screen:async images=>{seen.push(images.map(x=>[x.id,createHash('sha256').update(x.bytes).digest('hex')]));return testSafety.screen(images);}}});
 const source=input({photoIntent:'place'}),first=await f.service.create(source),job=await f.service.get(first.id,first.token);
 assert.equal(job.state,'completed');assert.equal(job.objectRepresentation,'souvenir-miniature');assert.equal(job.tripoReference.credits,10);assert.equal(job.tripo.modelCredits,60);assert.equal(job.tripo.credits,70);
 const posts=f.posts.filter(x=>x[2]==='POST'),reference=posts.find(x=>x[1].endsWith('image-to-image'))[3],model=posts.find(x=>x[1].endsWith('image-to-model'))[3];
 assert.equal(reference.model,'chat_image_2');assert.equal(reference.quality,'medium');assert.equal(reference.size,'1536x1024');assert.equal(reference.output_format,'png');assert.equal(reference.promptVersion,undefined);
 assert.deepEqual(posts.find(x=>x[1].endsWith('image-to-image'))[4],{timeoutMs:120000});assert.equal(posts.find(x=>x[1].endsWith('image-to-model'))[4],undefined);
 for(const detail of ['circular low plinth','hidden back surfaces','EMPTY WHITE SPACE OUTSIDE','NO vertical backdrop','four separated grounded legs','dark walnut','overlapping','three-quarter','no photo, postcard, picture frame'])assert.ok(reference.prompt.includes(detail),detail);
 assert.equal(model.input,'reference_task');assert.equal(model.prompt,undefined);assert.equal(job.generation.tripoReference.promptVersion,i.SOUVENIR_COMPOSITION_VERSION);
 assert.equal(seen.length,2);assert.equal(seen[1][0][0],'object');assert.equal(seen[1][0][1],job.tripoReference.referenceSha256);
 assert.deepEqual((await f.service.asset(job.id,job.token,'photo')).bytes,image);assert.deepEqual((await f.service.asset(job.id,job.token,'tripo-input')).bytes,f.referenceImage);
 assert.equal(posts.filter(x=>x[0]==='worldlabs').length,1);assert.match(posts.find(x=>x[0]==='worldlabs')[3].world_prompt.text_prompt,/human-scale surrounding place/);
 assert.equal((await f.service.status()).budget.tripo.committed,70);
});
test('blocked generated intermediate is neither persisted nor forwarded to the model; actual image cost is retained',async t=>{
 const f=await souvenirFixture(t,{safety:{...testSafety,screen:async images=>{const r=await testSafety.screen(images);if(images.length===1&&images[0].id==='object'){r.decision='block';r.results[0].decision='block';r.results[0].category='adult-product';}return r;}}});
 const first=await f.service.create(input({photoIntent:'place'})),job=await f.service.get(first.id,first.token);
 assert.equal(job.tripoReference.state,'failed');assert.equal(job.tripo.errorCode,'PHOTO_SAFETY_BLOCKED');assert.equal(job.tripo.credits,10);assert.equal(job.assets.tripoInputUrl,undefined);
 assert.equal((await readdir(join(f.directory,job.id))).some(x=>x.startsWith('tripo-input.')),false);
 await f.service.get(job.id,job.token);assert.equal(f.posts.filter(x=>x[1].endsWith('image-to-model')).length,0);assert.equal(f.posts.filter(x=>x[1].endsWith('image-to-image')).length,1);
});
test('ambiguous image submission remains terminal across restart, never creating a replacement task',async t=>{
 const f=await souvenirFixture(t,{json:async(provider,path,method)=>{if(method==='POST'&&provider==='tripo')throw Error('lost image ACK');return method==='POST'?{operation_id:'world_operation'}:{done:true};}});
 const first=await f.service.create(input({photoIntent:'place'})),job=await f.service.get(first.id,first.token);assert.equal(job.tripoReference.errorCode,'SUBMISSION_AMBIGUOUS');assert.equal(job.tripo.state,'failed');
 let posts=0;const restarted=i.createInstantService({directory:f.directory,settings,safety:testSafety,json:async(...args)=>{if(args[2]==='POST')posts++;return{done:true};},complete:async()=>null});
 await restarted.get(job.id,job.token);assert.equal(posts,0);assert.equal((await restarted.status()).budget.tripo.committed,100);
});
test('controlled remake reserves only Tripo, pauses at checked reference, reuses immutable world, then settles 70 without changing prior receipt',async t=>{
 const f=await souvenirFixture(t),source=await f.service.create(input({photoIntent:'place',objectImageDataUrl:'data:image/png;base64,'+f.referenceImage.toString('base64'),objectImageRole:'miniature-reference'}));await f.service.get(source.id,source.token);
 const prior=await readFile(join(f.directory,source.id,'job.json'),'utf8'),sourcePosts=f.posts.filter(x=>x[2]==='POST').length;
 const request={consent:true,dedupeKey:'controlled-remake-test',pauseAfterReference:true},created=await f.service.remakeKeepsakeForOwnedJob(source.id,request),review=await f.service.pollOwnedKeepsake(created.jobId);
 assert.equal(review.tripoReference.state,'completed');assert.equal(review.tripo.state,'pending');assert.equal(review.worldlabs.credits,0);assert.equal(review.reusedWorld.newCredits,0);assert.equal(review.assets.world.sourceJobId,source.id);
 assert.equal((await f.service.status()).budget.worldlabs.committed,1580);assert.equal((await f.service.status()).budget.tripo.committed,160);
 await f.service.pollOwnedKeepsake(review.jobId);await f.service.remakeKeepsakeForOwnedJob(source.id,request);assert.equal(f.posts.filter(x=>x[2]==='POST').length,sourcePosts+1);
 await assert.rejects(()=>f.service.approveOwnedKeepsakeReference(review.jobId,'0'.repeat(64),true),e=>e.code==='REFERENCE_APPROVAL_MISMATCH');
 await f.service.approveOwnedKeepsakeReference(review.jobId,review.tripoReference.referenceSha256,true);const done=await f.service.pollOwnedKeepsake(review.jobId);
 assert.equal(done.state,'completed');assert.equal(done.tripo.credits,70);assert.equal((await f.service.status()).budget.tripo.committed,130);assert.equal(f.posts.filter(x=>x[0]==='worldlabs'&&x[2]==='POST').length,1);
 assert.equal(await readFile(join(f.directory,source.id,'job.json'),'utf8'),prior);assert.equal(JSON.stringify(done).includes(source.token),false);
 assert.equal((await readdir(join(f.directory,done.jobId))).some(x=>x.startsWith('world.')),false);
});
test('declining a checked paused legacy reference is hash-bound, local-only, idempotent and settles only a known image cost',async t=>{
 for(const knownCost of [true,false]){
  const f=await souvenirFixture(t,{referenceCost:5}),source=await f.service.create(input({photoIntent:'place',objectImageDataUrl:'data:image/png;base64,'+f.referenceImage.toString('base64'),objectImageRole:'miniature-reference'}));await f.service.get(source.id,source.token);
  const created=await f.service.remakeKeepsakeForOwnedJob(source.id,{consent:true,dedupeKey:`decline-reference-${knownCost}`,pauseAfterReference:true}),checked=await f.service.pollOwnedKeepsake(created.jobId),path=join(f.directory,created.jobId,'job.json');
  const stored=JSON.parse(await readFile(path,'utf8'));stored.generation.tripoReference={model:'seedream_v5',size:'2048x2048',output_format:'png',prompt:'Legacy submitted prompt',promptVersion:'giftportals-souvenir-miniature-v17'};
  if(!knownCost)delete stored.tripoReference.credits;await writeFile(path,JSON.stringify(stored));
  const originalSourceReceipt=await readFile(join(f.directory,source.id,'job.json'),'utf8'),imageBytes=await readFile(checked.referencePath),postsBefore=f.posts.length;
  await assert.rejects(()=>f.service.rejectOwnedKeepsakeReference(created.jobId,'0'.repeat(64)),e=>e.code==='REFERENCE_APPROVAL_MISMATCH');
  const declined=await f.service.rejectOwnedKeepsakeReference(created.jobId,checked.tripoReference.referenceSha256);
  assert.equal(declined.tripo.state,'failed');assert.equal(declined.tripo.errorCode,'REFERENCE_DECLINED');assert.equal(declined.state,'partial');assert.equal(declined.tripo.credits,knownCost?5:undefined);
  assert.equal(declined.referenceDeclinedSha256,checked.tripoReference.referenceSha256);assert.equal(declined.tripoReference.state,'completed');assert.deepEqual(declined.generation.tripoReference,stored.generation.tripoReference);
  assert.equal(f.posts.length,postsBefore);assert.deepEqual(await readFile(checked.referencePath),imageBytes);assert.equal(await readFile(join(f.directory,source.id,'job.json'),'utf8'),originalSourceReceipt);
  const receipt=await readFile(path,'utf8');await f.service.rejectOwnedKeepsakeReference(created.jobId,checked.tripoReference.referenceSha256);assert.equal(await readFile(path,'utf8'),receipt);
  await assert.rejects(()=>f.service.approveOwnedKeepsakeReference(created.jobId,checked.tripoReference.referenceSha256,true),e=>e.code==='REFERENCE_DECLINED');
  assert.equal((await f.service.status()).budget.tripo.committed,knownCost?65:160);assert.equal(declined.worldlabs.credits,0);
 }
});
test('decline cannot affect a reference already approved or a GLB already submitted',async t=>{
 const f=await souvenirFixture(t),source=await f.service.create(input({photoIntent:'place',objectImageDataUrl:'data:image/png;base64,'+f.referenceImage.toString('base64'),objectImageRole:'miniature-reference'}));await f.service.get(source.id,source.token);
 const created=await f.service.remakeKeepsakeForOwnedJob(source.id,{consent:true,dedupeKey:'approve-before-decline',pauseAfterReference:true}),checked=await f.service.pollOwnedKeepsake(created.jobId);
 await f.service.approveOwnedKeepsakeReference(created.jobId,checked.tripoReference.referenceSha256,true);
 await assert.rejects(()=>f.service.rejectOwnedKeepsakeReference(created.jobId,checked.tripoReference.referenceSha256),e=>e.code==='REFERENCE_ALREADY_SUBMITTED');
 assert.equal(f.posts.filter(x=>x[1].endsWith('image-to-model')&&x[2]==='POST').length,2);
});
test('a resumed GLB cannot replace approved intermediate bytes while remakes ignore artificial credit caps',async t=>{
 const f=await souvenirFixture(t),source=await f.service.create(input({photoIntent:'place',objectImageDataUrl:'data:image/png;base64,'+f.referenceImage.toString('base64'),objectImageRole:'miniature-reference'}));await f.service.get(source.id,source.token);
 const made=await f.service.remakeKeepsakeForOwnedJob(source.id,{consent:true,dedupeKey:'tamper-remake-reference',pauseAfterReference:true}),checked=await f.service.pollOwnedKeepsake(made.jobId);
 await writeFile(checked.referencePath,image);await assert.rejects(()=>f.service.approveOwnedKeepsakeReference(made.jobId,checked.tripoReference.referenceSha256,true),e=>e.code==='PHOTO_SAFETY_REQUIRED');
 const again=await f.service.remakeKeepsakeForOwnedJob(source.id,{consent:true,dedupeKey:'second-remake-beyond-former-cap',pauseAfterReference:true});assert.ok(again.jobId);assert.notEqual(again.jobId,made.jobId);
 assert.equal(f.posts.filter(x=>x[1].endsWith('image-to-model')&&x[2]==='POST').length,1);
});
test('two live services sharing one ledger never claim the same pending paid stage twice',async t=>{
 let release,entered;const gate=new Promise(resolve=>release=resolve),submitted=new Promise(resolve=>entered=resolve);let posts=0;
 const f=await fixture(t,{json:async(provider,path,method)=>{if(method==='POST'){posts++;if(provider==='tripo'){entered();await gate;}return provider==='tripo'?{task_id:'model_task'}:{operation_id:'world_operation'};}return provider==='tripo'?{status:'success'}:{done:true};}});
 const first=await f.service.create(input());await submitted;
 const second=i.createInstantService({directory:f.directory,settings,safety:testSafety,credit:async()=>{},upload:async()=> 'file_second',json:async(provider,path,method)=>{if(method==='POST')posts++;return provider==='tripo'?{status:'success'}:{done:true};},complete:async()=>null});
 const other=second.get(first.id,first.token);await new Promise(resolve=>setTimeout(resolve,70));release();await other;await f.service.get(first.id,first.token);
 assert.equal(posts,2);assert.equal((await readdir(join(f.directory,first.id))).includes('.stage-lock'),false);
});
test('existingcompletedcollider usesfreeGEThelper, persistsboundedGLB and requirescapabilityforread',async t=>{
 const {service,directory}=await fixture(t);const first=await service.create(input()),completed=await service.get(first.id,first.token),path=join(directory,first.id,'job.json');
 const stored=JSON.parse(await readFile(path,'utf8'));stored.worldlabs.resultId='completed_world';await writeFile(path,JSON.stringify(stored));let reads=0;
 const helper=i.createInstantService({directory,settings,collider:async id=>{reads++;assert.equal(id,'completed_world');return{status:'available',asset:asset('collider','world','model/gltf-binary',Buffer.from('colliderGLB')),worldSemantics:{metricScaleFactor:1.5,groundPlaneOffset:1}};}});
 await assert.rejects(()=>helper.enhanceCollider(first.id,token()),e=>e.code==='JOB_UNAVAILABLE');assert.equal(reads,0);
 const result=await helper.enhanceCollider(first.id,first.token);assert.match(result.assets.colliderUrl,/name=collider/);assert.equal(result.generation.worldlabs.colliderStatus,'available');assert.equal(result.worldlabs.credits,completed.worldlabs.credits);
 assert.equal((await helper.asset(first.id,first.token,'collider')).mime,'model/gltf-binary');await helper.enhanceCollider(first.id,first.token);assert.equal(reads,1);
 const fail=i.createInstantService({directory,settings,collider:async()=>{throw Error('private diagnostic');}});
 const another=JSON.parse(await readFile(path,'utf8'));delete another.assets.collider;delete another.generation.worldlabs.colliderCheckedAt;await writeFile(path,JSON.stringify(another));
 const fallback=await fail.enhanceCollider(first.id,first.token);assert.equal(fallback.state,'completed');assert.equal(fallback.generation.worldlabs.colliderStatus,'download-failed');assert.equal(fallback.assets.colliderUrl,undefined);
});
test('completed legacyworld upgrades fromsameoperation usingGETonly andpreserves100khash',async t=>{
 const {service,directory}=await fixture(t);const first=await service.create(input()),old=await service.get(first.id,first.token);
 const path=join(directory,old.id,'job.json'),stored=JSON.parse(await readFile(path,'utf8'));
 delete stored.generation.worldlabs.splatQuality;delete stored.generation.worldlabs.qualityCheckedAt;
 await writeFile(path,JSON.stringify(stored));const oldHash=stored.assets.world.sha256,oldWorld=await readFile(join(directory,old.id,stored.assets.world.name));
 const calls=[];
 const upgrade=i.createInstantService({directory,settings,json:async(provider,path,method='GET')=>{calls.push([provider,path,method]);assert.equal(method,'GET');return{done:true};},complete:async(provider,result,options)=>{
  assert.equal(options.worldQuality,'500k');return{worldQuality:'500k',resultId:'same_world',cost:1580,assets:[asset('spz','world','application/octet-stream',Buffer.from('higher-detail-spz')),asset('pano','world','image/png',image)]};
 }});
 await assert.rejects(()=>upgrade.enhanceWorld(old.id,token()),e=>e.code==='JOB_UNAVAILABLE');assert.equal(calls.length,0);
 const enhanced=await upgrade.enhanceWorld(old.id,old.token);assert.equal(enhanced.state,'completed');assert.equal(enhanced.generation.worldlabs.splatQuality,'500k');assert.equal(enhanced.worldlabs.credits,old.worldlabs.credits);
 const saved=JSON.parse(await readFile(path,'utf8'));assert.equal(saved.assets.world.name,'world-500k.spz');assert.notEqual(saved.assets.world.sha256,oldHash);assert.equal(saved.assetHistory.world[0].sha256,oldHash);
 assert.deepEqual(await readFile(join(directory,old.id,'world.spz')),oldWorld);assert.equal(calls.length,1);
 await upgrade.enhanceWorld(old.id,old.token);assert.equal(calls.length,1,'no repeatdownload afterqualityupgrade');
});
test('triage and creation screen every supplied image; blocking saves no photo and makes no provider call',async t=>{
 const variants={objectImageDataUrl:'data:image/jpeg;base64,'+Buffer.from([255,216,255,225,1,2,3]).toString('base64'),worldImageDataUrl:'data:image/jpeg;base64,'+Buffer.from([255,216,255,225,4,5,6]).toString('base64')};
 for(const deniedRole of ['original','object','world']){
  const seen=[];const safety={...testSafety,screen:async images=>{seen.push(images.map(x=>x.id));const report=await testSafety.screen(images);report.decision='block';report.results.find(x=>x.id===deniedRole).decision='block';report.results.find(x=>x.id===deniedRole).category='adult-product';return report;}};
  const {service,calls,directory}=await fixture(t,{safety});
  const report=await service.triage(input(variants));assert.equal(report.decision,'block');assert.deepEqual(seen[0],['original','object','world']);
  await assert.rejects(()=>service.create(input(variants)),e=>e.code==='PHOTO_SAFETY_BLOCKED');
  assert.deepEqual(await readdir(directory),[]);assert.equal(calls.length,0);
 }
});
test('unavailable or uncertain safety disables live generation without disk or external calls',async t=>{
 const unavailable=safetyModule.createImageSafetyAdapter({probe:async()=>({ready:false})});
 const first=await fixture(t,{safety:unavailable});const status=await first.service.status();assert.equal(status.available,false);assert.equal(status.safety.reason,'CLASSIFIER_UNAVAILABLE');
 await assert.rejects(()=>first.service.create(input()),e=>e.code==='PHOTO_SAFETY_UNAVAILABLE');assert.equal(first.calls.length,0);assert.deepEqual(await readdir(first.directory),[]);
 const uncertain={...testSafety,screen:async images=>({...await testSafety.screen(images),decision:'review'})};
 const next=await fixture(t,{safety:uncertain});await assert.rejects(()=>next.service.create(input()),e=>e.code==='PHOTO_SAFETY_REVIEW_REQUIRED');assert.equal(next.calls.length,0);assert.deepEqual(await readdir(next.directory),[]);
});
test('incomplete or inconsistent classifier receipts cannot approve or persist an unchecked variant',async t=>{
 for(const change of [report=>({...report,results:[]}),report=>({...report,results:report.results.map(x=>({...x,sha256:'0'.repeat(64)}))}),report=>({...report,results:report.results.map(x=>({...x,decision:'block',category:'sexual'}))})]){
  const safety={...testSafety,screen:async images=>change(await testSafety.screen(images))};const {service,directory,calls}=await fixture(t,{safety});
  await assert.rejects(()=>service.create(input()),e=>['PHOTO_SAFETY_UNAVAILABLE','PHOTO_SAFETY_BLOCKED'].includes(e.code));assert.equal(calls.length,0);assert.deepEqual(await readdir(directory),[]);
 }
});
test('recovered pending job without approval or changed image bytes cannot resume sponsored work',async t=>{
 const {service,directory}=await fixture(t);const first=await service.create(input());await service.get(first.id,first.token);
 const path=join(directory,first.id,'job.json');const saved=JSON.parse(await readFile(path,'utf8'));
 for(const mode of ['missing-approval','changed-bytes']){
  const job=structuredClone(saved);job.state='processing';job.tripo={state:'pending',progress:0};job.worldlabs={state:'pending',progress:0};
  if(mode==='missing-approval')delete job.photoSafety;else await writeFile(join(directory,job.id,job.assets.photo.name),Buffer.from('substituted-image'));
  await writeFile(path,JSON.stringify(job));let providerCalls=0;
  const resumed=i.createInstantService({directory,settings,safety:testSafety,credit:async()=>providerCalls++,upload:async()=>{providerCalls++;return'token';},json:async()=>{providerCalls++;return{};}});
  const result=await resumed.get(first.id,first.token);assert.equal(result.state,'failed');assert.equal(result.tripo.errorCode,'PHOTO_SAFETY_REQUIRED');assert.equal(providerCalls,0);
 }
});
test('selected discoveries come only from reviewed catalog; arbitrary URLs and raw GPS are not saved',async t=>{
 const {service,calls,directory}=await fixture(t);
 for(const curiosityIds of [['unlisted'],['clock-pocket','clock-pocket'],['clock-pocket','rio-gardens','bird-feathers']])await assert.rejects(()=>service.create(input({curiosityIds})),e=>e.code==='CURIOSITY_IDS_INVALID');
 assert.equal(calls.length,0);
 const first=await service.create(input({curiosityIds:['clock-pocket','rio-gardens'],latitude:12.3456789,longitude:98.7654321,sourceUrl:'https://evil.invalid'}));
 const job=await service.get(first.id,first.token);assert.equal(job.curiosities.length,2);assert.match(job.curiosities[0].sourceUrl,/^https:\/\/www.si.edu\//);
 const saved=await readFile(join(directory,first.id,'job.json'),'utf8');assert.ok(!saved.includes('12.3456789'));assert.ok(!saved.includes('98.7654321'));assert.ok(!saved.includes('evil.invalid'));
});
