import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../..');
async function moduleURL(path, replacements = {}) {
 let js = ts.transpileModule(await readFile(resolve(root, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
 for (const [from, to] of Object.entries(replacements)) js = js.replaceAll(`'${from}'`, JSON.stringify(to));
 return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
}
const rulesURL = await moduleURL('api/_lib/rules.ts');
const providerURL = await moduleURL('api/_lib/providers.ts', { './rules.js': rulesURL });
const safetyURL = await moduleURL('api/_lib/image-safety.ts', { './rules.js': rulesURL });
const module = await import(await moduleURL('api/_lib/quality-trial-world.ts', { './rules.js': rulesURL, './providers.js': providerURL, './image-safety.js': safetyURL }));
const { AppError } = await import(rulesURL);
globalThis.fetch = async () => { throw Error('NETWORK_DISABLED_IN_TESTS'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const png = (width = 512, height = 512) => { const bytes = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes; };
const allowed = bytes => ({ protocol: 'giftportals-local-vision-v1', checkedAt: '2026-10-03T00:00:00Z', modelVersion: 'synthetic-test-only', decision: 'allow', results: [{ id: 'world', sha256: digest(bytes), decision: 'allow', category: 'ordinary', modelVersion: 'synthetic-test-only', scores: { sexual: 0, adultProduct: 0 } }] });
async function fixture(t, overrides = {}) {
 const directory = await mkdtemp(join(tmpdir(), 'giftportals-plus-trial-')); t.after(() => rm(directory, { recursive: true, force: true }));
 const directions = ['front', 'right', 'back', 'left'];
 const input = { trialId: 'paris-world-plus-test', title: 'Paris — coherent view trial', textPrompt: 'A Paris riverfront with coherent bridges, boats and a detailed riverside promenade.', baseline: { worldId: 'baseline-world', label: 'Previous Marble 1.1 world' }, provenance: 'Four creatively derived cardinal views of one generated panorama; artistic coverage, not a capture or a factual scan.', images: [] };
 for (let index = 0; index < directions.length; index++) { const path = join(directory, `${directions[index]}.png`); await writeFile(path, png()); input.images.push({ label: directions[index], azimuth: index * 90, path }); }
 const calls = [], asset = (suffix, mime, value) => { const bytes = Buffer.from(value); return { suffix, mime, kind: 'world', bytes, sha256: digest(bytes) }; };
 const deps = { directory: join(directory, 'trials'), safety: { screen: async ([image]) => { calls.push(['safety']); return allowed(image.bytes); } },
  reserve: async value => { calls.push(['reserve', value]); }, settle: async (...value) => { calls.push(['settle', ...value]); }, release: async id => { calls.push(['release', id]); },
  upload: async (bytes, mime, label) => { calls.push(['upload', label]); return `media-${label}`; },
  json: async (provider, path, method = 'GET', body) => { calls.push(['json', provider, path, method, body]); return path === '/credits' ? { remaining_credits: 9000 } : method === 'POST' ? { operation_id: 'world-operation' } : { done: true }; },
  complete: async () => ({ resultId: 'world-result', cost: 1600, worldQuality: '500k', colliderStatus: 'available', assets: [asset('spz', 'application/octet-stream', 'synthetic-spz'), asset('pano', 'image/jpeg', 'synthetic-pano'), asset('collider', 'model/gltf-binary', 'synthetic-collider')] }),
  ...overrides,
 };
 return { directory, input, deps, calls, service: module.createWorldQualityTrial(deps) };
}
test('explicit spend permission and two-to-four unique matching cardinal views precede every external call', async t => {
 const { input, service, calls } = await fixture(t);
 await assert.rejects(() => service.create(input, false), error => error.code === 'EXPLICIT_SPEND_CONFIRMATION_REQUIRED');
 await assert.rejects(() => service.create({ ...input, images: input.images.slice(0, 1) }, true), error => error.code === 'WORLD_VIEWS_INVALID');
 await assert.rejects(() => service.create({ ...input, images: [...input.images, input.images[0]] }, true), error => error.code === 'WORLD_VIEWS_INVALID');
 await assert.rejects(() => service.create({ ...input, images: [input.images[0], input.images[1], input.images[0]] }, true), error => error.code === 'WORLD_VIEWS_INVALID');
 await assert.rejects(() => service.create({ ...input, images: input.images.map(image => ({ ...image, azimuth: 0 })) }, true), error => error.code === 'WORLD_VIEWS_INVALID');
 await writeFile(input.images[3].path, png(256, 512));
 await assert.rejects(() => service.create(input, true), error => error.code === 'WORLD_VIEWS_DIMENSIONS_MISMATCH');
 assert.equal(calls.length, 0);
});
test('two and three known-safe coherent views preserve explicit yaws and the full Plus multi-image reservation', async t => {
 for (const indices of [[0, 2], [0, 1, 3]]) {
  const { input, service, calls } = await fixture(t);
  const selected = indices.map(index => input.images[index]);
  const result = await service.create({ ...input, images: selected }, true);
  assert.equal(result.state, 'processing'); assert.equal(result.safety.checkedImages, selected.length);
  assert.deepEqual(result.views.map(view => view.azimuth), selected.map(view => view.azimuth));
  assert.deepEqual(calls.find(call => call[0] === 'reserve')[1], { trialId: input.trialId, provider: 'worldlabs', credits: 3100 });
  assert.equal(calls.filter(call => call[0] === 'safety').length, selected.length);
  assert.equal(calls.filter(call => call[0] === 'upload').length, selected.length);
  const post = calls.find(call => call[0] === 'json' && call[3] === 'POST');
  assert.equal(post[4].world_prompt.type, 'multi-image');
  assert.deepEqual(post[4].world_prompt.multi_image_prompt.map(view => view.azimuth), selected.map(view => view.azimuth));
 }
});
test('all local safety checks happen before reservation, storage or uploads, and review fails closed', async t => {
 const { input, service, calls, deps } = await fixture(t, { safety: { screen: async ([image]) => ({ ...allowed(image.bytes), decision: 'review' }) } });
 await assert.rejects(() => service.create(input, true), error => error.code === 'PHOTO_SAFETY_REVIEW_REQUIRED');
 assert.equal(calls.length, 0); await assert.rejects(() => stat(join(deps.directory, input.trialId)), error => error.code === 'ENOENT');
});
test('fresh credits below the3100 task cost block Plus and release only a reservation with no paid POST', async t => {
 const { input, service, calls } = await fixture(t, { json: async () => ({ remaining_credits: 3099 }) });
 const result = await service.create(input, true); assert.equal(result.state, 'failed'); assert.equal(result.errorCode, 'PROVIDER_INSUFFICIENT_CREDITS');
 assert.deepEqual(calls.map(call => call[0]), ['safety', 'safety', 'safety', 'safety', 'reserve', 'release']);
 assert.deepEqual(calls[4][1], { trialId: input.trialId, provider: 'worldlabs', credits: 3100 });
});
test('Plus can use exactly its3100 task credits without an extra buffer and dedupe never submits twice',async t=>{
 const requests=[],f=await fixture(t,{json:async(_provider,path,method='GET')=>{requests.push([path,method]);return path==='/credits'?{remaining_credits:3100}:{operation_id:'world-operation'};}});
 assert.equal((await f.service.create(f.input,true)).state,'processing');assert.equal((await f.service.create(f.input,true)).state,'processing');
 assert.deepEqual(requests,[['/credits','GET'],['/worlds:generate','POST']]);assert.equal(f.calls.some(call=>call[0]==='release'),false);
});
test('Plus request uses explicit coherent directions and never exposes upload IDs, paths, fingerprint or private prompt', async t => {
 const { input, service, calls } = await fixture(t); const result = await service.create(input, true);
 assert.equal(result.state, 'processing'); assert.equal(result.model, 'marble-1.1-plus');
 const post = calls.find(call => call[0] === 'json' && call[3] === 'POST');
 assert.equal(post[2], '/worlds:generate'); assert.equal(post[4].model, 'marble-1.1-plus'); assert.equal(post[4].permission.public, false);
 assert.equal(post[4].world_prompt.type, 'multi-image');
 assert.deepEqual(post[4].world_prompt.multi_image_prompt.map(image => image.azimuth), [0, 90, 180, 270]);
 assert.deepEqual(post[4].world_prompt.multi_image_prompt.map(image => image.content), input.images.map(image => ({ source: 'media_asset', media_asset_id: `media-${image.label}` })));
 assert.match(result.evidence, /not a same-input causal/);
 const raw = JSON.stringify(result); for (const hidden of ['media-front', 'fingerprint', 'textPrompt', input.images[0].path, 'tokenHash', 'upload_url']) assert.ok(!raw.includes(hidden));
 assert.deepEqual(calls.slice(0, 4).map(call => call[0]), ['safety', 'safety', 'safety', 'safety']);
});
test('same manifest is idempotent across service restarts and changed content is rejected', async t => {
 const { input, service, calls, deps } = await fixture(t); const first = await service.create(input, true);
 const duplicate = await module.createWorldQualityTrial(deps).create(input, true); assert.equal(duplicate.operationId, first.operationId);
 assert.equal(calls.filter(call => call[0] === 'json' && call[3] === 'POST').length, 1);
 await assert.rejects(() => service.create({ ...input, title: 'Changed gift' }, true), error => error.code === 'TRIAL_DEDUPE_MISMATCH');
});
test('uncertain paid POST is durable and neither create nor poll can submit it again', async t => {
 const { input, service, calls, deps } = await fixture(t, { json: async (provider, path, method = 'GET') => { calls.push(['json', provider, path, method]); if (method === 'POST') throw new AppError('SUBMISSION_AMBIGUOUS', 502); return { remaining_credits: 9000 }; } });
 const first = await service.create(input, true); assert.equal(first.state, 'ambiguous');
 const restarted = module.createWorldQualityTrial(deps); assert.equal((await restarted.create(input, true)).state, 'ambiguous');
 assert.equal((await restarted.poll(input.trialId)).state, 'ambiguous');
 assert.equal(calls.filter(call => call[0] === 'json' && call[3] === 'POST').length, 1); assert.ok(!calls.some(call => call[0] === 'release'));
});
test('GET poll resumes operation after restart, validates downloaded bytes and settles exact cost once per completed record', async t => {
 const { input, service, calls, deps } = await fixture(t); await service.create(input, true); calls.length = 0;
 const restarted = module.createWorldQualityTrial(deps), completed = await restarted.poll(input.trialId);
 assert.equal(completed.state, 'completed'); assert.equal(completed.actualCredits, 1600); assert.equal(completed.quality, '500k'); assert.equal(completed.colliderStatus, 'available');
 assert.equal(completed.assets.length, 3); for (const asset of completed.assets) assert.equal(digest(await readFile(asset.path)), asset.sha256);
 assert.deepEqual(calls.filter(call => call[0] === 'json').map(call => call.slice(2, 4)), [['/operations/world-operation', 'GET']]);
 assert.deepEqual(calls.find(call => call[0] === 'settle'), ['settle', input.trialId, 1600]);
 const prior = calls.length; await restarted.poll(input.trialId); assert.equal(calls.length, prior);
});
test('missing 500k or invalid costs keep the known operation resumable without a second POST', async t => {
 for (const output of [{ worldQuality: '100k', cost: 1600 }, { worldQuality: '500k', cost: 3101 }, { worldQuality: '500k', cost: NaN }]) {
  const f = await fixture(t, { complete: async () => ({ assets: [], resultId: 'world-result', ...output }) });
  await f.service.create(f.input, true); await assert.rejects(() => f.service.poll(f.input.trialId), error => ['WORLD_500K_UNAVAILABLE', 'WORLD_TRIAL_COST_INVALID'].includes(error.code));
  assert.equal(f.calls.filter(call => call[0] === 'json' && call[3] === 'POST').length, 1); assert.ok(!f.calls.some(call => call[0] === 'settle'));
 }
});
test('valid completed assets remain available with unknown billing while their full reservation stays held', async t => {
 const f = await fixture(t); const original = f.deps.complete;
 const noCost = module.createWorldQualityTrial({ ...f.deps, complete: async (...args) => { const output = await original(...args); delete output.cost; return output; } });
 await noCost.create(f.input, true); const result = await noCost.poll(f.input.trialId);
 assert.equal(result.state, 'completed'); assert.equal(result.quality, '500k'); assert.equal(result.actualCredits, undefined); assert.equal(result.maxReservedCredits, 3100);
 assert.equal(result.assets.length, 3); for (const asset of result.assets) assert.equal(digest(await readFile(asset.path)), asset.sha256);
 assert.equal(f.calls.filter(call => call[0] === 'settle').length, 0); assert.equal(f.calls.filter(call => call[0] === 'release').length, 0);
 assert.equal(f.calls.filter(call => call[0] === 'json' && call[3] === 'POST').length, 1);
});
test('known operation inspection only uses GET and reports sanitized provider errors without settling billing or changing local state', async t => {
 let prompt;
 const f = await fixture(t, { json: async (provider, path, method = 'GET', body) => {
  f.calls.push(['json', provider, path, method, body]);
  return path === '/credits' ? { remaining_credits: 9000 } : method === 'POST' ? { operation_id: 'world-operation' } : { done: true, error: { code: 'WORLD_GENERATION_FAILED', message: `Rendering failed for ${prompt}; see https://private.worldlabs.ai/result?token=private and Bearer privatecredentiallongvalue0123456789` }, cost: { total_credits: 0 } };
 } });
 prompt = f.input.textPrompt; await f.service.create(f.input, true); const path = join(f.deps.directory, f.input.trialId, 'job.json'), before = await readFile(path, 'utf8'); f.calls.length = 0;
 const result = await f.service.inspect(f.input.trialId);
 assert.equal(result.state, 'processing'); assert.equal(result.operationInspection.done, true); assert.equal(result.operationInspection.hasProviderError, true);
 assert.equal(result.operationInspection.providerError.code, 'WORLD_GENERATION_FAILED'); assert.match(result.operationInspection.providerError.message, /Rendering failed/);
 assert.equal(result.operationInspection.settledOperationCredits, 0); assert.equal(result.operationInspection.generationRequests, 0);
 const raw = JSON.stringify(result.operationInspection); for (const secret of [prompt, 'https://private', 'privatecredentiallongvalue', 'token=private']) assert.ok(!raw.includes(secret));
 assert.deepEqual(f.calls.map(call => call.slice(0, 4)), [['json', 'worldlabs', '/operations/world-operation', 'GET']]); assert.equal(await readFile(path, 'utf8'), before);
});
test('inspection exposes only bounded numeric progress, valid ISO update time and bounded metadata key names', async t => {
 let response = { done: false, updated_at: '2026-10-03T15:10:22.123Z', metadata: { progress: 71.5, stage: 'PRIVATE_PROVIDER_STAGE_VALUE', private_url: 'https://private.worldlabs.ai/secret', 'https://private-key.example': 'hidden', ...Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`extra_${index}`, `PRIVATE_METADATA_VALUE_${index}`])) } };
 const f = await fixture(t, { json: async (provider, path, method = 'GET', body) => {
  f.calls.push(['json', provider, path, method, body]);
  return path === '/credits' ? { remaining_credits: 9000 } : method === 'POST' ? { operation_id: 'world-operation' } : response;
 } });
 await f.service.create(f.input, true); const path = join(f.deps.directory, f.input.trialId, 'job.json'), before = await readFile(path, 'utf8'); f.calls.length = 0;
 const first = (await f.service.inspect(f.input.trialId)).operationInspection;
 assert.equal(first.progress, 71.5); assert.equal(first.providerUpdatedAt, '2026-10-03T15:10:22.123Z');
 assert.equal(first.metadataKeys.length, 24); assert.deepEqual(first.metadataKeys.slice(0, 3), ['progress', 'stage', 'private_url']);
 const raw = JSON.stringify(first); for (const privateValue of ['PRIVATE_PROVIDER_STAGE_VALUE', 'PRIVATE_METADATA_VALUE', 'https://private']) assert.ok(!raw.includes(privateValue));
 for (const progress of [-1, 101, NaN, Infinity, '75', null]) {
  response = { done: false, updated_at: 'not-an-ISO-date', metadata: { progress } };
  const result = (await f.service.inspect(f.input.trialId)).operationInspection; assert.equal(result.progress, undefined); assert.equal(result.providerUpdatedAt, undefined);
 }
 response = { done: false, metadata: [] }; assert.deepEqual((await f.service.inspect(f.input.trialId)).operationInspection.metadataKeys, []);
 assert.ok(f.calls.every(call => call[0] === 'json' && call[2] === '/operations/world-operation' && call[3] === 'GET'));
 assert.equal(await readFile(path, 'utf8'), before);
});
test('a crash in submitting without a recorded operation is not retryable on restart', async t => {
 const { input, service, deps, calls } = await fixture(t); await service.create(input, true);
 const path = join(deps.directory, input.trialId, 'job.json'), saved = JSON.parse(await readFile(path, 'utf8')); saved.state = 'submitting'; delete saved.operationId; await writeFile(path, JSON.stringify(saved)); calls.length = 0;
 assert.equal((await module.createWorldQualityTrial(deps).poll(input.trialId)).state, 'ambiguous'); assert.equal(calls.length, 0);
});

function asText(input) { const result = { ...input, inputMode: 'text' }; delete result.images; return result; }
test('explicit standard models reserve1580 for one reference and persist their model and recaption choice through restart', async t => {
 for (const model of ['marble-1.1','marble-1.0']) {
  const f = await fixture(t), input = { ...asSingleImage(f.input), model, disableRecaption: true };
  const first = await f.service.create(input, true);
  assert.equal(first.model, model); assert.equal(first.maxReservedCredits, 1580);
  const post = f.calls.find(call => call[0] === 'json' && call[3] === 'POST');
  assert.equal(post[4].model, model); assert.equal(post[4].world_prompt.disable_recaption, true);
  assert.deepEqual(f.calls.find(call => call[0] === 'reserve')[1], {trialId: input.trialId, provider:'worldlabs',credits:1580});
  const restarted = module.createWorldQualityTrial(f.deps);
  assert.equal((await restarted.create(input,true)).operationId,first.operationId);
  assert.equal(f.calls.filter(call => call[0] === 'json' && call[3] === 'POST').length,1);
  await assert.rejects(() => restarted.create({...input,model:model === 'marble-1.1'?'marble-1.0':'marble-1.1'},true),{code:'TRIAL_DEDUPE_MISMATCH'});
 }
});
test('unsupported model, recaption value and insufficient standard balance stop before paid requests',async t=>{
 const f=await fixture(t),input=asSingleImage(f.input);
 await assert.rejects(()=>f.service.create({...input,model:'marble-1.0-draft'},true),{code:'WORLD_MODEL_INVALID'});
 await assert.rejects(()=>f.service.create({...input,disableRecaption:'yes'},true),{code:'WORLD_RECAPTION_INVALID'});
 assert.equal(f.calls.length,0);
 const low=await fixture(t,{json:async()=>({remaining_credits:1579})});
 const result=await low.service.create({...asSingleImage(low.input),model:'marble-1.1'},true);
 assert.equal(result.state,'failed');assert.equal(result.errorCode,'PROVIDER_INSUFFICIENT_CREDITS');
 assert.deepEqual(low.calls.map(call=>call[0]),['safety','reserve','release']);
});
test('terminal standard model failure never performs automatic fallback or repeats the paid request',async t=>{
 const f=await fixture(t,{json:async(provider,path,method='GET',body)=>{
  f.calls.push(['json',provider,path,method,body]);
  return path==='/credits'?{remaining_credits:4260}:method==='POST'?{operation_id:'world-operation'}:{done:true,error:{code:500,message:'Generation failed'}};
 }});
 const input={...asSingleImage(f.input),model:'marble-1.1'};await f.service.create(input,true);
 assert.equal((await f.service.poll(input.trialId)).state,'failed');
 assert.equal((await module.createWorldQualityTrial(f.deps).create(input,true)).state,'failed');
 assert.equal((await f.service.poll(input.trialId)).state,'failed');
 assert.equal(f.calls.filter(call=>call[0]==='json'&&call[3]==='POST').length,1);
 assert.equal(f.calls.some(call=>call[0]==='release'),false);
});
test('text scenes validate mode, prompt bounds and image absence before any external action', async t => {
 const f = await fixture(t), input = asText(f.input);
 for (const invalid of [{ ...input, textPrompt: 'too short' }, { ...input, textPrompt: 'x'.repeat(2001) }, { ...input, inputMode: 'video' }, { ...input, images: f.input.images }]) {
  await assert.rejects(() => f.service.create(invalid, true), error => ['INVALID_TEXT','WORLD_INPUT_MODE_INVALID','WORLD_TEXT_IMAGES_FORBIDDEN'].includes(error.code));
 }
 await assert.rejects(() => f.service.create(input, false), { code: 'EXPLICIT_SPEND_CONFIRMATION_REQUIRED' });
 assert.equal(f.calls.length, 0);
});
test('text-only Plus uses the official text payload and3080 reservation without upload or image-safety fiction', async t => {
 const f = await fixture(t), input = asText(f.input); const result = await f.service.create(input, true);
 assert.equal(result.state, 'processing'); assert.equal(result.inputMode, 'text'); assert.equal(result.maxReservedCredits, 3080);
 assert.deepEqual(f.calls.map(call => call[0]), ['reserve','json','json']);
 assert.deepEqual(f.calls[0][1], { trialId: input.trialId, provider: 'worldlabs', credits: 3080 });
 const post = f.calls.at(-1); assert.equal(post[3], 'POST'); assert.deepEqual(post[4].world_prompt, { type: 'text', text_prompt: input.textPrompt });
 assert.equal(post[4].permission.public, false); assert.equal(result.safety.checkedImages, 0); assert.match(result.safety.modelVersion, /not-applicable/);
 assert.equal(result.promptSha256, digest(input.textPrompt)); assert.match(result.evidence, /not a metrically connected/);
 assert.ok(!JSON.stringify(result).includes(input.textPrompt)); assert.deepEqual(result.views, []);
});
test('text credits below the3080 task cost release only unsubmitted trials and billing cannot exceed3080', async t => {
 const f = await fixture(t, { json: async () => ({ remaining_credits: 3079 }) });
 const result = await f.service.create(asText(f.input), true); assert.equal(result.state, 'failed'); assert.equal(result.errorCode, 'PROVIDER_INSUFFICIENT_CREDITS');
 assert.deepEqual(f.calls.map(call => call[0]), ['reserve','release']);
 const g = await fixture(t, { complete: async () => ({ resultId: 'world-result', worldQuality: '500k', cost: 3081, assets: [] }) });
 await g.service.create(asText(g.input), true); await assert.rejects(() => g.service.poll(g.input.trialId), { code: 'WORLD_TRIAL_COST_INVALID' });
 assert.ok(!g.calls.some(call => call[0] === 'settle'));
});
test('text provenance is hashed for dedupe and ambiguous text POST cannot retry across restarts', async t => {
 const f = await fixture(t), input = asText(f.input); await f.service.create(input, true);
 await f.service.create(input, true); assert.equal(f.calls.filter(call => call[0] === 'json' && call[3] === 'POST').length, 1);
 await assert.rejects(() => f.service.create({ ...input, provenance: input.provenance + ' Changed viewpoint.' }, true), { code: 'TRIAL_DEDUPE_MISMATCH' });
 const g = await fixture(t, { json: async (provider, path, method = 'GET') => { g.calls.push(['json',provider,path,method]); if (method === 'POST') throw new AppError('SUBMISSION_AMBIGUOUS',502); return { remaining_credits: 9000 }; } });
 const ambiguous = await g.service.create(asText(g.input), true); assert.equal(ambiguous.state, 'ambiguous');
 const restarted = module.createWorldQualityTrial(g.deps); assert.equal((await restarted.create(asText(g.input), true)).state, 'ambiguous');
 assert.equal((await restarted.poll(g.input.trialId)).state, 'ambiguous'); assert.equal(g.calls.filter(call => call[0] === 'json' && call[3] === 'POST').length, 1);
});

function asSingleImage(input) { const result = { ...input, inputMode: 'single-image', image: { path: input.images[0].path } }; delete result.images; return result; }
test('single-image validates an unambiguous local-file contract before any external action', async t => {
 const f = await fixture(t), input = asSingleImage(f.input);
 for (const image of [undefined, null, [], {}, { path: '' }, { path: ' ' }, { path: 123 }]) {
  await assert.rejects(() => f.service.create({ ...input, image }, true), { code: 'WORLD_SINGLE_IMAGE_INVALID' });
 }
 await assert.rejects(() => f.service.create({ ...input, images: [] }, true), { code: 'WORLD_SINGLE_IMAGE_INVALID' });
 await assert.rejects(() => f.service.create({ ...asText(f.input), image: input.image }, true), { code: 'WORLD_TEXT_IMAGES_FORBIDDEN' });
 await assert.rejects(() => f.service.create({ ...f.input, image: input.image }, true), { code: 'WORLD_VIEWS_INVALID' });
 await assert.rejects(() => f.service.create(input, false), { code: 'EXPLICIT_SPEND_CONFIRMATION_REQUIRED' });
 await writeFile(input.image.path, png(64, 64));
 await assert.rejects(() => f.service.create(input, true), { code: 'IMAGE_DIMENSIONS_INVALID' });
 assert.equal(f.calls.length, 0);
});

test('single-image Plus moderates and uploads the identical bytes once using the official non-pano media-asset payload', async t => {
 let uploadBytes;
 const f = await fixture(t, { upload: async (bytes, mime, label) => { uploadBytes = bytes; f.calls.push(['upload', label, mime]); return 'single-media-asset'; } });
 const input = asSingleImage(f.input), bytes = png(1536, 768); await writeFile(input.image.path, bytes);
 const result = await f.service.create(input, true);
 assert.equal(result.state, 'processing'); assert.equal(result.inputMode, 'single-image'); assert.equal(result.model, 'marble-1.1-plus');
 assert.equal(result.maxReservedCredits, 3080); assert.equal(result.safety.checkedImages, 1); assert.equal(result.safety.modelVersion, 'synthetic-test-only');
 assert.deepEqual(result.views, []); assert.deepEqual(result.referenceImage, { bytes: bytes.length, mime: 'image/png', sha256: digest(bytes) });
 assert.deepEqual(f.calls.map(call => call[0]), ['safety', 'reserve', 'json', 'upload', 'json']); assert.deepEqual(uploadBytes, bytes);
 assert.deepEqual(f.calls.find(call => call[0] === 'reserve')[1], { trialId: input.trialId, provider: 'worldlabs', credits: 3080 });
 const post = f.calls.at(-1); assert.equal(post[3], 'POST'); assert.equal(post[4].permission.public, false);
 assert.deepEqual(post[4].world_prompt, { type: 'image', image_prompt: { source: 'media_asset', media_asset_id: 'single-media-asset' }, text_prompt: input.textPrompt, is_pano: false });
 const saved = JSON.parse(await readFile(join(f.deps.directory, input.trialId, 'job.json'), 'utf8'));
 assert.equal(saved.images[0].sha256, digest(bytes)); assert.equal(saved.input.image, undefined); assert.equal(saved.input.images, undefined);
 assert.deepEqual(await readFile(join(f.deps.directory, input.trialId, saved.images[0].file)), bytes);
 assert.equal(result.promptSha256, digest(input.textPrompt)); assert.equal(result.provenance, input.provenance); assert.match(result.evidence, /Unseen regions are generated interpretations/);
 const raw = JSON.stringify(result); for (const hidden of [input.image.path, input.textPrompt, 'single-media-asset', 'fingerprint', 'upload_url']) assert.ok(!raw.includes(hidden));
});

test('single-image moderation review, missing classifier and mismatched SHA fail closed before reservation, storage or upload', async t => {
 const scenarios = [
  { screen: async ([image]) => ({ ...allowed(image.bytes), decision: 'review' }) },
  { screen: async () => { throw new AppError('PHOTO_SAFETY_UNAVAILABLE', 503); } },
  { screen: async ([image]) => ({ ...allowed(image.bytes), results: [{ ...allowed(image.bytes).results[0], sha256: '0'.repeat(64) }] }) },
 ];
 for (const safety of scenarios) {
  const f = await fixture(t, { safety });
  await assert.rejects(() => f.service.create(asSingleImage(f.input), true), error => ['PHOTO_SAFETY_REVIEW_REQUIRED', 'PHOTO_SAFETY_UNAVAILABLE'].includes(error.code));
  assert.equal(f.calls.length, 0); await assert.rejects(() => stat(join(f.deps.directory, f.input.trialId)), { code: 'ENOENT' });
 }
});

test('single-image admission and settlement use3080 while an unsubmitted failure releases its reservation', async t => {
 const f = await fixture(t, { json: async () => ({ remaining_credits: 3079 }) });
 const result = await f.service.create(asSingleImage(f.input), true); assert.equal(result.state, 'failed'); assert.equal(result.errorCode, 'PROVIDER_INSUFFICIENT_CREDITS');
 assert.deepEqual(f.calls.map(call => call[0]), ['safety', 'reserve', 'release']);
 const g = await fixture(t, { complete: async () => ({ resultId: 'world-result', worldQuality: '500k', cost: 3081, assets: [] }) });
 await g.service.create(asSingleImage(g.input), true); await assert.rejects(() => g.service.poll(g.input.trialId), { code: 'WORLD_TRIAL_COST_INVALID' });
 assert.ok(!g.calls.some(call => call[0] === 'settle'));
});

test('single-image dedupe is content-based across restarts and ambiguous paid submission never repeats', async t => {
 const f = await fixture(t), input = asSingleImage(f.input); const first = await f.service.create(input, true);
 const restarted = module.createWorldQualityTrial(f.deps); assert.equal((await restarted.create(input, true)).operationId, first.operationId);
 assert.equal(f.calls.filter(call => call[0] === 'json' && call[3] === 'POST').length, 1);
 await writeFile(input.image.path, png(768, 768)); await assert.rejects(() => restarted.create(input, true), { code: 'TRIAL_DEDUPE_MISMATCH' });
 const g = await fixture(t, { json: async (provider, path, method = 'GET') => { g.calls.push(['json', provider, path, method]); if (method === 'POST') throw new AppError('SUBMISSION_AMBIGUOUS', 502); return { remaining_credits: 9000 }; } });
 const ambiguousInput = asSingleImage(g.input), ambiguous = await g.service.create(ambiguousInput, true); assert.equal(ambiguous.state, 'ambiguous');
 const recovered = module.createWorldQualityTrial(g.deps); assert.equal((await recovered.create(ambiguousInput, true)).state, 'ambiguous'); assert.equal((await recovered.poll(g.input.trialId)).state, 'ambiguous');
 assert.equal(g.calls.filter(call => call[0] === 'upload').length, 1); assert.equal(g.calls.filter(call => call[0] === 'json' && call[3] === 'POST').length, 1); assert.ok(!g.calls.some(call => call[0] === 'release'));
});

test('single-image world completion preserves provenance and restarts with GET-only downloads and exact settlement', async t => {
 const f = await fixture(t), input = asSingleImage(f.input); await f.service.create(input, true); f.calls.length = 0;
 const restarted = module.createWorldQualityTrial(f.deps), receipt = await restarted.poll(input.trialId);
 assert.equal(receipt.state, 'completed'); assert.equal(receipt.inputMode, 'single-image'); assert.equal(receipt.worldId, 'world-result'); assert.equal(receipt.provenance, input.provenance);
 assert.equal(receipt.quality, '500k'); assert.equal(receipt.colliderStatus, 'available'); assert.equal(receipt.maxReservedCredits, 3080);
 assert.deepEqual(f.calls.map(call => call[0]), ['json', 'settle']); assert.equal(f.calls[0][3], 'GET'); assert.deepEqual(f.calls[1], ['settle', input.trialId, 1600]);
 for (const asset of receipt.assets) assert.equal(digest(await readFile(asset.path)), asset.sha256);
 f.calls.length = 0; await restarted.poll(input.trialId); assert.equal(f.calls.length, 0);
});

test('operator shutdown closes the idle resident classifier by EOF and lets its process exit naturally', async t => {
 const { closeOperatorResources } = await import(pathToFileURL(resolve(root, 'tools/world-quality-trial.mjs')).href);
 const workersKey = Symbol.for('giftportals.image-safety.workers.v1'), previous = globalThis[workersKey];
 const child = spawn(process.execPath, ['-e', "process.stdin.resume(); process.stdin.on('end', () => { process.exitCode = 0; });"], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
 t.after(() => { globalThis[workersKey] = previous; if (child.exitCode === null) child.kill(); });
 globalThis[workersKey] = new Map([['synthetic-owned-worker', { child, queued: 0 }]]);
 let closed = 0; const finished = once(child, 'close', { signal: AbortSignal.timeout(5000) });
 await closeOperatorResources({ close: async () => { closed++; } });
 assert.equal(child.stdin.writableEnded, true); assert.deepEqual(await finished, [0, null]); assert.equal(closed, 1);
});

test('operator failure exits naturally with a sanitized error after closing Vite, including theV10 output route', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'giftportals-operator-exit-')); t.after(() => rm(directory, { recursive: true, force: true }));
 let failure;
 try { await promisify(execFile)(process.execPath, [resolve(root, 'tools/world-quality-trial.mjs'), '--action', 'create', '--confirm-provider-spend', '--manifest', join(directory, 'missing.json'), '--output-version', 'v10'], { cwd: root, timeout: 15000, maxBuffer: 8192, windowsHide: true }); }
 catch (error) { failure = error; }
 assert.ok(failure); assert.equal(failure.code, 1); assert.equal(failure.killed, false); assert.equal(failure.stdout, '');
 assert.deepEqual(JSON.parse(failure.stderr.trim()), { ok: false, error: 'ENOENT', providerSecretsOutput: false });
});
test('secondary100k download is GET-only, same world, separatelyhashed and idempotent after completion', async t => {
 const f = await fixture(t); const original = f.deps.complete;
 const service = module.createWorldQualityTrial({ ...f.deps, complete: async (provider, result, options) => { f.calls.push(['complete',options.worldQuality]); const output = await original(); return { ...output, worldQuality: options.worldQuality }; } });
 await service.create(asText(f.input), true); await service.poll(f.input.trialId); f.calls.length = 0;
 const receipt = await service.poll(f.input.trialId, { include100k: true });
 assert.equal(receipt.state, 'completed'); const asset = receipt.assets.find(asset => asset.suffix === 'spz100k'); assert.ok(asset); assert.equal(digest(await readFile(asset.path)),asset.sha256);
 assert.deepEqual(f.calls.map(call => call[0]), ['json','complete']); assert.equal(f.calls[0][3],'GET'); assert.equal(f.calls[1][1],'100k');
 f.calls.length = 0; await service.poll(f.input.trialId, { include100k: true }); assert.equal(f.calls.length,0);
});
test('100k asset from another world or mismatched billing fails without altering completed500k assets', async t => {
 for (const change of [{ resultId:'another-world' }, { cost:1700 }]) {
  const f = await fixture(t); const original = f.deps.complete;
  const service = module.createWorldQualityTrial({ ...f.deps, complete: async (provider,result,options) => ({ ...await original(), worldQuality:options.worldQuality, ...(options.worldQuality === '100k' ? change : {}) }) });
  await service.create(asText(f.input),true); await service.poll(f.input.trialId);
  await assert.rejects(() => service.poll(f.input.trialId,{include100k:true}), error => ['WORLD_100K_UNAVAILABLE','WORLD_TRIAL_COST_INVALID'].includes(error.code));
  const receipt = await service.poll(f.input.trialId); assert.equal(receipt.state,'completed'); assert.equal(receipt.assets.length,3);
 }
});
test('full-resolution download checks allowed origin, size declaration and SPZ point limits independently of ordinary assets', async () => {
 const blockedFetch = globalThis.fetch;
 try {
  await assert.rejects(() => module.downloadFullResolutionWorld('https://untrusted.example/world.spz'), { code:'PROVIDER_ASSET_ORIGIN_DENIED' });
  globalThis.fetch = async () => new Response('x',{headers:{'content-length':String(50*1024*1024+1)}});
  await assert.rejects(() => module.downloadFullResolutionWorld('https://cdn.worldlabs.ai/world.spz'),{code:'GENERATED_ASSET_SIZE_LIMIT'});
  for (const points of [0,2500001]) {
   const raw=Buffer.alloc(32);raw.write('NGSP');raw.writeUInt32LE(3,4);raw.writeUInt32LE(points,8);
   globalThis.fetch=async()=>new Response(gzipSync(raw));
   await assert.rejects(()=>module.downloadFullResolutionWorld('https://cdn.worldlabs.ai/world.spz'),{code:'PROVIDER_ASSET_INVALID'});
  }
  const raw=Buffer.alloc(32);raw.write('NGSP');raw.writeUInt32LE(3,4);raw.writeUInt32LE(2000000,8);const bytes=gzipSync(raw);
  globalThis.fetch=async()=>new Response(bytes);
  const result=await module.downloadFullResolutionWorld('https://cdn.worldlabs.ai/world.spz');assert.equal(result.sha256,digest(bytes));assert.deepEqual(result.bytes,bytes);
 } finally { globalThis.fetch=blockedFetch; }
});
test('optional full-res uses same completed world GET only and records unavailable or failed without hiding valid500k result', async t => {
 for (const scenario of ['success','unavailable','failed']) {
  const f = await fixture(t); const bytes=Buffer.from('synthetic-full-res');
  const service=module.createWorldQualityTrial({...f.deps,json:async(provider,path,method='GET',body)=>{
   f.calls.push(['json',provider,path,method]);
   if(path==='/credits')return{remaining_credits:9000};if(method==='POST')return{operation_id:'world-operation'};
   return path.startsWith('/operations/')?{done:true,response:{world_id:'world-result'}}:{world_id:'world-result',assets:{splats:{spz_urls:scenario==='unavailable'?{}:{full_res:'https://cdn.worldlabs.ai/private-world.spz'}}}};
  },downloadFullRes:async()=>{f.calls.push(['download-full']);if(scenario==='failed')throw new AppError('GENERATED_ASSET_SIZE_LIMIT',502);return{bytes,sha256:digest(bytes)};}});
  await service.create(asText(f.input),true);await service.poll(f.input.trialId);f.calls.length=0;
  const receipt=await service.poll(f.input.trialId,{includeFullRes:true});assert.equal(receipt.state,'completed');
  assert.equal(receipt.fullResStatus,scenario==='success'?'available':scenario==='failed'?'download-failed':'unavailable');
  assert.ok(f.calls.filter(call=>call[0]==='json').every(call=>call[3]==='GET'));assert.ok(!JSON.stringify(receipt).includes('https://'));
  assert.equal(receipt.assets.length,scenario==='success'?4:3);if(scenario==='success'){const full=receipt.assets.find(asset=>asset.suffix==='spzfull');assert.equal(digest(await readFile(full.path)),full.sha256);}
 }
});
