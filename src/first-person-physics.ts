import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { MotionVector3 as FirstPersonPosition } from './first-person-motion';

let initialized: Promise<void> | undefined;
export interface FirstPersonPhysicsOptions {
  spawn: FirstPersonPosition; eyeHeight: number; radius?: number; maxRadius?: number;
}

/** The capsule and static triangle meshes occupy the exact transformed SPZ
 * coordinates. Units are artistic unless the provider's metric scale is known. */
export async function createFirstPersonPhysics(root: THREE.Object3D, options: FirstPersonPhysicsOptions) {
  initialized ??= RAPIER.init(); await initialized;
  const eyeHeight = options.eyeHeight, radius = options.radius ?? .18;
  if (!Array.isArray(options.spawn) || options.spawn.length !== 3 || !options.spawn.every(Number.isFinite) || !Number.isFinite(eyeHeight) || !Number.isFinite(radius) || eyeHeight < .3 || eyeHeight > 3 || radius < .05 || radius > eyeHeight / 3 || (options.maxRadius !== undefined && (!Number.isFinite(options.maxRadius) || options.maxRadius <= 0))) throw new Error('WALK_CONFIGURATION_INVALID');
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  let dead = false;
  try {
    root.updateMatrixWorld(true);
    let meshes = 0, triangles = 0;
    const vertex = new THREE.Vector3();
    root.traverse(item => {
      if (!(item instanceof THREE.Mesh)) return;
      const geometry = item.geometry, position = geometry.getAttribute('position');
      if (!position || position.count < 3) return;
      const vertices = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) { vertex.fromBufferAttribute(position, i).applyMatrix4(item.matrixWorld); vertices.set(vertex.toArray(), i * 3); }
      const indices = geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({ length: position.count }, (_, i) => i);
      if (indices.length % 3 || !vertices.every(Number.isFinite)) throw new Error('WALK_COLLIDER_INVALID');
      world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(.8)); meshes++; triangles += indices.length / 3;
    });
    if (!meshes || triangles > 500_000) throw new Error('WALK_COLLIDER_INVALID');
    // Collider-only Rapier character: direct translations update the queries at
    // each small substep; there is no dynamic-body impulse or invented floor.
    world.step();
    const floorAt = (x: number, y: number, z: number, distance: number) => {
      const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 }), distance, false, undefined, undefined, capsule);
      return hit && Math.abs(hit.normal.y) >= Math.cos(Math.PI / 4) ? y - hit.timeOfImpact : undefined;
    };
    let capsule: RAPIER.Collider | undefined;
    const floor = floorAt(options.spawn[0], options.spawn[1] - .06, options.spawn[2], eyeHeight + .5);
    if (floor === undefined) throw new Error('WALK_SPAWN_HAS_NO_FLOOR');
    const offset = .018, fullHeight = eyeHeight + .12, halfHeight = fullHeight / 2 - radius, eyeOffset = eyeHeight - fullHeight / 2;
    const spawn: FirstPersonPosition = [options.spawn[0], floor + eyeHeight + offset, options.spawn[2]];
    capsule = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius).setTranslation(spawn[0], spawn[1] - eyeOffset, spawn[2]));
    const character = world.createCharacterController(offset);
    character.setSlideEnabled(true); character.setMaxSlopeClimbAngle(Math.PI / 4); character.setMinSlopeSlideAngle(Math.PI / 3);
    character.enableAutostep(.18, radius * 1.2, false); character.enableSnapToGround(.22);
    world.step();
    const copy = (value: FirstPersonPosition): FirstPersonPosition => [value[0], value[1], value[2]];
    let verticalVelocity = 0, lastSafe = copy(spawn);
    const maxRadius = Math.max(4, Math.min(30, options.maxRadius ?? 10));
    const reset = () => { verticalVelocity = 0; lastSafe = copy(spawn); capsule!.setTranslation({ x: spawn[0], y: spawn[1] - eyeOffset, z: spawn[2] }); world.step(); return copy(spawn); };
    const advance = (position: FirstPersonPosition, displacement: FirstPersonPosition, deltaSeconds: number) => {
      if (dead || ![...position, ...displacement, deltaSeconds].every(Number.isFinite)) return { position: copy(lastSafe), grounded: true };
      const dt = Math.max(0, Math.min(1 / 30, deltaSeconds));
      capsule!.setTranslation({ x: position[0], y: position[1] - eyeOffset, z: position[2] });
      verticalVelocity = Math.max(-4, verticalVelocity - 9.81 * dt);
      const desired = { x: displacement[0], y: Math.min(-.002, verticalVelocity * dt), z: displacement[2] };
      character.computeColliderMovement(capsule!, desired);
      const movement = character.computedMovement(), grounded = character.computedGrounded();
      const next: FirstPersonPosition = [position[0] + movement.x, position[1] + movement.y, position[2] + movement.z];
      if (grounded) verticalVelocity = 0;
      // The provider mesh can end abruptly. Refuse an unsupported step instead
      // of dropping into missing geometry or silently adding a flat platform.
      const nextFloor = floorAt(next[0], next[1] - .06, next[2], eyeHeight + .28);
      const supported = nextFloor !== undefined && next[1] - eyeHeight - nextFloor < .27;
      if (!next.every(Number.isFinite) || !supported || Math.hypot(next[0] - spawn[0], next[2] - spawn[2]) > maxRadius) {
        verticalVelocity = 0; capsule!.setTranslation({ x: position[0], y: position[1] - eyeOffset, z: position[2] });
        return { position: copy(position), grounded: true };
      }
      capsule!.setTranslation({ x: next[0], y: next[1] - eyeOffset, z: next[2] }); lastSafe = next;
      return { position: next, grounded };
    };
    const destroy = () => { if (!dead) { dead = true; world.free(); } };
    return { advance, reset, destroy, spawn, eyeHeight, radius, meshes, triangles };
  } catch (error) { world.free(); throw error; }
}
