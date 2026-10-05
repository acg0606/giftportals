import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { exportPublicWorldOverlay, PUBLIC_WORLD_TARGETS } from '../tools/export-v12-public-world-overlay.mjs';

globalThis.fetch = async () => { throw Error('NO_PROVIDER_CALLS_ALLOWED'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const spz = points => { const raw = Buffer.alloc(32); raw.write('NGSP'); raw.writeUInt32LE(3, 4); raw.writeUInt32LE(points, 8); return gzipSync(raw); };
const png = () => { const raw = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(raw); raw.write('IHDR', 12); raw.writeUInt32BE(512, 16); raw.writeUInt32BE(512, 20); return raw; };
const glb = (external = false) => {
  const json = JSON.stringify({ asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ count: 3, min: [-1,-1,-1], max: [1,1,1] }], ...(external ? { images: [{ uri: 'https://private.invalid/image?token=SECRET' }] } : {}) });
  const padded = json.padEnd(Math.ceil(json.length / 4) * 4, ' '), raw = Buffer.alloc(20 + padded.length); raw.write('glTF'); raw.writeUInt32LE(2, 4); raw.writeUInt32LE(raw.length, 8); raw.writeUInt32LE(padded.length, 12); raw.writeUInt32LE(0x4e4f534a, 16); raw.write(padded, 20); return raw;
};
const saveJSON = (path, data) => writeFile(path, JSON.stringify(data, null, 2));
async function fixture(t, slug = 'pracinha-court') {
  const app = await mkdtemp(join(tmpdir(), 'giftportals-public-overlay-')); t.after(() => rm(app, { recursive: true, force: true }));
  const folder = join(app, '.local-giftportals/quality-trials/worlds/public-world'), outputs = join(app, 'outputs/v11'); await mkdir(folder, { recursive: true }); await mkdir(outputs, { recursive: true });
  const referenceBytes = png(), referencePath = join(folder, 'source-photo.png'); await writeFile(referencePath, referenceBytes);
  const config = { version: 1, slug, targetPublicGiftId: PUBLIC_WORLD_TARGETS[slug], reference: { path: referencePath, bytes: referenceBytes.length, sha256: digest(referenceBytes), mime: 'image/png', prompt: 'Faithfully reconstruct this real public praça photograph as a clear, natural outdoor spatial world with connected ground and realistic materials.', provenance: 'Original archived source photograph of Praça Américo Portugal Gouvêa. Unseen areas remain generated interpretations.' }, initialYaw: .2, initialPitch: -.1, story: 'SECRET_GIFT_STORY', dedication: 'SECRET_GIFT_DEDICATION', modelUrl: 'https://private.invalid/model?token=SECRET', originalUrl: 'https://private.invalid/source?token=SECRET' };
  const receipt = { provider: 'worldlabs', state: 'completed', model: 'marble-1.1-plus', inputMode: 'single-image', quality: '500k', promptSha256: digest(config.reference.prompt), provenance: config.reference.provenance, referenceImage: { bytes: referenceBytes.length, sha256: digest(referenceBytes), mime: 'image/png' }, semantics: { metricScaleFactor: 2.4, groundPlaneOffset: .8, privateToken: 'SECRET_SEMANTICS' }, maxReservedCredits: 3080, actualCredits: 1580, fullResStatus: 'available', assets: [], operationId: 'SECRET_OPERATION', worldId: 'SECRET_WORLD', signedAssetURL: 'https://private.worldlabs.ai?token=SECRET_RECEIPT' };
  for (const [suffix, name, mime, bytes] of [['spz', 'world.spz', 'application/octet-stream', spz(500000)], ['spz100k', 'world-100k.spz', 'application/octet-stream', spz(100000)], ['pano', 'panorama.png', 'image/png', png()], ['collider', 'collider.glb', 'model/gltf-binary', glb()], ['spzfull', 'world-full-res.spz', 'application/octet-stream', spz(2000000)]]) {
    const path = join(folder, name); await writeFile(path, bytes); receipt.assets.push({ suffix, path, bytes: bytes.length, sha256: digest(bytes), mime });
  }
  const receiptFile = join(outputs, `${slug}-receipt.json`), configFile = join(outputs, `${slug}-export-config.json`); await saveJSON(receiptFile, receipt); await saveJSON(configFile, config);
  const archivePath = join(app, '.local-giftportals/public-archive.json'), archiveBytes = JSON.stringify({ originalUrl: config.originalUrl, modelUrl: config.modelUrl, story: config.story, dedication: config.dedication }); await writeFile(archivePath, archiveBytes);
  return { app, slug, folder, outputs, config, receipt, referenceBytes, receiptFile, configFile, archivePath, archiveBytes, export: () => exportPublicWorldOverlay({ app, slug, receiptFile, configFile }), overlayPath: join(app, 'public/demo/v12', slug, 'world-overlay.json'), proofPath: join(app, 'public/demo/v12', slug, 'world.provenance.json') };
}
const unpublished = f => assert.rejects(() => access(f.overlayPath), { code: 'ENOENT' });

test('both public targets export world-only exact-bound overlays and leave all archived gift bytes unchanged', async t => {
  assert.deepEqual(PUBLIC_WORLD_TARGETS, { 'pracinha-court': 'c864acd7-88d0-4b02-bff7-67ae186243dc', 'pracinha-playground': 'cc997d6d-faf2-4b5a-8bfa-9196716bec71' });
  for (const slug of Object.keys(PUBLIC_WORLD_TARGETS)) {
    const f = await fixture(t, slug), result = await f.export(), overlay = JSON.parse(await readFile(f.overlayPath, 'utf8')), proof = JSON.parse(await readFile(f.proofPath, 'utf8'));
    assert.equal(result.providerCalls, 0); assert.equal(result.privateRecordsExported, false); assert.equal(result.assets.length, 5);
    assert.deepEqual(Object.keys(overlay).sort(), ['version','targetPublicGiftId','referenceSha256','worldUrl','mobileWorldUrl','panoramaUrl','collisionUrl','worldSemantics','initialYaw','initialPitch'].sort());
    assert.equal(overlay.version, 1); assert.equal(overlay.targetPublicGiftId, PUBLIC_WORLD_TARGETS[slug]); assert.equal(overlay.referenceSha256, digest(f.referenceBytes));
    for (const key of ['worldUrl','mobileWorldUrl','panoramaUrl','collisionUrl']) assert.ok(overlay[key].startsWith(`/demo/v12/${slug}/`));
    assert.deepEqual(overlay.worldSemantics, { metricScaleFactor: 2.4, groundPlaneOffset: .8 }); assert.equal(overlay.initialYaw, .2); assert.equal(overlay.initialPitch, -.1);
    assert.equal(proof.reference.sha256, overlay.referenceSha256); assert.equal(proof.promptSha256, digest(f.config.reference.prompt)); assert.equal(proof.config.sha256, digest(await readFile(f.configFile))); assert.equal(proof.model, 'marble-1.1-plus');
    assert.doesNotMatch(JSON.stringify(overlay) + JSON.stringify(proof), /SECRET|https:\/\/private|signedAssetURL|referencePath|\.local-giftportals/);
    assert.equal(await readFile(f.archivePath, 'utf8'), f.archiveBytes);
    const full = proof.assets.find(asset => asset.suffix === 'spzfull'); assert.equal(full.operatorOnly, true); assert.equal(full.url, undefined); await access(join(f.app, 'outputs/v12', slug, 'world-full-res.spz')); await assert.rejects(() => access(join(f.app, 'public/demo/v12', slug, 'world-full-res.spz')), { code: 'ENOENT' });
    assert.deepEqual(proof.fullResolution, { status: 'availableLocal', operatorOnly: true, published: false }); assert.deepEqual(proof.mobileQuality, { exported: true, quality: '100k', activatedByExport: false });
  }
});
test('wrong target UUID, mismatched slug and unfinished or lower-model receipts fail closed', async t => {
  for (const mutation of ['uuid','slug','version','pending','model','provider','input','quality']) {
    const f = await fixture(t);
    if (mutation === 'uuid') f.config.targetPublicGiftId = PUBLIC_WORLD_TARGETS['pracinha-playground'];
    if (mutation === 'slug') f.config.slug = 'pracinha-playground'; if (mutation === 'version') f.config.version = 2;
    if (mutation === 'pending') f.receipt.state = 'processing'; if (mutation === 'model') f.receipt.model = 'marble-1.1'; if (mutation === 'provider') f.receipt.provider = 'tripo'; if (mutation === 'input') f.receipt.inputMode = 'text'; if (mutation === 'quality') f.receipt.quality = '100k';
    await saveJSON(f.configFile, f.config); await saveJSON(f.receiptFile, f.receipt); await assert.rejects(() => f.export(), error => ['OVERLAY_TARGET_CONFIG_INVALID','OVERLAY_COMPLETED_PLUS_WORLD_REQUIRED'].includes(error.code)); await unpublished(f);
  }
});
test('reference photo, source receipt, authored prompt and provenance must all match reviewed configuration', async t => {
  for (const mutation of ['sourceHash','sourceBytes','receiptHash','prompt','provenance']) {
    const f = await fixture(t);
    if (mutation === 'sourceHash') f.config.reference.sha256 = 'a'.repeat(64); if (mutation === 'sourceBytes') f.config.reference.bytes++;
    if (mutation === 'receiptHash') f.receipt.referenceImage.sha256 = 'b'.repeat(64); if (mutation === 'prompt') f.receipt.promptSha256 = 'c'.repeat(64); if (mutation === 'provenance') f.receipt.provenance = 'A different archive photo and inconsistent provenance.';
    await saveJSON(f.configFile, f.config); await saveJSON(f.receiptFile, f.receipt); await assert.rejects(() => f.export(), error => ['OVERLAY_ASSET_HASH_MISMATCH','OVERLAY_ASSET_SIZE_MISMATCH','OVERLAY_REFERENCE_MISMATCH','OVERLAY_PROMPT_MISMATCH','OVERLAY_PROVENANCE_MISMATCH'].includes(error.code)); await unpublished(f);
  }
});
test('world bytes, MIME, decompressed SPZ tiers and GLB geometry are independently validated', async t => {
  for (const mutation of ['hash','size','mime','points','glb','external','duplicate','missing']) {
    const f = await fixture(t), meta = f.receipt.assets.find(asset => asset.suffix === (['glb','external'].includes(mutation) ? 'collider' : mutation === 'points' ? 'spz100k' : 'spz'));
    if (mutation === 'hash') meta.sha256 = 'a'.repeat(64); if (mutation === 'size') meta.bytes++; if (mutation === 'mime') meta.mime = 'image/png';
    if (['points','glb','external'].includes(mutation)) { const bytes = mutation === 'points' ? spz(150001) : mutation === 'external' ? glb(true) : Buffer.from('invalid glTF'); await writeFile(meta.path, bytes); meta.bytes = bytes.length; meta.sha256 = digest(bytes); }
    if (mutation === 'duplicate') f.receipt.assets.push({ ...meta }); if (mutation === 'missing') f.receipt.assets = f.receipt.assets.filter(asset => asset.suffix !== 'pano');
    await saveJSON(f.receiptFile, f.receipt); await assert.rejects(() => f.export(), error => ['OVERLAY_ASSET_HASH_MISMATCH','OVERLAY_ASSET_SIZE_MISMATCH','OVERLAY_WORLD_ASSET_MIME_INVALID','SPZ_POINTS_INVALID','GLB_MAGIC_INVALID','GLB_EXTERNAL_DEPENDENCY','OVERLAY_WORLD_ASSETS_INVALID','OVERLAY_REQUIRED_ASSET_MISSING'].includes(error.code)); await unpublished(f);
  }
});
test('hostile source paths and directory junction escapes never publish overlays', async t => {
  const f = await fixture(t), outside = join(f.app, 'outside'); await mkdir(outside); const path = join(outside, 'world.spz'); await writeFile(path, spz(500000)); f.receipt.assets[0].path = path; await saveJSON(f.receiptFile, f.receipt); await assert.rejects(() => f.export(), { code: 'OVERLAY_SOURCE_PATH_DENIED' }); await unpublished(f);
  const link = join(f.app, '.local-giftportals/escape'); try { await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { if (['EPERM','EACCES','ENOTSUP'].includes(error.code)) return t.skip('This host cannot create test directory links'); throw error; }
  f.receipt.assets[0].path = join(link, 'world.spz'); await saveJSON(f.receiptFile, f.receipt); await assert.rejects(() => f.export(), { code: 'OVERLAY_SOURCE_PATH_DENIED' }); await unpublished(f);
});
test('destination junction escapes are rejected before any outside files are written', async t => {
  const f = await fixture(t), outside = await mkdtemp(join(tmpdir(), 'giftportals-overlay-outside-')); t.after(() => rm(outside, { recursive: true, force: true })); await mkdir(join(f.app, 'public/demo/v12'), { recursive: true });
  try { await symlink(outside, join(f.app, 'public/demo/v12', f.slug), process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { if (['EPERM','EACCES','ENOTSUP'].includes(error.code)) return t.skip('This host cannot create test directory links'); throw error; }
  await assert.rejects(() => f.export(), { code: 'OVERLAY_DESTINATION_DENIED' }); await assert.rejects(() => access(join(outside, 'world-500k.spz')), { code: 'ENOENT' });
});
test('invalid evidence, costs, public semantics and orientations fail before replacing an existing overlay', async t => {
  for (const mutation of ['signedEvidence','secretEvidence','metric','offset','yaw','pitch','cost']) {
    const f = await fixture(t); await mkdir(join(f.app, 'public/demo/v12', f.slug), { recursive: true }); const sentinel = '{"previousReviewedOverlay":true}'; await writeFile(f.overlayPath, sentinel);
    if (mutation === 'signedEvidence') f.config.reference.provenance = 'Archive source https://private.invalid/source?token=SECRET'; if (mutation === 'secretEvidence') f.config.reference.provenance = 'Archive source bearer SECRET';
    if (mutation === 'metric') f.receipt.semantics.metricScaleFactor = .049; if (mutation === 'offset') f.receipt.semantics.groundPlaneOffset = 501; if (mutation === 'yaw') f.config.initialYaw = Math.PI + .1; if (mutation === 'pitch') f.config.initialPitch = .851; if (mutation === 'cost') f.receipt.actualCredits = 3081;
    await saveJSON(f.configFile, f.config); await saveJSON(f.receiptFile, f.receipt); await assert.rejects(() => f.export(), error => ['OVERLAY_EVIDENCE_INVALID','OVERLAY_METRIC_SEMANTICS_INVALID','OVERLAY_ORIENTATION_INVALID','OVERLAY_WORLD_COST_INVALID'].includes(error.code)); assert.equal(await readFile(f.overlayPath, 'utf8'), sentinel);
  }
});
test('optional mobile, collider, full-resolution and orientation values remain absent; billing remains unknown', async t => {
  const f = await fixture(t); f.receipt.assets = f.receipt.assets.filter(asset => ['spz','pano'].includes(asset.suffix)); delete f.receipt.actualCredits; delete f.config.initialYaw; delete f.config.initialPitch; await saveJSON(f.receiptFile, f.receipt); await saveJSON(f.configFile, f.config); await f.export();
  const overlay = JSON.parse(await readFile(f.overlayPath, 'utf8')), proof = JSON.parse(await readFile(f.proofPath, 'utf8')); for (const key of ['mobileWorldUrl','collisionUrl','initialYaw','initialPitch']) assert.equal(overlay[key], undefined); assert.equal(proof.actualCredits, undefined); assert.equal(proof.costStatus, 'unknown');
});
test('long provider prompts retain exact hashes while values beyond the provider bound are rejected', async t => {
  const f = await fixture(t); f.config.reference.prompt = 'A natural, authentic outdoor photographic plaza scene. '.repeat(50).trim(); assert.ok(f.config.reference.prompt.length > 2000); f.receipt.promptSha256 = digest(f.config.reference.prompt); await saveJSON(f.receiptFile, f.receipt); await saveJSON(f.configFile, f.config); await f.export(); assert.equal(JSON.parse(await readFile(f.proofPath, 'utf8')).reference.prompt, f.config.reference.prompt);
  const invalid = await fixture(t); invalid.config.reference.prompt = 'x'.repeat(4001); invalid.receipt.promptSha256 = digest(invalid.config.reference.prompt); await saveJSON(invalid.receiptFile, invalid.receipt); await saveJSON(invalid.configFile, invalid.config); await assert.rejects(() => invalid.export(), { code: 'OVERLAY_EVIDENCE_INVALID' }); await unpublished(invalid);
});
test('failed and unrequested full resolution preserve an honest completed mobile export', async t => {
  for (const status of ['download-failed', undefined]) {
    const f = await fixture(t); f.receipt.assets = f.receipt.assets.filter(asset => asset.suffix !== 'spzfull'); if (status) { f.receipt.fullResStatus = status; f.receipt.fullResErrorCode = 'GENERATED_ASSET_SIZE_LIMIT'; } else delete f.receipt.fullResStatus;
    await saveJSON(f.receiptFile, f.receipt); await f.export(); const proof = JSON.parse(await readFile(f.proofPath, 'utf8')); assert.deepEqual(proof.fullResolution, { status: status ? 'downloadFailed' : 'notRequested', operatorOnly: true, published: false, ...(status ? { errorCode: 'GENERATED_ASSET_SIZE_LIMIT' } : {}) }); assert.deepEqual(proof.mobileQuality, { exported: true, quality: '100k', activatedByExport: false });
  }
});
