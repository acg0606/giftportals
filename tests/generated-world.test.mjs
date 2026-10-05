import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import * as Three from 'three';
import ts from 'typescript';

// Real Three camera math, motion integration, and bounded viewer runtime.
// GPU/Spark and first-person physics lifecycle are deliberately synthetic;
// separate Rapier tests establish geometry behavior, not this viewer fixture.
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const runtime = dataUrl(compile(await readFile(new URL('../src/viewer-runtime.ts', import.meta.url), 'utf8')));
const flight = dataUrl(compile(await readFile(new URL('../src/world-flight.ts', import.meta.url), 'utf8')));
const firstPersonMotion = dataUrl(compile(await readFile(new URL('../src/first-person-motion.ts', import.meta.url), 'utf8')));
const walkingSky = dataUrl(compile(await readFile(new URL('../src/walking-sky.ts', import.meta.url), 'utf8')).replace(/import \* as THREE from 'three';/, 'const THREE = globalThis.__worldFixture.THREE;'));
const navigation = dataUrl(compile(await readFile(new URL('../src/world-navigation.ts', import.meta.url), 'utf8')).replace(/import \* as THREE from 'three';/, 'const THREE = globalThis.__worldFixture.THREE;').replace(/from 'three-mesh-bvh'/,`from '${import.meta.resolve('three-mesh-bvh')}'`));
const walkCalibration = dataUrl(compile(await readFile(new URL('../src/walk-calibration.ts', import.meta.url), 'utf8')).replace(/import \* as THREE from 'three';/, 'const THREE = globalThis.__worldFixture.THREE;').replace(/from 'three-mesh-bvh'/, `from '${import.meta.resolve('three-mesh-bvh')}'`));
const walkingViewpoints = dataUrl(compile(await readFile(new URL('../src/walking-viewpoints.ts', import.meta.url), 'utf8')));
const walkingTour = dataUrl(compile(await readFile(new URL('../src/walking-tour.ts', import.meta.url), 'utf8')));
const controller = dataUrl(compile(await readFile(new URL('../src/generated-world.ts', import.meta.url), 'utf8'))
  .replace(/import \* as THREE from 'three';/, 'const THREE = globalThis.__worldFixture.THREE;')
  .replace(/import \{ SparkRenderer, SplatMesh \} from '@sparkjsdev\/spark';/, 'const { SparkRenderer, SplatMesh } = globalThis.__worldFixture;')
  .replace(/import \{ GLTFLoader \} from 'three\/addons\/loaders\/GLTFLoader.js';/, 'const { GLTFLoader } = globalThis.__worldFixture;')
  .replace(/from '\.\/world-navigation'/, `from '${navigation}'`)
  .replace(/from '\.\/first-person-motion'/, `from '${firstPersonMotion}'`)
  .replace(/from '\.\/walking-sky'/, `from '${walkingSky}'`)
  .replace(/import \{ createLivingGarden \} from '\.\/living-garden';/, 'const { createLivingGarden } = globalThis.__worldFixture;')
  .replace(/import\('\.\/first-person-physics'\)/, 'Promise.resolve({ createFirstPersonPhysics: globalThis.__worldFixture.createFirstPersonPhysics })')
  .replace(/import\('\.\/walk-calibration'\)/, 'globalThis.__worldFixture.loadWalkCalibration()')
  .replace(/import\('\.\/walking-viewpoints'\)/, 'globalThis.__worldFixture.loadWalkingViewpoints()')
  .replace(/from '\.\/world-flight'/, `from '${flight}'`)
  .replace(/from '\.\/walking-tour'/, `from '${walkingTour}'`)
  .replace(/from '\.\/viewer-runtime'/, `from '${runtime}'`));
const flush = async () => { await setImmediate(); await setImmediate(); };
let sequence = 0;

async function fixture(action, settings = {}) {
  const names = ['document', 'window', 'location', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'ResizeObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'fetch', 'matchMedia', 'createImageBitmap', '__worldFixture'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const frames = new Map(), renderers = [], meshes = [], sparks = [], requests = [], projections = [], errors = [], walking = [], tours = [], viewpoints = [], cameraPoses = [], firstPersonStates = [], physicsInstances = [], bitmaps = [], gardens = [], gardenStates = [], walkingPointReports = [], lifecycle = [], walkingTours = [];
  let walkingTourCallback;
  const firstPerson = settings.firstPerson === true ? { spawn: [0, 1.55, .03], eyeHeight: 1.55, metricScale: 1, groundOffset: 0, walkSpeed: 1.15 } : settings.firstPerson;
  let intersection, visibilityDisconnected = 0;
  let frameId = 0, ready = 0, resizeDisconnected = 0, resolveDecode, resolveCollision, resolvePhysics, resolveCalibration, resolveViewpoints, calibrationLoads = 0, viewpointLoads = 0, collisionParses = 0, collisionGeometryDisposed = 0, collisionMaterialDisposed = 0, pointerLockExits = 0, now=0;
  const initialized = new Promise(resolve => { resolveDecode = resolve; });
  const collider = new Three.Group();
  const groundGeometry = new Three.PlaneGeometry(8, 8), groundMaterial = new Three.MeshBasicMaterial({ side: Three.DoubleSide });
  groundGeometry.addEventListener('dispose', () => collisionGeometryDisposed++); groundMaterial.addEventListener('dispose', () => collisionMaterialDisposed++);
  const ground = new Three.Mesh(groundGeometry, groundMaterial); ground.rotation.x = Math.PI / 2; ground.position.y = .6; collider.add(ground);
  const collisionParsed = settings.deferCollision ? new Promise(resolve => { resolveCollision = resolve; }) : Promise.resolve({ scene: collider });
  class CollisionLoader { parseAsync() { collisionParses++; return settings.badCollision ? Promise.reject(new Error('Synthetic malformed collider')) : collisionParsed; } }
  class Motion extends EventTarget {
    matches = Boolean(settings.reducedMotion); listeners = new Set();
    addEventListener(type, callback, options) { if (type === 'change') this.listeners.add(callback); super.addEventListener(type, callback, options); }
    removeEventListener(type, callback, options) { if (type === 'change') this.listeners.delete(callback); super.removeEventListener(type, callback, options); }
    set(value) { this.matches = value; this.dispatchEvent(new Event('change')); }
  }
  const motion = new Motion();
  class Element extends EventTarget {
    attributes = new Map(); children = []; parent = null; captures = new Set(); captured = []; released = [];
    addEventListener(type, callback, options) { if (options?.signal) setMaxListeners(0, options.signal); super.addEventListener(type, callback, options); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(child) { child.parent = this; this.children.push(child); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
    getBoundingClientRect() { return { width: 900, height: 500, top: 0, bottom: 500, left: 0, right: 900 }; }
    focus() {}
    hasPointerCapture(id) { return this.captures.has(id); }
    setPointerCapture(id) { this.captures.add(id); this.captured.push(id); }
    releasePointerCapture(id) { if (!this.captures.delete(id)) return; this.released.push(id); const event = new Event('lostpointercapture'); Object.assign(event, { pointerId: id }); this.dispatchEvent(event); }
    requestPointerLock() { doc.pointerLockElement = this; doc.dispatchEvent(new Event('pointerlockchange')); }
  }
  class Renderer {
    domElement = new Element(); frames = []; cameras = []; disposed = false; lost = false;
    constructor(options) { this.options = options; renderers.push(this); }
    setPixelRatio(ratio) { this.ratio = ratio; }
    setSize(width, height) { this.size = [width, height]; }
    render(scene, camera) { camera.updateMatrixWorld(); this.scene = scene; this.frames.push(camera.position.clone()); this.cameras.push(camera.clone()); }
    dispose() { this.disposed = true; }
    forceContextLoss() { this.lost = true; }
  }
  class Spark extends Three.Object3D { constructor(options) { super(); this.options = options; sparks.push(this); } dispose() { this.disposed = true; } }
  class Splats extends Three.Object3D { constructor(options) { super(); this.options = options; this.initialized = initialized; meshes.push(this); } dispose() { this.disposed = true; } }
  const doc = new EventTarget(); doc.visibilityState = 'visible'; doc.pointerLockElement = null;
  doc.exitPointerLock = () => { pointerLockExits++; doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); };
  const win = new EventTarget();
  const physicsReady = settings.deferPhysics ? new Promise(resolve => { resolvePhysics = resolve; }) : Promise.resolve();
  const calibrationReady = settings.deferCalibration ? new Promise(resolve => { resolveCalibration = resolve; }) : Promise.resolve();
  const viewpointsReady = settings.deferViewpoints ? new Promise(resolve => { resolveViewpoints = resolve; }) : Promise.resolve();
  const loadWalkCalibration = async () => { calibrationLoads++; await calibrationReady; return import(walkCalibration); };
  const loadWalkingViewpoints = async () => { viewpointLoads++; await viewpointsReady; return import(walkingViewpoints); };
  const createFirstPersonPhysics = async (root, options) => {
    const controller = { root, options, spawn: [...options.spawn], advances: [], resets: 0, destroys: 0,
      advance(position, displacement, dt) { controller.advances.push({ position: [...position], displacement: [...displacement], dt }); return { position: [position[0] + displacement[0], options.spawn[1], position[2] + displacement[2]], grounded: true }; },
      reset() { controller.resets++; return [...controller.spawn]; },
      destroy() { controller.destroys++; },
    };
    physicsInstances.push(controller); await physicsReady;
    if (settings.badPhysics) throw new Error('Synthetic unavailable physics');
    return controller;
  };
  const createLivingGarden = root => {
    if (settings.badGarden) throw new Error('Synthetic unavailable ambient layer');
    const garden = { root, group: new Three.Group(), count: settings.emptyGarden ? 0 : 2, updates: [], destroys: 0, elapsed: 0,
      get actors() { return Array.from({ length: garden.count }, (_, index) => ({ position: [4 + index, 0, -3 - garden.elapsed], height: 1.7 })); },
      update(dt) { garden.updates.push(dt); garden.elapsed += dt; }, destroy() { garden.destroys++; garden.group.removeFromParent(); },
    };
    gardens.push(garden); return garden;
  };
  const values = { document: doc, window: win, location: { origin: 'http://127.0.0.1:4323' }, devicePixelRatio: 3, innerWidth: 390, innerHeight: 844,
    ResizeObserver: class { constructor(callback) { this.callback = callback; } observe() { this.callback(); } disconnect() { resizeDisconnected++; } },
    IntersectionObserver: settings.observeVisibility ? class { constructor(callback) { intersection = callback; } observe() {} disconnect() { visibilityDisconnected++; } } : undefined,
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame: id => frames.delete(id),
    fetch: async (url, options) => { requests.push({ url, options }); if (settings.collisionFetchFailure && url.includes('collider.glb')) throw new Error('Synthetic unavailable collider'); return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } }); },
    matchMedia: () => motion,
    createImageBitmap: settings.bitmapAvailable ? async () => { const bitmap = { width: 512, height: 256, closes: 0, close() { bitmap.closes++; } }; bitmaps.push(bitmap); return bitmap; } : undefined,
    __worldFixture: { THREE: { ...Three, WebGLRenderer: Renderer }, SparkRenderer: Spark, SplatMesh: Splats, GLTFLoader: CollisionLoader, createFirstPersonPhysics, createLivingGarden, loadWalkCalibration, loadWalkingViewpoints },
  };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const host = new Element(); host.setAttribute('tabindex', '7'); let viewer;
  try {
    const { mountGeneratedWorld } = await import(`${controller}#${++sequence}`);
    viewer = mountGeneratedWorld(host, settings.url ?? '/synthetic/world.spz', { points: settings.points || [{ id: 'front', position: [.3, .2, -3] }, { id: 'behind', position: [0, 0, 3] }],
      collisionUrl: settings.collisionUrl, onWalkingChange: state => { walking.push(state); lifecycle.push(['walking', state.available]); },
      initialYaw: settings.initialYaw, initialPitch: settings.initialPitch,
      flightProfile: settings.flightProfile, onViewpointChange: state => viewpoints.push(state),
      authoredRoute: settings.authoredRoute, flightTiming: settings.flightTiming, scenicDrift: settings.scenicDrift,
      freeFlight: settings.freeFlight, manualRadius: settings.manualRadius, manualStep: settings.manualStep, maxSplats: settings.maxSplats,
      firstPerson, onFirstPersonState: state => { firstPersonStates.push(state); lifecycle.push(['first-person', state.ready]); },
      onWalkingViewpoints: points => { walkingPointReports.push(points); lifecycle.push(['viewpoints', points.length]); },
      onWalkingTour: settings.guidedWalking ? state => { walkingTours.push(state); walkingTourCallback?.(state); } : undefined,
      onGardenState: state => gardenStates.push(state),
      panoramaUrl: settings.panoramaUrl, panoramaYaw: settings.panoramaYaw,
      onCameraPose: settings.captureCamera ? pose => cameraPoses.push(pose) : undefined,
      onReady: () => ready++, onError: message => errors.push(message), onPoints: points => projections.push(points), onTourChange: state => tours.push(state) });
    await flush();
    await action({ viewer, host, renderers, meshes, sparks, requests, projections, errors, frames, walking, motion, tours, viewpoints, cameraPoses, firstPersonStates, physicsInstances, bitmaps, gardens, gardenStates, walkingPointReports, lifecycle, walkingTours, onWalkingTour: callback => { walkingTourCallback = callback; },
      ready: () => ready, resizeDisconnected: () => resizeDisconnected, decode: async () => { resolveDecode(); await flush(); },
      collisionParses: () => collisionParses, collisionDisposals: () => ({ geometry: collisionGeometryDisposed, material: collisionMaterialDisposed }),
      completeCollision: async () => { resolveCollision?.({ scene: collider }); await flush(); },
      completePhysics: async () => { resolvePhysics?.(); await flush(); }, pointerLockExits: () => pointerLockExits,
      completeCalibration: async () => { resolveCalibration?.(); await flush(); }, completeViewpoints: async () => { resolveViewpoints?.(); await flush(); },
      calibrationLoads: () => calibrationLoads, viewpointLoads: () => viewpointLoads,
      draw: (elapsed = 60) => { const callbacks = [...frames.values()]; frames.clear(); now+=elapsed;callbacks.forEach(callback => callback(now)); },
      document: doc, window: win,
      visible: value => intersection?.([{ target: host, isIntersecting: value, intersectionRatio: value ? 1 : 0 }]), visibilityDisconnected: () => visibilityDisconnected,
    });
  } finally { viewer?.destroy(); resolveDecode(); resolveCollision?.({ scene: collider }); resolvePhysics?.(); resolveCalibration?.(); resolveViewpoints?.(); await flush(); for (const name of names) { const descriptor = saved.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
}

const keyboard = (target, type, key, repeat = false) => {
  const event = new Event(type, { cancelable: true }); Object.assign(event, { key, repeat }); target.dispatchEvent(event); return event;
};
const pointerEvent = (target, type, values = {}) => {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerType: 'mouse', isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0, ...values }); target.dispatchEvent(event); return event;
};

const gardenSettings = { firstPerson: { spawn: [0, 1.65, 0], eyeHeight: 1.65, metricScale: 1, groundOffset: 0, livingGarden: true }, collisionUrl: '/synthetic/collider.glb' };

test('guided walking waits for decode, pauses when hidden, resumes Next explicitly and releases navigation on destroy', async () => {
  await fixture(async state => {
    assert.equal(state.viewer.startWalkingTour(),false);await state.decode();state.draw();assert.equal(state.walkingTours.at(-1).available,true);
    assert.equal(state.viewer.startWalkingTour(),true);state.draw();state.viewer.nextWalkingTour();state.draw();state.draw(50);
    assert.equal(state.walkingTours.at(-1).index,1);const before=state.renderers[0].frames.at(-1).clone();assert.ok(before.distanceTo(new Three.Vector3(...state.physicsInstances[0].spawn))<=.03);
    state.visible(false);assert.equal(state.walkingTours.at(-1).phase,'paused');state.draw(60000);assert.equal(state.viewer.resumeWalkingTour(),false);
    state.visible(true);state.viewer.nextWalkingTour();assert.equal(state.walkingTours.at(-1).phase,'playing');state.draw(60000);assert.ok(state.renderers[0].frames.at(-1).distanceTo(before)<.001,'resuming resets elapsed time');state.draw(50);
    state.motion.set(true);assert.equal(state.walkingTours.at(-1).phase,'paused');assert.equal(state.viewer.resumeWalkingTour(),false);state.viewer.nextWalkingTour();assert.equal(state.walkingTours.at(-1).index,2);assert.equal(state.walkingTours.at(-1).phase,'paused');state.draw();assert.equal(state.frames.size,0);
    state.viewer.destroy();state.draw(60000);assert.equal(state.physicsInstances[0].destroys,1);assert.equal(state.frames.size,0);assert.equal(state.motion.listeners.size,0);assert.equal(state.visibilityDisconnected(),1);assert.equal(state.viewer.startWalkingTour(),false);
  },{...gardenSettings,guidedWalking:true,observeVisibility:true});
});

test('destroy inside a walking chapter callback prevents a later render or callback in the same frame', async () => {
  await fixture(async state => {
    await state.decode();state.draw();state.viewer.startWalkingTour();state.draw();const renderer=state.renderers[0],renders=renderer.frames.length,poses=state.cameraPoses.length;
    state.onWalkingTour(tour=>{if(tour.index===1)state.viewer.destroy();});state.draw(12000);
    assert.equal(state.physicsInstances[0].destroys,1);assert.equal(renderer.frames.length,renders);assert.equal(state.cameraPoses.length,poses);assert.equal(state.frames.size,0);assert.equal(state.errors.length,0);assert.equal(renderer.disposed,true);
  },{...gardenSettings,guidedWalking:true,captureCamera:true});
});

test('a return corridor aligns the actual eye before translating, and manual pause resumes from its current yaw', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); state.viewer.startWalkingTour(); state.draw(); state.viewer.nextWalkingTour(); state.draw();
    let frames = 0;
    while (state.walkingTours.at(-1).stage !== 'observing' && frames++ < 300) state.draw(100);
    assert.equal(state.walkingTours.at(-1).index, 1); assert.equal(state.walkingTours.at(-1).stage, 'observing');
    state.viewer.nextWalkingTour(); state.draw(16); assert.equal(state.walkingTours.at(-1).index, 2);
    state.viewer.nextWalkingTour(); state.draw(16); assert.equal(state.walkingTours.at(-1).index, 3); assert.equal(state.walkingTours.at(-1).stage, 'turning');
    const endpoint = state.renderers[0].cameras.at(-1).position.clone(); let previousYaw = state.renderers[0].cameras.at(-1).rotation.y;
    for (let index = 0; index < 6; index++) {
      state.draw(100); const camera = state.renderers[0].cameras.at(-1);
      assert.equal(camera.position.distanceTo(endpoint), 0); assert.ok(camera.rotation.y > previousYaw && camera.rotation.y - previousYaw <= .08 + 1e-9); previousYaw = camera.rotation.y;
    }
    state.viewer.look(-.2, 0); state.draw(16); assert.equal(state.walkingTours.at(-1).phase, 'paused');
    const manualYaw = state.renderers[0].cameras.at(-1).rotation.y; assert.ok(Math.abs(manualYaw - previousYaw + .2) < 1e-9);
    assert.equal(state.viewer.resumeWalkingTour(), true); state.draw(60000);
    assert.equal(state.renderers[0].cameras.at(-1).rotation.y, manualYaw); assert.equal(state.renderers[0].cameras.at(-1).position.distanceTo(endpoint), 0);
    frames = 0;
    while (state.walkingTours.at(-1).stage === 'turning' && frames++ < 60) {
      state.draw(100); const camera = state.renderers[0].cameras.at(-1);
      if (state.walkingTours.at(-1).stage === 'turning') assert.equal(camera.position.distanceTo(endpoint), 0);
    }
    const aligned = state.renderers[0].cameras.at(-1);
    assert.equal(state.walkingTours.at(-1).stage, 'walking'); assert.ok(aligned.position.distanceTo(endpoint) > 0 && aligned.position.distanceTo(endpoint) <= .055 + 1e-9);
    assert.ok(Math.abs(Math.atan2(Math.sin(Math.PI - aligned.rotation.y), Math.cos(Math.PI - aligned.rotation.y))) <= .11, 'Translation begins only after the eye faces the return tangent');
  }, { ...gardenSettings, guidedWalking: true });
});

test('a second touch looks while the movement pad stays held, independently of the first contact', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); state.viewer.setWalking(true); state.viewer.setMoveInput(0, 1); state.draw(16);
    const before = state.renderers[0].cameras.at(-1).clone();
    pointerEvent(state.host, 'pointerdown', { pointerType: 'touch', isPrimary: false, pointerId: 2, clientX: 200, clientY: 300 });
    assert.equal(state.host.hasPointerCapture(2), true);
    pointerEvent(state.host, 'pointermove', { pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: 260, clientY: 310 });
    pointerEvent(state.host, 'pointermove', { pointerType: 'touch', isPrimary: false, pointerId: 2, clientX: 260, clientY: 310 });
    for (let index = 0; index < 20; index++) state.draw(16);
    const after = state.renderers[0].cameras.at(-1);
    assert.ok(Math.abs(after.rotation.y - before.rotation.y + .21) < 1e-9, 'Only the captured look finger contributes horizontal rotation');
    assert.ok(Math.abs(after.rotation.x - before.rotation.x + .025) < 1e-9);
    assert.ok(after.position.distanceTo(before.position) > .1, 'Looking does not release the held movement input');
    pointerEvent(state.host, 'pointerup', { pointerType: 'touch', isPrimary: true, pointerId: 1 });
    assert.equal(state.host.hasPointerCapture(2), true, 'Lifting the pad contact cannot release the look contact');
    pointerEvent(state.host, 'pointerup', { pointerType: 'touch', isPrimary: false, pointerId: 2 });
    assert.deepEqual(state.host.released, [2]); state.viewer.setMoveInput(0, 0);
  }, { firstPerson: true, collisionUrl: '/synthetic/collider.glb' });
});

test('stationary touch taps and contact jitter keep the guided walk playing; real drag pauses and turns it', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); state.viewer.startWalkingTour(); state.draw();
    pointerEvent(state.host, 'pointerdown', { pointerType: 'touch', pointerId: 3, clientX: 100, clientY: 100 });
    pointerEvent(state.host, 'pointermove', { pointerType: 'touch', pointerId: 3, clientX: 101, clientY: 101 });
    pointerEvent(state.host, 'pointerup', { pointerType: 'touch', pointerId: 3, clientX: 101, clientY: 101 }); state.draw(100);
    assert.equal(state.walkingTours.at(-1).phase, 'playing');
    const before = state.renderers[0].cameras.at(-1).clone();
    pointerEvent(state.host, 'pointerdown', { pointerType: 'touch', pointerId: 4, clientX: 100, clientY: 100 });
    pointerEvent(state.host, 'pointermove', { pointerType: 'touch', pointerId: 4, clientX: 120, clientY: 110 }); state.draw(16);
    assert.equal(state.walkingTours.at(-1).phase, 'paused'); assert.equal(state.walkingTours.at(-1).reason, 'manual');
    assert.ok(Math.abs(state.renderers[0].cameras.at(-1).rotation.y - before.rotation.y + .07) < 1e-9);
    pointerEvent(state.host, 'pointercancel', { pointerType: 'touch', pointerId: 4 }); assert.equal(state.host.captures.size, 0);
  }, { ...gardenSettings, guidedWalking: true });
});

test('blur, hidden, offscreen and disposal release look capture without stale movement or blocking the next drag', async () => {
  await fixture(async state => {
    await state.decode(); state.draw();
    let id = 10;
    for (const mode of ['blur', 'hidden', 'offscreen']) {
      pointerEvent(state.host, 'pointerdown', { pointerType: 'touch', pointerId: id, clientX: 100, clientY: 100 });
      assert.equal(state.host.hasPointerCapture(id), true);
      if (mode === 'blur') state.window.dispatchEvent(new Event('blur'));
      else if (mode === 'hidden') { state.document.visibilityState = 'hidden'; state.document.dispatchEvent(new Event('visibilitychange')); }
      else state.visible(false);
      assert.equal(state.host.hasPointerCapture(id), false);
      const before = state.renderers[0].cameras.at(-1).rotation.y;
      pointerEvent(state.host, 'pointermove', { pointerType: 'touch', pointerId: id, clientX: 180, clientY: 100 });
      if (mode === 'hidden') { state.document.visibilityState = 'visible'; state.document.dispatchEvent(new Event('visibilitychange')); }
      else if (mode === 'offscreen') state.visible(true);
      state.draw(16); assert.equal(state.renderers[0].cameras.at(-1).rotation.y, before);
      pointerEvent(state.host, 'pointerdown', { pointerType: 'touch', pointerId: id + 1, clientX: 100, clientY: 100 });
      pointerEvent(state.host, 'pointermove', { pointerType: 'touch', pointerId: id + 1, clientX: 112, clientY: 100 }); state.draw(16);
      assert.ok(Math.abs(state.renderers[0].cameras.at(-1).rotation.y - before + .042) < 1e-9);
      pointerEvent(state.host, 'pointerup', { pointerType: 'touch', pointerId: id + 1 }); id += 2;
    }
    pointerEvent(state.host, 'pointerdown', { pointerType: 'touch', pointerId: id }); const renders = state.renderers[0].frames.length;
    state.viewer.destroy(); assert.equal(state.host.captures.size, 0);
    assert.equal(state.host.released.filter(value => value === id).length, 1);
    pointerEvent(state.host, 'pointermove', { pointerType: 'touch', pointerId: id, clientX: 100 }); state.draw(1000);
    assert.equal(state.renderers[0].frames.length, renders); assert.equal(state.frames.size, 0);
  }, { firstPerson: true, collisionUrl: '/synthetic/collider.glb', observeVisibility: true });
});

test('mouse drag retains look behavior and ignores secondary buttons; a gesture callback can safely destroy its viewer', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); state.viewer.startTour(); state.draw();
    pointerEvent(state.host, 'pointerdown', { button: 2 }); pointerEvent(state.host, 'pointermove', { button: 2, clientX: 50 });
    assert.equal(state.host.captures.size, 0); assert.equal(state.tours.at(-1).phase, 'playing');
    pointerEvent(state.host, 'pointerdown'); pointerEvent(state.host, 'pointermove', { clientX: 0 });
    assert.equal(state.tours.at(-1).phase, 'playing', 'A stationary mouse contact is not a drag');
    const before = state.renderers[0].cameras.at(-1).rotation.y;
    pointerEvent(state.host, 'pointermove', { clientX: 10 }); state.draw(16);
    assert.equal(state.tours.at(-1).phase, 'paused'); assert.ok(Math.abs(state.renderers[0].cameras.at(-1).rotation.y - before + .035) < 1e-9);
    pointerEvent(state.host, 'pointerup'); assert.equal(state.host.captures.size, 0);
  });
  await fixture(async state => {
    await state.decode(); state.draw(); state.viewer.startWalkingTour(); state.draw();
    state.onWalkingTour(tour => { if (tour.phase === 'paused') state.viewer.destroy(); });
    pointerEvent(state.host, 'pointerdown', { pointerType: 'touch', pointerId: 23 });
    assert.doesNotThrow(() => pointerEvent(state.host, 'pointermove', { pointerType: 'touch', pointerId: 23, clientX: 8 }));
    assert.equal(state.host.captures.size, 0); assert.equal(state.renderers[0].disposed, true); assert.equal(state.errors.length, 0); assert.equal(state.frames.size, 0);
  }, { ...gardenSettings, guidedWalking: true });
});

test('walking preserves the provider scene without generating placeholder visitors or an idle animation loop', async () => {
  await fixture(async state => {
    assert.equal(state.gardens.length, 0);
    assert.deepEqual(state.gardenStates.at(-1), { actors: 0, playing: false, positions: [] });
    await state.decode(); state.draw();
    state.viewer.setWalking(true); state.draw(16); state.draw(16); state.draw(600);
    assert.equal(state.frames.size, 0, 'A stationary player does not keep decorative rendering alive');
    assert.equal(state.gardens.length, 0);
    assert.ok(state.physicsInstances[0].advances.every(step => Math.hypot(step.displacement[0], step.displacement[2]) === 0));
    state.viewer.destroy(); state.viewer.destroy(); assert.equal(state.physicsInstances[0].destroys, 1);
  }, gardenSettings);
});

test('legacy garden opt-in remains disabled across visibility, focus and reduced motion changes', async () => {
  await fixture(async state => {
    await state.decode(); state.viewer.setWalking(true); state.draw(16);
    const suspendAndResume = (suspend, resume) => {
      suspend(); state.draw(5000); resume(); state.draw(5000);
      assert.equal(state.gardens.length, 0);
      assert.equal(state.gardenStates.at(-1).actors, 0);
    };
    suspendAndResume(() => state.viewer.setWalking(false), () => state.viewer.setWalking(true));
    suspendAndResume(() => state.motion.set(true), () => state.motion.set(false));
    suspendAndResume(() => state.window.dispatchEvent(new Event('blur')), () => state.window.dispatchEvent(new Event('focus')));
    suspendAndResume(() => { state.document.visibilityState = 'hidden'; state.document.dispatchEvent(new Event('visibilitychange')); }, () => { state.document.visibilityState = 'visible'; state.document.dispatchEvent(new Event('visibilitychange')); });
    suspendAndResume(() => state.visible(false), () => state.visible(true));
  }, { ...gardenSettings, observeVisibility: true });
});

test('ambient creation failures, unsupported routes and late physics leave the walking renderer usable', async () => {
  for (const setting of [{ badGarden: true }, { emptyGarden: true }]) await fixture(async state => {
    await state.decode(); state.draw(); assert.equal(state.ready(), 1); assert.equal(state.errors.length, 0);
    assert.equal(state.viewer.setWalking(true), true); state.draw(16); state.draw(16);
    assert.equal(state.gardenStates.at(-1).actors, 0); assert.equal(state.gardenStates.at(-1).playing, false);
    assert.equal(state.frames.size, 0);
  }, { ...gardenSettings, ...setting });
  await fixture(async state => {
    state.viewer.destroy(); await state.completePhysics(); await state.decode();
    assert.equal(state.gardens.length, 0); assert.equal(state.gardenStates.length, 0);
    assert.equal(state.physicsInstances[0].destroys, 1);
  }, { ...gardenSettings, deferPhysics: true });
  await fixture(async state => { await state.decode(); state.draw(); assert.equal(state.gardens.length, 0); }, { firstPerson: true, collisionUrl: '/synthetic/collider.glb' });
});

test('actual camera projection follows look/reset and bounded movement after decoding, with private bounded fetch', async () => {
  await fixture(async state => {
    assert.equal(state.requests.length, 1); assert.equal(state.requests[0].url, 'http://127.0.0.1:4323/synthetic/world.spz');
    assert.equal(state.requests[0].options.credentials, 'omit'); assert.equal(state.requests[0].options.referrerPolicy, 'no-referrer'); assert.equal(state.requests[0].options.redirect, 'error');
    assert.equal(state.meshes[0].options.maxSplats, 500000); assert.equal(state.meshes[0].options.fileName, 'gift-world.spz'); assert.equal(state.meshes[0].rotation.x, Math.PI);
    assert.equal(state.renderers[0].ratio, 1); state.draw(); assert.equal(state.ready(), 0);
    await state.decode(); state.draw(); assert.equal(state.ready(), 1);
    const first = state.projections.at(-1); assert.equal(first.find(point => point.id === 'front').visible, true); assert.equal(first.find(point => point.id === 'behind').visible, false);
    state.viewer.look(Math.PI, 0); state.draw(); assert.equal(state.projections.at(-1).find(point => point.id === 'front').visible, false);
    state.viewer.reset(); state.draw(); assert.equal(state.projections.at(-1).find(point => point.id === 'front').visible, true);
    for (let index = 0; index < 30; index++) state.viewer.forward(); state.draw();
    assert.ok(state.renderers[0].frames.at(-1).distanceTo(new Three.Vector3(0, 0, .03)) <= 1); assert.equal(state.ready(), 1);
    state.viewer.destroy(); assert.equal(state.requests[0].options.signal.aborted, true); assert.equal(state.host.getAttribute('tabindex'), '7');
    assert.equal(state.host.children.length, 0); assert.equal(state.frames.size, 0); assert.equal(state.renderers[0].disposed, true); assert.equal(state.renderers[0].lost, true);
    assert.equal(state.meshes[0].disposed, true); assert.equal(state.sparks[0].disposed, true); assert.equal(state.resizeDisconnected(), 1);
  });
});

test('an authored cinematic corridor moves the actual camera, keeps gentle parallax during scenic stops, and freezes when paused', async () => {
  const route = {
    arrival: [
      { position: [-1.2, .7, 1.4], target: [0, .8, -5], fov: 76 },
      { position: [-.55, .38, .7], target: [0, .8, -5], fov: 72 },
      { position: [.15, .08, .12], target: [0, .8, -5], fov: 68 },
    ],
    viewpoints: [{ pointId: 'front', pose: { position: [.15, .08, .12], target: [0, .8, -5], fov: 68 } }, { pointId: 'behind', pose: { position: [.8, .25, -.25], target: [-1, .4, -4], fov: 72 } }],
  };
  await fixture(async state => {
    await state.decode(); state.draw(); assert.equal(state.viewer.startTour(), true); state.draw();
    assert.deepEqual(state.renderers[0].frames.at(-1).toArray(), route.arrival[0].position);
    for (let i = 0; i < 40; i++) state.draw(100);
    assert.equal(state.tours.at(-1).stage, 'reading');
    const before = state.renderers[0].frames.at(-1).clone(); state.draw(1000); const drifted = state.renderers[0].frames.at(-1).clone();
    assert.ok(drifted.distanceTo(before) > .05, 'Scenic stops retain genuine camera translation, rather than a frozen photo');
    assert.ok(drifted.distanceTo(new Three.Vector3(...route.viewpoints[0].pose.position)) < .3, 'The drift stays close to the reviewed camera corridor');
    state.viewer.pauseTour('user'); state.draw(1000); state.draw(1000);
    assert.equal(state.renderers[0].frames.at(-1).distanceTo(drifted), 0, 'Pausing freezes the real camera as well as the UI');
    assert.equal(state.meshes[0].options.maxSplats, 2083441, 'The verified detailed asset count is passed to Spark without silent truncation');
  }, { authoredRoute: route, flightTiming: { arrivalMs: 4000, readingMs: 6000 }, scenicDrift: .18, maxSplats: 2083441 });
});

test('opt-in free flight supports altitude and a larger bounded exploration radius while old gift movement remains unchanged', async () => {
  await fixture(async state => {
    await state.decode(); state.draw();
    for (let i = 0; i < 50; i++) state.viewer.forward(); state.draw();
    const origin = new Three.Vector3(0, 0, .03), advanced = state.renderers[0].frames.at(-1);
    assert.ok(advanced.distanceTo(origin) > 3.5 && advanced.distanceTo(origin) <= 4);
    state.viewer.reset(); state.viewer.elevate(1); state.draw(); assert.ok(Math.abs(state.renderers[0].frames.at(-1).y - .12) < 1e-9);
    const key = new Event('keydown', { cancelable: true }); Object.defineProperties(key, { key: { value: 'e' }, repeat: { value: true } }); state.host.dispatchEvent(key); state.draw();
    assert.equal(key.defaultPrevented, true); assert.ok(Math.abs(state.renderers[0].frames.at(-1).y - .24) < 1e-9);
  }, { freeFlight: true, manualRadius: 4 });
  await fixture(async state => { await state.decode(); state.draw(); state.viewer.elevate(1); state.draw(); assert.equal(state.renderers[0].frames.at(-1).y, 0); });
});

test('a malformed authored corridor cannot bypass camera validation or reduced-motion behavior', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); state.viewer.startTour(); state.draw();
    assert.equal(state.tours.at(-1).phase, 'paused'); assert.equal(state.tours.at(-1).reason, 'motion');
    const position = state.renderers[0].frames.at(-1).clone(); assert.ok(position.length() < 5);
    state.draw(1000); assert.equal(state.renderers[0].frames.at(-1).distanceTo(position), 0);
  }, { reducedMotion: true, scenicDrift: .3, authoredRoute: { arrival: [{ position: [100000, 0, 0], target: [0, 0, -5], fov: 68 }], viewpoints: [] } });
});

test('cinematic manual steps feel larger, stay inside their radius, and grounded walking retains the legacy speed', async () => {
  let legacyDistance;
  await fixture(async state => {
    await state.decode(); state.draw(); const origin = state.renderers[0].frames.at(-1).clone(); state.viewer.forward(); state.draw(); legacyDistance = state.renderers[0].frames.at(-1).distanceTo(origin);
    assert.ok(Math.abs(legacyDistance - .12) < 1e-9);
  });
  await fixture(async state => {
    await state.decode(); state.draw(); const origin = state.renderers[0].frames.at(-1).clone(); state.viewer.forward(); state.draw();
    assert.ok(Math.abs(state.renderers[0].frames.at(-1).distanceTo(origin) - .32) < 1e-9);
    assert.ok(state.renderers[0].frames.at(-1).distanceTo(origin) > legacyDistance * 2.5);
    for (let i = 0; i < 30; i++) state.viewer.forward(); state.draw(); assert.ok(state.renderers[0].frames.at(-1).distanceTo(origin) <= 4);
    state.viewer.reset(); state.viewer.elevate(1); state.draw(); assert.ok(Math.abs(state.renderers[0].frames.at(-1).y - .32) < 1e-9);
    state.viewer.reset(); assert.equal(state.viewer.setWalking(true), true); state.draw(); const grounded = state.renderers[0].frames.at(-1).clone(); state.viewer.forward(); state.draw();
    assert.ok(Math.abs(state.renderers[0].frames.at(-1).distanceTo(grounded) - .12) < 1e-9, 'A cinematic speed override cannot alter collision-aware walking');
  }, { freeFlight: true, manualRadius: 4, manualStep: .32, collisionUrl: '/synthetic/collider.glb' });
  for (const manualStep of [-10, 1000, NaN]) await fixture(async state => {
    await state.decode(); state.draw(); const origin = state.renderers[0].frames.at(-1).clone(); state.viewer.forward(); state.draw();
    assert.ok(state.renderers[0].frames.at(-1).distanceTo(origin) >= .12 - 1e-9 && state.renderers[0].frames.at(-1).distanceTo(origin) <= .5 + 1e-9);
  }, { manualStep });
});

test('manual move and altitude publish their actual rendered pose immediately while automatic reports stay throttled', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); assert.equal(state.cameraPoses.length, 1);
    state.draw(60); assert.equal(state.cameraPoses.length, 1, 'Automatic ambient frames do not flood pose telemetry');
    state.viewer.forward(); state.draw(60); assert.equal(state.cameraPoses.length, 2, 'A single manual move cannot leave DOM QA coordinates stale for 500 ms');
    assert.deepEqual(state.cameraPoses.at(-1).position, state.renderers[0].frames.at(-1).toArray());
    state.viewer.elevate(1); state.draw(60); assert.equal(state.cameraPoses.length, 3); assert.deepEqual(state.cameraPoses.at(-1).position, state.renderers[0].frames.at(-1).toArray());
    state.draw(60); assert.equal(state.cameraPoses.length, 3); state.draw(500); assert.equal(state.cameraPoses.length, 3, 'An idle world does not emit decorative telemetry');
    state.viewer.look(.1, 0); state.draw(); assert.equal(state.cameraPoses.length, 4);
  }, { freeFlight: true, manualStep: .32, captureCamera: true });
});

test('destroy during SPZ decoding suppresses ready and projection callbacks after late completion', async () => {
  await fixture(async state => {
    assert.equal(state.meshes.length, 1); state.viewer.destroy(); await state.decode(); state.draw();
    assert.equal(state.ready(), 0); assert.equal(state.projections.length, 0); assert.equal(state.host.children.length, 0); assert.equal(state.frames.size, 0);
    assert.equal(state.meshes[0].disposed, true); assert.equal(state.errors.length, 0);
  });
});

test('context loss disposes resources and reports once; unsafe URL never allocates a renderer or fetch', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); const lost = new Event('webglcontextlost', { cancelable: true }); state.renderers[0].domElement.dispatchEvent(lost);
    assert.equal(lost.defaultPrevented, true); assert.equal(state.errors.length, 1); assert.equal(state.host.children.length, 0); assert.equal(state.frames.size, 0);
    state.renderers[0].domElement.dispatchEvent(new Event('webglcontextlost')); assert.equal(state.errors.length, 1);
  });
  await fixture(async state => { assert.equal(state.renderers.length, 0); assert.equal(state.requests.length, 0); assert.equal(state.errors.length, 1); }, { url: 'https://user:password@invalid.test/world.spz' });
});

test('an optional real Three floor enables grounded walking and disposes its collider on exit', async () => {
  await fixture(async state => {
    assert.equal(state.requests.length, 2); assert.equal(state.collisionParses(), 1);
    assert.equal(state.requests[1].url, 'http://127.0.0.1:4323/synthetic/collider.glb');
    assert.equal(state.requests[1].options.credentials, 'omit'); assert.equal(state.requests[1].options.referrerPolicy, 'no-referrer');
    assert.deepEqual(state.walking.at(-1), { available: true, enabled: false });
    assert.equal(state.viewer.walkingAvailable, true);
    await state.decode(); state.draw(); assert.equal(state.viewer.setWalking(true), true);
    for (let index = 0; index < 10; index++) state.viewer.forward(); state.draw();
    const position = state.renderers[0].frames.at(-1);
    assert.ok(position.z < -1); assert.ok(Math.abs(position.y) < 1e-6);
    assert.deepEqual(state.walking.at(-1), { available: true, enabled: true });
    assert.equal(state.viewer.setWalking(false), false); state.viewer.backward(); state.draw();
    assert.ok(state.renderers[0].frames.at(-1).z > position.z, 'Leaving Walk beyond the initial view radius must not freeze normal view controls');
    assert.equal(state.viewer.setWalking(true), true);
    state.viewer.destroy();
    assert.deepEqual(state.collisionDisposals(), { geometry: 1, material: 1 });
    assert.equal(state.viewer.walkingAvailable, false); assert.equal(state.motion.listeners.size, 0);
  }, { collisionUrl: '/synthetic/collider.glb' });
});

test('leaving a walk beyond the original view radius permits bounded movement around the new view anchor', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); assert.equal(state.viewer.setWalking(true), true);
    const origin = new Three.Vector3(0, 0, .03);
    for (let index = 0; index < 12; index++) state.viewer.forward(); state.draw();
    const walked = state.renderers[0].frames.at(-1).clone();
    assert.ok(walked.distanceTo(origin) > 1, 'The walk reaches beyond the original free-view boundary');
    assert.equal(state.viewer.setWalking(false), false);
    assert.deepEqual(state.walking.at(-1), { available: true, enabled: false });
    state.viewer.backward(); state.draw();
    const firstOffset = state.renderers[0].frames.at(-1);
    assert.ok(firstOffset.z > walked.z, 'Move back responds immediately after disabling walking');
    assert.ok(Math.abs(firstOffset.distanceTo(walked) - .12) < 1e-6);
    for (let index = 0; index < 30; index++) state.viewer.backward(); state.draw();
    const boundedOffset = state.renderers[0].frames.at(-1).distanceTo(walked);
    assert.ok(boundedOffset > .9 && boundedOffset <= 1, 'Free-view offsets use the walked position as their bounded anchor');
    state.viewer.reset(); state.draw();
    assert.ok(state.renderers[0].frames.at(-1).distanceTo(origin) < 1e-6);
    state.viewer.forward(); state.draw();
    assert.ok(Math.abs(state.renderers[0].frames.at(-1).distanceTo(origin) - .12) < 1e-6, 'Reset restores the original view anchor');
  }, { collisionUrl: '/synthetic/collider.glb' });
});

test('a collider parsed after exit is discarded without publishing stale walking availability', async () => {
  await fixture(async state => {
    assert.equal(state.collisionParses(), 1); assert.equal(state.walking.length, 0);
    await state.decode(); state.draw(); state.viewer.destroy();
    await state.completeCollision();
    assert.deepEqual(state.collisionDisposals(), { geometry: 1, material: 1 });
    assert.equal(state.walking.length, 0); assert.equal(state.errors.length, 0); assert.equal(state.frames.size, 0);
    assert.equal(state.viewer.walkingAvailable, false);
  }, { collisionUrl: '/synthetic/collider.glb', deferCollision: true });
});

test('unavailable, malformed and unsafe optional colliders never hide a usable SPZ world', async () => {
  for (const settings of [
    { collisionUrl: '/synthetic/collider.glb', collisionFetchFailure: true },
    { collisionUrl: '/synthetic/collider.glb', badCollision: true },
    { collisionUrl: 'https://user:password@invalid.test/collider.glb' },
  ]) await fixture(async state => {
    await state.decode(); state.draw();
    assert.equal(state.ready(), 1); assert.equal(state.errors.length, 0);
    assert.deepEqual(state.walking.at(-1), { available: false, enabled: false });
    assert.equal(state.viewer.setWalking(true), false); assert.equal(state.viewer.walkingAvailable, false);
    assert.ok(state.projections.at(-1).some(point => point.visible));
    if (settings.collisionUrl.includes('password')) assert.equal(state.requests.length, 1);
  }, settings);
});

test('decorative ambient controls never add particle art while look controls remain responsive', async () => {
  await fixture(async state => {
    await state.decode(); state.draw();
    assert.equal(state.frames.size, 0, 'Provider scene remains still until input');
    state.motion.set(true); state.draw();
    assert.equal(state.frames.size, 0, 'Reduced motion cancels the ambient loop after its pending frame');
    assert.equal(state.renderers[0].scene.children.some(object => object instanceof Three.Points), false);
    const before = state.renderers[0].frames.length;
    state.viewer.look(.1, 0); state.draw();
    assert.equal(state.renderers[0].frames.length, before + 1); assert.equal(state.frames.size, 0);
    state.viewer.setAmbient(true); state.draw(); assert.equal(state.frames.size, 0); assert.equal(state.renderers[0].scene.children.some(object => object instanceof Three.Points), false);
    state.viewer.destroy(); assert.equal(state.motion.listeners.size, 0);
  });
  await fixture(async state => {
    await state.decode(); state.draw(); assert.equal(state.frames.size, 0);
    assert.equal(state.renderers[0].scene.children.some(object => object instanceof Three.Points), false);
  }, { reducedMotion: true });
});

test('idle provider scenes do not render continuous decorative frames', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); const before = state.renderers[0].frames.length;
    for (let index = 0; index < 4; index++) state.draw(10);
    assert.equal(state.renderers[0].frames.length, before);
    state.draw(10); assert.equal(state.renderers[0].frames.length, before);
  });
});

test('the drone tour has real camera translation, altitude, arrival, flight and reading stages without requiring a walking collider', async () => {
  await fixture(async state => {
    assert.equal(state.viewer.startTour(), false, 'Loading is not a playable world');
    state.viewer.setAmbient(false); await state.decode(); state.draw(); assert.equal(state.tours.length, 0);
    const origin = state.renderers[0].frames.at(-1).clone();
    assert.equal(state.viewer.startTour(), true); state.draw();
    assert.equal(state.tours.at(-1).stage, 'arrival');
    assert.ok(state.renderers[0].frames.at(-1).distanceTo(origin) > 2, 'An explicit tour begins in a spatial aerial arrival pose');
    const first = state.renderers[0].cameras.at(-1).quaternion.clone();
    state.draw(60_000); assert.equal(state.tours.at(-1).index, 0, 'A stalled browser does not skip chapters');
    assert.ok(first.angleTo(state.renderers[0].cameras.at(-1).quaternion) <= .2, 'A stalled frame advances at most one bounded second');
    for (let index = 0; index < 400; index++) state.draw(100);
    assert.equal(state.tours.at(-1).phase, 'completed');
    assert.deepEqual(state.tours.map(tour => [tour.phase, tour.stage, tour.pointId]), [['playing', 'arrival', 'front'], ['playing', 'reading', 'front'], ['playing', 'travel', 'behind'], ['playing', 'reading', 'behind'], ['completed', 'reading', 'behind']]);
    const cameras = state.renderers[0].cameras.slice(1), positions = cameras.map(camera => camera.position);
    assert.ok(Math.max(...positions.map(position => position.y)) - Math.min(...positions.map(position => position.y)) > 1, 'Arrival descends through the real SPZ volume');
    assert.ok(positions.some(position => position.distanceTo(positions[0]) > 2), 'Camera position changes, rather than only panning');
    assert.ok(cameras.every((camera, index) => !index || camera.quaternion.angleTo(cameras[index - 1].quaternion) <= .15));
    assert.ok(positions.every((position, index) => !index || position.distanceTo(positions[index - 1]) <= .16));
    assert.ok(cameras.some(camera => camera.fov !== 75), 'Arrival uses actual perspective framing');
    assert.equal(state.frames.size, 0); assert.equal(state.ready(), 1); assert.equal(state.renderers.length, 1); assert.equal(state.requests.length, 1);
  });
});

test('starting a drone tour leaves grounded walking mode and manual free movement anchors to the landed viewpoint', async () => {
  await fixture(async state => {
    state.viewer.setAmbient(false); await state.decode(); state.draw(); state.viewer.setWalking(true);
    for (let index = 0; index < 12; index++) state.viewer.forward(); state.draw();
    const anchor = state.renderers[0].frames.at(-1).clone(), start = state.renderers[0].frames.length;
    state.viewer.startTour(); assert.deepEqual(state.walking.at(-1), { available: true, enabled: false });
    for (let index = 0; index < 85; index++) state.draw(100);
    const positions = state.renderers[0].frames.slice(start);
    assert.ok(positions.some(position => position.distanceTo(anchor) > 2), 'Drone arrival translates beyond the old local-pan boundary');
    assert.ok(positions.some(position => position.y > 1), 'Flight altitude is independent of walking floor height');
    assert.equal(state.tours.at(-1).stage, 'reading');
    state.viewer.stopTour(); state.draw(); assert.equal(state.tours.at(-1).phase, 'idle'); assert.equal(state.frames.size, 0);
    state.viewer.backward(); state.draw(); assert.ok(state.renderers[0].frames.at(-1).distanceTo(positions.at(-1)) > .1);
  }, { collisionUrl: '/synthetic/collider.glb' });
});

test('manual look, movement, reset, walking, pointer and keyboard input pause a tour without restarting it', async () => {
  await fixture(async state => {
    state.viewer.setAmbient(false); await state.decode(); state.draw();
    const actions = [() => state.viewer.look(.1, 0), () => state.viewer.move(.1, 0), () => state.viewer.forward(), () => state.viewer.reset(), () => state.viewer.setWalking(true),
      () => { pointerEvent(state.host, 'pointerdown', { pointerId: 3, clientX: 1, clientY: 1 }); pointerEvent(state.host, 'pointermove', { pointerId: 3, clientX: 11, clientY: 1 }); pointerEvent(state.host, 'pointerup', { pointerId: 3 }); },
      () => { const event = new Event('keydown'); Object.assign(event, { key: 'ArrowLeft' }); state.host.dispatchEvent(event); },
    ];
    for (const action of actions) {
      state.viewer.startTour(); state.draw(); state.draw(100); action(); state.draw(100);
      assert.equal(state.tours.at(-1).phase, 'paused'); assert.equal(state.tours.at(-1).reason, 'manual');
      const position = state.renderers[0].frames.at(-1).clone(), rotation = state.renderers[0].cameras.at(-1).quaternion.clone();
      for (let index = 0; index < 20; index++) state.draw(100);
      assert.equal(state.frames.size, 0); assert.equal(state.renderers[0].frames.at(-1).distanceTo(position), 0);
      assert.ok(state.renderers[0].cameras.at(-1).quaternion.angleTo(rotation) < 1e-7);
    }
    assert.equal(state.viewer.resumeTour(), true); state.draw(); assert.equal(state.tours.at(-1).phase, 'playing');
  });
});

test('hidden or offscreen worlds pause a tour and cancel stale frames; returning requires explicit Resume', async () => {
  await fixture(async state => {
    state.viewer.setAmbient(false); await state.decode(); state.draw(); state.viewer.startTour(); state.draw();
    const stale = [...state.frames.values()][0], before = state.renderers[0].frames.length;
    state.document.visibilityState = 'hidden'; state.document.dispatchEvent(new Event('visibilitychange')); stale(80_000);
    assert.equal(state.frames.size, 0); assert.equal(state.renderers[0].frames.length, before);
    assert.equal(state.tours.at(-1).reason, 'hidden'); assert.equal(state.viewer.resumeTour(), false);
    state.document.visibilityState = 'visible'; state.document.dispatchEvent(new Event('visibilitychange')); state.draw();
    assert.equal(state.tours.at(-1).phase, 'paused'); assert.equal(state.frames.size, 0);
    assert.equal(state.viewer.resumeTour(), true); state.draw(); state.visible(false);
    assert.equal(state.tours.at(-1).reason, 'offscreen'); assert.equal(state.frames.size, 0); assert.equal(state.viewer.resumeTour(), false);
    state.visible(true); state.draw(); assert.equal(state.tours.at(-1).phase, 'paused'); assert.equal(state.frames.size, 0);
    assert.equal(state.viewer.resumeTour(), true); state.draw(); const retired = [...state.frames.values()][0], callbacks = state.tours.length;
    state.viewer.destroy(); retired(100_000); state.viewer.nextTour(); state.viewer.stopTour();
    assert.equal(state.viewer.startTour(), false); assert.equal(state.viewer.resumeTour(), false); assert.equal(state.tours.length, callbacks);
    assert.equal(state.frames.size, 0); assert.equal(state.visibilityDisconnected(), 1); assert.equal(state.motion.listeners.size, 0);
  }, { observeVisibility: true });
});

test('reduced-motion tours cut to different static viewpoints without automatic flight, and preference changes pause immediately', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); const before = state.renderers[0].cameras.at(-1).clone();
    assert.equal(state.viewer.startTour(), true); state.draw(); assert.equal(state.tours.at(-1).phase, 'paused'); assert.equal(state.tours.at(-1).reason, 'motion');
    assert.equal(state.tours.at(-1).stage, 'reading');
    assert.equal(state.viewer.resumeTour(), false); const first = state.renderers[0].cameras.at(-1).clone();
    assert.ok(first.position.distanceTo(before.position) > .5, 'The first chapter is an explicit static camera pose');
    state.viewer.nextTour(); state.draw(); assert.equal(state.tours.at(-1).pointId, 'behind');
    assert.equal(state.frames.size, 0); assert.ok(state.renderers[0].cameras.at(-1).quaternion.angleTo(first.quaternion) > .1);
    assert.ok(state.renderers[0].frames.at(-1).distanceTo(first.position) > 1);
    const second = state.renderers[0].cameras.at(-1).clone();
    for(let i=0;i<20;i++)state.draw(100);
    assert.equal(state.renderers[0].frames.at(-1).distanceTo(second.position), 0);
    state.viewer.nextTour(); state.draw(); assert.equal(state.tours.at(-1).phase, 'completed'); assert.equal(state.frames.size, 0);
  }, { reducedMotion: true });
  await fixture(async state => {
    await state.decode(); state.draw(); state.viewer.startTour(); state.draw(); state.draw(100);
    const camera = state.renderers[0].cameras.at(-1).clone(); state.motion.set(true); state.draw();
    assert.equal(state.tours.at(-1).phase, 'paused'); assert.equal(state.tours.at(-1).reducedMotion, true); assert.equal(state.frames.size, 0);
    assert.ok(state.renderers[0].cameras.at(-1).quaternion.angleTo(camera.quaternion) < 1e-7);
    state.motion.set(false); state.draw(); assert.equal(state.tours.at(-1).phase, 'paused'); assert.equal(state.frames.size, 0);
    assert.equal(state.viewer.resumeTour(), true); state.draw(); assert.equal(state.tours.at(-1).phase, 'playing');
  });
  await fixture(async state => { await state.decode(); state.draw(); assert.equal(state.viewer.startTour(), false); assert.equal(state.tours.length, 0); }, { points: [] });
});

test('manual focus turns use the shortest orientation across the yaw seam, and late colliders cannot redirect a drone flight', async () => {
  await fixture(async state => {
    state.viewer.setAmbient(false); await state.decode(); state.draw(); const start = state.renderers[0].cameras.length;
    state.viewer.focusPoint('seam'); state.draw(); for(let i=0;i<40;i++)state.draw(100);
    const cameras=state.renderers[0].cameras.slice(start);
    assert.ok(cameras.every((camera,index)=>!index||camera.quaternion.angleTo(cameras[index-1].quaternion)<=.15), 'Crossing the angle seam must not become a full rotation');
    assert.equal(state.viewpoints.at(-1).phase,'arrived');
  }, { initialYaw: Math.PI - .02, points: [{ id: 'seam', position: [Math.sin(.02) * 3, 0, .03 + Math.cos(.02) * 3] }] });
  await fixture(async state => {
    state.viewer.setAmbient(false); await state.decode(); state.draw(); const anchor = state.renderers[0].frames.at(-1).clone();
    state.viewer.startTour(); state.draw(); for (let index = 0; index < 20; index++) state.draw(100);
    assert.ok(state.renderers[0].frames.at(-1).distanceTo(anchor) > 1); const chapters = state.tours.length, prior = state.renderers[0].frames.at(-1).clone();
    await state.completeCollision(); state.draw(100);
    assert.equal(state.tours.length, chapters); assert.equal(state.tours.at(-1).phase, 'playing');
    assert.ok(state.renderers[0].frames.at(-1).distanceTo(prior) <= .1, 'A late collider does not snap to a grounded path');
    for (let index = 0; index < 40; index++) state.draw(100);
    assert.equal(state.tours.at(-1).stage, 'arrival');
  }, { collisionUrl: '/synthetic/collider.glb', deferCollision: true });
});

test('each story marker triggers a real focus flight, landed parallax and a new manual movement anchor', async () => {
  await fixture(async state => {
    state.viewer.setAmbient(false); assert.equal(state.viewer.focusPoint('front'), false);
    await state.decode(); state.draw(); assert.equal(state.viewer.focusPoint('missing'), false);
    const start = state.renderers[0].cameras.at(-1).clone();
    assert.equal(state.viewer.focusPoint('front'), true); assert.deepEqual(state.viewpoints.at(-1), { pointId: 'front', phase: 'travelling' });
    state.draw(); state.draw(60_000);
    assert.ok(state.renderers[0].frames.at(-1).distanceTo(start.position) < .3, 'A stalled browser cannot jump to a viewpoint');
    for(let i=0;i<35;i++)state.draw(100);
    assert.deepEqual(state.viewpoints.at(-1), { pointId: 'front', phase: 'arrived' }); assert.equal(state.frames.size, 0);
    const first=state.renderers[0].cameras.at(-1).clone();
    assert.ok(first.position.distanceTo(start.position) > 1, 'A focus destination changes the physical camera position');
    assert.equal(state.viewer.focusPoint('behind'), true); state.draw(); for(let i=0;i<35;i++)state.draw(100);
    const second=state.renderers[0].cameras.at(-1).clone();
    assert.ok(second.position.distanceTo(first.position) > 1.5, 'Different markers land in distinct spatial viewpoints');
    assert.ok(second.quaternion.angleTo(first.quaternion) > .5);
    assert.equal(state.viewpoints.filter(state=>state.phase==='arrived').length,2);
    assert.equal(state.tours.length,0,'Selecting a point does not start an automatic tour');
    state.viewer.forward(); state.draw();
    assert.ok(Math.abs(state.renderers[0].frames.at(-1).distanceTo(second.position)-.12)<1e-6,'Manual movement is centred on the landed viewpoint');
    state.viewer.reset();state.draw();assert.equal(state.renderers[0].cameras.at(-1).fov,75);
  });
});

test('manual focus cancellation never publishes false arrival, and reduced motion uses explicit static viewpoints', async () => {
  await fixture(async state=>{
    state.viewer.setAmbient(false);await state.decode();state.draw();
    state.viewer.focusPoint('front');state.draw();state.draw(100);state.viewer.look(.1,0);state.draw();
    assert.deepEqual(state.viewpoints.at(-1),{pointId:'front',phase:'cancelled'});
    const stopped=state.renderers[0].cameras.at(-1).clone();for(let i=0;i<60;i++)state.draw(100);
    assert.equal(state.frames.size,0);assert.equal(state.renderers[0].frames.at(-1).distanceTo(stopped.position),0);
    assert.equal(state.viewpoints.some(state=>state.phase==='arrived'),false);
    state.viewer.focusPoint('behind');state.draw();state.document.visibilityState='hidden';state.document.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(state.viewpoints.at(-1),{pointId:'behind',phase:'cancelled'});assert.equal(state.frames.size,0);
    state.document.visibilityState='visible';state.document.dispatchEvent(new Event('visibilitychange'));state.draw();assert.equal(state.frames.size,0);
    state.viewer.focusPoint('front');state.draw();state.motion.set(true);state.draw();assert.equal(state.viewpoints.at(-1).phase,'cancelled');assert.equal(state.frames.size,0);
    const prior=state.renderers[0].frames.at(-1).clone();state.viewer.focusPoint('behind');state.draw();
    assert.deepEqual(state.viewpoints.at(-1),{pointId:'behind',phase:'arrived'});
    assert.ok(state.renderers[0].frames.at(-1).distanceTo(prior)>.5);assert.equal(state.frames.size,0);
    const callbacks=state.viewpoints.length;state.viewer.destroy();assert.equal(state.viewer.focusPoint('front'),false);assert.equal(state.viewpoints.length,callbacks);
  });
});

test('slow GPU frames use actual elapsed time for arrival, reading and travel rather than prolonging the tour', async () => {
  await fixture(async state=>{
    state.viewer.setAmbient(false);await state.decode();state.draw();state.viewer.startTour();state.draw();
    for(let i=0;i<8;i++)state.draw(1000);
    assert.equal(state.tours.at(-1).stage,'reading','An eight-second flight still lands after eight one-second GPU frames');
    for(let i=0;i<12;i++)state.draw(1000);
    assert.equal(state.tours.at(-1).stage,'travel');assert.equal(state.tours.at(-1).index,1);
    for(let i=0;i<5;i++)state.draw(1000);
    assert.equal(state.tours.at(-1).stage,'reading');
    state.viewer.stopTour();state.draw();state.viewer.focusPoint('front');state.draw();for(let i=0;i<4;i++)state.draw(1000);
    assert.equal(state.viewpoints.at(-1).phase,'arrived','A manual focus flight also uses elapsed wall time');
    state.viewer.focusPoint('behind');state.draw();state.draw(100);state.viewer.stopTour();state.draw();
    assert.deepEqual(state.viewpoints.at(-1),{pointId:'behind',phase:'cancelled'},'Stories stops manual focus even when no automatic tour is running');
    assert.equal(state.frames.size,0);
  });
});

test('long story reading time is bounded and stage notifications do not flood every rendered frame', async () => {
  await fixture(async state=>{
    state.viewer.setAmbient(false);await state.decode();state.draw();state.viewer.startTour();state.draw();
    for(let i=0;i<85;i++)state.draw(100);assert.equal(state.tours.at(-1).stage,'reading');assert.equal(state.tours.length,2);
    const landed=state.renderers[0].cameras.at(-1).clone();for(let i=0;i<200;i++)state.draw(100);
    assert.equal(state.tours.at(-1).stage,'reading');assert.equal(state.tours.at(-1).index,0);
    assert.equal(state.renderers[0].frames.at(-1).distanceTo(landed.position),0,'Reading holds the physical viewpoint still');
    assert.equal(state.tours.length,2,'The renderer notifies stage transitions rather than each frame');
    for(let i=0;i<155;i++)state.draw(100);assert.equal(state.tours.at(-1).stage,'travel');assert.equal(state.tours.at(-1).index,1);
  },{points:[{id:'front',position:[.3,.2,-3],readingDurationMs:1e9},{id:'behind',position:[0,0,3],readingDurationMs:1}]});
});

test('first-person held keys move across animation frames without key-repeat and release outside the host stops motion', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); assert.equal(state.viewer.walkingAvailable, true);
    assert.equal(state.viewer.setWalking(true), true); state.draw(16);
    const origin = state.renderers[0].frames.at(-1).clone(), key = keyboard(state.host, 'keydown', 'w');
    assert.equal(key.defaultPrevented, true);
    for (let frame = 0; frame < 45; frame++) state.draw(16);
    const walked = state.renderers[0].frames.at(-1).clone();
    assert.ok(origin.z - walked.z > .65, 'One held-key event drives continuous RAF motion');
    assert.equal(state.firstPersonStates.at(-1).moving, true);
    assert.ok(state.physicsInstances[0].advances.length > 45, 'Slow frames resolve small physics substeps');
    assert.ok(state.physicsInstances[0].advances.every(step => step.dt <= 1 / 60));
    keyboard(state.window, 'keyup', 'w');
    for (let frame = 0; frame < 100; frame++) state.draw(16);
    const stopped = state.renderers[0].frames.at(-1).clone();
    assert.equal(state.firstPersonStates.at(-1).moving, false); assert.equal(state.frames.size, 0);
    state.draw(30_000); assert.equal(state.renderers[0].frames.at(-1).distanceTo(stopped), 0);
    assert.ok(walked.z - stopped.z < .1, 'Release brakes smoothly rather than retaining walking input');
  }, { firstPerson: true, collisionUrl: '/synthetic/collider.glb', reducedMotion: true });
});

test('first-person movement pad, strafe, sprint and yaw drive the actual perspective camera', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); state.viewer.setWalking(true); state.draw(16);
    const origin = state.renderers[0].frames.at(-1).clone();
    state.viewer.setMoveInput(1, 0); for (let frame = 0; frame < 40; frame++) state.draw(16);
    const right = state.renderers[0].frames.at(-1).clone(); assert.ok(right.x > origin.x + .5); assert.equal(right.z, origin.z);
    state.viewer.reset(); state.viewer.look(Math.PI / 2, 0); state.viewer.setMoveInput(0, 1, true);
    for (let frame = 0; frame < 40; frame++) state.draw(16);
    const sprint = state.renderers[0].frames.at(-1).clone(); assert.ok(sprint.x < origin.x - 1.3);
    assert.ok(Math.abs(sprint.z - origin.z) < 1e-8, 'Yaw determines forward movement, not a hard-coded world axis');
    state.viewer.setWalking(false); const advances = state.physicsInstances[0].advances.length;
    state.draw(16); assert.equal(state.physicsInstances[0].advances.length, advances);
  }, { firstPerson: true, collisionUrl: '/synthetic/collider.glb', reducedMotion: true });
});

test('window blur clears held keys and movement-pad state before focus returns', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); state.viewer.setWalking(true); state.draw(16);
    keyboard(state.host, 'keydown', 'w'); state.viewer.setMoveInput(.5, 0);
    for (let frame = 0; frame < 30; frame++) state.draw(16);
    const before = state.renderers[0].frames.at(-1).clone(); state.window.dispatchEvent(new Event('blur'));
    for (let frame = 0; frame < 15; frame++) state.draw(16);
    assert.equal(state.renderers[0].frames.at(-1).distanceTo(before), 0);
    assert.equal(state.firstPersonStates.at(-1).moving, false); assert.equal(state.frames.size, 0);
    state.viewer.look(.1, 0); state.draw(30_000);
    assert.equal(state.renderers[0].frames.at(-1).distanceTo(before), 0, 'A long inactive interval cannot catch up retained input');
  }, { firstPerson: true, collisionUrl: '/synthetic/collider.glb', reducedMotion: true });
});

test('hidden and offscreen first-person views cancel pending input and resume at rest', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); state.viewer.setWalking(true); state.draw(16);
    for (const hide of ['document', 'intersection']) {
      keyboard(state.host, 'keydown', 'w'); for (let frame = 0; frame < 20; frame++) state.draw(16);
      const stale = [...state.frames.values()][0], before = state.renderers[0].frames.at(-1).clone();
      const advanceCount = state.physicsInstances[0].advances.length, renderCount = state.renderers[0].frames.length;
      if (hide === 'document') { state.document.visibilityState = 'hidden'; state.document.dispatchEvent(new Event('visibilitychange')); }
      else state.visible(false);
      assert.equal(state.frames.size, 0); stale(90_000);
      assert.equal(state.physicsInstances[0].advances.length, advanceCount); assert.equal(state.renderers[0].frames.length, renderCount);
      if (hide === 'document') { state.document.visibilityState = 'visible'; state.document.dispatchEvent(new Event('visibilitychange')); }
      else state.visible(true);
      state.draw(30_000); assert.equal(state.renderers[0].frames.at(-1).distanceTo(before), 0);
      assert.equal(state.firstPersonStates.at(-1).moving, false); assert.equal(state.frames.size, 0);
    }
  }, { firstPerson: true, collisionUrl: '/synthetic/collider.glb', reducedMotion: true, observeVisibility: true });
});

test('reduced motion still allows deliberate continuous walking while removing camera sway and ambient loops', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); state.viewer.setWalking(true); state.draw(16);
    const firstFrame = state.renderers[0].cameras.length;
    keyboard(state.host, 'keydown', 'w'); for (let frame = 0; frame < 50; frame++) state.draw(16);
    const cameras = state.renderers[0].cameras.slice(firstFrame);
    assert.ok(cameras.length >= 50 && cameras.at(-1).position.z < -.75);
    assert.ok(cameras.every(camera => camera.position.y === 1.55 && camera.rotation.z === 0));
    assert.equal(state.renderers[0].scene.children.some(object => object instanceof Three.Points), false);
    keyboard(state.host, 'keyup', 'w'); for (let frame = 0; frame < 100; frame++) state.draw(16);
    assert.equal(state.frames.size, 0, 'Only deliberate movement schedules RAF under reduced motion');
  }, { firstPerson: true, collisionUrl: '/synthetic/collider.glb', reducedMotion: true });
});

test('first-person pointer lock and destruction release the real viewer lifecycle exactly once', async () => {
  await fixture(async state => {
    assert.equal(await state.viewer.lockPointer(), false, 'Mouse look cannot lock before walking is active');
    await state.decode(); state.draw(); state.viewer.setWalking(true); state.draw(16);
    assert.equal(await state.viewer.lockPointer(), true); assert.equal(state.document.pointerLockElement, state.host);
    keyboard(state.host, 'keydown', 'w'); for (let frame = 0; frame < 15; frame++) state.draw(16);
    const stale = [...state.frames.values()][0], before = state.renderers[0].frames.length;
    state.viewer.destroy(); assert.equal(state.physicsInstances[0].destroys, 1);
    assert.equal(state.document.pointerLockElement, null); assert.equal(state.pointerLockExits(), 1);
    assert.deepEqual(state.collisionDisposals(), { geometry: 1, material: 1 });
    keyboard(state.host, 'keydown', 'w'); keyboard(state.window, 'keyup', 'w'); state.window.dispatchEvent(new Event('blur')); stale(90_000);
    assert.equal(state.frames.size, 0); assert.equal(state.renderers[0].frames.length, before);
    assert.equal(state.viewer.walkingAvailable, false); assert.equal(state.renderers[0].disposed, true);
    state.viewer.destroy(); assert.equal(state.physicsInstances[0].destroys, 1);
  }, { firstPerson: true, collisionUrl: '/synthetic/collider.glb' });
});

test('a late first-person physics initializer is freed after exit without stale availability callbacks', async () => {
  await fixture(async state => {
    assert.equal(state.physicsInstances.length, 1); assert.equal(state.walking.length, 0);
    await state.decode(); state.draw(); state.viewer.destroy(); const callbacks = state.firstPersonStates.length;
    await state.completePhysics(); assert.equal(state.physicsInstances[0].destroys, 1);
    assert.equal(state.firstPersonStates.length, callbacks); assert.equal(state.walking.length, 0);
    assert.equal(state.viewer.walkingAvailable, false); assert.equal(state.frames.size, 0);
  }, { firstPerson: true, collisionUrl: '/synthetic/collider.glb', deferPhysics: true });
});

test('first-person splat and collider transformations match and physics failure leaves the SPZ visible', async () => {
  const settings = { spawn: [0, 1.55, .03], eyeHeight: 1.55, metricScale: 2.3, groundOffset: -.75 };
  await fixture(async state => {
    await state.decode(); state.draw(); const controller = state.physicsInstances[0];
    assert.equal(state.meshes[0].rotation.x, controller.root.rotation.x);
    assert.deepEqual(state.meshes[0].scale.toArray(), controller.root.scale.toArray());
    assert.deepEqual(state.meshes[0].position.toArray(), controller.root.position.toArray());
    assert.equal(state.meshes[0].scale.x, 2.3); assert.equal(state.meshes[0].position.y, -.75);
    assert.equal(state.renderers[0].options.powerPreference, 'high-performance');
  }, { firstPerson: settings, collisionUrl: '/synthetic/collider.glb' });
  await fixture(async state => {
    await state.decode(); state.draw(); assert.equal(state.ready(), 1); assert.equal(state.errors.length, 0);
    assert.equal(state.viewer.walkingAvailable, false); assert.equal(state.viewer.setWalking(true), false);
    assert.equal(state.firstPersonStates.at(-1).ready, false); assert.equal(state.renderers[0].disposed, false);
  }, { firstPerson: true, collisionUrl: '/synthetic/collider.glb', badPhysics: true });
});

test('walking uses its exact-world provider panorama instead of an authored sky and releases it once', async () => {
  await fixture(async state => {
    await state.decode(); state.draw();
    assert.equal(state.requests.length, 3); assert.ok(state.requests.some(request => request.url.includes('reference-panorama')));
    assert.equal(state.bitmaps.length, 1);
    const sky = state.renderers[0].scene.background;
    assert.ok(sky instanceof Three.Texture && !(sky instanceof Three.DataTexture)); assert.equal(sky.mapping, Three.EquirectangularReflectionMapping);
    assert.equal(sky.colorSpace, Three.SRGBColorSpace); assert.equal(sky.image, state.bitmaps[0]);
    let disposed = 0; sky.addEventListener('dispose', () => disposed++);
    state.viewer.setWalking(true); state.draw(16); const start = state.renderers[0].frames.at(-1).clone();
    state.viewer.setMoveInput(0, 1); for (let frame = 0; frame < 80; frame++) state.draw(16);
    state.viewer.look(.5, 0); state.draw(16);
    assert.ok(state.renderers[0].frames.at(-1).distanceTo(start) > 1);
    assert.equal(state.renderers[0].scene.background, sky, 'Translated camera retains the exact-world panorama backing');
    state.viewer.destroy(); state.viewer.destroy(); assert.equal(disposed, 1); assert.equal(state.bitmaps[0].closes, 1);
  }, { firstPerson: true, collisionUrl: '/synthetic/collider.glb', panoramaUrl: '/synthetic/reference-panorama.png', bitmapAvailable: true });
});

test('existing cinematic views retain their exact-world panorama backing and dispose its bitmap', async () => {
  await fixture(async state => {
    await state.decode(); state.draw();
    assert.equal(state.requests.length, 2); assert.ok(state.requests.some(request => request.url.endsWith('/reference-panorama.png')));
    assert.equal(state.bitmaps.length, 1); const panorama = state.renderers[0].scene.background;
    assert.ok(panorama instanceof Three.Texture && !(panorama instanceof Three.DataTexture));
    assert.equal(panorama.image, state.bitmaps[0]); assert.equal(panorama.mapping, Three.EquirectangularReflectionMapping);
    assert.equal(state.renderers[0].scene.backgroundRotation.y, .35);
    let disposed = 0; panorama.addEventListener('dispose', () => disposed++);
    state.viewer.destroy(); assert.equal(disposed, 1); assert.equal(state.bitmaps[0].closes, 1);
  }, { freeFlight: true, panoramaUrl: '/synthetic/reference-panorama.png', panoramaYaw: .35, bitmapAvailable: true });
});

const automaticWalking = { firstPerson: { spawn: [0, 1.65, 0], eyeHeight: 1.65, metricScale: 1, groundOffset: 0, autoCalibrate: true }, collisionUrl: '/synthetic/collider.glb', reducedMotion: true };

test('automatic walking publishes audited perspectives only after a live physics initializer and restores Arrival', async () => {
  await fixture(async state => {
    assert.equal(state.calibrationLoads(), 1); assert.equal(state.physicsInstances.length, 1);
    assert.equal(state.viewpointLoads(), 0); assert.equal(state.walkingPointReports.length, 0);
    assert.equal(state.viewer.setWalkingViewpoint('arrival'), false);
    await state.decode(); state.draw(); assert.equal(state.viewer.walkingAvailable, false);
    await state.completePhysics(); state.draw();
    assert.equal(state.viewpointLoads(), 1); assert.equal(state.walkingPointReports.length, 1);
    const points = state.walkingPointReports[0], controller = state.physicsInstances[0];
    assert.equal(points.length, 3); assert.equal(new Set(points.map(point => point.id)).size, points.length);
    assert.deepEqual(points[0].position, controller.spawn); assert.equal(points[0].id, 'arrival');
    assert.ok(points.slice(1).every(point => Math.hypot(point.position[0] - controller.spawn[0], point.position[2] - controller.spawn[2]) <= 4 + 1e-5));
    assert.ok(controller.advances.length >= 200 && controller.resets >= 4, 'The fixture executes the real audit helper over its controlled physics lifecycle');
    assert.deepEqual(state.renderers[0].frames.at(-1).toArray(), controller.spawn, 'Auditing does not leave the initial view at the final perspective');
    const reportIndex = state.lifecycle.findIndex(([event]) => event === 'viewpoints');
    assert.ok(state.lifecycle.findIndex(([event, ready]) => event === 'first-person' && ready) < reportIndex);
    assert.equal(state.firstPersonStates.at(-1).active, false);
  }, { ...automaticWalking, deferPhysics: true });
});

test('dynamic scenes without a manual spawn calibrate a real near-camera floor and publish supported viewpoints', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); assert.equal(state.errors.length, 0);
    assert.equal(state.physicsInstances.length, 1, 'Omitting manual coordinates should not disable automatic walking on a valid floor');
    assert.equal(state.viewer.walkingAvailable, true); assert.equal(state.walkingPointReports.length, 1);
    assert.ok(state.physicsInstances[0].spawn.every(Number.isFinite));
    assert.equal(state.viewer.setWalkingViewpoint('arrival'), true);
  }, { ...automaticWalking, firstPerson: { eyeHeight: 1.65, autoCalibrate: true } });
});

test('walking viewpoint setter accepts only derived IDs, retains pause state, and manual reset clears input', async () => {
  await fixture(async state => {
    await state.decode(); state.draw(); const controller = state.physicsInstances[0], points = state.walkingPointReports[0];
    const selected = { ...points[1], position: [...points[1].position] };
    const resets = controller.resets, advances = controller.advances.length;
    for (const id of ['missing', 'front', '', '__proto__', 'perspective-999']) assert.equal(state.viewer.setWalkingViewpoint(id), false);
    assert.equal(controller.resets, resets); assert.equal(controller.advances.length, advances, 'Unknown IDs cannot move/reset the capsule');
    points[1].id = 'forged'; points[1].position[0] = 1000;
    assert.equal(state.viewer.setWalkingViewpoint('forged'), false, 'Mutating a callback copy cannot add an accepted ID');
    assert.equal(state.viewer.setWalkingViewpoint(selected.id), true); state.draw();
    assert.deepEqual(state.renderers[0].frames.at(-1).toArray(), selected.position, 'Mutation of callback coordinates cannot redirect the camera');
    assert.equal(state.firstPersonStates.at(-1).active, false, 'A selected viewpoint keeps walking paused');
    assert.equal(state.firstPersonStates.at(-1).moving, false); assert.equal(state.frames.size, 0);
    state.viewer.setWalking(true); state.viewer.setMoveInput(0, 1); keyboard(state.host, 'keydown', 'w');
    for (let i = 0; i < 20; i++) state.draw(16);
    state.viewer.look(.8, .1); state.viewer.reset(); state.draw(16);
    assert.deepEqual(state.renderers[0].frames.at(-1).toArray(), controller.spawn);
    assert.equal(state.renderers[0].cameras.at(-1).rotation.y, 0); assert.equal(state.renderers[0].cameras.at(-1).fov, 75);
    assert.equal(state.firstPersonStates.at(-1).active, true, 'Manual reset preserves active walking');
    assert.equal(state.firstPersonStates.at(-1).moving, false); assert.equal(state.frames.size, 0);
    const resetPosition = state.renderers[0].frames.at(-1).clone(); state.draw(30_000);
    assert.equal(state.renderers[0].frames.at(-1).distanceTo(resetPosition), 0, 'Neither held key nor pad input survives reset');
    state.viewer.setWalking(false); assert.equal(state.viewer.setWalkingViewpoint(selected.id), true); state.draw();
    assert.equal(state.firstPersonStates.at(-1).active, false); state.viewer.reset(); state.draw();
    assert.deepEqual(state.renderers[0].frames.at(-1).toArray(), controller.spawn);
    const callbacks = state.walkingPointReports.length; state.viewer.destroy();
    assert.equal(state.viewer.setWalkingViewpoint(selected.id), false); assert.equal(state.viewer.setWalkingViewpoint('arrival'), false);
    assert.equal(state.walkingPointReports.length, callbacks); assert.equal(controller.destroys, 1);
  }, automaticWalking);
});

test('curated manual spawns and cinematic views never expose automatic viewpoint IDs', async () => {
  for (const settings of [{ firstPerson: true, collisionUrl: '/synthetic/collider.glb' }, { collisionUrl: '/synthetic/collider.glb', freeFlight: true }]) await fixture(async state => {
    await state.decode(); state.draw(); assert.equal(state.calibrationLoads(), 0); assert.equal(state.viewpointLoads(), 0);
    assert.equal(state.walkingPointReports.length, 0); assert.equal(state.viewer.setWalkingViewpoint('arrival'), false);
  }, settings);
});

test('late automatic calibration resolves after exit without initializing physics or publishing callbacks', async () => {
  await fixture(async state => {
    assert.equal(state.calibrationLoads(), 1); assert.equal(state.physicsInstances.length, 0);
    await state.decode(); state.draw(); state.viewer.destroy(); const callbacks = state.lifecycle.length;
    await state.completeCalibration();
    assert.equal(state.physicsInstances.length, 0); assert.equal(state.viewpointLoads(), 0); assert.equal(state.walkingPointReports.length, 0);
    assert.equal(state.lifecycle.length, callbacks); assert.equal(state.viewer.walkingAvailable, false); assert.equal(state.frames.size, 0);
    assert.deepEqual(state.collisionDisposals(), { geometry: 1, material: 1 });
  }, { ...automaticWalking, deferCalibration: true });
});

test('late automatic perspective helper is ignored and the initialized physics is freed exactly once', async () => {
  await fixture(async state => {
    assert.equal(state.physicsInstances.length, 1); assert.equal(state.viewpointLoads(), 1); assert.equal(state.walkingPointReports.length, 0);
    await state.decode(); state.draw(); state.viewer.destroy(); const callbacks = state.lifecycle.length, controller = state.physicsInstances[0];
    await state.completeViewpoints();
    assert.equal(controller.destroys, 1); assert.equal(controller.advances.length, 0, 'A late helper never audits disposed physics');
    assert.equal(state.walkingPointReports.length, 0); assert.equal(state.lifecycle.length, callbacks);
    assert.equal(state.viewer.setWalkingViewpoint('arrival'), false); assert.equal(state.frames.size, 0);
    state.viewer.destroy(); assert.equal(controller.destroys, 1);
    assert.deepEqual(state.collisionDisposals(), { geometry: 1, material: 1 });
  }, { ...automaticWalking, deferViewpoints: true });
});

test('late automatic physics is freed before viewpoint discovery and cannot announce readiness after exit', async () => {
  await fixture(async state => {
    assert.equal(state.physicsInstances.length, 1); assert.equal(state.viewpointLoads(), 0);
    await state.decode(); state.draw(); state.viewer.destroy(); const callbacks = state.lifecycle.length;
    await state.completePhysics();
    assert.equal(state.physicsInstances[0].destroys, 1); assert.equal(state.viewpointLoads(), 0);
    assert.equal(state.walkingPointReports.length, 0); assert.equal(state.lifecycle.length, callbacks); assert.equal(state.frames.size, 0);
  }, { ...automaticWalking, deferPhysics: true });
});
