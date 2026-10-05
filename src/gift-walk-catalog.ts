import type { GeneratedGiftData } from './generated-gift';
import type { WalkScene } from './gift-walk-types';
import type { LivingGardenRoute } from './living-garden';

export interface GiftWorldSemantics { metricScaleFactor: number; groundPlaneOffset: number }
export function readGiftWorldSemantics(value: unknown): GiftWorldSemantics | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>, scale = record.metricScaleFactor, offset = record.groundPlaneOffset;
  return typeof scale === 'number' && Number.isFinite(scale) && scale >= .05 && scale <= 100 && typeof offset === 'number' && Number.isFinite(offset) && Math.abs(offset) <= 500
    ? { metricScaleFactor: scale, groundPlaneOffset: offset } : undefined;
}
export function readGiftWorldSpawn(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3 || ![0, 1, 2].every(index => typeof value[index] === 'number' && Number.isFinite(value[index]) && Math.abs(value[index]) <= 250)) return undefined;
  return [value[0], value[1], value[2]];
}
export function readGiftWorldEyeHeight(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= .5 && value <= 3 ? value : undefined;
}
const parisRoutes: readonly LivingGardenRoute[] = [
  { start: [4.1, -6.65], end: [6.55, -6.5], initialProgress: .1 },
  { start: [5.15, -8], end: [7.5, -7.9], initialProgress: .35, reverse: true },
];
const observatoryRoutes: readonly LivingGardenRoute[] = [
  { start: [-.75, -2.25], end: [.8409902576697321, -3.8409902576697323], initialProgress: .1 },
  { start: [.75, -2.25], end: [2.3409902576697323, -3.8409902576697323], initialProgress: .35, reverse: true },
];
type Profile = { name: string; title: string; intro: string; mode: 'book' | 'newspaper' | 'tablet'; scale: number; offset: number; world?: string; collider?: string; panorama?: string; routes: readonly LivingGardenRoute[]; probeY: number; viewpoints: readonly { id?: string; name: string; at: readonly [number, number, number]; yaw: number }[] };
// Scale metadata was recovered only after SHA256 matching each public collider
// to its completed provider receipt. Every viewpoint/reset and visitor corridor
// was probed against that mesh with the actual Rapier controller.
const profiles: Record<string, Profile> = {
  'paris-example': { name: 'Paris', title: 'A walk toward the tower', intro: 'Walk toward the tower. Turn your head. Take your time.', mode: 'book', scale: 2.9049978, offset: 1.6893421, world: '/demo/v23/paris-approach-world.spz', collider: '/demo/v23/paris-approach-collider.glb', panorama: '/demo/v23/paris-approach-panorama.png', routes: parisRoutes, probeY: 1.5,
    viewpoints: [{ name: 'The tower gardens', at: [0, 1.329693672, 0], yaw: 0 }, { name: 'Closer to the tower', at: [-.002786, 1.341834, -4.001120], yaw: 0 }, { name: 'Across the gardens', at: [-3.540262, 1.326496, -3.536546], yaw: -Math.PI / 4 }] },
  'antikythera-example': { name: 'The observatory', title: 'A walk through human curiosity', intro: 'Explore the terrace. Follow a little curiosity.', mode: 'tablet', scale: 2.4615827, offset: 1.4774647, routes: observatoryRoutes, probeY: 2.15062,
    viewpoints: [{ name: 'The observatory', at: [0, 1.550620, 0], yaw: 0 }, { name: 'The open terrace', at: [-.006870, 1.572490, -3.999109], yaw: 0 }, { name: 'A different perspective', at: [-3.535949, 1.568981, -3.534971], yaw: -Math.PI / 4 }] },
};
export function createGiftWalkScenes(id: string, gift: GeneratedGiftData): readonly WalkScene[] {
  if (gift.mediaExpiresAt && gift.mediaExpiresAt <= Date.now() / 1000) return [];
  const profile = Object.hasOwn(profiles, id) ? profiles[id] : undefined;
  const world = profile?.world || gift.worldUrl, collider = profile?.collider || gift.collisionUrl || gift.colliderUrl;
  if (!world || !collider) return [];
  const story = [gift.dedication?.trim(), gift.story?.trim()].filter(Boolean).join('\n\n') || 'A little place to keep close. Take your time here.';
  if (profile) return profile.viewpoints.map((viewpoint, index) => ({
    id: viewpoint.id || `${id}-${index}`, name: viewpoint.name, title: profile.title, intro: profile.intro, story,
    world, collider, panorama: profile.panorama || gift.panoramaUrl, metricScale: profile.scale, groundOffset: profile.offset,
    mediaExpiresAt: gift.mediaExpiresAt,
    spawn: [...viewpoint.at] as [number, number, number], yaw: viewpoint.yaw, pitch: id === 'paris-example' ? .18 : .04,
    maxRadius: 20, walkSpeed: 1.6, livingGarden: false, gardenRoutes: profile.routes.map(route => ({ ...route, start: [...route.start] as [number, number], end: [...route.end] as [number, number] })), groundProbeY: profile.probeY, journalMode: profile.mode,
  }));
  const semantics = readGiftWorldSemantics(gift.worldSemantics);
  const rio = id === 'rio-example';
  return [{ id: rio ? 'rio-waterside' : 'your-place', name: rio ? 'The waterside path' : 'Your place', title: rio ? 'A walk beside the bay' : gift.title, intro: rio ? 'Follow the water. Feel the place around you.' : 'Walk into your memory. Look around. Take your time.', story,
    world, collider, panorama: gift.panoramaUrl, metricScale: semantics?.metricScaleFactor, groundOffset: semantics?.groundPlaneOffset,
    mediaExpiresAt: gift.mediaExpiresAt, spawn: readGiftWorldSpawn(gift.initialSpawn), eyeHeight: readGiftWorldEyeHeight(gift.initialEyeHeight),
    yaw: gift.initialYaw ?? 0, pitch: gift.initialPitch ?? .04, maxRadius: 20, walkSpeed: 1.6, livingGarden: false, autoCalibrate: true, journalMode: rio ? 'newspaper' : 'book' }];
}
