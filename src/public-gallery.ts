import type { CollectionRoomItem } from './collection-types';
import type { GeneratedGiftData } from './generated-gift';
import { readGiftWorldSemantics } from './gift-walk-catalog';
import type { PublicGalleryGiftDTO, PublicGalleryListDTO } from '../shared/instant-gallery';
import type { CuriosityFact } from '../shared/gift-curiosities';
import type { InstantSourceAttribution } from '../shared/instant-examples';
import { readPublicWorldOverlay } from './public-world-overlay';
import { publicExamplePresentation, presentedPublicExampleItem } from './public-example-presentation';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown, maximum: number) => typeof value === 'string' && value.length <= maximum ? value : '';
function media(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u001f\u007f\\]/.test(value)) return;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) return value; } catch { /* Invalid media stays absent. */ }
}
function attribution(value: unknown): InstantSourceAttribution | undefined {
  if (!value || typeof value !== 'object') return;
  const source = value as Partial<InstantSourceAttribution>, author = text(source.author,160), license = text(source.license,80);
  const sourceUrl = media(source.sourceUrl), licenseUrl = media(source.licenseUrl);
  if (!author || !license || !sourceUrl?.startsWith('https://') || !licenseUrl?.startsWith('https://')) return;
  const changes = text(source.changes,600);
  return { author, license, sourceUrl, licenseUrl, ...(changes ? {changes} : {}) };
}
function facts(value: unknown): CuriosityFact[] | undefined {
  if (!Array.isArray(value)) return;
  return value.slice(0,2).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const fact = item as Partial<CuriosityFact>, id = text(fact.id,120), title = text(fact.title,160), content = text(fact.text,1600);
    const sourceTitle = text(fact.sourceTitle,200), sourceUrl = media(fact.sourceUrl);
    if (!id || !title || !content || !sourceTitle || !sourceUrl?.startsWith('https://') || !['object','region'].includes(fact.subject || '')) return [];
    const regionId = text(fact.regionId,120), objectHint = text(fact.objectHint,120);
    return [{id,title,text:content,sourceTitle,sourceUrl,subject:fact.subject!,...(regionId?{regionId}:{}),...(objectHint?{objectHint}:{})}];
  });
}
export function publicGiftPath(id: string, inside = false): string {
  if (!uuid.test(id)) throw new Error('This public souvenir could not be verified.');
  return `generated/${encodeURIComponent(id)}?public=1${inside ? '&view=world' : ''}`;
}
/** Construct only the published souvenir projection; owner capabilities are
 * never adopted even if the server accidentally returns an additional field. */
export function publicGiftData(value: unknown, now = Date.now() / 1000): GeneratedGiftData | undefined {
  if (!value || typeof value !== 'object') return;
  const gift = value as PublicGalleryGiftDTO;
  if (!uuid.test(gift.id || '') || !text(gift.title,120).trim()
    || !Number.isFinite(gift.mediaExpiresAt) || gift.mediaExpiresAt <= now) return;
  const modelUrl = media(gift.modelUrl), worldUrl = media(gift.worldUrl), originalUrl = media(gift.sourcePhotoUrl);
  if ((!modelUrl && !worldUrl) || !originalUrl || !['object','place'].includes(gift.photoIntent)
    || !['original-object','derived-object','souvenir-miniature'].includes(gift.objectRepresentation)) return;
  const sourceAttribution = attribution(gift.sourceAttribution), curiosities = facts(gift.curiosities);
  return {
    title: text(gift.title,120), story: text(gift.story,1200), dedication: text(gift.dedication,280),
    senderName: text(gift.senderName,80), recipientName: text(gift.recipientName,80),
    photoIntent: gift.photoIntent, objectRepresentation: gift.objectRepresentation,
    originalUrl, modelUrl, worldUrl, panoramaUrl: media(gift.panoramaUrl), collisionUrl: media(gift.colliderUrl),
    keepsakeImageUrl: media(gift.keepsakeImageUrl),
    mediaExpiresAt: gift.mediaExpiresAt, worldSemantics: readGiftWorldSemantics(gift.worldSemantics),
    ...(sourceAttribution ? {sourceAttribution} : {}), ...(curiosities ? {curiosities} : {}),
    ...publicExamplePresentation(gift.id),
  };
}
export function publicGalleryItems(values: readonly unknown[], now = Date.now() / 1000): CollectionRoomItem[] {
  const seen = new Set<string>(), items: CollectionRoomItem[] = [];
  for (const value of values.slice(0,200)) {
    const gift = value as PublicGalleryGiftDTO, data = publicGiftData(value,now);
    if (!data || seen.has(gift.id)) continue; seen.add(gift.id);
    items.push({ id: `public:${gift.id}`, title: data.title, subtitle: `Shared souvenir · ${data.modelUrl && data.worldUrl ? 'Tripo + World Labs' : data.modelUrl ? 'Tripo' : 'World Labs'}`,
      story: data.story, createdAt: text(gift.createdAt,40),
      imageUrl: media(gift.thumbnailUrl) || data.originalUrl, originalImageUrl: data.originalUrl,
      ...(data.modelUrl ? { modelUrl: data.modelUrl } : {}),
      mediaExpiresAt: data.mediaExpiresAt, photoIntent: data.photoIntent, objectRepresentation: data.objectRepresentation,
      openPath: publicGiftPath(gift.id), ...(data.worldUrl ? { worldPath: publicGiftPath(gift.id,true) } : {}),
      kind: 'generated', demo: false });
  }
  return items;
}
export function mergeGalleryItems(...groups: readonly (readonly CollectionRoomItem[])[]): CollectionRoomItem[] {
  const seen = new Set<string>(), items: CollectionRoomItem[] = [];
  // The built-in Rio replaces this one reviewed archive mirror on the desk.
  // Its public gift and saved media remain available through their own routes.
  const hasRioShowroom = groups.some(group => group.some(item => item.id === 'rio-example' && item.demo));
  const legacyRioId = 'cbb27b09-92ea-41d9-a54a-e93b4438bd7a';
  for (const group of groups) for (const item of group) {
    const id = item.id.replace(/^(?:public|session):/,'');
    if (hasRioShowroom && /^(?:public|session):/.test(item.id) && id === legacyRioId) continue;
    if (!seen.has(id)) { seen.add(id); items.push(presentedPublicExampleItem(item)); }
  }
  return items;
}
async function request(action:'list'|'gift',signal:AbortSignal,id?:string,fetcher:typeof fetch=fetch,cursor?:string):Promise<unknown> {
  if (id !== undefined && !uuid.test(id)) throw new Error('This public souvenir could not be verified.');
  const abort = new AbortController(), cancel = () => abort.abort(); signal.addEventListener('abort',cancel,{once:true});
  if (signal.aborted) abort.abort(); const timeout = setTimeout(cancel,10_000);
  try {
    const query = new URLSearchParams({action,...(id?{id}:{}),...(cursor?{cursor}:{})});
    const response = await fetcher(`/api/instant-gallery?${query}`,{method:'GET',signal:abort.signal,
      credentials:'same-origin',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store'});
    const result = await response.json();
    if (signal.aborted || abort.signal.aborted) throw new DOMException('The souvenir request was closed.','AbortError');
    if (!response.ok || !result.ok) throw new Error('The shared souvenirs could not be reached. Please try again.');
    return result.data;
  } finally { clearTimeout(timeout); signal.removeEventListener('abort',cancel); }
}
export interface PublicSouvenirPage { enabled:boolean; items:CollectionRoomItem[]; nextCursor?:string }
export async function readPublicGallery(signal:AbortSignal,fetcher:typeof fetch=fetch,cursor?:string):Promise<PublicSouvenirPage> {
  const result = await request('list',signal,undefined,fetcher,cursor) as Partial<PublicGalleryListDTO>|null;
  if (!result || typeof result.enabled !== 'boolean' || !Array.isArray(result.items)
    || result.nextCursor !== undefined && (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor.length>1024))
    throw new Error('The shared souvenirs could not be verified. Please try again.');
  return {enabled:result.enabled,items:result.enabled?publicGalleryItems(result.items):[],...(result.nextCursor?{nextCursor:result.nextCursor}:{})};
}
export async function readPublicGift(id:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<GeneratedGiftData> {
  const result = await request('gift',signal,id,fetcher);
  if (!result || typeof result !== 'object' || (result as PublicGalleryGiftDTO).id !== id)
    throw new Error('This public souvenir could not be verified.');
  const gift = publicGiftData(result);
  if (!gift) throw new Error('This public souvenir is unavailable. Return to the collection and try again.');
  return readPublicWorldOverlay(id, gift, signal, fetcher);
}
