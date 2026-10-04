import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
async function moduleURL(path, replacements = {}) {
 let js = ts.transpileModule(await readFile(resolve(root, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
 for (const [from, to] of Object.entries(replacements)) js = js.replaceAll(`'${from}'`, JSON.stringify(to));
 return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
}
const rulesURL = await moduleURL('api/_lib/rules.ts'), rules = await import(rulesURL);
const providersURL = await moduleURL('api/_lib/providers.ts', { './rules.js': rulesURL });
const safetyURL = await moduleURL('api/_lib/image-safety.ts', { './rules.js': rulesURL });
const budgetURL = await moduleURL('api/_lib/quality-trial-budget.ts', { './rules.js': rulesURL });
const helperURL = await moduleURL('api/_lib/quality-trial-tripo.ts', { './rules.js': rulesURL, './providers.js': providersURL, './image-safety.js': safetyURL, './quality-trial-budget.js': budgetURL });
const trial = await import(helperURL);
globalThis.fetch = async () => { throw Error('NETWORK_DISABLED_IN_TESTS'); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLRcAAAAASUVORK5CYII=', 'base64');
const glb = Buffer.alloc(12); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(12, 8);
const checked = bytes => ({ protocol: 'giftportals-local-vision-v1', checkedAt: '2026-10-03T00:00:00.000Z', modelVersion: 'synthetic-only', decision: 'allow', results: [{ id: 'object', sha256: sha(bytes), decision: 'allow', category: 'ordinary', modelVersion: 'synthetic-only', scores: { sexual: 0, adultProduct: 0 } }] });
async function fixture(t, overrides = {}) {
 const directory = await mkdtemp(join(tmpdir(), 'giftportals-multiview-')); t.after(() => rm(directory, { recursive: true, force: true }));
 const calls = [], id = 'paris-test-v22';
 const service = trial.createTripoMultiviewTrial({ directory,
  safety: { status: async () => ({ available: true }), screen: async images => { calls.push(['safety', images[0].bytes]); return checked(images[0].bytes); } },
  reserve: async input => { calls.push(['reserve', input]); }, settle: async (...args) => { calls.push(['settle', ...args]); }, release: async (...args) => { calls.push(['release', ...args]); },
  restore: async (...args) => { calls.push(['restore', ...args]); },
  credit: async (...args) => { calls.push(['credit', ...args]); }, upload: async () => { calls.push(['upload']); return 'file_private-token'; },
  json: async (provider, path, method = 'GET', body) => {
   calls.push(['json', provider, path, method, body]);
   if (method === 'POST') return { task_id: path.includes('image-to-multiview') ? 'task_views' : 'task_model' };
   return path.includes('task_views') ? { status: 'success', type: 'generate_multiview_image', credits_consumed: 10, output: Object.fromEntries(['front', 'left', 'back', 'right'].map(view => [`${view}_view_url`, `https://cdn.tripo3d.ai/${view}.png`])) } : { status: 'success', credits_consumed: 60, output: { model_url: 'https://cdn.tripo3d.ai/model.glb' } };
  },
  download: async (url, provider, suffix, kind, mime, options) => { calls.push(['download', url, options]); const bytes = suffix === 'glb' ? glb : image; return { suffix, kind, mime, bytes, sha256: sha(bytes) }; },
  ...overrides });
 const input = { trialId: id, bytes: image, mime: 'image/png', referenceSha256: sha(image), confirmSpend: true };
 return { service, calls, directory, id, input };
}
const posts = calls => calls.filter(call => call[0] === 'json' && call[3] === 'POST');

test('official four-view schema is screened, hash-approved and reused as one H3.1 task, with exact-hash reruns', async t => {
 const f = await fixture(t); const created = await f.service.create(f.input);
 assert.equal(created.viewsStage.taskId, 'task_views'); assert.equal(created.reservedCredits, 100);
 assert.deepEqual(posts(f.calls)[0].slice(1), ['tripo', '/generation/image-to-multiview', 'POST', { input: 'file_private-token' }]);
 await f.service.create(f.input); assert.equal(posts(f.calls).length, 1); assert.equal(f.calls.filter(call => call[0] === 'reserve').length, 1);
 const views = await f.service.poll(f.id); assert.equal(views.approvalRequired, true); assert.deepEqual(Object.keys(views.views), ['front', 'left', 'back', 'right']);
 assert.equal(f.calls.filter(call => call[0] === 'safety').length, 5); assert.equal(f.calls.filter(call => call[0] === 'settle').length, 0);
 assert.equal(JSON.stringify(views).includes('private-token'), false); assert.equal(JSON.stringify(views).includes('cdn.tripo3d.ai'), false);
 assert.ok(f.calls.filter(call => call[0] === 'download').every(call => call[2].maxBytes === 6 * 1024 * 1024));
 await assert.rejects(() => f.service.approve({ trialId: f.id, viewsSha256: '0'.repeat(64), confirmSpend: true }), error => error.code === 'VIEWS_APPROVAL_MISMATCH');
 await f.service.approve({ trialId: f.id, viewsSha256: views.viewsSha256, confirmSpend: true });
 const second = posts(f.calls)[1]; assert.deepEqual(second[4], { inputs: [{ task_id: 'task_views' }], ...trial.TRIPO_MULTIVIEW_TRIAL_SETTINGS });
 assert.deepEqual(second[4].inputs, [{ task_id: 'task_views' }]); assert.equal(second[4].face_limit, 30000); assert.equal(second[4].pbr, true);
 await f.service.approve({ trialId: f.id, viewsSha256: views.viewsSha256, confirmSpend: true }); assert.equal(posts(f.calls).length, 2);
 const done = await f.service.poll(f.id); assert.equal(done.modelStage.state, 'completed'); assert.equal(done.actualCredits, 70);
 assert.deepEqual(f.calls.find(call => call[0] === 'settle'), ['settle', f.id, 70]); assert.equal(sha(await readFile(done.model.path)), done.model.sha256);
 await f.service.poll(f.id); assert.equal(posts(f.calls).length, 2);
});
test('lost create response retains reservation and intention and never resubmits on create/poll', async t => {
 const f = await fixture(t, { json: async () => { throw new rules.AppError('SUBMISSION_AMBIGUOUS', 502); } });
 await assert.rejects(() => f.service.create(f.input), error => error.code === 'SUBMISSION_AMBIGUOUS');
 const job = JSON.parse(await readFile(join(f.directory, 'quality-trials', f.id, 'tripo/job.json')));
 assert.ok(job.viewsStage.submittedAt); assert.equal(job.viewsStage.taskId, undefined);
 const reused = await f.service.create(f.input); assert.equal(reused.viewsStage.errorCode, 'SUBMISSION_AMBIGUOUS');
 await f.service.poll(f.id); assert.equal(f.calls.filter(call => call[0] === 'reserve').length, 1); assert.equal(f.calls.filter(call => call[0] === 'release').length, 0);
});
test('lost model response cannot be repeated even after approved-views retry', async t => {
 let modelPosts = 0; const f = await fixture(t, { json: async (provider, path, method = 'GET') => {
  if (path === '/generation/multiview-to-model') { modelPosts++; throw new rules.AppError('SUBMISSION_AMBIGUOUS', 502); }
  if (method === 'POST') return { task_id: 'task_views' };
  return { status: 'success', type: 'generate_multiview_image', credits_consumed: 10, output: Object.fromEntries(['front', 'left', 'back', 'right'].map(view => [`${view}_view_url`, `https://cdn.tripo3d.ai/${view}.png`])) };
 } });
 await f.service.create(f.input); const views = await f.service.poll(f.id), approval = { trialId: f.id, viewsSha256: views.viewsSha256, confirmSpend: true };
 await assert.rejects(() => f.service.approve(approval), error => error.code === 'SUBMISSION_AMBIGUOUS');
 await f.service.approve(approval); await f.service.poll(f.id); assert.equal(modelPosts, 1); assert.equal(f.calls.filter(call => call[0] === 'settle').length, 0);
});
test('blocked original is never saved, uploaded or reserved', async t => {
 const f = await fixture(t, { safety: { screen: async () => ({ ...checked(image), decision: 'block', results: [{ ...checked(image).results[0], decision: 'block', category: 'sexual' }] }) } });
 await assert.rejects(() => f.service.create(f.input), error => error.code === 'PHOTO_SAFETY_BLOCKED');
 assert.deepEqual(await readdir(join(f.directory, 'quality-trials', f.id, 'tripo')), []); assert.equal(posts(f.calls).length, 0); assert.equal(f.calls.length, 0);
});
test('one unsafe generated side fails the view stage before saving any generated image or generating model', async t => {
 let screens = 0; const f = await fixture(t, { safety: { screen: async images => {
  screens++; return screens === 4 ? { ...checked(images[0].bytes), decision: 'review', results: [{ ...checked(images[0].bytes).results[0], decision: 'review', category: 'uncertain' }] } : checked(images[0].bytes);
 } } });
 await f.service.create(f.input); const result = await f.service.poll(f.id); assert.equal(result.viewsStage.state, 'failed'); assert.equal(result.viewsStage.errorCode, 'PHOTO_SAFETY_REVIEW_REQUIRED');
 assert.deepEqual((await readdir(join(f.directory, 'quality-trials', f.id, 'tripo'))).sort(), ['job.json', 'reference.png']); assert.equal(posts(f.calls).length, 1);
 assert.deepEqual(f.calls.find(call => call[0] === 'settle'), ['settle', f.id, 10]);
});
test('tampered generated image cannot satisfy the approved aggregate hash', async t => {
 const f = await fixture(t); await f.service.create(f.input); const views = await f.service.poll(f.id);
 const changed = Buffer.concat([image, Buffer.from('changed')]); await writeFile(views.views.back.path, changed);
 await assert.rejects(() => f.service.approve({ trialId: f.id, viewsSha256: views.viewsSha256, confirmSpend: true }), error => error.code === 'VIEWS_HASH_MISMATCH');
 assert.equal(posts(f.calls).length, 1);
});
test('fresh-credit failure before any POST releases the held budget and records a terminal trial', async t => {
 const f = await fixture(t, { credit: async () => { throw new rules.AppError('PROVIDER_INSUFFICIENT_CREDITS', 403); } });
 await assert.rejects(() => f.service.create(f.input), error => error.code === 'PROVIDER_INSUFFICIENT_CREDITS');
 assert.equal(posts(f.calls).length, 0); assert.deepEqual(f.calls.find(call => call[0] === 'release'), ['release', f.id]);
 await f.service.create(f.input); assert.equal(f.calls.filter(call => call[0] === 'reserve').length, 1);
});
test('same trial ID with changed reference refuses reuse and requires a new explicit trial', async t => {
 const f = await fixture(t); await f.service.create(f.input); const bytes = Buffer.concat([image, Buffer.from('different')]);
 await assert.rejects(() => f.service.create({ ...f.input, bytes, referenceSha256: sha(bytes) }), error => error.code === 'DEDUPE_MISMATCH'); assert.equal(posts(f.calls).length, 1);
});
test('generated asset download rejects external origins before fetch, retaining checked originals only', async t => {
 const providers = await import(providersURL); let fetched = 0; const saved = globalThis.fetch;
 globalThis.fetch = async () => { fetched++; return new Response(image, { headers: { 'content-length': String(image.length) } }); }; t.after(() => { globalThis.fetch = saved; });
 const f = await fixture(t, { download: providers.downloadAsset, json: async (provider, path, method = 'GET') => method === 'POST' ? { task_id: 'task_views' } : ({ status: 'success', type: 'generate_multiview_image', credits_consumed: 10, output: { front_view_url: 'http://127.0.0.1/private.png' } }) });
 await f.service.create(f.input); const result = await f.service.poll(f.id); assert.equal(result.viewsStage.errorCode, 'PROVIDER_ASSET_ORIGIN_DENIED'); assert.equal(fetched, 0); assert.equal(posts(f.calls).length, 0);
});
test('transient download failure resumes the same task without another paid POST', async t => {
 let downloads = 0; const f = await fixture(t, { download: async (url, provider, suffix, kind, mime) => { if (++downloads === 1) throw new rules.AppError('PROVIDER_DOWNLOAD_FAILED', 502); return { suffix, kind, mime, bytes: image, sha256: sha(image) }; } });
 await f.service.create(f.input); const first = await f.service.poll(f.id); assert.equal(first.viewsStage.state, 'processing'); assert.equal(first.viewsStage.taskId, 'task_views');
 const second = await f.service.poll(f.id); assert.equal(second.viewsStage.state, 'completed'); assert.equal(posts(f.calls).length, 1);
});
test('rejecting approved-safe but visually unsuitable views settles only their actual cost and prevents a model task', async t => {
 const f = await fixture(t); await f.service.create(f.input); const views = await f.service.poll(f.id);
 const rejected = await f.service.reject({ trialId: f.id, viewsSha256: views.viewsSha256 }); assert.ok(rejected.rejectedAt);
 await assert.rejects(() => f.service.approve({ trialId: f.id, viewsSha256: views.viewsSha256, confirmSpend: true }), error => error.code === 'VIEWS_APPROVAL_MISMATCH'); assert.equal(posts(f.calls).length, 1);
 assert.deepEqual(f.calls.find(call => call[0] === 'settle'), ['settle', f.id, 10]);
});
test('the authenticated nested image_to_multiview envelope is normalized to the same four explicit views', async t => {
 const output = Object.fromEntries(['front', 'left', 'back', 'right'].map(view => [`${view}_view_url`, `https://cdn.tripo3d.ai/${view}.png`]));
 assert.deepEqual(trial.tripoMultiviewOutput({ type: 'image_to_multiview', output: { generate_multiview_image: output } }), { front: output.front_view_url, left: output.left_view_url, back: output.back_view_url, right: output.right_view_url });
 assert.throws(() => trial.tripoMultiviewOutput({ type: 'image_to_multiview', output: { ...output, generate_multiview_image: output } }), error => error.code === 'PROVIDER_RESPONSE_INVALID');
 const f = await fixture(t, { json: async (provider, path, method = 'GET') => method === 'POST' ? { task_id: 'task_views' } : ({ status: 'success', type: 'image_to_multiview', credits_consumed: 10, output: { generate_multiview_image: output } }) });
 await f.service.create(f.input); const done = await f.service.poll(f.id); assert.equal(done.viewsStage.state, 'completed'); assert.equal(done.approvalRequired, true); assert.equal(f.calls.filter(call => call[0] === 'download').length, 4);
});
test('a known successful parser-failed task regains its full budget and re-polls without a generation POST', async t => {
 const f = await fixture(t); await f.service.create(f.input);
 const path = join(f.directory, 'quality-trials', f.id, 'tripo/job.json'), job = JSON.parse(await readFile(path));
 job.viewsStage.state = 'failed'; job.viewsStage.errorCode = 'PROVIDER_RESPONSE_INVALID'; job.viewsStage.credits = 10; await writeFile(path, JSON.stringify(job));
 const before = posts(f.calls).length, recovered = await f.service.recover(f.id);
 assert.equal(recovered.viewsStage.taskId, 'task_views'); assert.equal(recovered.viewsStage.state, 'completed'); assert.equal(recovered.approvalRequired, true);
 assert.deepEqual(f.calls.find(call => call[0] === 'restore'), ['restore', f.id, 10]); assert.equal(posts(f.calls).length, before);
 assert.ok(f.calls.findIndex(call => call[0] === 'restore') < f.calls.findIndex(call => call[0] === 'download'));
});
test('recovery refuses ambiguous POST or budget restoration failure and never generates a replacement task', async t => {
 const f = await fixture(t, { restore: async () => { throw new rules.AppError('LOCAL_GENERATION_BUDGET', 429); } }); await f.service.create(f.input);
 const path = join(f.directory, 'quality-trials', f.id, 'tripo/job.json'), job = JSON.parse(await readFile(path));
 job.viewsStage.state = 'failed'; job.viewsStage.errorCode = 'SUBMISSION_AMBIGUOUS'; job.viewsStage.credits = 10; await writeFile(path, JSON.stringify(job));
 await assert.rejects(() => f.service.recover(f.id), error => error.code === 'TRIAL_RECOVERY_DENIED');
 job.viewsStage.errorCode = 'PROVIDER_RESPONSE_INVALID'; await writeFile(path, JSON.stringify(job));
 await assert.rejects(() => f.service.recover(f.id), error => error.code === 'LOCAL_GENERATION_BUDGET');
 assert.equal(posts(f.calls).length, 1); assert.equal(f.calls.filter(call => call[0] === 'download').length, 0);
 assert.equal(JSON.parse(await readFile(path)).viewsStage.state, 'failed');
});
test('GET-only inspection reports schema types and excludes all provider asset URL values', async t => {
 const f = await fixture(t); await f.service.create(f.input); const before = posts(f.calls).length, result = await f.service.inspect(f.id);
 assert.equal(result.generationRequests, 0); assert.equal(result.providerURLsOutput, false); assert.equal(result.providerType, 'generate_multiview_image'); assert.deepEqual(result.outputShape.fields.front_view_url, { type: 'string' });
 assert.equal(JSON.stringify(result).includes('https://'), false); assert.equal(posts(f.calls).length, before);
});
