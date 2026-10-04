import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';

// Real base64 decoding and WebCrypto hashing, synthetic HTTP only. The loader
// erases shared/creator type imports rather than mounting the creator or DOM.
const source = await readFile(new URL('../src/cloud-instant-service.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
assert.equal(/^import\s/m.test(compiled), false);
const { cloudCreatorOrigin, cloudImageBytes, createCloudInstantService } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5XcAAAAASUVORK5CYII=', 'base64');
const image = `data:image/png;base64,${photo.toString('base64')}`;
const id = '12345678-1234-4234-8234-123456789abc', token = 'client_capability_abcdefghijklmnopqrstuvwxyz123456';
const input = (extra = {}) => ({ imageDataUrl: image, photoIntent: 'place', title: 'A little gift', worldPrompt: 'A quiet garden near the shoreline.', story: 'We kept the afternoon.', dedication: 'For you', senderName: 'Ana', recipientName: 'Leo', dedupeKey: 'same-draft_abcdefgh123456789', requestToken: token, consent: true, ...extra });
const status = { available: true, localOnly: false, storage: 'cloud', uploadMode: 'signed-direct', generationEnabled: true, providers: { tripo: true, worldlabs: true }, maxImageBytes: 6 * 1024 * 1024, examples: [], safety: { available: true, localOnly: false } };
const job = (state = 'processing') => ({ storage: 'cloud', id, token, state, title: 'A little gift', worldPrompt: 'A quiet garden near the shoreline.', story: 'We kept the afternoon.', dedication: 'For you', senderName: 'Ana', recipientName: 'Leo', photoIntent: 'place', objectRepresentation: 'souvenir-miniature', createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z', tripo: { state: 'pending', progress: 0 }, worldlabs: { state: 'pending', progress: 0 }, assets: { photoUrl: 'https://project.supabase.co/storage/v1/object/sign/gp-instant-private/photo?token=read-only' }, generation: { tripo: {}, worldlabs: {} } });
const success = data => new Response(JSON.stringify({ ok: true, data }), { headers: { 'Content-Type': 'application/json' } });
const failure = (code = 'CLOUD_NOT_READY', http = 503) => new Response(JSON.stringify({ ok: false, error: { code, message: 'Creation is unavailable.' } }), { status: http, headers: { 'Content-Type': 'application/json' } });
const plans = body => Object.entries(body.images).map(([imageId, declaration]) => ({ id: imageId, ...declaration, method: 'PUT', headers: { 'Content-Type': declaration.mime }, url: `https://project.supabase.co/storage/v1/object/upload/sign/gp-instant-private/${id}/input/${imageId}-${declaration.sha256}.png?token=upload-only-signature` }));
const pending = signal => new Promise((_resolve, reject) => {
  const abort = () => reject(new DOMException('Closed', 'AbortError'));
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
});
const flush = async () => { await setImmediate(); await setImmediate(); };
const until = async predicate => { for (let i = 0; i < 30 && !predicate(); i++) await flush(); assert.ok(predicate(), 'Expected transport stage was not reached'); };

function harness(options = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const action = String(url).startsWith('/api/instant-cloud?') ? new URL(url, 'https://gift.example').searchParams.get('action') : 'upload';
    const call = { url: String(url), action, ...init, json: init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined }; calls.push(call);
    if (init.signal.aborted) throw new DOMException('Closed', 'AbortError');
    if (options.hang === action) return pending(init.signal);
    if (action === 'status') return options.statusResponse?.() || success(options.status || status);
    if (action === 'prepare') {
      let result = { id, token, uploads: plans(call.json), deduplicated: false };
      result = options.prepare?.(result, call, calls) || result;
      return options.prepareResponse?.() || success(result);
    }
    if (action === 'upload') return options.uploadResponse?.(call, calls) || new Response('', { status: 200 });
    if (action === 'finalize') return options.finalizeResponse?.(call, calls) || success(options.finalized || job(options.finalState || 'processing'));
    if (action === 'job') return options.jobResponse?.(call, calls) || success(options.job || job('completed'));
    if (action === 'advance') return success(options.advanced || job('completed'));
    throw new Error(`Unexpected action ${action}`);
  };
  return { service: createCloudInstantService(fetcher), calls, actions: () => calls.map(call => call.action) };
}

test('cloud origin selection preserves localhost and enables normal remote hosts', () => {
  for (const host of ['', 'localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]']) assert.equal(cloudCreatorOrigin(host), false);
  for (const host of ['giftportals.vercel.app', 'gifts.example']) assert.equal(cloudCreatorOrigin(host), true);
});

test('photo declaration proves the exact local bytes with SHA-256 and contains no data URL', async () => {
  const value = await cloudImageBytes(image);
  assert.deepEqual(Buffer.from(value.bytes), photo);
  assert.deepEqual(value.declaration, { mime: 'image/png', bytes: photo.length, sha256: createHash('sha256').update(photo).digest('hex') });
  assert.equal(JSON.stringify(value.declaration).includes('base64'), false);
});

test('unsupported or malformed data URLs reject before a prepare request or upload', async () => {
  for (const invalid of ['', 'https://example/photo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/gif;base64,R0lGODlh', 'data:image/png;base64,', 'data:image/png;base64,a', 'data:image/png;base64,AAAA\nAAAA', 'data:image/png;charset=utf-8;base64,AAAA', 'data:image/png;base64,@@@=']) {
    const transport = harness(); await transport.service.status(new AbortController().signal);
    await assert.rejects(transport.service.create(input({ imageDataUrl: invalid }), new AbortController().signal));
    assert.deepEqual(transport.actions(), ['status']);
  }
});

test('per-photo six-MiB bound is enforced before decoding or remote preparation', async () => {
  await assert.rejects(cloudImageBytes('data:image/png;base64,' + 'A'.repeat(8_388_612)), /6 MB/);
  const bytes = Buffer.alloc(6 * 1024 * 1024); photo.copy(bytes);
  const exact = await cloudImageBytes(`data:image/png;base64,${bytes.toString('base64')}`);
  assert.equal(exact.declaration.bytes, bytes.length); assert.equal(exact.declaration.sha256, createHash('sha256').update(bytes).digest('hex'));
});

test('the combined twelve-MiB bound checks all three roles before prepare or the first PUT', async () => {
  const bytes = Buffer.alloc(4 * 1024 * 1024 + 1); photo.copy(bytes); const large = `data:image/png;base64,${bytes.toString('base64')}`;
  const transport = harness();
  await assert.rejects(transport.service.create(input({ imageDataUrl: large, objectImageDataUrl: large, worldImageDataUrl: large }), new AbortController().signal), /12 MB/);
  assert.deepEqual(transport.actions(), ['status']);
});

test('backend-compatible signed uploads carry binary photos while prepare/finalize carry only metadata', async () => {
  const transport = harness();
  const result = await transport.service.create(input({ objectImageDataUrl: image, objectImageRole: 'miniature-reference', worldImageDataUrl: image, curiosityIds: ['one'] }), new AbortController().signal);
  assert.deepEqual(transport.actions(), ['status', 'prepare', 'upload', 'upload', 'upload', 'finalize']); assert.equal(result.id, id);
  const prepare = transport.calls.find(call => call.action === 'prepare');
  assert.ok(prepare.body.length < 2500); assert.equal(prepare.body.includes('data:image'), false);
  for (const name of ['imageDataUrl', 'objectImageDataUrl', 'worldImageDataUrl']) assert.equal(Object.hasOwn(prepare.json, name), false);
  assert.deepEqual(Object.keys(prepare.json.images), ['original', 'object', 'world']);
  assert.equal(prepare.json.objectImageRole, 'miniature-reference'); assert.deepEqual(prepare.json.curiosityIds, ['one']);
  for (const upload of transport.calls.filter(call => call.action === 'upload')) {
    assert.equal(upload.method, 'PUT'); assert.equal(upload.credentials, 'omit'); assert.equal(upload.referrerPolicy, 'no-referrer');
    assert.deepEqual(upload.headers, { 'Content-Type': 'image/png' }); assert.deepEqual(Buffer.from(upload.body), photo);
    assert.equal(upload.url.includes(token), false); assert.equal(Object.hasOwn(upload.headers, 'X-Instant-Token'), false);
    assert.ok(upload.url.includes(`/gp-instant-private/${id}/input/`));
  }
  const finalize = transport.calls.at(-1); assert.deepEqual(finalize.json, { id });
  assert.equal(finalize.headers['X-Instant-Token'], token); assert.equal(finalize.credentials, 'same-origin');
  assert.equal(finalize.url.includes(token), false); assert.equal(prepare.headers['X-Instant-Token'], undefined);
});

const invalidPlans = [
  ['plain HTTP', upload => { upload.url = upload.url.replace('https:', 'http:'); }],
  ['foreign origin', upload => { upload.url = upload.url.replace('project.supabase.co', 'attacker.example'); }],
  ['deceptive suffix', upload => { upload.url = upload.url.replace('project.supabase.co', 'project.supabase.co.attacker.example'); }],
  ['URL credentials', upload => { upload.url = upload.url.replace('https://', 'https://name:secret@'); }],
  ['non-default port', upload => { upload.url = upload.url.replace('project.supabase.co', 'project.supabase.co:8443'); }],
  ['wrong bucket', upload => { upload.url = upload.url.replace('gp-instant-private', 'gp-instant-generated'); }],
  ['read capability', upload => { upload.url = upload.url.replace('/object/upload/sign/', '/object/sign/'); }],
  ['another job', upload => { upload.url = upload.url.replace(id, 'other-job-id'); }],
  ['generated path', upload => { upload.url = upload.url.replace('/input/', '/generated/'); }],
  ['path traversal', upload => { upload.url = upload.url.replace('/input/', '/input/%2e%2e/'); }],
  ['wrong method', upload => { upload.method = 'POST'; }],
  ['wrong mime', upload => { upload.mime = 'image/jpeg'; }],
  ['wrong byte count', upload => { upload.bytes++; }],
  ['wrong checksum', upload => { upload.sha256 = '0'.repeat(64); }],
  ['wrong content header', upload => { upload.headers['Content-Type'] = 'application/json'; }],
];
for (const [label, mutate] of invalidPlans) test(`rejects ${label} in the second plan before uploading the first photo`, async () => {
  const transport = harness({ prepare(result) { mutate(result.uploads[1]); return result; } });
  await assert.rejects(transport.service.create(input({ worldImageDataUrl: image }), new AbortController().signal), /verified/);
  assert.deepEqual(transport.actions(), ['status', 'prepare']);
});

test('duplicate, missing and unexpected upload roles reject the whole plan before any PUT', async () => {
  for (const change of [result => { result.uploads[1] = result.uploads[0]; }, result => { result.uploads.pop(); }, result => { result.uploads[1].id = 'unexpected'; }]) {
    const transport = harness({ prepare(result) { change(result); return result; } });
    await assert.rejects(transport.service.create(input({ worldImageDataUrl: image }), new AbortController().signal));
    assert.deepEqual(transport.actions(), ['status', 'prepare']);
  }
});

test('prepared capability mismatch and invalid job identity are rejected before any upload', async () => {
  for (const extra of [{ token: 'another-capability' }, { id: '../bad-path' }, { uploads: null }]) {
    const transport = harness({ prepare: result => ({ ...result, ...extra }) });
    await assert.rejects(transport.service.create(input(), new AbortController().signal), /verified/);
    assert.deepEqual(transport.actions(), ['status', 'prepare']);
  }
});

test('server-supplied extra headers never leak a capability to private storage', async () => {
  const transport = harness({ prepare(result) { result.uploads[0].headers.Authorization = 'Bearer server-secret'; result.uploads[0].headers['X-Instant-Token'] = token; return result; } });
  await transport.service.create(input(), new AbortController().signal);
  const upload = transport.calls.find(call => call.action === 'upload'); assert.deepEqual(upload.headers, { 'Content-Type': 'image/png' });
});

test('deduplicated completed preparation never repeats uploads and preserves the exact draft reference', async () => {
  const transport = harness({ finalState: 'completed', prepare(result, _call, calls) { if (calls.filter(call => call.action === 'prepare').length > 1) return { ...result, deduplicated: true, uploads: [] }; return result; } });
  const first = await transport.service.create(input(), new AbortController().signal), second = await transport.service.create(input(), new AbortController().signal);
  assert.deepEqual(second, first); assert.equal(transport.calls.filter(call => call.action === 'upload').length, 1);
  assert.equal(transport.calls.filter(call => call.action === 'status').length, 1);
  const bodies = transport.calls.filter(call => call.action === 'prepare').map(call => call.json);
  assert.deepEqual(bodies[1], bodies[0]); assert.equal(bodies[1].dedupeKey, input().dedupeKey); assert.equal(bodies[1].requestToken, token);
});

test('unavailable, local and malformed status or missing consent cannot start preparation', async () => {
  for (const value of [{ ...status, available: false }, { ...status, storage: 'local' }, { ...status, storage: undefined }, { ...status, localOnly: true }]) {
    const transport = harness({ status: value });
    await assert.rejects(transport.service.create(input(), new AbortController().signal)); assert.deepEqual(transport.actions(), ['status']);
  }
  const transport = harness(); await transport.service.status(new AbortController().signal);
  await assert.rejects(transport.service.create(input({ consent: false }), new AbortController().signal)); assert.deepEqual(transport.actions(), ['status']);
  const error = harness({ statusResponse: () => failure('CLOUD_NOT_READY') });
  await assert.rejects(error.service.status(new AbortController().signal), value => value.code === 'CLOUD_NOT_READY');
});

test('interrupted upload never finalizes or advances a partially uploaded draft', async () => {
  const transport = harness({ uploadResponse: () => new Response('', { status: 403 }) });
  await assert.rejects(transport.service.create(input({ worldImageDataUrl: image }), new AbortController().signal), /interrupted/);
  assert.deepEqual(transport.actions(), ['status', 'prepare', 'upload']);
});

test('partial multi-photo upload resumes the same draft from memory and never rewrites confirmed inputs', async () => {
  const declaration = (await cloudImageBytes(image)).declaration;
  let interrupted = false;
  const transport = harness({
    uploadResponse(call) { if (!interrupted && call.url.includes('/world-')) { interrupted = true; return new Response('', { status: 403 }); } },
    job: { ...job(), uploadState: 'pending', uploads: plans({ images: { world: declaration } }) },
    finalized: { ...job(), uploadState: 'finalized' },
  });
  await assert.rejects(transport.service.create(input({ objectImageDataUrl: image, worldImageDataUrl: image }), new AbortController().signal), /interrupted/);
  const current = await transport.service.job({ id, token }, new AbortController().signal);
  assert.equal(current.uploadState, 'pending'); assert.equal(transport.actions().includes('advance'), false);
  const recovered = await transport.service.resumeUpload({ id, token }, {}, new AbortController().signal);
  assert.equal(recovered.uploadState, 'finalized');
  assert.deepEqual(transport.actions(), ['status', 'prepare', 'upload', 'upload', 'upload', 'job', 'job', 'upload', 'finalize']);
  const uploadedRoles = transport.calls.filter(call => call.action === 'upload').map(call => /\/input\/(\w+)-/.exec(call.url)[1]);
  assert.deepEqual(uploadedRoles, ['original', 'object', 'world', 'world']);
  assert.deepEqual(transport.calls.at(-1).json, { id });
});

test('reload after every PUT succeeded finalizes the existing draft without uploading or preparing again', async () => {
  const transport = harness({ job: { ...job(), uploadState: 'pending', uploads: [] }, finalized: { ...job('completed'), uploadState: 'finalized' } });
  const result = await transport.service.job({ dedupeKey: input().dedupeKey, token }, new AbortController().signal);
  assert.equal(result.state, 'completed'); assert.deepEqual(transport.actions(), ['job', 'finalize']);
  assert.equal(transport.calls.at(-1).headers['X-Instant-Token'], token); assert.deepEqual(transport.calls.at(-1).json, { id });
});

test('a lost finalize response recovers a completed gift with the same capability and no replacement paid submission', async () => {
  const completed = { ...job('completed'), uploadState: 'finalized', tripo: { state: 'completed' }, worldlabs: { state: 'completed' }, assets: { modelUrl: 'https://project.supabase.co/model', worldUrl: 'https://project.supabase.co/world', photoUrl: 'https://project.supabase.co/photo' } };
  const transport = harness({ finalizeResponse: () => { throw new TypeError('Reply lost after server finalization'); }, job: completed });
  await assert.rejects(transport.service.create(input(), new AbortController().signal), /Reply lost/);
  const result = await transport.service.resumeUpload({ dedupeKey: input().dedupeKey, token }, {}, new AbortController().signal);
  assert.deepEqual(result, completed); assert.equal(result.id, id); assert.equal(result.token, token);
  assert.deepEqual(transport.actions(), ['status', 'prepare', 'upload', 'finalize', 'job']);
});

test('reloaded draft validates all reselected photos before PUT and accepts only exact original or prepared bytes', async () => {
  const declaration = (await cloudImageBytes(image)).declaration;
  const pendingJob = { ...job(), uploadState: 'pending', uploads: plans({ images: { original: declaration, world: declaration } }) };
  const transport = harness({ job: pendingJob, finalized: { ...job(), uploadState: 'finalized' } });
  const other = 'data:image/png;base64,' + Buffer.from('wrong photo').toString('base64');
  await assert.rejects(transport.service.resumeUpload({ id, token }, { original: image, world: other }, new AbortController().signal), /same photo/);
  assert.deepEqual(transport.actions(), ['job'], 'A wrong second photo cannot write the first');
  await transport.service.resumeUpload({ id, token }, { original: [other, image], world: image }, new AbortController().signal);
  assert.deepEqual(transport.actions(), ['job', 'job', 'upload', 'upload', 'finalize']);
});

test('invalid pending upload plans and late aborted GET replies never upload, finalize, or advance', async () => {
  const declaration = (await cloudImageBytes(image)).declaration;
  const invalid = harness({ job: { ...job(), uploadState: 'pending', uploads: plans({ images: { original: declaration } }).map(upload => ({ ...upload, url: upload.url.replace(id, 'different-job-id') })) } });
  await assert.rejects(invalid.service.resumeUpload({ id, token }, { original: image }, new AbortController().signal), /verified/);
  assert.deepEqual(invalid.actions(), ['job']);
  let release;
  const late = harness({ jobResponse: () => new Promise(resolve => { release = resolve; }) });
  const owner = new AbortController(), task = late.service.resumeUpload({ id, token }, {}, owner.signal);
  owner.abort(); release(success({ ...job(), uploadState: 'pending', uploads: [] }));
  await assert.rejects(task, { name: 'AbortError' }); assert.deepEqual(late.actions(), ['job']);
});

test('job polling is a pure GET for every terminal state and capabilities stay out of URLs', async () => {
  for (const state of ['completed', 'partial', 'failed']) {
    const transport = harness({ job: job(state) });
    assert.equal((await transport.service.job({ dedupeKey: 'saved-draft_123456789', token }, new AbortController().signal)).state, state);
    assert.deepEqual(transport.actions(), ['job']); const call = transport.calls[0];
    assert.equal(call.method, 'GET'); assert.equal(call.body, undefined); assert.ok(call.url.includes('dedupeKey=saved-draft_123456789'));
    assert.equal(call.headers['X-Instant-Token'], token); assert.equal(call.url.includes(token), false);
  }
});

test('only processing jobs use a separate explicit advance POST after their GET', async () => {
  const transport = harness({ job: job('processing') });
  const result = await transport.service.job({ id, token }, new AbortController().signal);
  assert.deepEqual(transport.actions(), ['job', 'advance']); assert.equal(result.state, 'completed');
  assert.equal(transport.calls[0].method, 'GET'); assert.equal(transport.calls[1].method, 'POST'); assert.deepEqual(transport.calls[1].json, { id });
  assert.equal(transport.calls[1].headers['X-Instant-Token'], token);
  const failed = harness({ jobResponse: () => failure('JOB_UNAVAILABLE', 404) });
  await assert.rejects(failed.service.job({ id, token }, new AbortController().signal), value => value.code === 'JOB_UNAVAILABLE');
  assert.deepEqual(failed.actions(), ['job']);
});

test('API and signed PUT requests refuse redirects rather than forwarding bytes or capability headers', async () => {
  const transport = harness(); await transport.service.create(input(), new AbortController().signal);
  assert.ok(transport.calls.every(call => call.redirect === 'error'), 'Both JSON capability requests and raw image uploads must reject redirects');
});

test('aborted creation is rejected before remote prepare and abort during prepare cannot reach PUT', async () => {
  const transport = harness(); await transport.service.status(new AbortController().signal); const closed = new AbortController(); closed.abort();
  await assert.rejects(transport.service.create(input(), closed.signal), { name: 'AbortError' }); assert.deepEqual(transport.actions(), ['status']);
  const pendingTransport = harness({ hang: 'prepare' }), owner = new AbortController();
  await pendingTransport.service.status(owner.signal); const task = pendingTransport.service.create(input(), owner.signal); task.catch(() => {});
  await until(() => pendingTransport.calls.some(call => call.action === 'prepare')); owner.abort();
  await assert.rejects(task, { name: 'AbortError' }); assert.deepEqual(pendingTransport.actions(), ['status', 'prepare']);
});

test('GET timeout is finite and completed requests detach caller-abort listeners and clear timers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = harness({ hang: 'status' }), owner = new AbortController(), task = transport.service.status(owner.signal); task.catch(() => {});
  const request = transport.calls[0]; t.mock.timers.tick(29_999); assert.equal(request.signal.aborted, false);
  t.mock.timers.tick(1); await assert.rejects(task, { name: 'AbortError' }); assert.equal(request.signal.aborted, true);
  const done = harness(), caller = new AbortController(); await done.service.status(caller.signal); const completed = done.calls[0];
  caller.abort(); t.mock.timers.tick(190_001); assert.equal(completed.signal.aborted, false, 'A settled request retains neither its deadline nor the caller listener');
});

test('prepare and advance POST timeouts are finite and never cause replacement submissions', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const action of ['prepare', 'advance']) {
    const transport = harness({ hang: action, job: job('processing') }), owner = new AbortController(); await transport.service.status(owner.signal);
    const task = action === 'prepare' ? transport.service.create(input(), owner.signal) : transport.service.job({ id, token }, owner.signal); task.catch(() => {});
    await until(() => transport.calls.some(call => call.action === action)); const stalled = transport.calls.find(call => call.action === action);
    t.mock.timers.tick(189_999); assert.equal(stalled.signal.aborted, false); t.mock.timers.tick(1);
    await assert.rejects(task, { name: 'AbortError' });
    assert.equal(transport.calls.filter(call => call.action === action).length, 1); assert.equal(transport.calls.filter(call => call.action === 'finalize').length, 0);
  }
});

test('signed PUT has its own finite timeout and never finalizes after expiry or caller abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const reason of ['deadline', 'caller']) {
    const transport = harness({ hang: 'upload' }), owner = new AbortController(); await transport.service.status(owner.signal);
    const task = transport.service.create(input(), owner.signal); task.catch(() => {});
    try {
      await until(() => transport.calls.some(call => call.action === 'upload')); const upload = transport.calls.find(call => call.action === 'upload');
      if (reason === 'deadline') { t.mock.timers.tick(59_999); assert.equal(upload.signal.aborted, false); t.mock.timers.tick(1); }
      else owner.abort();
      assert.equal(upload.signal.aborted, true); await assert.rejects(task, { name: 'AbortError' });
      assert.deepEqual(transport.actions(), ['status', 'prepare', 'upload']);
    } finally { owner.abort(); await task.catch(() => {}); }
  }
  const completed = harness(), caller = new AbortController(); await completed.service.create(input(), caller.signal);
  caller.abort(); t.mock.timers.tick(190_001);
  assert.ok(completed.calls.every(call => !call.signal.aborted), 'Successful uploads and JSON requests detach their caller-abort listener and cancel each deadline');
});
