// Offline export of a completed, sanitized World Labs receipt. No provider calls.
// Usage: node tools/export-v12-example-world.mjs rio receipt.json scene-config.json
// Config: {version:1,scene,baseGiftUrl?,title,story,reference:{url,prompt,provenance},
//          sourceAttribution:{author,sourceUrl,license,licenseUrl,changes?},
//          initialYaw?,initialPitch?,initialSpawn?,initialEyeHeight?}
// Rio's source is an AI photographic reinterpretation, not a geographic photo.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { validateQualityAsset } from './export-quality-comparison.mjs';

const scenes = {
  rio: { baseGiftUrl: '/demo/rio-generated-gift.json', referenceUrl: '/assets/examples/v12/rio-sailboats-reference.png', keepsakeImageUrl: '/assets/portal-dusk/rio-keepsake.png' },
  antikythera: { baseGiftUrl: '/demo/v13/antikythera-generated-gift.json' },
};
const suffixes = ['spz', 'spz100k', 'pano', 'collider', 'spzfull'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const ensure = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const within = (root, path) => { const delta = relative(root, path); return !!delta && delta !== '..' && !delta.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(delta); };
const secret = /(?:bearer\s+[a-z0-9._-]+|(?:api[_-]?key|access[_-]?token|authorization|signature|token)\s*[=:]\s*\S+)/i;
function text(value, maximum = 2000) {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) && !secret.test(value), 'EXPORT_TEXT_INVALID');
  return value.trim();
}
function publicURL(value, extension) {
  ensure(typeof value === 'string' && /^\/(assets|demo)\/[a-zA-Z0-9_./-]+$/.test(value) && !value.split('/').some(part => part === '.' || part === '..') && (!extension || value.endsWith(extension)), 'PUBLIC_ASSET_URL_INVALID');
  return value;
}
function attributionURL(value) {
  if (typeof value === 'string' && value.startsWith('/')) return publicURL(value);
  let url; try { url = new URL(value); } catch { ensure(false, 'ATTRIBUTION_URL_INVALID'); }
  ensure(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'ATTRIBUTION_URL_INVALID');
  return url.href;
}
function attribution(input) {
  ensure(input && typeof input === 'object' && !Array.isArray(input), 'SOURCE_ATTRIBUTION_REQUIRED');
  return {
    author: text(input.author, 200), sourceUrl: attributionURL(input.sourceUrl),
    license: text(input.license, 200), licenseUrl: attributionURL(input.licenseUrl),
    ...(input.changes === undefined ? {} : { changes: text(input.changes) }),
  };
}
async function boundedJSON(path) {
  const info = await stat(path); ensure(info.isFile() && info.size > 0 && info.size <= 512 * 1024, 'EXPORT_JSON_SIZE_INVALID');
  try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')); } catch { ensure(false, 'EXPORT_JSON_INVALID'); }
}
async function checkedPath(app, path, roots, code) {
  ensure(typeof path === 'string' && path.length > 0, code);
  const candidate = resolve(app, path);
  ensure(roots.some(root => within(root, candidate)), code);
  const actual = await realpath(candidate), actualApp = await realpath(app);
  let allowed = false;
  for (const root of roots) {
    try {
      const actualRoot = await realpath(root);
      if (within(actualApp, actualRoot) && within(actualRoot, actual)) allowed = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  ensure(allowed, code); return actual;
}
async function publicFile(app, url, maxBytes = 25 * 1024 * 1024) {
  const path = await checkedPath(app, join('public', publicURL(url).slice(1)), [join(app, 'public')], 'PUBLIC_ASSET_PATH_INVALID');
  const info = await stat(path); ensure(info.isFile() && info.size > 0 && info.size <= maxBytes, 'PUBLIC_ASSET_SIZE_INVALID');
  return readFile(path);
}
export function validateExampleSPZ(bytes, suffix = 'spz') {
  const full = suffix === 'spzfull';
  ensure(['spz', 'spz100k', 'spzfull'].includes(suffix) && Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= (full ? 50 : 25) * 1024 * 1024 && bytes[0] === 0x1f && bytes[1] === 0x8b, 'SPZ_MAGIC_INVALID');
  let decoded; try { decoded = gunzipSync(bytes, { maxOutputLength: (full ? 256 : 64) * 1024 * 1024 }); } catch { ensure(false, 'SPZ_CONTENT_INVALID'); }
  ensure(decoded.length >= 16 && decoded.toString('ascii', 0, 4) === 'NGSP' && [1, 2, 3, 4].includes(decoded.readUInt32LE(4)), 'SPZ_CONTENT_INVALID');
  const points = decoded.readUInt32LE(8);
  ensure(points > 0 && points <= (full ? 2500000 : suffix === 'spz100k' ? 150000 : 600000), 'SPZ_POINTS_INVALID');
  return { type: 'spz', version: decoded.readUInt32LE(4), points };
}
export function exampleWorldResolutionEvidence(receipt, assets) {
  const hasFull = assets.some(asset => asset.suffix === 'spzfull');
  const hasMobile = assets.some(asset => asset.suffix === 'spz100k');
  const status = hasFull ? 'availableLocal' : receipt.fullResStatus === 'download-failed' ? 'downloadFailed' : receipt.fullResStatus === 'unavailable' || receipt.fullResStatus === 'available' ? 'unavailable' : 'notRequested';
  const errorCode = status === 'downloadFailed' && typeof receipt.fullResErrorCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(receipt.fullResErrorCode) ? receipt.fullResErrorCode : undefined;
  return {
    mobileQuality: { exported: hasMobile, ...(hasMobile ? { quality: '100k' } : {}), activatedByExport: false },
    fullResolution: { status, operatorOnly: true, published: false, ...(errorCode ? { errorCode } : {}) },
  };
}
function semantics(input) {
  ensure(input && typeof input === 'object' && Number.isFinite(input.metricScaleFactor) && input.metricScaleFactor >= .01 && input.metricScaleFactor <= 100 && Number.isFinite(input.groundPlaneOffset) && Math.abs(input.groundPlaneOffset) <= 10000, 'METRIC_SEMANTICS_REQUIRED');
  return { metricScaleFactor: input.metricScaleFactor, groundPlaneOffset: input.groundPlaneOffset };
}
function safeID(input) { return typeof input === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(input) ? input : undefined; }
function safeDate(input) { return typeof input === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input) ? input : undefined; }
async function outputFolder(app, path) {
  let parent = path;
  for (;;) {
    try { await stat(parent); break; } catch (error) { if (error.code !== 'ENOENT') throw error; parent = resolve(parent, '..'); }
  }
  const actualApp = await realpath(app), actualParent = await realpath(parent);
  ensure(actualParent === actualApp || within(actualApp, actualParent), 'EXPORT_DESTINATION_DENIED');
  await mkdir(path, { recursive: true });
  ensure(within(actualApp, await realpath(path)), 'EXPORT_DESTINATION_DENIED');
}
async function publish(path, bytes) {
  // Replacing a destination link with rename never writes through that link.
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  await rename(temporary, path);
}

export async function exportExampleWorld({ app = resolve(import.meta.dirname, '..'), scene, receiptFile, configFile } = {}) {
  app = resolve(app); ensure(Object.hasOwn(scenes, scene), 'EXAMPLE_SCENE_INVALID');
  const localRoots = [join(app, '.local-giftportals'), join(app, 'outputs')];
  const receiptPath = await checkedPath(app, receiptFile, localRoots, 'EXPORT_RECEIPT_PATH_DENIED');
  const configPath = await checkedPath(app, configFile, localRoots, 'EXPORT_CONFIG_PATH_DENIED');
  const receipt = await boundedJSON(receiptPath), config = await boundedJSON(configPath), preset = scenes[scene];
  ensure(receipt.provider === 'worldlabs' && receipt.state === 'completed' && ['marble-1.1-plus', 'marble-1.1'].includes(receipt.model) && (receipt.quality === undefined || receipt.quality === '500k') && Array.isArray(receipt.assets), 'COMPLETED_WORLD_REQUIRED');
  ensure(config.version === 1 && config.scene === scene && (config.baseGiftUrl === undefined || config.baseGiftUrl === preset.baseGiftUrl) && config.reference && typeof config.reference === 'object', 'EXAMPLE_CONFIG_INVALID');
  const reference = {
    url: publicURL(config.reference.url), prompt: text(config.reference.prompt, 4000), provenance: text(config.reference.provenance),
  };
  ensure(!/https?:\/\//i.test(reference.prompt + reference.provenance), 'REFERENCE_PLAIN_TEXT_REQUIRED');
  ensure(validHash(receipt.promptSha256) && receipt.promptSha256 === digest(reference.prompt), 'WORLD_PROMPT_MISMATCH');
  const sourceAttribution = attribution(config.sourceAttribution), title = text(config.title, 200), story = text(config.story, 6000);
  if (scene === 'rio') {
    ensure(receipt.inputMode === 'single-image', 'RIO_SINGLE_IMAGE_REQUIRED');
    ensure(reference.url === preset.referenceUrl && title === 'Rio de Janeiro · Sailboats' && /imagine/i.test(story) && /warm|sunset/i.test(story) && /promenade/i.test(story) && /white sailboats/i.test(story) && /Sugarloaf/i.test(story), 'RIO_REFERENCE_METADATA_INVALID');
    const credit = JSON.stringify(sourceAttribution) + reference.provenance;
    ensure(/GiftPortals/i.test(sourceAttribution.author) && /AI/i.test(credit) && /reinterpretation/i.test(credit) && !/wikimedia|wikipedia|Donatas Dabravolskas|CC BY-SA/i.test(credit), 'RIO_AI_ATTRIBUTION_REQUIRED');
  }
  const referenceMime = reference.url.endsWith('.png') ? 'image/png' : reference.url.endsWith('.jpg') || reference.url.endsWith('.jpeg') ? 'image/jpeg' : reference.url.endsWith('.webp') ? 'image/webp' : undefined;
  ensure(referenceMime, 'REFERENCE_IMAGE_MIME_INVALID');
  const referenceBytes = await publicFile(app, reference.url, 6 * 1024 * 1024);
  validateQualityAsset(referenceBytes, referenceMime);
  if (receipt.inputMode === 'single-image') {
    ensure(receipt.referenceImage?.mime === referenceMime && receipt.referenceImage.bytes === referenceBytes.length && receipt.referenceImage.sha256 === digest(referenceBytes), 'WORLD_REFERENCE_MISMATCH');
  }
  const baseBytes = await publicFile(app, preset.baseGiftUrl, 512 * 1024), base = JSON.parse(baseBytes.toString('utf8'));
  ensure(typeof base.senderName === 'string' && typeof base.story === 'string' && typeof base.modelUrl === 'string', 'BASE_GIFT_REQUIRED');
  const modelURL = publicURL(base.modelUrl, '.glb'), modelBytes = await publicFile(app, modelURL);
  validateQualityAsset(modelBytes, 'model/gltf-binary');
  const kept = {};
  for (const field of ['senderName', 'recipientName', 'dedication', 'originalUrl', 'sourcePhotoUrl', 'keepsakeImageUrl', 'photoIntent', 'objectRepresentation', 'modelYaw', 'curiosities']) if (base[field] !== undefined) kept[field] = base[field];
  for (const field of ['originalUrl', 'sourcePhotoUrl', 'keepsakeImageUrl']) if (kept[field] !== undefined) publicURL(kept[field]);
  const worldSemantics = semantics(receipt.semantics);
  ensure(new Set(receipt.assets.map(asset => asset.suffix)).size === receipt.assets.length && receipt.assets.every(asset => suffixes.includes(asset.suffix)), 'WORLD_ASSETS_INVALID');
  ensure(Number.isInteger(receipt.maxReservedCredits) && receipt.maxReservedCredits > 0 && receipt.maxReservedCredits <= 10000 && (receipt.actualCredits === undefined || Number.isFinite(receipt.actualCredits) && receipt.actualCredits >= 0 && receipt.actualCredits <= receipt.maxReservedCredits), 'WORLD_COST_INVALID');
  const planned = [], assets = [];
  for (const suffix of suffixes) {
    const meta = receipt.assets.find(asset => asset.suffix === suffix);
    if (!meta) { ensure(!['spz', 'pano'].includes(suffix), 'WORLD_REQUIRED_ASSET_MISSING'); continue; }
    if (suffix === 'spzfull' && receipt.fullResStatus !== undefined && receipt.fullResStatus !== 'available') continue;
    const limit = (suffix === 'spzfull' ? 50 : 25) * 1024 * 1024;
    ensure(validHash(meta.sha256) && Number.isInteger(meta.bytes) && meta.bytes > 0 && meta.bytes <= limit, 'ASSET_METADATA_INVALID');
    const source = await checkedPath(app, meta.path, localRoots, 'EXPORT_SOURCE_DENIED');
    const info = await stat(source); ensure(info.isFile() && info.size === meta.bytes, 'ASSET_SIZE_MISMATCH');
    const bytes = await readFile(source); ensure(digest(bytes) === meta.sha256, 'ASSET_HASH_MISMATCH');
    const extension = meta.mime === 'image/png' ? 'png' : meta.mime === 'image/jpeg' ? 'jpg' : meta.mime === 'image/webp' ? 'webp' : undefined;
    ensure(suffix.startsWith('spz') ? meta.mime === 'application/octet-stream' : suffix === 'collider' ? meta.mime === 'model/gltf-binary' : !!extension, 'WORLD_ASSET_MIME_INVALID');
    const validation = suffix.startsWith('spz') ? validateExampleSPZ(bytes, suffix) : validateQualityAsset(bytes, meta.mime);
    const file = suffix === 'spz' ? `${scene}-world-500k.spz` : suffix === 'spz100k' ? `${scene}-world-100k.spz` : suffix === 'spzfull' ? `${scene}-world-full-res.spz` : suffix === 'collider' ? `${scene}-collider.glb` : `${scene}-panorama.${extension}`;
    const path = join(app, suffix === 'spzfull' ? 'outputs/v12' : 'public/demo/v12', file);
    planned.push({ path, bytes });
    assets.push({ suffix, ...(suffix === 'spzfull' ? { operatorPath: `outputs/v12/${file}` } : { url: `/demo/v12/${file}` }), bytes: bytes.length, sha256: digest(bytes), mime: meta.mime, validation });
  }
  const assetURL = suffix => assets.find(asset => asset.suffix === suffix)?.url;
  const gift = { ...kept, title, story, modelUrl: modelURL, worldUrl: assetURL('spz'), panoramaUrl: assetURL('pano'), worldSemantics, sourceAttribution };
  for (const field of ['initialYaw', 'initialPitch']) if (config[field] !== undefined) {
    ensure(Number.isFinite(config[field]) && Math.abs(config[field]) <= (field === 'initialYaw' ? Math.PI : .85), 'INITIAL_ORIENTATION_INVALID');
    gift[field] = config[field];
  }
  if (config.initialSpawn !== undefined) {
    ensure(Array.isArray(config.initialSpawn) && config.initialSpawn.length === 3 && config.initialSpawn.every(value => Number.isFinite(value) && Math.abs(value) <= 250), 'INITIAL_SPAWN_INVALID');
    gift.initialSpawn = [...config.initialSpawn];
  }
  if (config.initialEyeHeight !== undefined) {
    ensure(Number.isFinite(config.initialEyeHeight) && config.initialEyeHeight >= .5 && config.initialEyeHeight <= 3, 'INITIAL_EYE_HEIGHT_INVALID');
    gift.initialEyeHeight = config.initialEyeHeight;
  }
  if (assetURL('collider')) gift.collisionUrl = assetURL('collider');
  if (assetURL('spz100k')) gift.mobileWorldUrl = assetURL('spz100k');
  if (scene === 'rio') Object.assign(gift, { originalUrl: reference.url, sourcePhotoUrl: reference.url, keepsakeImageUrl: preset.keepsakeImageUrl, sourceImageKind: 'artistic-reference', photoIntent: 'place', objectRepresentation: 'souvenir-miniature' });
  const proof = {
    version: 12, scene, provider: 'worldlabs', model: receipt.model,
    operationId: safeID(receipt.operationId), worldId: safeID(receipt.worldId), trialId: safeID(receipt.trialId),
    createdAt: safeDate(receipt.createdAt), completedAt: safeDate(receipt.observedAt),
    maxReservedCredits: receipt.maxReservedCredits, actualCredits: receipt.actualCredits,
    costStatus: receipt.actualCredits === undefined ? 'unknown' : 'reported', worldSemantics,
    initialOrientation: gift.initialYaw === undefined && gift.initialPitch === undefined ? undefined : { yaw: gift.initialYaw, pitch: gift.initialPitch },
    reviewedInitialPose: gift.initialSpawn === undefined && gift.initialEyeHeight === undefined && gift.initialYaw === undefined && gift.initialPitch === undefined ? undefined : { ...(gift.initialSpawn ? { preferredEye: [...gift.initialSpawn], requiresGroundAndBodyCalibration: true } : {}), ...(gift.initialEyeHeight === undefined ? {} : { eyeHeight: gift.initialEyeHeight }), ...(gift.initialYaw === undefined ? {} : { yaw: gift.initialYaw }), ...(gift.initialPitch === undefined ? {} : { pitch: gift.initialPitch }) },
    reference: { ...reference, bytes: referenceBytes.length, sha256: digest(referenceBytes), mime: referenceMime },
    sourceAttribution, promptSha256: receipt.promptSha256, assets,
    baseline: { giftUrl: preset.baseGiftUrl, sha256: digest(baseBytes), model: { url: modelURL, bytes: modelBytes.length, sha256: digest(modelBytes) } },
    defaultQuality: '500k', ...exampleWorldResolutionEvidence(receipt, assets),
    tripo: 'Existing original miniature GLB, sender, recipient and dedication are preserved. No Tripo request was made by this export.',
    providerCalls: 0, privateRecordsExported: false,
  };
  const target = join(app, 'public/demo/v12'), operator = join(app, 'outputs/v12');
  await outputFolder(app, target); await outputFolder(app, operator);
  for (const item of planned) await publish(item.path, item.bytes);
  await publish(join(target, `${scene}-world.provenance.json`), JSON.stringify(proof, null, 2) + '\n');
  // Publish the gift last, after every input validation and asset write passed.
  await publish(join(target, `${scene}-generated-gift.json`), JSON.stringify(gift, null, 2) + '\n');
  return { scene, gift: `/demo/v12/${scene}-generated-gift.json`, provenance: `/demo/v12/${scene}-world.provenance.json`, worldId: proof.worldId, actualCredits: proof.actualCredits, defaultQuality: '500k', assets, providerCalls: 0, privateRecordsExported: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [scene, receiptFile, configFile, ...extra] = process.argv.slice(2);
    ensure(scene && receiptFile && configFile && extra.length === 0, 'EXPORT_ARGUMENTS_INVALID');
    console.log(JSON.stringify(await exportExampleWorld({ scene, receiptFile, configFile })));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'EXPORT_FAILED', providerCalls: 0, privateRecordsExported: false }));
    process.exitCode = 1;
  }
}
