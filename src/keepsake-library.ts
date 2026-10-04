import { instantGiftReady, readInstantJobReference, type InstantJob } from './instant-creator-state';

export interface KeepsakeReference { id: string; token: string; expiresAt: number }
export interface KeepsakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const sevenDays = 7 * 24 * 60 * 60;
export const instantJobStorageKey = (scope = 'anonymous') => `giftportals.instant.job.v2:${encodeURIComponent(scope)}`;
export const instantPendingStorageKey = (scope = 'anonymous') => `giftportals.instant.pending.v2:${encodeURIComponent(scope)}`;
export const keepsakeLibraryKey = (scope: string) => `giftportals.keepsakes.v1:${encodeURIComponent(scope)}`;

/** Only opaque references live on this device. Every display rereads the private job;
 * photos, stories, generated content and signed media URLs are never serialized. */
export function readKeepsakeReferences(raw: string | null, now = Date.now() / 1000): KeepsakeReference[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const unique = new Map<string, KeepsakeReference>();
    for (const value of parsed) {
      if (!value || typeof value !== 'object') continue;
      const candidate = value as Partial<KeepsakeReference>;
      const reference = readInstantJobReference(JSON.stringify({ id: candidate.id, token: candidate.token }));
      if (!reference || typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt) || candidate.expiresAt <= now) continue;
      unique.set(reference.id, { ...reference, expiresAt: candidate.expiresAt });
    }
    return [...unique.values()];
  } catch { return []; }
}

function write(storage: KeepsakeStorage, scope: string, values: KeepsakeReference[]) {
  if (values.length) storage.setItem(keepsakeLibraryKey(scope), JSON.stringify(values));
  else storage.removeItem(keepsakeLibraryKey(scope));
}

export function storedKeepsakeReferences(storage: KeepsakeStorage | undefined, scope: string, now = Date.now() / 1000): KeepsakeReference[] {
  if (!storage) return [];
  let values: KeepsakeReference[];
  try {
    values = readKeepsakeReferences(storage.getItem(keepsakeLibraryKey(scope)), now);
  } catch { return []; }
  try { write(storage, scope, values); } catch { /* A read-only store still supplies unexpired references. */ }
  return values;
}

/** Save a delivered 3D keepsake, even when its world failed, preserving the server retention deadline. */
export function rememberCreatedKeepsake(storage: KeepsakeStorage | undefined, scope: string, job: InstantJob, now = Date.now() / 1000): KeepsakeReference | undefined {
  if (!instantGiftReady(job)) return undefined;
  const reference = readInstantJobReference(JSON.stringify({ id: job.id, token: job.token }));
  if (!reference) return undefined;
  const previous = storedKeepsakeReferences(storage, scope, now);
  const existing = previous.find(value => value.id === reference.id);
  const created = Date.parse(job.createdAt) / 1000;
  const expiresAt = typeof job.mediaExpiresAt === 'number' && Number.isFinite(job.mediaExpiresAt)
    ? job.mediaExpiresAt : existing?.expiresAt ?? (Number.isFinite(created) ? created : now) + sevenDays;
  if (expiresAt <= now) return undefined;
  const next = { ...reference, expiresAt };
  if (storage) {
    try { write(storage, scope, [...previous.filter(value => value.id !== next.id), next]); }
    catch { /* An open creator remains usable when storage is blocked or full. */ }
  }
  return next;
}

export function forgetKeepsakeReference(storage: KeepsakeStorage | undefined, scope: string, id: string): void {
  if (!storage) return;
  try { write(storage, scope, storedKeepsakeReferences(storage, scope).filter(value => value.id !== id)); }
  catch { /* A denied capability is still excluded from the current display. */ }
}

/** Sign-out removes this actor's device capabilities. Other actors cannot inherit them. */
export function clearKeepsakeScope(storage: KeepsakeStorage | undefined, scope: string): void {
  try { storage?.removeItem(keepsakeLibraryKey(scope)); } catch { /* UI scope changes regardless. */ }
}

/** This GET never finalizes uploads or advances provider work. Opening a collection
 * must not turn an unfinished legacy draft into a new paid generation request. */
export async function readKeepsakeJob(reference: { id: string; token: string }, signal: AbortSignal, hostname: string, fetcher: typeof fetch = fetch): Promise<InstantJob> {
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
  const query = new URLSearchParams({ action: local ? 'snapshot' : 'job', id: reference.id });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) abort.abort();
  const timeout = setTimeout(cancel, 30_000);
  try {
    const response = await fetcher(`/api/${local ? 'instant' : 'instant-cloud'}?${query}`, {
      method: 'GET', headers: { 'X-Instant-Token': reference.token }, signal: abort.signal,
      credentials: 'same-origin', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
    });
    const result = await response.json();
    if (signal.aborted || abort.signal.aborted) throw new DOMException('The gift request was closed.', 'AbortError');
    if (!response.ok || !result.ok) throw Object.assign(new Error(result.error?.message || 'Your gift could not be reached. Please try again.'), { code: result.error?.code });
    const job = result.data as InstantJob;
    if (job.id !== reference.id || job.token !== reference.token) throw Object.assign(new Error('The gift could not be verified.'), { code: 'GIFT_REFERENCE_MISMATCH' });
    return job;
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
}
