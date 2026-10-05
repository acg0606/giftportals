import type { KeepsakeReference } from './keepsake-library';

export const MAX_KEEPSAKE_SYNC_BATCH = 100;
export interface KeepsakeCapability { id: string; token: string; expiresAt?: number }
export interface KeepsakeSyncResult {
  ok: boolean;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  stopped: boolean;
  refs: KeepsakeReference[];
  code?: string;
  error?: string;
}
export interface KeepsakeSyncOptions {
  api: <T>(action: string, body?: unknown) => Promise<T>;
  getIdentity: () => string | null;
  getGeneration: () => number;
  enabled: () => boolean;
  /** List snapshots and save deltas contain only validated capabilities.
   * The caller merges and persists them in the captured account's cache. */
  onReferences: (refs: KeepsakeReference[]) => void;
  now?: () => number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const token = /^[A-Za-z0-9_-]{43}$/;
const validExpiry = (value: unknown, now: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER && value > now;
function capability(value: unknown, now: number): KeepsakeCapability | undefined {
  if (!value || typeof value !== 'object') return;
  const candidate = value as Partial<KeepsakeCapability>;
  if (typeof candidate.id !== 'string' || !uuid.test(candidate.id) || typeof candidate.token !== 'string' || !token.test(candidate.token)) return;
  if (candidate.expiresAt !== undefined && !validExpiry(candidate.expiresAt, now)) return;
  return { id: candidate.id.toLowerCase(), token: candidate.token };
}
function reference(value: unknown, now: number): KeepsakeReference | undefined {
  const candidate = capability(value, now);
  if (!candidate || !validExpiry((value as KeepsakeReference).expiresAt, now)) return;
  return { ...candidate, expiresAt: (value as KeepsakeReference).expiresAt };
}
const copy = (refs: readonly KeepsakeReference[]) => refs.map(ref => ({ ...ref }));
const success = (refs: KeepsakeReference[] = [], skippedCount = 0): KeepsakeSyncResult =>
  ({ ok: true, successCount: refs.length, failureCount: 0, skippedCount, stopped: false, refs: copy(refs) });
const failure = (code: string, error: string, stopped = false): KeepsakeSyncResult =>
  ({ ok: false, successCount: 0, failureCount: 1, skippedCount: 0, stopped, refs: [], code, error });
const changed = () => failure('SESSION_CHANGED', 'Your account changed. Sign in again to continue syncing your gifts.', true);

/** Parse a private gift link without fetching it or putting its capability in logs.
 * Only the current HTTPS origin and the exact production origin are accepted. */
export function parseGeneratedKeepsakeLink(input: string, currentOrigin = 'https://giftportals.vercel.app'): { id: string; token: string } | undefined {
  if (typeof input !== 'string' || input.length > 4096 || !/^https:\/\//i.test(input.trim())) return;
  try {
    const url = new URL(input.trim());
    const origin = new URL(currentOrigin);
    if (url.protocol !== 'https:' || url.username || url.password) return;
    const sameOrigin = origin.protocol === 'https:' && url.origin === origin.origin;
    if (!sameOrigin && url.origin !== 'https://giftportals.vercel.app') return;
    let path: string, query: string;
    if (url.hash) {
      if (url.pathname !== '/' || url.search) return;
      const parts = url.hash.slice(1).split('?');
      if (parts.length !== 2) return;
      [path, query] = parts;
    } else { path = url.pathname; query = url.search.slice(1); }
    const match = /^\/generated\/([0-9a-f-]+)$/i.exec(path);
    if (!match || !uuid.test(match[1])) return;
    const params = new URLSearchParams(query);
    if (params.getAll('key').length !== 1) return;
    for (const [name, value] of params) {
      if (params.getAll(name).length !== 1) return;
      if (name === 'key') continue;
      if (name === 'view' && (value === 'world' || value === 'object')) continue;
      if (name === 'from' && value === 'room') continue;
      return;
    }
    const key = params.get('key');
    if (!key || !token.test(key)) return;
    return { id: match[1].toLowerCase(), token: key };
  } catch { return; }
}

/** No account or anonymous library is read automatically. Only explicit method
 * calls send capabilities, and logout never removes a cloud collection. */
export function createKeepsakeSync(options: KeepsakeSyncOptions) {
  type Actor = { id: string; generation: number };
  const now = options.now || (() => Date.now() / 1000);
  const flights = new Map<string, { token: string; promise: Promise<KeepsakeSyncResult> }>();
  const saved = new Map<string, KeepsakeReference>();
  let cacheActor = '';
  const actorKey = (actor: Actor) => JSON.stringify([actor.id, actor.generation]);
  const giftKey = (actor: Actor, id: string) => JSON.stringify([actor.id, actor.generation, id]);
  function active(actor: Actor) {
    const matches = options.enabled() && options.getIdentity() === actor.id && options.getGeneration() === actor.generation;
    if (!matches && cacheActor === actorKey(actor)) { saved.clear(); flights.clear(); cacheActor = ''; }
    return matches;
  }
  function capture(): Actor | KeepsakeSyncResult {
    if (!options.enabled()) return failure('SYNC_DISABLED', 'Account syncing is currently unavailable. Your gifts remain on this device.');
    const id = options.getIdentity(), generation = options.getGeneration();
    if (!id) { saved.clear(); flights.clear(); cacheActor = ''; return failure('SIGN_IN_REQUIRED', 'Sign in to save gifts to your account.'); }
    const actor = { id, generation };
    if (!active(actor)) return changed();
    const key = actorKey(actor);
    if (key !== cacheActor) { saved.clear(); flights.clear(); cacheActor = key; }
    return actor;
  }
  function apply(actor: Actor, refs: KeepsakeReference[]) {
    if (!active(actor)) return false;
    options.onReferences(copy(refs));
    return active(actor);
  }

  async function list(): Promise<KeepsakeSyncResult> {
    const actor = capture();
    if ('ok' in actor) return actor;
    try {
      if (!active(actor)) return changed();
      const data = await options.api<{ references: unknown[] }>('keepsakes-list');
      if (!active(actor)) return changed();
      if (!data || !Array.isArray(data.references)) return failure('INVALID_RESPONSE', 'Your saved gifts could not be read. Please try again.');
      const unique = new Map<string, KeepsakeReference>();
      let skippedCount = 0;
      for (const value of data.references) {
        const ref = reference(value, now());
        if (!ref || unique.has(ref.id)) { skippedCount++; continue; }
        unique.set(ref.id, ref);
      }
      const refs = [...unique.values()];
      if (!apply(actor, refs)) return changed();
      for (const ref of refs) saved.set(giftKey(actor, ref.id), { ...ref });
      return success(refs, skippedCount);
    } catch {
      return active(actor) ? failure('SYNC_FAILED', 'Your saved gifts could not be loaded. Please try again.') : changed();
    }
  }

  function saveFor(actor: Actor, value: unknown): Promise<KeepsakeSyncResult> {
    if (!active(actor)) return Promise.resolve(changed());
    const input = capability(value, now());
    if (!input) return Promise.resolve(failure('INVALID_REFERENCE', 'This gift link could not be verified. Use a complete, unexpired private gift link.'));
    const key = giftKey(actor, input.id);
    const existing = saved.get(key);
    if (existing?.token === input.token && validExpiry(existing.expiresAt, now())) {
      return Promise.resolve({ ...success([], 1), refs: [{ ...existing }] });
    }
    const current = flights.get(key);
    if (current) return current.token === input.token ? current.promise : Promise.resolve(failure('SYNC_BUSY', 'This gift is already being synced. Wait for it to finish, then try again.'));
    let flight!: Promise<KeepsakeSyncResult>;
    flight = (async () => {
      try {
        if (!active(actor)) return changed();
        const data = await options.api<{ reference: unknown }>('keepsakes-save', { id: input.id, token: input.token });
        if (!active(actor)) return changed();
        const ref = reference(data?.reference, now());
        if (!ref || ref.id !== input.id || ref.token !== input.token) return failure('INVALID_RESPONSE', 'The saved gift could not be verified. Please try again.');
        if (!apply(actor, [ref])) return changed();
        saved.set(key, { ...ref });
        return success([ref]);
      } catch {
        return active(actor) ? failure('SYNC_FAILED', 'Your gift could not be synced. It remains on this device. Please try again.') : changed();
      } finally { if (flights.get(key)?.promise === flight) flights.delete(key); }
    })();
    flights.set(key, { token: input.token, promise: flight });
    return flight;
  }
  function save(value: KeepsakeCapability): Promise<KeepsakeSyncResult> {
    const actor = capture();
    return 'ok' in actor ? Promise.resolve(actor) : saveFor(actor, value);
  }

  async function importBatch(values: readonly KeepsakeCapability[]): Promise<KeepsakeSyncResult> {
    const actor = capture();
    if ('ok' in actor) return actor;
    if (!Array.isArray(values)) return failure('INVALID_REFERENCE', 'Choose valid private gifts to import.');
    const queue = new Map<string, KeepsakeCapability>();
    let failureCount = 0, skippedCount = 0, limited = false;
    for (const value of values) {
      const input = capability(value, now());
      if (!input) { failureCount++; continue; }
      if (queue.has(input.id)) { skippedCount++; continue; }
      if (queue.size >= MAX_KEEPSAKE_SYNC_BATCH) { skippedCount++; limited = true; continue; }
      queue.set(input.id, input);
    }
    let successCount = 0, firstError: string | undefined;
    const refs = new Map<string, KeepsakeReference>();
    for (const input of queue.values()) {
      if (!active(actor)) return { ...changed(), successCount, failureCount, skippedCount };
      const result = await saveFor(actor, input);
      successCount += result.successCount; failureCount += result.failureCount; skippedCount += result.skippedCount;
      if (!active(actor) || result.stopped) return { ...changed(), successCount, failureCount, skippedCount };
      firstError ||= result.error;
      for (const ref of result.refs) refs.set(ref.id, { ...ref });
    }
    const ok = failureCount === 0 && !limited;
    return {
      ok, successCount, failureCount, skippedCount, stopped: false, refs: [...refs.values()],
      ...(!ok ? { code: limited ? 'IMPORT_LIMIT' : 'SYNC_FAILED', error: limited ? 'You can import up to 100 gifts at a time. The remaining gifts stay on this device.' : firstError || 'Some gifts could not be imported. They remain on this device; check their links and try again.' } : {}),
    };
  }

  async function remove(id: string): Promise<KeepsakeSyncResult> {
    const actor = capture();
    if ('ok' in actor) return actor;
    if (typeof id !== 'string' || !uuid.test(id)) return failure('INVALID_REFERENCE', 'Choose a valid saved gift to remove.');
    try {
      if (!active(actor)) return changed();
      const data = await options.api<{ removed: boolean }>('keepsakes-remove', { id: id.toLowerCase() });
      if (!active(actor)) return changed();
      if (data?.removed !== true) return failure('INVALID_RESPONSE', 'The saved gift could not be removed. Please try again.');
      saved.delete(giftKey(actor, id.toLowerCase()));
      return { ...success(), successCount: 1 };
    } catch {
      return active(actor) ? failure('SYNC_FAILED', 'Your saved gift could not be removed. Please try again.') : changed();
    }
  }
  return { list, save, importBatch, remove };
}
