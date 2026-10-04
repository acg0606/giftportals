import type { MediaDTO, WorldDTO } from '../shared/contracts';
import type { CollectionRoomItem } from './collection-types';

// Public showroom assets are reviewed local copies. No private job capability,
// user snapshot or provider URL is used to construct these three routes.
const showroom: readonly CollectionRoomItem[] = [
  {
    id: 'rio-example', title: 'A little piece of Rio', subtitle: 'Ready example · Tripo + World Labs',
    story: 'I wanted you to feel the warm light, the sea breeze, and the afternoon that made me think of you. Follow the light across the bay and find the little moments I left for you.',
    imageUrl: '/assets/portal-dusk/rio-keepsake.png', modelUrl: '/demo/rio-keepsake.glb', modelYaw: -Math.PI / 2,
    openPath: 'generated/rio-example', worldPath: 'generated/rio-example?view=world', kind: 'generated', demo: true, photoIntent: 'object',
  },
  {
    id: 'paris-example', title: 'An evening in Paris', subtitle: 'Ready example · Tripo + World Labs',
    story: 'Imagine an evening walk along the Seine, with the city glowing around a quiet moment. A little piece of Paris to keep close.',
    imageUrl: '/demo/v17/paris-tripo-input.png', originalImageUrl: '/demo/v13/paris-photo.jpg', modelUrl: '/demo/v17/paris-model.glb', modelYaw: -Math.PI / 2,
    openPath: 'generated/paris-example', worldPath: 'generated/paris-example?view=world', kind: 'generated', demo: true, photoIntent: 'place', objectRepresentation: 'souvenir-miniature',
  },
  {
    id: 'antikythera-example', title: 'A world of human curiosity', subtitle: 'Ready example · Tripo + World Labs',
    story: 'A little tribute to the people who turned questions about the sky into gears. Imagine carrying that curiosity into a world of your own.',
    imageUrl: '/demo/v13/antikythera-photo.jpg', modelUrl: '/demo/v13/antikythera-model.glb', modelYaw: -Math.PI / 2,
    openPath: 'generated/antikythera-example', worldPath: 'generated/antikythera-example?view=world', kind: 'generated', demo: true, photoIntent: 'object',
  },
];

export function publicCollectionItems(): CollectionRoomItem[] {
  return showroom.map(item => ({ ...item }));
}

function usableMedia(media: MediaDTO, now: number, image: boolean): boolean {
  if (!Number.isFinite(media.expiresAt) || media.expiresAt < 0 || media.expiresAt !== 0 && media.expiresAt <= now) return false;
  const value = media.url;
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true;
  // Existing fictional illustrations use image-only data URLs; executable or
  // general data schemes are never projected into the room.
  if (image && /^data:image\/(?:png|jpeg|webp|svg\+xml)(?:;[^,]*)?,/i.test(value)) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

/** Projection only: the caller has already authorized this WorldDTO. It never
 * expands access from sent/received metadata, persists state or refreshes URLs.
 * Expiration is in Unix seconds; the caller scopes memory routes to its persona. */
export function collectionItemsFromWorld(world: WorldDTO, nowSeconds = Date.now() / 1000): CollectionRoomItem[] {
  const now = Number.isFinite(nowSeconds) ? nowSeconds : Date.now() / 1000;
  const seen = new Set<string>(), result: CollectionRoomItem[] = [];
  for (const memory of world.memories) {
    if (memory.archivedAt || !memory.id || seen.has(memory.id)) continue;
    seen.add(memory.id);
    const image = memory.media.find(media => media.kind === 'gift-photo' && media.mimeType.startsWith('image/') && usableMedia(media, now, true))
      || memory.media.find(media => media.kind === 'place-photo' && media.mimeType.startsWith('image/') && usableMedia(media, now, true));
    const model = memory.media.find(media => media.kind === 'model' && media.mimeType === 'model/gltf-binary' && usableMedia(media, now, false));
    const spatialWorld = memory.media.find(media => media.kind === 'world' && media.mimeType === 'application/octet-stream' && usableMedia(media, now, false));
    const expires = [image, model, spatialWorld].filter((media): media is MediaDTO => !!media && media.expiresAt > 0).map(media => media.expiresAt);
    const path = `memory/${encodeURIComponent(memory.id)}`;
    const relationship = memory.ownerId === world.user.id ? 'Your memory' : `Received from ${memory.ownerName.trim() || 'someone special'}`;
    const place = memory.shareLocation === true ? memory.location.label.trim() : '';
    result.push({
      id: memory.id, title: memory.title, subtitle: `${relationship}${place ? ` · ${place}` : ''}`, story: memory.story,
      ...(image ? { imageUrl: image.url } : {}), ...(model ? { modelUrl: model.url } : {}),
      ...(expires.length ? { mediaExpiresAt: Math.min(...expires) } : {}),
      openPath: path, ...(spatialWorld ? { worldPath: `${path}?view=world` } : {}),
      kind: 'memory', demo: memory.demo,
    });
  }
  return result;
}
