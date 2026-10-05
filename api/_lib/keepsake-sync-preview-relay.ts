import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, ensure } from './rules.js';

type PreviewService = 'giftportals' | 'instant-cloud';
type Request = IncomingMessage & { body?: unknown };
const relayUrl = 'https://oqmzwznadfuxybtstzzz.supabase.co/functions/v1/gp-keepsake-sync-preview-20261005';
const methods: Record<string, string> = {
  status: 'GET', demo: 'GET', login: 'POST', signup: 'POST', refresh: 'POST', world: 'GET',
  'keepsakes-list': 'GET', 'keepsakes-save': 'POST', 'keepsakes-remove': 'POST',
};
const maxResponseBytes = 1024 * 1024;

function requestOrigin(req: Request, env: NodeJS.ProcessEnv): string {
  const origins = [env.VERCEL_BRANCH_URL, env.VERCEL_URL]
    .filter((value): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]*\.vercel\.app$/i.test(value))
    .map(value => `https://${value.toLowerCase()}`);
  const origin = origins.find(value => new URL(value).host === req.headers.host);
  ensure(origin, 'ORIGIN_DENIED', 403);
  if (req.headers.origin !== undefined) ensure(req.headers.origin === origin, 'ORIGIN_DENIED', 403);
  ensure(req.headers['sec-fetch-site'] !== 'cross-site', 'ORIGIN_DENIED', 403);
  if (req.method !== 'GET') ensure(req.headers.origin === origin, 'ORIGIN_DENIED', 403);
  return origin;
}
async function responseJSON(response: Response): Promise<Record<string, any>> {
  ensure(/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || ''), 'KEEPSAKE_SYNC_UNAVAILABLE', 503);
  const reader = response.body?.getReader();
  ensure(reader, 'KEEPSAKE_SYNC_UNAVAILABLE', 503);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxResponseBytes) { await reader.cancel(); throw new AppError('KEEPSAKE_SYNC_UNAVAILABLE', 503); }
      chunks.push(next.value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    ensure(value && typeof value === 'object' && !Array.isArray(value) && typeof value.ok === 'boolean', 'KEEPSAKE_SYNC_UNAVAILABLE', 503);
    if (value.ok) { ensure(response.ok && Object.hasOwn(value, 'data'), 'KEEPSAKE_SYNC_UNAVAILABLE', 503); return { ok: true, data: value.data }; }
    ensure(value.error && typeof value.error.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value.error.code) && typeof value.error.message === 'string' && value.error.message.length <= 320 && !response.ok, 'KEEPSAKE_SYNC_UNAVAILABLE', 503);
    return { ok: false, error: { code: value.error.code, message: value.error.message } };
  } catch { throw new AppError('KEEPSAKE_SYNC_UNAVAILABLE', 503, 'The account preview could not be reached. Your device references remain available.'); }
  finally { reader.releaseLock(); }
}

/** Only the isolated Vercel preview can relay to the newly-created Edge service.
 * A fixed URL and action allowlist prevent this from becoming a generic proxy. */
export async function tryKeepsakeSyncPreviewRelay(req: Request, res: Pick<ServerResponse, 'setHeader' | 'statusCode' | 'end'>, service: PreviewService, fetcher: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (env.VERCEL_ENV !== 'preview' || env.ENABLE_KEEPSAKE_SYNC !== 'true' || !env.KEEPSAKE_SYNC_RELAY_URL) return false;
  ensure(env.KEEPSAKE_SYNC_RELAY_URL === relayUrl && typeof env.KEEPSAKE_SYNC_RELAY_KEY === 'string' && env.KEEPSAKE_SYNC_RELAY_KEY.length >= 32 && env.KEEPSAKE_SYNC_RELAY_KEY.length <= 256 && typeof env.SUPABASE_ANON_KEY === 'string' && env.SUPABASE_ANON_KEY.length >= 20, 'KEEPSAKE_SYNC_UNAVAILABLE', 503, 'Account sync is unavailable in this preview.');
  const origin = requestOrigin(req, env), query = new URL(req.url || '/', origin).searchParams;
  ensure(!query.has('service'), 'INVALID_BODY');
  const action = query.get('action') || 'status';
  // Instant status remains the existing paused service; every mutating action
  // is denied here even if future preview environment variables contain keys.
  if (service === 'instant-cloud' && action === 'status') return false;
  const expected = service === 'giftportals' ? methods[action] : ['job', 'snapshot'].includes(action) ? 'GET' : undefined;
  ensure(expected, 'PREVIEW_READ_ONLY', 403, 'This preview cannot start generation or change existing memories.');
  ensure(req.method === expected, 'METHOD_NOT_ALLOWED', 405);
  const headers: Record<string, string> = {
    apikey: env.SUPABASE_ANON_KEY,
    'X-GiftPortals-Relay-Key': env.KEEPSAKE_SYNC_RELAY_KEY,
    'X-GiftPortals-Preview-Host': req.headers.host as string,
    'X-GiftPortals-Preview-Origin': typeof req.headers.origin === 'string' ? req.headers.origin : '',
    'X-GiftPortals-Preview-Site': typeof req.headers['sec-fetch-site'] === 'string' ? req.headers['sec-fetch-site'] : '',
  };
  if (req.headers.authorization !== undefined) {
    ensure(typeof req.headers.authorization === 'string' && /^Bearer [^\r\n]{1,8192}$/.test(req.headers.authorization), 'INVALID_SESSION', 401);
    headers.Authorization = req.headers.authorization;
  }
  if (req.headers['x-instant-token'] !== undefined) {
    ensure(typeof req.headers['x-instant-token'] === 'string' && /^[A-Za-z0-9_-]{43}$/.test(req.headers['x-instant-token']), 'GIFT_UNAVAILABLE', 404);
    headers['X-Instant-Token'] = req.headers['x-instant-token'];
  }
  let body: string | undefined;
  if (expected === 'POST') {
    ensure(typeof req.headers['content-type'] === 'string' && /^application\/json(?:;|$)/i.test(req.headers['content-type']), 'INVALID_BODY');
    let value = req.body;
    if (typeof value === 'string') { ensure(Buffer.byteLength(value) <= 16384, 'BODY_TOO_LARGE', 413); try { value = JSON.parse(value); } catch { throw new AppError('INVALID_JSON'); } }
    ensure(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_BODY');
    body = JSON.stringify(value); ensure(Buffer.byteLength(body) <= 16384, 'BODY_TOO_LARGE', 413); headers['Content-Type'] = 'application/json';
  }
  query.set('service', service);
  try {
    const remote = await fetcher(`${relayUrl}?${query}`, { method: expected, headers, ...(body === undefined ? {} : { body }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25000) });
    const result = await responseJSON(remote);
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.statusCode = remote.status; res.end(JSON.stringify(result)); return true;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('KEEPSAKE_SYNC_UNAVAILABLE', 503, 'The account preview could not be reached. Your device references remain available.');
  }
}
