import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { exportExampleWorld, validateExampleSPZ } from '../tools/export-v12-example-world.mjs';

globalThis.fetch = async () => { throw Error('NO_PROVIDER_REQUESTS_ALLOWED'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const spz = points => { const raw = Buffer.alloc(32); raw.write('NGSP'); raw.writeUInt32LE(3, 4); raw.writeUInt32LE(points, 8); return gzipSync(raw); };
const png = () => { const raw = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(raw); raw.write('IHDR', 12); raw.writeUInt32BE(512, 16); raw.writeUInt32BE(512, 20); return raw; };
const glb = (external = false) => {
  const json = JSON.stringify({ asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ count: 3, min: [-1, -1, -1], max: [1, 1, 1] }], ...(external ? { buffers: [{ uri: 'https://private.invalid/model.bin?token=secret' }] } : {}) });
  const padded = json.padEnd(Math.ceil(json.length / 4) * 4, ' '), raw = Buffer.alloc(20 + padded.length);
  raw.write('glTF'); raw.writeUInt32LE(2, 4); raw.writeUInt32LE(raw.length, 8); raw.writeUInt32LE(padded.length, 12); raw.writeUInt32LE(0x4e4f534a, 16); raw.write(padded, 20); return raw;
};
async function saveJSON(path, value) { await writeFile(path, JSON.stringify(value, null, 2)); }
async function fixture(t, scene = 'rio') {
  const app = await mkdtemp(join(tmpdir(), 'giftportals-example-export-'));
  t.after(() => rm(app, { recursive: true, force: true }));
  const folder = join(app, '.local-giftportals/worlds/example-v12'), outputs = join(app, 'outputs/v12');
  await mkdir(folder, { recursive: true }); await mkdir(outputs, { recursive: true }); await mkdir(join(app, 'public/demo/v13'), { recursive: true }); await mkdir(join(app, 'public/assets/examples/v12'), { recursive: true }); await mkdir(join(app, 'public/assets/examples/v13'), { recursive: true });
  const referenceURL = scene === 'rio' ? '/assets/examples/v12/rio-sailboats-reference.png' : '/assets/examples/v13/antikythera-world.png';
  const reference = png(), model = glb(), modelURL = scene === 'rio' ? '/demo/rio-keepsake.glb' : '/demo/v13/antikythera-model.glb';
  await writeFile(join(app, 'public', referenceURL.slice(1)), reference); await writeFile(join(app, 'public', modelURL.slice(1)), model);
  const baseGiftURL = scene === 'rio' ? '/demo/rio-generated-gift.json' : '/demo/v13/antikythera-generated-gift.json';
  const base = { title: 'Original title', senderName: 'Clara', recipientName: 'Alex', dedication: 'This little gift made me think of you.', story: 'The original reviewed story.', originalUrl: scene === 'rio' ? '/assets/portal-dusk/rio-keepsake.png' : '/demo/v13/antikythera-photo.jpg', modelUrl: modelURL, photoIntent: 'object', worldUrl: '/demo/old-world.spz', collisionUrl: '/demo/old-collider.glb', operationSecret: 'SECRET_BASE_METADATA' };
  await saveJSON(join(app, 'public', baseGiftURL.slice(1)), base);
  const config = { version: 1, scene, baseGiftUrl: baseGiftURL, title: scene === 'rio' ? 'Rio de Janeiro · Sailboats' : 'A world of human curiosity', story: scene === 'rio' ? 'Imagine the warm sunset along an open Rio promenade, with white sailboats crossing the bay and Sugarloaf Mountain ahead.' : 'Imagine an ancient island observatory and the curiosity that turned questions into gears.', reference: { url: referenceURL, prompt: `An ultra realistic ${scene} outdoor world with physically credible materials and a clear walkable promenade.`, provenance: 'Original GiftPortals AI artwork and a photographic reinterpretation. Not a real geographic photograph.' }, sourceAttribution: { author: 'GiftPortals · original AI artwork', sourceUrl: referenceURL, license: 'Original AI artwork', licenseUrl: referenceURL, changes: 'Photographic reinterpretation of the original AI composition; not a real geographic photograph.' }, privateKey: 'SECRET_CONFIG_METADATA' };
  const receipt = { version: 1, provider: 'worldlabs', model: 'marble-1.1-plus', state: 'completed', inputMode: 'single-image', quality: '500k', promptSha256: digest(config.reference.prompt), referenceImage: { mime: 'image/png', bytes: reference.length, sha256: digest(reference) }, semantics: { metricScaleFactor: 2.9, groundPlaneOffset: 1.6, private: 'SECRET_SEMANTICS' }, maxReservedCredits: 3080, actualCredits: 1580, operationId: 'valid-operation', worldId: 'valid-world', fullResStatus: 'available', assets: [], privateURL: 'https://private.worldlabs.ai?token=SECRET_RECEIPT' };
  for (const [suffix, name, mime, bytes] of [['spz', 'world.spz', 'application/octet-stream', spz(500000)], ['spz100k', 'world-100k.spz', 'application/octet-stream', spz(100000)], ['pano', 'panorama.png', 'image/png', png()], ['collider', 'collider.glb', 'model/gltf-binary', glb()], ['spzfull', 'world-full-res.spz', 'application/octet-stream', spz(2000000)]]) {
    const path = join(folder, name); await writeFile(path, bytes); receipt.assets.push({ suffix, path, mime, bytes: bytes.length, sha256: digest(bytes) });
  }
  const receiptFile = join(outputs, `${scene}-receipt.json`), configFile = join(outputs, `${scene}-config.json`);
  await saveJSON(receiptFile, receipt); await saveJSON(configFile, config);
  return { app, scene, folder, outputs, reference, model, base, config, receipt, receiptFile, configFile, export: () => exportExampleWorld({ app, scene, receiptFile, configFile }) };
}
async function gift(f) { return JSON.parse(await readFile(join(f.app, `public/demo/v12/${f.scene}-generated-gift.json`), 'utf8')); }
async function proof(f) { return JSON.parse(await readFile(join(f.app, `public/demo/v12/${f.scene}-world.provenance.json`), 'utf8')); }
async function unpublished(f) { await assert.rejects(() => access(join(f.app, `public/demo/v12/${f.scene}-generated-gift.json`)), { code: 'ENOENT' }); }

test('completed Rio exports bounded default and mobile worlds, truthful artistic metadata and an unchanged miniature', async t => {
  const f = await fixture(t), result = await f.export(), exported = await gift(f), evidence = await proof(f);
  assert.equal(result.providerCalls, 0); assert.equal(result.privateRecordsExported, false); assert.equal(result.assets.length, 5);
  assert.equal(exported.title, 'Rio de Janeiro · Sailboats'); assert.equal(exported.sourceImageKind, 'artistic-reference');
  assert.equal(exported.originalUrl, f.config.reference.url); assert.equal(exported.sourcePhotoUrl, f.config.reference.url); assert.equal(exported.keepsakeImageUrl, '/assets/portal-dusk/rio-keepsake.png');
  for (const field of ['senderName', 'recipientName', 'dedication', 'modelUrl']) assert.equal(exported[field], f.base[field]);
  assert.deepEqual(await readFile(join(f.app, 'public', f.base.modelUrl.slice(1))), f.model);
  assert.match(exported.worldUrl, /500k\.spz$/); assert.match(exported.mobileWorldUrl, /100k\.spz$/); assert.match(exported.collisionUrl, /collider\.glb$/); assert.equal(exported.worldUrlFullRes, undefined);
  const full = evidence.assets.find(asset => asset.suffix === 'spzfull'); assert.equal(full.validation.points, 2000000); assert.equal(full.url, undefined); assert.equal(full.operatorPath, 'outputs/v12/rio-world-full-res.spz');
  assert.deepEqual(await readFile(join(f.outputs, 'rio-world-full-res.spz')), spz(2000000)); await assert.rejects(() => access(join(f.app, 'public/demo/v12/rio-world-full-res.spz')), { code: 'ENOENT' });
  assert.equal(evidence.reference.prompt, f.config.reference.prompt); assert.equal(evidence.reference.sha256, digest(f.reference)); assert.equal(evidence.baseline.model.sha256, digest(f.model));
  assert.equal(evidence.defaultQuality, '500k'); assert.deepEqual(evidence.mobileQuality, { exported: true, quality: '100k', activatedByExport: false }); assert.deepEqual(evidence.fullResolution, { status: 'availableLocal', operatorOnly: true, published: false }); assert.deepEqual(exported.worldSemantics, { metricScaleFactor: 2.9, groundPlaneOffset: 1.6 });
  assert.doesNotMatch(JSON.stringify(exported) + JSON.stringify(evidence), /SECRET_|private\.worldlabs|privateKey|operationSecret/);
});
test('Antikythera preserves the original object and reviewed gift identity while replacing only the world', async t => {
  const f = await fixture(t, 'antikythera'); f.receipt.model = 'marble-1.1'; await saveJSON(f.receiptFile, f.receipt); await f.export();
  const exported = await gift(f); assert.equal(exported.originalUrl, f.base.originalUrl); assert.equal(exported.photoIntent, 'object'); assert.equal(exported.modelUrl, f.base.modelUrl); assert.equal(exported.sourceImageKind, undefined); assert.equal((await proof(f)).model, 'marble-1.1');
});
test('unfinished receipts, outdated models, mismatched references and modified prompts fail before publishing', async t => {
  for (const change of [{ state: 'processing' }, { state: 'failed' }, { provider: 'tripo' }, { model: 'marble-1.0' }, { quality: '100k' }, { promptSha256: 'a'.repeat(64) }, { referenceImage: { mime: 'image/png', bytes: 24, sha256: 'b'.repeat(64) } }]) {
    const f = await fixture(t); Object.assign(f.receipt, change); await saveJSON(f.receiptFile, f.receipt);
    await assert.rejects(() => f.export(), error => ['COMPLETED_WORLD_REQUIRED', 'WORLD_PROMPT_MISMATCH', 'WORLD_REFERENCE_MISMATCH'].includes(error.code)); await unpublished(f);
  }
});
test('Rio reference attribution cannot be published from text, multiple images or an unspecified input mode', async t => {
  for (const inputMode of [undefined, 'text', 'multi-image']) {
    const f = await fixture(t); f.receipt.inputMode = inputMode; await saveJSON(f.receiptFile, f.receipt);
    await assert.rejects(() => f.export(), { code: 'RIO_SINGLE_IMAGE_REQUIRED' }); await unpublished(f);
  }
});
test('altered content, hashes, byte counts, MIME and duplicated suffixes are rejected before publishing', async t => {
  for (const failure of ['hash', 'bytes', 'mime', 'duplicate', 'missing']) {
    const f = await fixture(t), asset = f.receipt.assets[0];
    if (failure === 'hash') asset.sha256 = 'c'.repeat(64);
    if (failure === 'bytes') asset.bytes++;
    if (failure === 'mime') asset.mime = 'image/png';
    if (failure === 'duplicate') f.receipt.assets.push({ ...asset });
    if (failure === 'missing') f.receipt.assets.shift();
    await saveJSON(f.receiptFile, f.receipt);
    await assert.rejects(() => f.export(), error => ['ASSET_HASH_MISMATCH', 'ASSET_SIZE_MISMATCH', 'WORLD_ASSET_MIME_INVALID', 'WORLD_ASSETS_INVALID', 'WORLD_REQUIRED_ASSET_MISSING'].includes(error.code)); await unpublished(f);
  }
});
test('path traversal, root-prefix lookalikes and paths outside the two allowed source roots are denied', async t => {
  for (const directory of ['outside', '.local-giftportals-untrusted']) {
    const f = await fixture(t), outside = join(f.app, directory); await mkdir(outside); const path = join(outside, 'world.spz'); await writeFile(path, spz(500000)); f.receipt.assets[0].path = path; await saveJSON(f.receiptFile, f.receipt);
    await assert.rejects(() => f.export(), { code: 'EXPORT_SOURCE_DENIED' }); await unpublished(f);
  }
  const f = await fixture(t); f.config.reference.url = '/assets/examples/../../private.png'; await saveJSON(f.configFile, f.config); await assert.rejects(() => f.export(), { code: 'PUBLIC_ASSET_URL_INVALID' }); await unpublished(f);
});
test('source directory junctions escaping approved roots are denied after realpath resolution', async t => {
  const f = await fixture(t), outside = join(f.app, 'outside'); await mkdir(outside); await writeFile(join(outside, 'world.spz'), spz(500000));
  const link = join(f.app, '.local-giftportals/escape');
  try { await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('This host cannot create test directory links'); throw error; }
  f.receipt.assets[0].path = join(link, 'world.spz'); await saveJSON(f.receiptFile, f.receipt); await assert.rejects(() => f.export(), { code: 'EXPORT_SOURCE_DENIED' }); await unpublished(f);
});
test('publishing into a destination junction outside the application is denied', async t => {
  const f = await fixture(t), outside = await mkdtemp(join(tmpdir(), 'giftportals-export-outside-')); t.after(() => rm(outside, { recursive: true, force: true }));
  try { await symlink(outside, join(f.app, 'public/demo/v12'), process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('This host cannot create test directory links'); throw error; }
  await assert.rejects(() => f.export(), { code: 'EXPORT_DESTINATION_DENIED' }); await assert.rejects(() => access(join(outside, 'rio-world-500k.spz')), { code: 'ENOENT' });
});
test('an approved source root cannot itself be redirected outside the application', async t => {
  const f = await fixture(t), outside = await mkdtemp(join(tmpdir(), 'giftportals-source-outside-')); t.after(() => rm(outside, { recursive: true, force: true }));
  const privateRoot = join(f.app, '.local-giftportals'); await rm(privateRoot, { recursive: true });
  try { await symlink(outside, privateRoot, process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('This host cannot create test directory links'); throw error; }
  await mkdir(join(outside, 'worlds/example-v12'), { recursive: true }); await writeFile(join(outside, 'worlds/example-v12/world.spz'), spz(500000));
  await assert.rejects(() => f.export(), { code: 'EXPORT_SOURCE_DENIED' }); await unpublished(f);
});
test('SPZ decompression and tier point limits reject corrupt or mislabelled worlds', async t => {
  assert.equal(validateExampleSPZ(spz(600000)).points, 600000); assert.equal(validateExampleSPZ(spz(150000), 'spz100k').points, 150000); assert.equal(validateExampleSPZ(spz(2500000), 'spzfull').points, 2500000);
  for (const [points, suffix] of [[0, 'spz'], [600001, 'spz'], [150001, 'spz100k'], [2500001, 'spzfull']]) assert.throws(() => validateExampleSPZ(spz(points), suffix), { code: 'SPZ_POINTS_INVALID' });
  assert.throws(() => validateExampleSPZ(Buffer.from('not gzip')), { code: 'SPZ_MAGIC_INVALID' }); assert.throws(() => validateExampleSPZ(Buffer.from([31, 139, 1])), { code: 'SPZ_CONTENT_INVALID' });
  const f = await fixture(t), meta = f.receipt.assets.find(asset => asset.suffix === 'spz100k'), bytes = spz(200000); await writeFile(meta.path, bytes); meta.bytes = bytes.length; meta.sha256 = digest(bytes); await saveJSON(f.receiptFile, f.receipt); await assert.rejects(() => f.export(), { code: 'SPZ_POINTS_INVALID' }); await unpublished(f);
});
test('corrupt GLBs or external collider dependencies fail before publishing', async t => {
  for (const bytes of [Buffer.from('fake glTF'), glb(true)]) {
    const f = await fixture(t), meta = f.receipt.assets.find(asset => asset.suffix === 'collider'); await writeFile(meta.path, bytes); meta.bytes = bytes.length; meta.sha256 = digest(bytes); await saveJSON(f.receiptFile, f.receipt);
    await assert.rejects(() => f.export(), error => ['GLB_MAGIC_INVALID', 'GLB_EXTERNAL_DEPENDENCY'].includes(error.code)); await unpublished(f);
  }
});
test('invalid metric semantics and misleading Rio attribution are rejected', async t => {
  for (const semantics of [{ metricScaleFactor: 0, groundPlaneOffset: 1 }, { metricScaleFactor: 101, groundPlaneOffset: 1 }, { metricScaleFactor: 2, groundPlaneOffset: 10001 }, { metricScaleFactor: '2', groundPlaneOffset: 1 }]) {
    const f = await fixture(t); f.receipt.semantics = semantics; await saveJSON(f.receiptFile, f.receipt); await assert.rejects(() => f.export(), { code: 'METRIC_SEMANTICS_REQUIRED' }); await unpublished(f);
  }
  const f = await fixture(t); f.config.sourceAttribution.author = 'Donatas Dabravolskas'; f.config.sourceAttribution.sourceUrl = 'https://commons.wikimedia.org/wiki/Example'; await saveJSON(f.configFile, f.config); await assert.rejects(() => f.export(), { code: 'RIO_AI_ATTRIBUTION_REQUIRED' }); await unpublished(f);
});
test('unknown cost stays unknown, optional tiers stay absent, and stale collision URLs are removed', async t => {
  const f = await fixture(t); delete f.receipt.actualCredits; f.receipt.assets = f.receipt.assets.filter(asset => ['spz', 'pano'].includes(asset.suffix)); await saveJSON(f.receiptFile, f.receipt); await f.export();
  const exported = await gift(f), evidence = await proof(f); assert.equal(exported.mobileWorldUrl, undefined); assert.equal(exported.collisionUrl, undefined); assert.equal(evidence.costStatus, 'unknown'); assert.equal(evidence.actualCredits, undefined); assert.deepEqual(evidence.mobileQuality, { exported: false, activatedByExport: false }); assert.deepEqual(evidence.fullResolution, { status: 'unavailable', operatorOnly: true, published: false });
});
test('full-resolution download failures and unrequested tiers do not claim a retained local artifact', async t => {
  for (const status of ['download-failed', undefined]) {
    const f = await fixture(t); f.receipt.assets = f.receipt.assets.filter(asset => asset.suffix !== 'spzfull'); if (status) { f.receipt.fullResStatus = status; f.receipt.fullResErrorCode = 'GENERATED_ASSET_SIZE_LIMIT'; } else delete f.receipt.fullResStatus;
    await saveJSON(f.receiptFile, f.receipt); await f.export(); assert.deepEqual((await proof(f)).fullResolution, { status: status ? 'downloadFailed' : 'notRequested', operatorOnly: true, published: false, ...(status ? { errorCode: 'GENERATED_ASSET_SIZE_LIMIT' } : {}) });
  }
});
test('unsafe evidence text, signed attribution URLs and impossible charges cannot enter public proof', async t => {
  const f = await fixture(t); f.config.reference.provenance = 'Original AI artwork apiKey=secret'; await saveJSON(f.configFile, f.config); await assert.rejects(() => f.export(), { code: 'EXPORT_TEXT_INVALID' }); await unpublished(f);
  f.config.reference.provenance = 'Original GiftPortals AI artwork and photographic reinterpretation.'; f.config.sourceAttribution.sourceUrl = 'https://example.com/image?token=secret'; await saveJSON(f.configFile, f.config); await assert.rejects(() => f.export(), { code: 'ATTRIBUTION_URL_INVALID' }); await unpublished(f);
  f.config.sourceAttribution.sourceUrl = f.config.reference.url; await saveJSON(f.configFile, f.config); f.receipt.actualCredits = 3081; await saveJSON(f.receiptFile, f.receipt); await assert.rejects(() => f.export(), { code: 'WORLD_COST_INVALID' }); await unpublished(f);
});
test('reviewed initial framing stays bounded, separate from provider generation metadata', async t => {
  const f = await fixture(t); Object.assign(f.config, { initialYaw: -.4, initialPitch: .1 }); await saveJSON(f.configFile, f.config); await f.export();
  assert.equal((await gift(f)).initialYaw, -.4); assert.deepEqual((await proof(f)).initialOrientation, { yaw: -.4, pitch: .1 });
  const invalid = await fixture(t); invalid.config.initialYaw = Math.PI + .01; await saveJSON(invalid.configFile, invalid.config); await assert.rejects(() => invalid.export(), { code: 'INITIAL_ORIENTATION_INVALID' }); await unpublished(invalid);
});
test('provider-compatible long prompts retain their exact generation hash and remain bounded', async t => {
  const f = await fixture(t); f.config.reference.prompt = 'A photographic outdoor spatial reference. '.repeat(70).trim(); assert.ok(f.config.reference.prompt.length > 2000); f.receipt.promptSha256 = digest(f.config.reference.prompt); await saveJSON(f.configFile, f.config); await saveJSON(f.receiptFile, f.receipt); await f.export(); assert.equal((await proof(f)).reference.prompt, f.config.reference.prompt);
  const invalid = await fixture(t); invalid.config.reference.prompt = 'x'.repeat(4001); invalid.receipt.promptSha256 = digest(invalid.config.reference.prompt); await saveJSON(invalid.configFile, invalid.config); await saveJSON(invalid.receiptFile, invalid.receipt); await assert.rejects(() => invalid.export(), { code: 'EXPORT_TEXT_INVALID' }); await unpublished(invalid);
});
test('preferred initial spawn is copied exactly with reviewed calibration metadata and has no default', async t => {
  const f = await fixture(t); f.config.initialSpawn = [0, 1.76932806, 4]; await saveJSON(f.configFile, f.config); const configBefore = await readFile(f.configFile); await f.export();
  const exported = await gift(f), evidence = await proof(f); assert.deepEqual(exported.initialSpawn, f.config.initialSpawn); assert.deepEqual(evidence.reviewedInitialPose, { preferredEye: f.config.initialSpawn, requiresGroundAndBodyCalibration: true });
  exported.initialSpawn[0] = 99; assert.equal(evidence.reviewedInitialPose.preferredEye[0], 0); assert.deepEqual(await readFile(f.configFile), configBefore);
  const noDefault = await fixture(t); await noDefault.export(); assert.equal((await gift(noDefault)).initialSpawn, undefined); assert.equal((await proof(noDefault)).reviewedInitialPose, undefined);
});
test('preferred initial spawn rejects malformed, nonfinite and out-of-bounds tuples before publication', async t => {
  for (const initialSpawn of [null, {}, [0,1], [0,1,2,3], ['0',1,2], [0,251,0], [-250.001,1,0], [0,1,250.001]]) {
    const f = await fixture(t); f.config.initialSpawn = initialSpawn; await saveJSON(f.configFile, f.config); await assert.rejects(() => f.export(), { code: 'INITIAL_SPAWN_INVALID' }); await unpublished(f);
  }
  const valid = await fixture(t); valid.config.initialSpawn = [-250,250,250]; await saveJSON(valid.configFile, valid.config); await valid.export(); assert.deepEqual((await gift(valid)).initialSpawn, [-250,250,250]);
});
test('reviewed eye height is bounded from .5 to 3 metres, copied without an invented default', async t => {
  for (const initialEyeHeight of [.5, 2.2, 3]) {
    const f = await fixture(t); f.config.initialEyeHeight = initialEyeHeight; await saveJSON(f.configFile, f.config); await f.export(); assert.equal((await gift(f)).initialEyeHeight, initialEyeHeight); assert.equal((await proof(f)).reviewedInitialPose.eyeHeight, initialEyeHeight);
  }
  for (const initialEyeHeight of [null, '2.2', .499, 3.001]) {
    const f = await fixture(t); f.config.initialEyeHeight = initialEyeHeight; await saveJSON(f.configFile, f.config); await assert.rejects(() => f.export(), { code: 'INITIAL_EYE_HEIGHT_INVALID' }); await unpublished(f);
  }
  const noDefault = await fixture(t); await noDefault.export(); assert.equal((await gift(noDefault)).initialEyeHeight, undefined); assert.equal((await proof(noDefault)).reviewedInitialPose, undefined);
});
