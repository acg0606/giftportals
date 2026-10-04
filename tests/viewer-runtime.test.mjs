import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual browser-independent runtime. Streams and frames are synthetic;
// these tests make no network requests and do not establish browser/cloud behavior.
const compiled = ts.transpileModule(await readFile(new URL('../src/viewer-runtime.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const runtime = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function frames() {
  let sequence = 0;
  const pending = new Map(), callbacks = new Map(), cancelled = [];
  return {
    pending, callbacks, cancelled,
    request(callback) { const id = ++sequence; pending.set(id, callback); callbacks.set(id, callback); return id; },
    cancel(id) { cancelled.push(id); pending.delete(id); },
    run() { const [id, callback] = pending.entries().next().value; pending.delete(id); callback(100 + id); },
  };
}
async function withFetch(fetch, action) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetch;
  try { return await action(); } finally { globalThis.fetch = previous; }
}
const expectedError = (code) => (error) => error instanceof Error && error.message === code;
const signal = () => new AbortController().signal;

test('the default frame driver preserves the global receiver required by browser RAF methods', () => {
  const previousRequest = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame;
  const driver = frames(); let drawn = 0;
  globalThis.requestAnimationFrame = function (callback) { assert.equal(this, globalThis, 'Illegal invocation: RAF needs the Window receiver'); return driver.request(callback); };
  globalThis.cancelAnimationFrame = function (id) { assert.equal(this, globalThis, 'Illegal invocation: cancellation needs the Window receiver'); driver.cancel(id); };
  try {
    const gate = runtime.createFrameGate(() => drawn++);
    gate.request(); assert.equal(driver.pending.size, 1);
    gate.setHidden(true); assert.equal(driver.pending.size, 0);
    gate.setHidden(false); driver.run(); assert.equal(drawn, 1);
    gate.request(); gate.destroy(); assert.equal(driver.pending.size, 0);
  } finally {
    if (previousRequest === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previousRequest;
    if (previousCancel === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = previousCancel;
  }
});

test('multiple scene invalidations coalesce, and a rendered frame can schedule its successor', () => {
  const driver = frames(), drawn = [];
  let gate;
  gate = runtime.createFrameGate((time) => { drawn.push(time); if (drawn.length === 1) gate.request(); }, driver);
  gate.request(); gate.request(); gate.request();
  assert.equal(driver.pending.size, 1);
  driver.run();
  assert.equal(drawn.length, 1);
  assert.equal(driver.pending.size, 1);
  driver.run();
  assert.equal(drawn.length, 2);
  assert.equal(driver.pending.size, 0);
  gate.destroy();
});

test('offscreen and hidden viewers cancel pending work; disposal cannot revive a queued callback', () => {
  const driver = frames(); let drawn = 0;
  const gate = runtime.createFrameGate(() => drawn++, driver);
  gate.request(); gate.setVisible(false); gate.request();
  assert.equal(driver.pending.size, 0);
  assert.equal(driver.cancelled.length, 1);
  gate.setHidden(true); gate.setVisible(true); gate.request();
  assert.equal(driver.pending.size, 0);
  gate.setHidden(false); gate.request();
  assert.equal(driver.pending.size, 1);
  const queued = [...driver.pending.values()][0];
  gate.destroy(); queued(123); gate.setHidden(false); gate.setVisible(true); gate.request();
  assert.equal(drawn, 0);
  assert.equal(driver.pending.size, 0);
});

test('an obsolete cancelled frame cannot draw or clear the replacement frame after resuming', () => {
  const driver = frames(); let drawn = 0;
  const gate = runtime.createFrameGate(() => drawn++, driver);
  gate.request(); const obsolete = [...driver.pending.values()][0];
  gate.setHidden(true); gate.setHidden(false);
  assert.equal(driver.pending.size, 1);
  obsolete(123); gate.request();
  assert.equal(drawn, 0);
  assert.equal(driver.pending.size, 1);
  driver.run(); assert.equal(drawn, 1);
  gate.destroy();
});

test('signed HTTPS and same-origin development assets remain usable', () => {
  assert.equal(runtime.viewerAssetUrl('/demo/bird.glb', 'http://127.0.0.1:4323').href, 'http://127.0.0.1:4323/demo/bird.glb');
  assert.equal(runtime.viewerAssetUrl('https://assets.example.invalid/world.spz?token=synthetic', 'http://127.0.0.1:4323').protocol, 'https:');
});

test('viewer URLs reject credentialed, executable and insecure cross-origin inputs', () => {
  for (const value of ['https://user:password@assets.example.invalid/a.glb', 'http://127.0.0.1:4324/a.glb', 'http://assets.example.invalid/a.spz', 'javascript:alert(1)', 'data:text/plain,asset', 'file:///C:/private.glb']) {
    assert.throws(() => runtime.viewerAssetUrl(value, 'http://127.0.0.1:4323'), expectedError('VIEWER_URL_INVALID'));
  }
});

test('mobile world rendering uses fewer pixels without degrading valid low-density screens', () => {
  assert.equal(runtime.viewerPixelRatio('gift', 3, 390), 1.25);
  assert.equal(runtime.viewerPixelRatio('place', 3, 390), 1);
  assert.equal(runtime.viewerPixelRatio('gift', 3, 1280), 1.5);
  assert.equal(runtime.viewerPixelRatio('place', 3, 1280), 1.25);
  assert.equal(runtime.viewerPixelRatio('place', 0.75, 390), 0.75);
  assert.equal(runtime.viewerPixelRatio('place', NaN, 390), 1);
});

test('streamed assets preserve bytes and report monotonic download and decode phases', async () => {
  const progress = [], requests = [];
  await withFetch(async (_url, options) => {
    requests.push(options);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1, 2)); controller.enqueue(Uint8Array.of(3, 4, 5)); controller.close(); } }), { headers: { 'content-length': '5' } });
  }, async () => {
    const bytes = await runtime.fetchViewerBytes('https://assets.example.invalid/a.glb', signal(), (state) => progress.push(state));
    assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
  });
  assert.deepEqual(progress.map((entry) => entry.loadedBytes), [0, 2, 5, 5]);
  assert.equal(progress.at(-1).phase, 'decoding');
  assert.ok(progress.every((entry) => entry.totalBytes === 5));
  assert.equal(requests[0].credentials, 'omit');
  assert.equal(requests[0].redirect, 'error');
  assert.equal(requests[0].referrerPolicy, 'no-referrer');
});

test('compressed or unknown-size responses do not report a misleading percentage denominator', async () => {
  for (const headers of [{}, { 'content-length': '2', 'content-encoding': 'gzip' }]) {
    const progress = [];
    await withFetch(async () => new Response(Uint8Array.of(1, 2, 3, 4), { headers }), async () => {
      const bytes = await runtime.fetchViewerBytes('https://assets.example.invalid/a.spz', signal(), (state) => progress.push(state));
      assert.equal(bytes.length, 4);
    });
    assert.ok(progress.every((entry) => entry.totalBytes === null));
    assert.equal(progress.at(-1).loadedBytes, 4);
  }
});

test('a declared over-budget asset cancels its body before allocating or reading chunks', async () => {
  let cancelled = false;
  await withFetch(async () => ({ ok: true, headers: new Headers({ 'content-length': String(25 * 1024 * 1024 + 1) }), body: {
    cancel: async () => { cancelled = true; }, getReader() { assert.fail('The over-budget body must not be read.'); },
  } }), async () => {
    await assert.rejects(runtime.fetchViewerBytes('https://assets.example.invalid/large.spz', signal()), expectedError('VIEWER_ASSET_TOO_LARGE'));
  });
  assert.equal(cancelled, true);
});

test('the explicit cinematic stream budget accepts a real 28 MiB stream while the legacy 25 MiB limit still rejects it', async () => {
  const chunk = new Uint8Array(14 * 1024 * 1024); let reads = 0;
  await withFetch(async () => ({ ok: true, headers: new Headers({ 'content-length': String(28 * 1024 * 1024) }), body: { getReader: () => ({
    async read() { return ++reads <= 2 ? { done: false, value: chunk } : { done: true }; }, async cancel() {}, releaseLock() {},
  }) } }), async () => {
    const bytes = await runtime.fetchViewerBytes('https://assets.example.invalid/full.spz', signal(), undefined, 50 * 1024 * 1024);
    assert.equal(bytes.byteLength, 28 * 1024 * 1024); assert.equal(reads, 3);
  });
  await withFetch(async () => ({ ok: true, headers: new Headers({ 'content-length': String(28 * 1024 * 1024) }), body: { async cancel() {}, getReader() { assert.fail('Legacy over-budget assets must be rejected before reading'); } } }), async () => {
    await assert.rejects(runtime.fetchViewerBytes('https://assets.example.invalid/legacy.glb', signal()), expectedError('VIEWER_ASSET_TOO_LARGE'));
  });
});

test('the cinematic byte override is bounded to 50 MiB even for a malicious huge budget', async () => {
  for (const limit of [50 * 1024 * 1024, Number.MAX_SAFE_INTEGER]) {
    let cancelled = false;
    await withFetch(async () => ({ ok: true, headers: new Headers({ 'content-length': String(50 * 1024 * 1024 + 1) }), body: { async cancel() { cancelled = true; }, getReader() { assert.fail('The 50 MiB ceiling must stop allocation'); } } }), async () => {
      await assert.rejects(runtime.fetchViewerBytes('https://assets.example.invalid/too-large.spz', signal(), undefined, limit), expectedError('VIEWER_ASSET_TOO_LARGE'));
    }); assert.equal(cancelled, true);
  }
});

test('a false content length cannot bypass the cinematic actual-stream limit', async () => {
  const chunk = new Uint8Array(26 * 1024 * 1024); let reads = 0, cancelled = false, released = false;
  await withFetch(async () => ({ ok: true, headers: new Headers({ 'content-length': '1' }), body: { getReader: () => ({
    async read() { reads++; return { done: false, value: chunk }; }, async cancel() { cancelled = true; }, releaseLock() { released = true; },
  }) } }), async () => {
    await assert.rejects(runtime.fetchViewerBytes('https://assets.example.invalid/oversized.spz', signal(), undefined, 50 * 1024 * 1024), expectedError('VIEWER_ASSET_TOO_LARGE'));
  }); assert.equal(reads, 2); assert.equal(cancelled, true); assert.equal(released, true);
});

test('a misleading small content length cannot bypass the actual streamed byte budget', async () => {
  const chunk = new Uint8Array(14 * 1024 * 1024); let count = 0, cancelled = false, released = false;
  await withFetch(async () => ({ ok: true, headers: new Headers({ 'content-length': '1' }), body: { getReader: () => ({
    async read() { return ++count <= 2 ? { done: false, value: chunk } : { done: true }; },
    async cancel() { cancelled = true; }, releaseLock() { released = true; },
  }) } }), async () => {
    await assert.rejects(runtime.fetchViewerBytes('https://assets.example.invalid/large.spz', signal()), expectedError('VIEWER_ASSET_TOO_LARGE'));
  });
  assert.equal(count, 2); assert.equal(cancelled, true); assert.equal(released, true);
});

test('an already cancelled load makes no fetch request', async () => {
  const abort = new AbortController(); abort.abort();
  await withFetch(async () => { assert.fail('Cancelled work must not start a download.'); }, async () => {
    await assert.rejects(runtime.fetchViewerBytes('https://assets.example.invalid/a.glb', abort.signal), (error) => error.name === 'AbortError');
  });
});

test('cancelling after a downloaded chunk releases its reader and never publishes decoded bytes', async () => {
  const abort = new AbortController(); let cancelled = false, released = false; const progress = [];
  await withFetch(async () => ({ ok: true, headers: new Headers(), body: { getReader: () => ({
    async read() { return { done: false, value: Uint8Array.of(1, 2, 3) }; },
    async cancel() { cancelled = true; }, releaseLock() { released = true; },
  }) } }), async () => {
    await assert.rejects(runtime.fetchViewerBytes('https://assets.example.invalid/a.glb', abort.signal, (state) => {
      progress.push(state); if (state.loadedBytes) abort.abort();
    }), (error) => error.name === 'AbortError');
  });
  assert.equal(cancelled, true); assert.equal(released, true);
  assert.equal(progress.some((state) => state.phase === 'decoding'), false);
});

test('HTTP failure and empty assets do not reach a false ready/decode state', async () => {
  await withFetch(async () => new Response('Not found', { status: 404 }), async () => {
    await assert.rejects(runtime.fetchViewerBytes('https://assets.example.invalid/missing.glb', signal()), expectedError('VIEWER_DOWNLOAD_FAILED'));
  });
  const progress = [];
  await withFetch(async () => new Response(new Uint8Array()), async () => {
    await assert.rejects(runtime.fetchViewerBytes('https://assets.example.invalid/empty.glb', signal(), (state) => progress.push(state)), expectedError('VIEWER_ASSET_EMPTY'));
  });
  assert.equal(progress.some((state) => state.phase === 'decoding'), false);
});
