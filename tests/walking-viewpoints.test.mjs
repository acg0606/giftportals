import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ts from 'typescript';

// Actual Rapier capsule queries establish reachable geometry. No provider call,
// generated replacement floor, GPU mock or paid generation is involved.
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const viewpointCode = compile(await readFile(new URL('../src/walking-viewpoints.ts', import.meta.url), 'utf8'));
assert.equal(/first-person-physics|\bimport\b/.test(viewpointCode), false, 'The controller type import is erased; the pure helper has no physics runtime import');
const { deriveWalkingViewpoints } = await import(dataUrl(viewpointCode));
const physicsCode = compile(await readFile(new URL('../src/first-person-physics.ts', import.meta.url), 'utf8'))
  .replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`)
  .replace(/from ['"]@dimforge\/rapier3d-compat['"]/g, `from '${import.meta.resolve('@dimforge/rapier3d-compat')}'`);
const { createFirstPersonPhysics } = await import(dataUrl(physicsCode));
const calibrationCode = compile(await readFile(new URL('../src/walk-calibration.ts', import.meta.url), 'utf8'))
  .replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`)
  .replace(/from ['"]three-mesh-bvh['"]/g, `from '${import.meta.resolve('three-mesh-bvh')}'`);
const { findWalkSpawn } = await import(dataUrl(calibrationCode));

const floor = (width = 30, depth = 30) => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
};
const box = (width, height, depth, x, y, z) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.set(x, y, z); return mesh;
};
const create = (root, spawn = [0, 1.65, 0]) => createFirstPersonPhysics(root, { spawn, eyeHeight: 1.65, radius: .2, maxRadius: 20 });
const dispose = root => root.traverse(item => {
  if (!(item instanceof THREE.Mesh)) return;
  item.geometry.dispose(); for (const material of Array.isArray(item.material) ? item.material : [item.material]) material.dispose();
});
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const audit = (points, physics, label = '') => {
  assert.ok(points.length >= 1 && points.length <= 3, `${label}: Arrival plus at most two audited perspectives`);
  assert.equal(points[0].id, 'arrival'); assert.equal(points[0].name, 'Arrival');
  assert.deepEqual(points[0].position, physics.spawn);
  assert.equal(new Set(points.map(point => point.id)).size, points.length);
  for (let i = 0; i < points.length; i++) {
    assert.ok(points[i].position.every(Number.isFinite) && Number.isFinite(points[i].yaw), `${label}: finite coordinates`);
    assert.ok(distance(points[i].position, physics.spawn) <= 4 + .001, `${label}: viewpoint exceeds four metres beyond Rapier's millimetre rounding tolerance: ${JSON.stringify(points[i])}`);
    for (let j = 0; j < i; j++) assert.ok(distance(points[i].position, points[j].position) >= 1.8 - 1e-6, `${label}: duplicates are not renamed as new viewpoints`);
  }
};
const replay = (physics, yaw) => {
  let position = physics.reset();
  for (let i = 0; i < 100; i++) {
    const next = physics.advance(position, [-Math.sin(yaw) * .04, 0, -Math.cos(yaw) * .04], 1 / 60);
    assert.ok(next.position.every(Number.isFinite));
    if (!next.grounded || distance(next.position, position) < .004 || distance(next.position, physics.spawn) > 4 + .001) break;
    position = next.position;
  }
  return position;
};

test('real floor produces unique bounded perspectives and restores the capsule before rendering', async () => {
  const root = floor(), physics = await create(root); let resets = 0;
  const controller = { ...physics, reset() { resets++; return physics.reset(); } };
  try {
    const points = deriveWalkingViewpoints(controller, .25);
    audit(points, physics); assert.equal(points.length, 3); assert.equal(points[0].yaw, .25);
    assert.ok(resets >= 4, 'Each candidate starts at Arrival and the final capsule state is restored');
    for (const point of points.slice(1)) assert.ok(distance(replay(physics, point.yaw), point.position) < .015, 'Published viewpoints come from the same actual walk, not unrelated camera coordinates');
    assert.deepEqual(physics.reset(), physics.spawn);
    const settled = physics.advance(physics.spawn, [0, 0, 0], 1 / 60);
    assert.equal(settled.grounded, true); assert.ok(distance(settled.position, physics.spawn) < .005);
    points[0].position[0] = 900;
    assert.deepEqual(physics.reset(), physics.spawn, 'Returned point arrays do not alias the controller spawn');
  } finally { physics.destroy(); dispose(root); }
});

test('real wall blocks unsupported forward labels while clear side paths can still be discovered', async () => {
  const root = new THREE.Group(); root.add(floor(), box(30, 3, .1, 0, 1.5, -1.25));
  const physics = await create(root);
  try {
    const points = deriveWalkingViewpoints(physics); audit(points, physics);
    assert.ok(points.every(point => point.position[2] > -1.05), JSON.stringify(points));
    assert.ok(points.length > 1, 'The wall does not disable separately audited sideways paths');
    assert.ok(points.slice(1).every(point => Math.abs(point.position[0]) > 1.8));
    assert.deepEqual(physics.reset(), physics.spawn);
  } finally { physics.destroy(); dispose(root); }
});

test('a real floor hole cannot become a bridge or a viewpoint on an unreachable far island', async () => {
  const root = new THREE.Group(), near = floor(30, 2), far = floor(30, 10); far.position.z = -8; root.add(near, far);
  const physics = await create(root);
  try {
    const points = deriveWalkingViewpoints(physics); audit(points, physics);
    assert.ok(points.every(point => point.position[2] >= -1.001), JSON.stringify(points));
    assert.ok(points.every(point => point.position[2] > -3), 'A separate floor beyond the gap is never advertised as walkable from Arrival');
    assert.deepEqual(physics.reset(), physics.spawn);
  } finally { physics.destroy(); dispose(root); }
});

test('a small isolated footprint returns Arrival without manufacturing extra landmarks', async () => {
  const root = floor(2, 2), physics = await create(root);
  try {
    const points = deriveWalkingViewpoints(physics, NaN); audit(points, physics);
    assert.deepEqual(points.map(point => [point.id, point.name]), [['arrival', 'Arrival']]);
    assert.equal(points[0].yaw, 0); assert.deepEqual(physics.reset(), physics.spawn);
  } finally { physics.destroy(); dispose(root); }
});

test('a real descending slope keeps viewpoint heights on the provider geometry', async () => {
  const root = floor(); root.rotation.x -= Math.atan(.08); const physics = await create(root);
  try {
    const points = deriveWalkingViewpoints(physics); audit(points, physics); assert.equal(points.length, 3);
    const forward = points[1]; assert.ok(forward.position[2] < -3.8); assert.ok(forward.position[1] < physics.spawn[1] - .25, JSON.stringify(points));
    for (const point of points.slice(1)) assert.ok(Math.abs(point.position[1] - (point.position[2] * .08 + 1.668)) < .04, JSON.stringify(point));
    assert.deepEqual(physics.reset(), physics.spawn);
  } finally { physics.destroy(); dispose(root); }
});

test('a failed audit restores the real controller and empty geometry never invents Arrival', async () => {
  const root = floor(), physics = await create(root); let resets = 0;
  try {
    const controller = { ...physics, reset() { resets++; return physics.reset(); }, advance() { throw new Error('Synthetic interrupted audit'); } };
    assert.throws(() => deriveWalkingViewpoints(controller), /interrupted audit/);
    assert.equal(resets, 3); assert.deepEqual(physics.reset(), physics.spawn);
    await assert.rejects(create(new THREE.Group()), /WALK_COLLIDER_INVALID/);
  } finally { physics.destroy(); dispose(root); }
});

// These values are the verified per-world transforms used by the staged gift
// catalog, not Paris coordinates copied across unrelated provider assets.
for (const scene of [
  { id: 'Rio', path: '../public/demo/rio-collider.glb', scale: 3.4777204990386963, offset: 1.5319561958312988, preferred: [0, -.897626, 0] },
  { id: 'Paris', path: '../public/demo/v23/paris-approach-collider.glb', scale: 2.9049978, offset: 1.6893421, preferred: [0, 1.329693672, 0] },
  { id: 'Antikythera', path: '../public/demo/v13/antikythera-collider.glb', scale: 2.4615827, offset: 1.4774647, preferred: [0, 1.550620, 0] },
]) test(`${scene.id}: actual transformed public collider supplies only audited walking viewpoints`, async () => {
  const bytes = await readFile(new URL(scene.path, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const root = gltf.scene; root.rotation.x = Math.PI; root.scale.setScalar(scene.scale); root.position.y = scene.offset;
  let physics;
  try {
    const spawn = findWalkSpawn(root, scene.preferred, 1.65, .2);
    assert.ok(spawn, `${scene.id}: measured near-camera floor and clear capsule must exist`);
    physics = await create(root, spawn); assert.ok(physics.triangles > 1000 && physics.meshes > 0);
    const points = deriveWalkingViewpoints(physics); audit(points, physics, scene.id);
    assert.ok(points.length >= 2, `${scene.id}: actual geometry supports a distinct short path`);
    for (const point of points.slice(1)) assert.ok(distance(replay(physics, point.yaw), point.position) < .03, `${scene.id}: advertised point is reached by replaying the audited capsule path`);
    assert.deepEqual(physics.reset(), physics.spawn);
    const settled = physics.advance(physics.spawn, [0, 0, 0], 1 / 60); assert.equal(settled.grounded, true);
    assert.ok(distance(settled.position, physics.spawn) < .04);
  } finally { physics?.destroy(); dispose(root); }
});
