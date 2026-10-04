import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rmdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { AppError, ensure, hasMagic, providerAssetUrl } from './rules.js';
import { providerJSON, providerId, checkProviderCredit, downloadAsset, type Asset } from './providers.js';
import { assertImageSafetyAllowed, createImageSafetyAdapter, type ImageSafetyAdapter, type ImageSafetyReport } from './image-safety.js';
import { createQualityTrialBudget, type reserveTrialCredits, type settleTrialCredits, type releaseTrialCredits } from './quality-trial-budget.js';

export const TRIPO_MULTIVIEW_TRIAL_PROTOCOL = 'giftportals-tripo-multiview-trial-v22';
export const TRIPO_MULTIVIEW_TRIAL_RESERVATION = 100;
export const TRIPO_MULTIVIEW_TRIAL_SETTINGS = Object.freeze({ model: 'v3.1-20260211', face_limit: 30000, texture: true, pbr: true, geometry_quality: 'detailed', texture_quality: 'detailed' });
const viewNames = ['front', 'left', 'back', 'right'] as const;
type View = typeof viewNames[number];
type Stage = { state: 'pending' | 'processing' | 'completed' | 'failed'; taskId?: string; submittedAt?: string; credits?: number; errorCode?: string };
type ImageMeta = { name: string; mime: string; bytes: number; sha256: string; safety: ImageSafetyReport };
interface Ledger {
 protocol: typeof TRIPO_MULTIVIEW_TRIAL_PROTOCOL; trialId: string; createdAt: string; updatedAt: string;
 reference: ImageMeta; upload: { submittedAt?: string; fileToken?: string; errorCode?: string };
 viewsStage: Stage; modelStage: Stage; views?: Record<View, ImageMeta>; viewsSha256?: string;
 approvedViewsSha256?: string; rejectedAt?: string; model?: Omit<ImageMeta, 'safety'>;
}
interface Dependencies {
 directory?: string; json?: typeof providerJSON; credit?: typeof checkProviderCredit; download?: typeof downloadAsset;
 safety?: ImageSafetyAdapter; upload?: (bytes: Buffer, mime: string) => Promise<string>;
 reserve?: typeof reserveTrialCredits; settle?: typeof settleTrialCredits; release?: typeof releaseTrialCredits;
 restore?: (trialId: string, expectedActualCredits: number) => Promise<unknown>;
 now?: () => number;
}
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safeCode = (error: unknown) => error instanceof AppError ? error.code : 'TRIAL_OPERATION_FAILED';
const cost = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
export function tripoViewsHash(views: Record<View, { sha256: string }>): string {
 return sha(viewNames.map(view => `${view}:${views[view].sha256}`).join('\n'));
}
/** Supports the documented flat envelope and the actual v3 image_to_multiview nested envelope observed in the authenticated trial. */
export function tripoMultiviewOutput(result: { type?: unknown; output?: unknown }): Record<View, string> {
 ensure(['generate_multiview_image', 'image_to_multiview'].includes(result.type as string), 'PROVIDER_RESPONSE_INVALID', 502);
 ensure(result.output && typeof result.output === 'object' && !Array.isArray(result.output), 'PROVIDER_RESPONSE_INVALID', 502);
 const original = result.output as Record<string, unknown>, nested = original.generate_multiview_image;
 ensure(nested === undefined || nested && typeof nested === 'object' && !Array.isArray(nested), 'PROVIDER_RESPONSE_INVALID', 502);
 ensure(nested === undefined || !viewNames.some(view => original[`${view}_view_url`] !== undefined), 'PROVIDER_RESPONSE_INVALID', 502);
 const output = nested === undefined ? original : nested as Record<string, unknown>, urls = {} as Record<View, string>;
 for (const view of viewNames) {
  const url = output[`${view}_view_url`]; ensure(typeof url === 'string', 'PROVIDER_RESPONSE_INVALID', 502);
  providerAssetUrl(url, 'tripo'); urls[view] = url;
 }
 return urls;
}
function assertImage(bytes: Buffer, mime: string) {
 ensure(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 6 * 1024 * 1024 && ['image/png', 'image/jpeg', 'image/webp'].includes(mime) && hasMagic(bytes, mime), 'IMAGE_CONTENT_INVALID', 400);
}
async function uploadTripoImage(bytes: Buffer, mime: string): Promise<string> {
 const key = process.env.TRIPO_API_KEY; ensure(key, 'PROVIDER_UNAVAILABLE', 503);
 const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), `miniature.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`);
 let response: Response; try { response = await fetch('https://openapi.tripo3d.ai/v3/files', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30000), redirect: 'error' }); }
 catch { throw new AppError('SUBMISSION_AMBIGUOUS', 502); }
 ensure(response.ok, 'PROVIDER_UPLOAD_FAILED', 502);
 const raw = await response.text(); ensure(raw.length < 1024 * 1024, 'PROVIDER_RESPONSE_LIMIT', 502);
 let value; try { value = JSON.parse(raw); } catch { throw new AppError('SUBMISSION_AMBIGUOUS', 502); }
 ensure(value.code === 0, 'PROVIDER_UPLOAD_FAILED', 502); return providerId(value.data?.file_token);
}

/** Native operator experiment: generated views are screened and hash-approved before a second paid task. */
export function createTripoMultiviewTrial(deps: Dependencies = {}) {
 const directory = resolve(deps.directory || process.env.GIFTPORTALS_LOCAL_DIR || '.local-giftportals');
 const json = deps.json || providerJSON, credit = deps.credit || checkProviderCredit, download = deps.download || downloadAsset;
 const safety = deps.safety || createImageSafetyAdapter(), upload = deps.upload || uploadTripoImage;
 const budget = createQualityTrialBudget(directory);
 const reserve = deps.reserve || budget.reserve, settle = deps.settle || budget.settle, release = deps.release || budget.release;
 const now = deps.now || Date.now, stamp = () => new Date(now()).toISOString();
 const folder = (trialId: string) => { ensure(/^[a-z][a-z0-9-]{2,79}$/.test(trialId), 'INVALID_TRIAL_ID', 400); return join(directory, 'quality-trials', trialId, 'tripo'); };
 const jobPath = (trialId: string) => join(folder(trialId), 'job.json');
 const save = async (job: Ledger) => {
  job.updatedAt = stamp(); const target = jobPath(job.trialId), temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(job, null, 2) + '\n');
  for (let attempt = 0; ; attempt++) {
   try { await rename(temporary, target); break; }
   catch (error) { if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')) throw error; await new Promise(resolveWait => setTimeout(resolveWait, 20 * (attempt + 1))); }
  }
 };
 const load = async (trialId: string): Promise<Ledger> => {
  const bytes = await readFile(jobPath(trialId)); ensure(bytes.length <= 256 * 1024, 'TRIAL_LEDGER_INVALID', 500);
  let job: Ledger; try { job = JSON.parse(bytes.toString('utf8')); } catch { throw new AppError('TRIAL_LEDGER_INVALID', 500); }
  ensure(job.protocol === TRIPO_MULTIVIEW_TRIAL_PROTOCOL && job.trialId === trialId, 'TRIAL_LEDGER_INVALID', 500); return job;
 };
 const withLock = async <T>(trialId: string, action: () => Promise<T>): Promise<T> => {
  const path = folder(trialId); await mkdir(path, { recursive: true }); const lock = join(path, '.lock');
  try { await mkdir(lock); } catch { throw new AppError('TRIAL_BUSY', 409); }
  try { return await action(); } finally { await rmdir(lock); }
 };
 const dto = (job: Ledger) => ({
  protocol: job.protocol, trialId: job.trialId, updatedAt: job.updatedAt,
  reference: { sha256: job.reference.sha256, path: join(folder(job.trialId), job.reference.name), safety: job.reference.safety.decision },
  viewsStage: job.viewsStage, modelStage: job.modelStage, viewsSha256: job.viewsSha256, approvedViewsSha256: job.approvedViewsSha256,
  approvalRequired: job.viewsStage.state === 'completed' && job.modelStage.state === 'pending' && !job.rejectedAt,
  views: job.views && Object.fromEntries(viewNames.map(view => [view, { path: join(folder(job.trialId), job.views![view].name), sha256: job.views![view].sha256, safety: job.views![view].safety.decision }])),
  model: job.model && { path: join(folder(job.trialId), job.model.name), sha256: job.model.sha256, bytes: job.model.bytes },
  rejectedAt: job.rejectedAt, settings: TRIPO_MULTIVIEW_TRIAL_SETTINGS, reservedCredits: TRIPO_MULTIVIEW_TRIAL_RESERVATION,
  actualCredits: job.viewsStage.credits !== undefined && job.modelStage.credits !== undefined ? job.viewsStage.credits + job.modelStage.credits : undefined,
 });
 const terminalCosts = async (job: Ledger) => {
  const viewsCost = job.viewsStage.credits, modelCost = job.modelStage.credits;
  if (viewsCost !== undefined && (job.viewsStage.state === 'failed' || job.rejectedAt)) await settle(job.trialId, viewsCost);
  else if (viewsCost !== undefined && modelCost !== undefined && ['failed', 'completed'].includes(job.modelStage.state)) await settle(job.trialId, viewsCost + modelCost);
 };
 const checkedImage = async (bytes: Buffer, mime: string) => {
  assertImage(bytes, mime); const report = await safety.screen([{ id: 'object', bytes, mime }]); assertImageSafetyAllowed(report);
  ensure(report.results.length === 1 && report.results[0].sha256 === sha(bytes), 'PHOTO_SAFETY_UNAVAILABLE', 503); return report;
 };
 const create = async (input: { trialId: string; bytes: Buffer; mime: string; referenceSha256: string; confirmSpend: boolean }) => withLock(input.trialId, async () => {
  ensure(input.confirmSpend === true, 'EXPLICIT_SPEND_CONFIRMATION_REQUIRED', 400); assertImage(input.bytes, input.mime);
  ensure(validHash(input.referenceSha256) && sha(input.bytes) === input.referenceSha256, 'REFERENCE_HASH_MISMATCH', 409);
  try {
   await stat(jobPath(input.trialId)); const known = await load(input.trialId);
   ensure(known.reference.sha256 === input.referenceSha256 && known.reference.mime === input.mime, 'DEDUPE_MISMATCH', 409); return dto(known);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const referenceSafety = await checkedImage(input.bytes, input.mime);
  const job: Ledger = { protocol: TRIPO_MULTIVIEW_TRIAL_PROTOCOL, trialId: input.trialId, createdAt: stamp(), updatedAt: stamp(),
   reference: { name: `reference.${input.mime === 'image/jpeg' ? 'jpg' : input.mime.split('/')[1]}`, mime: input.mime, bytes: input.bytes.length, sha256: input.referenceSha256, safety: referenceSafety },
   upload: {}, viewsStage: { state: 'pending' }, modelStage: { state: 'pending' } };
  await writeFile(join(folder(input.trialId), job.reference.name), input.bytes); await save(job);
  let reserved = false;
  try {
   await reserve({ trialId: input.trialId, provider: 'tripo', credits: TRIPO_MULTIVIEW_TRIAL_RESERVATION });
   reserved = true;
   await credit('tripo', TRIPO_MULTIVIEW_TRIAL_RESERVATION);
   job.upload.submittedAt = stamp(); await save(job);
   job.upload.fileToken = await upload(input.bytes, input.mime); await save(job);
   job.viewsStage = { state: 'processing', submittedAt: stamp() }; await save(job);
   const response = await json('tripo', '/generation/image-to-multiview', 'POST', { input: job.upload.fileToken });
   job.viewsStage.taskId = providerId(response.task_id); await save(job);
  } catch (error) {
   job.viewsStage.state = 'failed'; job.viewsStage.errorCode = job.upload.submittedAt && !job.viewsStage.taskId ? 'SUBMISSION_AMBIGUOUS' : safeCode(error);
   await save(job); if (reserved && !job.upload.submittedAt) await release(input.trialId); throw new AppError(job.viewsStage.errorCode, 502);
  }
  return dto(job);
 });
 const poll = async (trialId: string) => withLock(trialId, async () => {
  const job = await load(trialId); const stage = job.viewsStage.state === 'processing' ? job.viewsStage : job.modelStage.state === 'processing' ? job.modelStage : undefined;
  if (!stage || !stage.taskId) return dto(job);
  let response; try { response = await json('tripo', `/tasks/${encodeURIComponent(providerId(stage.taskId))}`); }
  catch (error) { throw new AppError(safeCode(error), 502); } // A read error leaves the known task resumable.
  if (cost(response.credits_consumed) !== undefined) { stage.credits = cost(response.credits_consumed); await save(job); }
  if (['failed', 'cancelled', 'banned', 'expired'].includes(response.status)) { stage.state = 'failed'; stage.errorCode = 'PROVIDER_GENERATION_FAILED'; await save(job); await terminalCosts(job); return dto(job); }
  if (response.status !== 'success') return dto(job);
  try {
   if (stage === job.viewsStage) {
    const urls = tripoMultiviewOutput(response);
    const images: { view: View; asset: Asset; safety: ImageSafetyReport }[] = [];
    for (const view of viewNames) {
     const asset = await download(urls[view], 'tripo', view, 'world', 'image/png', { maxBytes: 6 * 1024 * 1024 });
     images.push({ view, asset, safety: await checkedImage(asset.bytes, asset.mime) });
    }
    const views = {} as Record<View, ImageMeta>;
    for (const image of images) {
     const extension = image.asset.mime === 'image/jpeg' ? 'jpg' : image.asset.mime.split('/')[1], name = `${image.view}.${extension}`;
     await writeFile(join(folder(trialId), name), image.asset.bytes);
     views[image.view] = { name, mime: image.asset.mime, bytes: image.asset.bytes.length, sha256: sha(image.asset.bytes), safety: image.safety };
    }
    job.views = views; job.viewsSha256 = tripoViewsHash(views);
   } else {
    const asset = await download(response.output?.model_url, 'tripo', 'glb', 'model', 'model/gltf-binary');
    ensure(hasMagic(asset.bytes, 'model/gltf-binary'), 'PROVIDER_ASSET_INVALID', 502);
    await writeFile(join(folder(trialId), 'model.glb'), asset.bytes); job.model = { name: 'model.glb', mime: asset.mime, bytes: asset.bytes.length, sha256: sha(asset.bytes) };
   }
   stage.state = 'completed'; await save(job); await terminalCosts(job);
  } catch (error) {
   stage.errorCode = safeCode(error);
   // A bounded download failure can be polled again against the same known task; it never issues another generation POST.
   if (!['PROVIDER_DOWNLOAD_FAILED', 'PROVIDER_NETWORK'].includes(stage.errorCode)) stage.state = 'failed';
   await save(job); await terminalCosts(job);
  }
  return dto(job);
 });
 const approve = async (input: { trialId: string; viewsSha256: string; confirmSpend: boolean }) => withLock(input.trialId, async () => {
  ensure(input.confirmSpend === true, 'EXPLICIT_SPEND_CONFIRMATION_REQUIRED', 400); const job = await load(input.trialId);
  ensure(!job.rejectedAt && job.viewsStage.state === 'completed' && job.views && job.viewsStage.taskId && validHash(input.viewsSha256) && input.viewsSha256 === job.viewsSha256, 'VIEWS_APPROVAL_MISMATCH', 409);
  if (job.modelStage.state !== 'pending') { ensure(job.approvedViewsSha256 === input.viewsSha256, 'VIEWS_APPROVAL_MISMATCH', 409); return dto(job); }
  for (const view of viewNames) {
   const meta = job.views[view]; ensure(new RegExp(`^${view}\\.(png|jpg|webp)$`).test(meta.name), 'TRIAL_LEDGER_INVALID', 500);
   const bytes = await readFile(join(folder(input.trialId), meta.name)); assertImage(bytes, meta.mime);
   ensure(sha(bytes) === meta.sha256, 'VIEWS_HASH_MISMATCH', 409); assertImageSafetyAllowed(meta.safety);
   ensure(meta.safety.results.length === 1 && meta.safety.results[0].sha256 === meta.sha256, 'PHOTO_SAFETY_UNAVAILABLE', 503);
  }
  ensure(tripoViewsHash(job.views) === input.viewsSha256, 'VIEWS_HASH_MISMATCH', 409);
  await credit('tripo', 60); job.approvedViewsSha256 = input.viewsSha256;
  job.modelStage = { state: 'processing', submittedAt: stamp() }; await save(job);
  try {
   const response = await json('tripo', '/generation/multiview-to-model', 'POST', { inputs: [{ task_id: providerId(job.viewsStage.taskId) }], ...TRIPO_MULTIVIEW_TRIAL_SETTINGS });
   job.modelStage.taskId = providerId(response.task_id); await save(job);
  } catch { job.modelStage.state = 'failed'; job.modelStage.errorCode = 'SUBMISSION_AMBIGUOUS'; await save(job); throw new AppError('SUBMISSION_AMBIGUOUS', 502); }
  return dto(job);
 });
 const reject = async (input: { trialId: string; viewsSha256: string }) => withLock(input.trialId, async () => {
  const job = await load(input.trialId); ensure(job.viewsStage.state === 'completed' && job.modelStage.state === 'pending' && input.viewsSha256 === job.viewsSha256, 'VIEWS_APPROVAL_MISMATCH', 409);
  job.rejectedAt ||= stamp(); await save(job); await terminalCosts(job); return dto(job);
 });
 const inspect = async (trialId: string) => {
  const job = await load(trialId), stage = job.modelStage.taskId ? job.modelStage : job.viewsStage;
  ensure(stage.taskId, 'TRIAL_TASK_ID_MISSING', 409);
  const result = await json('tripo', `/tasks/${encodeURIComponent(providerId(stage.taskId))}`);
  const shape = (value: unknown, depth = 0): unknown => {
   if (Array.isArray(value)) return { type: 'array', length: value.length, item: value.length && depth < 2 ? shape(value[0], depth + 1) : undefined };
   if (value && typeof value === 'object') return { type: 'object', fields: Object.fromEntries(Object.entries(value).filter(([key]) => /^[a-z][a-z0-9_]{0,63}$/i.test(key)).map(([key, item]) => [key, depth < 2 ? shape(item, depth + 1) : typeof item])) };
   return { type: value === null ? 'null' : typeof value };
  };
  return { trialId, taskId: stage.taskId, localState: stage.state, errorCode: stage.errorCode,
   providerStatus: typeof result.status === 'string' && /^[a-z_]{1,40}$/.test(result.status) ? result.status : 'unrecognized',
   providerType: typeof result.type === 'string' && /^[a-z0-9_]{1,64}$/.test(result.type) ? result.type : 'unrecognized',
   outputShape: shape(result.output), credits: cost(result.credits_consumed), providerURLsOutput: false, generationRequests: 0 };
 };
 const recover = async (trialId: string) => {
  await withLock(trialId, async () => {
   const job = await load(trialId);
   ensure(job.viewsStage.state === 'failed' && job.viewsStage.taskId && job.modelStage.state === 'pending' && !job.approvedViewsSha256 && !job.rejectedAt && ['PROVIDER_RESPONSE_INVALID', 'PROVIDER_DOWNLOAD_FAILED'].includes(job.viewsStage.errorCode || ''), 'TRIAL_RECOVERY_DENIED', 409);
   const response = await json('tripo', `/tasks/${encodeURIComponent(providerId(job.viewsStage.taskId))}`);
   ensure(response.status === 'success', 'TRIAL_RECOVERY_DENIED', 409); tripoMultiviewOutput(response);
   ensure(job.viewsStage.credits !== undefined && cost(response.credits_consumed) === job.viewsStage.credits, 'TRIAL_RECOVERY_COST_MISMATCH', 409);
   const restore = deps.restore || budget.restore;
   await restore(trialId, job.viewsStage.credits);
   job.viewsStage.state = 'processing'; delete job.viewsStage.errorCode; await save(job);
  });
  return poll(trialId);
 };
 return { create, poll, approve, reject, inspect, recover };
}
