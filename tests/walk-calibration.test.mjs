import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Staged tests read dependencies from the installed app but execute staged TS.
const canonical = 'C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals';
const project = fileURLToPath(new URL('../', import.meta.url));
const assetProject = existsSync(resolve(project, 'public/demo')) ? project : process.env.GIFTPORTALS_TEST_APP_ROOT || canonical;
let require = createRequire(import.meta.url);
try { require.resolve('typescript'); } catch { require = createRequire(resolve(canonical, 'package.json')); }
const moduleUrl = name => pathToFileURL(require.resolve(name).replace(/three\.cjs$/, 'three.module.js').replace(/build[\\/]index\.umd\.cjs$/, 'src/index.js')).href;
const THREE = await import(moduleUrl('three'));
const { GLTFLoader } = await import(moduleUrl('three/addons/loaders/GLTFLoader.js'));
const ts = require('typescript');
const compiled = ts.transpileModule(await readFile(new URL('../src/walk-calibration.ts', import.meta.url), 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
  .replace(/from ['"]three['"]/g, `from '${moduleUrl('three')}'`)
  .replace(/from ['"]three-mesh-bvh['"]/g, `from '${moduleUrl('three-mesh-bvh')}'`);
const { findWalkSpawn } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const floor = (width = 12, depth = 12, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial());
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); return mesh;
};
const box = (width, height, depth, x, y, z) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, z); return mesh;
};
const close = (actual, expected, epsilon = 1e-5) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} differs from ${expected}`);
const dispose = root => root.traverse(item => {
  if (item instanceof THREE.Mesh) { item.geometry.dispose(); for (const material of Array.isArray(item.material) ? item.material : [item.material]) material.dispose(); }
});

test('a supported floor preserves preferred XZ and puts the eye at the measured ground height', () => {
  const root = floor(12, 12, 0, -.7);
  try {
    const spawn = findWalkSpawn(root, [1.25, .95, -2]);
    assert.ok(spawn); close(spawn[0], 1.25); close(spawn[1], .95); close(spawn[2], -2);
  } finally { dispose(root); }
});

test('the provider rotation, scale, parent transform and offset all reach world-space floor queries', () => {
  const parent = new THREE.Group(), root = new THREE.Group(); parent.add(root); root.add(floor());
  parent.position.set(3, 4, -2); parent.rotation.y = .4; root.rotation.x = Math.PI; root.scale.setScalar(2.5);
  try {
    const spawn = findWalkSpawn(root, [3, 5.65, -2]);
    assert.ok(spawn); close(spawn[0], 3); close(spawn[1], 5.65); close(spawn[2], -2);
  } finally { dispose(parent); }
});

test('a wall at the preferred point selects a nearby capsule-clear location within the two-unit search', () => {
  const root = new THREE.Group(); root.add(floor(), box(.2, 3, 2, 0, 1.5, 0));
  try {
    const spawn = findWalkSpawn(root, [0, 1.65, 0]);
    assert.ok(spawn); close(spawn[1], 1.65);
    assert.ok(Math.hypot(spawn[0], spawn[2]) > .2 && Math.hypot(spawn[0], spawn[2]) <= 2.000001);
    assert.ok(Math.abs(spawn[0]) >= .298 || Math.abs(spawn[2]) >= 1.198, 'The full body must clear the solid wall, not just the ground ray');
  } finally { dispose(root); }
});

test('low ceiling clearance rejects a floor when no human-height candidate fits', () => {
  const root = new THREE.Group(); root.add(floor(), box(12, .1, 12, 0, 1.25, 0));
  try { assert.equal(findWalkSpawn(root, [0, 0, 0]), undefined); }
  finally { dispose(root); }
});

test('a roof above the near-camera probe is not selected over the room floor', () => {
  const root = new THREE.Group(); root.add(floor(), box(12, .1, 12, 0, 3, 0));
  try {
    const spawn = findWalkSpawn(root, [0, 1.65, 0]); assert.ok(spawn); close(spawn[1], 1.65);
  } finally { dispose(root); }
});

test('a low ceiling below the probe cannot become a substitute roof spawn', () => {
  const root = new THREE.Group(); root.add(floor(), box(12, .1, 12, 0, 1.25, 0));
  try { assert.equal(findWalkSpawn(root, [0, 1.65, 0]), undefined, 'The original room has no human-height clearance; standing on its ceiling is not an arrival floor'); }
  finally { dispose(root); }
});

test('unsupported holes, narrow footprints, empty meshes and steep slopes never manufacture a floor', () => {
  const empty = new THREE.Group(), hole = new THREE.Group(); hole.add(floor(3, 12, -4), floor(3, 12, 4));
  const narrow = floor(.15, 12), steep = floor(); steep.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), Math.PI / 3);
  for (const root of [empty, hole, narrow, steep]) {
    try { assert.equal(findWalkSpawn(root, [0, 1.65, 0]), undefined); }
    finally { dispose(root); }
  }
});

test('a central hole can use an actually supported nearby floor without bridging the gap', () => {
  const root = new THREE.Group(); root.add(floor(5, 12, -2.7), floor(5, 12, 2.7));
  try {
    const spawn = findWalkSpawn(root, [0, 1.65, 0]); assert.ok(spawn); close(spawn[1], 1.65);
    assert.ok(Math.abs(spawn[0]) >= .42, 'The footprint ring must stay on one bank of the hole');
  } finally { dispose(root); }
});

test('invalid dimensions, malformed preferred coordinates and nonfinite mesh vertices are rejected', () => {
  const root = floor();
  try {
    for (const preferred of [[NaN, 1, 0], [0, Infinity, 0], [0, 1], [0, '1', 0], null]) assert.equal(findWalkSpawn(root, preferred), undefined);
    for (const [eye, radius] of [[NaN, .2], [.4, .1], [3.01, .2], [1.65, NaN], [1.65, .04], [1.65, .56]]) assert.equal(findWalkSpawn(root, [0, 1.65, 0], eye, radius), undefined);
    root.geometry.getAttribute('position').setX(0, NaN);
    assert.equal(findWalkSpawn(root, [0, 1.65, 0]), undefined);
  } finally { dispose(root); }
});

test('spawn searches never replace or dispose source geometry, material, topology, transform or BVH', () => {
  const root = new THREE.Group(), mesh = floor(); root.add(mesh); root.rotation.x = Math.PI; root.scale.setScalar(2); root.position.y = .4; root.updateMatrixWorld(true);
  const geometry = mesh.geometry, material = mesh.material, sentinel = { providerOwned: true }; geometry.boundsTree = sentinel;
  const position = geometry.getAttribute('position').array.slice(), index = geometry.index.array.slice(), attributes = Object.keys(geometry.attributes);
  const transform = { position: mesh.position.toArray(), rotation: mesh.rotation.toArray(), scale: mesh.scale.toArray(), rootPosition: root.position.toArray(), rootRotation: root.rotation.toArray(), rootScale: root.scale.toArray() };
  let disposal = 0; geometry.addEventListener('dispose', () => disposal++); material.addEventListener('dispose', () => disposal++);
  try {
    const first = findWalkSpawn(root, [0, 2.05, 0]), second = findWalkSpawn(root, [0, 2.05, 0]); assert.deepEqual(first, second); assert.ok(first);
    assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material); assert.equal(geometry.boundsTree, sentinel); assert.equal(disposal, 0);
    assert.deepEqual(geometry.getAttribute('position').array, position); assert.deepEqual(geometry.index.array, index); assert.deepEqual(Object.keys(geometry.attributes), attributes);
    assert.deepEqual({ position: mesh.position.toArray(), rotation: mesh.rotation.toArray(), scale: mesh.scale.toArray(), rootPosition: root.position.toArray(), rootRotation: root.rotation.toArray(), rootScale: root.scale.toArray() }, transform);
    assert.equal(material.side, THREE.FrontSide); assert.deepEqual(root.children, [mesh]);
  } finally { dispose(root); }
});

for (const scene of [
  {id:'Rio',file:'public/demo/rio-collider.glb',scale:3.4777204990386963,offset:1.5319561958312988,eye:-.897626},
  {id:'Antikythera',file:'public/demo/v13/antikythera-collider.glb',scale:2.4615827,offset:1.4774647,eye:1.550620},
  {id:'Approved Paris',file:'public/demo/v23/paris-approach-collider.glb',scale:2.9049978,offset:1.6893421,eye:1.329693672},
]) test(`${scene.id}: the real calibrated provider collider finds the audited starting floor`, async () => {
  const bytes = await readFile(resolve(assetProject, scene.file));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const root = gltf.scene; root.rotation.x = Math.PI; root.scale.setScalar(scene.scale); root.position.y = scene.offset;
  try {
    const spawn = findWalkSpawn(root, [0, scene.offset, 0]); assert.ok(spawn); close(spawn[0], 0); close(spawn[2], 0); close(spawn[1], scene.eye, .0001);
  } finally { dispose(root); }
});
