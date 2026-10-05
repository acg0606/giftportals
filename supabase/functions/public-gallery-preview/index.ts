// Preview-only server bridge. Secret substitutions stay outside Git.
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createCloudInstantHandler } from '../../../api/instant-cloud.js';
import { createInstantGalleryHandler, instantGalleryService } from '../../../api/instant-gallery.js';
import { createCloudInstantService } from '../../../api/_lib/cloud-instant-service.js';
import { createCloudInstantRepository, createCloudProviderAdapter } from '../../../api/_lib/cloud-instant-adapters.js';
import { AppError, ensure, secretMatches, giftHash } from '../../../api/_lib/rules.js';
import { PUBLIC_GALLERY_CONSENT_VERSION } from '../../../shared/instant-gallery.js';
import type { CloudJob, CloudSafetyImage, CloudSafetyReport } from '../../../api/_lib/cloud-instant-types.js';

const relayKey = '__PREVIEW_RELAY_KEY__';
const moderationKey = '__PREVIEW_MODERATION_KEY__';
const internalOrigin = 'https://preview.giftportals.invalid';
Object.assign(globalThis, { process, Buffer });
Object.defineProperty(process, 'env', { configurable: true, writable: true, value: {
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  TRIPO_API_KEY: '__PREVIEW_TRIPO_KEY__', WORLD_LABS_API_KEY: '__PREVIEW_WORLDLABS_KEY__',
  CLOUD_DEDUPE_SECRET: '__PREVIEW_DEDUPE_KEY__', CRON_SECRET: '__PREVIEW_CRON_KEY__',
  GIFTPORTALS_CLOUD_ORIGIN: internalOrigin,
  ENABLE_PUBLIC_GALLERY: 'true', ENABLE_CLOUD_GENERATION: 'true', VERCEL_ENV: 'development',
} });
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
});
const belongs = (job: CloudJob) => job.document.photoIntent === 'place'
  && job.document.publicGalleryConsent === true
  && job.document.publicGalleryConsentVersion === PUBLIC_GALLERY_CONSENT_VERSION;

function callback(request: Request): { endpoint: string; cookie?: string } {
  const raw = request.headers.get('x-giftportals-preview-callback');
  let url: URL | undefined; try { url = raw ? new URL(raw) : undefined; } catch { /* Closed gate. */ }
  ensure(url?.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
    && url.pathname === '/api/cloud-vision'
    && /^giftportals-[a-z0-9-]+-acg0606s-projects\.vercel\.app$/.test(url.hostname), 'PREVIEW_CALLBACK_DENIED', 403);
  const cookie = request.headers.get('x-giftportals-preview-cookie') || undefined;
  ensure(!cookie || /^_vercel_jwt=[A-Za-z0-9._~-]{1,8192}$/.test(cookie), 'PREVIEW_CALLBACK_DENIED', 403);
  return { endpoint: url.href, cookie };
}

Deno.serve(async request => {
  try {
    ensure(secretMatches(request.headers.get('x-giftportals-relay-key'), relayKey), 'RELAY_DENIED', 403);
    const url = new URL(request.url), service = url.searchParams.get('service');
    ensure(service === 'instant-cloud' || service === 'public-gallery', 'ACTION_UNAVAILABLE', 404);
    url.searchParams.delete('service');
    const action = url.searchParams.get('action') || (service === 'public-gallery' ? 'list' : 'status');
    const deadline = Date.now() + 130000;
    let body: any;
    if (request.method === 'POST') {
      const raw = await request.text(); ensure(Buffer.byteLength(raw) <= 16384, 'BODY_TOO_LARGE', 413);
      try { body = JSON.parse(raw); } catch { throw new AppError('INVALID_JSON'); }
      ensure(body && typeof body === 'object' && !Array.isArray(body), 'INVALID_BODY');
    }
    const owner = request.headers.get('x-giftportals-preview-owner') || '';
    ensure(!owner || /^__Host-gp_instant_owner=[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(owner), 'ORIGIN_DENIED', 403);
    const headers = { host: 'preview.giftportals.invalid', origin: internalOrigin, 'sec-fetch-site': 'same-origin',
      'content-type': 'application/json', 'x-instant-token': request.headers.get('x-instant-token') || '',
      cookie: owner };
    let statusCode = 200, payload = ''; const outgoing = new Headers({ 'Cache-Control': 'no-store' });
    const response = { get statusCode() { return statusCode; }, set statusCode(value) { statusCode = value; },
      setHeader(name: string, value: string) { outgoing.set(name, value); }, end(value: string) { payload = value; } };
    if (service === 'public-gallery') {
      ensure(request.method === 'GET' && ['list','gift'].includes(action), 'METHOD_NOT_ALLOWED', 405);
      await createInstantGalleryHandler(instantGalleryService(deadline))({ url: `/api/instant-gallery?${url.searchParams}`, method: 'GET', headers }, response);
    } else {
      ensure(request.method === (['status','job','world-diagnostics'].includes(action) ? 'GET' : 'POST')
        && ['status','prepare','finalize','advance','job','world-diagnostics'].includes(action), 'METHOD_NOT_ALLOWED', 405);
      if (action === 'prepare') ensure(body?.photoIntent === 'place' && body.publicGalleryConsent === true
        && body.publicGalleryConsentVersion === PUBLIC_GALLERY_CONSENT_VERSION, 'PUBLIC_GALLERY_CONSENT_REQUIRED', 422);
      const target = callback(request), base = createCloudInstantRepository(deadline);
      const checked = async (job: Promise<CloudJob>) => { const value = await job; ensure(belongs(value), 'JOB_UNAVAILABLE', 404); return value; };
      const repository = { ...base, get: (id: string, hash: string) => checked(base.get(id, hash)),
        lookup: (hash: string, tokenHash: string) => checked(base.lookup(hash, tokenHash)),
        worldRetryOwner: async () => false,
        claim: async (workerId: string, id?: string) => { ensure(id && id === body?.id, 'JOB_UNAVAILABLE', 404);
          await checked(base.get(id, giftHash(headers['x-instant-token'])));
          const value = await base.claim(workerId, id); ensure(!value || belongs(value), 'JOB_UNAVAILABLE', 404); return value; } };
      // Endpoint and cookie belong to this request. Concurrent requests cannot
      // alter another request's moderation destination or authentication.
      const moderator = { configured: true, async screen(images: CloudSafetyImage[]): Promise<CloudSafetyReport> {
        const values = []; for (const image of images) values.push({ id: image.id, mime: image.mime, bytes: image.bytes.length,
          sha256: image.sha256, imageUrl: await repository.signModerationRead(image) });
        const result = await fetch(target.endpoint, { method: 'POST', redirect: 'error',
          headers: { Authorization: `Bearer ${moderationKey}`, 'Content-Type': 'application/json', ...(target.cookie ? { Cookie: target.cookie } : {}) },
          body: JSON.stringify({ protocol: 'giftportals-cloud-vision-v1', images: values }),
          signal: AbortSignal.timeout(Math.max(1000, Math.min(90000, deadline - Date.now() - 10000))) });
        ensure(result.ok, 'PHOTO_SAFETY_UNAVAILABLE', 503); const raw = await result.text();
        ensure(raw.length <= 65536, 'PHOTO_SAFETY_UNAVAILABLE', 503); const report = JSON.parse(raw);
        ensure(report?.modelVersion === 'giftportals-local-vision-v1:clip-text-q8+clip-vision-fp32+vit-nsfw-q8:policy-3', 'PHOTO_SAFETY_UNAVAILABLE', 503);
        return report;
      } };
      const active = createCloudInstantService({ repository, providers: createCloudProviderAdapter(deadline), moderator,
        gallery: instantGalleryService(deadline), settings: () => ({ enabled: true, providers: { tripo: true, worldlabs: true }, dedupeSecret: process.env.CLOUD_DEDUPE_SECRET! }) });
      await createCloudInstantHandler(active)({ url: `/api/instant-cloud?${url.searchParams}`, method: request.method, headers, body }, response);
    }
    return new Response(payload, { status: statusCode, headers: outgoing });
  } catch (error) {
    const safe = error instanceof AppError ? error : new AppError('PREVIEW_REQUEST_FAILED', 503);
    return reply({ ok: false, error: { code: safe.code, message: 'The preview request could not be completed.' } }, safe.status);
  }
});
