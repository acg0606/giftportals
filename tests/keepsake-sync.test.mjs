import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual controller, without a DOM, browser, account or network.
const source = await readFile(new URL('../src/keepsake-sync.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { createKeepsakeSync, parseGeneratedKeepsakeLink, MAX_KEEPSAKE_SYNC_BATCH } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const now = 2_000_000_000;
const idA = 'c21f3120-1cb1-412f-8f03-2b55ccaa1177';
const idB = 'c21f3120-1cb1-412f-8f03-2b55ccaa1188';
const tokenA = 'a'.repeat(43), tokenB = '_'.repeat(43);
const ref = (id = idA, token = tokenA, expiresAt = now + 600) => ({ id, token, expiresAt });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness(api, extra = {}) {
  const state = { actor: 'account-a', generation: 1, enabled: true, calls: [], applied: [], ...extra.state };
  const options = {
    getIdentity: () => state.actor, getGeneration: () => state.generation, enabled: () => state.enabled,
    now: () => now, onReferences: refs => state.applied.push(refs),
    api: async (action, body) => { state.calls.push({ action, body, actor: state.actor }); return api ? api(action, body, state) : action === 'keepsakes-list' ? { references: [] } : action === 'keepsakes-remove' ? { removed: true } : { reference: ref(body.id, body.token) }; },
    ...extra.options,
  };
  return { state, controller: createKeepsakeSync(options) };
}

test('private link parsing accepts only exact supported HTTPS origins and routes', () => {
  const expected = { id: idA, token: tokenA };
  assert.deepEqual(parseGeneratedKeepsakeLink(`https://giftportals.vercel.app/#/generated/${idA}?key=${tokenA}`), expected);
  assert.deepEqual(parseGeneratedKeepsakeLink(`https://giftportals.vercel.app/generated/${idA.toUpperCase()}?key=${tokenA}`), expected);
  assert.deepEqual(parseGeneratedKeepsakeLink(` https://preview.example/generated/${idA}?key=${tokenA} `, 'https://preview.example'), expected);
  assert.deepEqual(parseGeneratedKeepsakeLink(`https://giftportals.vercel.app/#/generated/${idA}?key=${tokenA}`, 'https://preview.example'), expected);
  assert.deepEqual(parseGeneratedKeepsakeLink(`https://preview.example:8443/#/generated/${idA}?key=${tokenB}`, 'https://preview.example:8443'), { id: idA, token: tokenB });
  for (const suffix of ['&view=world', '&view=object', '&from=room', '&from=room&view=world', '&view=object&from=room']) {
    assert.deepEqual(parseGeneratedKeepsakeLink(`https://giftportals.vercel.app/#/generated/${idA}?key=${tokenA}${suffix}`), expected);
    assert.deepEqual(parseGeneratedKeepsakeLink(`https://giftportals.vercel.app/generated/${idA}?key=${tokenA}${suffix}`), expected);
  }
  for (const input of [
    `http://giftportals.vercel.app/#/generated/${idA}?key=${tokenA}`,
    `https://giftportals.vercel.app.evil.example/#/generated/${idA}?key=${tokenA}`,
    `https://evil.example/?next=https://giftportals.vercel.app/#/generated/${idA}?key=${tokenA}`,
    `https://giftportals.vercel.app:444/#/generated/${idA}?key=${tokenA}`,
    `https://user:password@giftportals.vercel.app/#/generated/${idA}?key=${tokenA}`,
    `https://giftportals.vercel.app/other/#/generated/${idA}?key=${tokenA}`,
    `https://giftportals.vercel.app/?campaign=anything#/generated/${idA}?key=${tokenA}`,
    `https://giftportals.vercel.app/#/generated/${idA}?key=${tokenA}&key=${tokenA}`,
    `https://giftportals.vercel.app/#/generated/${idA}?key=${tokenA}&demo=sender`,
    `https://giftportals.vercel.app/#/generated/${idA}?key=${tokenA}&view=gift`,
    `https://giftportals.vercel.app/#/generated/${idA}?key=${tokenA}&view=world&view=object`,
    `https://giftportals.vercel.app/#/generated/${idA}?key=${tokenA}&from=other`,
    `https://giftportals.vercel.app/#/generated/${idA}?key=${tokenA}&from=room&from=room`,
    `https://giftportals.vercel.app/#/generated/${idA}?key=${tokenA}&extra=room`,
    `https://giftportals.vercel.app/#/generated/${idA}?token=${tokenA}`,
    `https://giftportals.vercel.app/#/generated/${idA}?key=short`,
    `https://giftportals.vercel.app/#/generated/${idA}?key=${'+'.repeat(43)}`,
    `https://giftportals.vercel.app/#/generated/rio-example?key=${tokenA}`,
    `https://giftportals.vercel.app/#/generated/synthetic-gift?key=${tokenA}`,
    `#/generated/${idA}?key=${tokenA}`,
    `/generated/${idA}?key=${tokenA}`,
    'javascript:alert(1)', '', 'https://giftportals.vercel.app/' + 'a'.repeat(4096),
  ]) assert.equal(parseGeneratedKeepsakeLink(input), undefined);
});

test('creation and list never silently upload anonymous or device references', async () => {
  const { state, controller } = harness();
  assert.deepEqual(state.calls, []);
  await controller.list();
  assert.deepEqual(state.calls.map(call => call.action), ['keepsakes-list']);
  assert.deepEqual(state.applied, [[]]);
});

test('signed-out and disabled controllers send nothing and retain device data', async () => {
  const { state, controller } = harness(undefined, { state: { actor: null } });
  for (const operation of [() => controller.list(), () => controller.save(ref()), () => controller.importBatch([ref()]), () => controller.remove(idA)]) {
    const result = await operation(); assert.equal(result.ok, false); assert.equal(result.code, 'SIGN_IN_REQUIRED'); assert.deepEqual(result.refs, []);
  }
  state.actor = 'account-a'; state.enabled = false;
  assert.equal((await controller.save(ref())).code, 'SYNC_DISABLED');
  assert.deepEqual(state.calls, []); assert.deepEqual(state.applied, []);
});

test('list filters fictional IDs, bad tokens and expired/malformed deadlines without exposing content', async () => {
  const good = ref();
  const { state, controller } = harness(() => ({ references: [
    { ...good, title: 'Private title', photoUrl: '/private.jpg' }, good,
    ref('rio-example'), ref('synthetic-gift'), ref(idB, 'short'), ref(idB, '+'.repeat(43)),
    ref(idB, tokenB, now), ref(idB, tokenB, Infinity), ref(idB, tokenB, 'future'),
    { id: idB, token: tokenB }, null, ref(idB, tokenB),
  ] }));
  const result = await controller.list();
  assert.equal(result.ok, true); assert.equal(result.successCount, 2); assert.equal(result.skippedCount, 10);
  assert.deepEqual(result.refs, [good, ref(idB, tokenB)]);
  assert.deepEqual(state.applied, [[good, ref(idB, tokenB)]]);
  assert.deepEqual(Object.keys(result.refs[0]).sort(), ['expiresAt', 'id', 'token']);
  assert.equal(JSON.stringify(result.refs).includes('Private title'), false);
});

test('list failure or malformed responses do not replace an existing client library', async () => {
  const local = new Map([[idA, ref()]]);
  for (const server of [() => { throw Error('do not display server secrets'); }, () => ({ references: 'bad' })]) {
    const { controller } = harness(server, { options: { onReferences: refs => { for (const item of refs) local.set(item.id, item); } } });
    const result = await controller.list(); assert.equal(result.ok, false); assert.equal(result.refs.length, 0);
    assert.equal(result.error.includes('server secrets'), false); assert.equal(local.size, 1);
  }
});

test('failed saves retain the local reference and retry uses only id/token with canonical server expiry', async () => {
  const local = new Map([[idA, ref(idA, tokenA, now + 999)]]); let attempts = 0;
  const { state, controller } = harness((_action, body) => { if (++attempts === 1) throw Error('falha privada'); return { reference: ref(body.id, body.token, now + 300) }; }, { options: { onReferences: refs => { for (const item of refs) local.set(item.id, item); } } });
  const failed = await controller.save(local.get(idA));
  assert.equal(failed.ok, false); assert.match(failed.error, /remains on this device/); assert.equal(failed.error.includes('falha'), false);
  assert.equal(local.get(idA).expiresAt, now + 999);
  const retried = await controller.save(local.get(idA));
  assert.equal(retried.ok, true); assert.equal(local.get(idA).expiresAt, now + 300);
  assert.deepEqual(state.calls.map(call => call.body), [{ id: idA, token: tokenA }, { id: idA, token: tokenA }]);
});

test('new-created autosync deduplicates in-flight and already successful saves per account', async () => {
  const pending = deferred(); const { state, controller } = harness(() => pending.promise);
  const first = controller.save(ref()), second = controller.save(ref());
  assert.equal(first, second); assert.equal(state.calls.length, 1);
  const otherToken = await controller.save(ref(idA, tokenB));
  assert.equal(otherToken.code, 'SYNC_BUSY'); assert.deepEqual(otherToken.refs, []);
  pending.resolve({ reference: ref() });
  assert.equal((await first).successCount, 1); assert.equal((await second).ok, true);
  const repeated = await controller.save(ref());
  assert.equal(repeated.ok, true); assert.equal(repeated.successCount, 0); assert.equal(repeated.skippedCount, 1);
  assert.equal(state.calls.length, 1); assert.equal(state.applied.length, 1);
});

test('a switched-account list response is discarded and cannot clear the new account save cache', async () => {
  const old = deferred();
  const { state, controller } = harness(action => action === 'keepsakes-list' ? old.promise : { reference: ref(idB, tokenB) });
  const listing = controller.list(); state.actor = 'account-b'; state.generation++;
  assert.equal((await controller.save(ref(idB, tokenB))).ok, true);
  old.resolve({ references: [ref()] });
  const stale = await listing;
  assert.equal(stale.stopped, true); assert.deepEqual(stale.refs, []); assert.deepEqual(state.applied, [[ref(idB, tokenB)]]);
  assert.equal((await controller.save(ref(idB, tokenB))).skippedCount, 1);
  assert.equal(state.calls.filter(call => call.action === 'keepsakes-save').length, 1);
});

test('same identity after logout/login still discards the previous generation response', async () => {
  const pending = deferred(); const { state, controller } = harness(() => pending.promise);
  const saving = controller.save(ref()); state.actor = null; state.generation++; state.actor = 'account-a'; state.generation++;
  pending.resolve({ reference: ref() });
  const result = await saving; assert.equal(result.code, 'SESSION_CHANGED'); assert.deepEqual(result.refs, []); assert.deepEqual(state.applied, []);
  assert.equal(state.calls.some(call => call.action === 'keepsakes-remove'), false);
});

test('identity change during initial capture prevents dispatch to the replacement account', async () => {
  let reads = 0;
  const { state, controller } = harness(undefined, { options: { getIdentity: () => ++reads === 1 ? 'account-a' : 'account-b' } });
  const result = await controller.save(ref());
  assert.equal(result.code, 'SESSION_CHANGED'); assert.deepEqual(state.calls, []);
});

test('explicit batch deduplicates, reports invalid references and sends valid gifts sequentially', async () => {
  let simultaneous = 0, maximum = 0;
  const { state, controller } = harness(async (_action, body) => {
    maximum = Math.max(maximum, ++simultaneous); await Promise.resolve(); simultaneous--;
    return { reference: ref(body.id, body.token) };
  });
  const result = await controller.importBatch([ref(), ref(), ref(idB, tokenB), ref('rio-example'), ref(idB, tokenB, now - 1)]);
  assert.equal(result.ok, false); assert.equal(result.successCount, 2); assert.equal(result.failureCount, 2); assert.equal(result.skippedCount, 1);
  assert.equal(maximum, 1); assert.deepEqual(state.calls.map(call => call.body.id), [idA, idB]);
  assert.deepEqual(result.refs, [ref(), ref(idB, tokenB)]);
});

test('batch stops before its next request if the account switches during an awaited save', async () => {
  const { state, controller } = harness((_action, body, current) => { current.actor = 'account-b'; current.generation++; return { reference: ref(body.id, body.token) }; });
  const result = await controller.importBatch([ref(), ref(idB, tokenB)]);
  assert.equal(result.stopped, true); assert.equal(result.code, 'SESSION_CHANGED'); assert.deepEqual(result.refs, []);
  assert.equal(state.calls.length, 1); assert.deepEqual(state.applied, []);
});

test('batch rechecks identity at the continuation boundary before dispatching its second save', async () => {
  let state;
  const setup = harness(undefined, { options: { onReferences: () => queueMicrotask(() => { state.actor = 'account-b'; state.generation++; }) } });
  state = setup.state;
  const result = await setup.controller.importBatch([ref(), ref(idB, tokenB)]);
  assert.equal(result.stopped, true); assert.equal(result.successCount, 1);
  assert.deepEqual(result.refs, []); assert.equal(state.calls.length, 1);
});

test('a list begun before a new save supplies only its own refs and leaves caller merge intact', async () => {
  const pending = deferred(), local = new Map();
  const { controller } = harness((action, body) => action === 'keepsakes-list' ? pending.promise : { reference: ref(body.id, body.token) }, { options: { onReferences: refs => { for (const item of refs) local.set(item.id, item); } } });
  const listing = controller.list(); await controller.save(ref(idB, tokenB));
  pending.resolve({ references: [ref()] }); await listing;
  assert.deepEqual([...local.keys()], [idB, idA]);
  assert.equal((await controller.save(ref(idB, tokenB))).skippedCount, 1);
});

test('batch failure leaves failed device capabilities available while later valid gifts continue', async () => {
  const local = new Map([[idA, ref()], [idB, ref(idB, tokenB)]]);
  const { state, controller } = harness((_action, body) => { if (body.id === idA) throw Error('offline'); return { reference: ref(body.id, body.token) }; });
  const result = await controller.importBatch([...local.values()]);
  assert.equal(result.successCount, 1); assert.equal(result.failureCount, 1); assert.equal(result.stopped, false);
  assert.equal(local.size, 2); assert.equal(state.calls.length, 2); assert.deepEqual(result.refs, [ref(idB, tokenB)]);
});

test('explicit imports are bounded at 100 unique gifts and leave remaining device references untouched', async () => {
  const values = Array.from({ length: 101 }, (_, index) => ref(`${index.toString(16).padStart(8, '0')}-1cb1-412f-8f03-2b55ccaa1177`));
  const { state, controller } = harness(); const result = await controller.importBatch(values);
  assert.equal(MAX_KEEPSAKE_SYNC_BATCH, 100); assert.equal(result.code, 'IMPORT_LIMIT'); assert.equal(result.successCount, 100); assert.equal(result.skippedCount, 1);
  assert.equal(state.calls.length, 100); assert.equal(values.length, 101);
});

test('save rejects mismatched/expired responses instead of applying another capability', async () => {
  for (const response of [ref(idB, tokenB), ref(idA, tokenB), ref(idA, tokenA, now), { id: idA, token: tokenA }]) {
    const { state, controller } = harness(() => ({ reference: response }));
    const result = await controller.save(ref()); assert.equal(result.code, 'INVALID_RESPONSE'); assert.deepEqual(result.refs, []); assert.deepEqual(state.applied, []);
  }
});

test('local logout never removes cloud gifts and explicit failed remove never clears local references', async () => {
  const local = new Map([[idA, ref()]]);
  const { state, controller } = harness(() => { throw Error('offline'); }, { options: { onReferences: refs => { for (const item of refs) local.set(item.id, item); } } });
  assert.equal((await controller.remove(idA)).ok, false); assert.equal(local.size, 1);
  state.actor = null; state.generation++;
  assert.equal((await controller.list()).code, 'SIGN_IN_REQUIRED');
  assert.deepEqual(state.calls.map(call => call.action), ['keepsakes-remove']); assert.equal(local.size, 1);
  state.actor = 'account-a'; state.generation++;
  const successful = harness(); const result = await successful.controller.remove(idA);
  assert.equal(result.ok, true); assert.equal(result.successCount, 1); assert.deepEqual(successful.state.applied, []);
});

test('callbacks and returned results do not share mutable capability objects', async () => {
  const { controller } = harness(() => ({ reference: ref() }), { options: { onReferences: refs => { refs[0].token = tokenB; refs.length = 0; } } });
  const result = await controller.save(ref()); assert.deepEqual(result.refs, [ref()]);
  result.refs[0].token = tokenB;
  assert.deepEqual((await controller.save(ref())).refs, [ref()]);
});
