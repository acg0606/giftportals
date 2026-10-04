import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Exercise the actual client with deferred HTTP responses and synthetic sessions.
// No browser storage, account, network, or cloud project is involved.
const source = await readFile(new URL('../src/api-client.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
let moduleVersion = 0;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function syntheticSession(id, expiresAt = Date.now() / 1000 + 3600) {
  return { accessToken: `synthetic-access-${id}`, refreshToken: `synthetic-refresh-${id}`, expiresAt,
    user: { id, displayName: `Synthetic ${id}`, demo: false } };
}
function ok(data) { return new Response(JSON.stringify({ ok: true, data }), { headers: { 'Content-Type': 'application/json' } }); }
function failed() { return new Response(JSON.stringify({ ok: false, error: { code: 'INVALID_SESSION', message: 'Synthetic session expired.' } }), { status: 401 }); }
function action(url) { return new URL(url, 'https://offline.invalid').searchParams.get('action'); }
function observe(promise) { return promise.then((value) => ({ value }), (error) => ({ error })); }
function discarded(outcome) { assert.equal(outcome.error?.code, 'SESSION_CHANGED'); assert.equal('value' in outcome, false); }

async function withClient(run) {
  const original = { fetch: globalThis.fetch, sessionStorage: globalThis.sessionStorage, window: globalThis.window };
  const values = new Map();
  globalThis.sessionStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  globalThis.window = new EventTarget();
  try {
    const client = await import(`data:text/javascript,${encodeURIComponent(`${compiled}\n// isolated module ${++moduleVersion}`)}`);
    await run(client);
  } finally {
    globalThis.fetch = original.fetch;
    if (original.sessionStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = original.sessionStorage;
    if (original.window === undefined) delete globalThis.window; else globalThis.window = original.window;
  }
}

test('a delayed private read is discarded after logout', async () => withClient(async (client) => {
  const started = deferred(), reply = deferred();
  client.setSession(syntheticSession('owner-a'));
  globalThis.fetch = async () => { started.resolve(); return reply.promise; };
  const pending = observe(client.api('world'));
  await started.promise;
  client.setSession(null);
  reply.resolve(ok({ privateStory: 'Synthetic private story A' }));
  discarded(await pending);
  assert.equal(client.session(), null);
}));

test('a delayed private read cannot cross an account switch', async () => withClient(async (client) => {
  const started = deferred(), reply = deferred();
  client.setSession(syntheticSession('owner-a'));
  globalThis.fetch = async () => { started.resolve(); return reply.promise; };
  const pending = observe(client.api('world'));
  await started.promise;
  client.setSession(syntheticSession('owner-b'));
  reply.resolve(ok({ privateStory: 'Synthetic private story A' }));
  discarded(await pending);
  assert.equal(client.session().user.id, 'owner-b');
}));

test('a late refresh response cannot sign a logged-out user back in', async () => withClient(async (client) => {
  const started = deferred(), reply = deferred();
  client.setSession(syntheticSession('owner-a', Date.now() / 1000 + 5));
  const requests = [];
  globalThis.fetch = async (url) => { requests.push(action(url)); started.resolve(); return reply.promise; };
  const pending = observe(client.api('world'));
  await started.promise;
  client.setSession(null);
  reply.resolve(ok(syntheticSession('owner-a')));
  discarded(await pending);
  assert.equal(client.session(), null);
  assert.deepEqual(requests, ['refresh']);
}));

test('an old failed refresh cannot clear the new account', async () => withClient(async (client) => {
  const started = deferred(), reply = deferred();
  client.setSession(syntheticSession('owner-a', Date.now() / 1000 + 5));
  globalThis.fetch = async () => { started.resolve(); return reply.promise; };
  const pending = observe(client.api('world'));
  await started.promise;
  client.setSession(syntheticSession('owner-b'));
  reply.resolve(failed());
  discarded(await pending);
  assert.equal(client.session().user.id, 'owner-b');
}));

test('a failed current refresh clears identity and never requests private data', async () => withClient(async (client) => {
  client.setSession(syntheticSession('owner-a', Date.now() / 1000 + 5));
  const requests = []; let identityEvents = 0;
  window.addEventListener('giftportals-session-changed', () => identityEvents++);
  globalThis.fetch = async (url) => { requests.push(action(url)); return failed(); };
  const outcome = await observe(client.api('world'));
  assert.equal(outcome.error?.code, 'INVALID_SESSION');
  assert.equal(client.session(), null);
  assert.equal(identityEvents, 1);
  assert.deepEqual(requests, ['refresh']);
}));

test('concurrent same-user reads share one refresh without losing scope', async () => withClient(async (client) => {
  const started = deferred(), reply = deferred();
  client.setSession(syntheticSession('owner-a', Date.now() / 1000 + 5));
  const generation = client.sessionGeneration(); let refreshCount = 0;
  const bearerHeaders = [];
  globalThis.fetch = async (url, options) => {
    if (action(url) === 'refresh') { refreshCount++; started.resolve(); return reply.promise; }
    bearerHeaders.push(options.headers.Authorization);
    return ok({ ownerId: 'owner-a' });
  };
  const first = observe(client.api('world')), second = observe(client.api('jobs'));
  await started.promise;
  const renewed = syntheticSession('owner-a'); renewed.accessToken = 'synthetic-renewed-a';
  reply.resolve(ok(renewed));
  assert.deepEqual((await first).value, { ownerId: 'owner-a' });
  assert.deepEqual((await second).value, { ownerId: 'owner-a' });
  assert.equal(refreshCount, 1);
  assert.equal(client.sessionGeneration(), generation);
  assert.deepEqual(bearerHeaders, ['Bearer synthetic-renewed-a', 'Bearer synthetic-renewed-a']);
}));

test('an original upload aborts on logout and cannot complete under another identity', async () => withClient(async (client) => {
  const started = deferred(); let signal;
  client.setSession(syntheticSession('owner-a'));
  globalThis.fetch = async (_url, options) => {
    signal = options.signal; started.resolve();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  };
  const pending = observe(client.putFile('https://offline.invalid/upload', new File(['original'], 'photo.png', { type: 'image/png' })));
  await started.promise;
  client.setSession(null);
  discarded(await pending);
  assert.equal(signal.aborted, true);
}));

test('a transport that ignores abort still cannot accept a late upload completion after switching accounts', async () => withClient(async (client) => {
  const started = deferred(), reply = deferred();
  client.setSession(syntheticSession('owner-a'));
  globalThis.fetch = async () => { started.resolve(); return reply.promise; };
  const pending = observe(client.putFile('https://offline.invalid/upload', new File(['original'], 'photo.png', { type: 'image/png' })));
  await started.promise;
  client.setSession(syntheticSession('owner-b'));
  reply.resolve(new Response(null, { status: 200 }));
  discarded(await pending);
  assert.equal(client.session().user.id, 'owner-b');
}));

test('a stalled upload times out without retrying its PUT or leaking its identity listener', async () => withClient(async (client) => {
  const nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
  let expire, removed = 0, cleared = 0, calls = 0;
  const remove = window.removeEventListener.bind(window);
  window.removeEventListener = (...args) => { removed++; remove(...args); };
  globalThis.setTimeout = (callback, milliseconds) => { assert.equal(milliseconds, 60000); expire = callback; return 321; };
  globalThis.clearTimeout = (id) => { assert.equal(id, 321); cleared++; };
  try {
    globalThis.fetch = async (_url, options) => {
      calls++;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    };
    const pending = observe(client.putFile('https://offline.invalid/upload', new File(['original'], 'photo.png', { type: 'image/png' })));
    expire();
    assert.equal((await pending).error?.code, 'UPLOAD_INTERRUPTED');
    assert.equal(calls, 1);
    assert.equal(removed, 1);
    assert.equal(cleared, 1);
  } finally { globalThis.setTimeout = nativeSetTimeout; globalThis.clearTimeout = nativeClearTimeout; }
}));
