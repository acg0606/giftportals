import type { MemoryDTO, WorldDTO } from '../shared/contracts';
import { projectWorldToGlobe } from './globe-data.ts';
import { MAP_PLACES, placePath } from './map-data.ts';

export type JourneyScope =
  | { readonly kind: 'public-demo'; readonly persona: 'sender' | 'recipient'; readonly epoch: number }
  | { readonly kind: 'owner'; readonly actorId: string; readonly epoch: number };
export interface JourneyMemory { readonly memory: MemoryDTO; readonly publicPlaceId?: string }
export interface JourneyProgress { readonly object: boolean; readonly place: boolean; readonly story: boolean; readonly kept: boolean }
export interface JourneyState {
  readonly scope: JourneyScope;
  readonly progress: Readonly<Record<string, JourneyProgress>>;
  /** Semantic snapshots remain in memory only; never serialize this state or log it. */
  readonly fingerprints: Readonly<Record<string, string>>;
}
export interface JourneyEvent {
  readonly scopeEpoch: number;
  readonly memoryId: string;
  readonly type: 'reveal-object' | 'reveal-place' | 'reveal-story' | 'keep';
}
export type DemoFixtureKey = 'bird' | 'sea' | 'paris';

const blank: JourneyProgress = Object.freeze({ object: false, place: false, story: false, kept: false });
// These UUIDs are public fixture identities from supabase/seed-demo.mjs, not user IDs.
const fixtures: readonly { key: DemoFixtureKey; ids: readonly string[]; placeId: string; author: string; persona: 'sender' | 'recipient' }[] = [
  { key: 'bird', ids: ['demo-perdizes-cup', 'ef287aa8-d3cc-4ed5-a5dc-49898be53105'], placeId: 'tuca', author: 'Maya', persona: 'sender' },
  { key: 'sea', ids: ['demo-santos-shell', 'cbf95d13-5952-4c52-a3c1-30e4fa467ff0'], placeId: 'museu-pele', author: 'Maya', persona: 'sender' },
  { key: 'paris', ids: ['demo-paris-bird', '015396be-c9b1-46f3-afda-b93d66eb0e41'], placeId: 'paris', author: 'Noah', persona: 'recipient' },
];

/** Exact known public fixtures only; a private memory at the same place is never a demo. */
export function demoFixtureKey(memory: MemoryDTO): DemoFixtureKey | undefined {
  if (memory.demo !== true || memory.shareLocation !== true || memory.archivedAt
    || memory.location?.source !== 'fictional-demo') return undefined;
  return fixtures.find(fixture => fixture.ids.includes(memory.id) && fixture.placeId === memory.location.placeId
    && fixture.author === memory.ownerName)?.key;
}

function validScope(scope: JourneyScope): boolean {
  return Number.isSafeInteger(scope.epoch) && scope.epoch >= 0 && (scope.kind === 'owner'
    ? typeof scope.actorId === 'string' && scope.actorId.trim().length > 0
    : scope.kind === 'public-demo' && (scope.persona === 'sender' || scope.persona === 'recipient'));
}
function scopeKey(scope: JourneyScope): string {
  return JSON.stringify(scope.kind === 'owner' ? ['owner', scope.actorId, scope.epoch] : ['public-demo', scope.persona, scope.epoch]);
}
function sameScope(first: JourneyScope, second: JourneyScope): boolean {
  return validScope(first) && validScope(second) && scopeKey(first) === scopeKey(second);
}
// The array is an ephemeral capability for this scope. Copies and arbitrary memory arrays
// deliberately lose provenance; reducers must receive the original journeyCatalog result.
const catalogScopes = new WeakMap<readonly JourneyMemory[], JourneyScope>();
function currentCatalog(catalog: readonly JourneyMemory[], scope: JourneyScope): boolean {
  const origin = catalogScopes.get(catalog);
  return !!origin && sameScope(origin, scope);
}
function record<T>(): Record<string, T> { return Object.create(null) as Record<string, T>; }
function state(scope: JourneyScope, progress: Record<string, JourneyProgress>, fingerprints: Record<string, string>): JourneyState {
  return Object.freeze({ scope: Object.freeze({ ...scope }), progress: Object.freeze(progress), fingerprints: Object.freeze(fingerprints) });
}

/**
 * A semantic comparison, not a persisted identifier. Signed URLs and their expiry are
 * intentionally absent: immutable media IDs describe content, refreshed links do not.
 * These strings contain authorized content and MUST stay in this in-memory engine.
 */
function fingerprint(entry: JourneyMemory): string | undefined {
  const memory = entry.memory;
  if (typeof memory.id !== 'string' || !memory.id || typeof memory.ownerId !== 'string' || !memory.ownerId
    || typeof memory.title !== 'string' || typeof memory.story !== 'string' || !memory.location
    || typeof memory.location.placeId !== 'string' || !Array.isArray(memory.media)) return undefined;
  try {
    const media = memory.media.map(item => [item.id, item.kind, item.mimeType, item.bytes, item.generated, item.provider ?? null])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return JSON.stringify([memory.id, memory.ownerId, memory.ownerName, memory.title, memory.story, memory.artisticNote,
      memory.demo, memory.shareLocation ?? null, memory.aiConsent ?? null, memory.archivedAt ?? null, memory.createdAt,
      memory.location.placeId, memory.location.label, memory.location.latitude, memory.location.longitude,
      memory.location.source, memory.location.experiencedAt, entry.publicPlaceId ?? null,
      memory.objectStatus, memory.environmentStatus, media]);
  } catch { return undefined; }
}

/** Current authorized story subset. Geography comes only from published catalog anchors. */
export function journeyCatalog(world: WorldDTO, scope: JourneyScope): JourneyMemory[] {
  const catalog: JourneyMemory[] = [];
  catalogScopes.set(catalog, Object.freeze({ ...scope }));
  // Preserve the requested array API while preventing a stamped empty catalog from
  // being filled later with unrelated DTOs. Its current-world membership is fixed.
  const complete = () => Object.freeze(catalog) as unknown as JourneyMemory[];
  if (!validScope(scope)) return complete();
  const owner = scope.kind === 'owner' && world.user.demo === false && world.user.id === scope.actorId;
  let publicDemo = scope.kind === 'public-demo' && world.user.demo === true;
  if (publicDemo && scope.kind === 'public-demo') {
    // Persona names alone are insufficient. Its own exact fixture must establish the
    // current world actor; an unrelated demo world cannot borrow Maya/Noah's trail.
    const authors = new Set(world.memories.filter(memory => {
      const key = demoFixtureKey(memory);
      return !!key && fixtures.find(fixture => fixture.key === key)?.persona === scope.persona;
    }).map(memory => memory.ownerId));
    publicDemo = authors.size === 1 && authors.has(world.user.id)
      && world.user.displayName === (scope.persona === 'sender' ? 'Maya' : 'Noah');
  }
  if (!owner && !publicDemo) return complete();
  const received = new Set(world.received.filter(gift => !gift.revokedAt && gift.claimedBy === world.user.id).map(gift => gift.memoryId));
  const geography = projectWorldToGlobe(world, owner
    ? { scope: 'owner', viewerId: world.user.id } : { scope: 'public-demo' });
  const places = new Map(geography.places.flatMap(place => place.memoryIds.map(id => [id, place.id] as const)));
  const entries = new Map<string, JourneyMemory>(), conflicts = new Set<string>();
  for (const memory of world.memories) {
    if (memory.archivedAt || (memory.ownerId !== world.user.id && !received.has(memory.id))) continue;
    if (publicDemo && !demoFixtureKey(memory)) continue;
    // Active claimed stories remain readable when their place is hidden. No geography
    // is attached, even if a stale/malicious DTO still contains a catalog place ID.
    const publicPlaceId = memory.ownerId === world.user.id || memory.shareLocation === true ? places.get(memory.id) : undefined;
    const entry: JourneyMemory = Object.freeze({ memory, ...(publicPlaceId ? { publicPlaceId } : {}) });
    const nextFingerprint = fingerprint(entry);
    if (!nextFingerprint) continue;
    const previous = entries.get(memory.id);
    if (previous && fingerprint(previous) !== nextFingerprint) conflicts.add(memory.id);
    else entries.set(memory.id, entry);
  }
  for (const id of conflicts) entries.delete(id);
  catalog.push(...entries.values());
  return complete();
}

/** Session state only. No browser storage, tokens, gifts, discoveries, or network writes. */
export function newJourney(scope: JourneyScope): JourneyState {
  if (!validScope(scope)) throw new Error('A valid journey session scope is required.');
  return state(scope, record(), record());
}
export function journeyProgress(current: JourneyState, memoryId: string): JourneyProgress {
  return Object.hasOwn(current.progress, memoryId) ? current.progress[memoryId] : blank;
}

/** Recompute from latest permissions/content; stale kept cards cannot grant access. */
export function reconcileJourney(current: JourneyState, catalog: readonly JourneyMemory[], scope: JourneyScope): JourneyState {
  const empty = newJourney(scope);
  if (!currentCatalog(catalog, scope)) return empty;
  const progress = record<JourneyProgress>(), fingerprints = record<string>();
  for (const entry of catalog) {
    const nextFingerprint = fingerprint(entry);
    if (!nextFingerprint) continue;
    const id = entry.memory.id;
    fingerprints[id] = nextFingerprint;
    progress[id] = sameScope(current.scope, scope) && current.fingerprints[id] === nextFingerprint
      ? journeyProgress(current, id) : blank;
  }
  return state(scope, progress, fingerprints);
}

/** Explicit reveals only. "Kept" means digitally explored in this session, never claimed. */
export function reduceJourney(current: JourneyState, catalog: readonly JourneyMemory[], event: JourneyEvent): JourneyState {
  if (!currentCatalog(catalog, current.scope)) return current;
  const next = reconcileJourney(current, catalog, current.scope);
  if (event.scopeEpoch !== next.scope.epoch || !Object.hasOwn(next.fingerprints, event.memoryId)) return next;
  const before = journeyProgress(next, event.memoryId);
  let after: JourneyProgress;
  switch (event.type) {
    case 'reveal-object': after = { ...before, object: true }; break;
    case 'reveal-place': after = { ...before, place: true }; break;
    case 'reveal-story': after = { ...before, story: true }; break;
    case 'keep':
      if (!before.object || !before.place || !before.story) return next;
      after = { ...before, kept: true }; break;
    default: return next;
  }
  const progress = Object.assign(record<JourneyProgress>(), next.progress, { [event.memoryId]: Object.freeze(after) });
  return state(next.scope, progress, Object.assign(record<string>(), next.fingerprints));
}

function anchor(placeId?: string) {
  if (!placeId) return undefined;
  const place = MAP_PLACES.find(candidate => candidate.id === placeId);
  if (!place || place.kind !== 'point' || typeof place.lat !== 'number' || typeof place.lon !== 'number'
    || !Number.isFinite(place.lat) || !Number.isFinite(place.lon) || !place.coordinateSourceUrl || !place.coordinateNote) return undefined;
  return { latitude: place.lat, longitude: place.lon,
    municipality: placePath(place.id).find(ancestor => ancestor.kind === 'municipality')?.id };
}
function distance(first: NonNullable<ReturnType<typeof anchor>>, second: NonNullable<ReturnType<typeof anchor>>): number {
  const radians = Math.PI / 180;
  const deltaLat = (second.latitude - first.latitude) * radians, deltaLon = (second.longitude - first.longitude) * radians;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(first.latitude * radians) * Math.cos(second.latitude * radians) * Math.sin(deltaLon / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

/** Relative proximity between published landmarks, never proximity to a person's GPS. */
export function nextJourneyMemory(catalog: readonly JourneyMemory[], current: JourneyState, currentId: string): JourneyMemory | undefined {
  if (!currentCatalog(catalog, current.scope)) return undefined;
  const reconciled = reconcileJourney(current, catalog, current.scope);
  const origin = anchor(catalog.find(entry => entry.memory.id === currentId)?.publicPlaceId);
  const candidates = catalog.filter(entry => entry.memory.id !== currentId && !journeyProgress(reconciled, entry.memory.id).kept);
  return [...candidates].sort((first, second) => {
    const a = anchor(first.publicPlaceId), b = anchor(second.publicPlaceId);
    if (origin) {
      const aSame = !!a && a.municipality === origin.municipality, bSame = !!b && b.municipality === origin.municipality;
      if (aSame !== bSame) return aSame ? -1 : 1;
      if (a && b) {
        const difference = distance(origin, a) - distance(origin, b);
        if (difference) return difference;
      }
    }
    if (!!a !== !!b) return a ? -1 : 1;
    return first.memory.id.localeCompare(second.memory.id);
  })[0];
}
