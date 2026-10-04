import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppError, ensure } from './rules.js';

export const IMAGE_SAFETY_PROTOCOL = 'giftportals-local-vision-v1';
export type ImageSafetyDecision = 'allow' | 'block' | 'review';
export type ImageSafetyCategory = 'ordinary' | 'sexual' | 'adult-product' | 'uncertain';
export type ImageObjectHint = 'clock' | 'ceramic' | 'camera' | 'book' | 'bird' | 'landscape' | 'keepsake' | 'unknown';
export interface ImageSafetyInput { id: 'original' | 'object' | 'world'; bytes: Buffer; mime: string }
export interface ImageSafetyResult {
 id: ImageSafetyInput['id']; sha256: string; decision: ImageSafetyDecision; category: ImageSafetyCategory;
 modelVersion: string; scores: { sexual: number; adultProduct: number }; objectHint?: ImageObjectHint; objectConfidence?: number;
}
export interface ImageSafetyStatus { available: boolean; localOnly: true; protocol: typeof IMAGE_SAFETY_PROTOCOL; modelVersion?: string; reason?: 'CLASSIFIER_UNAVAILABLE' }
export interface ImageSafetyReport { protocol: typeof IMAGE_SAFETY_PROTOCOL; checkedAt: string; modelVersion: string; decision: ImageSafetyDecision; results: ImageSafetyResult[] }
export interface ImageSafetyAdapter { status(): Promise<ImageSafetyStatus>; screen(images: ImageSafetyInput[]): Promise<ImageSafetyReport> }
interface WorkerRequest { id: string; imageDataUrl: string }
interface Dependencies { workerPath?: string; probe?: () => Promise<unknown>; run?: (request: WorkerRequest) => Promise<unknown>; now?: () => number }
const hints: ImageObjectHint[] = ['clock', 'ceramic', 'camera', 'book', 'bird', 'landscape', 'keepsake', 'unknown'];
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const unavailable = () => new AppError('PHOTO_SAFETY_UNAVAILABLE', 503, 'Photo checking is unavailable. Try again when the local checker is ready.');
const modelVersion = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\x00-\x1f\x7f]/.test(value);
const score = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function parseProbe(value: unknown): { modelVersion: string } {
 const probe = value as Record<string, unknown> | null;
 const categories=probe?.categories;
 if (!probe || probe.ready !== true || probe.protocol !== IMAGE_SAFETY_PROTOCOL || !modelVersion(probe.modelVersion) || !Array.isArray(categories) || !['sexual', 'adult-product'].every(category => categories.includes(category))) throw unavailable();
 return { modelVersion: probe.modelVersion };
}

// The classifier receives no provider credentials and performs no remote inference.
// Keep model setup separate: a missing local manifest/model is a closed gate.
function workerEnvironment(): NodeJS.ProcessEnv {
 const result: NodeJS.ProcessEnv = {};
 for (const name of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'GIFTPORTALS_VISION_MODEL_DIR']) if (process.env[name]) result[name] = process.env[name];
 result.HF_HUB_OFFLINE = '1'; result.TRANSFORMERS_OFFLINE = '1';
 return result;
}
async function validWorker(path: string) {
 const info = await stat(path);
 if (!info.isFile() || info.size < 1 || info.size > 256 * 1024 || !/\.(?:mjs|js)$/.test(path)) throw unavailable();
}
function probeWorker(path: string): Promise<unknown> {
 return new Promise((resolveProbe, reject) => {
  execFile(process.execPath, [path, '--probe'], { timeout: 10000, maxBuffer: 8192, windowsHide: true, env: workerEnvironment() }, (error, stdout) => {
   if (error) { reject(unavailable()); return; }
   try { resolveProbe(JSON.parse(stdout.trim())); } catch { reject(unavailable()); }
  });
 });
}
interface ResidentWorker {
 path: string; child?: ChildProcessWithoutNullStreams; queue: Promise<unknown>; queued: number;
 pending?: { id: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
 stdout: string;
}
const workersKey = Symbol.for('giftportals.image-safety.workers.v1');
const shared = globalThis as typeof globalThis & { [workersKey]?: Map<string, ResidentWorker> };
const workers = shared[workersKey] ||= new Map<string, ResidentWorker>();
function stopWorker(worker: ResidentWorker) {
 const child = worker.child; worker.child = undefined; worker.stdout = '';
 if (worker.pending) { const pending = worker.pending; worker.pending = undefined; clearTimeout(pending.timer); pending.reject(unavailable()); }
 if (child && !child.killed) child.kill();
}
function residentWorker(path: string): ResidentWorker {
 let worker = workers.get(path);
 if (!worker) { worker = { path, queue: Promise.resolve(), queued: 0, stdout: '' }; workers.set(path, worker); }
 return worker;
}
function startWorker(worker: ResidentWorker) {
 if (worker.child) return;
 const child = spawn(process.execPath, [worker.path], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: workerEnvironment() });
 worker.child = child; worker.stdout = '';
 // Diagnostic stderr is discarded; never echo model input or private bytes.
 child.stderr.on('data', () => undefined);
 child.on('error', () => { if (worker.child === child) stopWorker(worker); });
 child.on('exit', () => { if (worker.child === child) stopWorker(worker); });
 child.stdin.on('error', () => { if (worker.child === child) stopWorker(worker); });
 child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk: string) => {
  if (worker.child !== child) return;
  worker.stdout += chunk;
  if (worker.stdout.length > 64 * 1024) { stopWorker(worker); return; }
  let end: number;
  while ((end = worker.stdout.indexOf('\n')) !== -1) {
   const line = worker.stdout.slice(0, end); worker.stdout = worker.stdout.slice(end + 1);
   let value: { id?: unknown }; try { value = JSON.parse(line); } catch { stopWorker(worker); return; }
   const pending = worker.pending;
   if (!pending || value?.id !== pending.id) { stopWorker(worker); return; }
   worker.pending = undefined; clearTimeout(pending.timer); pending.resolve(value);
  }
 });
}
function requestWorker(path: string, request: WorkerRequest): Promise<unknown> {
 const worker = residentWorker(path);
 if (worker.queued >= 4) return Promise.reject(unavailable());
 worker.queued++;
 const result = worker.queue.catch(() => undefined).then(() => new Promise<unknown>((resolveResponse, reject) => {
  startWorker(worker);
  worker.pending = { id: request.id, resolve: resolveResponse, reject, timer: setTimeout(() => stopWorker(worker), 60000) };
  worker.child!.stdin.write(JSON.stringify(request) + '\n', error => { if (error) stopWorker(worker); });
 }));
 worker.queue = result; void result.finally(() => { worker.queued--; }).catch(() => undefined);
 return result;
}
export function assertImageSafetyAllowed(report: ImageSafetyReport): void {
 if(!Array.isArray(report.results)||!report.results.length)throw unavailable();
 if (report.decision === 'block'||report.results.some(result=>result.decision==='block')) throw new AppError('PHOTO_SAFETY_BLOCKED', 422, 'Choose a photo without intimate imagery or adult products. This photo was not saved or sent.');
 if (report.decision !== 'allow'||report.results.some(result=>result.decision!=='allow'||result.category!=='ordinary')) throw new AppError('PHOTO_SAFETY_REVIEW_REQUIRED', 422, 'The photo checker is unsure. Choose a clearer, ordinary photo. This photo was not saved or sent.');
}

export function createImageSafetyAdapter(deps: Dependencies = {}): ImageSafetyAdapter {
 const path = resolve(deps.workerPath || process.env.GIFTPORTALS_IMAGE_SAFETY_WORKER || 'tools/local-vision-worker.mjs'), now = deps.now || Date.now;
 let cached: { at: number; result: ImageSafetyStatus } | undefined;
 const status = async (): Promise<ImageSafetyStatus> => {
  if (cached && now() - cached.at < 5000) return cached.result;
  let result: ImageSafetyStatus;
  try { if (!deps.probe) await validWorker(path); const probe = parseProbe(await (deps.probe ? deps.probe() : probeWorker(path))); result = { available: true, localOnly: true, protocol: IMAGE_SAFETY_PROTOCOL, modelVersion: probe.modelVersion }; }
  catch { result = { available: false, localOnly: true, protocol: IMAGE_SAFETY_PROTOCOL, reason: 'CLASSIFIER_UNAVAILABLE' }; }
  cached = { at: now(), result }; return result;
 };
 const screen = async (images: ImageSafetyInput[]): Promise<ImageSafetyReport> => {
  ensure(images.length >= 1 && images.length <= 3 && new Set(images.map(image => image.id)).size === images.length && images.every(image => ['original', 'object', 'world'].includes(image.id) && Buffer.isBuffer(image.bytes) && image.bytes.length > 0 && image.bytes.length <= 6 * 1024 * 1024 && ['image/jpeg', 'image/png', 'image/webp'].includes(image.mime)), 'IMAGE_CONTENT_INVALID');
  const ready = await status(); if (!ready.available) throw unavailable();
  const results: ImageSafetyResult[] = [], classified = new Map<string, Omit<ImageSafetyResult, 'id'>>();
  try {
   for (const image of images) {
    const digest = sha(image.bytes), known = classified.get(digest);
    if (known) { results.push({ ...known, id: image.id }); continue; }
    const request = { id: randomUUID(), imageDataUrl: `data:${image.mime};base64,${image.bytes.toString('base64')}` };
    const response = await (deps.run ? deps.run(request) : requestWorker(path, request)) as { id?: unknown; result?: Record<string, unknown>; error?: unknown };
    const result = response?.result;
    if (response?.id !== request.id || response.error || !result || !modelVersion(result.modelVersion) || result.modelVersion !== ready.modelVersion || !['allow', 'block', 'review'].includes(result.decision as string) || !['ordinary', 'sexual', 'adult-product', 'uncertain'].includes(result.category as string)) throw unavailable();
    const scores = result.scores as Record<string, unknown> | undefined;
    if (!scores || !score(scores.sexual) || !score(scores.adultProduct) || (result.decision === 'allow' && result.category !== 'ordinary') || (result.decision === 'block' && !['sexual', 'adult-product'].includes(result.category as string)) || (result.objectHint !== undefined && !hints.includes(result.objectHint as ImageObjectHint)) || (result.objectConfidence !== undefined && !score(result.objectConfidence))) throw unavailable();
    const safe: ImageSafetyResult = { id: image.id, sha256: digest, decision: result.decision as ImageSafetyDecision, category: result.category as ImageSafetyCategory, modelVersion: result.modelVersion, scores: { sexual: scores.sexual, adultProduct: scores.adultProduct } };
    // Suggestions are only exposed for an explicitly approved image.
    if (safe.decision === 'allow' && result.objectHint !== undefined) { safe.objectHint = result.objectHint as ImageObjectHint; if (result.objectConfidence !== undefined) safe.objectConfidence = result.objectConfidence as number; }
    results.push(safe); classified.set(digest, safe);
   }
  } catch { cached = undefined; if (!deps.run) stopWorker(residentWorker(path)); throw unavailable(); }
  return { protocol: IMAGE_SAFETY_PROTOCOL, checkedAt: new Date(now()).toISOString(), modelVersion: ready.modelVersion!, decision: results.some(result => result.decision === 'block') ? 'block' : results.some(result => result.decision !== 'allow') ? 'review' : 'allow', results };
 };
 return { status, screen };
}
