import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import * as Three from 'three';
import ts from 'typescript';

// Execute the actual scene and frame gate with real Three geometry/materials.
// Only GPU, DOM, fetch and model decoding are fixtures; this is not browser proof.
const compile = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const runtimeUrl = moduleUrl(await compile('../src/viewer-runtime.ts'));
const unboxingUrl = moduleUrl((await compile('../src/gift-unboxing.ts')).replace(/import '\.\/gift-unboxing.css';\s*/, '').replace(/from 'three'/, `from '${import.meta.resolve('three')}'`));
const atmosphereUrl = moduleUrl((await compile('../src/keepsake-atmosphere.ts')).replace(/from 'three'/, `from '${import.meta.resolve('three')}'`));
let source = await compile('../src/scene.ts');
source = source.replace(/import \* as THREE from 'three';/, `import * as RealThree from '${import.meta.resolve('three')}'; const THREE={...RealThree,WebGLRenderer:globalThis.__sceneFixture.Renderer};`)
  .replace(/import \{ OrbitControls \} from '[^']+';/, 'const OrbitControls=globalThis.__sceneFixture.Controls;')
  .replace(/import \{ GLTFLoader \} from '[^']+';/, 'const GLTFLoader=globalThis.__sceneFixture.Loader;')
  .replace(/from '\.\/viewer-runtime'/, `from '${runtimeUrl}'`)
  .replace(/from '\.\/gift-unboxing'/, `from '${unboxingUrl}'`)
  .replace(/from '\.\/keepsake-atmosphere'/, `from '${atmosphereUrl}'`);
const sceneUrl = moduleUrl(source);

async function fixture(action, settings = {}) {
  const names = ['__sceneFixture', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'document', 'window', 'location', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'fetch', 'createImageBitmap'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const pending = new Map(); let sequence = 0, intersection;
  const media = new EventTarget(); media.matches = false;
  const document = new EventTarget(); document.visibilityState = 'visible';
  const browserWindow = new EventTarget();
  class Element extends EventTarget {
    children=[];attrs={};className='';textContent='';hidden=false;disabled=false;removed=false;
    classList={add: name=>this.className+=' '+name};
    setAttribute(name,value){this.attrs[name]=value;}append(...children){this.children.push(...children);}remove(){this.removed=true;}
    setPointerCapture(){}releasePointerCapture(){}click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
  }
  document.createElement=()=>new Element();
  const model = new Three.Group();
  const texture = new Three.Texture();
  const standard = new Three.MeshStandardMaterial({ color: '#79a7d1', map: texture, roughness: 0.6 });
  const physical = new Three.MeshPhysicalMaterial({ color: '#e7c089', wireframe: true });
  const basic = new Three.MeshBasicMaterial({ color: '#abcdef' });
  const geometry = new Three.BoxGeometry(...(settings.modelSize || [2, 2, 1]));
  model.add(new Three.Mesh(geometry, [standard, physical, basic]));
  const photoBytes = Uint8Array.of(0xff, 0xd8, 0x50, 0x48, 0x4f, 0x54, 0x4f, 0xff, 0xd9);
  const state = { model, standard, physical, basic, texture, pending, media, document, browserWindow, frames: [], disposed: false, parsed: false, orbitUpdates: [], requests: [], bitmapCalls: [], bitmapClosed: 0, geometryDisposed: 0, modelTextureDisposed: 0, photoBytes, focused:0 };
  geometry.addEventListener('dispose', () => state.geometryDisposed++);
  texture.addEventListener('dispose', () => state.modelTextureDisposed++);
  const bitmap = { width: 1600, height: 900, close() { state.bitmapClosed++; } };
  let resolveBitmap;
  const decodedPhoto = settings.deferPhoto ? new Promise(resolve => { resolveBitmap = resolve; }) : Promise.resolve(bitmap);
  state.bitmap = bitmap;
  class Renderer {
    shadowMap={enabled:false,type:null};
    domElement = Object.assign(new EventTarget(), { setAttribute() {}, focus() {state.focused++;}, remove() {}, tabIndex: -1 });
    setPixelRatio() {} setSize() {}
    render(scene, camera) { state.frames.push({ scene, camera: camera.clone() }); }
    dispose() { state.disposed = true; } forceContextLoss() {}
  }
  class Controls extends Three.EventDispatcher {
    target = new Three.Vector3(); autoRotate = false; autoRotateSpeed = 0; enableDamping = false;
    update(delta) { if (this.autoRotate) state.orbitUpdates.push(delta); return false; }
    dispose() {}
  }
  class Loader { async parseAsync() { state.parsed = true; return { scene: model }; } }
  const values = {
    __sceneFixture: { Renderer, Controls, Loader }, matchMedia: () => media,
    requestAnimationFrame: callback => { const id = ++sequence; pending.set(id, callback); return id; },
    cancelAnimationFrame: id => pending.delete(id),
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { constructor(callback) { intersection = callback; } observe() {} disconnect() {} },
    document, window:browserWindow, location: { origin: 'http://127.0.0.1:4323' }, devicePixelRatio: 1, innerWidth: 1200, innerHeight: 900,
    fetch: async (url, options) => { state.requests.push({ url, options }); return new Response(url.includes('/original.jpg') ? photoBytes : Uint8Array.of(0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0)); },
    createImageBitmap: (blob, options) => { state.bitmapCalls.push({ blob, options }); return decodedPhoto; },
  };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const host = { children:[], getBoundingClientRect: () => ({ width: settings.width||700, height: settings.height||500, top: 0, bottom: settings.height||500, left: 0, right: settings.width||700 }), append(...children) {this.children.push(...children);} };state.host=host;
  const { mountMemoryScene } = await import(`${sceneUrl}#${Math.random()}`);
  const errors = []; let ready = 0;
  state.viewer = mountMemoryScene(host, { modelUrl: '/demo/model.glb', ...settings.options, onReady: () => ready++, onError: message => errors.push(message) });
  state.loaded = async () => { for (let i = 0; i < 10 && !state.parsed; i++) await setImmediate(); assert.equal(state.parsed, true); await setImmediate(); await setImmediate(); };
  state.photoStarted = async () => { for (let i = 0; i < 10 && !state.bitmapCalls.length; i++) await setImmediate(); assert.equal(state.bitmapCalls.length, 1); };
  state.completePhoto = async () => { resolveBitmap?.(bitmap); await setImmediate(); await setImmediate(); };
  state.run = (time) => { const [id, callback] = pending.entries().next().value || []; assert.ok(callback, 'A scheduled frame is required'); pending.delete(id); callback(time); };
  state.visible = (value) => intersection([{ target: host, isIntersecting: value, intersectionRatio: value ? 1 : 0 }]);
  state.readyCount = () => ready;
  try { await action(state); assert.deepEqual(errors, []); }
  finally {
    state.viewer.destroy();
    resolveBitmap?.(bitmap); await setImmediate(); await setImmediate();
    for (const name of names) { const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
}

test('wireframe applies to loaded standard/physical model materials and restores their original flags and texture', async () => {
  await fixture(async state => {
    state.viewer.setWireframe(true); // A preference chosen before decoding must persist.
    await state.loaded(); state.run(100);
    assert.equal(state.readyCount(), 1);
    assert.equal(state.standard.wireframe, true); assert.equal(state.physical.wireframe, true);
    assert.equal(state.basic.wireframe, false); assert.equal(state.standard.map, state.texture);
    assert.equal(state.standard.color.getHexString(), '79a7d1'); assert.equal(state.standard.roughness, 0.6);
    const scene = state.frames.at(-1).scene;
    assert.equal(scene.background.getHexString(), 'f8f6f0');
    assert.equal(scene.getObjectByName('Gift display plinth'), undefined); let renderedMeshes=0; scene.traverse(item=>{if(item instanceof Three.Mesh)renderedMeshes++;}); assert.equal(renderedMeshes,1,'Only the decoded Tripo fixture is rendered');
    state.viewer.setDisplayMode('textured'); state.run(120);
    assert.equal(state.standard.wireframe, false); assert.equal(state.physical.wireframe, true);
    state.viewer.destroy(); assert.equal(state.geometryDisposed, 1); assert.equal(state.modelTextureDisposed, 1); assert.equal(state.disposed, true);
  });
});

test('explicit orbit is capped, stops while hidden/offscreen, and cannot resume after destruction', async () => {
  await fixture(async state => {
    await state.loaded(); state.run(100);
    assert.equal(state.pending.size, 0, 'The default studio is still');
    assert.equal(state.viewer.setAutoRotate(true), true); state.run(110);
    const count = state.frames.length;
    state.run(125); assert.equal(state.frames.length, count, 'Orbit does not render above 30 FPS');
    state.run(145); assert.equal(state.frames.length, count + 1);
    state.visible(false); assert.equal(state.pending.size, 0);
    state.visible(true); state.run(10000);
    assert.ok(state.orbitUpdates.at(-1) <= 0.05, 'An offscreen pause must not jump the camera');
    state.document.visibilityState = 'hidden'; state.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(state.pending.size, 0);
    state.document.visibilityState = 'visible'; state.document.dispatchEvent(new Event('visibilitychange'));
    const stale = [...state.pending.values()][0];
    state.viewer.destroy(); const finalCount = state.frames.length; stale(20000);
    assert.equal(state.frames.length, finalCount); assert.equal(state.pending.size, 0);
    assert.equal(state.viewer.setAutoRotate(true), false);
  });
});

test('changing to reduced motion stops orbit and prevents restarting it', async () => {
  await fixture(async state => {
    await state.loaded(); state.run(100);
    state.viewer.setAutoRotate(true); state.run(110);
    state.media.matches = true; state.media.dispatchEvent(new Event('change'));
    state.run(150); assert.equal(state.pending.size, 0);
    assert.equal(state.viewer.setAutoRotate(true), false); state.run(180);
    assert.equal(state.pending.size, 0);
    state.media.matches = false; state.media.dispatchEvent(new Event('change'));
    state.run(210); assert.equal(state.pending.size, 0, 'Changing the preference must not silently opt back into orbit');
  });
});

test('postcard representations preserve sponsor volume and never author a photograph plane', async () => {
  for (const modelSize of [[2,2,1],[1,2,2]]) await fixture(async state=>{
    await state.loaded();state.run(100);assert.equal(state.readyCount(),1);
    assert.equal(state.requests.length,1);assert.equal(state.bitmapCalls.length,0);
    assert.equal(state.frames.at(-1).scene.getObjectByName('Preserved original place photograph'),undefined);
    assert.equal(state.model.scale.x,state.model.scale.y);assert.equal(state.model.scale.y,state.model.scale.z);
    assert.equal(state.standard.map,state.texture);assert.equal(state.standard.roughness,.6);
    state.viewer.destroy();state.viewer.destroy();assert.equal(state.geometryDisposed,1);assert.equal(state.modelTextureDisposed,1);assert.equal(state.pending.size,0);
  },{modelSize,options:{theme:'dusk',photoIntent:'place',objectRepresentation:'framed-postcard',photoUrl:'/demo/original.jpg'}});
});
test('a place souvenir retains model volume and explicit yaw without fetching or overlaying the original photograph', async () => {
  await fixture(async state => {
    await state.loaded(); state.run(100);
    const size = new Three.Box3().setFromObject(state.model).getSize(new Three.Vector3());
    assert.equal(state.requests.length, 1); assert.equal(state.bitmapCalls.length, 0);
    assert.equal(state.frames.at(-1).scene.getObjectByName('Preserved original place photograph'), undefined);
    assert.ok(Math.abs(size.z - 2.2) < 1e-6); assert.ok(Math.abs(size.x / size.z - .5) < 1e-6);
    assert.equal(state.model.scale.x, state.model.scale.y); assert.equal(state.model.scale.y, state.model.scale.z);
    assert.equal(state.model.rotation.x, 0); assert.equal(state.model.rotation.y, -Math.PI / 2);
    assert.equal(state.standard.map, state.texture);
    state.viewer.destroy(); assert.equal(state.geometryDisposed, 1); assert.equal(state.modelTextureDisposed, 1);
  }, { options: { theme: 'dusk', photoIntent: 'place', objectRepresentation: 'souvenir-miniature', modelYaw: -Math.PI / 2, photoUrl: '/demo/original.jpg' } });
});

test('three deliberate HTML actions reveal the untouched GLB without 3D packaging',async()=>{
  let revealed=0;
  await fixture(async state=>{
    await state.loaded();state.run(100);assert.equal(state.readyCount(),1);assert.equal(state.viewer.getUnboxingState(),'wrapped');assert.equal(state.model.visible,false);assert.equal(revealed,0);
    const scene=state.frames.at(-1).scene,ui=state.host.children.find(value=>value.className==='gu-unboxing'),button=ui.children.find(value=>value.className==='gu-action');
    for(const name of ['Interactive gift wrapping','Gift box lifting lid','Gift display plinth'])assert.equal(scene.getObjectByName(name),undefined);
    const position=state.model.position.clone(),scale=state.model.scale.clone(),rotation=state.model.rotation.clone();
    let now=100;const drain=()=>{for(let i=0;i<80&&state.pending.size;i++)state.run(now+=40);assert.equal(state.pending.size,0,'The viewer sleeps after each HTML reveal action');};
    button.click();assert.equal(button.disabled,true);button.click();drain();assert.equal(state.viewer.getUnboxingState(),'ribbon');assert.equal(state.model.visible,false);
    button.click();drain();assert.equal(state.viewer.getUnboxingState(),'lid');assert.equal(state.model.visible,false);
    button.click();drain();assert.equal(state.viewer.getUnboxingState(),'revealed');assert.equal(state.model.visible,true);assert.equal(button.hidden,true);assert.equal(state.focused,1);assert.equal(revealed,1);
    assert.ok(state.model.position.equals(position));assert.ok(state.model.scale.equals(scale));assert.ok(state.model.rotation.equals(rotation));assert.equal(state.standard.map,state.texture);
    state.viewer.rotate(.1);state.viewer.zoom(-.1);state.run(now+=40);assert.equal(state.pending.size,0);assert.equal(revealed,1);
    state.viewer.destroy();state.viewer.destroy();assert.equal(state.geometryDisposed,1);assert.equal(state.modelTextureDisposed,1);assert.equal(ui.removed,true);
  },{options:{unboxing:true,theme:'dusk',onReveal:()=>revealed++}});
});
test('HTML reveal pauses while offscreen/blurred, and reduced motion completes only the requested step',async()=>{
  await fixture(async state=>{
    await state.loaded();state.run(100);state.viewer.advanceUnboxing();state.run(140);
    const ui=state.host.children.find(value=>value.className==='gu-unboxing'),button=ui.children.find(value=>value.className==='gu-action');
    state.visible(false);assert.equal(state.pending.size,0);state.visible(true);state.run(10000);assert.equal(button.disabled,true,'A long pause does not skip the pending action');
    state.browserWindow.dispatchEvent(new Event('blur'));assert.equal(state.pending.size,0);state.document.visibilityState='hidden';state.document.dispatchEvent(new Event('visibilitychange'));state.document.visibilityState='visible';state.document.dispatchEvent(new Event('visibilitychange'));assert.equal(state.pending.size,0);
    state.browserWindow.dispatchEvent(new Event('focus'));state.run(30000);assert.equal(button.disabled,true);state.media.matches=true;state.media.dispatchEvent(new Event('change'));state.run(30040);assert.equal(state.pending.size,0);assert.equal(state.viewer.getUnboxingState(),'ribbon');assert.equal(state.model.visible,false);
    state.viewer.advanceUnboxing();state.run(30100);assert.equal(state.pending.size,0);assert.equal(state.viewer.getUnboxingState(),'lid');assert.equal(state.model.visible,false);state.viewer.advanceUnboxing();state.run(30200);assert.equal(state.viewer.getUnboxingState(),'revealed');assert.equal(state.model.visible,true);
  },{options:{unboxing:true}});
});
test('portrait gift fits the actual model and never overlays or resizes sponsor geometry',async()=>{
  await fixture(async state=>{
    await state.loaded();state.run(100);const scene=state.frames.at(-1).scene;
    assert.equal(state.requests.length,1);assert.equal(state.bitmapCalls.length,0);assert.equal(state.model.visible,false);
    const bounds=new Three.Box3().setFromObject(state.model),camera=state.frames.at(-1).camera;camera.lookAt(new Three.Vector3(0,1.17,0));camera.updateMatrixWorld();
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const point=new Three.Vector3(x,y,z).project(camera);assert.ok(Math.abs(point.x)<1.01,'Actual gift fits portrait width');}
    state.media.matches=true;state.media.dispatchEvent(new Event('change'));state.run(130);state.viewer.advanceUnboxing();state.run(170);state.viewer.advanceUnboxing();state.run(210);state.viewer.advanceUnboxing();state.run(250);assert.equal(state.model.visible,true);assert.equal(state.standard.map,state.texture);
    const revealedCamera=state.frames.at(-1).camera;revealedCamera.lookAt(new Three.Vector3(0,1.17,0));revealedCamera.updateMatrixWorld();
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const point=new Three.Vector3(x,y,z).project(revealedCamera);assert.ok(Math.abs(point.x)<.71,'Revealed gift fits compact width');assert.ok(Math.abs(point.y)<.83,'Revealed gift fits compact height');}
    const fittedDistance=revealedCamera.position.distanceTo(new Three.Vector3(0,1.17,0));state.viewer.zoom(-.1);state.run(290);assert.ok(state.frames.at(-1).camera.position.distanceTo(new Three.Vector3(0,1.17,0))<fittedDistance,'Camera fitting preserves manual zoom');
  },{width:390,height:580,modelSize:[1,2,2],options:{unboxing:true,theme:'dusk',objectRepresentation:'framed-postcard',photoUrl:'/demo/original.jpg'}});
});
test('studio lighting creates no geometry, fog or idle animation and restores the scene once',async()=>{
  await fixture(async state=>{
    await state.loaded();state.run(100);const scene=state.frames.at(-1).scene,lighting=scene.getObjectByName('Keepsake studio lighting');assert.ok(lighting);assert.equal(scene.fog,null);assert.equal(state.pending.size,0);
    let extraMeshes=0;lighting.traverse(item=>{if(item instanceof Three.Mesh||item instanceof Three.Points)extraMeshes++;});assert.equal(extraMeshes,0);
    state.viewer.rotate(.1);state.run(140);assert.equal(state.pending.size,0);
    state.visible(false);assert.equal(state.pending.size,0);state.visible(true);state.run(10000);assert.equal(state.pending.size,0);
    state.viewer.destroy();state.viewer.destroy();assert.equal(lighting.parent,null);assert.equal(state.geometryDisposed,1);assert.equal(state.modelTextureDisposed,1);
  },{options:{unboxing:true,theme:'dusk'}});
});
