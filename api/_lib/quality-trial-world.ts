import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { AppError, ensure, hasMagic, providerAssetUrl, text } from './rules.js';
import { assertImageSafetyAllowed, createImageSafetyAdapter, type ImageSafetyAdapter } from './image-safety.js';
import { completedAssets, providerId, providerJSON, type CompletedAssets } from './providers.js';

export const PLUS_WORLD_MODEL = 'marble-1.1-plus';
export const PLUS_WORLD_MAX_CREDITS = 3100;
export const PLUS_TEXT_WORLD_MAX_CREDITS = 3080;
export const PLUS_IMAGE_WORLD_MAX_CREDITS = 3080;
type ViewLabel = 'front' | 'right' | 'back' | 'left';
export interface WorldTrialInput {
 trialId: string; title: string; textPrompt: string;
 model?: 'marble-1.0' | 'marble-1.1' | 'marble-1.1-plus'; disableRecaption?: boolean;
 baseline: { worldId: string; label: string };
 provenance: string;
 inputMode?: 'multi-image' | 'single-image' | 'text';
 image?: { path: string };
 images?: { label: ViewLabel; path: string; azimuth: 0 | 90 | 180 | 270 }[];
}
interface ImageRecord { label: ViewLabel; azimuth: number; file: string; mime: string; bytes: number; sha256: string; mediaAssetId?: string }
interface TrialAsset { suffix: string; path: string; mime: string; bytes: number; sha256: string }
type TrialState = 'prepared' | 'uploading' | 'submitting' | 'processing' | 'completed' | 'failed' | 'ambiguous';
interface StoredTrial {
 version: 1; id: string; fingerprint: string; createdAt: string; updatedAt: string; state: TrialState;
 input: Omit<WorldTrialInput, 'image' | 'images'>; images: ImageRecord[]; reservation: number;
 operationId?: string; worldId?: string; actualCredits?: number; errorCode?: string;
 assets: TrialAsset[]; quality?: string; colliderStatus?: string; colliderErrorCode?: string;
 fullResStatus?: 'available' | 'unavailable' | 'download-failed'; fullResErrorCode?: string;
 semantics?: CompletedAssets['worldSemantics']; safety: { checkedAt: string; modelVersion: string; checkedImages: number };
}
interface Dependencies {
 directory: string; safety?: ImageSafetyAdapter; json?: typeof providerJSON; complete?: typeof completedAssets;
 upload?: (bytes: Buffer, mime: string, label: string) => Promise<string>;
 downloadFullRes?: (url: unknown) => Promise<{ bytes: Buffer; sha256: string }>;
 reserve: (input: { trialId: string; provider: 'worldlabs'; credits: number }) => Promise<unknown>;
 settle: (trialId: string, actualCredits: number) => Promise<unknown>;
 release: (trialId: string) => Promise<unknown>; now?: () => number;
}
const directions = { front: 0, right: 90, back: 180, left: 270 } as const;
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const validId = (id: unknown): string => { ensure(typeof id === 'string' && /^[a-z0-9][a-z0-9-]{4,79}$/.test(id), 'TRIAL_ID_INVALID'); return id; };
const safeCode = (error: unknown) => error instanceof AppError ? error.code : 'WORLD_TRIAL_FAILED';
function safeOperationError(error: unknown, privatePrompt: string) {
 if (!error || typeof error !== 'object') return undefined;
 const value = error as { code?: unknown; message?: unknown };
 const code = typeof value.code === 'number' && Number.isFinite(value.code) ? value.code : typeof value.code === 'string' && /^[A-Za-z0-9_ -]{1,80}$/.test(value.code) ? value.code : 'unrecognized';
 const message = typeof value.message === 'string' ? value.message
  .replaceAll(privatePrompt, '[private prompt removed]')
  .replace(/https?:\/\/[^\s<>"']+/gi, '[URL removed]')
  .replace(/(?:bearer|api[_ -]?key|token|authorization)\s*[:=]?\s*[^\s,;]+/gi, '[credential removed]')
  .replace(/\b[A-Za-z0-9_=-]{24,}\b/g, '[opaque value removed]')
  .replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 500) : undefined;
 return { code, message };
}
function imageSize(bytes: Buffer, mime: string): [number, number] {
 if (mime === 'image/png') {
  ensure(bytes.length >= 24 && bytes.toString('ascii', 12, 16) === 'IHDR', 'IMAGE_CONTENT_INVALID');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
 }
 let cursor = 2;
 while (cursor < bytes.length) {
  ensure(bytes[cursor++] === 255, 'IMAGE_CONTENT_INVALID');
  while (bytes[cursor] === 255) cursor++;
  const marker = bytes[cursor++];
  if (marker === 0xd9 || marker === 0xda) break;
  if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
  ensure(cursor + 2 <= bytes.length, 'IMAGE_CONTENT_INVALID');
  const length = bytes.readUInt16BE(cursor);
  ensure(length >= 2 && cursor + length <= bytes.length, 'IMAGE_CONTENT_INVALID');
  if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
   ensure(length >= 8, 'IMAGE_CONTENT_INVALID');
   return [bytes.readUInt16BE(cursor + 5), bytes.readUInt16BE(cursor + 3)];
  }
  cursor += length;
 }
 throw new AppError('IMAGE_CONTENT_INVALID');
}
async function readImage(path: string) {
 const info = await stat(path); ensure(info.isFile() && info.size > 0 && info.size <= 6 * 1024 * 1024, 'IMAGE_SIZE_LIMIT');
 const bytes = await readFile(path);
 const mime = hasMagic(bytes, 'image/png') ? 'image/png' : hasMagic(bytes, 'image/jpeg') ? 'image/jpeg' : '';
 ensure(mime, 'IMAGE_CONTENT_INVALID'); const size = imageSize(bytes, mime);
 ensure(size.every(value => Number.isInteger(value) && value >= 128 && value <= 8192), 'IMAGE_DIMENSIONS_INVALID');
 return { bytes, mime, size, sha256: digest(bytes) };
}
export function worldTrialReceipt(job: StoredTrial) {
 return {
  version: job.version, trialId: job.id, provider: 'worldlabs', model: job.input.model || PLUS_WORLD_MODEL,
  createdAt: job.createdAt, observedAt: job.updatedAt, state: job.state,
  evidence: job.input.inputMode === 'text' ? 'Purpose-authored spatial scene generated from text. Independent chapters are not a metrically connected city, a factual scan, or verified landmarks.' : job.input.inputMode === 'single-image' ? 'Spatial world generated from one provenance-recorded reference image. Unseen regions are generated interpretations, not a factual scan or verified reconstruction.' : 'Controlled pipeline comparison: model and input strategy both change; this is not a same-input causal model benchmark or a factual scan.',
  title: job.input.title, baseline: job.input.baseline, provenance: job.input.provenance,
  inputMode: job.input.inputMode || 'multi-image', promptSha256: digest(job.input.textPrompt),
  views: job.input.inputMode === 'single-image' ? [] : job.images.map(({ label, azimuth, bytes, mime }) => ({ label, azimuth, bytes, mime })),
  referenceImage: job.input.inputMode === 'single-image' ? { bytes: job.images[0].bytes, mime: job.images[0].mime, sha256: job.images[0].sha256 } : undefined,
  maxReservedCredits: job.reservation, actualCredits: job.actualCredits,
  operationId: job.operationId, worldId: job.worldId, errorCode: job.errorCode,
  quality: job.quality, colliderStatus: job.colliderStatus, colliderErrorCode: job.colliderErrorCode,
  fullResStatus: job.fullResStatus, fullResErrorCode: job.fullResErrorCode,
  semantics: job.semantics, safety: job.safety,
  assets: job.assets.map(({ suffix, path, mime, bytes, sha256 }) => ({ suffix, path, mime, bytes, sha256 })),
 };
}
async function uploadWorldImage(bytes: Buffer, mime: string, label: string): Promise<string> {
 const extension = mime === 'image/jpeg' ? 'jpg' : 'png';
 const prepared = await providerJSON('worldlabs', '/media-assets:prepare_upload', 'POST', { file_name: `trial-${label}.${extension}`, kind: 'image', extension });
 const info = prepared.upload_info, id = providerId(prepared.media_asset?.media_asset_id);
 ensure(info?.upload_method === 'PUT' && typeof info.upload_url === 'string', 'PROVIDER_RESPONSE_INVALID', 502);
 let url: URL; try { url = new URL(info.upload_url); } catch { throw new AppError('PROVIDER_RESPONSE_INVALID', 502); }
 ensure(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && ['worldlabs.ai', 'googleapis.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)), 'PROVIDER_ASSET_ORIGIN_DENIED', 502);
 ensure(info.required_headers && typeof info.required_headers === 'object', 'PROVIDER_RESPONSE_INVALID', 502);
 const headers: Record<string, string> = {};
 for (const [name, value] of Object.entries(info.required_headers)) {
  ensure(typeof value === 'string' && !/authorization|cookie|api-key/i.test(name), 'PROVIDER_RESPONSE_INVALID', 502); headers[name] = value;
 }
 let response: Response;
 try { response = await fetch(url, { method: 'PUT', body: new Uint8Array(bytes), headers, signal: AbortSignal.timeout(30000), redirect: 'error' }); }
 catch { throw new AppError('PROVIDER_UPLOAD_FAILED', 502); }
 ensure(response.ok, 'PROVIDER_UPLOAD_FAILED', 502); return id;
}
// Operator-only optional resolution. Ordinary provider downloads keep their25MiB/600k ceilings.
export async function downloadFullResolutionWorld(url: unknown) {
 const origin = providerAssetUrl(url, 'worldlabs'), maxBytes = 50 * 1024 * 1024;
 let response: Response;
 try { response = await fetch(origin, { redirect: 'error', signal: AbortSignal.timeout(60000) }); }
 catch { throw new AppError('PROVIDER_DOWNLOAD_FAILED', 502); }
 ensure(response.ok && response.body, 'PROVIDER_DOWNLOAD_FAILED', 502);
 const declared = Number(response.headers.get('content-length') || 0);
 ensure(Number.isFinite(declared) && declared >= 0 && declared <= maxBytes, 'GENERATED_ASSET_SIZE_LIMIT', 502);
 const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
 try {
  for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > maxBytes) { await reader.cancel(); throw new AppError('GENERATED_ASSET_SIZE_LIMIT', 502); } chunks.push(next.value); }
 } catch (error) { throw error instanceof AppError ? error : new AppError('PROVIDER_DOWNLOAD_FAILED', 502); }
 const bytes = Buffer.concat(chunks);
 ensure(bytes.length > 0 && bytes[0] === 0x1f && bytes[1] === 0x8b, 'PROVIDER_ASSET_INVALID', 502);
 let decoded: Buffer; try { decoded = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 }); } catch { throw new AppError('PROVIDER_ASSET_INVALID', 502); }
 ensure(decoded.length > 16 && decoded.toString('ascii', 0, 4) === 'NGSP' && [1,2,3,4].includes(decoded.readUInt32LE(4)) && decoded.readUInt32LE(8) > 0 && decoded.readUInt32LE(8) <= 2500000, 'PROVIDER_ASSET_INVALID', 502);
 return { bytes, sha256: digest(bytes) };
}
export function createWorldQualityTrial(deps: Dependencies) {
 const directory = resolve(deps.directory), json = deps.json || providerJSON, safety = deps.safety || createImageSafetyAdapter();
 const upload = deps.upload || uploadWorldImage, complete = deps.complete || completedAssets, now = deps.now || Date.now;
 const downloadFull = deps.downloadFullRes || downloadFullResolutionWorld;
 const iso = () => new Date(now()).toISOString(), file = (id: string) => join(directory, id, 'job.json');
 async function save(job: StoredTrial) {
  job.updatedAt = iso(); const temporary = `${file(job.id)}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(job, null, 2) + '\n'); await rename(temporary, file(job.id));
 }
 async function read(id: string): Promise<StoredTrial | undefined> {
  try { const raw = JSON.parse(await readFile(file(id), 'utf8')); ensure(raw?.version === 1 && raw.id === id && Array.isArray(raw.assets), 'TRIAL_RECORD_INVALID'); return raw; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
 }
 async function locked<T>(id: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true }); const path = join(directory, `.${id}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
   try { await writeFile(path, String(process.pid), { flag: 'wx' }); break; }
   catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt) throw new AppError('TRIAL_BUSY', 409);
    const pid = Number(await readFile(path, 'utf8')); ensure(Number.isInteger(pid) && pid > 0, 'TRIAL_BUSY', 409);
    try { process.kill(pid, 0); throw new AppError('TRIAL_BUSY', 409); }
    catch (probe) { if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw probe; }
    await rm(path);
   }
  }
  try { return await operation(); } finally { await rm(path, { force: true }); }
 }
 const create = async (input: WorldTrialInput, confirmProviderSpend: boolean) => {
  ensure(confirmProviderSpend === true, 'EXPLICIT_SPEND_CONFIRMATION_REQUIRED', 403);
  const id = validId(input.trialId);
  return locked(id, async () => {
   const clean: Omit<WorldTrialInput, 'image' | 'images'> = { trialId: id, title: text(input.title, 64), textPrompt: text(input.textPrompt, input.inputMode === 'text' ? 2000 : 4000, 40), provenance: text(input.provenance, 1000, 30), baseline: { worldId: providerId(input.baseline?.worldId), label: text(input.baseline?.label, 120) } };
   ensure(input.model === undefined || ['marble-1.0','marble-1.1','marble-1.1-plus'].includes(input.model), 'WORLD_MODEL_INVALID');
   ensure(input.disableRecaption === undefined || typeof input.disableRecaption === 'boolean', 'WORLD_RECAPTION_INVALID');
   if (input.model !== undefined) clean.model = input.model;
   if (input.disableRecaption !== undefined) clean.disableRecaption = input.disableRecaption;
   ensure(input.inputMode === undefined || input.inputMode === 'multi-image' || input.inputMode === 'single-image' || input.inputMode === 'text', 'WORLD_INPUT_MODE_INVALID');
   const textOnly = input.inputMode === 'text', singleImage = input.inputMode === 'single-image';
   let sourceImages: NonNullable<WorldTrialInput['images']> = [];
   if (textOnly) {
    ensure(input.image === undefined && (input.images === undefined || Array.isArray(input.images) && input.images.length === 0), 'WORLD_TEXT_IMAGES_FORBIDDEN'); clean.inputMode = 'text';
   } else if (singleImage) {
    ensure(input.image && typeof input.image === 'object' && !Array.isArray(input.image) && typeof input.image.path === 'string' && input.image.path.trim().length > 0 && input.images === undefined, 'WORLD_SINGLE_IMAGE_INVALID');
    clean.inputMode = 'single-image'; sourceImages = [{ label: 'front', azimuth: 0, path: input.image.path }];
   } else {
    ensure(input.image === undefined && Array.isArray(input.images) && input.images.length >= 2 && input.images.length <= 4 && new Set(input.images.map(image => image.label)).size === input.images.length && input.images.every(image => image.label in directions && image.azimuth === directions[image.label] && typeof image.path === 'string'), 'WORLD_VIEWS_INVALID');
    sourceImages = input.images;
   }
   const images: (NonNullable<WorldTrialInput['images']>[number] & Awaited<ReturnType<typeof readImage>>)[] = [];
   for (const image of sourceImages) images.push({ ...image, ...await readImage(resolve(image.path)) });
   ensure(images.every(image => image.size[0] === images[0].size[0] && image.size[1] === images[0].size[1]), 'WORLD_VIEWS_DIMENSIONS_MISMATCH');
   const fingerprint = digest(JSON.stringify({ ...clean, images: images.map(({ label, azimuth, sha256 }) => ({ label, azimuth, sha256 })) }));
   const existing = await read(id);
   if (existing) { ensure(existing.fingerprint === fingerprint, 'TRIAL_DEDUPE_MISMATCH', 409); return worldTrialReceipt(existing); }
   let checkedAt = textOnly ? iso() : '', modelVersion = textOnly ? 'not-applicable-text-only-no-images' : '';
   for (const image of images) {
    const report = await safety.screen([{ id: 'world', bytes: image.bytes, mime: image.mime }]); assertImageSafetyAllowed(report);
    ensure(report.results.length === 1 && report.results[0].id === 'world' && report.results[0].sha256 === image.sha256, 'PHOTO_SAFETY_UNAVAILABLE', 503);
    checkedAt = report.checkedAt; modelVersion = report.modelVersion;
   }
   await mkdir(join(directory, id), { recursive: true });
   const model = clean.model || PLUS_WORLD_MODEL;
   const reservation = model === PLUS_WORLD_MODEL ? textOnly ? PLUS_TEXT_WORLD_MAX_CREDITS : singleImage ? PLUS_IMAGE_WORLD_MAX_CREDITS : PLUS_WORLD_MAX_CREDITS : textOnly || singleImage ? 1580 : 1600;
   const job: StoredTrial = { version: 1, id, fingerprint, input: clean, state: 'prepared', createdAt: iso(), updatedAt: iso(), reservation, assets: [], safety: { checkedAt, modelVersion, checkedImages: images.length }, images: images.map(image => ({ label: image.label, azimuth: image.azimuth, file: `${image.label}.${image.mime === 'image/png' ? 'png' : 'jpg'}`, mime: image.mime, bytes: image.bytes.length, sha256: image.sha256 })) };
   await save(job); let paidPostStarted = false, reserved = false;
   try {
    await deps.reserve({ trialId: id, provider: 'worldlabs', credits: reservation }); reserved = true;
    // Fresh balance covers the documented input-specific maximum plus 1000 credits.
    const balance = await json('worldlabs', '/credits');
    ensure(Number.isFinite(Number(balance.remaining_credits)) && Number(balance.remaining_credits) >= reservation, 'PROVIDER_INSUFFICIENT_CREDITS', 403);
    if (!textOnly) { job.state = 'uploading'; await save(job); }
    for (let index = 0; index < images.length; index++) {
     await writeFile(join(directory, id, job.images[index].file), images[index].bytes);
     job.images[index].mediaAssetId = providerId(await upload(images[index].bytes, images[index].mime, images[index].label)); await save(job);
    }
    job.state = 'submitting'; await save(job); paidPostStarted = true;
    const worldPrompt = textOnly ? { type: 'text', text_prompt: clean.textPrompt } : singleImage ? { type: 'image', image_prompt: { source: 'media_asset', media_asset_id: job.images[0].mediaAssetId }, text_prompt: clean.textPrompt, is_pano: false, ...(clean.disableRecaption === undefined ? {} : { disable_recaption: clean.disableRecaption }) } : { type: 'multi-image', multi_image_prompt: job.images.map(image => ({ azimuth: image.azimuth, content: { source: 'media_asset', media_asset_id: image.mediaAssetId } })), text_prompt: clean.textPrompt };
    const result = await json('worldlabs', '/worlds:generate', 'POST', { display_name: clean.title, model, permission: { public: false }, world_prompt: worldPrompt });
    job.operationId = providerId(result.operation_id); job.state = 'processing'; await save(job);
   } catch (error) {
    job.state = paidPostStarted ? 'ambiguous' : 'failed'; job.errorCode = safeCode(error); await save(job);
    if (reserved && !paidPostStarted) await deps.release(id);
   }
   return worldTrialReceipt(job);
  });
 };
 const poll = async (trialId: string, options: { include100k?: boolean; includeFullRes?: boolean } = {}) => {
  const id = validId(trialId);
  return locked(id, async () => {
   const job = await read(id); ensure(job, 'TRIAL_NOT_FOUND', 404);
   const needs100k = options.include100k && !job.assets.some(asset => asset.suffix === 'spz100k');
   const needsFull = options.includeFullRes && !['available','unavailable'].includes(job.fullResStatus || '');
   if (job.state === 'failed' || job.state === 'completed' && !needs100k && !needsFull) return worldTrialReceipt(job);
   if (!job.operationId) { job.state = 'ambiguous'; job.errorCode ||= 'SUBMISSION_AMBIGUOUS'; await save(job); return worldTrialReceipt(job); }
   // This resumable path contains only GETs and bounded asset downloads, never paid POST or upload.
   const result = await json('worldlabs', `/operations/${encodeURIComponent(providerId(job.operationId))}`);
   if (result.error) { job.state = 'failed'; job.errorCode = 'PROVIDER_GENERATION_FAILED'; await save(job); return worldTrialReceipt(job); }
   if (job.state === 'completed') {
    if (needs100k) await add100k(job, result);
    if (needsFull) await addFullRes(job, result);
    await save(job); return worldTrialReceipt(job);
   }
   const output = await complete('worldlabs', result, { worldQuality: '500k', includeCollider: true });
   if (!output) return worldTrialReceipt(job);
   ensure(output.worldQuality === '500k', 'WORLD_500K_UNAVAILABLE', 502);
   ensure(output.cost === undefined || typeof output.cost === 'number' && Number.isFinite(output.cost) && output.cost >= 0 && output.cost <= job.reservation, 'WORLD_TRIAL_COST_INVALID', 502);
   ensure(output.resultId, 'PROVIDER_RESPONSE_INVALID', 502);
   job.worldId = providerId(output.resultId); if (output.cost !== undefined) job.actualCredits = output.cost;
   job.quality = output.worldQuality; job.colliderStatus = output.colliderStatus; job.colliderErrorCode = output.colliderErrorCode; job.semantics = output.worldSemantics;
   await save(job);
   // A valid completed asset is usable even if billing has not arrived. Keep the full reservation held; unknown cost is never zero.
   if (job.actualCredits !== undefined) await deps.settle(id, job.actualCredits);
   const wanted = new Set(['spz', 'pano', 'collider']);
   ensure(output.assets.some(asset => asset.suffix === 'spz') && output.assets.some(asset => asset.suffix === 'pano'), 'PROVIDER_ASSET_INVALID', 502);
   for (const asset of output.assets) {
    ensure(wanted.has(asset.suffix) && Buffer.isBuffer(asset.bytes) && asset.bytes.length > 0 && asset.bytes.length <= 25 * 1024 * 1024 && digest(asset.bytes) === asset.sha256, 'PROVIDER_ASSET_INVALID', 502);
    const name = asset.suffix === 'spz' ? 'world.spz' : asset.suffix === 'collider' ? 'collider.glb' : `panorama.${asset.mime === 'image/png' ? 'png' : asset.mime === 'image/webp' ? 'webp' : 'jpg'}`;
    const path = join(directory, id, name); await writeFile(path, asset.bytes);
    job.assets = job.assets.filter(previous => previous.suffix !== asset.suffix); job.assets.push({ suffix: asset.suffix, path, mime: asset.mime, bytes: asset.bytes.length, sha256: asset.sha256 });
   }
   job.state = 'completed'; job.errorCode = undefined; await save(job);
   // Secondary resolution is a GET-only download of the same completed operation.
   // Its failure leaves the valid 500k result complete and resumable.
   if (options.include100k) { await add100k(job, result); await save(job); }
   if (options.includeFullRes) { await addFullRes(job, result); await save(job); }
   return worldTrialReceipt(job);
  });
 };
 async function add100k(job: StoredTrial, result: Parameters<typeof completedAssets>[1]) {
  const output = await complete('worldlabs', result, { worldQuality: '100k', includeCollider: false });
  ensure(output?.worldQuality === '100k' && output.resultId === job.worldId, 'WORLD_100K_UNAVAILABLE', 502);
  ensure(output.cost === undefined || typeof output.cost === 'number' && Number.isFinite(output.cost) && output.cost >= 0 && output.cost <= job.reservation && (job.actualCredits === undefined || output.cost === job.actualCredits), 'WORLD_TRIAL_COST_INVALID', 502);
  const asset = output.assets.find(asset => asset.suffix === 'spz');
  ensure(asset && Buffer.isBuffer(asset.bytes) && asset.bytes.length > 0 && asset.bytes.length <= 25 * 1024 * 1024 && digest(asset.bytes) === asset.sha256, 'PROVIDER_ASSET_INVALID', 502);
  const path = join(directory, job.id, 'world-100k.spz'); await writeFile(path, asset.bytes);
  job.assets = job.assets.filter(previous => previous.suffix !== 'spz100k');
  job.assets.push({ suffix: 'spz100k', path, mime: asset.mime, bytes: asset.bytes.length, sha256: asset.sha256 });
 }
 async function addFullRes(job: StoredTrial, result: Parameters<typeof completedAssets>[1]) {
  try {
   let world = result.response;
   ensure(world && typeof world === 'object' && providerId(world.world_id) === job.worldId, 'PROVIDER_RESPONSE_INVALID', 502);
   if (!world.assets?.splats?.spz_urls?.full_res) world = await json('worldlabs', `/worlds/${encodeURIComponent(providerId(job.worldId))}`);
   ensure(providerId(world.world_id) === job.worldId, 'PROVIDER_RESPONSE_INVALID', 502);
   const url = world.assets?.splats?.spz_urls?.full_res;
   if (!url) { job.fullResStatus = 'unavailable'; job.fullResErrorCode = undefined; return; }
   const asset = await downloadFull(url);
   ensure(Buffer.isBuffer(asset.bytes) && asset.bytes.length > 0 && asset.bytes.length <= 50 * 1024 * 1024 && digest(asset.bytes) === asset.sha256, 'PROVIDER_ASSET_INVALID', 502);
   const path = join(directory, job.id, 'world-full-res.spz'); await writeFile(path, asset.bytes);
   job.assets = job.assets.filter(previous => previous.suffix !== 'spzfull');
   job.assets.push({ suffix: 'spzfull', path, mime: 'application/octet-stream', bytes: asset.bytes.length, sha256: asset.sha256 });
   job.fullResStatus = 'available'; job.fullResErrorCode = undefined;
  } catch (error) { job.fullResStatus = 'download-failed'; job.fullResErrorCode = safeCode(error); }
 }
 const inspect = async (trialId: string) => {
  const id = validId(trialId), job = await read(id); ensure(job?.operationId, 'TRIAL_OPERATION_ID_MISSING', 409);
  const result = await json('worldlabs', `/operations/${encodeURIComponent(providerId(job.operationId))}`);
  const credits = result.cost?.total_credits;
  const metadata = result.metadata && typeof result.metadata === 'object' && !Array.isArray(result.metadata) ? result.metadata as Record<string, unknown> : undefined;
  const progress = metadata?.progress;
  const updatedAt = result.updated_at;
  return { ...worldTrialReceipt(job), operationInspection: {
   observedAt: iso(), generationRequests: 0, providerURLsOutput: false,
   done: result.done === true, hasProviderError: Boolean(result.error),
   progress: typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 100 ? progress : undefined,
   providerUpdatedAt: typeof updatedAt === 'string' && updatedAt.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(updatedAt) && Number.isFinite(Date.parse(updatedAt)) ? updatedAt : undefined,
   metadataKeys: metadata ? Object.keys(metadata).filter(key => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)).slice(0, 24) : [],
   providerError: safeOperationError(result.error, job.input.textPrompt),
   settledOperationCredits: typeof credits === 'number' && Number.isFinite(credits) && credits >= 0 ? credits : undefined,
   responsePresent: result.response !== undefined && result.response !== null,
  } };
 };
 return { create, poll, inspect };
}
