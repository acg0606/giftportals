import type { InstantCreateInput, InstantJob, InstantStatus } from './instant-creator-state';
import type { InstantCreatorService, InstantJobReference, InstantUploadImages } from './instant-creator';
import type { CloudImageDeclaration, CloudImageId, CloudPrepareInput, CloudPreparedJob, CloudUploadPlan, CloudWorldDiagnostics, WorldDiagnosticErrorCode, WorldDiagnosticReason } from '../shared/cloud-instant';

export function cloudCreatorOrigin(hostname: string): boolean {
  return Boolean(hostname) && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

const capacityErrors: Record<string, string> = {
  GENERATION_QUOTA: 'The creator is unavailable right now. Your photo and words remain here. Check availability again.',
  GENERATION_BUDGET: 'The creator is unavailable right now. Your photo and words remain here. Check availability again.',
  STORAGE_LIMIT: 'The photo could not be stored right now. Your photo and words remain here. Check availability again.',
  PROVIDER_INSUFFICIENT_CREDITS: 'The generation service does not have enough credits for this creation. Your photo and words remain here.',
};

const diagnosticReasons: Record<WorldDiagnosticReason, string> = {
  'content-policy': 'The world service reported an image approval restriction.',
  'input-download': 'The world service could not download its input image.',
  'invalid-input': 'The world service reported an invalid creation input.',
  'insufficient-credits': 'The world service reported insufficient credits for this creation.',
  'rate-limit': 'The world service reported too many requests.',
  'timeout': 'The world service reported that this creation took too long.',
  'provider-internal': 'The world service reported an internal failure.',
  unknown: 'The world service did not return a clear reason for this failure.',
};
const diagnosticCodes = new Set<WorldDiagnosticErrorCode>(['OK','CANCELLED','UNKNOWN','INVALID_ARGUMENT','DEADLINE_EXCEEDED','NOT_FOUND','ALREADY_EXISTS','PERMISSION_DENIED','RESOURCE_EXHAUSTED','FAILED_PRECONDITION','ABORTED','OUT_OF_RANGE','UNIMPLEMENTED','INTERNAL','UNAVAILABLE','DATA_LOSS','UNAUTHENTICATED']);
export function worldDiagnosticsMessage(value: CloudWorldDiagnostics): string {
  if (Object.hasOwn(diagnosticReasons, value.reason) && value.reason !== 'unknown') return diagnosticReasons[value.reason];
  if (value.done === false) return 'The world service reports that this task is still processing.';
  if (value.done === true && !value.errorPresent) return 'The world service reports that this task finished without a failure reason. An available world has not been confirmed.';
  return diagnosticReasons.unknown;
}
function readWorldDiagnostics(value: unknown): CloudWorldDiagnostics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The world status could not be checked. Please try again.');
  const record = value as Record<string, unknown>;
  if (!(typeof record.done === 'boolean' || record.done === null) || typeof record.errorPresent !== 'boolean') throw new Error('The world status could not be checked. Please try again.');
  const reason = typeof record.reason === 'string' && Object.hasOwn(diagnosticReasons, record.reason) ? record.reason as WorldDiagnosticReason : 'unknown';
  const diagnostic: CloudWorldDiagnostics = {
    done: record.done, errorPresent: record.errorPresent,
    errorShape: ['absent','null','object','array','string','number','boolean','other'].includes(String(record.errorShape)) ? record.errorShape as CloudWorldDiagnostics['errorShape'] : 'other',
    errorEmpty: typeof record.errorEmpty === 'boolean' ? record.errorEmpty : null,
    errorCode: typeof record.errorCode === 'number' && Number.isInteger(record.errorCode) && record.errorCode >= 0 && record.errorCode <= 999999 ? record.errorCode : typeof record.errorCode === 'string' && diagnosticCodes.has(record.errorCode as WorldDiagnosticErrorCode) ? record.errorCode as WorldDiagnosticErrorCode : null,
    reason, reasonText: '',
  };
  diagnostic.reasonText = worldDiagnosticsMessage(diagnostic);
  return diagnostic;
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
  type ImageBytes = Awaited<ReturnType<typeof cloudImageBytes>>;
  type Images = Partial<Record<CloudImageId, ImageBytes>>;
  // Only the current tab retains interrupted image bytes. Storage keeps opaque references.
  let cached: { token: string; data: Images } | undefined;
  const checkOpen = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('The gift request was closed.', 'AbortError'); };
  const matches = (image: ImageBytes, upload: CloudUploadPlan) => image.declaration.mime === upload.mime && image.declaration.bytes === upload.bytes && image.declaration.sha256 === upload.sha256;
  function validatePlan(id: string, uploads: CloudUploadPlan[]): void {
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(id) || !Array.isArray(uploads) || uploads.length > 3) throw new Error('The private upload could not be verified.');
    const seen = new Set<string>();
    for (const upload of uploads) {
      let url: URL;
      try { url = new URL(upload.url); } catch { throw new Error('The private upload could not be verified.'); }
      if (!['original', 'object', 'world'].includes(upload.id) || seen.has(upload.id) || !['image/jpeg', 'image/png', 'image/webp'].includes(upload.mime) || !Number.isInteger(upload.bytes) || upload.bytes <= 0 || upload.bytes > 6 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(upload.sha256) || url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.endsWith('.supabase.co') || !url.pathname.startsWith('/storage/v1/object/upload/sign/gp-instant-private/' + id + '/input/') || upload.method !== 'PUT' || upload.headers?.['Content-Type'] !== upload.mime) throw new Error('The private upload could not be verified.');
      seen.add(upload.id);
    }
    if (uploads.reduce((sum, upload) => sum + upload.bytes, 0) > 12 * 1024 * 1024) throw new Error('The private upload could not be verified.');
  }
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
      checkOpen(signal); checkOpen(abort.signal);
      if (!response.ok || !result.ok) {
        const code = typeof result.error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(result.error.code) ? result.error.code : undefined;
        throw Object.assign(new Error(code && capacityErrors[code] || result.error?.message || 'Your gift could not be reached. Please try again.'), {
          code, httpStatus: response.status,
          // Only a rejected prepare proves that no gift was reserved. An upload,
          // finalize, or lost response still needs its existing recovery path.
          creationRejected: action === 'prepare' && response.status === 429 && Boolean(code && Object.hasOwn(capacityErrors, code)),
        });
      }
      return result.data as T;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
  }
  const status = async (signal: AbortSignal) => {
    const value = await request<InstantStatus>('status', signal);
    if (value.storage !== 'cloud' || value.localOnly) throw new Error('The cloud creator is not configured yet. Your examples are still available.');
    verifiedStatus = value; return value;
  };
  async function finalize(reference: { id: string; token: string }, signal: AbortSignal) {
    const result = await request<InstantJob>('finalize', signal, { id: reference.id }, reference);
    if (cached?.token === reference.token && result.uploadState !== 'pending') cached = undefined;
    return result;
  }
  async function putMissing(id: string, uploads: CloudUploadPlan[], data: Images, signal: AbortSignal) {
    validatePlan(id, uploads);
    // Validate every photo before the first write, including multi-photo recovery.
    for (const upload of uploads) if (!data[upload.id] || !matches(data[upload.id]!, upload)) throw new Error('Choose the same photo used for this gift. Your existing uploads are kept.');
    for (const upload of uploads) {
      checkOpen(signal);
      const image = data[upload.id]!;
      const abort = new AbortController(), cancel = () => abort.abort(); signal.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, 60_000);
      try {
        const response = await fetcher(upload.url, { method: 'PUT', body: image.bytes as Uint8Array<ArrayBuffer>, headers: { 'Content-Type': image.declaration.mime }, signal: abort.signal, referrerPolicy: 'no-referrer', credentials: 'omit', redirect: 'error' });
        checkOpen(signal); checkOpen(abort.signal);
        if (!response.ok) throw new Error('The photo upload was interrupted. Reopen this draft to recover your creation.');
      } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
    }
  }
  async function pendingJob(reference: InstantJobReference, signal: AbortSignal): Promise<InstantJob> {
    const current = await request<InstantJob>('job', signal, undefined, reference);
    if (current.uploadState !== 'pending') {
      if (cached?.token === reference.token && (current.uploadState === 'finalized' || current.state !== 'processing')) cached = undefined;
      return current;
    }
    if (current.token !== reference.token) throw new Error('The private upload could not be verified.');
    validatePlan(current.id, current.uploads!);
    // A lost finalize response can be recovered after the server confirms all inputs.
    return current.uploads!.length ? current : finalize({ id: current.id, token: reference.token }, signal);
  }
  return {
    status,
    async worldDiagnostics(reference: { id: string; token: string }, signal: AbortSignal) {
      checkOpen(signal);
      if (!/^[A-Za-z0-9_-]{8,120}$/.test(reference.id) || !/^[A-Za-z0-9_-]{16,160}$/.test(reference.token)) throw new Error('This world status could not be checked. Reopen the gift and try again.');
      return readWorldDiagnostics(await request<unknown>('world-diagnostics', signal, undefined, reference));
    },
    async create(input: InstantCreateInput, signal: AbortSignal) {
      if (!verifiedStatus) await status(signal);
      if (!verifiedStatus?.available || input.consent !== true) throw new Error('Live creation is not ready yet. Your photo stays with you.');
      const data: Images = {};
      data.original = await cloudImageBytes(input.imageDataUrl);
      if (input.objectImageDataUrl) data.object = await cloudImageBytes(input.objectImageDataUrl);
      if (input.worldImageDataUrl) data.world = await cloudImageBytes(input.worldImageDataUrl);
      if (Object.values(data).reduce((sum, image) => sum + image!.bytes.length, 0) > 12 * 1024 * 1024) throw new Error('Keep the photos together under 12 MB.');
      checkOpen(signal); cached = { token: input.requestToken, data };
      const { imageDataUrl: _original, objectImageDataUrl: _object, worldImageDataUrl: _world, ...metadata } = input;
      const body: CloudPrepareInput = { ...metadata, images: { original: data.original.declaration, ...(data.object ? { object: data.object.declaration } : {}), ...(data.world ? { world: data.world.declaration } : {}) } };
      const prepared = await request<CloudPreparedJob>('prepare', signal, body);
      if (!prepared || !/^[A-Za-z0-9_-]{8,120}$/.test(prepared.id) || prepared.token !== input.requestToken || !Array.isArray(prepared.uploads)) throw new Error('The upload could not be verified. Your creation reference is kept for recovery.');
      validatePlan(prepared.id, prepared.uploads);
      for (const upload of prepared.uploads) if (!data[upload.id] || !matches(data[upload.id]!, upload)) throw new Error('The private upload could not be verified.');
      if (!prepared.deduplicated && prepared.uploads.length !== Object.keys(data).length) throw new Error('An upload is missing. Your creation reference is kept for recovery.');
      await putMissing(prepared.id, prepared.uploads, data, signal);
      return finalize({ id: prepared.id, token: prepared.token }, signal);
    },
    async resumeUpload(reference: InstantJobReference, images: InstantUploadImages, signal: AbortSignal) {
      const current = await pendingJob(reference, signal);
      if (current.uploadState !== 'pending') return current;
      const data: Images = {};
      for (const upload of current.uploads!) {
        let image = cached?.token === reference.token ? cached.data[upload.id] : undefined;
        if (!image || !matches(image, upload)) {
          image = undefined;
          const supplied = images[upload.id];
          for (const candidate of typeof supplied === 'string' ? [supplied] : supplied || []) {
            const decoded = await cloudImageBytes(candidate); checkOpen(signal);
            if (matches(decoded, upload)) { image = decoded; break; }
          }
        }
        if (!image) throw new Error('Choose the same photo used for this gift. Your existing uploads are kept.');
        data[upload.id] = image;
      }
      await putMissing(current.id, current.uploads!, data, signal);
      return finalize({ id: current.id, token: reference.token }, signal);
    },
    async job(reference: InstantJobReference, signal: AbortSignal) {
      const current = await pendingJob(reference, signal);
      if (current.state !== 'processing' || current.uploadState === 'pending') return current;
      // Only an explicit POST advances this authorized gift. GET remains a
      // read, and durable leases prevent overlapping browser/cron submissions.
      return request<InstantJob>('advance', signal, { id: current.id }, { id: current.id, token: reference.token });
    },
  };
}
