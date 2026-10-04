import * as THREE from 'three';
import { ExtendedTriangle, MeshBVH } from 'three-mesh-bvh';

/** Select a supported human viewpoint from the real, already transformed mesh.
 * A short near-camera downward ray avoids choosing roofs from the box top.
 * Temporary BVH data never modifies or outlives the provider collider. */
export function findWalkSpawn(root: THREE.Object3D, preferred: readonly [number, number, number], eyeHeight = 1.65, radius = .2): readonly [number, number, number] | undefined {
  if (!Array.isArray(preferred) || preferred.length !== 3 || !preferred.every(Number.isFinite) || !Number.isFinite(eyeHeight) || eyeHeight < .5 || eyeHeight > 3 || !Number.isFinite(radius) || radius < .05 || radius > eyeHeight / 3) return undefined;
  root.updateWorldMatrix(true, true);
  const meshes: THREE.Mesh[] = []; let count = 0;
  root.traverse(item => {
    if (!(item instanceof THREE.Mesh)) return;
    const attribute = item.geometry.getAttribute('position'), n = item.geometry.index?.count ?? attribute?.count ?? 0;
    if (!attribute || n < 3 || n % 3) return;
    meshes.push(item); count += n;
  });
  if (!count || count > 1_500_000) return undefined;
  const positions = new Float32Array(count * 3), vertex = new THREE.Vector3(); let offset = 0;
  for (const mesh of meshes) {
    const attribute = mesh.geometry.getAttribute('position'), index = mesh.geometry.index, n = index?.count ?? attribute.count;
    for (let i = 0; i < n; i++) {
      vertex.fromBufferAttribute(attribute, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) return undefined;
      positions[offset++] = vertex.x; positions[offset++] = vertex.y; positions[offset++] = vertex.z;
    }
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
  try {
    const tree = new MeshBVH(geometry, { targetLeafSize: 10 });
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    const probeY = preferred[1] + .6;
    const floorAt = (x: number, z: number, expected?: number) => {
      ray.origin.set(x, expected === undefined ? probeY : expected + .22, z);
      const hit = tree.raycastFirst(ray, THREE.DoubleSide, 0, expected === undefined ? eyeHeight + 4 : .45);
      if (!hit?.face || Math.abs(hit.face.normal.y) < Math.cos(Math.PI / 4)) return undefined;
      // The input is a near-camera eye position, not a floor height. A low
      // ceiling caught by this ray must not become a roof arrival instead.
      if (expected === undefined && hit.point.y > preferred[1] - eyeHeight + .6) return undefined;
      return hit.point.y;
    };
    const clear = (x: number, y: number, z: number) => {
      const spine = new THREE.Line3(new THREE.Vector3(x, y + radius + .025, z), new THREE.Vector3(x, y + eyeHeight + .12 - radius + .025, z));
      const box = new THREE.Box3().setFromPoints([spine.start, spine.end]).expandByScalar(radius);
      const segmentRay = new THREE.Ray(spine.start, spine.end.clone().sub(spine.start).normalize()), intersection = new THREE.Vector3();
      const onTriangle = new THREE.Vector3(), onSpine = new THREE.Vector3(); let blocked = false;
      tree.shapecast({ intersectsBounds: bounds => bounds.intersectsBox(box), intersectsTriangle: triangle => {
        if (segmentRay.intersectTriangle(triangle.a, triangle.b, triangle.c, false, intersection) && intersection.distanceTo(spine.start) <= spine.distance()) { blocked = true; return true; }
        if ((triangle as ExtendedTriangle).closestPointToSegment(spine, onTriangle, onSpine) < radius - .002) { blocked = true; return true; }
        return false;
      } });
      return !blocked;
    };
    // Test nearby positions in distance order. Never teleport to a distant roof
    // or manufacture a replacement floor if the mesh has no valid footprint.
    const candidates: [number, number][] = [[preferred[0], preferred[2]]];
    for (const distance of [.5, 1, 1.5, 2]) for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4; candidates.push([preferred[0] + Math.sin(angle) * distance, preferred[2] - Math.cos(angle) * distance]);
    }
    for (const [x, z] of candidates) {
      const floor = floorAt(x, z); if (floor === undefined) continue;
      let supported = true;
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4, sample = floorAt(x + Math.cos(angle) * radius * 1.1, z + Math.sin(angle) * radius * 1.1, floor);
        if (sample === undefined || Math.abs(sample - floor) > .18) { supported = false; break; }
      }
      if (supported && clear(x, floor, z)) return [x, floor + eyeHeight, z];
    }
    return undefined;
  } catch { return undefined; }
  finally { geometry.dispose(); }
}
