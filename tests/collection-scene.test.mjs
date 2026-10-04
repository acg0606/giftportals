import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setMaxListeners} from 'node:events';
import {setImmediate} from 'node:timers/promises';
import * as Three from 'three';
import ts from 'typescript';
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const runtime=data(compile(await readFile(new URL('../src/viewer-runtime.ts',import.meta.url),'utf8')));
const conveyor=data(compile(await readFile(new URL('../src/collection-conveyor.ts',import.meta.url),'utf8')));
const props=data(compile(await readFile(new URL('../src/collection-props.ts',import.meta.url),'utf8'))
 .replace("import * as THREE from 'three';",'const THREE=globalThis.__roomFixture.THREE;')
 .replace("import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';",'class GLTFLoader { constructor(manager) { return new globalThis.__roomFixture.GLTFLoader(manager); } }')
 .replace("from './viewer-runtime'",`from '${runtime}'`));
const moduleCode=compile(await readFile(new URL('../src/collection-scene.ts',import.meta.url),'utf8'))
 .replace("import * as THREE from 'three';",'const THREE=globalThis.__roomFixture.THREE;')
 .replace("import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';",'const GLTFLoader=globalThis.__roomFixture.GLTFLoader;')
 .replace("import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';",'const {SparkRenderer,SplatMesh}=globalThis.__roomFixture;')

 .replace("from './viewer-runtime'",`from '${runtime}'`)
 .replace("from './collection-conveyor'",`from '${conveyor}'`)
 .replace("from './collection-props'",`from '${props}'`);
const controller=data(moduleCode);
const flush=async()=>{await setImmediate();await setImmediate();};
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};};
function glb(value={}){
 const document={asset:{version:'2.0'},buffers:[{byteLength:0}],nodes:[],...value};let text=JSON.stringify(document);text+=' '.repeat((4-text.length%4)%4);const encoded=Buffer.from(text),bytes=Buffer.alloc(28+encoded.length);bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(encoded.length,12);bytes.writeUInt32LE(0x4e4f534a,16);encoded.copy(bytes,20);bytes.writeUInt32LE(0,20+encoded.length);bytes.writeUInt32LE(0x004e4942,24+encoded.length);return new Uint8Array(bytes);
}
const png=(width=320,height=240,kind=0)=>{const bytes=Buffer.alloc(kind?25:24);bytes.writeUInt32BE(0x89504e47,0);bytes.writeUInt32BE(0x49484452,12);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);if(kind)bytes[24]=kind;return bytes;};
const item=(id,extra={})=>({id,title:'Synthetic keepsake '+id,subtitle:'Test',story:'Synthetic',openPath:'#/test',kind:'memory',demo:true,...extra});
let sequence=0;
async function fixture(action,settings={}){
 const names=['document','window','location','devicePixelRatio','innerWidth','innerHeight','ResizeObserver','IntersectionObserver','requestAnimationFrame','cancelAnimationFrame','matchMedia','createImageBitmap','fetch','setTimeout','clearTimeout','__roomFixture','URL'];
 const saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const state={current:true,frames:new Map(),renderers:[],projects:[],selected:[],errors:[],ready:0,requests:[],environmentRequests:[],environmentBitmaps:[],worldDecodes:[],panoramaDecodes:[],sorts:[],sparks:[],splats:[],revoked:[],models:[],parses:[],bitmaps:[],timers:new Map(),resizeClosed:0,visibilityClosed:0,frame:0,now:0,maxParses:0,activeParses:0,playback:[]};
 let timerId=0,frameId=0;
 class Element extends EventTarget{
  style={};dataset={};attrs=new Map();children=[];parent=null;captures=new Set();isConnected=true;
  addEventListener(type,listener,options){if(options?.signal)setMaxListeners(0,options.signal);super.addEventListener(type,listener,options);}
  setAttribute(name,value){this.attrs.set(name,String(value));}getAttribute(name){return this.attrs.get(name)||null;}removeAttribute(name){this.attrs.delete(name);if(name==='src')this.src='';}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}remove(){if(this.parent)this.parent.children=this.parent.children.filter(value=>value!==this);this.parent=null;this.isConnected=false;}
  getBoundingClientRect(){return{left:10,top:20,width:settings.width||1000,height:settings.height||650,right:1010,bottom:670};}
  setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);}
 }
 class Renderer{
  domElement=new Element();shadowMap={};disposed=false;lost=false;cameras=[];
  constructor(parameters){if(settings.noWebGL)throw Error('Synthetic unavailable GPU');this.parameters=parameters;state.renderers.push(this);}
  setSize(w,h){this.size=[w,h];}setPixelRatio(value){this.pixelRatio=value;}
  render(scene,camera){if(settings.renderFailure)throw Error('Synthetic render failure');camera.updateMatrixWorld();this.scene=scene;this.camera=camera.clone();this.cameras.push(this.camera);}
  dispose(){this.disposed=true;}forceContextLoss(){this.lost=true;}
 }
 class SparkRenderer extends Three.Group{
  disposed=0;constructor(input){super();this.input=input;state.sparks.push(this);}dispose(){this.disposed++;}
  async update(input){const plan=deferred();state.sorts.push({...plan,...input});if(settings.failSort)throw Error('Synthetic sort unavailable');if(settings.deferSort)await plan.promise;}
 }
 class SplatMesh extends Three.Group{
  disposed=0;constructor(input){super();this.input=input;state.splats.push(this);const plan=deferred();state.worldDecodes.push(plan);this.initialized=settings.deferWorld?plan.promise:settings.failWorldDecode?Promise.reject(Error('Synthetic decode unavailable')):Promise.resolve();}dispose(){this.disposed++;}
 }
 const NativeURL=globalThis.URL;class TestURL extends NativeURL{static createObjectURL(blob){return NativeURL.createObjectURL(blob);}static revokeObjectURL(url){state.revoked.push(url);NativeURL.revokeObjectURL(url);}}
 class Motion extends EventTarget{matches=!!settings.reduced;set(value){this.matches=value;this.dispatchEvent(new Event('change'));}}
 const motion=new Motion();state.motion=motion;
 const document=new EventTarget();document.visibilityState='visible';state.document=document;
 const window=new EventTarget();state.window=window;
 document.createElement=()=>{const image=new Element();image.width=0;image.height=0;image.getContext=()=>({fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},drawImage(){},createLinearGradient(){return{addColorStop(){}};}});return image;};
 const model=()=>{
  const root=new Three.Group(),geometry=new Three.BoxGeometry(.98,settings.flatPlace?.35:.72,.79),material=new Three.MeshStandardMaterial({color:'#987654'}),mesh=new Three.Mesh(geometry,material);root.add(mesh);
  const value={root,geometry,material,geometryDisposed:0,materialDisposed:0,bitmapClosed:0};geometry.addEventListener('dispose',()=>value.geometryDisposed++);material.addEventListener('dispose',()=>value.materialDisposed++);
  if(settings.largeTexture){const image={width:4096,height:4096,close(){value.bitmapClosed++;}},texture=new Three.Texture(image);texture.needsUpdate=true;material.map=texture;value.texture=texture;}
  state.models.push(value);return value;
 };
 class Loader{
  constructor(manager){this.manager=manager;}
  async parseAsync(){if(settings.failModel)throw Error('Synthetic decode unavailable');const value=model(),plan=deferred();state.parses.push(plan);state.activeParses++;state.maxParses=Math.max(state.maxParses,state.activeParses);if(settings.deferParse)await plan.promise;state.activeParses--;return{scene:value.root};}
 }
 const values={document,window,location:{origin:'http://127.0.0.1:4325'},devicePixelRatio:2,innerWidth:settings.width||1000,innerHeight:settings.height||650,
  ResizeObserver:class{constructor(callback){this.callback=callback;}observe(){this.callback();}disconnect(){state.resizeClosed++;}},
  IntersectionObserver:class{constructor(callback){state.intersection=callback;}observe(){}disconnect(){state.visibilityClosed++;}},
  requestAnimationFrame:callback=>{state.frames.set(++frameId,callback);return frameId;},cancelAnimationFrame:id=>state.frames.delete(id),
  matchMedia:()=>motion,createImageBitmap:async(blob)=>{const bytes=Buffer.from(await blob.arrayBuffer()),width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),pano=width===2048&&height===1024;const bitmap={width,height,closed:0,close(){this.closed++;}};(pano?state.environmentBitmaps:state.bitmaps).push(bitmap);if(pano&&settings.deferPanorama){const plan=deferred();state.panoramaDecodes.push(plan);await plan.promise;}return bitmap;},
  URL:TestURL,
  fetch:async(url,options)=>{const world=url.endsWith('.spz'),pano=url.endsWith('memory-studio-pano.png');(world||pano?state.environmentRequests:state.requests).push({url,options});if(world&&settings.failWorld||pano&&settings.failPanorama)return new Response('Synthetic environment unavailable',{status:404});const bytes=world?Buffer.from([1,2,3]):pano?png(2048,1024):url.endsWith('.glb')?glb():png();return new Response(bytes,{headers:{'content-length':String(bytes.length)}});},
  setTimeout:(callback,delay)=>{state.timers.set(++timerId,{callback,delay});return timerId;},clearTimeout:id=>state.timers.delete(id),
  __roomFixture:{THREE:{...Three,WebGLRenderer:Renderer},GLTFLoader:Loader,SparkRenderer,SplatMesh},
 };
 for(const[name,value]of Object.entries(values))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 const module=await import(controller+'#'+ ++sequence);state.module=module;state.host=new Element();
 state.propSelections=[];state.scene=module.mountCollectionScene(state.host,{items:settings.items||[item('first',{imageUrl:'/synthetic/photo.png'}),item('second'),item('third')],environment:settings.environment,props:settings.props||[],isCurrent:()=>state.current,onReady:()=>state.ready++,onUnavailable:message=>state.errors.push(message),onSelect:id=>state.selected.push(id),onPropSelect:id=>state.propSelections.push(id),onProject:points=>state.projects.push(points),onPlaybackChange:value=>state.playback.push(value)});
 state.draw=(elapsed=50)=>{const callbacks=[...state.frames.values()];state.frames.clear();state.now+=elapsed;callbacks.forEach(callback=>callback(state.now));};
 state.settle=()=>{for(let i=0;i<100&&state.frames.size;i++)state.draw();};
 state.pointer=(type,x,y)=>{const event=new Event(type);Object.assign(event,{button:0,pointerId:1,clientX:x+10,clientY:y+20});state.renderers[0].domElement.dispatchEvent(event);};
 try{await flush();await action(state);}finally{state.scene.destroy();for(const[name,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
}
test('the completed World Labs studio contains only imported scenery and real gifts, never authored furniture',async()=>fixture(async state=>{
 state.draw();const scene=state.renderers[0].scene;assert.equal(state.ready,1);assert.equal(state.renderers.length,1);assert.equal(state.renderers[0].parameters.antialias,false);assert.equal(state.host.dataset.roomEnvironmentProvider,'WorldLabs');assert.equal(state.host.dataset.roomEnvironmentState,'ready');
 assert.equal(state.splats.length,1);assert.equal(state.splats[0].input.maxSplats,500000);assert.equal(state.splats[0].rotation.x,Math.PI);assert.equal(state.splats[0].name,'World Labs memory studio');
 for(const name of ['Personal wooden memory desk','Central hologram projector','Warm transparent hologram pyramid','Personal laptop','Beloved books','Everyday ceramic mug','Little desk globe','Warm reading lamp','Living desk plant'])assert.equal(scene.getObjectByName(name),undefined);
 const authoredMeshes=[];scene.traverse(object=>{if(object instanceof Three.Mesh&&!state.models.some(model=>model.root.getObjectById(object.id)))authoredMeshes.push(object);});assert.equal(authoredMeshes.length,0);assert.equal(state.host.dataset.roomModelsReady,'1');
 state.scene.destroy();state.scene.destroy();assert.equal(state.splats[0].disposed,1);assert.equal(state.sparks[0].disposed,1);assert.equal(state.environmentBitmaps[0].closed,1);assert.equal(state.timers.size,0);assert.equal(state.frames.size,0);
},{items:[item('first',{modelUrl:'/synthetic/model.glb'})]}));

test('the first room frame waits for imported desk props and taps activate their real mesh',async()=>fixture(async state=>{
 assert.equal(state.parses.length,2);state.parses[0].resolve();await flush();state.draw();assert.equal(state.ready,0);assert.equal(state.renderers[0].cameras.length,0);
 state.parses[1].resolve();await flush();state.draw();assert.equal(state.ready,1);assert.equal(state.host.dataset.roomPropsReady,'1');
 const frame=state.renderers[0].scene.getObjectByName('Tripo photo-frame');assert.ok(frame);const center=new Three.Box3().setFromObject(frame).getCenter(new Three.Vector3()).project(state.renderers[0].camera),x=(center.x+1)*500,y=(1-center.y)*325;
 const checkRay=new Three.Raycaster();checkRay.setFromCamera(new Three.Vector2(center.x,center.y),state.renderers[0].camera);assert.ok(checkRay.intersectObject(frame,true).length,'a projected prop center must intersect its imported mesh');
 state.pointer('pointermove',x,y);assert.equal(state.renderers[0].domElement.title,'Your memories');state.pointer('pointerdown',x,y);state.pointer('pointerup',x,y);assert.deepEqual(state.propSelections,['photo-frame']);assert.deepEqual(state.selected,[]);
 state.scene.destroy();assert.equal(frame.parent,null);assert.ok(state.models.every(value=>value.geometryDisposed===1&&value.materialDisposed===1));
},{deferParse:true,items:[item('gift',{modelUrl:'/synthetic/gift.glb'})],props:[{id:'photo-frame',modelUrl:'/synthetic/frame.glb',position:[-.6,-.24,-1.2],maxBounds:[.16,.20,.07]}]}));

test('exit while a desk prop decodes cannot reveal or reattach the late imported object',async()=>fixture(async state=>{
 assert.equal(state.parses.length,1);state.scene.destroy();state.parses[0].resolve();await flush();state.draw();assert.equal(state.ready,0);assert.equal(state.renderers[0].scene,undefined);assert.equal(state.models[0].geometryDisposed,1);assert.equal(state.models[0].materialDisposed,1);
},{deferParse:true,items:[],props:[{id:'travel-journal',modelUrl:'/synthetic/journal.glb',position:[.25,-.24,-.73],maxBounds:[.18,.025,.12]}]}));

test('a decoded panorama only lights PBR materials and cannot reveal the pending 3D studio',async()=>fixture(async state=>{
 const scene=state.sparks[0].parent;assert.ok(scene.environment instanceof Three.Texture);assert.ok(scene.background instanceof Three.Color);assert.equal(scene.background.getHexString(),'101c2b');
 assert.equal(state.host.dataset.roomEnvironmentProvider,'pending');assert.equal(state.host.dataset.roomEnvironmentState,'loading');state.draw();assert.equal(state.ready,0);assert.equal(state.renderers[0].cameras.length,0);assert.equal(state.sorts.length,0);assert.equal(state.frames.size,0);
 state.worldDecodes[0].resolve();await flush();state.draw();assert.equal(state.host.dataset.roomEnvironmentProvider,'WorldLabs');assert.equal(state.host.dataset.roomEnvironmentState,'ready');assert.equal(state.ready,1);assert.equal(state.sorts.length,1);assert.equal(state.sorts[0].scene,scene);assert.ok(scene.background instanceof Three.Color);
},{deferWorld:true}));

test('a failed SPZ is terminal even if its panorama and real souvenirs are already decoded',async()=>fixture(async state=>{
 assert.equal(state.host.dataset.roomModelsReady,'1');assert.equal(state.environmentBitmaps.length,1);state.draw();assert.equal(state.ready,0);
 state.worldDecodes[0].reject(Error('Synthetic room failure'));await flush();state.draw();assert.equal(state.errors.length,1);assert.match(state.errors[0],/3D studio could not load/);assert.equal(state.ready,0);assert.equal(state.renderers[0].cameras.length,0);assert.equal(state.host.children.length,0);
 assert.equal(state.splats[0].disposed,1);assert.equal(state.sparks[0].disposed,1);assert.equal(state.environmentBitmaps[0].closed,1);assert.equal(state.models[0].geometryDisposed,1);assert.equal(state.models[0].materialDisposed,1);assert.equal(state.frames.size,0);assert.equal(state.timers.size,0);
},{deferWorld:true,items:[item('gift',{modelUrl:'/synthetic/gift.glb'})]}));

test('missing studio reports one accessible error and disposes the renderer',async()=>fixture(async state=>{
 state.draw();assert.equal(state.ready,0);assert.equal(state.errors.length,1);assert.match(state.errors[0],/photos and gift stories/);assert.equal(state.host.children.length,0);assert.equal(state.frames.size,0);assert.equal(state.timers.size,0);assert.equal(state.renderers[0].disposed,true);
},{failWorld:true,failPanorama:true}));

test('late SPZ and panorama decoding close data exactly once after exit',async()=>fixture(async state=>{
 assert.equal(state.worldDecodes.length,1);assert.equal(state.panoramaDecodes.length,1);state.scene.destroy();assert.ok(state.environmentRequests.every(request=>request.options.signal.aborted));state.worldDecodes[0].resolve();state.panoramaDecodes[0].resolve();await flush();
 assert.equal(state.splats[0].disposed,1);assert.equal(state.environmentBitmaps[0].closed,1);assert.equal(state.host.dataset.roomEnvironmentProvider,undefined);assert.equal(state.frames.size,0);assert.equal(state.timers.size,0);
},{deferWorld:true,deferPanorama:true}));

test('studio decoding deadline reports terminal failure while a late decode is disposed exactly once',async()=>fixture(async state=>{
 const timer=[...state.timers.entries()].find(([,value])=>value.delay===45000);assert.ok(timer);state.timers.delete(timer[0]);timer[1].callback();assert.equal(state.errors.length,1);assert.equal(state.host.children.length,0);assert.equal(state.splats[0].disposed,1);assert.equal(state.ready,0);
 state.worldDecodes[0].resolve();await flush();assert.equal(state.splats[0].disposed,1);assert.equal(state.errors.length,1);assert.equal(state.sorts.length,0);assert.equal(state.environmentBitmaps[0].closed,1);assert.equal(state.timers.size,0);assert.equal(state.frames.size,0);
},{deferWorld:true}));

test('the studio is revealed only after decoded splats finish sorting and all real models settle',async()=>fixture(async state=>{
 assert.equal(state.sorts.length,1);assert.equal(state.parses.length,2);state.draw();assert.equal(state.ready,0);assert.equal(state.renderers[0].cameras.length,0);assert.equal(state.host.dataset.roomEnvironmentState,'loading');
 const scene=state.sorts[0].scene;assert.equal(state.sorts[0].camera.position.z,.03);assert.ok(scene.background instanceof Three.Color);assert.ok(scene.environment instanceof Three.Texture);
 state.sorts[0].resolve();await flush();state.draw();assert.equal(state.host.dataset.roomEnvironmentProvider,'WorldLabs');assert.equal(state.host.dataset.roomEnvironmentState,'loading');assert.equal(state.ready,0);assert.equal(state.renderers[0].cameras.length,0);
 state.parses[0].resolve();await flush();state.draw();assert.equal(state.ready,0);assert.equal(state.renderers[0].cameras.length,0);
 state.parses[1].resolve();await flush();state.draw();assert.equal(state.ready,1);assert.equal(state.host.dataset.roomEnvironmentState,'ready');assert.equal(state.renderers[0].cameras.length,1);assert.ok(state.renderers[0].scene.background instanceof Three.Color);assert.equal(state.host.dataset.roomModelsReady,'2');
},{deferSort:true,deferParse:true,items:[item('first',{modelUrl:'/synthetic/first.glb'}),item('second',{modelUrl:'/synthetic/second.glb'})]}));

test('an already decoded studio still waits for its first Spark sort and does not spend display time',async()=>fixture(async state=>{
 for(let i=0;i<140;i++){state.scene.look(0);state.draw();}assert.equal(state.ready,0);assert.equal(state.host.dataset.roomModelsReady,'2');assert.equal(state.renderers[0].cameras.length,0);assert.equal(state.frames.size,0);
 state.sorts[0].resolve();await flush();state.draw();const visible=()=>state.renderers[0].scene.children.filter(value=>value.userData.collectionId&&value.visible).map(value=>value.userData.collectionId);
 assert.deepEqual(visible(),['first']);for(let i=0;i<109;i++)state.draw();assert.deepEqual(visible(),['first']);for(let i=0;i<3;i++)state.draw();assert.deepEqual(visible(),['second']);
},{deferSort:true,items:[item('first',{modelUrl:'/synthetic/first.glb'}),item('second',{modelUrl:'/synthetic/second.glb'})]}));

test('exit during the first Spark sort aborts downloads and prevents a late room reveal',async()=>fixture(async state=>{
 assert.equal(state.sorts.length,1);state.scene.destroy();assert.equal(state.environmentRequests.find(request=>request.url.endsWith('.spz')).options.signal.aborted,true);state.sorts[0].resolve();await flush();state.draw();
 assert.equal(state.ready,0);assert.equal(state.errors.length,0);assert.equal(state.splats[0].disposed,1);assert.equal(state.sparks[0].disposed,1);assert.equal(state.environmentBitmaps[0].closed,1);assert.equal(state.frames.size,0);assert.equal(state.timers.size,0);assert.equal(state.host.children.length,0);
},{deferSort:true}));

test('the initial Spark sort is included in the studio deadline and late completion cannot reopen it',async()=>fixture(async state=>{
 assert.equal(state.sorts.length,1);const timer=[...state.timers.entries()].find(([,value])=>value.delay===45000);assert.ok(timer);state.timers.delete(timer[0]);timer[1].callback();assert.equal(state.errors.length,1);assert.equal(state.ready,0);
 state.sorts[0].resolve();await flush();state.draw();assert.equal(state.errors.length,1);assert.equal(state.ready,0);assert.equal(state.splats[0].disposed,1);assert.equal(state.sparks[0].disposed,1);assert.equal(state.frames.size,0);assert.equal(state.timers.size,0);
},{deferSort:true}));

test('Spark sort failure cannot expose a panorama as if it were the 3D studio',async()=>fixture(async state=>{
 assert.equal(state.sorts.length,1);assert.equal(state.ready,0);assert.equal(state.errors.length,1);assert.equal(state.renderers[0].cameras.length,0);assert.equal(state.splats[0].disposed,1);assert.equal(state.frames.size,0);assert.equal(state.timers.size,0);
},{failSort:true}));

test('a failed panorama does not prevent the actual 3D studio from rendering with scene lights',async()=>fixture(async state=>{
 state.draw();assert.equal(state.ready,1);assert.equal(state.errors.length,0);assert.equal(state.host.dataset.roomEnvironmentProvider,'WorldLabs');assert.equal(state.renderers[0].scene.environment,null);assert.ok(state.renderers[0].scene.background instanceof Three.Color);assert.equal(state.sorts.length,1);
},{failPanorama:true}));

test('late panorama lighting never replaces the room background or changes its opening camera',async()=>fixture(async state=>{
 state.draw();assert.equal(state.ready,1);const renderer=state.renderers[0],scene=renderer.scene,background=scene.background,position=renderer.camera.position.clone(),rotation=renderer.camera.quaternion.clone(),fov=renderer.camera.fov;assert.equal(scene.environment,null);
 state.panoramaDecodes[0].resolve();await flush();state.draw();assert.ok(scene.environment instanceof Three.Texture);assert.equal(scene.background,background);assert.equal(state.ready,1);assert.equal(state.host.dataset.roomEnvironmentProvider,'WorldLabs');assert.ok(renderer.camera.position.equals(position));assert.ok(renderer.camera.quaternion.equals(rotation));assert.equal(renderer.camera.fov,fov);
},{deferPanorama:true,items:[item('gift',{modelUrl:'/synthetic/gift.glb'})]}));

test('mobile uses the supplied 100k world, bounded texture detail and one stable camera origin',async()=>fixture(async state=>{
 state.draw();assert.ok(state.environmentRequests.some(request=>request.url.endsWith('memory-studio-mobile.spz')));assert.equal(state.splats[0].input.maxSplats,100000);assert.equal(state.renderers[0].pixelRatio,1);assert.equal(state.models[0].texture.image.width,1024);
 const before=state.renderers[0].camera.position.clone();state.scene.select('gift');state.draw();for(let i=0;i<20;i++){state.scene.zoom(-100);state.scene.look(100);}state.draw();assert.ok(state.renderers[0].camera.position.equals(before));assert.ok(state.renderers[0].camera.fov>=24&&state.renderers[0].camera.fov<=80);assert.equal(state.frames.size,0);
},{width:390,height:844,reduced:true,largeTexture:true,items:[item('gift',{modelUrl:'/synthetic/gift.glb'})]}));

test('desktop retains 2048 texture detail and preserves original Tripo materials',async()=>fixture(async state=>{
 state.draw();assert.equal(state.models[0].texture.image.width,2048);assert.equal(state.models[0].texture.image.height,2048);assert.equal(state.models[0].material.color.getHexString(),'987654');assert.equal(state.models[0].bitmapClosed,1);
 assert.equal(state.models[0].material.roughness,1);assert.equal(state.models[0].root.rotation.y,-Math.PI/2);assert.equal(state.models[0].root.rotation.x,0);const size=new Three.Box3().setFromObject(state.models[0].root).getSize(new Three.Vector3());assert.ok(size.x<=.821&&size.y<=.621&&size.z<=.721);
},{largeTexture:true,flatPlace:true,items:[item('gift',{modelUrl:'/synthetic/gift.glb',objectRepresentation:'souvenir-miniature',modelYaw:-Math.PI/2})]}));

test('photos and loading previews remain DOM images and their object URLs expire on exit',async()=>fixture(async state=>{
 state.draw();const group=state.renderers[0].scene.children.find(value=>value.userData.collectionId==='first');assert.equal(group.children.length,0);assert.equal(group.userData.representation,'reference-photo-proxy');const preview=state.host.children.find(child=>child.className==='cr-asset-preview');assert.equal(preview.hidden,false);assert.equal(preview.children[0].hidden,false);assert.match(preview.children[0].src,/^blob:/);assert.equal(state.host.dataset.roomPhotosReady,'1');assert.ok(state.bitmaps.every(bitmap=>bitmap.closed===1));
 const url=preview.children[0].src;state.scene.destroy();assert.ok(state.revoked.includes(url));assert.equal(state.host.children.length,0);
},{items:[item('first',{imageUrl:'/synthetic/photo.png'})]}));

test('a failed real gift model keeps an honest image preview without creating replacement geometry',async()=>fixture(async state=>{
 state.draw();assert.equal(state.host.dataset.roomModelsFailed,'1');const group=state.renderers[0].scene.children.find(value=>value.userData.collectionId==='failed');assert.equal(group.children.length,0);assert.equal(group.userData.representation,'reference-photo-proxy');assert.equal(state.host.children.find(child=>child.className==='cr-asset-preview').hidden,false);
},{failModel:true,items:[item('failed',{imageUrl:'/synthetic/photo.png',modelUrl:'/synthetic/model.glb'})]}));

test('a pending Tripo model never shows a large photo card before becoming the real desk souvenir',async()=>fixture(async state=>{
 state.draw();const renderer=state.renderers[0],group=state.sparks[0].parent.children.find(value=>value.userData.collectionId==='gift'),preview=state.host.children.find(child=>child.className==='cr-asset-preview');
 assert.equal(state.ready,0);assert.equal(renderer.cameras.length,0);assert.equal(state.host.dataset.roomPhotosReady,'1');assert.equal(state.host.dataset.roomModelsReady,'0');assert.equal(preview.children[0].hidden,false);assert.equal(preview.hidden,true);assert.equal(group.userData.representation,'loading-real-model');assert.equal(group.children.length,0);assert.deepEqual(group.scale.toArray(),[1,1,1]);assert.match(state.host.children.find(child=>child.className==='cr-environment-state').textContent,/Opening your memory desk/);
 state.parses[0].resolve();await flush();state.draw();assert.equal(state.host.dataset.roomModelsReady,'1');assert.equal(group.children.length,1);assert.equal(preview.hidden,true);assert.equal(group.userData.representation,'cached-generated-model');assert.deepEqual(group.scale.toArray(),[1,1,1]);
},{deferParse:true,items:[item('gift',{imageUrl:'/synthetic/photo.png',modelUrl:'/synthetic/model.glb'})]}));

test('the first complete souvenir receives its whole display interval after every model has settled',async()=>fixture(async state=>{
 const visible=()=>state.sparks[0].parent.children.filter(value=>value.userData.collectionId&&value.visible).map(value=>value.userData.collectionId);
 state.draw();assert.deepEqual(visible(),['first']);assert.equal(state.parses.length,2);
 for(let i=0;i<140;i++){state.scene.look(0);state.draw();}assert.deepEqual(visible(),['first'],'Loading longer than 5.5s cannot select an undecoded gift');assert.equal(state.frames.size,0,'A pending model does not keep an idle animation loop running');
 state.parses[0].resolve();await flush();for(let i=0;i<140;i++){state.scene.look(0);state.draw();}assert.deepEqual(visible(),['first'],'The second pending model still prevents automatic replacement');
 state.parses[1].resolve();await flush();state.draw();for(let i=0;i<109;i++)state.draw();assert.deepEqual(visible(),['first'],'The readiness clock starts at zero');
 for(let i=0;i<3;i++)state.draw();assert.deepEqual(visible(),['second']);assert.equal(state.renderers[0].scene.children.filter(value=>value.userData.collectionId&&value.visible).length,1);
 for(const group of state.renderers[0].scene.children.filter(value=>value.userData.collectionId))assert.deepEqual(group.scale.toArray(),[1,1,1],'The physical gift scale never grows or shrinks');
 for(const model of state.models){assert.equal(model.material.opacity,1);assert.equal(model.material.transparent,false);assert.equal(model.material.color.getHexString(),'987654');}
 state.scene.setPlaying(false);state.scene.step(-1);state.draw();assert.deepEqual(visible(),['first']);state.scene.select('first');state.draw();state.scene.reset();state.settle();assert.deepEqual(visible(),['first']);assert.equal(state.frames.size,0);
},{deferParse:true,items:[item('first',{modelUrl:'/synthetic/first.glb'}),item('second',{modelUrl:'/synthetic/second.glb'})]}));

test('a model decode deadline exposes its photo fallback and disposes a late model without a size transition',async()=>fixture(async state=>{
 state.draw();const preview=state.host.children.find(child=>child.className==='cr-asset-preview');assert.equal(preview.hidden,true);
 const deadline=[...state.timers.entries()].find(([,timer])=>timer.delay===45000);assert.ok(deadline);state.timers.delete(deadline[0]);deadline[1].callback();state.draw();
 assert.equal(state.host.dataset.roomModelsFailed,'1');assert.equal(preview.hidden,false);const group=state.renderers[0].scene.children.find(value=>value.userData.collectionId==='gift');assert.deepEqual(group.scale.toArray(),[1,1,1]);assert.equal(group.children.length,0);
 state.parses[0].resolve();await flush();state.draw();assert.equal(state.host.dataset.roomModelsReady,'0');assert.equal(preview.hidden,false);assert.equal(state.models[0].geometryDisposed,1);assert.equal(state.models[0].materialDisposed,1);
},{deferParse:true,items:[item('gift',{imageUrl:'/synthetic/photo.png',modelUrl:'/synthetic/model.glb'})]}));

test('loaded gifts do not consume shuffle time while the actual studio is still decoding',async()=>fixture(async state=>{
 for(let i=0;i<140;i++){state.scene.look(0);state.draw();}assert.equal(state.ready,0);assert.equal(state.host.dataset.roomModelsReady,'2');
 state.worldDecodes[0].resolve();await flush();state.draw();const groups=()=>state.renderers[0].scene.children.filter(value=>value.userData.collectionId&&value.visible).map(value=>value.userData.collectionId);
 for(let i=0;i<109;i++)state.draw();assert.deepEqual(groups(),['first']);for(let i=0;i<3;i++)state.draw();assert.deepEqual(groups(),['second']);
},{deferWorld:true,failPanorama:true,items:[item('first',{modelUrl:'/synthetic/first.glb'}),item('second',{modelUrl:'/synthetic/second.glb'})]}));

test('scene preserves the six-gift limit, selection, pointer capture and bounded drag without accidental clicking',async()=>fixture(async state=>{
 state.draw();assert.equal(state.projects.at(-1).length,6);assert.ok(state.projects.at(-1).every(point=>Number.isFinite(point.x+point.y)));const point=state.projects.at(-1).find(value=>value.visible);
 state.pointer('pointerdown',point.x,point.y);assert.equal(state.renderers[0].domElement.hasPointerCapture(1),true);state.pointer('pointerup',point.x,point.y);assert.deepEqual(state.selected,[point.id]);assert.equal(state.renderers[0].domElement.hasPointerCapture(1),false);state.settle();assert.equal(state.frames.size,0);
 state.pointer('pointerdown',point.x,point.y);state.pointer('pointermove',point.x+40,point.y);state.pointer('pointerup',point.x+40,point.y);state.settle();assert.equal(state.selected.length,1);assert.equal(state.frames.size,0);
},{items:Array.from({length:9},(_,i)=>item(String(i),{modelUrl:'/synthetic/'+i+'.glb'}))}));

test('keyboard browsing, zoom and reset remain available with reduced motion',async()=>fixture(async state=>{
 state.draw();const canvas=state.renderers[0].domElement,key=value=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{key:value,code:value===' '?'Space':value,repeat:false});canvas.dispatchEvent(event);state.draw();};key('ArrowRight');assert.ok(state.renderers[0].scene.children.find(value=>value.userData.collectionId==='second').visible);assert.equal(state.frames.size,0);const before=state.renderers[0].camera.fov;key('+');assert.ok(state.renderers[0].camera.fov<=before);key('r');assert.equal(state.frames.size,0);key(' ');assert.equal(state.frames.size,0);
},{reduced:true}));

test('the single frame gate caps playback, suspends on hidden/blur and resumes without shuffle catchup',async()=>fixture(async state=>{
 state.draw();const count=state.renderers[0].cameras.length;state.draw(10);assert.equal(state.renderers[0].cameras.length,count);state.draw(40);assert.equal(state.renderers[0].cameras.length,count+1);
 state.window.dispatchEvent(new Event('blur'));assert.equal(state.frames.size,0);state.document.visibilityState='hidden';state.document.dispatchEvent(new Event('visibilitychange'));state.document.visibilityState='visible';state.document.dispatchEvent(new Event('visibilitychange'));assert.equal(state.frames.size,0);state.now+=60000;state.window.dispatchEvent(new Event('focus'));state.draw();assert.equal(state.renderers[0].scene.children.find(value=>value.userData.collectionId==='first').visible,true);
 state.scene.setPlaying(false);state.settle();assert.equal(state.frames.size,0);state.scene.destroy();state.window.dispatchEvent(new Event('focus'));assert.equal(state.frames.size,0);
}));

test('local autoplay changes the central gift; pause and manual stepping keep a still scene',async()=>fixture(async state=>{
 state.draw();for(let i=0;i<115;i++)state.draw();state.scene.setPlaying(false);state.settle();const groups=state.renderers[0].scene.children.filter(value=>value.userData.collectionId),current=groups.find(value=>value.visible);assert.ok(current);assert.notEqual(current.userData.collectionId,'first');assert.equal(groups.filter(value=>value.visible).length,1);assert.equal(state.frames.size,0);state.scene.step(1);state.settle();assert.notEqual(groups.find(value=>value.visible).userData.collectionId,current.userData.collectionId);assert.equal(state.frames.size,0);
}));

test('two GLB jobs maximum and decoded gifts arriving after exit release their owned data',async()=>fixture(async state=>{
 assert.equal(state.parses.length,2);assert.equal(state.maxParses,2);state.scene.destroy();for(const plan of state.parses)plan.resolve();await flush();assert.ok(state.models.every(value=>value.geometryDisposed===1&&value.materialDisposed===1&&value.bitmapClosed===1));assert.equal(state.frames.size,0);assert.equal(state.timers.size,0);
},{deferParse:true,largeTexture:true,items:[item('one',{modelUrl:'/synthetic/one.glb'}),item('two',{modelUrl:'/synthetic/two.glb'}),item('three',{modelUrl:'/synthetic/three.glb'})]}));

test('expired gift media is not fetched and context loss publishes one honest fallback',async()=>fixture(async state=>{
 state.draw();assert.equal(state.requests.length,0);const canvas=state.renderers[0].domElement;canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));assert.equal(state.errors.length,1);assert.match(state.errors[0],/photos and gift stories/);assert.equal(state.timers.size,0);assert.equal(state.frames.size,0);
},{items:[item('expired',{modelUrl:'/synthetic/expired.glb',imageUrl:'/synthetic/photo.png',mediaExpiresAt:1})]}));

test('gift expiry removes the actual model and DOM photo while keeping the completed studio',async()=>{
 const expiry=Date.now()/1000+10;await fixture(async state=>{
  state.draw();const timer=[...state.timers.entries()].find(([,value])=>value.delay<11000),previous=Date.now;assert.ok(timer);try{Date.now=()=>expiry*1000+1;state.timers.delete(timer[0]);timer[1].callback();assert.equal(state.host.dataset.roomModelsReady,'0');assert.equal(state.host.dataset.roomPhotosReady,'0');assert.equal(state.models[0].geometryDisposed,1);assert.equal(state.host.dataset.roomEnvironmentProvider,'WorldLabs');assert.equal(state.revoked.length,1);}finally{Date.now=previous;}
 },{items:[item('timed',{modelUrl:'/synthetic/timed.glb',imageUrl:'/synthetic/photo.png',mediaExpiresAt:expiry})]});
});

test('environment configuration aligns the supplied asset and gift anchor without adding room geometry',async()=>fixture(async state=>{
 state.draw();const group=state.renderers[0].scene.children.find(value=>value.userData.collectionId==='first');assert.deepEqual(group.position.toArray(),[1,-.6,-2]);assert.deepEqual(state.renderers[0].camera.position.toArray(),[.2,0,.4]);assert.deepEqual(state.splats[0].position.toArray(),[0,1.24,0]);assert.equal(state.splats[0].scale.x,1.16);assert.equal(state.renderers[0].scene.environmentRotation.y,.2);assert.equal(state.renderers[0].scene.backgroundRotation.y,0);assert.ok(state.renderers[0].scene.background instanceof Three.Color);
},{environment:{cameraPosition:[.2,0,.4],cameraTarget:[0,-.2,-3],objectPosition:[1,-.6,-2],worldScale:1.16,worldPosition:[0,1.24,0],panoramaYaw:.2}}));

test('fair shuffle visits every gift per bag and prevents an adjacent duplicate',async()=>fixture(async state=>{
 const desk=state.module.createDeskShuffle(4),values=[];for(let i=0;i<24;i++)values.push(state.module.deskShuffleNext(desk,()=>.42));for(let i=1;i<values.length;i++)assert.notEqual(values[i],values[i-1]);for(let i=0;i<values.length;i+=4)assert.equal(new Set(values.slice(i,i+4)).size,4);const one=state.module.createDeskShuffle(1);assert.equal(state.module.deskShuffleNext(one),0);assert.equal(state.module.deskShuffleAdvance(desk,10,false,false),false);assert.equal(state.module.deskShuffleAdvance(desk,10,true,true),false);
}));

test('GLB guards accept real cached sponsor models and reject external or excessive decode resources',async()=>fixture(async state=>{
 for(const path of ['rio-keepsake.glb','v13/paris-model.glb','v17/paris-model.glb','v13/antikythera-model.glb'])state.module.validateCollectionGLB(new Uint8Array(await readFile(new URL('../public/demo/'+path,import.meta.url))));
 for(const path of ['brass-travel-frame.glb','leather-travel-journal.glb','brass-travel-frame-mobile.glb','leather-travel-journal-mobile.glb'])state.module.validateCollectionGLB(new Uint8Array(await readFile(new URL('../public/assets/v10/props/'+path,import.meta.url))));
 for(const document of [{buffers:[{uri:'https://external.invalid/file.bin',byteLength:0}]},{images:[{uri:'https://external.invalid/image.png'}]},{nodes:Array(257).fill({})},{accessors:[{count:2_000_001}]},{extensionsRequired:['KHR_draco_mesh_compression']}])assert.throws(()=>state.module.validateCollectionGLB(glb(document)));
}));
