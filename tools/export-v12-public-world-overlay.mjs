// Offline, world-only overlay for the two reviewed public Praça gifts.
// No provider requests, archive edits or private/signed URL publication.
// Usage: node tools/export-v12-public-world-overlay.mjs <slug> <receipt.json> <config.json>
// Config: {version:1,slug,targetPublicGiftId,
//   reference:{path,bytes,sha256,mime,prompt,provenance},initialYaw?,initialPitch?}
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateExampleSPZ, exampleWorldResolutionEvidence } from './export-v12-example-world.mjs';
import { validateQualityAsset } from './export-quality-comparison.mjs';

export const PUBLIC_WORLD_TARGETS = Object.freeze({
  'pracinha-court': 'c864acd7-88d0-4b02-bff7-67ae186243dc',
  'pracinha-playground': 'cc997d6d-faf2-4b5a-8bfa-9196716bec71',
});
const suffixes = ['spz', 'spz100k', 'pano', 'collider', 'spzfull'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ensure = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const within = (root, path) => { const delta = relative(root, path); return !!delta && delta !== '..' && !delta.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(delta); };
const secret = /(?:https?:\/\/|bearer\s+[a-z0-9._-]+|(?:api[_-]?key|access[_-]?token|authorization|signature|token)\s*[=:]\s*\S+)/i;
function plainText(value, maximum = 2000) {
  ensure(typeof value === 'string' && value.length >= 10 && value.length <= maximum && value === value.trim() && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) && !secret.test(value), 'OVERLAY_EVIDENCE_INVALID');
  return value;
}
async function checkedLocalPath(app, path) {
  ensure(typeof path === 'string' && path.length > 0, 'OVERLAY_SOURCE_PATH_DENIED');
  const allowed = [join(app, '.local-giftportals'), join(app, 'outputs')], candidate = resolve(app, path);
  ensure(allowed.some(root => within(root, candidate)), 'OVERLAY_SOURCE_PATH_DENIED');
  const actualApp = await realpath(app), actual = await realpath(candidate);
  let accepted = false;
  for (const root of allowed) {
    try { const actualRoot = await realpath(root); if (within(actualApp, actualRoot) && within(actualRoot, actual)) accepted = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  ensure(accepted, 'OVERLAY_SOURCE_PATH_DENIED'); return actual;
}
async function localJSON(app, path) {
  const actual = await checkedLocalPath(app, path), info = await stat(actual);
  ensure(info.isFile() && info.size > 0 && info.size <= 512 * 1024, 'OVERLAY_JSON_SIZE_INVALID');
  const bytes = await readFile(actual); let value;
  try { value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { ensure(false, 'OVERLAY_JSON_INVALID'); }
  return { value, bytes };
}
async function checkedAsset(app, meta, maximum) {
  ensure(meta && validHash(meta.sha256) && Number.isInteger(meta.bytes) && meta.bytes > 0 && meta.bytes <= maximum, 'OVERLAY_ASSET_METADATA_INVALID');
  const actual = await checkedLocalPath(app, meta.path), info = await stat(actual);
  ensure(info.isFile() && info.size === meta.bytes, 'OVERLAY_ASSET_SIZE_MISMATCH');
  const bytes = await readFile(actual); ensure(digest(bytes) === meta.sha256, 'OVERLAY_ASSET_HASH_MISMATCH'); return bytes;
}
async function checkedOutput(app, folder) {
  let parent = folder;
  for (;;) { try { await stat(parent); break; } catch (error) { if (error.code !== 'ENOENT') throw error; parent = resolve(parent, '..'); } }
  const actualApp = await realpath(app), actualParent = await realpath(parent);
  ensure(actualApp === actualParent || within(actualApp, actualParent), 'OVERLAY_DESTINATION_DENIED');
  await mkdir(folder, { recursive: true }); ensure(within(actualApp, await realpath(folder)), 'OVERLAY_DESTINATION_DENIED');
}
async function publish(path, bytes) {
  const temporary = `${path}.tmp-${process.pid}`; await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, path);
}
function metricSemantics(input) {
  // These are the public visitor's accepted physical bounds.
  ensure(input && typeof input === 'object' && Number.isFinite(input.metricScaleFactor) && input.metricScaleFactor >= .05 && input.metricScaleFactor <= 100 && Number.isFinite(input.groundPlaneOffset) && Math.abs(input.groundPlaneOffset) <= 500, 'OVERLAY_METRIC_SEMANTICS_INVALID');
  return { metricScaleFactor: input.metricScaleFactor, groundPlaneOffset: input.groundPlaneOffset };
}
const safeDate = input => typeof input === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input) ? input : undefined;

export async function exportPublicWorldOverlay({ app = resolve(import.meta.dirname, '..'), slug, receiptFile, configFile } = {}) {
  app = resolve(app); ensure(Object.hasOwn(PUBLIC_WORLD_TARGETS, slug), 'OVERLAY_SLUG_INVALID');
  const { value: receipt } = await localJSON(app, receiptFile), { value: config, bytes: configBytes } = await localJSON(app, configFile);
  const targetPublicGiftId = PUBLIC_WORLD_TARGETS[slug];
  ensure(config.version === 1 && config.slug === slug && config.targetPublicGiftId === targetPublicGiftId && config.reference && typeof config.reference === 'object', 'OVERLAY_TARGET_CONFIG_INVALID');
  ensure(receipt.provider === 'worldlabs' && receipt.state === 'completed' && receipt.model === 'marble-1.1-plus' && receipt.quality === '500k' && receipt.inputMode === 'single-image' && Array.isArray(receipt.assets), 'OVERLAY_COMPLETED_PLUS_WORLD_REQUIRED');
  const prompt = plainText(config.reference.prompt, 4000), provenance = plainText(config.reference.provenance);
  ensure(validHash(receipt.promptSha256) && receipt.promptSha256 === digest(prompt), 'OVERLAY_PROMPT_MISMATCH');
  ensure(receipt.provenance === undefined || receipt.provenance === provenance, 'OVERLAY_PROVENANCE_MISMATCH');
  const referenceMime = config.reference.mime;
  ensure(['image/png', 'image/jpeg', 'image/webp'].includes(referenceMime), 'OVERLAY_REFERENCE_MIME_INVALID');
  const referenceBytes = await checkedAsset(app, config.reference, 6 * 1024 * 1024);
  validateQualityAsset(referenceBytes, referenceMime);
  const referenceSha256 = digest(referenceBytes);
  ensure(receipt.referenceImage?.mime === referenceMime && receipt.referenceImage.bytes === referenceBytes.length && receipt.referenceImage.sha256 === referenceSha256, 'OVERLAY_REFERENCE_MISMATCH');
  ensure(Number.isInteger(receipt.maxReservedCredits) && receipt.maxReservedCredits > 0 && receipt.maxReservedCredits <= 10000 && (receipt.actualCredits === undefined || Number.isFinite(receipt.actualCredits) && receipt.actualCredits >= 0 && receipt.actualCredits <= receipt.maxReservedCredits), 'OVERLAY_WORLD_COST_INVALID');
  ensure(new Set(receipt.assets.map(asset => asset.suffix)).size === receipt.assets.length && receipt.assets.every(asset => suffixes.includes(asset.suffix)), 'OVERLAY_WORLD_ASSETS_INVALID');
  const worldSemantics = metricSemantics(receipt.semantics), orientation = {};
  for (const field of ['initialYaw', 'initialPitch']) if (config[field] !== undefined) {
    ensure(Number.isFinite(config[field]) && Math.abs(config[field]) <= (field === 'initialYaw' ? Math.PI : .85), 'OVERLAY_ORIENTATION_INVALID'); orientation[field] = config[field];
  }
  const planned = [], assets = [], publicPrefix = `/demo/v12/${slug}/`;
  for (const suffix of suffixes) {
    const meta = receipt.assets.find(asset => asset.suffix === suffix);
    if (!meta) { ensure(!['spz', 'pano'].includes(suffix), 'OVERLAY_REQUIRED_ASSET_MISSING'); continue; }
    if (suffix === 'spzfull' && receipt.fullResStatus !== undefined && receipt.fullResStatus !== 'available') continue;
    const bytes = await checkedAsset(app, meta, (suffix === 'spzfull' ? 50 : 25) * 1024 * 1024);
    const extension = meta.mime === 'image/png' ? 'png' : meta.mime === 'image/jpeg' ? 'jpg' : meta.mime === 'image/webp' ? 'webp' : undefined;
    ensure(suffix.startsWith('spz') ? meta.mime === 'application/octet-stream' : suffix === 'collider' ? meta.mime === 'model/gltf-binary' : !!extension, 'OVERLAY_WORLD_ASSET_MIME_INVALID');
    const validation = suffix.startsWith('spz') ? validateExampleSPZ(bytes, suffix) : validateQualityAsset(bytes, meta.mime);
    const file = suffix === 'spz' ? 'world-500k.spz' : suffix === 'spz100k' ? 'world-100k.spz' : suffix === 'spzfull' ? 'world-full-res.spz' : suffix === 'collider' ? 'collider.glb' : `panorama.${extension}`;
    const path = join(app, suffix === 'spzfull' ? 'outputs/v12' : 'public/demo/v12', slug, file);
    planned.push({ path, bytes });
    assets.push({ suffix, ...(suffix === 'spzfull' ? { operatorOnly: true } : { url: publicPrefix + file }), bytes: bytes.length, sha256: digest(bytes), mime: meta.mime, validation });
  }
  const assetURL = suffix => assets.find(asset => asset.suffix === suffix)?.url;
  // This exact whitelist is the overlay contract. Private gift content cannot enter it.
  const overlay = { version: 1, targetPublicGiftId, referenceSha256, worldUrl: assetURL('spz'), ...(assetURL('spz100k') ? { mobileWorldUrl: assetURL('spz100k') } : {}), panoramaUrl: assetURL('pano'), ...(assetURL('collider') ? { collisionUrl: assetURL('collider') } : {}), worldSemantics, ...orientation };
  const proof = {
    version: 12, slug, targetPublicGiftId, provider: 'worldlabs', model: receipt.model,
    createdAt: safeDate(receipt.createdAt), completedAt: safeDate(receipt.observedAt),
    reference: { sha256: referenceSha256, bytes: referenceBytes.length, mime: referenceMime, prompt, provenance },
    config: { sha256: digest(configBytes), bytes: configBytes.length }, promptSha256: receipt.promptSha256,
    maxReservedCredits: receipt.maxReservedCredits, actualCredits: receipt.actualCredits, costStatus: receipt.actualCredits === undefined ? 'unknown' : 'reported',
    assets, worldSemantics, ...orientation, defaultQuality: '500k', ...exampleWorldResolutionEvidence(receipt, assets),
    archive: 'Only the world experience is replaced. The original archived photograph, miniature model, sender, recipient, story and dedication remain unchanged.',
    providerCalls: 0, privateRecordsExported: false,
  };
  const target = join(app, 'public/demo/v12', slug), operator = join(app, 'outputs/v12', slug);
  await checkedOutput(app, target); await checkedOutput(app, operator);
  for (const item of planned) await publish(item.path, item.bytes);
  await publish(join(target, 'world.provenance.json'), JSON.stringify(proof, null, 2) + '\n');
  await publish(join(target, 'world-overlay.json'), JSON.stringify(overlay, null, 2) + '\n');
  return { slug, targetPublicGiftId, referenceSha256, overlay: publicPrefix + 'world-overlay.json', provenance: publicPrefix + 'world.provenance.json', assets, providerCalls: 0, privateRecordsExported: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [slug, receiptFile, configFile, ...extra] = process.argv.slice(2); ensure(slug && receiptFile && configFile && extra.length === 0, 'OVERLAY_ARGUMENTS_INVALID');
    console.log(JSON.stringify(await exportPublicWorldOverlay({ slug, receiptFile, configFile })));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'OVERLAY_EXPORT_FAILED', providerCalls: 0, privateRecordsExported: false })); process.exitCode = 1;
  }
}
