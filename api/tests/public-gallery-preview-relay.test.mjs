import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createTSLoader, here } from './cloud-instant-test-loader.mjs';
const { tryPublicGalleryPreviewRelay, PUBLIC_GALLERY_PREVIEW_TIMEOUT_MS } = await createTSLoader()(resolve(here, '_lib/public-gallery-preview-relay.ts'));
const relay = 'https://oqmzwznadfuxybtstzzz.supabase.co/functions/v1/gp-souvenir-v11-preview-20261005';
const host = 'giftportals-gallery-test.vercel.app', origin = `https://${host}`;
const id = '10000000-0000-4000-8000-000000000001', token = 'A'.repeat(43);
const owner = `${'B'.repeat(43)}.${'C'.repeat(43)}`, protection = 'e30.eyJ0ZXN0Ijp0cnVlfQ.dGVzdA';
const cookie = `__Host-gp_instant_owner=${owner}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`;
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/version-11', ENABLE_PUBLIC_GALLERY: 'true',
  PUBLIC_GALLERY_PREVIEW_RELAY_URL: relay, PUBLIC_GALLERY_PREVIEW_RELAY_KEY: 'K'.repeat(43), SUPABASE_ANON_KEY: 'P'.repeat(43),
  VERCEL_URL: host, VERCEL_BRANCH_URL: 'giftportals-gallery-branch.vercel.app' };
function request(action = 'status', extra = {}) {
  const { headers = {}, ...rest } = extra;
  return { method: 'GET', url: `/api/instant-cloud?action=${action}`, ...rest,
    headers: { host, origin, 'sec-fetch-site': 'same-origin', ...headers } };
}
function response() {
  return { statusCode: 0, headers: {}, body: '', setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = value; } };
}
const success = (data = {}, headers = {}) => new Response(JSON.stringify({ ok: true, data }), { headers: { 'Content-Type': 'application/json', ...headers } });
const failure = (code) => new Response(JSON.stringify({ ok: false, error: { code, message: 'Please try again.' } }), { status: 409, headers: { 'Content-Type': 'application/json' } });
const reject = (promise, code) => assert.rejects(promise, error => error.code === code);
const prepare = () => ({ photoIntent: 'place', publicGalleryConsent: true, publicGalleryConsentVersion: 'giftportals-public-souvenir-v11', story: 'A public landscape.', requestToken: token });
const post = (action, body = { id }, headers = {}) => request(action, { method: 'POST', body, headers: { 'content-type': 'application/json', ...(action === 'prepare' ? {} : { 'x-instant-token': token }), ...headers } });

test('production, disabled and unconfigured previews never contact or forward credentials', async () => {
  for (const change of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: 'development' }, { ENABLE_PUBLIC_GALLERY: 'false' }, { PUBLIC_GALLERY_PREVIEW_RELAY_URL: undefined }]) {
    const res = response();
    assert.equal(await tryPublicGalleryPreviewRelay(post('prepare', prepare()), res, 'instant-cloud', () => { throw new Error('Must not fetch'); }, { ...env, ...change }), false);
    assert.deepEqual(res.headers, {}); assert.equal(res.body, '');
  }
  for (const change of [{ VERCEL_GIT_COMMIT_REF: 'main' }, { PUBLIC_GALLERY_PREVIEW_RELAY_URL: 'https://evil.example/proxy' },
    { PUBLIC_GALLERY_PREVIEW_RELAY_KEY: 'weak' }, { PUBLIC_GALLERY_PREVIEW_RELAY_KEY: 'K'.repeat(32) + '\r\nother: value' }, { SUPABASE_ANON_KEY: 'weak' }]) {
    await reject(tryPublicGalleryPreviewRelay(request(), response(), 'instant-cloud', () => { throw new Error('Must not fetch'); }, { ...env, ...change }), 'PUBLIC_GALLERY_PREVIEW_UNAVAILABLE');
  }
});

test('same-origin platform aliases alone select the fixed moderation callback', async () => {
  for (const selectedHost of [host, env.VERCEL_BRANCH_URL]) {
    const res = response(); let captured;
    assert.equal(await tryPublicGalleryPreviewRelay(request('status', { headers: { host: selectedHost, origin: `https://${selectedHost}` } }), res, 'instant-cloud', async (url, init) => { captured = { url, init }; return success({ publicGalleryEnabled: true }); }, env), true);
    assert.equal(captured.init.headers['X-GiftPortals-Preview-Callback'], `https://${selectedHost}/api/cloud-vision`);
    assert.equal(captured.url, `${relay}?action=status&service=instant-cloud`);
    assert.equal(captured.init.redirect, 'error'); assert.equal(captured.init.cache, 'no-store'); assert.ok(captured.init.signal instanceof AbortSignal);
    assert.equal(res.statusCode, 200); assert.equal(JSON.parse(res.body).data.publicGalleryEnabled, true);
  }
  assert.equal(PUBLIC_GALLERY_PREVIEW_TIMEOUT_MS, 145000);
  const denied = [
    request('status', { headers: { host: 'evil.vercel.app' } }),
    request('status', { headers: { origin: `https://${env.VERCEL_BRANCH_URL}` } }),
    request('status', { headers: { 'sec-fetch-site': 'cross-site' } }),
    request('status', { headers: { 'sec-fetch-site': ['cross-site', 'same-origin'] } }),
    request('status', { headers: { 'sec-fetch-site': 'cross-site, same-origin' } }),
    post('prepare', prepare(), { origin: undefined }),
  ];
  for (const req of denied) await reject(tryPublicGalleryPreviewRelay(req, response(), 'instant-cloud', () => { throw new Error('Must not fetch'); }, env), 'ORIGIN_DENIED');
  await reject(tryPublicGalleryPreviewRelay(request(), response(), 'instant-cloud', () => { throw new Error('Must not fetch'); }, { ...env, VERCEL_URL: `${host}.evil.example`, VERCEL_BRANCH_URL: 'https://giftportals-gallery-branch.vercel.app' }), 'ORIGIN_DENIED');
});

test('only two validated cookies leave the server and no caller-selected callback or authorization does', async () => {
  const res = response(); let captured;
  await tryPublicGalleryPreviewRelay(post('advance', { id }, { cookie: `tracking=private; _vercel_jwt=${protection}; __Host-gp_instant_owner=${owner}; session=secret`, authorization: 'Bearer unrelated-secret', 'x-giftportals-preview-callback': 'https://evil.example/callback', 'x-vercel-protection-bypass': 'unrelated-secret' }), res, 'instant-cloud', async (url, init) => { captured = init; return success({ state: 'processing' }, { 'Set-Cookie': cookie }); }, env);
  assert.equal(captured.headers['X-GiftPortals-Preview-Cookie'], `_vercel_jwt=${protection}`);
  assert.equal(captured.headers['X-GiftPortals-Preview-Owner'], `__Host-gp_instant_owner=${owner}`);
  assert.equal(captured.headers['X-GiftPortals-Preview-Callback'], `${origin}/api/cloud-vision`);
  assert.equal(captured.headers['X-Instant-Token'], token);
  for (const name of ['Cookie', 'cookie', 'Authorization', 'authorization', 'x-vercel-protection-bypass']) assert.equal(captured.headers[name], undefined);
  assert.equal(res.headers['Set-Cookie'], cookie);
  assert.equal(res.headers['Cache-Control'], 'no-store'); assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  for (const bad of [`_vercel_jwt=${protection}; _vercel_jwt=${protection}`, '__Host-gp_instant_owner=weak', '_vercel_jwt=not-jwt', `_vercel_jwt=${protection}\r\nAuthorization: stolen`, 'tracking=' + 'x'.repeat(16384)]) {
    await reject(tryPublicGalleryPreviewRelay(request('status', { headers: { cookie: bad } }), response(), 'instant-cloud', () => { throw new Error('Must not fetch'); }, env), 'INVALID_PREVIEW_COOKIE');
  }
  await reject(tryPublicGalleryPreviewRelay(post('advance', { id }, { 'x-instant-token': undefined }), response(), 'instant-cloud', () => { throw new Error('Must not fetch'); }, env), 'GIFT_UNAVAILABLE');
});

test('public gallery GETs stay anonymous and omit callback cookies and private capabilities', async () => {
  for (const [query, expected] of [['', 'list'], [`?action=gift&id=${id}`, 'gift']]) {
    const res = response(); let captured;
    await tryPublicGalleryPreviewRelay(request('status', { url: `/api/instant-gallery${query}`, headers: { cookie: `_vercel_jwt=${protection}; __Host-gp_instant_owner=${owner}`, 'x-instant-token': token, authorization: 'Bearer private' } }), res, 'public-gallery', async (url, init) => { captured = { url, init }; return success({ enabled: true, items: [] }, { 'Set-Cookie': cookie }); }, env);
    assert.equal(new URL(captured.url).searchParams.get('service'), 'public-gallery');
    assert.equal(new URL(captured.url).searchParams.get('action'), expected === 'list' ? null : expected);
    for (const name of ['X-GiftPortals-Preview-Cookie', 'X-GiftPortals-Preview-Owner', 'X-GiftPortals-Preview-Callback', 'X-Instant-Token', 'Authorization']) assert.equal(captured.init.headers[name], undefined);
    assert.equal(res.headers['Set-Cookie'], undefined);
  }
  await reject(tryPublicGalleryPreviewRelay(request('status', { url: '/api/instant-gallery?action=publish' }), response(), 'public-gallery', () => { throw new Error('Must not fetch'); }, env), 'PREVIEW_ACTION_UNAVAILABLE');
});

test('paid entry accepts both souvenir intents only with explicit current v11 consent and exposes no retry or global tick', async () => {
  for (const change of [{ publicGalleryConsent: undefined }, { publicGalleryConsent: false }, { publicGalleryConsentVersion: undefined }, { publicGalleryConsentVersion: 'giftportals-public-gallery-v1' }, { publicGalleryConsentVersion: 'old' }, { photoIntent: undefined }, { photoIntent: 'landscape' }, { photoIntent: ['place'] }]) {
    await reject(tryPublicGalleryPreviewRelay(post('prepare', { ...prepare(), ...change }), response(), 'instant-cloud', () => { throw new Error('Must not fetch'); }, env), 'PUBLIC_GALLERY_CONSENT_REQUIRED');
  }
  for (const action of ['retry-world', 'tick', 'login', 'snapshot', 'publish', 'constructor', '__proto__']) {
    await reject(tryPublicGalleryPreviewRelay(post(action), response(), 'instant-cloud', () => { throw new Error('Must not fetch'); }, env), 'PREVIEW_ACTION_UNAVAILABLE');
  }
  let calls = 0;
  for (const req of [post('prepare', prepare()), post('prepare', {...prepare(), photoIntent:'object'}), post('finalize'), post('advance'), request('job', { url: `/api/instant-cloud?action=job&id=${id}`, headers: { 'x-instant-token': token } }), request('job', { url: '/api/instant-cloud?action=job&dedupeKey=gift-12345678', headers: { 'x-instant-token': token } }), request('world-diagnostics', { url: `/api/instant-cloud?action=world-diagnostics&id=${id}`, headers: { 'x-instant-token': token } }), post('advance', { id }, { 'x-instant-token': token })]) {
    assert.equal(await tryPublicGalleryPreviewRelay(req, response(), 'instant-cloud', async () => { calls++; return success(); }, env), true);
  }
  assert.equal(calls, 8);
});

test('caller-selected services, query duplicates, inconsistent ids and malformed JSON stop before fetch', async () => {
  const cases = [
    [request('status', { url: '/api/instant-cloud?action=status&service=giftportals' }), 'INVALID_BODY'],
    [request('status', { url: '/api/instant-cloud?action=status&action=prepare' }), 'INVALID_BODY'],
    [request('status', { url: 'https://evil.example/api/instant-cloud?action=status' }), 'INVALID_BODY'],
    [request('status', { url: '/api/instant-cloud-tick?action=status' }), 'INVALID_BODY'],
    [request('prepare'), 'METHOD_NOT_ALLOWED'],
    [post('prepare', '{'), 'INVALID_JSON'],
    [post('prepare', []), 'INVALID_BODY'],
    [post('prepare', prepare(), { 'content-type': 'text/plain' }), 'INVALID_BODY'],
    [post('prepare', { ...prepare(), story: 'é'.repeat(9000) }), 'BODY_TOO_LARGE'],
    [post('advance', { id, bypass: true }), 'INVALID_BODY'],
    [{ ...post('advance'), url: `/api/instant-cloud?action=advance&id=${'20000000-0000-4000-8000-000000000002'}` }, 'INVALID_BODY'],
    [request('job', { url: `/api/instant-cloud?action=job&id=${id}&dedupeKey=gift-12345678`, headers: { 'x-instant-token': token } }), 'INVALID_BODY'],
  ];
  for (const [req, code] of cases) await reject(tryPublicGalleryPreviewRelay(req, response(), 'instant-cloud', () => { throw new Error('Must not fetch'); }, env), code);
});

test('upstream responses and cookies are bounded and cannot return arbitrary protection or session cookies', async () => {
  const remoteCases = [
    new Response('<html>login required</html>', { status: 401, headers: { 'Content-Type': 'text/html' } }),
    new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    success({ large: 'x'.repeat(1024 * 1024) }),
    new Response(JSON.stringify({ ok: true, data: {}, secret: 'unexpected' }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    success({}, { 'Set-Cookie': cookie + '; Domain=evil.example' }),
  ];
  for (const remote of remoteCases) await reject(tryPublicGalleryPreviewRelay(request(), response(), 'instant-cloud', async () => remote, env), 'PUBLIC_GALLERY_PREVIEW_UNAVAILABLE');
  const res = response();
  await tryPublicGalleryPreviewRelay(request(), res, 'instant-cloud', async () => success({}, { 'Set-Cookie': '_vercel_jwt=upstream-session; Path=/; Secure' }), env);
  assert.equal(res.headers['Set-Cookie'], undefined);
  const failed = response(); await tryPublicGalleryPreviewRelay(request(), failed, 'instant-cloud', async () => failure('INSTANT_LEASE_CONFLICT'), env);
  assert.equal(failed.statusCode, 409); assert.deepEqual(JSON.parse(failed.body), { ok: false, error: { code: 'INSTANT_LEASE_CONFLICT', message: 'Please try again.' } });
  await reject(tryPublicGalleryPreviewRelay(request(), response(), 'instant-cloud', async () => { throw new Error('secret endpoint failure'); }, env), 'PUBLIC_GALLERY_PREVIEW_UNAVAILABLE');
});

test('parallel requests retain separate callbacks and cookies without mutating environment', async () => {
  const original = { ...env }, seen = new Map();
  await Promise.all([host, env.VERCEL_BRANCH_URL].map((value, index) => tryPublicGalleryPreviewRelay(post('advance', { id }, {
    host: value, origin: `https://${value}`, cookie: `_vercel_jwt=e30.eyJpZCI6${index}fQ.dGVzdA`,
  }), response(), 'instant-cloud', async (url, init) => {
    await Promise.resolve(); seen.set(value, { ...init.headers }); return success();
  }, env)));
  assert.deepEqual(env, original);
  for (const [value, headers] of seen) assert.equal(headers['X-GiftPortals-Preview-Callback'], `https://${value}/api/cloud-vision`);
  assert.notEqual(seen.get(host)['X-GiftPortals-Preview-Cookie'], seen.get(env.VERCEL_BRANCH_URL)['X-GiftPortals-Preview-Cookie']);
});
