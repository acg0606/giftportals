import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import * as THREE from 'three';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const runtime = data(compile(await readFile(new URL('../src/viewer-runtime.ts', import.meta.url), 'utf8')));
const sceneSource = await readFile(new URL('../src/collection-scene.ts', import.meta.url), 'utf8');
// Exercise the scene's real pre-decode validator without loading Spark/WebGL.
const validatorSource = 'const MAX_IMAGE_PIXELS=16_777_216;\n' + sceneSource.slice(sceneSource.indexOf('function imageDimensions('), sceneSource.indexOf('export interface CollectionEnvironmentConfig'));
const {validateCollectionGLB} = await import(data(compile(validatorSource)));
const source = await readFile(new URL('../src/collection-props.ts', import.meta.url), 'utf8');
const controller = data(compile(source)
  .replace("import * as THREE from 'three';", 'const THREE=globalThis.__propFixture.THREE;')
  .replace("import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';", 'const GLTFLoader=globalThis.__propFixture.GLTFLoader;')
  .replace("from './viewer-runtime'", `from '${runtime}'`));
const flush = async () => { await setImmediate(); await setImmediate(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const prop = (id = 'photo-frame', extra = {}) => ({id, modelUrl: `/synthetic/${id}.glb`, position: [0, 0, 0], maxBounds: [2, 2, 2], ...extra});
function glb(id, extra = {}) {
  const document = {asset: {version: '2.0'}, buffers: [{byteLength: 0}], nodes: [], extras: {id}, ...extra};
  let text = JSON.stringify(document); text += ' '.repeat((4 - text.length % 4) % 4);
  const encoded = Buffer.from(text), bytes = Buffer.alloc(28 + encoded.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(encoded.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16);
  encoded.copy(bytes, 20); bytes.writeUInt32LE(0, 20 + encoded.length); bytes.writeUInt32LE(0x004e4942, 24 + encoded.length);
  return bytes;
}
let sequence = 0;
async function fixture(action, settings = {}) {
  const names = ['__propFixture', 'fetch', 'setTimeout', 'clearTimeout', 'document'], saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const state = {current: true, parent: new THREE.Group(), requests: [], models: [], parses: [], changes: [], activations: [], invalidations: 0, timers: new Map(), handles: [], canvases: []};
  let timerId = 0;
  function model(id) {
    const root = new THREE.Group();
    const geometry = settings.triangle ? new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0], 3)) : new THREE.BoxGeometry(2, 1, .4);
    const material = new THREE.MeshStandardMaterial({color: '#987654', roughness: .45, metalness: .2}), mesh = new THREE.Mesh(geometry, material);
    root.add(mesh);
    if (settings.transform) { root.position.set(3, -4, 5); root.scale.set(2, 3, 1); mesh.position.set(.2, .1, -.1); }
    if (settings.shared) root.add(new THREE.Mesh(geometry, material));
    const value = {id, root, mesh, geometry, material, geometriesDisposed: 0, materialsDisposed: 0, texturesDisposed: 0, imagesClosed: 0};
    geometry.addEventListener('dispose', () => value.geometriesDisposed++); material.addEventListener('dispose', () => value.materialsDisposed++);
    if (settings.texture) {
      const image = {width: settings.largeTexture ? 4096 : 512, height: settings.largeTexture ? 2048 : 256, close() { value.imagesClosed++; }};
      const first = new THREE.Texture(image), second = new THREE.Texture(image);
      first.addEventListener('dispose', () => value.texturesDisposed++); second.addEventListener('dispose', () => value.texturesDisposed++);
      material.map = first; material.normalMap = second; value.image = image;
      if (settings.invalidTexture) {
        const invalid = new THREE.Texture({width: 0, height: 256});
        invalid.addEventListener('dispose', () => value.texturesDisposed++); material.lightMap = invalid;
      }
    }
    if (settings.invalidModel) mesh.position.x = NaN;
    state.models.push(value); return value;
  }
  class Loader {
    constructor(manager) { this.manager = manager; }
    async parseAsync(buffer) {
      const bytes = new Uint8Array(buffer), length = new DataView(buffer).getUint32(12, true), id = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))).extras.id;
      const value = model(id), plan = deferred(); state.parses.push({...plan, id, manager: this.manager});
      if (settings.defer?.includes(id)) await plan.promise;
      if (settings.externalDecode) this.manager.resolveURL('https://external.invalid/texture.png');
      if (settings.failDecode) throw new Error('Synthetic decode unavailable');
      return {scene: value.root};
    }
  }
  const values = {
    __propFixture: {THREE, GLTFLoader: Loader},
    fetch: async (url, options) => {
      state.requests.push({url, options}); const id = /([^/]+)\.glb$/.exec(url)?.[1];
      if (settings.failDownload?.includes(id)) return new Response('Synthetic unavailable', {status: 404});
      const bytes = glb(id, settings.externalGLB ? {images: [{uri: 'https://external.invalid/image.png'}]} : {});
      return new Response(bytes, {headers: {'content-length': String(bytes.length)}});
    },
    setTimeout: (callback, delay) => { state.timers.set(++timerId, {callback, delay}); return timerId; },
    clearTimeout: id => state.timers.delete(id),
    document: {createElement(kind) { assert.equal(kind, 'canvas'); const canvas = {width: 0, height: 0, draws: [], getContext() { return {drawImage: (...args) => canvas.draws.push(args)}; }}; state.canvases.push(canvas); return canvas; }},
  };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
  const module = await import(controller + '#' + ++sequence);
  state.mount = (props = [prop()], extra = {}) => {
    const handle = module.mountCollectionProps({parent: state.parent, props, origin: 'https://giftportals.vercel.app', isCurrent: () => state.current, validateGLB: validateCollectionGLB, onActivate: id => state.activations.push(id), onInvalidate: () => state.invalidations++, onState: outcome => state.changes.push(outcome), ...extra});
    state.handles.push(handle); return handle;
  };
  try { await action(state); } finally {
    state.handles.forEach(handle => handle.destroy());
    for (const [name, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
}
const close = (a, b) => assert.ok(Math.abs(a - b) < .000001, `${a} should equal ${b}`);

test('props preserve Tripo transforms and PBR materials while fitting uniformly on their configured bases', async () => fixture(async state => {
  const config = prop('photo-frame', {position: [1.2, -.3, -2], rotation: [0, Math.PI / 6, 0], scale: 4, maxBounds: [.8, .6, .4]});
  const handle = state.mount([config]); await handle.ready;
  assert.deepEqual(await handle.outcomes, [{id: 'photo-frame', state: 'ready'}]);
  const asset = state.models[0], wrapper = state.parent.children[0], bounds = handle.bounds('photo-frame'), size = bounds.getSize(new THREE.Vector3());
  assert.deepEqual(asset.root.position.toArray(), [3, -4, 5]); assert.deepEqual(asset.root.scale.toArray(), [2, 3, 1]); assert.deepEqual(asset.mesh.position.toArray(), [.2, .1, -.1]);
  assert.equal(asset.mesh.material, asset.material); close(asset.material.roughness, .45); close(asset.material.metalness, .2);
  assert.equal(wrapper.userData.provider, 'Tripo'); close(wrapper.scale.x, wrapper.scale.y); close(wrapper.scale.y, wrapper.scale.z);
  close(bounds.getCenter(new THREE.Vector3()).x, 1.2); close(bounds.min.y, -.3); close(bounds.getCenter(new THREE.Vector3()).z, -2);
  assert.ok(size.x <= .800001 && size.y <= .600001 && size.z <= .400001); assert.equal(state.invalidations, 1); assert.equal(state.timers.size, 0);
  const sceneMeshes = []; state.parent.traverse(object => { if (object instanceof THREE.Mesh) sceneMeshes.push(object); }); assert.deepEqual(sceneMeshes, [asset.mesh]);
}, {transform: true}));

test('picking uses actual mesh triangles, rejects empty corners and respects ancestor visibility', async () => fixture(async state => {
  const handle = state.mount(); await handle.ready;
  const emptyCorner = new THREE.Raycaster(new THREE.Vector3(.6, 1.6, 2), new THREE.Vector3(0, 0, -1));
  const realTriangle = new THREE.Raycaster(new THREE.Vector3(-.5, .5, 2), new THREE.Vector3(0, 0, -1));
  assert.equal(handle.pick(emptyCorner), undefined); assert.equal(handle.pick(realTriangle), 'photo-frame'); close(handle.hit(realTriangle).distance, 2);
  assert.equal(handle.activate('photo-frame'), true); assert.deepEqual(state.activations, ['photo-frame']); assert.equal(handle.activate('travel-journal'), false);
  state.parent.visible = false; assert.equal(handle.pick(realTriangle), undefined); assert.equal(handle.activate('photo-frame'), false);
}, {triangle: true}));

test('the nearest real prop wins and its activation remains separate from the other action', async () => fixture(async state => {
  const handle = state.mount([prop('photo-frame', {position: [0, 0, -1]}), prop('travel-journal', {position: [0, 0, 0]})]); await handle.ready;
  const ray = new THREE.Raycaster(new THREE.Vector3(0, .5, 4), new THREE.Vector3(0, 0, -1));
  assert.equal(handle.pick(ray), 'travel-journal'); assert.equal(handle.activate('travel-journal'), true); assert.deepEqual(state.activations, ['travel-journal']);
}));

test('a missing prop settles independently and does not prevent the other real GLB from appearing', async () => fixture(async state => {
  const handle = state.mount([prop('photo-frame'), prop('travel-journal')]); await handle.ready;
  assert.deepEqual(await handle.outcomes, [{id: 'photo-frame', state: 'failed'}, {id: 'travel-journal', state: 'ready'}]);
  assert.equal(state.parent.children.length, 1); assert.equal(handle.bounds('photo-frame'), undefined); assert.equal(handle.activate('photo-frame'), false); assert.equal(handle.activate('travel-journal'), true);
  assert.equal(state.requests.every(request => request.options.credentials === 'omit' && request.options.redirect === 'error' && request.options.referrerPolicy === 'no-referrer'), true);
}, {failDownload: ['photo-frame']}));

test('external-resource GLBs are rejected by the existing scene validator before decode', async () => fixture(async state => {
  const handle = state.mount(); await handle.ready;
  assert.deepEqual(await handle.outcomes, [{id: 'photo-frame', state: 'failed'}]); assert.equal(state.parses.length, 0); assert.equal(state.parent.children.length, 0);
}, {externalGLB: true}));

test('an invalid or credential-bearing asset URL cannot issue a request', async () => fixture(async state => {
  const handle = state.mount([prop('photo-frame', {modelUrl: 'https://user:password@external.invalid/asset.glb'})]); await handle.ready;
  assert.equal(state.requests.length, 0); assert.deepEqual(await handle.outcomes, [{id: 'photo-frame', state: 'failed'}]);
}));

test('the watchdog resolves readiness while a slow decode is pending and discards its late GLB', async () => fixture(async state => {
  const handle = state.mount([prop('photo-frame'), prop('travel-journal')]); await flush();
  assert.equal(state.parent.children.length, 1); assert.equal(state.timers.size, 1); const timer = [...state.timers.values()][0]; assert.equal(timer.delay, 45000); timer.callback();
  await handle.ready; assert.deepEqual(await handle.outcomes, [{id: 'photo-frame', state: 'failed'}, {id: 'travel-journal', state: 'ready'}]);
  const changes = state.changes.length, invalidations = state.invalidations; state.parses.find(value => value.id === 'photo-frame').resolve(); await flush();
  assert.equal(state.parent.children.length, 1); assert.equal(state.changes.length, changes); assert.equal(state.invalidations, invalidations);
  const late = state.models.find(value => value.id === 'photo-frame'); assert.equal(late.geometriesDisposed, 1); assert.equal(late.materialsDisposed, 1);
}, {defer: ['photo-frame']}));

test('destroy settles immediately and prevents callbacks or insertion from a late decode', async () => fixture(async state => {
  const handle = state.mount(); await flush(); handle.destroy(); handle.destroy(); await handle.ready;
  assert.deepEqual(await handle.outcomes, [{id: 'photo-frame', state: 'aborted'}]); assert.equal(state.timers.size, 0); assert.equal(state.changes.length, 0);
  state.parses[0].resolve(); await flush(); assert.equal(state.parent.children.length, 0); assert.equal(state.invalidations, 0); assert.equal(handle.activate('photo-frame'), false);
  assert.equal(state.models[0].geometriesDisposed, 1); assert.equal(state.models[0].materialsDisposed, 1);
}, {defer: ['photo-frame']}));

test('a rerouted screen rejects stale decode work without publishing state', async () => fixture(async state => {
  const handle = state.mount(); await flush(); state.current = false; state.parses[0].resolve(); await handle.ready;
  assert.deepEqual(await handle.outcomes, [{id: 'photo-frame', state: 'aborted'}]); assert.equal(state.parent.children.length, 0); assert.equal(state.changes.length, 0); assert.equal(state.invalidations, 0); assert.equal(state.models[0].geometriesDisposed, 1);
}, {defer: ['photo-frame']}));

test('shared imported geometry, materials, textures and decoded images are disposed exactly once', async () => fixture(async state => {
  const handle = state.mount(); await handle.ready; const value = state.models[0]; handle.destroy(); handle.destroy();
  assert.equal(value.geometriesDisposed, 1); assert.equal(value.materialsDisposed, 1); assert.equal(value.texturesDisposed, 2); assert.equal(value.imagesClosed, 1); assert.equal(state.parent.children.length, 0);
}, {shared: true, texture: true}));

test('texture budgeting preserves aspect ratio and reuses one resized image across PBR maps', async () => fixture(async state => {
  const handle = state.mount([prop()], {textureLimit: 1024}); await handle.ready; const value = state.models[0];
  assert.equal(state.canvases.length, 1); assert.equal(value.material.map.image, value.material.normalMap.image); assert.equal(value.material.map.image.width, 1024); assert.equal(value.material.map.image.height, 512); assert.equal(value.imagesClosed, 1);
  handle.destroy(); assert.equal(value.imagesClosed, 1); assert.equal(value.texturesDisposed, 2);
}, {texture: true, largeTexture: true}));

test('invalid decoded transforms fail locally and release all imported resources', async () => fixture(async state => {
  const handle = state.mount(); await handle.ready; assert.deepEqual(await handle.outcomes, [{id: 'photo-frame', state: 'failed'}]); assert.equal(state.parent.children.length, 0);
  assert.equal(state.models[0].geometriesDisposed, 1); assert.equal(state.models[0].materialsDisposed, 1);
}, {invalidModel: true}));

test('partial texture preparation failure cannot close a shared source bitmap twice', async () => fixture(async state => {
  const handle = state.mount([prop()], {textureLimit: 1024}); await handle.ready;
  assert.deepEqual(await handle.outcomes, [{id: 'photo-frame', state: 'failed'}]); assert.equal(state.parent.children.length, 0);
  const value = state.models[0]; assert.equal(value.imagesClosed, 1); assert.equal(value.texturesDisposed, 3); assert.equal(value.geometriesDisposed, 1); assert.equal(value.materialsDisposed, 1);
}, {texture: true, largeTexture: true, invalidTexture: true}));

test('empty optional props resolve without requests and invalid configuration fails before starting work', async () => fixture(async state => {
  const empty = state.mount([]); await empty.ready; assert.deepEqual(await empty.outcomes, []); assert.equal(state.requests.length, 0);
  for (const props of [[prop(), prop()], [prop('photo-frame', {maxBounds: [1, 0, 1]})], [prop('photo-frame', {position: [NaN, 0, 0]})], [prop('photo-frame', {scale: -1})]]) assert.throws(() => state.mount(props), /COLLECTION_PROP_CONFIG_INVALID/);
  assert.equal(state.requests.length, 0); assert.equal(state.timers.size, 0);
}));
