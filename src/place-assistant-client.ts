import type { PlaceAssistantInput, PlaceAssistantStatus, PlaceAssistantSuggestion } from '../shared/place-assistant';

export interface PlaceAssistantService {
  status(signal: AbortSignal): Promise<PlaceAssistantStatus>;
  suggest(input: PlaceAssistantInput, signal: AbortSignal): Promise<PlaceAssistantSuggestion>;
}

async function request<T>(action: 'status' | 'suggest', signal: AbortSignal, body?: PlaceAssistantInput): Promise<T> {
  const abort = new AbortController(), cancel = () => abort.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) abort.abort();
  const timeout = setTimeout(cancel, action === 'suggest' ? 60_000 : 15_000);
  try {
    const response = await fetch(`/api/place-assistant?action=${action}`, {
      method: body ? 'POST' : 'GET', signal: abort.signal, credentials: 'same-origin',
      referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (signal.aborted || abort.signal.aborted) throw new DOMException('Memory suggestions were closed.', 'AbortError');
    if (!response.ok || !result.ok) throw new Error(result.error?.message || 'Suggestions could not be reached. You can still write your memory.');
    return result.data as T;
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
}

export const placeAssistantService: PlaceAssistantService = {
  status: signal => request('status', signal),
  suggest: (input, signal) => request('suggest', signal, input),
};

/** Source links come from the public place lookup, never from image guesses. */
export function assistantSourceUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    const approved = ['wikipedia.org', 'wikidata.org', 'wikimedia.org', 'openstreetmap.org', 'prefeitura.sp.gov.br'];
    return approved.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : '';
  } catch { return ''; }
}

export function assistantWarningCopy(code: string): string {
  const copy: Record<string, string> = {
    PHOTO_ANALYSIS_NOT_CONFIGURED: 'Photo interpretation is unavailable. You can still use place details and your own words.',
    PHOTO_ANALYSIS_UNAVAILABLE: 'The photo could not be interpreted this time. Your photo and words remain here.',
    PLACE_LOOKUP_BUSY: 'Place lookup is taking a pause. Try again in a moment.',
    PLACE_LOOKUP_UNAVAILABLE: 'Nearby places could not be reached. You can enter the place name instead.',
    CURIOSITY_LOOKUP_UNAVAILABLE: 'Historical details could not be reached. You can still tell your memory.',
    NO_VERIFIED_PLACE_CURIOSITY: 'We could not verify a historical detail for this place.',
    NEARBY_PLACE_REQUIRES_CONFIRMATION: 'Confirm the right place before using it as your gift’s setting.',
  };
  return copy[code] || 'Some suggestions are unavailable. Your photo and words remain here.';
}
