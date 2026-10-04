import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/first-person-motion.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { createFirstPersonMotion } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const input = (overrides = {}) => ({ forward: 1, strafe: 0, yaw: 0, ...overrides });
const flatFloor = (position, delta) => ({ position: [position[0] + delta[0], .6, position[2] + delta[2]], grounded: true });
const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);
const walkFor = (fps, seconds, overrides = {}, options = {}) => {
  const motion = createFirstPersonMotion([0, .6, 0], options);
  for (let frame = 0; frame < fps * seconds; frame++) motion.step(1 / fps, input(overrides), flatFloor);
  return motion.snapshot();
};

test('continuous movement covers the same distance at 20, 30, 60 and 144 fps', () => {
  const reference = walkFor(60, 3);
  assert.ok(reference.position[2] < -2.5);
  for (const fps of [20, 30, 144]) {
    const result = walkFor(fps, 3);
    result.position.forEach((value, axis) => close(value, reference.position[axis]));
    close(result.speed, reference.speed); close(result.distance, reference.distance);
  }
});

test('yaw, backward, and strafe directions match Three YXZ without diagonal speed gain', () => {
  const forward = walkFor(60, 2), diagonal = walkFor(60, 2, { strafe: 1 });
  close(diagonal.distance, forward.distance);
  assert.ok(diagonal.position[0] > 0 && diagonal.position[2] < 0);
  const turned = walkFor(60, 2, { yaw: Math.PI / 2 });
  close(turned.position[0], forward.position[2]); close(turned.position[2], 0);
  const backward = walkFor(60, 2, { forward: -1 });
  close(backward.position[2], -forward.position[2]);
  const right = walkFor(60, 2, { forward: 0, strafe: 1 });
  close(right.position[0], -forward.position[2]); close(right.position[2], 0);
});

test('acceleration, release damping and sprint are time based and bounded', () => {
  const motion = createFirstPersonMotion([0, .6, 0], { walkSpeed: .8, sprintSpeed: 1.4 });
  const first = motion.step(1 / 60, input(), flatFloor);
  assert.ok(first.speed > 0 && first.speed < .8 && first.position[2] > -.8 / 60);
  for (let frame = 0; frame < 120; frame++) motion.step(1 / 60, input(), flatFloor);
  close(motion.snapshot().speed, .8);
  for (let frame = 0; frame < 120; frame++) motion.step(1 / 60, input({ sprint: true }), flatFloor);
  close(motion.snapshot().speed, 1.4);
  let prior = motion.snapshot().speed;
  for (let frame = 0; frame < 60; frame++) {
    const next = motion.step(1 / 60, input({ forward: 0 }), flatFloor);
    assert.ok(next.speed <= prior); prior = next.speed;
  }
  assert.equal(motion.snapshot().moving, false);
  assert.equal(motion.snapshot().speed, 0);
});

test('collision substeps reject walls and retain tangential movement instead of accumulating momentum', () => {
  const motion = createFirstPersonMotion([0, .6, 0], { walkSpeed: 1 });
  const wall = (position, delta) => ({ position: [Math.min(.2, position[0] + delta[0]), .6, position[2] + delta[2]], grounded: true });
  for (let frame = 0; frame < 100; frame++) motion.step(1 / 30, input({ strafe: 1 }), wall);
  const state = motion.snapshot();
  close(state.position[0], .2); assert.ok(state.position[2] < -2);
  assert.equal(state.velocity[0], 0); assert.ok(state.velocity[2] < -.6);
  assert.equal(state.blocked, true); assert.equal(state.grounded, true);
  const blocked = createFirstPersonMotion([0, .6, 0]);
  for (let frame = 0; frame < 60; frame++) blocked.step(1 / 60, input(), position => ({ position, grounded: true }));
  assert.deepEqual(blocked.snapshot().position, [0, .6, 0]);
  assert.equal(blocked.snapshot().speed, 0); assert.deepEqual(blocked.snapshot().headOffset, [0, 0, 0]);
});

test('a stalled frame is capped and subdivided before reaching the collider', () => {
  const motion = createFirstPersonMotion([0, .6, 0], { walkSpeed: 3, maxDeltaSeconds: .12, maxSubstepSeconds: 1 / 60 });
  const steps = [];
  const state = motion.step(12, input(), (position, delta) => { steps.push(delta); return flatFloor(position, delta); });
  assert.equal(steps.length, 8);
  assert.ok(steps.every(delta => Math.hypot(delta[0], delta[2]) <= 3 / 60));
  assert.ok(state.distance < .36);
  const reference = createFirstPersonMotion([0, .6, 0], { walkSpeed: 3 });
  close(state.distance, reference.step(.12, input(), flatFloor).distance);
});

test('idle frames still resolve each substep with its own dt so gravity can settle the body', () => {
  const motion = createFirstPersonMotion([0, 1, 0]);
  const deltas = [];
  const result = motion.step(.1, input({ forward: 0 }), (position, displacement, dt) => {
    deltas.push(dt); assert.deepEqual(displacement, [0, 0, 0]);
    return { position: [position[0], position[1] - .5 * dt, position[2]], grounded: false };
  });
  assert.equal(deltas.length, 6); close(deltas.reduce((sum, value) => sum + value, 0), .1);
  close(result.position[1], .95); assert.equal(result.speed, 0);
  assert.equal(result.distance, 0); assert.equal(result.moving, false);
  assert.deepEqual(result.headOffset, [0, 0, 0]);
});

test('blur/unlock and reset discard inertia and sway without a catch-up step', () => {
  const motion = createFirstPersonMotion([0, .6, 0]);
  for (let frame = 0; frame < 60; frame++) motion.step(1 / 60, input(), flatFloor);
  const before = motion.snapshot().position;
  const paused = motion.step(12, input({ active: false }), flatFloor);
  assert.deepEqual(paused.position, before); assert.equal(paused.speed, 0);
  assert.deepEqual(paused.headOffset, [0, 0, 0]);
  assert.deepEqual(motion.step(1 / 60, input({ forward: 0 }), flatFloor).position, before);
  motion.reset([2, .8, -1]);
  assert.deepEqual(motion.snapshot().position, [2, .8, -1]); assert.equal(motion.snapshot().distance, 0);
  assert.equal(motion.snapshot().grounded, false);
  motion.step(1 / 60, input()); motion.stop();
  assert.equal(motion.snapshot().speed, 0);
});

test('head sway uses only actual grounded travel and reduced motion preserves the walking path', () => {
  const normal = walkFor(60, 1), reduced = walkFor(60, 1, { reducedMotion: true });
  assert.deepEqual(normal.position, reduced.position); close(normal.speed, reduced.speed);
  assert.ok(Math.hypot(...normal.headOffset) > 0 && Math.hypot(...normal.headOffset) < .012);
  assert.ok(Math.abs(normal.roll) < .003);
  assert.deepEqual(reduced.headOffset, [0, 0, 0]); assert.equal(reduced.roll, 0);
  const floating = createFirstPersonMotion([0, .6, 0]).step(.1, input());
  assert.deepEqual(floating.headOffset, [0, 0, 0]); assert.equal(floating.grounded, false);
  const noSway = walkFor(60, 1, {}, { headSway: 0 });
  assert.deepEqual(noSway.headOffset, [0, 0, 0]);
});

test('missing or malformed collision results fail closed and do not teleport the eye', () => {
  for (const resolve of [() => undefined, () => [NaN, 0, 0], () => ({ position: [100, .6, 0] }), () => [0, 9, 0], () => { throw new Error('Unavailable collider'); }]) {
    const motion = createFirstPersonMotion([0, .6, 0]);
    const result = motion.step(.1, input(), resolve);
    assert.deepEqual(result.position, [0, .6, 0]); assert.equal(result.grounded, false);
    assert.equal(result.blocked, true); assert.equal(result.speed, 0);
  }
  const motion = createFirstPersonMotion([0, .6, 0]);
  for (const dt of [NaN, Infinity, -1, 0]) assert.deepEqual(motion.step(dt, input()).position, [0, .6, 0]);
  const safe = motion.step(.1, input({ forward: NaN, strafe: Infinity, yaw: NaN }));
  assert.deepEqual(safe.position, [0, .6, 0]);
  assert.throws(() => createFirstPersonMotion([0, NaN, 0]), RangeError);
  assert.throws(() => motion.reset([0, Infinity, 0]), RangeError);
});

test('opt-in capsule contact tolerance accepts measured tiny corrections but keeps the default and teleport guard strict', () => {
  // The real Paris collider adds 0.0000262 horizontal units during a Rapier
  // contact correction. A composed Rapier + cached-GLB test covers that scene;
  // this test keeps both the allowance and its upper safety bound explicit.
  const corrected = (position, delta) => ({ position: [position[0] + delta[0] + .0000026, .6, position[2] + delta[2] - .0000263], grounded: true });
  const strict = createFirstPersonMotion([0, .6, 0]);
  const rejected = strict.step(1 / 40, input(), corrected);
  assert.deepEqual(rejected.position, [0, .6, 0]); assert.equal(rejected.grounded, false);
  const tolerant = createFirstPersonMotion([0, .6, 0], { maxHorizontalCorrection: .002 });
  for (let frame = 0; frame < 80; frame++) tolerant.step(1 / 40, input(), corrected);
  assert.ok(tolerant.snapshot().position[2] < -1.7); assert.equal(tolerant.snapshot().grounded, true);
  for (const allowance of [.002, 1e6]) {
    const motion = createFirstPersonMotion([0, .6, 0], { maxHorizontalCorrection: allowance });
    const escaped = motion.step(1 / 40, input(), (position, delta) => ({ position: [position[0] + .04, .6, position[2] + delta[2]], grounded: true }));
    assert.deepEqual(escaped.position, [0, .6, 0], 'Even an oversized option cannot authorize a .04-unit teleport');
  }
});

test('snapshot and resolver tuples cannot mutate internal controller state', () => {
  const motion = createFirstPersonMotion([0, .6, 0]);
  const state = motion.snapshot(); state.position[0] = 999; state.velocity[2] = 999;
  assert.deepEqual(motion.snapshot().position, [0, .6, 0]); assert.equal(motion.snapshot().speed, 0);
  const result = motion.step(1 / 60, input(), (position, delta) => {
    const resolved = flatFloor(position, delta); position[0] = 1000; delta[2] = -1000;
    return resolved;
  });
  assert.equal(result.position[0], 0); assert.ok(result.position[2] < 0 && result.position[2] > -.02);
});
