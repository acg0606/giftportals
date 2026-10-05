import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CloudJob } from './cloud-instant-types.js';
import { AppError, ensure, giftHash, uuid } from './rules.js';

export interface SyncedKeepsakeReference { id: string; token: string; expiresAt: number }
export interface KeepsakeSyncActor { id: string; demo: boolean }
export interface KeepsakeSyncSettings { bucket: string; key: Buffer; origin: string; allowedOrigins?: readonly string[] }
export interface KeepsakeSyncStorage {
  list(prefix: string, limit: number): Promise<string[]>;
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
  remove(path: string): Promise<void>;
}
export interface KeepsakeSyncDependencies {
  settings: KeepsakeSyncSettings;
  storage: KeepsakeSyncStorage;
  repository: { get(id: string, tokenHash: string): Promise<CloudJob> };
  now?: () => number;
}
export const MAX_SYNCED_KEEPSAKES = 100;
const MAX_RECORD_BYTES = 2048;
const protocol = 'giftportals-keepsake-sync-v1';

/** This experiment is closed in production even if a preview flag is copied. */
export function keepsakeSyncSettings(env: NodeJS.ProcessEnv = process.env): KeepsakeSyncSettings | undefined {
  if (env.ENABLE_KEEPSAKE_SYNC !== 'true' || env.VERCEL_ENV === 'production') return undefined;
  const bucket = env.KEEPSAKE_SYNC_BUCKET || '';
  if (!/^gp-keepsake-sync-[a-z0-9][a-z0-9-]{0,45}$/.test(bucket)) return undefined;
  const rawKey = env.KEEPSAKE_SYNC_ENCRYPTION_KEY || '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(rawKey)) return undefined;
  const key = Buffer.from(rawKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== rawKey) return undefined;
  const platformOrigins = env.VERCEL_ENV === 'preview' ? [env.VERCEL_BRANCH_URL, env.VERCEL_URL].filter((value): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]*\.vercel\.app$/i.test(value)).map(value => `https://${value}`) : [];
  const rawOrigin = env.KEEPSAKE_SYNC_ORIGIN || platformOrigins[0];
  try {
    const origin = new URL(rawOrigin || '');
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.port) return undefined;
    return { bucket, key, origin: origin.origin, allowedOrigins: [...new Set([origin.origin, ...platformOrigins])] };
  } catch { return undefined; }
}

export function assertKeepsakeSyncOrigin(req: Pick<IncomingMessage, 'headers' | 'method'>, settings: KeepsakeSyncSettings): void {
  const origins = settings.allowedOrigins || [settings.origin];
  const origin = origins.find(value => new URL(value).host === req.headers.host);
  ensure(origin, 'ORIGIN_DENIED', 403);
  if (req.headers.origin !== undefined) ensure(req.headers.origin === origin, 'ORIGIN_DENIED', 403);
  ensure(req.headers['sec-fetch-site'] !== 'cross-site', 'ORIGIN_DENIED', 403);
  if (req.method !== 'GET') ensure(req.headers.origin === origin, 'ORIGIN_DENIED', 403);
}

function actorId(actor: KeepsakeSyncActor): string {
  ensure(actor && !actor.demo, 'DEMO_READ_ONLY', 403, 'Sign in to your personal account to save gifts.');
  return uuid(actor.id).toLowerCase();
}
function recordPath(owner: string, id: string): string { return `${owner}/${id}.json`; }
function aad(owner: string, id: string): Buffer { return Buffer.from(`${protocol}:${owner}:${id}`); }
function seal(settings: KeepsakeSyncSettings, owner: string, reference: SyncedKeepsakeReference): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', settings.key, iv);
  cipher.setAAD(aad(owner, reference.id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(reference), 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
}
function decode(value: unknown, bytes?: number): Buffer {
  ensure(typeof value === 'string' && value.length <= MAX_RECORD_BYTES && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 'SYNC_RECORD_INVALID', 502);
  const decoded = Buffer.from(value, 'base64');
  ensure(decoded.toString('base64') === value && (bytes === undefined || decoded.length === bytes), 'SYNC_RECORD_INVALID', 502);
  return decoded;
}
function unseal(settings: KeepsakeSyncSettings, owner: string, id: string, contents: string): SyncedKeepsakeReference {
  try {
    ensure(Buffer.byteLength(contents) <= MAX_RECORD_BYTES, 'SYNC_RECORD_INVALID', 502);
    const record = JSON.parse(contents);
    ensure(record && record.version === 1 && Object.keys(record).every(key => ['version', 'iv', 'ciphertext', 'tag'].includes(key)), 'SYNC_RECORD_INVALID', 502);
    const decipher = createDecipheriv('aes-256-gcm', settings.key, decode(record.iv, 12));
    decipher.setAAD(aad(owner, id)); decipher.setAuthTag(decode(record.tag, 16));
    const reference = JSON.parse(Buffer.concat([decipher.update(decode(record.ciphertext)), decipher.final()]).toString('utf8'));
    ensure(reference && reference.id === id && Object.keys(reference).every(key => ['id', 'token', 'expiresAt'].includes(key)) && typeof reference.expiresAt === 'number' && Number.isFinite(reference.expiresAt), 'SYNC_RECORD_INVALID', 502);
    giftHash(reference.token);
    return { id, token: reference.token, expiresAt: reference.expiresAt };
  } catch { throw new AppError('SYNC_RECORD_INVALID', 502, 'A saved gift reference could not be verified.'); }
}

/** The same delivered-model gate as the instant creator; no provider calls. */
export function readyKeepsakeReference(job: CloudJob, id: string, token: string, now: number): SyncedKeepsakeReference {
  ensure(job && job.id === id, 'GIFT_UNAVAILABLE', 404);
  const expiry = Date.parse(job.expires_at || '') / 1000;
  ensure(Number.isFinite(expiry) && expiry > now / 1000 && job.state !== 'expired', 'JOB_EXPIRED', 404, 'This gift has expired.');
  const safety = job.document?.photoSafety;
  const approved = safety?.decision === 'allow' && Array.isArray(safety.results) && safety.results.length > 0 && safety.results.every(result => result.decision === 'allow' && result.category === 'ordinary');
  const delivered = ['completed', 'partial'].includes(job.state) || job.state === 'processing' && (job.document?.worldRetry?.attempt || 0) > 0;
  const model = job.assets?.model;
  ensure(approved && delivered && job.stages?.tripo?.state === 'completed' && model?.mime === 'model/gltf-binary' && Number.isInteger(model.bytes) && model.bytes > 0 && model.bytes <= 104857600 && new RegExp(`^${id}/generated/[a-f0-9]{64}\\.glb$`).test(model.path), 'GIFT_NOT_READY', 409, 'Only a completed keepsake can be saved to your account.');
  return { id, token, expiresAt: expiry };
}

export function createKeepsakeSyncService(deps: KeepsakeSyncDependencies) {
  const now = deps.now || Date.now;
  async function names(owner: string): Promise<string[]> {
    const values = await deps.storage.list(owner, MAX_SYNCED_KEEPSAKES + 1);
    ensure(Array.isArray(values) && values.length <= MAX_SYNCED_KEEPSAKES, 'KEEPSAKE_SYNC_LIMIT', 409, 'Your account has reached its saved gift limit. Remove a reference before saving another.');
    ensure(values.every(value => typeof value === 'string' && /^[0-9a-f-]{36}\.json$/.test(value)), 'SYNC_RECORD_INVALID', 502);
    return values;
  }
  return {
    async list(actor: KeepsakeSyncActor): Promise<{ references: SyncedKeepsakeReference[] }> {
      const owner = actorId(actor), pending = await names(owner), references: SyncedKeepsakeReference[] = [];
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
        while (pending.length) {
          const name = pending.shift()!, id = uuid(name.slice(0, -5)).toLowerCase();
          const contents = await deps.storage.read(recordPath(owner, id));
          if (contents === null) continue;
          const reference = unseal(deps.settings, owner, id, contents);
          if (reference.expiresAt > now() / 1000) references.push(reference);
        }
      }));
      return { references: references.sort((a, b) => a.id.localeCompare(b.id)) };
    },
    async save(actor: KeepsakeSyncActor, input: unknown): Promise<{ reference: SyncedKeepsakeReference }> {
      const owner = actorId(actor);
      ensure(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => key === 'id' || key === 'token'), 'INVALID_BODY');
      const value = input as Record<string, unknown>, id = uuid(value.id).toLowerCase(), tokenHash = giftHash(value.token);
      const job = await deps.repository.get(id, tokenHash);
      const reference = readyKeepsakeReference(job, id, value.token as string, now());
      const saved = await names(owner);
      ensure(saved.includes(`${id}.json`) || saved.length < MAX_SYNCED_KEEPSAKES, 'KEEPSAKE_SYNC_LIMIT', 409, 'Your account has reached its saved gift limit.');
      await deps.storage.write(recordPath(owner, id), seal(deps.settings, owner, reference));
      return { reference };
    },
    async remove(actor: KeepsakeSyncActor, input: unknown): Promise<{ removed: true }> {
      const owner = actorId(actor);
      ensure(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => key === 'id'), 'INVALID_BODY');
      const id = uuid((input as Record<string, unknown>).id).toLowerCase();
      await deps.storage.remove(recordPath(owner, id));
      return { removed: true };
    },
  };
}

/** Caller supplies the identity obtained from authContext, never from JSON. */
export async function runKeepsakeSyncRequest(action: string, req: Pick<IncomingMessage, 'headers' | 'method'>, actor: KeepsakeSyncActor, deps: KeepsakeSyncDependencies, input?: unknown) {
  ensure(['keepsakes-list', 'keepsakes-save', 'keepsakes-remove'].includes(action), 'ACTION_UNAVAILABLE', 404);
  ensure(req.method === (action === 'keepsakes-list' ? 'GET' : 'POST'), 'METHOD_NOT_ALLOWED', 405);
  assertKeepsakeSyncOrigin(req, deps.settings);
  if (action !== 'keepsakes-list') {
    ensure(typeof req.headers['content-type'] === 'string' && /^application\/json(?:;|$)/i.test(req.headers['content-type']), 'INVALID_BODY');
    ensure(input !== undefined && Buffer.byteLength(JSON.stringify(input)) <= MAX_RECORD_BYTES, 'BODY_TOO_LARGE', 413);
  }
  const service = createKeepsakeSyncService(deps);
  if (action === 'keepsakes-list') return service.list(actor);
  if (action === 'keepsakes-save') return service.save(actor, input);
  return service.remove(actor, input);
}

/** Access only the configured, already-provisioned private experiment bucket. */
export function createKeepsakeSyncStorage(client: SupabaseClient, bucket: string): KeepsakeSyncStorage {
  ensure(/^gp-keepsake-sync-[a-z0-9][a-z0-9-]{0,45}$/.test(bucket), 'KEEPSAKE_SYNC_UNAVAILABLE', 503);
  const target = client.storage.from(bucket);
  let checked: Promise<void> | undefined;
  const privateBucket = () => checked ??= (async () => {
    const result = await client.storage.getBucket(bucket);
    ensure(!result.error && result.data?.id === bucket && result.data.public === false, 'KEEPSAKE_SYNC_UNAVAILABLE', 503, 'Account sync is unavailable in this preview.');
  })();
  return {
    async list(prefix, limit) {
      await privateBucket();
      const result = await target.list(uuid(prefix).toLowerCase(), { limit, offset: 0, sortBy: { column: 'name', order: 'asc' } });
      ensure(!result.error && Array.isArray(result.data), 'KEEPSAKE_SYNC_FAILED', 503, 'Your saved gift references could not be loaded.');
      return result.data.map(value => value.name);
    },
    async read(path) {
      await privateBucket(); const result = await target.download(path);
      const status = result.error && 'statusCode' in result.error ? String(result.error.statusCode) : '';
      if (result.error && ['404', '400'].includes(status) && /not found|does not exist/i.test(result.error.message)) return null;
      ensure(!result.error && result.data && result.data.size <= MAX_RECORD_BYTES, 'KEEPSAKE_SYNC_FAILED', 503, 'A saved gift reference could not be loaded.');
      return result.data.text();
    },
    async write(path, contents) {
      await privateBucket(); ensure(Buffer.byteLength(contents) <= MAX_RECORD_BYTES, 'SYNC_RECORD_INVALID', 502);
      const result = await target.upload(path, contents, { contentType: 'application/json', upsert: true, cacheControl: '0' });
      ensure(!result.error, 'KEEPSAKE_SYNC_FAILED', 503, 'The gift could not be saved to your account. Its device reference is still available.');
    },
    async remove(path) {
      await privateBucket(); const result = await target.remove([path]);
      ensure(!result.error, 'KEEPSAKE_SYNC_FAILED', 503, 'The saved reference could not be removed.');
    },
  };
}
