import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const modules = new Map();
async function moduleUrl(path) {
  if (modules.has(path.href)) return modules.get(path.href);
  let source = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const match of [...source.matchAll(/from\s*(['"])(\.{1,2}\/[^'"]+)\1/g)]) {
    const url = await moduleUrl(new URL(`${match[2]}.ts`, path));
    source = source.replaceAll(`${match[1]}${match[2]}${match[1]}`, JSON.stringify(url));
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  modules.set(path.href, url); return url;
}
const library = await import(await moduleUrl(new URL('../src/keepsake-library.ts', import.meta.url)));
const now = 2_000_000_000;
const job = (id = 'synthetic-gift-a', extra = {}) => ({ id, token: 'a'.repeat(43), state: 'completed', tripo: { state: 'completed' }, worldlabs: { state: 'completed' }, assets: { photoUrl: 'https://offline.invalid/private-photo?signature=photo', modelUrl: '/private.glb', worldUrl: '/private.spz' }, title: 'Private gift', story: 'Private story', worldPrompt: 'Private place', createdAt: new Date(now * 1000).toISOString(), mediaExpiresAt: now + 600, ...extra });
const memoryStorage = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const ok = data => new Response(JSON.stringify({ ok: true, data }), { headers: { 'Content-Type': 'application/json' } });

test('completed creations survive reopening storage, keep earlier gifts, deduplicate and persist no content or signed URLs', () => {
  const storage = memoryStorage();
  library.rememberCreatedKeepsake(storage, 'anonymous', job(), now);
  library.rememberCreatedKeepsake(storage, 'anonymous', job('synthetic-gift-b'), now);
  library.rememberCreatedKeepsake(storage, 'anonymous', job(), now);
  assert.deepEqual(library.storedKeepsakeReferences(storage, 'anonymous', now).map(value => value.id), ['synthetic-gift-b', 'synthetic-gift-a']);
  const saved = JSON.parse(storage.getItem(library.keepsakeLibraryKey('anonymous')));
  assert.deepEqual(Object.keys(saved[0]).sort(), ['expiresAt', 'id', 'token']);
  assert.equal(JSON.stringify(saved).includes('Private'), false);
  assert.equal(JSON.stringify(saved).includes('signature'), false);
  assert.equal(JSON.stringify(saved).includes('.glb'), false);
});

test('account and anonymous catalogs are separate; clearing an actor never exposes or clears another actor', () => {
  const storage = memoryStorage();
  for (const scope of ['anonymous', 'owner:a', 'owner:b']) library.rememberCreatedKeepsake(storage, scope, job(`synthetic-${scope.replace(':', '-')}`), now);
  assert.deepEqual(library.storedKeepsakeReferences(storage, 'owner:a', now).map(value => value.id), ['synthetic-owner-a']);
  library.clearKeepsakeScope(storage, 'owner:a');
  assert.deepEqual(library.storedKeepsakeReferences(storage, 'owner:a', now), []);
  assert.equal(library.storedKeepsakeReferences(storage, 'owner:b', now).length, 1);
  assert.equal(library.storedKeepsakeReferences(storage, 'anonymous', now).length, 1);
  assert.notEqual(library.instantJobStorageKey('owner:a'), library.instantJobStorageKey('anonymous'));
  assert.notEqual(library.instantPendingStorageKey('owner:a'), library.instantPendingStorageKey('owner:b'));
});

test('expiry follows the server deadline, removes stale capabilities and never extends retention on reload', () => {
  const storage = memoryStorage();
  library.rememberCreatedKeepsake(storage, 'anonymous', job(), now);
  const refreshed = library.rememberCreatedKeepsake(storage, 'anonymous', job(), now + 599);
  assert.equal(refreshed.expiresAt, now + 600);
  assert.deepEqual(library.storedKeepsakeReferences(storage, 'anonymous', now + 600), []);
  assert.equal(storage.getItem(library.keepsakeLibraryKey('anonymous')), null);
  assert.equal(library.rememberCreatedKeepsake(storage, 'anonymous', job(), now + 601), undefined);
});

test('unfinished, invalid and overlarge records are rejected; storage failures do not interrupt a ready gift', () => {
  const storage = memoryStorage();
  assert.equal(library.rememberCreatedKeepsake(storage, 'anonymous', job('synthetic-gift-a', { state: 'partial' }), now), undefined);
  assert.equal(library.rememberCreatedKeepsake(storage, 'anonymous', job('invalid/token'), now), undefined);
  assert.deepEqual(library.readKeepsakeReferences(JSON.stringify([{ id: 'synthetic-gift-a', token: 'short', expiresAt: now + 10 }]), now), []);
  assert.deepEqual(library.readKeepsakeReferences(JSON.stringify(Array.from({ length: 101 }, () => ({ id: 'synthetic-gift-a', token: 'a'.repeat(43), expiresAt: now + 10 }))), now), []);
  const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); }, removeItem() { throw new Error('Blocked'); } };
  assert.equal(library.rememberCreatedKeepsake(blocked, 'anonymous', job(), now).id, 'synthetic-gift-a');
  const readOnly = { getItem: () => JSON.stringify([{ id: 'synthetic-gift-a', token: 'a'.repeat(43), expiresAt: now + 10 }]), setItem() { throw new Error('Read only'); }, removeItem() { throw new Error('Read only'); } };
  assert.equal(library.storedKeepsakeReferences(readOnly, 'anonymous', now).length, 1);
  for (let i = 0; i < 105; i++) library.rememberCreatedKeepsake(storage, 'anonymous', job(`synthetic-gift-${i}`), now);
  assert.equal(library.storedKeepsakeReferences(storage, 'anonymous', now).length, 100);
  assert.equal(library.storedKeepsakeReferences(storage, 'anonymous', now)[0].id, 'synthetic-gift-5');
});

test('hydration authenticates with a header and makes one cloud GET even for an unfinished legacy job', async () => {
  const requests = [];
  const pending = job('synthetic-gift-a', { state: 'processing', tripo: { state: 'processing' }, worldlabs: { state: 'processing' } });
  const reference = { id: pending.id, token: pending.token };
  assert.equal((await library.readKeepsakeJob(reference, new AbortController().signal, 'giftportals.vercel.app', async (url, options) => { requests.push({ url, options }); return ok(pending); })).state, 'processing');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, 'GET');
  assert.match(requests[0].url, /^\/api\/instant-cloud\?action=job&id=/);
  assert.equal(requests[0].url.includes(reference.token), false);
  assert.equal(requests[0].options.headers['X-Instant-Token'], reference.token);
  assert.equal(requests[0].options.referrerPolicy, 'no-referrer');
  assert.equal(requests[0].options.redirect, 'error');
});

test('a response with a wrong reference or arriving after cancellation cannot be displayed', async () => {
  const reference = { id: job().id, token: job().token };
  await assert.rejects(library.readKeepsakeJob(reference, new AbortController().signal, 'giftportals.vercel.app', async () => ok(job('unrelated-gift'))), { code: 'GIFT_REFERENCE_MISMATCH' });
  let finish; const response = new Promise(resolve => { finish = resolve; });
  const abort = new AbortController();
  const pending = library.readKeepsakeJob(reference, abort.signal, 'giftportals.vercel.app', () => response);
  abort.abort(); finish(ok(job()));
  await assert.rejects(pending, { name: 'AbortError' });
});

test('local collection recovery uses the read-only snapshot action rather than the paid polling route', async () => {
  const reference = { id: job().id, token: job().token }; const requests = [];
  await library.readKeepsakeJob(reference, new AbortController().signal, '127.0.0.1', async (url, options) => { requests.push({ url, options }); return ok(job()); });
  assert.equal(requests.length, 1); assert.match(requests[0].url, /^\/api\/instant\?action=snapshot&id=/);
  assert.equal(requests[0].options.method, 'GET');
});
