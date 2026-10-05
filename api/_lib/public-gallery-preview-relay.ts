import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, ensure, uuid } from './rules.js';

type PreviewService = 'instant-cloud' | 'public-gallery';
type Request = IncomingMessage & { body?: unknown };
const relayUrl = 'https://oqmzwznadfuxybtstzzz.supabase.co/functions/v1/gp-public-gallery-preview-20261005';
const previewBranch = 'codex/public-keepsake-gallery';
const consentVersion = 'giftportals-public-gallery-v1';
const maxBodyBytes = 16_384, maxResponseBytes = 1024 * 1024;
export const PUBLIC_GALLERY_PREVIEW_TIMEOUT_MS = 145_000;
const instantMethods: Record<string, string> = {
  status: 'GET', prepare: 'POST', finalize: 'POST', advance: 'POST', job: 'GET', 'world-diagnostics': 'GET',
};
const galleryMethods: Record<string, string> = { list: 'GET', gift: 'GET' };
const ownerName = '__Host-gp_instant_owner';
const ownerValue = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;
const unavailable = () => new AppError('PUBLIC_GALLERY_PREVIEW_UNAVAILABLE', 503, 'The landscape preview could not be reached. Please try again.');

function platformHost(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 253 && value.endsWith('.vercel.app')
    && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
function requestOrigin(req: Request, env: NodeJS.ProcessEnv): string {
  const hosts = [env.VERCEL_BRANCH_URL, env.VERCEL_URL].filter(platformHost);
  ensure(typeof req.headers.host === 'string' && hosts.includes(req.headers.host), 'ORIGIN_DENIED', 403);
  const origin = `https://${req.headers.host}`;
  if (req.headers.origin !== undefined) ensure(req.headers.origin === origin, 'ORIGIN_DENIED', 403);
  const site = req.headers['sec-fetch-site'];
  ensure(site === undefined || typeof site === 'string' && ['same-origin', 'same-site', 'none'].includes(site), 'ORIGIN_DENIED', 403);
  if (req.method !== 'GET') ensure(req.headers.origin === origin, 'ORIGIN_DENIED', 403);
  return origin;
}
/** Only the deployment-protection cookie and the existing anonymous owner may
 * leave this server. The Edge callback must use the fixed origin below, keep
 * this cookie request-scoped, and never persist or log it. */
function previewCookies(value: unknown): { protection?: string; owner?: string } {
  if (value === undefined) return {};
  ensure(typeof value === 'string' && Buffer.byteLength(value) <= 16_384 && !/[\r\n\x00]/.test(value), 'INVALID_PREVIEW_COOKIE', 400);
  const selected = new Map<string, string>();
  for (const part of value.split(';')) {
    const separator = part.indexOf('='); if (separator < 0) continue;
    const name = part.slice(0, separator).trim(); if (name !== '_vercel_jwt' && name !== ownerName) continue;
    ensure(!selected.has(name), 'INVALID_PREVIEW_COOKIE');
    const raw = part.slice(separator + 1).trim();
    ensure(name === ownerName ? ownerValue.test(raw)
      : raw.length <= 8192 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw), 'INVALID_PREVIEW_COOKIE');
    selected.set(name, raw);
  }
  return {
    ...(selected.has('_vercel_jwt') ? { protection: `_vercel_jwt=${selected.get('_vercel_jwt')}` } : {}),
    ...(selected.has(ownerName) ? { owner: `${ownerName}=${selected.get(ownerName)}` } : {}),
  };
}
function requestBody(req: Request): Record<string, unknown> {
  ensure(typeof req.headers['content-type'] === 'string' && /^application\/json(?:;|$)/i.test(req.headers['content-type']), 'INVALID_BODY');
  let value = req.body;
  if (typeof value === 'string') {
    ensure(Buffer.byteLength(value) <= maxBodyBytes, 'BODY_TOO_LARGE', 413);
    try { value = JSON.parse(value); } catch { throw new AppError('INVALID_JSON'); }
  }
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_BODY');
  let serialized: string; try { serialized = JSON.stringify(value); } catch { throw new AppError('INVALID_BODY'); }
  ensure(Buffer.byteLength(serialized) <= maxBodyBytes, 'BODY_TOO_LARGE', 413);
  return value as Record<string, unknown>;
}
function checkedQuery(query: URLSearchParams, service: PreviewService, action: string): void {
  const allowed = service === 'public-gallery' ? action === 'gift' ? ['action', 'id'] : ['action', 'limit', 'cursor']
    : action === 'job' ? ['action', 'id', 'dedupeKey']
      : ['finalize', 'advance', 'world-diagnostics'].includes(action) ? ['action', 'id'] : ['action'];
  ensure([...query.keys()].every(key => allowed.includes(key) && query.getAll(key).length === 1), 'INVALID_BODY');
  if (query.has('id')) uuid(query.get('id'));
  if (service === 'instant-cloud' && action === 'job') {
    ensure(query.has('id') !== query.has('dedupeKey'), 'INVALID_BODY');
    if (query.has('dedupeKey')) ensure(/^[A-Za-z0-9_-]{8,120}$/.test(query.get('dedupeKey')!), 'REQUEST_TOKEN_INVALID');
  }
  if (action === 'gift' || action === 'world-diagnostics') uuid(query.get('id'));
}
async function responseJSON(response: Response): Promise<Record<string, unknown>> {
  ensure(/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || ''), 'PUBLIC_GALLERY_PREVIEW_UNAVAILABLE', 503);
  const reader = response.body?.getReader(); ensure(reader, 'PUBLIC_GALLERY_PREVIEW_UNAVAILABLE', 503);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxResponseBytes) { await reader.cancel(); throw unavailable(); }
      chunks.push(next.value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    ensure(value && typeof value === 'object' && !Array.isArray(value) && typeof value.ok === 'boolean', 'PUBLIC_GALLERY_PREVIEW_UNAVAILABLE', 503);
    if (value.ok) { ensure(response.ok && Object.hasOwn(value, 'data'), 'PUBLIC_GALLERY_PREVIEW_UNAVAILABLE', 503); return { ok: true, data: value.data }; }
    ensure(!response.ok && value.error && typeof value.error.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value.error.code)
      && typeof value.error.message === 'string' && value.error.message.length <= 320, 'PUBLIC_GALLERY_PREVIEW_UNAVAILABLE', 503);
    return { ok: false, error: { code: value.error.code, message: value.error.message } };
  } catch { throw unavailable(); }
  finally { reader.releaseLock(); }
}
function responseOwnerCookie(response: Response): string | undefined {
  const cookies = response.headers.getSetCookie();
  const owners = cookies.filter(value => value.startsWith(`${ownerName}=`));
  ensure(owners.length <= 1, 'PUBLIC_GALLERY_PREVIEW_UNAVAILABLE', 503);
  if (!owners.length) return;
  // Rebuild the sole supported cookie instead of forwarding arbitrary upstream
  // attributes, domains, protection cookies, or authentication sessions.
  const match = /^__Host-gp_instant_owner=([A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}); Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000$/.exec(owners[0]);
  ensure(match, 'PUBLIC_GALLERY_PREVIEW_UNAVAILABLE', 503);
  return `${ownerName}=${match[1]}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`;
}

/** A preview-only adapter, never a general proxy or production fallback.
 * The Edge repository must independently reject every mutation/advance of a
 * job without immutable public consent and membership in this preview. */
export async function tryPublicGalleryPreviewRelay(req: Request, res: Pick<ServerResponse, 'setHeader' | 'statusCode' | 'end'>,
  service: PreviewService, fetcher: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (env.VERCEL_ENV !== 'preview' || env.ENABLE_PUBLIC_GALLERY !== 'true' || !env.PUBLIC_GALLERY_PREVIEW_RELAY_URL) return false;
  ensure(env.VERCEL_GIT_COMMIT_REF === previewBranch && env.PUBLIC_GALLERY_PREVIEW_RELAY_URL === relayUrl
    && typeof env.PUBLIC_GALLERY_PREVIEW_RELAY_KEY === 'string' && /^[A-Za-z0-9._-]{32,256}$/.test(env.PUBLIC_GALLERY_PREVIEW_RELAY_KEY)
    && typeof env.SUPABASE_ANON_KEY === 'string' && /^[A-Za-z0-9._-]{20,8192}$/.test(env.SUPABASE_ANON_KEY), 'PUBLIC_GALLERY_PREVIEW_UNAVAILABLE', 503);
  const origin = requestOrigin(req, env), url = new URL(req.url || '/', origin), query = url.searchParams;
  ensure(url.origin === origin && url.pathname === (service === 'instant-cloud' ? '/api/instant-cloud' : '/api/instant-gallery'), 'INVALID_BODY');
  const action = query.get('action') || (service === 'public-gallery' ? 'list' : 'status');
  const methods = service === 'instant-cloud' ? instantMethods : galleryMethods;
  const expected = Object.hasOwn(methods, action) ? methods[action] : undefined;
  ensure(expected, 'PREVIEW_ACTION_UNAVAILABLE', 403, 'This action is unavailable in the landscape preview.');
  ensure(req.method === expected, 'METHOD_NOT_ALLOWED', 405); checkedQuery(query, service, action);
  const headers: Record<string, string> = {
    apikey: env.SUPABASE_ANON_KEY,
    'X-GiftPortals-Relay-Key': env.PUBLIC_GALLERY_PREVIEW_RELAY_KEY,
    'X-GiftPortals-Preview-Host': req.headers.host as string,
    'X-GiftPortals-Preview-Origin': typeof req.headers.origin === 'string' ? req.headers.origin : '',
    'X-GiftPortals-Preview-Site': typeof req.headers['sec-fetch-site'] === 'string' ? req.headers['sec-fetch-site'] : '',
  };
  if (service === 'instant-cloud') {
    const cookies = previewCookies(req.headers.cookie);
    headers['X-GiftPortals-Preview-Callback'] = `${origin}/api/cloud-vision`;
    if (cookies.protection) headers['X-GiftPortals-Preview-Cookie'] = cookies.protection;
    if (cookies.owner) headers['X-GiftPortals-Preview-Owner'] = cookies.owner;
    if (!['status', 'prepare'].includes(action)) {
      ensure(typeof req.headers['x-instant-token'] === 'string' && /^[A-Za-z0-9_-]{43}$/.test(req.headers['x-instant-token']), 'GIFT_UNAVAILABLE', 404);
      headers['X-Instant-Token'] = req.headers['x-instant-token'];
    }
  }
  let body: string | undefined;
  if (expected === 'POST') {
    const value = requestBody(req);
    if (action === 'prepare') ensure(value.photoIntent === 'place' && value.publicGalleryConsent === true
      && value.publicGalleryConsentVersion === consentVersion, 'PUBLIC_GALLERY_CONSENT_REQUIRED', 403, 'Approve publishing this landscape before creating it in the preview.');
    else {
      const id = uuid(value.id); ensure(Object.keys(value).every(key => key === 'id') && (!query.has('id') || query.get('id') === id), 'INVALID_BODY');
    }
    body = JSON.stringify(value); headers['Content-Type'] = 'application/json';
  }
  query.set('service', service);
  try {
    const remote = await fetcher(`${relayUrl}?${query}`, {
      method: expected, headers, ...(body === undefined ? {} : { body }), redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(PUBLIC_GALLERY_PREVIEW_TIMEOUT_MS),
    });
    const result = await responseJSON(remote), ownerCookie = service === 'instant-cloud' ? responseOwnerCookie(remote) : undefined;
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (ownerCookie) res.setHeader('Set-Cookie', ownerCookie);
    res.statusCode = remote.status; res.end(JSON.stringify(result)); return true;
  } catch (error) { if (error instanceof AppError) throw error; throw unavailable(); }
}
