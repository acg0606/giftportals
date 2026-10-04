import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, ensure } from './_lib/rules.js';
import { assertLocalInstantRequest, createInstantService, MAX_INSTANT_BODY_BYTES } from './_lib/instant.js';
// A service retained from before the souvenir pipeline must never accept a new create or resume.
// Keep that older instance untouched so already submitted background work can finish.
const key = Symbol.for('giftportals.instant.service.souvenir.v17');
const shared = globalThis as typeof globalThis & { [key]?: ReturnType<typeof createInstantService> };
const service = shared[key] ||= createInstantService();
// HMR keeps the paid job service alive; a current helper may improve already completed outputs using GET only.
const qualityService = createInstantService();
export const config = { maxDuration: 60 };
type Request = IncomingMessage & { body?: unknown };
const retainedErrorStatus: Record<string, number> = {
 JOB_UNAVAILABLE: 404, ASSET_UNAVAILABLE: 404, INVALID_TEXT: 400, IMAGE_CONTENT_INVALID: 400,
 IMAGE_TYPE_INVALID: 400, IMAGE_SIZE_LIMIT: 413, REQUEST_TOKEN_INVALID: 400,
 GENERATION_CONSENT_REQUIRED: 400, GENERATION_PAUSED: 503, DEDUPE_MISMATCH: 409,
 JOB_ALREADY_CREATED: 409, GENERATION_QUEUE_FULL: 429, LOCAL_GENERATION_BUDGET: 429,
 PHOTO_INTENT_INVALID:400,PLACE_OBJECT_IMAGE_REQUIRED:400,PLACE_OBJECT_IMAGE_INVALID:400,TOTAL_IMAGE_SIZE_LIMIT:413,
 PHOTO_SAFETY_UNAVAILABLE:503,PHOTO_SAFETY_REQUIRED:503,PHOTO_SAFETY_BLOCKED:422,PHOTO_SAFETY_REVIEW_REQUIRED:422,
 CURIOSITY_IDS_INVALID:400,
 EXAMPLE_ID_INVALID:400,
 LOCAL_CREDIT_CAP_INVALID:503,
 OBJECT_IMAGE_ROLE_INVALID:400,PLACE_OBJECT_IMAGE_ROLE_REQUIRED:400,PLACE_REFERENCE_TYPE_UNSUPPORTED:400,LOCAL_LEDGER_BUSY:409,
};
export function safeInstantError(error: unknown): AppError {
 if (error instanceof AppError) return error;
 // Vite reloads constructors while the durable in-process service remains alive. Accept
 // only a bounded legacy AppError code/status pair and replace its diagnostic message.
 if (error instanceof Error && error.constructor.name === 'AppError') {
  const legacy = error as Error & { code?: unknown; status?: unknown };
  if (typeof legacy.code === 'string' && Object.hasOwn(retainedErrorStatus, legacy.code) && legacy.status === retainedErrorStatus[legacy.code]) {
   return new AppError(legacy.code, retainedErrorStatus[legacy.code], legacy.code === 'JOB_UNAVAILABLE' || legacy.code === 'ASSET_UNAVAILABLE' ? 'This gift is unavailable.' : 'The request could not be completed.');
  }
 }
 return new AppError('LOCAL_GENERATION_FAILED', 500, 'The local generation request failed. Your original photo is preserved.');
}
export default async function handler(req: Request, res: ServerResponse) {
 res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
 try {
  assertLocalInstantRequest(req);
  const query = new URL(req.url || '/api/instant', 'http://localhost').searchParams, action = query.get('action') || 'status';
  let data: unknown;
  if (action === 'status') { ensure(req.method === 'GET', 'METHOD_NOT_ALLOWED', 405); data = await qualityService.status(); }
  else if (action === 'create' || action === 'triage') {
   ensure(req.method === 'POST', 'METHOD_NOT_ALLOWED', 405); let value = req.body;
   if (typeof value === 'string') { ensure(Buffer.byteLength(value) <= MAX_INSTANT_BODY_BYTES, 'BODY_TOO_LARGE', 413); try { value = JSON.parse(value); } catch { throw new AppError('INVALID_JSON'); } }
   ensure(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_BODY'); data = action==='triage'?await qualityService.triage(value):await service.create(value);
  } else if (action === 'snapshot') {
   ensure(req.method === 'GET', 'METHOD_NOT_ALLOWED', 405);
   data = await qualityService.snapshot(query.get('id'), req.headers['x-instant-token']);
  } else if (action === 'job') {
   ensure(req.method === 'GET', 'METHOD_NOT_ALLOWED', 405);
   const result = query.get('id') ? await service.get(query.get('id'), req.headers['x-instant-token']) : await service.resume(query.get('dedupeKey'), req.headers['x-instant-token']);
   data = result.worldlabs.state === 'completed' ? await qualityService.enhanceWorld(result.id, req.headers['x-instant-token']) : result;
   if(result.worldlabs.state==='completed')data=await qualityService.enhanceCollider(result.id,req.headers['x-instant-token']);
  }
  else if (action === 'asset') {
   ensure(req.method === 'GET', 'METHOD_NOT_ALLOWED', 405); const asset = await qualityService.asset(query.get('id'), query.get('token'), query.get('name'));
   res.setHeader('Content-Type', asset.mime); res.setHeader('Content-Length', asset.bytes.length); res.statusCode = 200; res.end(asset.bytes); return;
  } else throw new AppError('ACTION_UNAVAILABLE', 404);
  res.statusCode = 200; res.end(JSON.stringify({ ok: true, data }));
 } catch (error) {
  const safe = safeInstantError(error);
  res.statusCode = safe.status; res.end(JSON.stringify({ ok: false, error: { code: safe.code, message: safe.message } }));
 }
}
