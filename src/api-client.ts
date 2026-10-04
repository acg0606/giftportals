import type { ApiResult, SessionDTO } from '../shared/contracts';

const sessionKey = 'giftportals.session.v1';
let currentSession: SessionDTO | null = null;
let authGeneration = 0;
let refreshing: Promise<void> | null = null;
try { currentSession = JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); } catch { sessionStorage.removeItem(sessionKey); }

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'ApiError'; }
}
export const session = () => currentSession;
export const sessionGeneration = () => authGeneration;
export function setSession(value: SessionDTO | null) {
  const identityChanged = (currentSession?.user.id ?? null) !== (value?.user.id ?? null);
  currentSession = value;
  if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
  else sessionStorage.removeItem(sessionKey);
  if (identityChanged) { authGeneration++; refreshing = null; window.dispatchEvent(new CustomEvent('giftportals-session-changed')); }
}

async function refreshSession() {
  if (refreshing) return refreshing;
  const source = currentSession; const scope = authGeneration;
  if (!source) throw new ApiError('SESSION_EXPIRED', 'Your session has expired. Sign in to reopen your private world.');
  let flight: Promise<void> | null = null;
  flight = (async () => {
    try {
      const renewed = await api<SessionDTO>('refresh', { refreshToken: source.refreshToken });
      if (authGeneration !== scope || currentSession?.user.id !== source.user.id) throw new ApiError('SESSION_CHANGED', 'Your account changed while this request was running.');
      setSession(renewed);
    } catch (error) {
      if (authGeneration === scope) setSession(null);
      throw error instanceof ApiError ? error : new ApiError('SESSION_EXPIRED', 'Your session has expired. Sign in to reopen your private world.');
    } finally { if (refreshing === flight) refreshing = null; }
  })();
  refreshing = flight; return flight;
}

export async function api<T>(action: string, body?: unknown, query: Record<string, string> = {}, method?: string, privateHeaders: Record<string, string> = {}): Promise<T> {
  const scope = authGeneration; const identity = currentSession?.user.id ?? null;
  if (currentSession && action !== 'refresh' && currentSession.expiresAt < Date.now() / 1000 + 30) {
    await refreshSession();
  }
  if (authGeneration !== scope || (currentSession?.user.id ?? null) !== identity) throw new ApiError('SESSION_CHANGED', 'Your account changed while this request was running.');
  const params = new URLSearchParams({ action, ...query });
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 25000);
  try {
    const response = await fetch(`/api/giftportals?${params}`, {
      method: method || (body === undefined ? 'GET' : 'POST'), signal: abort.signal,
      headers: { 'Content-Type': 'application/json', ...(currentSession ? { Authorization: `Bearer ${currentSession.accessToken}` } : {}), ...privateHeaders },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let result: ApiResult<T>;
    try { result = await response.json(); }
    catch { throw new ApiError('UNAVAILABLE', 'The cloud service is unavailable. Your original files remain on your device. Please try again.'); }
    if (authGeneration !== scope || (currentSession?.user.id ?? null) !== identity) throw new ApiError('SESSION_CHANGED', 'Your account changed while this request was running.');
    if (!result.ok) throw new ApiError(result.error.code, result.error.message);
    return result.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('NETWORK', 'Could not reach the cloud. Check your connection and try again.');
  } finally { clearTimeout(timeout); }
}

export async function putFile(url: string, file: File) {
  const scope = authGeneration;
  const identity = currentSession?.user.id ?? null;
  const abort = new AbortController();
  const changed = () => authGeneration !== scope || (currentSession?.user.id ?? null) !== identity;
  const onIdentityChange = () => { if (changed()) abort.abort(); };
  window.addEventListener('giftportals-session-changed', onIdentityChange);
  const timeout = setTimeout(() => abort.abort(), 60000);
  try {
    const response = await fetch(url, { method: 'PUT', signal: abort.signal, headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file });
    if (changed()) throw new ApiError('SESSION_CHANGED', 'Your account changed while this upload was running.');
    if (!response.ok) throw new ApiError('UPLOAD_FAILED', 'The original file could not be saved. Please retry the upload.');
  } catch (error) {
    if (changed()) throw new ApiError('SESSION_CHANGED', 'Your account changed while this upload was running.');
    if (error instanceof ApiError) throw error;
    throw new ApiError('UPLOAD_INTERRUPTED', 'The upload was interrupted. Your original stays on your device. Retry to check whether it was saved.');
  } finally {
    clearTimeout(timeout);
    window.removeEventListener('giftportals-session-changed', onIdentityChange);
  }
}
