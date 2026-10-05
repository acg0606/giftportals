import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createTSLoader, here } from './cloud-instant-test-loader.mjs';
const load = createTSLoader();
const { createKeepsakeSyncService, createKeepsakeSyncStorage, runKeepsakeSyncRequest, keepsakeSyncSettings, MAX_SYNCED_KEEPSAKES } = await load(resolve(here, '_lib/keepsake-sync.ts'));
const { tryKeepsakeSyncPreviewRelay } = await load(resolve(here, '_lib/keepsake-sync-preview-relay.ts'));
const ownerA = { id: '10000000-0000-4000-8000-000000000001', demo: false };
const ownerB = { id: '10000000-0000-4000-8000-000000000002', demo: false };
const id = '20000000-0000-4000-8000-000000000001', otherId = '20000000-0000-4000-8000-000000000002';
const token = 'A'.repeat(43), tokenHash = createHash('sha256').update(token).digest('hex');
const current = Date.parse('2026-10-05T12:00:00Z'), expiry = current + 7 * 86400_000;
const settings = { bucket: 'gp-keepsake-sync-offline-tests', key: Buffer.alloc(32, 9), origin: 'https://preview.example' };
const reference = { id, token, expiresAt: expiry / 1000 };
const job = () => ({ id, state: 'partial', expires_at: new Date(expiry).toISOString(), document: { photoSafety: { decision: 'allow', results: [{ decision: 'allow', category: 'ordinary' }] } }, stages: { tripo: { state: 'completed' }, worldlabs: { state: 'failed' } }, assets: { model: { mime: 'model/gltf-binary', bytes: 1234, path: `${id}/generated/${'a'.repeat(64)}.glb` } } });
function fixture() {
  const objects = new Map(), calls = [];
  let value = job(), clock = current;
  const storage = {
    async list(prefix, limit) { calls.push(['list', prefix, limit]); return [...objects.keys()].filter(path => path.startsWith(prefix + '/')).map(path => path.slice(prefix.length + 1)).sort().slice(0, limit); },
    async read(path) { calls.push(['read', path]); return objects.get(path) ?? null; },
    async write(path, contents) { calls.push(['write', path]); objects.set(path, contents); },
    async remove(path) { calls.push(['remove', path]); objects.delete(path); },
  };
  const deps = { settings, storage, repository: { async get(jobId, hash) { calls.push(['get', jobId, hash]); if (jobId !== id || hash !== tokenHash) throw Object.assign(new Error('Unavailable'), { code: 'JOB_UNAVAILABLE' }); return structuredClone(value); } }, now: () => clock };
  return { objects, calls, deps, service: createKeepsakeSyncService(deps), setJob(next) { value = next; }, setClock(next) { clock = next; } };
}
const reject = (promise, code) => assert.rejects(promise, error => error.code === code);
const req = (method = 'POST', extra = {}) => ({ method, headers: { host: 'preview.example', origin: 'https://preview.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, ...extra });

test('save stores only authenticated ciphertext and deduplicates while retaining server expiry', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.save(ownerA, { id, token }), { reference });
  const first = f.objects.get(`${ownerA.id}/${id}.json`);
  assert.ok(first); assert.doesNotMatch(first, new RegExp(token)); assert.ok(!first.includes(String(expiry / 1000)));
  assert.deepEqual(Object.keys(JSON.parse(first)).sort(), ['ciphertext', 'iv', 'tag', 'version']);
  assert.deepEqual(await f.service.save(ownerA, { id, token }), { reference });
  assert.equal(f.objects.size, 1); assert.notEqual(f.objects.get(`${ownerA.id}/${id}.json`), first);
  assert.deepEqual(await f.service.list(ownerA), { references: [reference] });
  assert.ok(f.calls.filter(([kind]) => kind === 'get').every(call => call[2] === tokenHash));
});

test('two verified accounts share no references or remove authority', async () => {
  const f = fixture(); await f.service.save(ownerA, { id, token });
  assert.deepEqual(await f.service.list(ownerB), { references: [] });
  await f.service.remove(ownerB, { id });
  assert.equal(f.objects.size, 1); assert.deepEqual(await f.service.list(ownerA), { references: [reference] });
  await f.service.save(ownerB, { id, token });
  assert.equal(f.objects.size, 2); await f.service.remove(ownerA, { id });
  assert.deepEqual(await f.service.list(ownerA), { references: [] });
  assert.deepEqual(await f.service.list(ownerB), { references: [reference] });
});

test('AAD rejects ciphertext copied to another account or job and rejects tag tampering', async () => {
  for (const tamper of ['owner', 'job', 'tag']) {
    const f = fixture(); await f.service.save(ownerA, { id, token });
    const original = f.objects.get(`${ownerA.id}/${id}.json`);
    if (tamper === 'owner') f.objects.set(`${ownerB.id}/${id}.json`, original);
    if (tamper === 'job') { f.objects.clear(); f.objects.set(`${ownerA.id}/${otherId}.json`, original); }
    if (tamper === 'tag') { const envelope = JSON.parse(original); const tag = Buffer.from(envelope.tag, 'base64'); tag[0] ^= 1; envelope.tag = tag.toString('base64'); f.objects.set(`${ownerA.id}/${id}.json`, JSON.stringify(envelope)); }
    await reject(f.service.list(tamper === 'owner' ? ownerB : ownerA), 'SYNC_RECORD_INVALID');
  }
});

test('save checks capability, completed model, approved inputs and existing server lifetime', async () => {
  const cases = [
    ['JOB_EXPIRED', value => { value.expires_at = new Date(current - 1).toISOString(); }],
    ['JOB_EXPIRED', value => { value.state = 'expired'; }],
    ['GIFT_NOT_READY', value => { value.state = 'awaiting_upload'; }],
    ['GIFT_NOT_READY', value => { value.stages.tripo.state = 'processing'; }],
    ['GIFT_NOT_READY', value => { delete value.assets.model; }],
    ['GIFT_NOT_READY', value => { value.assets.model.path = `${otherId}/generated/${'a'.repeat(64)}.glb`; }],
    ['GIFT_NOT_READY', value => { value.document.photoSafety.decision = 'review'; }],
    ['GIFT_NOT_READY', value => { value.document.photoSafety.results = []; }],
    ['GIFT_NOT_READY', value => { value.document.photoSafety.results[0].category = 'uncertain'; }],
    ['GIFT_NOT_READY', value => { value.state = 'processing'; }],
  ];
  for (const [code, change] of cases) {
    const f = fixture(), value = job(); change(value); f.setJob(value);
    await reject(f.service.save(ownerA, { id, token }), code); assert.equal(f.objects.size, 0);
  }
  const f = fixture(); await reject(f.service.save(ownerA, { id, token: 'B'.repeat(43) }), 'JOB_UNAVAILABLE');
  const value = job(); value.state = 'processing'; value.document.worldRetry = { attempt: 1 }; f.setJob(value);
  assert.deepEqual(await f.service.save(ownerA, { id, token }), { reference });
});

test('expired list entries are filtered without extending, deleting or advancing cloud jobs', async () => {
  const f = fixture(); await f.service.save(ownerA, { id, token }); f.calls.length = 0; f.setClock(expiry);
  assert.deepEqual(await f.service.list(ownerA), { references: [] });
  assert.ok(f.calls.every(([kind]) => ['list', 'read'].includes(kind))); assert.equal(f.objects.size, 1);
  await f.service.remove(ownerA, { id }); assert.equal(f.objects.size, 0);
  assert.ok(f.calls.every(([kind]) => ['list', 'read', 'remove'].includes(kind)));
});

test('JSON cannot select another owner, expand fields, provide paths or bypass personal sign-in', async () => {
  for (const input of [{ id, token, ownerId: ownerB.id }, { id, token, expiresAt: expiry }, { id: '../other', token }, { id, token: 'short' }, []]) {
    const f = fixture(); await assert.rejects(f.service.save(ownerA, input)); assert.equal(f.objects.size, 0);
  }
  for (const method of ['list', 'save', 'remove']) {
    const f = fixture(); await reject(f.service[method]({ ...ownerA, demo: true }, { id, token }), 'DEMO_READ_ONLY'); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); await reject(f.service.remove(ownerA, { id, ownerId: ownerB.id }), 'INVALID_BODY'); assert.equal(f.calls.length, 0);
});

test('account record bound and malformed storage listings fail closed', async () => {
  const f = fixture();
  for (let i = 0; i < MAX_SYNCED_KEEPSAKES + 1; i++) f.objects.set(`${ownerA.id}/${String(i).padStart(8, '0')}-0000-4000-8000-000000000000.json`, '{}');
  await reject(f.service.list(ownerA), 'KEEPSAKE_SYNC_LIMIT');
  await reject(f.service.save(ownerA, { id, token }), 'KEEPSAKE_SYNC_LIMIT');
  const invalid = fixture(); invalid.objects.set(`${ownerA.id}/../other-account.json`, '{}');
  await reject(invalid.service.list(ownerA), 'SYNC_RECORD_INVALID');
});

test('sync request enforces method, exact same origin, JSON and body bounds before storage', async () => {
  const rejected = [
    ['keepsakes-save', req('GET'), { id, token }, 'METHOD_NOT_ALLOWED'],
    ['keepsakes-list', req('POST'), undefined, 'METHOD_NOT_ALLOWED'],
    ['keepsakes-save', req('POST', { headers: { host: 'preview.example', 'content-type': 'application/json' } }), { id, token }, 'ORIGIN_DENIED'],
    ['keepsakes-save', req('POST', { headers: { host: 'other.example', origin: 'https://preview.example', 'content-type': 'application/json' } }), { id, token }, 'ORIGIN_DENIED'],
    ['keepsakes-list', req('GET', { headers: { host: 'preview.example', 'sec-fetch-site': 'cross-site' } }), undefined, 'ORIGIN_DENIED'],
    ['keepsakes-save', req('POST', { headers: { host: 'preview.example', origin: 'https://preview.example', 'content-type': 'image/png' } }), { id, token }, 'INVALID_BODY'],
    ['keepsakes-save', req(), { id, token: 'A'.repeat(3000) }, 'BODY_TOO_LARGE'],
  ];
  for (const [action, request, input, code] of rejected) {
    const f = fixture(); await reject(runKeepsakeSyncRequest(action, request, ownerA, f.deps, input), code); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); assert.deepEqual(await runKeepsakeSyncRequest('keepsakes-save', req(), ownerA, f.deps, { id, token }), { reference });
  assert.deepEqual(await runKeepsakeSyncRequest('keepsakes-list', req('GET'), ownerA, f.deps), { references: [reference] });
});

test('feature is preview-gated with strict new-bucket prefix, key and platform hosts', () => {
  const env = { ENABLE_KEEPSAKE_SYNC: 'true', KEEPSAKE_SYNC_BUCKET: settings.bucket, KEEPSAKE_SYNC_ENCRYPTION_KEY: settings.key.toString('base64'), VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'branch-name.vercel.app', VERCEL_URL: 'unique-preview.vercel.app' };
  const result = keepsakeSyncSettings(env); assert.equal(result.origin, 'https://branch-name.vercel.app');
  assert.deepEqual(result.allowedOrigins, ['https://branch-name.vercel.app', 'https://unique-preview.vercel.app']);
  for (const change of [{ ENABLE_KEEPSAKE_SYNC: 'false' }, { VERCEL_ENV: 'production' }, { KEEPSAKE_SYNC_BUCKET: 'giftportals-private' }, { KEEPSAKE_SYNC_BUCKET: 'gp-keepsake-sync-' }, { KEEPSAKE_SYNC_ENCRYPTION_KEY: 'weak' }, { KEEPSAKE_SYNC_ORIGIN: 'http://preview.example' }, { KEEPSAKE_SYNC_ORIGIN: 'https://preview.example/path' }, { KEEPSAKE_SYNC_ORIGIN: 'https://user:pass@preview.example' }, { VERCEL_BRANCH_URL: 'branch.vercel.app.evil.test', VERCEL_URL: undefined }]) assert.equal(keepsakeSyncSettings({ ...env, ...change }), undefined);
});

test('both exact Vercel aliases work while mixing their host and Origin is denied', async () => {
  const f = fixture(); f.deps.settings = { ...settings, allowedOrigins: ['https://branch.vercel.app', 'https://unique.vercel.app'] };
  for (const host of ['branch.vercel.app', 'unique.vercel.app']) assert.deepEqual(await runKeepsakeSyncRequest('keepsakes-list', req('GET', { headers: { host, origin: `https://${host}` } }), ownerA, f.deps), { references: [] });
  await reject(runKeepsakeSyncRequest('keepsakes-list', req('GET', { headers: { host: 'branch.vercel.app', origin: 'https://unique.vercel.app' } }), ownerA, f.deps), 'ORIGIN_DENIED');
});

test('Storage adapter verifies a private existing bucket and never creates or changes one', async () => {
  for (const isPublic of [true, false]) {
    const calls = [], objects = new Map();
    const target = {
      async list(prefix, options) { calls.push(['list', prefix, options]); return { data: [], error: null }; },
      async upload(path, content, options) { calls.push(['upload', path, options]); objects.set(path, content); return { data: {}, error: null }; },
      async download(path) { calls.push(['download', path]); return { data: new Blob([objects.get(path)]), error: null }; },
      async remove(paths) { calls.push(['remove', paths]); return { data: [], error: null }; },
    };
    const client = { storage: { from(bucket) { assert.equal(bucket, settings.bucket); return target; }, async getBucket(bucket) { calls.push(['getBucket', bucket]); return { data: { id: bucket, public: isPublic }, error: null }; } } };
    const storage = createKeepsakeSyncStorage(client, settings.bucket);
    if (isPublic) { await reject(storage.write(`${ownerA.id}/${id}.json`, '{}'), 'KEEPSAKE_SYNC_UNAVAILABLE'); assert.deepEqual(calls.map(([kind]) => kind), ['getBucket']); }
    else { await storage.write(`${ownerA.id}/${id}.json`, '{}'); assert.equal(await storage.read(`${ownerA.id}/${id}.json`), '{}'); await storage.list(ownerA.id, 100); await storage.remove(`${ownerA.id}/${id}.json`); assert.equal(calls.filter(([kind]) => kind === 'getBucket').length, 1); assert.deepEqual(calls.find(([kind]) => kind === 'upload')[2], { contentType: 'application/json', upsert: true, cacheControl: '0' }); }
  }
});

test('storage failure leaves local input untouched and error copy contains no credentials', async () => {
  const f = fixture(), input = { id, token }, before = structuredClone(input);
  f.deps.storage.write = async () => { throw new Error('offline'); };
  await assert.rejects(f.service.save(ownerA, input)); assert.deepEqual(input, before); assert.equal(f.objects.size, 0);
  const bad = fixture(); bad.objects.set(`${ownerA.id}/${id}.json`, JSON.stringify({ version: 1, iv: 'secret', tag: 'secret', ciphertext: 'secret' }));
  await assert.rejects(bad.service.list(ownerA), error => error.code === 'SYNC_RECORD_INVALID' && !error.message.includes(token) && !error.message.includes('secret'));
});

test('public API derives storage owner from verified identity and rejects unauthenticated/demo/production requests', async t => {
  const cloudStub = `export const cloudConfigured=()=>true;export const unwrap=r=>r.data;export const cloud=()=>globalThis.__keepsakeApiState.client;export const authContext=async authorization=>{const state=globalThis.__keepsakeApiState;state.calls.push(['auth',authorization]);const actor=state.actors[authorization];if(!actor)throw new globalThis.__keepsakeApiError('SIGN_IN_REQUIRED',401);return{service:state.client,client:state.client,user:{id:actor.id},profile:{is_demo:actor.demo}};};`;
  const repoStub = `export const createCloudInstantRepository=()=>({get:async(id,hash)=>{const state=globalThis.__keepsakeApiState;state.calls.push(['get',id,hash]);if(id!==state.job.id||hash!==state.tokenHash)throw new globalThis.__keepsakeApiError('JOB_UNAVAILABLE',404);return structuredClone(state.job);}});`;
  const apiLoad = createTSLoader(new Map([[resolve(here, '_lib/cloud.ts'), cloudStub], [resolve(here, '_lib/cloud-instant-adapters.ts'), repoStub]]));
  const { AppError } = await apiLoad(resolve(here, '_lib/rules.ts'));
  globalThis.__keepsakeApiError = AppError;
  const { default: handler } = await apiLoad(resolve(here, 'giftportals.ts'));
  const savedEnv = Object.fromEntries(['ENABLE_KEEPSAKE_SYNC', 'KEEPSAKE_SYNC_BUCKET', 'KEEPSAKE_SYNC_ENCRYPTION_KEY', 'KEEPSAKE_SYNC_ORIGIN', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_BRANCH_URL'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } delete globalThis.__keepsakeApiState; delete globalThis.__keepsakeApiError; });
  Object.assign(process.env, { ENABLE_KEEPSAKE_SYNC: 'true', KEEPSAKE_SYNC_BUCKET: settings.bucket, KEEPSAKE_SYNC_ENCRYPTION_KEY: settings.key.toString('base64'), KEEPSAKE_SYNC_ORIGIN: settings.origin, VERCEL_ENV: 'preview' });
  delete process.env.VERCEL_URL; delete process.env.VERCEL_BRANCH_URL;
  const objects = new Map(), calls = [];
  const target = {
    async list(prefix, options) { calls.push(['storage-list', prefix]); return { data: [...objects.keys()].filter(path => path.startsWith(prefix + '/')).map(path => ({ name: path.slice(prefix.length + 1) })).slice(0, options.limit), error: null }; },
    async upload(path, contents) { calls.push(['storage-write', path]); objects.set(path, contents); return { data: {}, error: null }; },
    async download(path) { return { data: new Blob([objects.get(path)]), error: null }; },
    async remove(paths) { calls.push(['storage-remove', ...paths]); for (const path of paths) objects.delete(path); return { data: [], error: null }; },
  };
  const value = job(); value.expires_at = new Date(Date.now() + 86400_000).toISOString();
  globalThis.__keepsakeApiState = { job: value, tokenHash, calls, actors: { 'Bearer account-a': ownerA, 'Bearer account-b': ownerB, 'Bearer demo': { ...ownerA, demo: true } }, client: { storage: { from(bucket) { assert.equal(bucket, settings.bucket); return target; }, async getBucket(bucket) { return { data: { id: bucket, public: false }, error: null }; } }, from() { throw Error('No database mutation is allowed.'); } } };
  const response = () => ({ headers: {}, statusCode: 0, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } });
  async function request(action, authorization, input) {
    const result = response(), method = action === 'keepsakes-list' || action === 'status' ? 'GET' : 'POST';
    await handler({ ...req(method), url: `/api/giftportals?action=${action}`, headers: { ...req().headers, ...(authorization ? { authorization } : {}) }, body: input }, result);
    assert.equal(result.headers['Cache-Control'], 'no-store'); assert.equal(result.headers['Referrer-Policy'], 'no-referrer'); return result;
  }
  assert.equal((await request('keepsakes-save', 'Bearer account-a', { id, token })).statusCode, 200);
  assert.deepEqual((await request('keepsakes-list', 'Bearer account-b')).body.data.references, []);
  await request('keepsakes-remove', 'Bearer account-b', { id }); assert.equal(objects.size, 1);
  assert.equal((await request('keepsakes-save', 'Bearer account-a', { id, token, ownerId: ownerB.id })).body.error.code, 'INVALID_BODY');
  assert.equal((await request('keepsakes-list')).statusCode, 401);
  assert.equal((await request('keepsakes-list', 'Bearer demo')).statusCode, 403);
  assert.equal((await request('status')).body.data.keepsakeSyncEnabled, true);
  process.env.VERCEL_ENV = 'production';
  assert.equal((await request('status')).body.data.keepsakeSyncEnabled, false);
  assert.equal((await request('keepsakes-list', 'Bearer account-a')).body.error.code, 'KEEPSAKE_SYNC_UNAVAILABLE');
  assert.equal(objects.size, 1); assert.ok(calls.filter(([kind]) => kind === 'get').every(call => call[2] === tokenHash));
});

const relayEnv = { ENABLE_KEEPSAKE_SYNC: 'true', VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'branch-preview.vercel.app', VERCEL_URL: 'unique-preview.vercel.app', KEEPSAKE_SYNC_RELAY_URL: 'https://oqmzwznadfuxybtstzzz.supabase.co/functions/v1/gp-keepsake-sync-preview-20261005', KEEPSAKE_SYNC_RELAY_KEY: 'synthetic-relay-secret-for-offline-tests', SUPABASE_ANON_KEY: 'synthetic-public-key-for-offline-tests' };
const relayRequest = (action, method = 'GET', extra = {}) => ({ method, url: `/api/giftportals?action=${action}`, headers: { host: 'branch-preview.vercel.app', origin: 'https://branch-preview.vercel.app', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, ...extra });
const relayResponse = () => ({ headers: {}, statusCode: 0, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = JSON.parse(body); } });
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('preview relay forwards only selected credentials to fixed Edge URL and preserves no-store envelope', async () => {
  const calls = [], result = relayResponse(), request = relayRequest('keepsakes-save', 'POST', { body: { id, token }, headers: { ...relayRequest('x').headers, authorization: 'Bearer account-a', cookie: 'private-cookie-not-forwarded' } });
  const fetcher = async (url, init) => { calls.push([url, init]); return jsonResponse({ ok: true, data: { reference } }); };
  assert.equal(await tryKeepsakeSyncPreviewRelay(request, result, 'giftportals', fetcher, relayEnv), true);
  const [url, init] = calls[0]; assert.equal(new URL(url).origin + new URL(url).pathname, relayEnv.KEEPSAKE_SYNC_RELAY_URL);
  assert.equal(new URL(url).searchParams.get('service'), 'giftportals'); assert.equal(init.headers.Authorization, 'Bearer account-a'); assert.equal(init.headers['X-GiftPortals-Relay-Key'], relayEnv.KEEPSAKE_SYNC_RELAY_KEY);
  assert.equal(init.headers['X-GiftPortals-Preview-Host'], request.headers.host); assert.equal(init.headers.Cookie, undefined); assert.equal(init.headers.cookie, undefined);
  assert.deepEqual(JSON.parse(init.body), { id, token }); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.method, 'POST');
  assert.equal(result.headers['Cache-Control'], 'no-store'); assert.equal(result.headers['Referrer-Policy'], 'no-referrer'); assert.deepEqual(result.body, { ok: true, data: { reference } });
});

test('relay permits only capability GET snapshots and cannot call generation even if keys are present', async () => {
  const calls = [], fetcher = async (url, init) => { calls.push([url, init]); return jsonResponse({ ok: true, data: { state: 'partial' } }); };
  const env = { ...relayEnv, TRIPO_API_KEY: 'synthetic-unusable', WORLD_LABS_API_KEY: 'synthetic-unusable', ENABLE_CLOUD_GENERATION: 'true' };
  for (const action of ['job', 'snapshot']) {
    const request = relayRequest(action, 'GET', { url: `/api/instant-cloud?action=${action}&id=${id}`, headers: { ...relayRequest('x').headers, 'x-instant-token': token } });
    assert.equal(await tryKeepsakeSyncPreviewRelay(request, relayResponse(), 'instant-cloud', fetcher, env), true);
    assert.equal(calls.at(-1)[1].headers['X-Instant-Token'], token); assert.equal(calls.at(-1)[1].method, 'GET');
  }
  const count = calls.length;
  for (const action of ['prepare', 'advance', 'finalize', 'retry-world', 'world-diagnostics', 'create']) await reject(tryKeepsakeSyncPreviewRelay(relayRequest(action, 'POST', { body: { id } }), relayResponse(), 'instant-cloud', fetcher, env), 'PREVIEW_READ_ONLY');
  for (const action of ['generate', 'retry', 'memory', 'upload', 'share', 'claim', 'revoke', 'discovery', 'restore']) await reject(tryKeepsakeSyncPreviewRelay(relayRequest(action, 'POST', { body: { id } }), relayResponse(), 'giftportals', fetcher, env), 'PREVIEW_READ_ONLY');
  assert.equal(calls.length, count); assert.equal(await tryKeepsakeSyncPreviewRelay(relayRequest('status'), relayResponse(), 'instant-cloud', fetcher, env), false);
});

test('relay is disabled in production and cannot become a generic URL or service proxy', async () => {
  let calls = 0; const fetcher = async () => { calls++; throw Error('Unexpected call'); };
  for (const change of [{ VERCEL_ENV: 'production' }, { ENABLE_KEEPSAKE_SYNC: 'false' }, { KEEPSAKE_SYNC_RELAY_URL: undefined }]) assert.equal(await tryKeepsakeSyncPreviewRelay(relayRequest('status'), relayResponse(), 'giftportals', fetcher, { ...relayEnv, ...change }), false);
  for (const change of [{ KEEPSAKE_SYNC_RELAY_URL: 'https://evil.example/functions/v1/fake' }, { KEEPSAKE_SYNC_RELAY_URL: `${relayEnv.KEEPSAKE_SYNC_RELAY_URL}?secret=bad` }, { KEEPSAKE_SYNC_RELAY_KEY: 'short' }, { SUPABASE_ANON_KEY: undefined }]) await reject(tryKeepsakeSyncPreviewRelay(relayRequest('status'), relayResponse(), 'giftportals', fetcher, { ...relayEnv, ...change }), 'KEEPSAKE_SYNC_UNAVAILABLE');
  await reject(tryKeepsakeSyncPreviewRelay(relayRequest('status', 'GET', { url: '/api/giftportals?action=status&service=instant-cloud' }), relayResponse(), 'giftportals', fetcher, relayEnv), 'INVALID_BODY'); assert.equal(calls, 0);
});

test('relay checks exact platform host/origin, method, body and credentials before forwarding', async () => {
  const base = relayRequest('signup', 'POST', { body: { email: 'synthetic@example.invalid', password: 'synthetic-test-only' } });
  const cases = [
    [{ headers: { ...base.headers, host: 'branch-preview.vercel.app.evil.test' } }, 'ORIGIN_DENIED'],
    [{ headers: { ...base.headers, origin: 'https://unique-preview.vercel.app' } }, 'ORIGIN_DENIED'],
    [{ headers: { ...base.headers, origin: undefined } }, 'ORIGIN_DENIED'],
    [{ headers: { ...base.headers, 'sec-fetch-site': 'cross-site' } }, 'ORIGIN_DENIED'],
    [{ method: 'GET' }, 'METHOD_NOT_ALLOWED'],
    [{ body: '{' }, 'INVALID_JSON'],
    [{ body: { value: 'x'.repeat(17000) } }, 'BODY_TOO_LARGE'],
    [{ headers: { ...base.headers, 'content-type': 'text/plain' } }, 'INVALID_BODY'],
    [{ headers: { ...base.headers, authorization: 'Bearer invalid\r\nheader' } }, 'INVALID_SESSION'],
  ];
  let calls = 0; const fetcher = async () => { calls++; return jsonResponse({ ok: true, data: {} }); };
  for (const [extra, code] of cases) await reject(tryKeepsakeSyncPreviewRelay({ ...base, ...extra }, relayResponse(), 'giftportals', fetcher, relayEnv), code);
  assert.equal(calls, 0);
  assert.equal(await tryKeepsakeSyncPreviewRelay(relayRequest('status', 'GET', { headers: { host: 'unique-preview.vercel.app' } }), relayResponse(), 'giftportals', fetcher, relayEnv), true);
});

test('relay drops arbitrary upstream headers/error fields and bounds remote data and error copy', async () => {
  const safe = relayResponse();
  await tryKeepsakeSyncPreviewRelay(relayRequest('keepsakes-list'), safe, 'giftportals', async () => jsonResponse({ ok: false, error: { code: 'INVALID_SESSION', message: 'Please sign in again.', diagnostic: 'private-upstream' } }, 401), relayEnv);
  assert.equal(safe.statusCode, 401); assert.deepEqual(safe.body, { ok: false, error: { code: 'INVALID_SESSION', message: 'Please sign in again.' } });
  for (const response of [new Response('<html>private-upstream</html>'), jsonResponse({ ok: false, error: { code: 'PRIVATE diagnostics', message: 'private-upstream' } }, 500), jsonResponse({ ok: true, data: 'x'.repeat(1024 * 1024 + 1) }), jsonResponse({ ok: true, data: 'private-upstream' }, 500)]) await assert.rejects(tryKeepsakeSyncPreviewRelay(relayRequest('status'), relayResponse(), 'giftportals', async () => response, relayEnv), error => error.code === 'KEEPSAKE_SYNC_UNAVAILABLE' && !error.message.includes('private-upstream'));
  await assert.rejects(tryKeepsakeSyncPreviewRelay(relayRequest('status'), relayResponse(), 'giftportals', async () => { throw Error('private transport diagnostic'); }, relayEnv), error => error.code === 'KEEPSAKE_SYNC_UNAVAILABLE' && !error.message.includes('private'));
});
