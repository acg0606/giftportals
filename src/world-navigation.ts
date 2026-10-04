import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

/** Small, grounded walks in raw artistic scene units. No invented terrain. */
export function createGroundNavigation(collider: THREE.Object3D, start: THREE.Vector3) {
  // Only the private collider gets accelerated; model and splat prototypes stay
  // untouched. The original vertex/index order is retained for diagnostics.
  collider.traverse(item=>{
    if(!(item instanceof THREE.Mesh))return;
    item.geometry.boundsTree ??= new MeshBVH(item.geometry,{indirect:true,targetLeafSize:10});
    item.raycast=acceleratedRaycast;
  });
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  collider.updateMatrixWorld(true);
  const floorAt = (x: number, z: number, ceiling: number, range: number) => {
    ray.set(new THREE.Vector3(x, ceiling, z), down); ray.near = 0; ray.far = range;
    return ray.intersectObject(collider, true).find(hit => {
      if (!hit.face) return false;
      const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
      return Math.abs(normal.y) > .65;
    })?.point.y;
  };
  const initialFloor = floorAt(start.x, start.z, start.y - .04, 3);
  if (initialFloor === undefined) return undefined;
  const eyeHeight = start.y - initialFloor;
  if (eyeHeight < .12 || eyeHeight > 3) return undefined;
  const maxStep = Math.min(.18, eyeHeight * .28), clearance = Math.min(.08, eyeHeight * .16);
  const advance = (position: THREE.Vector3, displacement: THREE.Vector3) => {
    if (![position.x, position.y, position.z, displacement.x, displacement.z].every(Number.isFinite)) return position.clone();
    const next = position.clone();
    const length = Math.min(displacement.length(), .24);
    const increments = Math.max(1, Math.ceil(length / .04));
    const increment = displacement.clone().setLength(length / increments); increment.y = 0;
    for (let index = 0; index < increments; index++) {
      const candidate = next.clone().add(increment);
      if (Math.hypot(candidate.x - start.x, candidate.z - start.z) > 2.5) break;
      const currentFloor = next.y - eyeHeight;
      const floor = floorAt(candidate.x, candidate.z, currentFloor + maxStep + .02, eyeHeight + maxStep + .02);
      if (floor === undefined || Math.abs(floor - currentFloor) > maxStep) break;
      const direction = increment.clone().normalize();
      let blocked = false;
      for (const height of [.3, .75]) {
        ray.set(new THREE.Vector3(next.x, currentFloor + eyeHeight * height, next.z), direction);
        ray.near = 0; ray.far = increment.length() + clearance;
        if (ray.intersectObject(collider, true).length) { blocked = true; break; }
      }
      if (blocked) break;
      candidate.y = floor + eyeHeight; next.copy(candidate);
    }
    return next;
  };
  const ground = (position: THREE.Vector3) => {
    const floor=floorAt(position.x,position.z,position.y-.1,3);
    if(floor===undefined||Math.hypot(position.x-start.x,position.z-start.z)>2.5)return undefined;
    return new THREE.Vector3(position.x,floor+eyeHeight,position.z);
  };
  return { advance, eyeHeight, ground };
}
