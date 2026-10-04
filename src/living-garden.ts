import * as THREE from 'three';
import { ExtendedTriangle, MeshBVH } from 'three-mesh-bvh';

type GardenXZ = readonly [number, number];
type GardenPosition = readonly [number, number, number];

export interface LivingGardenRoute {
  start: GardenXZ;
  end: GardenXZ;
  initialProgress?: number;
  reverse?: boolean;
}
export interface LivingGardenOptions {
  /** World-space route anchors. Both routes must pass the complete audit. */
  routes?: readonly LivingGardenRoute[];
  /** Nearby candidate corridors for a newly generated world, all fully audited. */
  origin?: GardenXZ;
  speed?: number;
  /** Downward probe origin, in the already transformed world's Y coordinates. */
  groundProbeY?: number;
  lighting?: boolean;
}
export interface LivingGardenActor {
  position: GardenPosition;
  height: number;
  route: readonly GardenPosition[];
}

const HEIGHTS = [1.68, 1.73] as const;
const RADIUS = .36, FOOT_GAP = .018, SAMPLE_STEP = .15;
const MAX_SLOPE = Math.cos(25 * Math.PI / 180), MAX_STEP = .07;
const TURN_SECONDS = .95, EASE_FRACTION = .12;

/** A pair of short, lateral promenades beside the arrival path. Their Y values
 * are never authored: every footprint and body sweep comes from the collider. */
const ROUTE_CANDIDATES: readonly (readonly LivingGardenRoute[])[] = [
  [{ start: [4.1, -6.65], end: [6.55, -6.5], initialProgress: .1 }, { start: [5.15, -8], end: [7.5, -7.9], initialProgress: .35, reverse: true }],
  [{ start: [4.1, -5.8], end: [6.45, -5.65], initialProgress: .1 }, { start: [4.7, -7.4], end: [7.05, -7.25], initialProgress: .3, reverse: true }],
  [{ start: [4.05, -4.6], end: [6.4, -4.45], initialProgress: .1 }, { start: [4.6, -6.15], end: [6.95, -6], initialProgress: .3, reverse: true }],
];

const easeTravel = (t: number) => t < EASE_FRACTION
  ? t * t / (2 * EASE_FRACTION * (1 - EASE_FRACTION))
  : t > 1 - EASE_FRACTION
    ? 1 - (1 - t) ** 2 / (2 * EASE_FRACTION * (1 - EASE_FRACTION))
    : (t - EASE_FRACTION / 2) / (1 - EASE_FRACTION);
const inverseTravel = (p: number) => p < EASE_FRACTION / (2 * (1 - EASE_FRACTION))
  ? Math.sqrt(p * 2 * EASE_FRACTION * (1 - EASE_FRACTION))
  : p > 1 - EASE_FRACTION / (2 * (1 - EASE_FRACTION))
    ? 1 - Math.sqrt((1 - p) * 2 * EASE_FRACTION * (1 - EASE_FRACTION))
    : p * (1 - EASE_FRACTION) + EASE_FRACTION / 2;
const smoothTurn = (t: number) => t * t * (3 - 2 * t);
const finiteXZ = (point: GardenXZ | undefined): point is GardenXZ => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);

/** A private world-space BVH leaves the caller's mesh, materials and physics
 * untouched. Double-sided ground rays also support provider winding reversal. */
function colliderQueries(root: THREE.Object3D, probeY: number) {
  root.updateWorldMatrix(true, true);
  const meshes: THREE.Mesh[] = [];
  let vertices = 0;
  root.traverse(item => {
    if (!(item instanceof THREE.Mesh) || !item.geometry.getAttribute('position')) return;
    const count = item.geometry.index?.count ?? item.geometry.getAttribute('position').count;
    if (count % 3) return;
    vertices += count; meshes.push(item);
  });
  if (!vertices || vertices > 1_500_000) return undefined;
  const positions = new Float32Array(vertices * 3), point = new THREE.Vector3();
  let offset = 0;
  for (const mesh of meshes) {
    const attribute = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
    const count = index?.count ?? attribute.count;
    for (let i = 0; i < count; i++) {
      point.fromBufferAttribute(attribute, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      if (![point.x, point.y, point.z].every(Number.isFinite)) return undefined;
      positions[offset++] = point.x; positions[offset++] = point.y; positions[offset++] = point.z;
    }
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
  let tree: MeshBVH | undefined;
  try { tree = new MeshBVH(geometry, { targetLeafSize: 10 }); }
  catch { geometry.dispose(); return undefined; }
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const ground = (x: number, z: number, expectedY?: number) => {
    ray.origin.set(x, expectedY === undefined ? probeY : expectedY + .18, z);
    const hit = tree?.raycastFirst(ray, THREE.DoubleSide, 0, expectedY === undefined ? 5 : .4);
    return hit?.face && Math.abs(hit.face.normal.y) >= MAX_SLOPE ? hit.point.y : undefined;
  };
  const footprint = (x: number, z: number, expectedY?: number) => {
    const floor = ground(x, z, expectedY);
    if (floor === undefined || (expectedY !== undefined && Math.abs(floor - expectedY) > MAX_STEP)) return undefined;
    // The ring refuses unsupported edges and holes beneath either foot.
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, sample = ground(x + Math.cos(angle) * .28, z + Math.sin(angle) * .28, floor);
      if (sample === undefined || Math.abs(sample - floor) > .11) return undefined;
    }
    return floor;
  };
  const bounds = new THREE.Box3(), spine = new THREE.Line3();
  const bottomA = new THREE.Vector3(), topA = new THREE.Vector3(), bottomB = new THREE.Vector3(), topB = new THREE.Vector3();
  const first = new ExtendedTriangle(), second = new ExtendedTriangle();
  /** The swept capsule's spine is a vertical quadrilateral. Its exact triangle
   * distance catches thin obstacles even between the 15 cm ground samples. */
  const clearBody = (from: GardenPosition, to: GardenPosition, height: number) => {
    if (!tree) return false;
    bottomA.set(from[0], from[1] + RADIUS + FOOT_GAP, from[2]);
    topA.set(from[0], from[1] + height - RADIUS + FOOT_GAP, from[2]);
    bottomB.set(to[0], to[1] + RADIUS + FOOT_GAP, to[2]);
    topB.set(to[0], to[1] + height - RADIUS + FOOT_GAP, to[2]);
    bounds.makeEmpty().expandByPoint(bottomA).expandByPoint(topA).expandByPoint(bottomB).expandByPoint(topB).expandByScalar(RADIUS);
    const stationary = bottomA.distanceToSquared(bottomB) < 1e-12;
    spine.set(bottomA, topA);
    first.set(bottomA, topA, topB); first.needsUpdate = true;
    second.set(bottomA, topB, bottomB); second.needsUpdate = true;
    return !tree.shapecast({
      intersectsBounds: box => box.intersectsBox(bounds),
      intersectsTriangle: triangle => stationary
        ? triangle.closestPointToSegment(spine) < RADIUS - .001
        : triangle.distanceToTriangle(first) < RADIUS - .001 || triangle.distanceToTriangle(second) < RADIUS - .001,
    });
  };
  return { ground, footprint, clearBody, dispose: () => {
    geometry.dispose(); geometry.deleteAttribute('position'); geometry.setIndex(null); tree = undefined;
  } };
}

function auditRoute(route: LivingGardenRoute, queries: NonNullable<ReturnType<typeof colliderQueries>>, height: number) {
  if (!route || !finiteXZ(route.start) || !finiteXZ(route.end) || (route.initialProgress !== undefined && (!Number.isFinite(route.initialProgress) || route.initialProgress < 0 || route.initialProgress > 1))) return undefined;
  const dx = route.end[0] - route.start[0], dz = route.end[1] - route.start[1], length = Math.hypot(dx, dz);
  if (length < .8 || length > 6) return undefined;
  const steps = Math.ceil(length / SAMPLE_STEP), points: GardenPosition[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = route.start[0] + dx * i / steps, z = route.start[1] + dz * i / steps;
    const previous = points.at(-1), floor = queries.footprint(x, z, previous?.[1]);
    if (floor === undefined) return undefined;
    const point: GardenPosition = [x, floor, z];
    if (!queries.clearBody(point, point, height) || (previous && !queries.clearBody(previous, point, height))) return undefined;
    points.push(point);
  }
  return { definition: route, points, length, yaw: Math.atan2(dx, dz) };
}

function separatedRoutes(routes: readonly NonNullable<ReturnType<typeof auditRoute>>[]) {
  // Actors share no route corridor, so their out-and-back cycles cannot collide.
  return routes[0].points.every(a => routes[1].points.every(b => Math.hypot(a[0] - b[0], a[2] - b[2]) >= RADIUS * 2 + .12));
}

/** Two modestly scaled visitors, with no RAF, camera attachment or player
 * controller. The owning viewer supplies elapsed seconds and its pause gate. */
export function createLivingGarden(collider: THREE.Object3D, options: LivingGardenOptions = {}) {
  const group = new THREE.Group(); group.name = 'Living garden visitors';
  let dead = false;
  const speed = options.speed ?? .4, probeY = options.groundProbeY ?? 1.5;
  const validOptions = Number.isFinite(speed) && speed >= .1 && speed <= .8 && Number.isFinite(probeY);
  const queries = validOptions ? colliderQueries(collider, probeY) : undefined;
  let accepted: NonNullable<ReturnType<typeof auditRoute>>[] | undefined;
  if (queries) {
    const nearby: (readonly LivingGardenRoute[])[] = [];
    if (finiteXZ(options.origin)) for (const side of [-1, 1]) for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const origin = options.origin, direction = [Math.sin(angle), -Math.cos(angle)], lateral = [Math.cos(angle), Math.sin(angle)];
      const at = (along: number, across: number): GardenXZ => [origin[0] + direction[0] * along + lateral[0] * across * side, origin[1] + direction[1] * along + lateral[1] * across * side];
      nearby.push([{ start: at(1.5, 1.6), end: at(3.5, 1.6), initialProgress: .1 }, { start: at(1.5, 3), end: at(3.5, 3), initialProgress: .35, reverse: true }]);
    }
    const candidates = options.routes ? [options.routes] : options.origin ? nearby : ROUTE_CANDIDATES;
    for (const candidate of candidates) {
      if (candidate.length !== 2) continue;
      const routes = candidate.map((route, index) => auditRoute(route, queries, HEIGHTS[index]));
      if (routes.every((route): route is NonNullable<typeof route> => Boolean(route)) && separatedRoutes(routes)) { accepted = routes; break; }
    }
  }
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const geometry = <T extends THREE.BufferGeometry>(value: T) => { geometries.add(value); return value; };
  const material = (color: string) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: .92, metalness: 0 }); materials.add(value); return value;
  };
  const states: { body: THREE.Group; limbs: THREE.Group[]; route: NonNullable<ReturnType<typeof auditRoute>>; height: number; elapsed: number; travelSeconds: number }[] = [];
  if (accepted) {
    const box = geometry(new THREE.BoxGeometry(1, 1, 1));
    const head = geometry(new THREE.IcosahedronGeometry(1, 1));
    const hair = geometry(new THREE.IcosahedronGeometry(1, 1));
    const coat = geometry(new THREE.CylinderGeometry(.24, .29, .53, 6));
    const skirt = geometry(new THREE.CylinderGeometry(.27, .32, .27, 6));
    const collar = geometry(new THREE.TorusGeometry(.105, .04, 4, 8));
    const skin = [material('#e5bd9c'), material('#b68666')];
    const coats = [material('#a76f58'), material('#637f73')];
    const dark = material('#25353c'), shoes = material('#303132'), hairMaterial = material('#3d3432'), scarf = material('#e4c795');
    const mesh = (parent: THREE.Object3D, shape: THREE.BufferGeometry, surface: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const item = new THREE.Mesh(shape, surface); item.position.set(x, y, z); item.scale.set(sx, sy, sz); parent.add(item); return item;
    };
    accepted.forEach((route, index) => {
      const body = new THREE.Group(); body.name = index ? 'Garden visitor in sage' : 'Garden visitor in terracotta';
      mesh(body, coat, coats[index], 0, 1.17, 0);
      mesh(body, skirt, coats[index], 0, .82, 0);
      mesh(body, head, skin[index], 0, 1.545, .008, .133, .15, .127);
      mesh(body, hair, hairMaterial, 0, 1.645, -.008, .142, .081, .137);
      const neck = mesh(body, collar, scarf, 0, 1.405, 0); neck.rotation.x = Math.PI / 2;
      const limbs: THREE.Group[] = [];
      for (const side of [-1, 1]) {
        const arm = new THREE.Group(); arm.position.set(side * .274, 1.355, 0); body.add(arm); limbs.push(arm);
        mesh(arm, box, coats[index], 0, -.22, 0, .12, .44, .14);
        mesh(arm, head, skin[index], 0, -.475, 0, .057, .073, .057);
      }
      for (const side of [-1, 1]) {
        const leg = new THREE.Group(); leg.position.set(side * .125, .86, 0); body.add(leg); limbs.push(leg);
        mesh(leg, box, dark, 0, -.365, 0, .135, .73, .15);
        mesh(leg, box, shoes, 0, -.81, .035, .16, .1, .24);
      }
      body.updateMatrixWorld(true);
      const actualHeight = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3()).y;
      body.scale.setScalar(HEIGHTS[index] / actualHeight);
      group.add(body);
      const travelSeconds = route.length / speed, progress = route.definition.initialProgress ?? 0;
      const elapsed = route.definition.reverse
        ? travelSeconds + TURN_SECONDS + inverseTravel(1 - progress) * travelSeconds
        : inverseTravel(progress) * travelSeconds;
      states.push({ body, limbs, route, height: HEIGHTS[index], elapsed, travelSeconds });
    });
    if (options.lighting !== false) {
      const hemisphere = new THREE.HemisphereLight('#ffe7ca', '#617174', 1.7);
      const sun = new THREE.DirectionalLight('#ffd2a1', 1.25); sun.position.set(-6, 8, 4); sun.target.position.set(4, 0, -6);
      group.add(hemisphere, sun, sun.target);
    }
  } else { queries?.dispose(); }
  const apply = (state: typeof states[number]) => {
    const { route, travelSeconds: travel, body, limbs } = state;
    const cycle = (travel + TURN_SECONDS) * 2, phase = state.elapsed % cycle;
    let progress = 0, yaw = route.yaw, pace = 0, distance = Math.floor(state.elapsed / cycle) * route.length * 2;
    if (phase < travel) {
      const t = phase / travel; progress = easeTravel(t); pace = Math.min(1, t / EASE_FRACTION, (1 - t) / EASE_FRACTION); distance += progress * route.length;
    } else if (phase < travel + TURN_SECONDS) {
      progress = 1; yaw += Math.PI * smoothTurn((phase - travel) / TURN_SECONDS); distance += route.length;
    } else if (phase < travel * 2 + TURN_SECONDS) {
      const t = (phase - travel - TURN_SECONDS) / travel; progress = 1 - easeTravel(t); yaw += Math.PI; pace = Math.min(1, t / EASE_FRACTION, (1 - t) / EASE_FRACTION); distance += (2 - progress) * route.length;
    } else {
      yaw += Math.PI + Math.PI * smoothTurn((phase - travel * 2 - TURN_SECONDS) / TURN_SECONDS); distance += route.length * 2;
    }
    const start = route.points[0], end = route.points.at(-1)!;
    const x = THREE.MathUtils.lerp(start[0], end[0], progress), z = THREE.MathUtils.lerp(start[2], end[2], progress);
    const nearest = route.points[Math.min(route.points.length - 1, Math.round(progress * (route.points.length - 1)))];
    const floor = queries!.ground(x, z, nearest[1]);
    if (floor === undefined || Math.abs(floor - nearest[1]) > MAX_STEP || !queries!.clearBody([x, floor, z], [x, floor, z], state.height)) return;
    body.position.set(x, floor + FOOT_GAP, z); body.rotation.y = yaw;
    const swing = Math.sin(distance / .72 * Math.PI * 2) * pace;
    // Hips, torso and head stay at their authored height; only the limbs swing.
    limbs[0].rotation.x = -swing * .16; limbs[1].rotation.x = swing * .16;
    limbs[2].rotation.x = swing * .19; limbs[3].rotation.x = -swing * .19;
  };
  states.forEach(apply);
  return {
    group,
    count: states.length,
    get actors(): readonly LivingGardenActor[] {
      return states.map(state => ({ position: [state.body.position.x, state.body.position.y, state.body.position.z] as GardenPosition, height: state.height, route: state.route.points.map(point => [...point] as GardenPosition) }));
    },
    update(dtSeconds: number) {
      if (dead || !Number.isFinite(dtSeconds) || dtSeconds <= 0 || dtSeconds > 60) return;
      for (const state of states) { state.elapsed += dtSeconds; apply(state); }
    },
    destroy() {
      if (dead) return; dead = true;
      if (accepted) queries?.dispose();
      for (const value of geometries) value.dispose();
      for (const value of materials) value.dispose();
      geometries.clear(); materials.clear(); group.removeFromParent(); group.clear(); states.length = 0;
    },
  };
}
