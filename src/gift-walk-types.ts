import type { LivingGardenRoute } from './living-garden';
import type { StoryReaderMode } from './story-reader';

export type WalkPosition = readonly [number, number, number];

/** One completed world and its matching collision mesh. Coordinates refer to
 * the transformed collider; authored values are never copied between gifts. */
export interface WalkScene {
  id: string;
  name: string;
  title: string;
  story: string;
  world: string;
  collider: string;
  panorama?: string;
  metricScale?: number;
  groundOffset?: number;
  spawn?: WalkPosition;
  yaw?: number;
  pitch?: number;
  maxRadius?: number;
  walkSpeed?: number;
  /** Missing authored scale, offset or spawn asks the viewer to calibrate safely. */
  autoCalibrate?: boolean;
  livingGarden?: boolean;
  gardenRoutes?: readonly LivingGardenRoute[];
  /** A measured Y probe in the transformed scene, never a replacement floor. */
  groundProbeY?: number;
  intro?: string;
  journalMode?: StoryReaderMode;
}

/** Only an internal hash route can become the return-to-gift link. */
export function safeGiftWalkHref(value: unknown, fallback = '#/collection'): string {
  const safe = (input: unknown): input is string => typeof input === 'string' && input.length <= 2048 &&
    /^#\/[A-Za-z0-9][A-Za-z0-9/_%.~-]*(?:\?[A-Za-z0-9/_%.~!$&()*+,;=:@?-]*)?$/.test(input);
  return safe(value) ? value : safe(fallback) ? fallback : '#/collection';
}

export function walkSceneFirstPerson(scene: WalkScene) {
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return {
    spawn: scene.spawn,
    eyeHeight: 1.65,
    metricScale: scene.metricScale,
    groundOffset: scene.groundOffset,
    radius: .20,
    walkSpeed: bounded(scene.walkSpeed, 1.6, .4, 2.4),
    maxRadius: bounded(scene.maxRadius, 20, 2, 60),
    autoCalibrate: scene.autoCalibrate ?? (scene.metricScale === undefined || scene.groundOffset === undefined || scene.spawn === undefined),
    livingGarden: scene.livingGarden === true,
    gardenRoutes: scene.gardenRoutes,
    groundProbeY: scene.groundProbeY,
  };
}
