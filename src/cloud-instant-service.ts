import type { InstantCreateInput, InstantJob, InstantStatus } from './instant-creator-state';
import type { InstantCreatorService, InstantJobReference } from './instant-creator';
import type { CloudImageDeclaration, CloudImageId, CloudPrepareInput, CloudPreparedJob } from '../shared/cloud-instant';

export function cloudCreatorOrigin(hostname: string): boolean {
  return Boolean(hostname) && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

/** Decode locally; JSON API requests contain declarations rather than photos. */
export async function cloudImageBytes(dataUrl: string): Promise<{ declaration: CloudImageDeclaration; bytes: Uint8Array }> {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length > 8_388_608) throw new Error('Choose a JPG, PNG, or WebP photo under 6 MB.');
  let binary: string;
  try { binary = atob(match[2]); } catch { throw new Error('This photo could not be read. Choose another image.'); }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (!bytes.length || bytes.length > 6 * 1024 * 1024) throw new Error('Keep each photo under 6 MB.');
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  return { declaration: { mime: match[1] as CloudImageDeclaration['mime'], bytes: bytes.length, sha256 }, bytes };
}

export function createCloudInstantService(fetcher: typeof fetch = fetch): InstantCreatorService {
  let verifiedStatus: InstantStatus | undefined;
  async function request<T>(action: string, signal: AbortSignal, body?: unknown, reference?: InstantJobReference): Promise<T> {
    const abort = new AbortController(), cancel = () => abort.abort(); signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) abort.abort();
    const timeout = setTimeout(cancel, body === undefined ? 30_000 : 190_000);
    try {
      const query = new URLSearchParams({ action, ...(reference ? 'id' in reference ? { id: reference.id } : { dedupeKey: reference.dedupeKey } : {}) });
      const response = await fetcher('/api/instant-cloud?' + query, {
        method: body === undefined ? 'GET' : 'POST', signal: abort.signal, referrerPolicy: 'no-referrer', credentials: 'same-origin', redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...(reference ? { 'X-Instant-Token': reference.token } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Object.assign(new Error(result.error?.message || 'Your gift could not be reached. Please try again.'), { code: result.error?.code });
      return result.data as T;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
  }
  const status = async (signal: AbortSignal) => {
    const value = await request<InstantStatus>('status', signal);
    if (value.storage !== 'cloud' || value.localOnly) throw new Error('The cloud creator is not configured yet. Your examples are still available.');
    verifiedStatus = value; return value;
  };
  return {
    status,
    async create(input: InstantCreateInput, signal: AbortSignal) {
      if (!verifiedStatus) await status(signal);
      if (!verifiedStatus?.available || input.consent !== true) throw new Error('Live creation is not ready yet. Your photo stays with you.');
      const data: Partial<Record<CloudImageId, Awaited<ReturnType<typeof cloudImageBytes>>>> = {};
      data.original = await cloudImageBytes(input.imageDataUrl);
      if (input.objectImageDataUrl) data.object = await cloudImageBytes(input.objectImageDataUrl);
      if (input.worldImageDataUrl) data.world = await cloudImageBytes(input.worldImageDataUrl);
      if (Object.values(data).reduce((sum, image) => sum + image!.bytes.length, 0) > 12 * 1024 * 1024) throw new Error('Keep the photos together under 12 MB.');
      if (signal.aborted) throw new DOMException('The gift request was closed.', 'AbortError');
      const { imageDataUrl: _original, objectImageDataUrl: _object, worldImageDataUrl: _world, ...metadata } = input;
      const body: CloudPrepareInput = { ...metadata, images: { original: data.original.declaration, ...(data.object ? { object: data.object.declaration } : {}), ...(data.world ? { world: data.world.declaration } : {}) } };
      const prepared = await request<CloudPreparedJob>('prepare', signal, body);
      if (!prepared || !/^[A-Za-z0-9_-]{8,120}$/.test(prepared.id) || prepared.token !== input.requestToken || !Array.isArray(prepared.uploads)) throw new Error('The upload could not be verified. Your creation reference is kept for recovery.');
      const seen = new Set<string>();
      for (const upload of prepared.uploads) {
        const image = data[upload.id]; let url: URL;
        try { url = new URL(upload.url); } catch { throw new Error('The private upload could not be verified.'); }
        if (!image || seen.has(upload.id) || url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.endsWith('.supabase.co') || !url.pathname.startsWith('/storage/v1/object/upload/sign/gp-instant-private/' + prepared.id + '/input/') || upload.method !== 'PUT' || upload.mime !== image.declaration.mime || upload.bytes !== image.declaration.bytes || upload.sha256 !== image.declaration.sha256 || upload.headers?.['Content-Type'] !== image.declaration.mime) throw new Error('The private upload could not be verified.');
        seen.add(upload.id);
      }
      if (!prepared.deduplicated && seen.size !== Object.keys(data).length) throw new Error('An upload is missing. Your creation reference is kept for recovery.');
      for (const upload of prepared.uploads) {
        const image = data[upload.id]!;
        const abort = new AbortController(), cancel = () => abort.abort(); signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) abort.abort();
        const timeout = setTimeout(cancel, 60_000);
        try {
          const response = await fetcher(upload.url, { method: 'PUT', body: image.bytes as Uint8Array<ArrayBuffer>, headers: { 'Content-Type': image.declaration.mime }, signal: abort.signal, referrerPolicy: 'no-referrer', credentials: 'omit', redirect: 'error' });
          if (!response.ok) throw new Error('The photo upload was interrupted. Reopen this draft to recover your creation.');
        } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
      }
      return request<InstantJob>('finalize', signal, { id: prepared.id }, { id: prepared.id, token: prepared.token });
    },
    async job(reference: InstantJobReference, signal: AbortSignal) {
      const current = await request<InstantJob>('job', signal, undefined, reference);
      if (current.state !== 'processing') return current;
      // Only an explicit POST advances this authorized gift. GET remains a
      // read, and durable leases prevent overlapping browser/cron submissions.
      return request<InstantJob>('advance', signal, { id: current.id }, { id: current.id, token: reference.token });
    },
  };
}
