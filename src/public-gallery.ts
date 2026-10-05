import type { CollectionRoomItem } from './collection-types';
import type { GeneratedGiftData } from './generated-gift';
import { readGiftWorldSemantics } from './gift-walk-catalog';
import type { PublicGalleryGiftDTO, PublicGalleryListDTO } from '../shared/instant-gallery';

/** Published content only. Creator capabilities and paid controls are never
 * accepted by this projection, even if an unexpected response contains them. */
export type PublicGalleryGift = PublicGalleryGiftDTO;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown, maximum: number) => typeof value === 'string' && value.length <= maximum ? value : '';
function media(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u001f\u007f\\]/.test(value)) return;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) return value; } catch { /* Unusable media stays absent. */ }
}

export function publicGiftPath(id: string, inside = false): string {
  if (!uuid.test(id)) throw new Error('This public gift could not be verified.');
  return `generated/${encodeURIComponent(id)}?public=1${inside ? '&view=world' : ''}`;
}

export function publicGiftData(value: unknown, now = Date.now() / 1000): GeneratedGiftData | undefined {
  if (!value || typeof value !== 'object') return;
  const gift = value as PublicGalleryGift;
  if (!uuid.test(gift.id || '') || !text(gift.title, 120).trim()) return;
  if (gift.mediaExpiresAt !== undefined && (!Number.isFinite(gift.mediaExpiresAt) || gift.mediaExpiresAt <= now)) return;
  const worldUrl = media(gift.worldUrl); if (!worldUrl) return;
  return {
    title: text(gift.title, 120), story: '', senderName: '', photoIntent: 'place', publicLandscape: true,
    ...(gift.mediaExpiresAt === undefined ? {} : { mediaExpiresAt: gift.mediaExpiresAt }),
    worldUrl, panoramaUrl: media(gift.panoramaUrl), collisionUrl: media(gift.colliderUrl), worldSemantics: readGiftWorldSemantics(gift.worldSemantics),
    ...(Array.isArray(gift.curiosities) ? { curiosities: gift.curiosities } : {}),
  };
}

export function publicGalleryItems(values: readonly unknown[], now = Date.now() / 1000): CollectionRoomItem[] {
  const seen = new Set<string>(), items: CollectionRoomItem[] = [];
  for (const value of values.slice(0, 200)) {
    const data = publicGiftData(value, now); if (!data) continue;
    const gift = value as PublicGalleryGift; if (seen.has(gift.id)) continue; seen.add(gift.id);
    items.push({
      id: `public:${gift.id}`, title: data.title, subtitle: 'Public landscape', story: '',
      createdAt: text(gift.createdAt, 40), imageUrl: data.panoramaUrl,
      mediaExpiresAt: data.mediaExpiresAt, photoIntent: 'place',
      openPath: publicGiftPath(gift.id, true), worldPath: publicGiftPath(gift.id, true), kind: 'generated', demo: false,
    });
  }
  return items;
}

/** Public entries take precedence over matching device copies so the ordinary
 * shared desk uses a read-only route and never reveals a creator capability. */
export function mergeGalleryItems(...groups: readonly (readonly CollectionRoomItem[])[]): CollectionRoomItem[] {
  const seen = new Set<string>(), items: CollectionRoomItem[] = [];
  for (const group of groups) for (const item of group) {
    const id = item.id.replace(/^(?:public|session):/, ''); if (seen.has(id)) continue;
    seen.add(id); items.push(item);
  }
  return items;
}

async function request(action: 'list' | 'gift', signal: AbortSignal, id?: string, fetcher: typeof fetch = fetch, cursor?: string): Promise<unknown> {
  if (id !== undefined && !uuid.test(id)) throw new Error('This public gift could not be verified.');
  const abort = new AbortController(), cancel = () => abort.abort(); signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) abort.abort();
  const timeout = setTimeout(cancel, 8_000);
  try {
    const query = new URLSearchParams({ action, ...(id ? { id } : {}), ...(cursor ? { cursor } : {}) });
    const response = await fetcher(`/api/instant-gallery?${query}`, { method: 'GET', signal: abort.signal, credentials: 'same-origin', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
    const result = await response.json();
    if (signal.aborted || abort.signal.aborted) throw new DOMException('The public gallery request was closed.', 'AbortError');
    if (!response.ok || !result.ok) throw new Error('The public gallery could not be reached. Please try again.');
    return result.data;
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
}

export interface PublicLandscapePage { enabled: boolean; items: CollectionRoomItem[]; nextCursor?: string }
export async function readPublicGallery(signal: AbortSignal, fetcher: typeof fetch = fetch, cursor?: string): Promise<PublicLandscapePage> {
  const result = await request('list', signal, undefined, fetcher, cursor) as Partial<PublicGalleryListDTO> | null;
  if (!result || typeof result.enabled !== 'boolean' || !Array.isArray(result.items)) throw new Error('The public gallery could not be verified. Please try again.');
  if (result.nextCursor !== undefined && (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor.length > 1024)) throw new Error('The next gallery page could not be verified.');
  return { enabled: result.enabled, items: result.enabled ? publicGalleryItems(result.items) : [], ...(result.enabled && result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
}

export async function readPublicGift(id: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<GeneratedGiftData> {
  const result = await request('gift', signal, id, fetcher);
  if (!result || typeof result !== 'object' || (result as PublicGalleryGift).id !== id) throw new Error('This public gift could not be verified.');
  const gift = publicGiftData(result); if (!gift) throw new Error('This public gift is unavailable. Return to the gallery and try again.');
  return gift;
}
