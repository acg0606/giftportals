// GET-only adapter for an actual published V11 world. No provider, auth or SQL client.
import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUTS = join(ROOT, 'outputs/v11');
const HOST = 'oqmzwznadfuxybtstzzz.supabase.co';
const BUCKET = 'gp-instant-souvenirs';
const MAX_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const fail = code => { throw new Error(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const inside = (path, base) => {
  const part = relative(base, path);
  return part !== '' && !part.startsWith('..') && !isAbsolute(part);
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validSemantics = value => value && Number.isFinite(value.metricScaleFactor)
  && value.metricScaleFactor >= .05 && value.metricScaleFactor <= 100
  && Number.isFinite(value.groundPlaneOffset) && Math.abs(value.groundPlaneOffset) <= 500;

/** A SELECT only: project generation identity and already public asset metadata. */
export function metadataQuery(scene, id) {
  requireValue(['rio', 'paris'].includes(scene) && UUID.test(id), 'V11_DOWNLOAD_ARGUMENTS');
  return `select jsonb_build_object(
  'format', 'giftportals-public-world-export-v1',
  'id', g.id, 'exampleId', g.example_id,
  'provider', 'worldlabs', 'state', 'completed',
  'model', coalesce(j.document->'worldRetry'->'recipeOverride'->>'model', j.document->'generation'->'worldlabs'->>'model'),
  'operationId', j.stages->'worldlabs'->>'taskId',
  'worldId', j.stages->'worldlabs'->>'resultId',
  'actualCredits', j.stages->'worldlabs'->'credits',
  'createdAt', j.created_at, 'observedAt', g.published_at,
  'semantics', g.world_semantics,
  'assets', jsonb_strip_nulls(jsonb_build_object(
    'world', g.assets->'world', 'panorama', g.assets->'panorama', 'collider', g.assets->'collider'))
) as metadata
from public.gp_instant_souvenirs g
join public.gp_instant_jobs j on j.id = g.id
where g.id = '${id.toLowerCase()}'::uuid
  and g.published_at is not null and g.example_id = '${scene}'
  and g.photo_intent = 'place' and g.object_representation = 'souvenir-miniature'
  and j.state in ('completed', 'partial')
  and j.stages->'worldlabs'->>'state' = 'completed'
  and j.input_document->'publicGalleryConsent' = 'true'::jsonb
  and j.input_document->>'publicGalleryConsentVersion' = 'giftportals-public-souvenir-v11'
  and j.document->'publicGalleryConsent' = j.input_document->'publicGalleryConsent'
  and j.document->>'publicGalleryConsentVersion' = j.input_document->>'publicGalleryConsentVersion';`;
}

export function createDownloadPlan(scene, rawGift, rawMetadata, now = Date.now()) {
  requireValue(['rio', 'paris'].includes(scene), 'V11_DOWNLOAD_ARGUMENTS');
  const gift = rawGift?.ok === true ? rawGift.data : rawGift;
  const rows = Array.isArray(rawMetadata) ? rawMetadata : [rawMetadata];
  requireValue(rows.length === 1, 'V11_PUBLIC_METADATA_REQUIRED');
  const metadata = rows[0]?.metadata ?? rows[0];
  requireValue(gift && UUID.test(gift.id) && metadata?.id === gift.id
    && metadata.format === 'giftportals-public-world-export-v1'
    && metadata.exampleId === scene && metadata.provider === 'worldlabs'
    && metadata.state === 'completed' && ['marble-1.0', 'marble-1.1'].includes(metadata.model)
    && UUID.test(metadata.operationId) && UUID.test(metadata.worldId)
    && gift.photoIntent === 'place' && gift.objectRepresentation === 'souvenir-miniature',
    'V11_REAL_PUBLIC_WORLD_REQUIRED');
  requireValue(Number.isFinite(gift.mediaExpiresAt) && gift.mediaExpiresAt * 1000 > now + 60000,
    'V11_PUBLIC_LINK_EXPIRED');
  requireValue(validSemantics(gift.worldSemantics) && validSemantics(metadata.semantics)
    && gift.worldSemantics.metricScaleFactor === metadata.semantics.metricScaleFactor
    && gift.worldSemantics.groundPlaneOffset === metadata.semantics.groundPlaneOffset,
    'V11_PUBLIC_SEMANTICS_REQUIRED');
  requireValue(Number.isFinite(Date.parse(metadata.createdAt))
    && Number.isFinite(Date.parse(metadata.observedAt))
    && (metadata.actualCredits == null || Number.isFinite(metadata.actualCredits) && metadata.actualCredits >= 0),
    'V11_PUBLIC_METADATA_REQUIRED');
  const assets = [];
  for (const [key, urlField, suffix] of [
    ['world', 'worldUrl', 'spz'], ['panorama', 'panoramaUrl', 'pano'], ['collider', 'colliderUrl', 'collider'],
  ]) {
    const asset = metadata.assets?.[key], address = gift[urlField];
    if (!asset && !address && key === 'collider') continue;
    requireValue(asset && typeof address === 'string' && asset.id === key
      && SHA.test(asset.sha256) && Number.isSafeInteger(asset.bytes)
      && asset.bytes > 0 && asset.bytes <= MAX_BYTES, 'V11_PUBLIC_ASSET_METADATA');
    const extension = key === 'world' && asset.mime === 'application/octet-stream' ? 'spz'
      : key === 'collider' && asset.mime === 'model/gltf-binary' ? 'glb'
      : key === 'panorama' ? ({'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp'})[asset.mime] : undefined;
    requireValue(extension && asset.path === `${gift.id}/souvenir/${key}-${asset.sha256}.${extension}`,
      'V11_PUBLIC_ASSET_PATH');
    let url;
    try { url = new URL(address); } catch { fail('V11_PUBLIC_ASSET_URL'); }
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { fail('V11_PUBLIC_ASSET_URL'); }
    requireValue(url.protocol === 'https:' && url.hostname === HOST && !url.port
      && !url.username && !url.password && !url.hash
      && path === `/storage/v1/object/sign/${BUCKET}/${asset.path}`,
      'V11_PUBLIC_ASSET_URL');
    // The signed query is used only for this GET, never saved in a receipt or printed.
    assets.push({key, suffix, extension, url: url.href,
      asset: {id:key, mime:asset.mime, bytes:asset.bytes, sha256:asset.sha256}});
  }
  return {scene, id:gift.id, metadata, assets};
}

export function validateAssetBytes(entry, bytes) {
  requireValue(bytes.length === entry.asset.bytes && digest(bytes) === entry.asset.sha256,
    'V11_PUBLIC_ASSET_HASH_OR_SIZE');
  if (entry.key === 'world') {
    let decoded;
    try { decoded = gunzipSync(bytes, {maxOutputLength:64 * 1024 * 1024}); }
    catch { fail('V11_PUBLIC_SPZ_INVALID'); }
    requireValue(decoded.length >= 16 && decoded.toString('ascii', 0, 4) === 'NGSP'
      && decoded.readUInt32LE(4) >= 1 && decoded.readUInt32LE(4) <= 4,
      'V11_PUBLIC_SPZ_INVALID');
    const points = decoded.readUInt32LE(8);
    requireValue(points > 0 && points <= 600000, 'V11_PUBLIC_SPZ_LIMIT');
    return {points};
  }
  if (entry.key === 'collider') {
    requireValue(bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'glTF'
      && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length,
      'V11_PUBLIC_COLLIDER_INVALID');
  }
  if (entry.key === 'panorama') {
    requireValue(entry.asset.mime === 'image/png'
      && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || entry.asset.mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216
      || entry.asset.mime === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF'
        && bytes.toString('ascii', 8, 12) === 'WEBP', 'V11_PUBLIC_PANORAMA_INVALID');
  }
  return {};
}

async function readIgnoredJSON(file) {
  const path = await realpath(resolve(ROOT, file));
  const base = await realpath(OUTPUTS);
  requireValue(inside(path, base), 'V11_DOWNLOAD_INPUT_PATH');
  const info = await stat(path);
  requireValue(info.isFile() && info.size > 0 && info.size <= 256 * 1024,
    'V11_DOWNLOAD_INPUT_SIZE');
  return JSON.parse(await readFile(path, 'utf8'));
}

async function downloadAsset(entry) {
  const response = await fetch(entry.url, {
    method:'GET', credentials:'omit', redirect:'error', signal:AbortSignal.timeout(60000),
  });
  requireValue(response.ok && response.body, 'V11_PUBLIC_GET_FAILED');
  const declared = response.headers.get('content-length');
  requireValue(declared === null || Number(declared) === entry.asset.bytes,
    'V11_PUBLIC_ASSET_SIZE');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    requireValue(length <= entry.asset.bytes && length <= MAX_BYTES, 'V11_PUBLIC_ASSET_SIZE');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const details = validateAssetBytes(entry, bytes);
  return {...entry, bytes, details};
}

async function main(args) {
  if (args[0] === '--metadata-query' && args.length === 3) {
    console.log(metadataQuery(args[1], args[2]));
    return;
  }
  requireValue(args.length === 3, 'V11_DOWNLOAD_ARGUMENTS');
  const [scene, giftFile, metadataFile] = args;
  const plan = createDownloadPlan(scene, await readIgnoredJSON(giftFile), await readIgnoredJSON(metadataFile));
  const downloaded = [];
  // Sequential and bounded. All files are verified before creating an export receipt.
  for (const entry of plan.assets) downloaded.push(await downloadAsset(entry));
  const out = join(OUTPUTS, `${scene}-public-world-${plan.id}`);
  await mkdir(out, {recursive:true});
  const checkedOut = await realpath(out), checkedBase = await realpath(OUTPUTS);
  requireValue(inside(checkedOut, checkedBase), 'V11_DOWNLOAD_OUTPUT_PATH');
  const assets = [];
  for (const value of downloaded) {
    const path = join(checkedOut, `${value.key}.${value.extension}`);
    await writeFile(path, value.bytes, {flag:'wx'});
    assets.push({suffix:value.suffix, path, bytes:value.asset.bytes,
      mime:value.asset.mime, sha256:value.asset.sha256, ...value.details});
  }
  const {metadata} = plan;
  const receipt = {provider:'worldlabs', state:'completed', model:metadata.model,
    operationId:metadata.operationId, worldId:metadata.worldId, createdAt:metadata.createdAt,
    observedAt:metadata.observedAt, ...(metadata.actualCredits == null ? {} : {actualCredits:metadata.actualCredits}),
    semantics:{metricScaleFactor:metadata.semantics.metricScaleFactor, groundPlaneOffset:metadata.semantics.groundPlaneOffset},
    publicGalleryId:plan.id, exampleId:scene, source:'actual-public-v11-archive', assets};
  const receiptFile = join(checkedOut, 'world-receipt.json');
  await writeFile(receiptFile, JSON.stringify(receipt, null, 2)+'\n', {flag:'wx'});
  console.log(JSON.stringify({scene, publicGalleryId:plan.id, worldId:metadata.worldId,
    receipt:relative(ROOT, receiptFile).replaceAll('\\', '/'),
    assets:assets.map(({suffix, bytes, sha256, points}) => ({suffix, bytes, sha256, ...(points ? {points} : {})})),
    requests:{method:'GET', count:downloaded.length, generation:0, sql:0, storageWrites:0}}));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    // Node/network errors can contain signed URLs. Emit only our fixed safe error codes.
    const code = typeof error?.message === 'string' && /^V11_[A-Z_]+$/.test(error.message)
      ? error.message : 'V11_PUBLIC_DOWNLOAD_FAILED';
    console.error(JSON.stringify({ok:false, code, generationRequests:0}));
    process.exitCode = 1;
  }
}
