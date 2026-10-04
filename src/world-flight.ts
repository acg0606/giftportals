export type WorldFlightProfile = 'coast' | 'river' | 'river-plus' | 'terrace' | 'generic';
export type WorldFlightVector = readonly [number, number, number];
export interface WorldFlightPose { position: WorldFlightVector; target: WorldFlightVector; fov: number }
export interface WorldFlightPoint { id: string; position: WorldFlightVector }
export interface WorldFlightRoute { arrival: readonly WorldFlightPose[]; viewpoints: readonly { pointId: string; pose: WorldFlightPose }[] }

/** A completed artistic scene can have its own reviewed camera corridor. Never
 * trust manifest coordinates as camera instructions before checking bounds,
 * unique story IDs and a non-degenerate look direction. */
export function validatedWorldFlightRoute(value: unknown, pointIds?: readonly string[]): WorldFlightRoute | undefined {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.arrival) || record.arrival.length < 2 || record.arrival.length > 12 || !Array.isArray(record.viewpoints) || !record.viewpoints.length || record.viewpoints.length > 6) return;
  const pose = (input: unknown): WorldFlightPose | undefined => {
    if (!input || typeof input !== 'object') return;
    const candidate = input as Record<string, unknown>;
    const vector = (entry: unknown): entry is [number, number, number] => Array.isArray(entry) && entry.length === 3 && entry.every(component => typeof component === 'number' && Number.isFinite(component) && Math.abs(component) <= 20);
    if (!vector(candidate.position) || !vector(candidate.target) || typeof candidate.fov !== 'number' || !Number.isFinite(candidate.fov) || candidate.fov < 56 || candidate.fov > 76) return;
    if (Math.hypot(...candidate.position.map((component, index) => component - (candidate.target as number[])[index])) < .3) return;
    return { position: [...candidate.position] as [number, number, number], target: [...candidate.target] as [number, number, number], fov: candidate.fov };
  };
  const arrival = record.arrival.map(pose);
  if (arrival.some(frame => !frame)) return;
  const ids = new Set<string>(), viewpoints: { pointId: string; pose: WorldFlightPose }[] = [];
  for (const input of record.viewpoints) {
    if (!input || typeof input !== 'object') return;
    const point = input as Record<string, unknown>, frame = pose(point.pose);
    if (typeof point.pointId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(point.pointId) || ids.has(point.pointId) || pointIds && !pointIds.includes(point.pointId) || !frame) return;
    ids.add(point.pointId); viewpoints.push({ pointId: point.pointId, pose: frame });
  }
  if (pointIds && (pointIds.length !== viewpoints.length || pointIds.some(id => !ids.has(id)))) return;
  return { arrival: arrival as WorldFlightPose[], viewpoints };
}

/** Authored camera corridors in the provider's artistic Y-up scene coordinates.
 * These are not geographic measurements or surveyed landmark positions. */
const POSITIONS: Record<WorldFlightProfile, readonly WorldFlightVector[]> = {
  coast: [[-1.3, .45, 1.3], [-3, 2.2, -1.1], [1.7, 1.15, -3.4], [.3, 2.7, -.3], [-2, .6, 2], [2.8, 1.5, .8]],
  river: [[-1.3, .35, 1.3], [-1.5, .3, -.8], [1.4, .5, -2.7], [1.3, .85, 1.1], [-1.6, .35, .6], [2.2, .9, -.7]],
  // The V22 Plus scene begins on a narrower promenade. Small lateral passes
  // keep its bridge and river in view without entering their reconstructed mesh.
  'river-plus': [[-.5, .08, .55], [-.65, .12, -.2], [.55, .12, .4], [.15, .22, .7], [-.8, .18, .55], [.75, .18, .7]],
  terrace: [[-1.6, .7, 1.7], [-1.1, .8, -.9], [1.3, 1.2, -.2], [.6, 2.1, -2.8], [-2.4, .8, 1.2], [2.3, 1.2, .6]],
  generic: [[-.8, .4, .9], [-1.35, .95, -.5], [1.1, .65, -1.5], [.35, 1.1, .6], [-1.1, .45, 1.2], [1.35, .85, .2]],
};
const ARRIVALS: Record<WorldFlightProfile, readonly [WorldFlightVector, WorldFlightVector]> = {
  coast: [[-4, 2, 4], [-2, .9, 2.5]],
  river: [[1.8, 1.2, -5], [1.3, .7, -2.5]],
  'river-plus': [[-.2, .3, 1.4], [-.35, .18, .95]],
  terrace: [[-.7, 1.4, 3.6], [-1, .95, 2.4]],
  generic: [[-1.8, 1.45, 2.8], [-1.2, .9, 1.4]],
};
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const finiteVector = (value: readonly number[]): value is WorldFlightVector => value.length === 3 && value.every(Number.isFinite);
const rotate = (value: WorldFlightVector, yaw: number): WorldFlightVector => {
  const [x, y, z] = value;
  return [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];
};
const sane = (value: WorldFlightVector): WorldFlightVector => [clamp(value[0], -12, 12), clamp(value[1], -1, 6), clamp(value[2], -12, 12)];

export function createWorldFlightRoute(points: readonly WorldFlightPoint[], profile: WorldFlightProfile = 'generic', initialYaw = 0): WorldFlightRoute {
  const selected = Object.hasOwn(POSITIONS, profile) ? profile : 'generic';
  const yaw = Number.isFinite(initialYaw) ? clamp(initialYaw, -Math.PI, Math.PI) : 0;
  const valid = points.filter(point => point && typeof point.id === 'string' && point.id.length > 0 && Array.isArray(point.position) && finiteVector(point.position)).slice(0, 6);
  const viewpoints = valid.map((point, index) => {
    const position = rotate(POSITIONS[selected][index], yaw), target = sane(point.position);
    // A malformed coincident narrative anchor must not make lookAt degenerate.
    const separation = Math.hypot(...position.map((value, axis) => value - target[axis]));
    const corrected: WorldFlightVector = separation < .3 ? [target[0], target[1] + .5, target[2] + 1] : position;
    return { pointId: point.id, pose: { position: corrected, target, fov: index % 2 ? 64 : 68 } };
  });
  if (!viewpoints.length) return { arrival: [], viewpoints: [] };
  const first = viewpoints[0].pose, [start, via] = ARRIVALS[selected];
  // Begin with the wider scenery, then lower the gaze toward its narrative
  // anchor as the real camera approaches. This avoids framing nearby ground
  // as if it were the whole environment during the distant establishing view.
  const scenicTarget: WorldFlightVector = selected === 'river-plus'
    ? [first.target[0], first.target[1] + .25, first.target[2] - .4]
    : [first.target[0], first.target[1] + 1.6, first.target[2] - 2];
  const approachTarget: WorldFlightVector = selected === 'river-plus'
    ? [first.target[0], first.target[1] + .12, first.target[2] - .2]
    : [first.target[0], first.target[1] + .8, first.target[2] - 1];
  return { viewpoints, arrival: [
    { position: rotate(start, yaw), target: scenicTarget, fov: 76 },
    { position: rotate(via, yaw), target: approachTarget, fov: 72 }, first,
  ] };
}

/** Smooth, bounded three-dimensional interpolation. Catmull-Rom tangents join
 * the arrival's spatial keyframes; smootherstep gently starts and lands. */
export function sampleWorldFlight(path: readonly WorldFlightPose[], progress: number): WorldFlightPose {
  if (!path.length) throw new RangeError('A flight requires at least one camera pose.');
  if (path.length === 1) return path[0];
  const t = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  if (t === 0) return path[0];
  if (t === 1) return path[path.length - 1];
  const eased = t * t * t * (t * (t * 6 - 15) + 10), cursor = eased * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(cursor)), local = cursor - index;
  const p0 = path[Math.max(0, index - 1)], p1 = path[index], p2 = path[index + 1], p3 = path[Math.min(path.length - 1, index + 2)];
  const cubic = (a: number, b: number, c: number, d: number) => .5 * ((2 * b) + (-a + c) * local + (2 * a - 5 * b + 4 * c - d) * local * local + (-a + 3 * b - 3 * c + d) * local * local * local);
  const vector = (field: 'position' | 'target'): WorldFlightVector => [0, 1, 2].map(axis => {
    const values = [p0[field][axis], p1[field][axis], p2[field][axis], p3[field][axis]];
    // Avoid spline overshoot into unseen scenery beyond authored keyframes.
    return clamp(cubic(...values as [number, number, number, number]), Math.min(...values), Math.max(...values));
  }) as unknown as WorldFlightVector;
  return { position: vector('position'), target: vector('target'), fov: clamp(cubic(p0.fov, p1.fov, p2.fov, p3.fov), 56, 76) };
}

export function connectWorldFlight(from: WorldFlightPose, to: WorldFlightPose): readonly WorldFlightPose[] {
  return [from, to];
}
