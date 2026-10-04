/** Y-up artistic scene coordinates. Speeds are scene units per second. */
export type MotionVector3 = readonly [number, number, number];

export interface FirstPersonMotionInput {
  /** Forward is positive, backward negative. Values are normalized to [-1, 1]. */
  forward: number;
  /** Right is positive, left negative. */
  strafe: number;
  /** Three.js YXZ yaw: zero faces -Z. Pitch never changes walking speed. */
  yaw: number;
  sprint?: boolean;
  active?: boolean;
  reducedMotion?: boolean;
}

export interface FirstPersonMotionOptions {
  walkSpeed?: number;
  sprintSpeed?: number;
  acceleration?: number;
  damping?: number;
  maxDeltaSeconds?: number;
  maxSubstepSeconds?: number;
  strideLength?: number;
  /** Camera sway amplitude; zero disables it. Collision uses the unswayed eye. */
  headSway?: number;
  /** Reject malformed collider corrections rather than teleporting the camera. */
  maxVerticalCorrection?: number;
  /** Optional allowance for a capsule's small contact/snap corrections. The
   * default remains strict; allowances are capped at .025 scene units. */
  maxHorizontalCorrection?: number;
}

export interface MotionCollisionResult {
  position: MotionVector3;
  grounded?: boolean;
}

/**
 * The adapter owns the body capsule, gravity, floors, and wall sliding. It
 * receives a bounded horizontal step and returns the resolved eye position.
 * Undefined means the step is unavailable (for example, a missing floor).
 */
export type FirstPersonMotionResolver = (
  eyePosition: MotionVector3,
  displacement: MotionVector3,
  /** Per-substep seconds, for a gravity/character-controller adapter. */
  deltaSeconds: number,
) => MotionVector3 | MotionCollisionResult | undefined;

export interface FirstPersonMotionState {
  position: MotionVector3;
  cameraPosition: MotionVector3;
  velocity: MotionVector3;
  headOffset: MotionVector3;
  roll: number;
  speed: number;
  distance: number;
  moving: boolean;
  grounded: boolean;
  blocked: boolean;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const setting = (value: number | undefined, fallback: number, low: number, high: number) =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, low, high) : fallback;
const finiteVector = (value: unknown): value is MotionVector3 =>
  Array.isArray(value) && value.length === 3 && value.every(component => typeof component === 'number' && Number.isFinite(component));
const axis = (value: number) => Number.isFinite(value) ? clamp(value, -1, 1) : 0;
const SPEED_EPSILON = .0001;
const CORRECTION_EPSILON = .000001;

/**
 * Continuous first-person locomotion, independent of DOM key-repeat and render
 * frame rate. Exponential velocity and its analytic displacement preserve the
 * same path at 20, 30, and 60 fps in open space. A collider resolves each small
 * substep, so a slow frame does not request one large wall-crossing movement.
 */
export function createFirstPersonMotion(start: MotionVector3, options: FirstPersonMotionOptions = {}) {
  if (!finiteVector(start)) throw new RangeError('The starting eye position must contain three finite coordinates.');
  const walkSpeed = setting(options.walkSpeed, .9, .02, 12);
  const sprintSpeed = setting(options.sprintSpeed, walkSpeed * 1.6, walkSpeed, 20);
  const acceleration = setting(options.acceleration, 10, .8, 40);
  const damping = setting(options.damping, 16, 1, 60);
  const maxDelta = setting(options.maxDeltaSeconds, .12, 1 / 60, .25);
  const maxSubstep = setting(options.maxSubstepSeconds, 1 / 60, 1 / 240, 1 / 30);
  const strideLength = setting(options.strideLength, walkSpeed * .8, .05, 8);
  const sway = setting(options.headSway, .008, 0, .04);
  const maxVerticalCorrection = setting(options.maxVerticalCorrection, .5, .01, 2);
  const maxHorizontalCorrection = setting(options.maxHorizontalCorrection, 0, 0, .025);
  let position: [number, number, number] = [...start], velocityX = 0, velocityZ = 0;
  let yaw = 0, distance = 0, phase = 0, grounded = false, blocked = false;
  let headOffset: [number, number, number] = [0, 0, 0], roll = 0;

  const snapshot = (): FirstPersonMotionState => {
    const speed = Math.hypot(velocityX, velocityZ);
    return {
      position: [...position],
      cameraPosition: [position[0] + headOffset[0], position[1] + headOffset[1], position[2] + headOffset[2]],
      velocity: [velocityX, 0, velocityZ], headOffset: [...headOffset], roll,
      speed, distance, moving: speed > SPEED_EPSILON, grounded, blocked,
    };
  };
  const stop = () => {
    velocityX = velocityZ = roll = phase = 0;
    headOffset = [0, 0, 0]; blocked = false;
    return snapshot();
  };
  const reset = (next: MotionVector3 = position) => {
    if (!finiteVector(next)) throw new RangeError('The eye position must contain three finite coordinates.');
    position = [...next]; distance = 0; grounded = false;
    return stop();
  };
  const step = (deltaSeconds: number, input: FirstPersonMotionInput, resolve?: FirstPersonMotionResolver): FirstPersonMotionState => {
    // Callers use active=false on blur, unlock, hidden tabs, or leaving Walk.
    // Drop inertia immediately so a resumed view cannot keep walking by itself.
    if (input.active === false) return stop();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return snapshot();
    if (Number.isFinite(input.yaw)) yaw = input.yaw;
    let forward = axis(input.forward), strafe = axis(input.strafe);
    const magnitude = Math.hypot(forward, strafe);
    if (magnitude > 1) { forward /= magnitude; strafe /= magnitude; }
    const commanded = magnitude > 0;
    const speed = input.sprint ? sprintSpeed : walkSpeed;
    const targetX = (Math.cos(yaw) * strafe - Math.sin(yaw) * forward) * speed;
    const targetZ = (-Math.sin(yaw) * strafe - Math.cos(yaw) * forward) * speed;
    const duration = Math.min(deltaSeconds, maxDelta);
    const substeps = Math.ceil(duration / maxSubstep), dt = duration / substeps;
    const rate = commanded ? acceleration : damping, decay = Math.exp(-rate * dt);
    blocked = false;
    let travelled = 0;
    for (let index = 0; index < substeps; index++) {
      const dx = targetX * dt + (velocityX - targetX) * (1 - decay) / rate;
      const dz = targetZ * dt + (velocityZ - targetZ) * (1 - decay) / rate;
      velocityX = targetX + (velocityX - targetX) * decay;
      velocityZ = targetZ + (velocityZ - targetZ) * decay;
      let next: MotionVector3 = [position[0] + dx, position[1], position[2] + dz];
      if (resolve) {
        let result: MotionVector3 | MotionCollisionResult | undefined;
        try { result = resolve([...position], [dx, 0, dz], dt); } catch { /* A failed collision step cannot corrupt the view. */ }
        const candidate = finiteVector(result) ? result : result && !Array.isArray(result) ? (result as MotionCollisionResult).position : undefined;
        const horizontalLimit = Math.hypot(dx, dz) + CORRECTION_EPSILON + maxHorizontalCorrection;
        if (!finiteVector(candidate)
          || Math.hypot(candidate[0] - position[0], candidate[2] - position[2]) > horizontalLimit
          || Math.abs(candidate[1] - position[1]) > maxVerticalCorrection) {
          next = position; grounded = false; blocked = true;
        } else {
          next = candidate;
          grounded = finiteVector(result) ? true : (result as MotionCollisionResult).grounded !== false;
        }
      } else grounded = false;
      const actualX = next[0] - position[0], actualZ = next[2] - position[2];
      // Cancel the blocked velocity component while retaining motion along a
      // wall. This prevents stored momentum from building up against geometry.
      for (const [requested, actual, coordinate] of [[dx, actualX, 'x'], [dz, actualZ, 'z']] as const) {
        if (Math.abs(actual - requested) <= CORRECTION_EPSILON) continue;
        blocked = true;
        const retained = Math.abs(requested) <= CORRECTION_EPSILON ? 0 : clamp(actual / requested, 0, 1);
        if (coordinate === 'x') velocityX *= retained; else velocityZ *= retained;
      }
      travelled += Math.hypot(actualX, actualZ);
      position = [...next];
    }
    if (Math.hypot(velocityX, velocityZ) < SPEED_EPSILON) velocityX = velocityZ = 0;
    distance += travelled; phase = (phase + travelled / strideLength * Math.PI * 2) % (Math.PI * 2);
    if (input.reducedMotion || sway === 0 || !grounded || !travelled) { headOffset = [0, 0, 0]; roll = 0; }
    else {
      const amplitude = sway * clamp(Math.hypot(velocityX, velocityZ) / walkSpeed, 0, 1);
      const lateral = Math.sin(phase) * amplitude * .35;
      headOffset = [Math.cos(yaw) * lateral, (1 - Math.cos(phase * 2)) * amplitude * .5, -Math.sin(yaw) * lateral];
      roll = Math.sin(phase) * amplitude * .3;
    }
    return snapshot();
  };
  return { step, reset, stop, snapshot };
}
