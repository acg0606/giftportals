import type { MemoryDTO, WorldDTO } from '../shared/contracts';
import { MAP_PLACES, placePath, type MapPlace } from './map-data.ts';

/** Browser-local overlays over published reference points. Never a provider request payload. */
export interface GlobePlace {
  readonly id: string;
  readonly name: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly coordinateSourceUrl: string;
  readonly coordinateNote: string;
  readonly path: readonly string[];
  readonly physicallyVisited: boolean;
  readonly memoryCount: number;
  readonly wishlistPointCount: number;
  readonly memoryIds: readonly string[];
}
export interface GlobeSnapshot {
  readonly places: readonly GlobePlace[];
  readonly unlocated: readonly { readonly id: string; readonly name: string; readonly memoryIds: readonly string[] }[];
}
export interface GlobeScope { readonly scope: 'owner' | 'public-demo'; readonly viewerId?: string }

function publishedAnchor(place: MapPlace): place is MapPlace & { lat: number; lon: number; coordinateSourceUrl: string; coordinateNote: string } {
  if (place.kind !== 'point' || typeof place.lat !== 'number' || typeof place.lon !== 'number'
    || !Number.isFinite(place.lat) || !Number.isFinite(place.lon) || Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180
    || !place.coordinateSourceUrl || !place.coordinateNote) return false;
  try {
    const source = new URL(place.coordinateSourceUrl);
    return source.protocol === 'https:' && !source.username && !source.password;
  } catch { return false; }
}

/**
 * The caller supplies its current authorized world, never a global/public-memory union.
 * Coordinates come ONLY from the sourced public catalog. Exact DTO coordinates, stories,
 * names of people, signed media and invitation capabilities never cross this boundary.
 * Parent paths are semantic groupings, not surveyed administrative polygons.
 */
export function projectWorldToGlobe(world: WorldDTO, context: GlobeScope): GlobeSnapshot {
  const byId = new Map(MAP_PLACES.map(place => [place.id, place]));
  const publicDemo = context.scope === 'public-demo' && world.user.demo === true;
  const owner = context.scope === 'owner' && world.user.demo === false && !!context.viewerId && context.viewerId === world.user.id;
  const allowed = publicDemo || owner;
  const received = new Set(allowed ? world.received
    .filter(gift => !gift.revokedAt && gift.claimedBy === world.user.id)
    .map(gift => gift.memoryId) : []);
  const memories = new Map<string, MemoryDTO>();
  const conflictingIds = new Set<string>();
  if (allowed) for (const memory of world.memories) {
    if (!memory.id || memory.archivedAt || !memory.location?.placeId || memory.location.placeId === 'world') continue;
    if (publicDemo && (memory.demo !== true || memory.shareLocation !== true)) continue;
    const ownMemory = memory.ownerId === world.user.id;
    if (!ownMemory && (!received.has(memory.id) || memory.shareLocation !== true)) continue;
    const previous = memories.get(memory.id);
    if (previous && previous.location.placeId !== memory.location.placeId) conflictingIds.add(memory.id);
    else memories.set(memory.id, memory);
  }
  for (const id of conflictingIds) memories.delete(id);
  const idsAtPlace = new Map<string, Set<string>>();
  for (const memory of memories.values()) {
    const ids = idsAtPlace.get(memory.location.placeId) ?? new Set<string>();
    ids.add(memory.id); idsAtPlace.set(memory.location.placeId, ids);
  }

  // Manual visits and wishes are independent records. Archiving a linked memory does
  // not erase an independently confirmed physical visit. Memory discoveries are derived
  // from the currently authorized memories above: stale/orphan records cannot add pins.
  const physical = new Set<string>(), wishes = new Set<string>();
  if (allowed) for (const record of world.discoveries) {
    const recordOwner = (record as { ownerId?: unknown }).ownerId;
    if (recordOwner !== undefined && recordOwner !== world.user.id) continue;
    if (publicDemo && (typeof record.source !== 'string' || !record.source.startsWith('fictional'))) continue;
    if (record.kind === 'physical') physical.add(record.placeId);
    if (record.kind === 'wish') wishes.add(record.placeId);
  }
  const places: GlobePlace[] = [];
  const unlocated = new Map<string, { id: string; name: string; memoryIds: readonly string[] }>();
  for (const place of MAP_PLACES) {
    const memoryIds = [...(idsAtPlace.get(place.id) ?? [])].sort();
    if (publishedAnchor(place)) {
      places.push({ id: place.id, name: place.name, longitude: place.lon, latitude: place.lat,
        coordinateSourceUrl: place.coordinateSourceUrl, coordinateNote: place.coordinateNote,
        path: placePath(place.id).map(ancestor => ancestor.id), physicallyVisited: physical.has(place.id),
        memoryCount: memoryIds.length, wishlistPointCount: wishes.has(place.id) ? 1 : 0, memoryIds });
    } else if (place.kind === 'point' || memoryIds.length) {
      unlocated.set(place.id, { id: place.id, name: place.name, memoryIds });
    }
  }
  for (const [id, ids] of idsAtPlace) if (!byId.has(id)) {
    // No invented position or territorial affiliation for a place outside the catalog.
    unlocated.set(id, { id, name: 'Outside the verified place catalog', memoryIds: [...ids].sort() });
  }
  return { places, unlocated: [...unlocated.values()] };
}

export function findGlobePlace(snapshot: GlobeSnapshot, id: string): GlobePlace | undefined {
  return snapshot.places.find(place => place.id === id);
}
