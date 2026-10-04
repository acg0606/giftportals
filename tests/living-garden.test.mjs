import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ts from 'typescript';

const source = await readFile(new URL('../src/living-garden.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`)
  .replace(/from ['"]three-mesh-bvh['"]/g, `from '${import.meta.resolve('three-mesh-bvh')}'`);
const { createLivingGarden } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const floor = (width = 12, depth = 12) => {
  const value = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial());
  value.rotation.x = -Math.PI / 2; return value;
};
const box = (width, height, depth, x, y, z) => {
  const value = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshBasicMaterial());
  value.position.set(x, y, z); return value;
};
const routes = [
  { start: [-2, -1], end: [2, -1], initialProgress: .15 },
  { start: [-2, 1], end: [2, 1], initialProgress: .3, reverse: true },
];
const dispose = root => root.traverse(item => {
  if (item instanceof THREE.Mesh) {
    item.geometry.dispose();
    for (const material of Array.isArray(item.material) ? item.material : [item.material]) material.dispose();
  }
});

test('two human-height visitors stand on world-space ground and stay below 30 mesh draws', () => {
  const root = new THREE.Group(); root.add(floor());
  root.rotation.x = Math.PI; root.scale.setScalar(1.7); root.position.set(4, .8, -6);
  const garden = createLivingGarden(root, { groundProbeY: 2, routes: [
    { start: [4, -5], end: [6, -5] }, { start: [4, -7], end: [6, -7] },
  ] });
  try {
    assert.equal(garden.count, 2);
    assert.equal(garden.actors.length, 2);
    const meshes = [], geometries = new Set(), materials = new Set();
    garden.group.traverse(item => {
      if (item instanceof THREE.Mesh) { meshes.push(item); geometries.add(item.geometry); materials.add(item.material); }
    });
    assert.ok(meshes.length <= 28, `Mesh draws: ${meshes.length}`);
    assert.ok(geometries.size <= 6 && materials.size <= 8, 'Visitors share their primitives and materials');
    for (let index = 0; index < 2; index++) {
      const actor = garden.actors[index];
      assert.ok(Math.abs(actor.position[1] - .818) < 1e-6, JSON.stringify(actor));
      assert.ok(actor.height >= 1.65 && actor.height <= 1.75);
      const body = garden.group.children.find(item => item.name === (index ? 'Garden visitor in sage' : 'Garden visitor in terracotta'));
      const bounds = new THREE.Box3().setFromObject(body);
      assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y - actor.height) < .003);
      assert.ok(Math.abs(bounds.min.y - actor.position[1]) < .003, 'The mesh feet agree with the telemetry anchor');
    }
    const snapshot = garden.actors;
    snapshot[0].position[0] = 900;
    snapshot[0].route[0][0] = 900;
    assert.ok(garden.actors[0].position[0] < 10 && garden.actors[0].route[0][0] < 10, 'Telemetry is a copy');
  } finally { garden.destroy(); dispose(root); }
});

test('empty, unsupported, steep and overlapping routes produce no visitors or replacement floor', () => {
  const empty = new THREE.Group();
  const missing = createLivingGarden(empty, { routes });
  assert.equal(missing.count, 0); assert.equal(missing.group.children.length, 0); missing.destroy();
  const fixtures = [
    { root: floor(6, 6), routes: [{ start: [-2, -2.85], end: [2, -2.85] }, routes[1]] },
    { root: floor(), routes: [{ start: [-2, 0], end: [2, 0] }, { start: [-2, .5], end: [2, .5] }] },
  ];
  const steep = floor(); steep.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), .6); fixtures.push({ root: steep, routes });
  for (const fixture of fixtures) {
    const garden = createLivingGarden(fixture.root, { routes: fixture.routes });
    try { assert.equal(garden.count, 0); assert.equal(garden.group.children.length, 0); }
    finally { garden.destroy(); dispose(fixture.root); }
  }
});

test('a hole midway through otherwise supported route endpoints rejects the whole pair', () => {
  const root = new THREE.Group(), left = floor(3, 10), right = floor(3, 10);
  left.position.x = -1.85; right.position.x = 1.85; root.add(left, right);
  const garden = createLivingGarden(root, { routes });
  try { assert.equal(garden.count, 0); assert.deepEqual(garden.actors, []); }
  finally { garden.destroy(); dispose(root); }
});

test('body clearance rejects walls, low ceilings and a thin grazing obstacle between ground samples', () => {
  const fixtures = [
    box(.08, 2.5, 1, 0, 1.25, -1),
    box(3, .08, 1, 0, 1.45, -1),
    // The nearest samples are x ±.074 m. Their capsules miss this narrow post;
    // its interior still intersects the capsule's continuous lateral sweep.
    box(.003, 2, .003, 0, 1, -.6404),
  ];
  for (const obstacle of fixtures) {
    const root = new THREE.Group(); root.add(floor(), obstacle);
    const garden = createLivingGarden(root, { routes });
    try { assert.equal(garden.count, 0); }
    finally { garden.destroy(); dispose(root); }
  }
});

test('elapsed seconds give matching movement at 30, 60 and 120 fps, with hips fixed to the real ground', () => {
  const snapshots = [];
  for (const fps of [30, 60, 120]) {
    const root = floor(), garden = createLivingGarden(root, { routes });
    try {
      const hips = garden.group.children.filter(item => item.name.startsWith('Garden visitor')).map(body => body.children.filter(child => child instanceof THREE.Group).map(limb => limb.position.y));
      for (let frame = 0; frame < fps * 8; frame++) garden.update(1 / fps);
      snapshots.push(garden.actors.map(actor => actor.position));
      for (const actor of garden.actors) assert.ok(Math.abs(actor.position[1] - .018) < 1e-6, 'No artificial vertical bob');
      assert.deepEqual(garden.group.children.filter(item => item.name.startsWith('Garden visitor')).map(body => body.children.filter(child => child instanceof THREE.Group).map(limb => limb.position.y)), hips);
      const before = garden.actors;
      for (const invalid of [0, -1, NaN, Infinity, 61]) garden.update(invalid);
      assert.deepEqual(garden.actors, before);
    } finally { garden.destroy(); dispose(root); }
  }
  for (let index = 1; index < snapshots.length; index++) for (let actor = 0; actor < 2; actor++) {
    assert.ok(new THREE.Vector3(...snapshots[0][actor]).distanceTo(new THREE.Vector3(...snapshots[index][actor])) < 1e-8);
  }
});

test('visitors reach a finite endpoint, turn, and return rather than teleporting or leaving their audited corridor', () => {
  const root = floor(), garden = createLivingGarden(root, { routes: [
    { start: [0, -1], end: [2, -1] }, { start: [0, 1], end: [2, 1] },
  ] });
  try {
    const start = garden.actors[0].position;
    garden.update(5); assert.ok(Math.abs(garden.actors[0].position[0] - 2) < 1e-9);
    garden.update(.475); assert.ok(Math.abs(garden.actors[0].position[0] - 2) < 1e-9, 'Turning remains at the endpoint');
    garden.update(.475); garden.update(5);
    assert.ok(new THREE.Vector3(...garden.actors[0].position).distanceTo(new THREE.Vector3(...start)) < 1e-9);
    let moved = false, previous = garden.actors[0].position;
    for (let frame = 0; frame < 1000; frame++) {
      garden.update(.02); const current = garden.actors[0].position;
      const distance = new THREE.Vector3(...current).distanceTo(new THREE.Vector3(...previous));
      assert.ok(distance < .01, `No jump between frames: ${distance}`);
      assert.ok(current[0] >= -1e-9 && current[0] <= 2 + 1e-9 && current[2] === -1);
      moved ||= distance > .001; previous = current;
    }
    assert.ok(moved, 'The actor actually moves through 3D world space');
  } finally { garden.destroy(); dispose(root); }
});

test('destroy disposes shared visitor resources once and preserves caller collider ownership', () => {
  const root = floor(), garden = createLivingGarden(root, { routes });
  const resources = new Map(); let callerDisposals = 0;
  root.geometry.addEventListener('dispose', () => callerDisposals++);
  root.material.addEventListener('dispose', () => callerDisposals++);
  garden.group.traverse(item => {
    if (!(item instanceof THREE.Mesh)) return;
    for (const value of [item.geometry, item.material]) if (!resources.has(value)) {
      resources.set(value, 0); value.addEventListener('dispose', () => resources.set(value, resources.get(value) + 1));
    }
  });
  garden.destroy(); garden.destroy(); garden.update(1);
  assert.equal(callerDisposals, 0);
  assert.ok([...resources.values()].every(count => count === 1));
  assert.equal(garden.group.children.length, 0); assert.deepEqual(garden.actors, []);
  dispose(root);
});

test('the actual transformed V23 Eiffel collider supports both near-arrival routes and visible initial visitors', async () => {
  const bytes = await readFile(new URL('../public/demo/v23/paris-approach-collider.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const root = gltf.scene; root.rotation.x = Math.PI; root.scale.setScalar(2.9049978); root.position.y = 1.6893421;
  root.traverse(item => { if (item instanceof THREE.Mesh) for (const material of Array.isArray(item.material) ? item.material : [item.material]) material.side = THREE.DoubleSide; });
  const garden = createLivingGarden(root), ray = new THREE.Raycaster();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, .08, 150); camera.position.set(0, 1.3478, 0); camera.updateMatrixWorld();
  try {
    assert.equal(garden.count, 2);
    for (const actor of garden.actors) {
      const projected = new THREE.Vector3(actor.position[0], actor.position[1] + actor.height * .55, actor.position[2]).project(camera);
      assert.ok(Math.abs(projected.x) < .9 && Math.abs(projected.y) < .9 && projected.z > -1 && projected.z < 1, 'Visible at the first desktop arrival frame');
      assert.ok(actor.route.length > 15);
      for (let index = 0; index < actor.route.length; index++) {
        const point = actor.route[index];
        assert.ok(point[0] >= 4 && point[0] <= 8 && point[2] >= -8.1 && point[2] <= -3, JSON.stringify(point));
        if (index) assert.ok(Math.hypot(point[0] - actor.route[index - 1][0], point[2] - actor.route[index - 1][2]) <= .15 + 1e-8);
      }
    }
    let previous = garden.actors;
    for (let frame = 0; frame < 1800; frame++) {
      garden.update(1 / 60);
      if (frame % 60) continue;
      for (const actor of garden.actors) {
        ray.set(new THREE.Vector3(actor.position[0], actor.position[1] + .2, actor.position[2]), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(root, true)[0];
        assert.ok(hit && Math.abs(actor.position[1] - hit.point.y - .018) < 1e-6, 'Feet follow the actual collider throughout the walk');
      }
      assert.ok(garden.actors.some((actor, index) => Math.hypot(actor.position[0] - previous[index].position[0], actor.position[2] - previous[index].position[2]) > .005), 'World-space translation provides actual parallax');
      previous = garden.actors;
    }
    console.log('living-garden-real-routes', JSON.stringify(garden.actors.map(actor => ({ height: actor.height, start: actor.route[0], end: actor.route.at(-1), samples: actor.route.length }))));
  } finally { garden.destroy(); dispose(root); }
});
