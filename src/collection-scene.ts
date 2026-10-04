import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

import { createFrameGate, fetchViewerBytes, observeViewerVisibility, viewerAssetUrl, viewerPixelRatio, VIEWER_LOAD_TIMEOUT } from './viewer-runtime';
import { createCollectionConveyor, conveyorSetPlaying, conveyorSetReduced } from './collection-conveyor';
import { mountCollectionProps, type CollectionPropConfig, type CollectionPropsHandle } from './collection-props';
import {mountCollectionShadows,type CollectionShadowsHandle} from './collection-shadows';
import type { CollectionRoomItem, CollectionProjection, CollectionSceneOptions, CollectionSceneHandle, CollectionMood } from './collection-types';

const MAX_ITEMS = 6, MAX_MODEL_VERTICES = 500_000, MAX_IMAGE_PIXELS = 16_777_216;
const clamp = THREE.MathUtils.clamp;
export const COLLECTION_MOBILE_BREAKPOINT = 750;
export interface CollectionMobileFraming { topInset?: number; bottomInset?: number; heroWidthFraction?: number }
export function collectionMobileViewport(width:number,height:number,input:CollectionMobileFraming={}) {
 const h=Number.isFinite(height)&&height>0?height:1,w=Number.isFinite(width)&&width>0?width:1;
 const top=clamp(Number.isFinite(input.topInset)?input.topInset!:190,0,h*.4),bottom=clamp(Number.isFinite(input.bottomInset)?input.bottomInset!:165,0,h*.35);
 return {width:w,height:h,top,bottom,centerY:top+(h-top-bottom)/2,heightFraction:(h-top-bottom)/h,widthFraction:clamp(Number.isFinite(input.heroWidthFraction)?input.heroWidthFraction!:.56,.35,.78)};
}
/** The desk owns this sharper raster budget; other viewers keep their limits. */
export function collectionPixelRatio(density:number,width:number,height:number):number {
 const w=Number.isFinite(width)&&width>0?width:1,h=Number.isFinite(height)&&height>0?height:1;
 if(w>COLLECTION_MOBILE_BREAKPOINT)return viewerPixelRatio('place',density,w);
 const physical=Number.isFinite(density)&&density>0?density:1,area=w*h;
 return Math.min(physical,2,Math.max(1,Math.sqrt(1_100_000/area)));
}
/** Fits the actual imported GLB bounds, including depth, into the useful screen.
 * Camera/anchor coordinates come from the supplied environment calibration. */
export function collectionHeroFraming(input:CollectionMobileFraming & {width:number;height:number;cameraPosition:readonly[number,number,number];cameraTarget:readonly[number,number,number];min:readonly[number,number,number];max:readonly[number,number,number]}) {
 const layout=collectionMobileViewport(input.width,input.height,input),aspect=layout.width/layout.height,camera=new THREE.PerspectiveCamera(60,aspect,.05,150);
 camera.position.set(...input.cameraPosition);camera.lookAt(new THREE.Vector3(...input.cameraTarget));camera.updateMatrixWorld(true);
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(const x of[input.min[0],input.max[0]])for(const y of[input.min[1],input.max[1]])for(const z of[input.min[2],input.max[2]]){
  const point=new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse),depth=-point.z;
  if(!Number.isFinite(depth)||depth<=.05)return{...layout,fieldOfView:80,minFieldOfView:80};
  minX=Math.min(minX,point.x/depth);maxX=Math.max(maxX,point.x/depth);minY=Math.min(minY,point.y/depth);maxY=Math.max(maxY,point.y/depth);
 }
 const fov=(horizontal:number,vertical:number)=>clamp(THREE.MathUtils.radToDeg(2*Math.atan(Math.max((maxX-minX)/(2*aspect*horizontal),(maxY-minY)/(2*vertical)))),16,80);
 return{...layout,fieldOfView:fov(layout.widthFraction,layout.heightFraction*.88),minFieldOfView:fov(.78,layout.heightFraction*.98)};
}
/** Keep the calibrated desktop view inside 52 horizontal degrees. A larger
 * real model's required fit takes precedence over that composition limit. */
export function collectionDesktopFieldOfView(aspect:number,preferred:number,required:number,selected=false,zoomOffset=0){
 const ratio=Number.isFinite(aspect)&&aspect>0?Math.max(.2,aspect):1;
 const cap=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(26))/ratio)),base=Math.min(preferred,cap);
 const minimum=Math.max(Math.min(24,base),required),maximum=Math.max(cap,minimum);
 return clamp(Math.max(selected?base*.82:base,required)+zoomOffset,minimum,maximum);
}
export interface DeskShuffle { count:number; current:number; bag:number[]; elapsed:number }
export function createDeskShuffle(count:number):DeskShuffle { count=Number.isFinite(count)?Math.min(6,Math.max(0,Math.floor(count))):0;return {count,current:0,bag:[],elapsed:0}; }
export function deskShuffleNext(state:DeskShuffle,random:()=>number=Math.random):number {
 if(state.count<2)return state.current=0;
 if(!state.bag.length){state.bag=Array.from({length:state.count},(_,i)=>i);for(let i=state.count-1;i>0;i--){const value=random(),j=Math.floor((Number.isFinite(value)?clamp(value,0,.999999):0)*(i+1));[state.bag[i],state.bag[j]]=[state.bag[j],state.bag[i]];}}
 if(state.bag[0]===state.current&&state.bag.length>1)[state.bag[0],state.bag[1]]=[state.bag[1],state.bag[0]];
 // A last remaining current item can follow an explicit manual selection; use
 // a fresh bag, preserving no-adjacent-repeat behavior rather than replay it.
 if(state.bag.length===1&&state.bag[0]===state.current){state.bag=[];return deskShuffleNext(state,random);}
 return state.current=state.bag.shift()!;
}
export function deskShuffleAdvance(state:DeskShuffle,delta:number,playing:boolean,reduced:boolean):boolean {
 if(!playing||reduced||state.count<2)return false;state.elapsed+=Number.isFinite(delta)?clamp(delta,0,.05):0;
 if(state.elapsed<5.5)return false;state.elapsed=0;deskShuffleNext(state);return true;
}
const expired = (item: CollectionRoomItem) => typeof item.mediaExpiresAt === 'number' && item.mediaExpiresAt > 0 && item.mediaExpiresAt <= Date.now() / 1000;
export function collectionSceneItems(items: readonly CollectionRoomItem[]): CollectionRoomItem[] {
 const ids = new Set<string>();
 return items.filter(item => item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 128 && !ids.has(item.id) && (ids.add(item.id), true)).slice(0, MAX_ITEMS);
}
function imageDimensions(bytes: Uint8Array): [number, number] {
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
 if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(12) === 0x49484452) return [view.getUint32(16), view.getUint32(20)];
 if (bytes[0] === 0xff && bytes[1] === 0xd8) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
   if (bytes[offset++] !== 0xff) break;
   let marker = bytes[offset++]; while (marker === 0xff && offset < bytes.length) marker = bytes[offset++];
   if (marker === 0xd9 || marker === 0xda) break;
   if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
   const length = view.getUint16(offset); if (length < 2 || offset + length > bytes.length) break;
   if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
   offset += length;
  }
 }
 if (bytes.length >= 30 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
  const kind = String.fromCharCode(...bytes.subarray(12, 16));
  if (kind === 'VP8X') return [1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)];
  if (kind === 'VP8 ') return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
  if (kind === 'VP8L' && bytes[20] === 0x2f) { const bits = view.getUint32(21, true); return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]; }
 }
 throw new Error('ROOM_IMAGE_INVALID');
}
function boundedImage(bytes: Uint8Array): [number, number] {
 const size = imageDimensions(bytes);
 if (!size.every(value => Number.isInteger(value) && value > 0 && value <= 8192) || size[0] * size[1] > MAX_IMAGE_PIXELS) throw new Error('ROOM_IMAGE_LIMIT');
 return size;
}
/** Reject external GLTF resources and oversized decode work before invoking its loader. */
export function validateCollectionGLB(bytes: Uint8Array): void {
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
 if (bytes.byteLength < 28 || bytes.byteLength > 25 * 1024 * 1024 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('ROOM_MODEL_INVALID');
 const jsonLength = view.getUint32(12, true);
 if (jsonLength > 1024 * 1024 || jsonLength < 2 || 20 + jsonLength + 8 > bytes.length) throw new Error('ROOM_MODEL_INVALID');
 const data = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as { asset?: {version?: string}; buffers?: {uri?: string; byteLength: number}[]; images?: {uri?: string; bufferView?: number}[]; bufferViews?: {buffer: number; byteOffset?: number; byteLength: number}[]; accessors?: {count: number}[]; nodes?: unknown[]; extensionsRequired?: string[] };
 const binaryStart = 20 + jsonLength, binaryLength = view.getUint32(binaryStart, true);
 if (view.getUint32(binaryStart + 4, true) !== 0x004e4942 || binaryStart + 8 + binaryLength !== bytes.length || data.asset?.version !== '2.0' || data.buffers?.length !== 1 || data.buffers[0].uri !== undefined || data.buffers[0].byteLength > binaryLength || !Number.isInteger(data.buffers[0].byteLength) || (data.nodes?.length || 0) > 256 || (data.images?.length || 0) > 8 || data.extensionsRequired?.length) throw new Error('ROOM_MODEL_INVALID');
 let accessors = 0, pixels = 0;
 for (const accessor of data.accessors || []) { if (!Number.isInteger(accessor.count) || accessor.count < 0 || accessor.count > 1_000_000) throw new Error('ROOM_MODEL_LIMIT'); accessors += accessor.count; }
 if (accessors > 2_000_000) throw new Error('ROOM_MODEL_LIMIT');
 for (const image of data.images || []) {
  const resource = data.bufferViews?.[image.bufferView ?? -1], offset = resource?.byteOffset || 0;
  if (image.uri !== undefined || !resource || resource.buffer !== 0 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(resource.byteLength) || resource.byteLength < 1 || offset + resource.byteLength > binaryLength) throw new Error('ROOM_MODEL_INVALID');
  const dimensions = boundedImage(bytes.subarray(binaryStart + 8 + offset, binaryStart + 8 + offset + resource.byteLength)); pixels += dimensions[0] * dimensions[1];
 }
 if (pixels > 64 * 1024 * 1024) throw new Error('ROOM_MODEL_LIMIT');
}

export interface CollectionEnvironmentConfig {
 worldUrl: string; mobileWorldUrl: string; panoramaUrl: string;
 cameraPosition: readonly [number, number, number]; cameraTarget: readonly [number, number, number];
 objectPosition: readonly [number, number, number]; objectSize: readonly [number, number, number];
 worldPosition: readonly [number, number, number]; worldRotation: readonly [number, number, number];
 worldScale: number; fieldOfView: number; panoramaYaw: number;
 /** Optional receiver derived from this world's provider collider. */
 shadowReceiverUrl?:string|null;
 mobile?: CollectionMobileFraming & {cameraPosition?:readonly[number,number,number];cameraTarget?:readonly[number,number,number];objectPosition?:readonly[number,number,number];objectSize?:readonly[number,number,number]};
}
/** All coordinates are Three Y-up scene units after the World Labs export flip.
 * Calibrate these values against the completed world, never an invented desk. */
export const DEFAULT_COLLECTION_ENVIRONMENT: CollectionEnvironmentConfig = {
 worldUrl: '/assets/daylight-desk/world-500k.spz', mobileWorldUrl: '/assets/daylight-desk/world-100k.spz', panoramaUrl: '/assets/daylight-desk/lighting.webp',
 cameraPosition: [0, 0, .03], cameraTarget: [-.20, -.30, -2.8], objectPosition: [-.10, -.271, -1.12], objectSize: [.36, .30, .32],
 worldPosition: [0, 0, 0], worldRotation: [Math.PI, 0, 0], worldScale: 1, fieldOfView: 30, panoramaYaw: 0,
 shadowReceiverUrl:'/assets/daylight-desk/shadow-receiver.glb',
 mobile: {topInset:190,bottomInset:165,heroWidthFraction:.78,objectSize:[.48,.40,.43],cameraPosition:[-.05,-.05,.03]},
};
/** Independent sponsor-generated meshes, supported by the World Labs desktop. */
export const DEFAULT_COLLECTION_PROPS: readonly CollectionPropConfig[] = [
 {id: 'photo-frame', modelUrl: '/assets/v10/props/brass-travel-frame.glb', position: [.10, -.282, -1.08], rotation: [0, -Math.PI / 2, 0], maxBounds: [.16, .20, .115]},
 {id: 'travel-journal', modelUrl: '/assets/v10/props/leather-travel-journal.glb', position: [-.20, -.3163, -.80], rotation: [0, -Math.PI / 2, 0], maxBounds: [.16, .055, .145]},
];
export function collectionEnvironmentConfig(input: Partial<CollectionEnvironmentConfig> = {}): CollectionEnvironmentConfig {
 const base = DEFAULT_COLLECTION_ENVIRONMENT;
 const vector = (value: readonly [number, number, number] | undefined, fallback: readonly [number, number, number], positive = false): readonly [number, number, number] => Array.isArray(value) && value.length === 3 && value.every(n => Number.isFinite(n) && (positive ? n > 0 && n <= 50 : Math.abs(n) <= 500)) ? [value[0], value[1], value[2]] : fallback;
 const scalar = (value: number | undefined, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
 const cameraPosition=vector(input.cameraPosition,base.cameraPosition),cameraTarget=vector(input.cameraTarget,base.cameraTarget),objectPosition=vector(input.objectPosition,base.objectPosition),objectSize=vector(input.objectSize,base.objectSize,true);
 const mobileBase=base.mobile,mobileInput=mobileBase||input.mobile?{...mobileBase,...input.mobile}:undefined;
 const mobileVector=(name:'cameraPosition'|'cameraTarget'|'objectPosition'|'objectSize',fallback:readonly[number,number,number],positive=false)=>mobileInput?.[name]===undefined?undefined:vector(mobileInput[name],vector(mobileBase?.[name],fallback,positive),positive);
 return {worldUrl: input.worldUrl || base.worldUrl, mobileWorldUrl: input.mobileWorldUrl || base.mobileWorldUrl, panoramaUrl: input.panoramaUrl || base.panoramaUrl,
  shadowReceiverUrl:input.shadowReceiverUrl===undefined?(input.worldUrl&&input.worldUrl!==base.worldUrl?null:base.shadowReceiverUrl):input.shadowReceiverUrl,
  cameraPosition,cameraTarget,objectPosition,objectSize,
  worldPosition: vector(input.worldPosition, base.worldPosition), worldRotation: vector(input.worldRotation, base.worldRotation), worldScale: scalar(input.worldScale, base.worldScale, .05, 100), fieldOfView: scalar(input.fieldOfView, base.fieldOfView, 30, 80), panoramaYaw: scalar(input.panoramaYaw, base.panoramaYaw, -Math.PI, Math.PI),
  ...(mobileInput?{mobile:{cameraPosition:mobileVector('cameraPosition',cameraPosition),cameraTarget:mobileVector('cameraTarget',cameraTarget),objectPosition:mobileVector('objectPosition',objectPosition),objectSize:mobileVector('objectSize',objectSize,true),
   topInset:scalar(mobileInput.topInset,scalar(mobileBase?.topInset,190,0,500),0,500),bottomInset:scalar(mobileInput.bottomInset,scalar(mobileBase?.bottomInset,165,0,500),0,500),heroWidthFraction:scalar(mobileInput.heroWidthFraction,scalar(mobileBase?.heroWidthFraction,.56,.35,.78),.35,.78)}}:{})};
}
interface ConveyorItem {
 item: CollectionRoomItem; group: THREE.Group; proxy: HTMLButtonElement; image: HTMLImageElement; label: HTMLSpanElement;
 anchor: THREE.Vector3; index: number; photoUrl?: string; model?: THREE.Object3D; controller: AbortController; timer?: ReturnType<typeof setTimeout>;
 modelFrame?: {size:THREE.Vector3;center:THREE.Vector3;minY:number;scale:THREE.Vector3};
}
/** Renders a completed World Labs studio and real Tripo gifts. No room furniture,
 * decorative props, gift stand-ins or painted room textures are authored here. */
export function mountCollectionScene(host: HTMLElement, options: CollectionSceneOptions & {environment?: Partial<CollectionEnvironmentConfig>; props?: readonly CollectionPropConfig[]}): CollectionSceneHandle {
 const config = collectionEnvironmentConfig(options.environment), items = collectionSceneItems(options.items), scene = new THREE.Scene();
 const camera = new THREE.PerspectiveCamera(config.fieldOfView, 1, .05, 150), cameraHome = new THREE.Vector3(...config.cameraPosition);
 const target = new THREE.Vector3(...config.cameraTarget), wantedTarget = target.clone(), objectOrigin = new THREE.Vector3(...config.objectPosition);
 const mobile=()=>innerWidth<=COLLECTION_MOBILE_BREAKPOINT,objectSize=()=>mobile()&&config.mobile?.objectSize||config.objectSize;
 const modelSource=(item:CollectionRoomItem)=>mobile()&&item.mobileModelUrl||item.modelUrl;
 const events = new AbortController(), downloads = new AbortController(), motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
 const slots: ConveyorItem[] = [], deadlines = new Set<ReturnType<typeof setTimeout>>(), failedModels = new Set<string>(), disposedSplats = new WeakSet<SplatMesh>();
 const pendingModels = new Set(items.filter(item => modelSource(item) && !expired(item)).map(item => item.id));
 const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), belt = createCollectionConveyor(items.length, motion?.matches ?? false), desk = createDeskShuffle(items.length);
 let dead = false, unavailable = false, announced = false, reduced = motion?.matches ?? false, selected: string | null = null, hovered: string | null = null;
 let renderer: THREE.WebGLRenderer | undefined, spark: SparkRenderer | undefined, splats: SplatMesh | undefined, panorama: THREE.Texture | undefined, panoramaBitmap: ImageBitmap | undefined;
 let gate: ReturnType<typeof createFrameGate> | undefined, stopVisibility: (() => void) | undefined, observer: ResizeObserver | undefined;
 let worldReady = false, propsReady = false, blurred = false, props: CollectionPropsHandle | undefined;
 let shadows:CollectionShadowsHandle|undefined;
 let width = 1, height = 1, yaw = 0, wantedYaw = 0, zoomOffset = 0, fieldOfView = config.fieldOfView, wantedFov = fieldOfView, lastFrame: number | null = null;
 let shownId:string|undefined;
 let pointer: {id: number; x: number; y: number; startX: number; startY: number; dragged: boolean} | undefined;
 const active = () => !dead && host.isConnected && options.isCurrent();
 const status = document.createElement('div'); status.className = 'cr-environment-state'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); host.append(status);
 const keyLight = new THREE.DirectionalLight('#fff4e3', 1.6), fillLight = new THREE.HemisphereLight('#edf1f5', '#4b4034', .45); keyLight.position.set(-2, 4, 1); scene.add(keyLight, fillLight);
 scene.background = new THREE.Color('#101c2b'); camera.position.copy(cameraHome); camera.lookAt(target);
 function diagnostics() {
  if (dead) return;
  host.dataset.roomModelsReady = String(slots.filter(slot => !!slot.model && !expired(slot.item)).length); host.dataset.roomModelsFailed = String(failedModels.size); host.dataset.roomPhotosReady = String(slots.filter(slot => !!slot.photoUrl && !expired(slot.item)).length);
 }
 function settleModel(slot: ConveyorItem) {
  if (!active() || !pendingModels.delete(slot.item.id)) return;
  // Loading time never consumes the first gift's display time.
  desk.elapsed = 0; lastFrame = null; if(mobile()){resetAim();wantedFov=focusFov();if(!announced){fieldOfView=wantedFov;target.copy(wantedTarget);camera.position.copy(cameraHome);camera.lookAt(target);camera.fov=fieldOfView;camera.updateProjectionMatrix();}}environmentState(); invalidate();
 }
 function modelFailed(slot: ConveyorItem) {
  if (!active() || !modelSource(slot.item) || slot.model || expired(slot.item)) return;
  failedModels.add(slot.item.id); slot.group.userData.representation = 'reference-photo-proxy';
  slot.label.textContent = slot.photoUrl ? slot.item.title : 'Preview unavailable'; diagnostics(); settleModel(slot); invalidate();
 }
 function environmentState() {
  if (dead) return;
  host.dataset.roomEnvironmentProvider = worldReady ? 'WorldLabs' : 'pending';
  host.dataset.roomEnvironmentState = worldReady && propsReady && pendingModels.size === 0 ? 'ready' : 'loading';
  status.textContent = worldReady ? pendingModels.size || !propsReady ? 'Opening your memory desk…' : 'Your memory desk · 3D' : 'Opening your memory desk…';
 }
 function invalidate() { if (active()) gate?.request(); }
 function textureMaterials(root: THREE.Object3D) {
  const gs = new Set<THREE.BufferGeometry>(), ms = new Set<THREE.Material>(), ts = new Set<THREE.Texture>();
  root.traverse(object => { if (object instanceof THREE.Mesh) { gs.add(object.geometry); for (const value of Array.isArray(object.material) ? object.material : [object.material]) { ms.add(value); for (const field of Object.values(value)) if (field instanceof THREE.Texture) ts.add(field); } if (object instanceof THREE.SkinnedMesh && object.skeleton.boneTexture) ts.add(object.skeleton.boneTexture); } }); return {gs, ms, ts};
 }
 function disposeModel(root: THREE.Object3D) {
  const {gs, ms, ts} = textureMaterials(root), closed = new Set<unknown>();
  for (const value of ts) { const image = value.image as {close?(): void} | undefined; if (image?.close && !closed.has(image)) { closed.add(image); image.close(); } value.dispose(); } gs.forEach(value => value.dispose()); ms.forEach(value => value.dispose()); root.clear();
 }
 function disposeSplat(value: SplatMesh) { if (disposedSplats.has(value)) return; disposedSplats.add(value); try { value.dispose(); } catch { /* Partial decoder initialization may have failed. */ } }
 function releasePointer() { if (!pointer) return; const id = pointer.id; pointer = undefined; try { if (renderer?.domElement.hasPointerCapture(id)) renderer.domElement.releasePointerCapture(id); } catch {} }
 function destroy() {
  if (dead) return; dead = true; downloads.abort(); events.abort(); releasePointer(); gate?.destroy(); stopVisibility?.(); observer?.disconnect(); motion?.removeEventListener('change', motionChanged); shadows?.destroy();props?.destroy();
  for (const timer of deadlines) clearTimeout(timer); deadlines.clear();
  for (const slot of slots) { clearTimeout(slot.timer); slot.controller.abort(); if (slot.model) disposeModel(slot.model); if (slot.photoUrl) URL.revokeObjectURL(slot.photoUrl); slot.image.removeAttribute('src'); slot.proxy.remove(); }
  if (splats) disposeSplat(splats); try { spark?.dispose(); } catch {} scene.environment = null; scene.background = null; panorama?.dispose(); panoramaBitmap?.close(); panorama = undefined; panoramaBitmap = undefined;
  renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove(); scene.clear(); status.remove(); host.style.cursor = '';
  for (const name of ['roomModelsReady', 'roomModelsFailed', 'roomPhotosReady', 'roomEnvironmentProvider', 'roomEnvironmentState', 'roomEnvironmentBudget', 'roomPropsReady', 'roomPropsFailed', 'roomPixelRatio', 'roomComposition','roomShadows']) delete host.dataset[name];
 }
 function fail(message: string) { if (dead || unavailable) return; unavailable = true; destroy(); options.onUnavailable(message); }
 async function environmentJob(work: (signal: AbortSignal) => Promise<void>, failed: () => void) {
  const controller = new AbortController(), abort = () => controller.abort(); downloads.signal.addEventListener('abort', abort, {once: true});
  let reported = false; const report = () => { if (!reported && active()) { reported = true; failed(); } };
  const timer = setTimeout(() => { abort(); report(); }, VIEWER_LOAD_TIMEOUT); deadlines.add(timer);
  try { await work(controller.signal); } catch { report(); } finally { clearTimeout(timer); deadlines.delete(timer); downloads.signal.removeEventListener('abort', abort); }
 }
 async function loadWorldAsset(url:string,budget:100000|500000,signal:AbortSignal) {
  const source = viewerAssetUrl(url, location.origin), bytes = await fetchViewerBytes(source.href, signal);
  signal.throwIfAborted(); if (!active()) return;
  const value = new SplatMesh({fileBytes: bytes, fileName: 'memory-studio.spz', maxSplats: budget, editable: false, raycastable: false}); splats = value;
  value.rotation.set(...config.worldRotation); value.position.set(...config.worldPosition); value.scale.setScalar(config.worldScale); value.name = 'World Labs memory studio'; scene.add(value);
  try{await value.initialized;
  if (!active() || signal.aborted) { scene.remove(value); disposeSplat(value); if (splats === value) splats = undefined; if (signal.aborted) throw new Error('ROOM_WORLD_TIMEOUT'); return; }
  // Decoded splats still need their first GPU update and sort. Keep the opening
  // screen until Spark can render the actual room synchronously.
  if (!spark) throw new Error('ROOM_WORLD_RENDERER_UNAVAILABLE');
  scene.updateMatrixWorld(true); camera.updateMatrixWorld();
  await spark.update({scene, camera});
  if (!active() || signal.aborted) { scene.remove(value); disposeSplat(value); if (splats === value) splats = undefined; if (signal.aborted) throw new Error('ROOM_WORLD_TIMEOUT'); return; }
  worldReady = true; desk.elapsed = 0; lastFrame = null; host.dataset.roomEnvironmentBudget = String(budget); environmentState(); invalidate();
  }catch(error){scene.remove(value);disposeSplat(value);if(splats===value)splats=undefined;throw error;}
 }
 async function loadWorld(signal: AbortSignal) {
  try{await loadWorldAsset(config.worldUrl,500000,signal);}
  catch(error){if(!mobile()||config.mobileWorldUrl===config.worldUrl||signal.aborted||!active())throw error;await loadWorldAsset(config.mobileWorldUrl,100000,signal);}
 }
 async function loadPanorama(signal: AbortSignal) {
  const source = viewerAssetUrl(config.panoramaUrl, location.origin), bytes = await fetchViewerBytes(source.href, signal), size = boundedImage(bytes);
  if (size[0] > 6144 || size[1] > 3072) throw new Error('ROOM_PANORAMA_LIMIT'); signal.throwIfAborted();
  const bitmap = await createImageBitmap(new Blob([bytes]), {imageOrientation: 'flipY'});
  if (!active() || signal.aborted) { bitmap.close(); return; }
  panoramaBitmap = bitmap; panorama = new THREE.Texture(bitmap); panorama.mapping = THREE.EquirectangularReflectionMapping; panorama.colorSpace = THREE.SRGBColorSpace; panorama.flipY = false; panorama.needsUpdate = true;
  // The panorama lights imported PBR materials only; it is never a visible
  // room, a loading phase or a substitute for the World Labs splats.
  scene.environment = panorama; scene.environmentIntensity = .7; scene.environmentRotation.y = config.panoramaYaw; invalidate();
 }
 function publishPlayback(previous: boolean) { if (active() && previous !== belt.playing) options.onPlaybackChange?.(belt.playing); }
 function publishFocus(){const id=slots[desk.current]?.item.id;if(active()&&id&&id!==shownId){shownId=id;options.onFocus?.(id);}}
 function resetAim(){
  if(mobile()){const slot=slots[desk.current];wantedTarget.copy(objectOrigin).add(slot?.anchor||new THREE.Vector3(0,objectSize()[1]/2,0));if(config.mobile?.cameraTarget&&!selected)wantedTarget.set(...config.mobile.cameraTarget);}
  else wantedTarget.set(...config.cameraTarget);
 }
 function heroFraming(){
  const slot=slots[desk.current],bounds=slot?.model?new THREE.Box3().setFromObject(slot.model):new THREE.Box3(objectOrigin.clone().add(new THREE.Vector3(-objectSize()[0]/2,0,-objectSize()[2]/2)),objectOrigin.clone().add(new THREE.Vector3(objectSize()[0]/2,objectSize()[1],objectSize()[2]/2)));
  return collectionHeroFraming({width,height,...config.mobile,cameraPosition:cameraHome.toArray() as[number,number,number],cameraTarget:wantedTarget.toArray() as[number,number,number],min:bounds.min.toArray() as[number,number,number],max:bounds.max.toArray() as[number,number,number]});
 }
 function focusFov() {
  if(mobile()){const framing=heroFraming();return clamp(framing.fieldOfView+zoomOffset,framing.minFieldOfView,80);}
  const aspect = Math.max(.2, width / height), range = Math.max(.3, cameraHome.distanceTo(objectOrigin)), required = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(config.objectSize[1], config.objectSize[0] / aspect) * .68 / range)), 16, 72);
  return collectionDesktopFieldOfView(aspect,config.fieldOfView,required,!!selected,zoomOffset);
 }
 function setPlaying(playing: boolean) { if (!active()) return; const previous = belt.playing; conveyorSetPlaying(belt, playing); if (belt.playing && selected) { selected = null; resetAim(); wantedFov = focusFov(); } desk.elapsed = 0; lastFrame = null; publishPlayback(previous); invalidate(); }
 function setFocus(id: string | null) {
  if (!active()) return; const slot = slots.find(value => value.item.id === id); selected = slot?.item.id || null; zoomOffset = 0; setPlaying(false);
  if (slot) { desk.current = slot.index; belt.cursor = slot.index; desk.elapsed = 0; wantedTarget.copy(objectOrigin).add(slot.anchor); } else resetAim();
  wantedYaw = 0; wantedFov = focusFov(); lastFrame = null; invalidate();
 }
 function step(direction: -1 | 1) { if (!active() || !slots.length) return; selected = null; setPlaying(false); desk.current = (desk.current + direction + slots.length) % slots.length; belt.cursor = desk.current; desk.elapsed = 0; resetAim(); wantedFov = focusFov();lastFrame = null; invalidate(); }
 function reset() { if (!active()) return; wantedYaw = 0; zoomOffset = 0; setFocus(null); }
 function look(delta: number) { if (!active() || !Number.isFinite(delta)) return; wantedYaw = clamp(wantedYaw + clamp(delta, -.15, .15), -.22, .22); invalidate(); }
 function zoom(delta: number) { if (!active() || !Number.isFinite(delta)) return; zoomOffset = clamp(zoomOffset + clamp(delta, -1, 1) * 4, -12, 16); wantedFov = focusFov(); invalidate(); }
 function motionChanged() { const previous = belt.playing; reduced = motion?.matches ?? false; conveyorSetReduced(belt, reduced); publishPlayback(previous); lastFrame = null; invalidate(); }
 function setMood(mood: CollectionMood) { if (!active() || mood !== 'sunset' && mood !== 'night') return; const night = mood === 'night'; keyLight.intensity = night ? 1.1 : 1.6; fillLight.intensity = night ? .3 : .45; scene.environmentIntensity = night ? .5 : .7; invalidate(); }
 function dropExpired(slot: ConveyorItem) {
  if (!expired(slot.item) || dead) return; slot.controller.abort(); if (slot.model) { slot.group.remove(slot.model); disposeModel(slot.model); slot.model = undefined; }
  if (slot.photoUrl) { URL.revokeObjectURL(slot.photoUrl); slot.photoUrl = undefined; slot.image.removeAttribute('src'); } slot.image.hidden = true; slot.label.textContent = 'Preview expired'; slot.group.userData.representation = 'unavailable-media'; diagnostics(); settleModel(slot); invalidate();
 }
 function expiryTimer(slot: ConveyorItem) { if (!slot.item.mediaExpiresAt || slot.item.mediaExpiresAt <= 0 || !Number.isFinite(slot.item.mediaExpiresAt)) return; const delay = slot.item.mediaExpiresAt * 1000 - Date.now(); slot.timer = setTimeout(() => { if (dead) return; if (expired(slot.item)) dropExpired(slot); else expiryTimer(slot); }, clamp(delay, 1, 2_147_483_647)); }
 async function thumbnail(slot: ConveyorItem) {
  if (!slot.item.imageUrl || expired(slot.item) || !active()) return; const source = viewerAssetUrl(slot.item.imageUrl, location.origin), signal = slot.controller.signal, bytes = await fetchViewerBytes(source.href, signal);
  if (bytes.length > 6 * 1024 * 1024) throw new Error('ROOM_IMAGE_LIMIT'); boundedImage(bytes); const bitmap = await createImageBitmap(new Blob([bytes])); bitmap.close();
  if (!active() || signal.aborted || expired(slot.item)) return; slot.photoUrl = URL.createObjectURL(new Blob([bytes])); slot.image.src = slot.photoUrl; slot.image.hidden = false;
  if (!slot.model && (!modelSource(slot.item) || failedModels.has(slot.item.id))) slot.group.userData.representation = 'reference-photo-proxy';
  slot.label.textContent = modelSource(slot.item) && !slot.model && !failedModels.has(slot.item.id) ? 'Loading souvenir…' : slot.item.title; diagnostics(); invalidate();
 }
 async function model(slot: ConveyorItem) {
  const url=modelSource(slot.item);if (!url || expired(slot.item) || !active()) return; const source = viewerAssetUrl(url, location.origin), signal = slot.controller.signal, bytes = await fetchViewerBytes(source.href, signal); validateCollectionGLB(bytes); signal.throwIfAborted();
  const manager = new THREE.LoadingManager(); manager.setURLModifier(url => { if (!url.startsWith('blob:')) throw new Error('ROOM_EXTERNAL_RESOURCE'); return url; }); const gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer, ''), body = gltf.scene;
  if (!active() || signal.aborted || expired(slot.item)) { disposeModel(body); return; }
  try {
   let vertices = 0; const images = new Map<object, HTMLCanvasElement>(), closed = new Set<object>(), textureLimit = 2048;
   body.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return; const count = object.geometry.getAttribute('position')?.count || 0; vertices += count;
    if (!count || vertices > MAX_MODEL_VERTICES || object instanceof THREE.SkinnedMesh && object.skeleton.bones.length > 256) throw new Error('ROOM_MODEL_LIMIT');
    for (const value of Array.isArray(object.material) ? object.material : [object.material]) for (const field of Object.values(value)) {
     if (!(field instanceof THREE.Texture) || !field.image || images.has(field.image)) { if (field instanceof THREE.Texture && images.has(field.image)) { field.image = images.get(field.image)!; field.needsUpdate = true; } continue; }
     const image = field.image as {width: number; height: number; close?(): void}; if (image.width <= textureLimit && image.height <= textureLimit) continue;
     const ratio = Math.min(textureLimit / image.width, textureLimit / image.height), resized = document.createElement('canvas'); resized.width = Math.max(1, Math.round(image.width * ratio)); resized.height = Math.max(1, Math.round(image.height * ratio)); const context = resized.getContext('2d');
     if (!context) throw new Error('ROOM_TEXTURE_UNAVAILABLE'); context.drawImage(image as unknown as CanvasImageSource, 0, 0, resized.width, resized.height); images.set(image, resized); field.image = resized; field.needsUpdate = true; if (image.close && !closed.has(image)) { closed.add(image); image.close(); }
    }
   });
   if (typeof slot.item.modelYaw === 'number' && Number.isFinite(slot.item.modelYaw)) body.rotation.y += clamp(slot.item.modelYaw, -Math.PI, Math.PI); body.updateMatrixWorld(true);
   let bounds = new THREE.Box3().setFromObject(body), size = bounds.getSize(new THREE.Vector3()); const framed = slot.item.objectRepresentation === 'framed-postcard';
   if (framed && size.y < Math.min(size.x, size.z) * .65) { body.rotation.x -= Math.PI / 2; body.updateMatrixWorld(true); bounds = new THREE.Box3().setFromObject(body); size = bounds.getSize(new THREE.Vector3()); }
   if (framed && size.x < size.z) { body.rotation.y += Math.PI / 2; body.updateMatrixWorld(true); bounds = new THREE.Box3().setFromObject(body); size = bounds.getSize(new THREE.Vector3()); }
   if (!vertices || ![size.x, size.y, size.z].every(value => Number.isFinite(value) && value >= 0) || Math.max(size.x, size.y, size.z) <= .00001) throw new Error('ROOM_MODEL_INVALID');
   const center = bounds.getCenter(new THREE.Vector3()), scale = Math.min(objectSize()[0] / Math.max(size.x, .01), objectSize()[1] / Math.max(size.y, .01), objectSize()[2] / Math.max(size.z, .01));
   slot.modelFrame={size:size.clone(),center:center.clone(),minY:bounds.min.y,scale:body.scale.clone()};
   body.scale.multiplyScalar(scale); body.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale); body.updateMatrixWorld(true); slot.anchor.set(0, size.y * scale / 2, 0);
   slot.model = body; slot.group.add(body); slot.group.userData.representation = slot.item.objectRepresentation === 'souvenir-miniature' ? 'cached-souvenir-miniature' : 'cached-generated-model'; diagnostics(); invalidate();
  } catch (error) { disposeModel(body); throw error; }
 }
 function project(): CollectionProjection[] {
  camera.updateMatrixWorld(); scene.updateMatrixWorld(true);
  return slots.map(slot => { const point = slot.group.localToWorld(slot.anchor.clone()).project(camera), visible = slot.group.visible && point.z >= -1 && point.z <= 1 && point.x > -1 && point.x < 1 && point.y > -1 && point.y < 1;
   const photoFallback = !slot.model && (!modelSource(slot.item) || failedModels.has(slot.item.id) || expired(slot.item));
   slot.proxy.hidden = !visible || !photoFallback; if (!slot.proxy.hidden) { slot.proxy.style.left = `${(point.x + 1) * width / 2}px`; slot.proxy.style.top = `${(1 - point.y) * height / 2}px`; }
   return {id: slot.item.id, x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2, visible}; });
 }
 function hit(event: PointerEvent): {slot: ConveyorItem} | {prop: 'photo-frame' | 'travel-journal'} | undefined { const rect = host.getBoundingClientRect(); ndc.set((event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1, -(event.clientY - rect.top) / Math.max(1, rect.height) * 2 + 1); camera.updateMatrixWorld(); scene.updateMatrixWorld(true); raycaster.setFromCamera(ndc, camera);
  const propHit = props?.hit(raycaster);
  for (const value of raycaster.intersectObjects(slots.map(slot => slot.group), true)) { let object: THREE.Object3D | null = value.object, slot: ConveyorItem | undefined, visible = true; while (object) { visible &&= object.visible; slot ||= slots.find(candidate => object === candidate.group); object = object.parent; } if (visible && slot) return propHit && propHit.distance < value.distance ? {prop: propHit.id} : {slot}; } return propHit ? {prop: propHit.id} : undefined;
 }
 try {
  renderer = new THREE.WebGLRenderer({antialias: false, alpha: false, powerPreference: 'high-performance'}); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  renderer.domElement.setAttribute('role', 'img'); renderer.domElement.setAttribute('aria-label', 'World Labs memory studio with real 3D souvenirs. Select a gift, use arrows to browse, Space to pause, drag to look and plus or minus to zoom.'); renderer.domElement.style.touchAction = 'pan-y'; renderer.domElement.tabIndex = 0; host.append(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); fail('The studio view was interrupted. Your photos and gift stories remain available.'); }, {signal: events.signal});
  for (const [index, item] of items.entries()) {
   const group = new THREE.Group(); group.position.copy(objectOrigin); group.visible = index === desk.current; group.userData.collectionId = item.id; group.userData.representation = modelSource(item) && !expired(item) ? 'loading-real-model' : 'reference-photo-proxy'; scene.add(group);
   const proxy = document.createElement('button'), image = document.createElement('img'), label = document.createElement('span'); proxy.type = 'button'; proxy.className = 'cr-asset-preview'; proxy.setAttribute('aria-label', `View ${item.title}`); proxy.hidden = true; image.alt = item.title; image.hidden = true; label.textContent = modelSource(item) ? 'Loading souvenir…' : item.title; proxy.append(image, label); host.append(proxy);
   const slot: ConveyorItem = {item, group, proxy, image, label, anchor: new THREE.Vector3(0, config.objectSize[1] / 2, 0), index, controller: new AbortController()}; slots.push(slot);
   proxy.addEventListener('click', () => { if (active()) { setFocus(item.id); options.onSelect(item.id); } }, {signal: events.signal}); downloads.signal.addEventListener('abort', () => slot.controller.abort(), {once: true}); expiryTimer(slot);
  }
  diagnostics(); environmentState(); options.onPlaybackChange?.(belt.playing);
  gate = createFrameGate(now => {
   if (!active() || !renderer || blurred || !worldReady || !propsReady || pendingModels.size > 0) return; if (lastFrame !== null && now - lastFrame < 49) { gate?.request(); return; }
   const dt = lastFrame === null ? 0 : clamp((now - lastFrame) / 1000, 0, .05); lastFrame = now;
   const automatic = belt.playing && !reduced && pendingModels.size === 0;
   if(deskShuffleAdvance(desk, dt, automatic, reduced)){resetAim();wantedFov=focusFov();} belt.cursor = desk.current;
   const alpha = reduced ? 1 : 1 - Math.exp(-(dt || 1 / 30) * 9); target.lerp(wantedTarget, alpha); yaw += (wantedYaw - yaw) * alpha; fieldOfView += (wantedFov - fieldOfView) * alpha;
   // Switch whole imported gifts in one frame. Their physical size and PBR
   // materials stay intact; no grow/shrink or transparency sorting with splats.
   for (const slot of slots) slot.group.visible = slot.index === desk.current;
   const direction = target.clone().sub(cameraHome).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw); camera.position.copy(cameraHome); camera.lookAt(cameraHome.clone().add(direction)); camera.fov = fieldOfView; camera.updateProjectionMatrix();
   try {shadows?.beforeRender(mobile());renderer.render(scene,camera);}
   catch {if(shadows){shadows.destroy();shadows=undefined;host.dataset.roomShadows='unavailable';try{renderer.render(scene,camera);}catch{fail('The studio could not render here. Your photos and gift stories remain available.');return;}}else{fail('The studio could not render here. Your photos and gift stories remain available.');return;}}
   publishFocus();options.onProject(project());if(!announced){announced=true;options.onReady();}
   if (automatic || !reduced && (target.distanceToSquared(wantedTarget) > .000001 || Math.abs(wantedYaw - yaw) + Math.abs(wantedFov - fieldOfView) > .001)) gate?.request();
  });
  spark = new SparkRenderer({renderer, onDirty: () => invalidate()}); scene.add(spark); stopVisibility = observeViewerVisibility(host, gate);
  document.addEventListener('visibilitychange', () => { lastFrame = null; if (blurred) gate?.setHidden(true); }, {signal: events.signal});
  if (typeof window !== 'undefined') { window.addEventListener('blur', () => { blurred = true; lastFrame = null; gate?.setHidden(true); }, {signal: events.signal}); window.addEventListener('focus', () => { blurred = false; lastFrame = null; gate?.setHidden(document.visibilityState === 'hidden'); }, {signal: events.signal}); }
  const resize = () => {
   if (dead || !renderer) return; const rect = host.getBoundingClientRect(); if (rect.width < 1 || rect.height < 1) return; width = rect.width; height = rect.height;
   const compact=mobile();cameraHome.set(...(compact&&config.mobile?.cameraPosition||config.cameraPosition));objectOrigin.set(...(compact&&config.mobile?.objectPosition||config.objectPosition));
   for(const slot of slots){slot.group.position.copy(objectOrigin);const frame=slot.modelFrame,body=slot.model;if(frame&&body){const size=objectSize(),scale=Math.min(size[0]/Math.max(frame.size.x,.01),size[1]/Math.max(frame.size.y,.01),size[2]/Math.max(frame.size.z,.01));body.scale.copy(frame.scale).multiplyScalar(scale);body.position.set(-frame.center.x*scale,-frame.minY*scale,-frame.center.z*scale);slot.anchor.set(0,frame.size.y*scale/2,0);}slot.group.updateMatrixWorld(true);}
   if(selected){const slot=slots.find(value=>value.item.id===selected);wantedTarget.copy(objectOrigin).add(slot?.anchor||new THREE.Vector3());}else resetAim();
   if(!announced||reduced){target.copy(wantedTarget);camera.position.copy(cameraHome);camera.lookAt(target);}
   camera.aspect=width/height;if(compact){const layout=collectionMobileViewport(width,height,config.mobile);camera.setViewOffset(width,height,0,height/2-layout.centerY,width,height);}else camera.clearViewOffset();
   const ratio=compact?collectionPixelRatio(devicePixelRatio,width,height):viewerPixelRatio('place',devicePixelRatio,innerWidth);renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);
   host.dataset.roomPixelRatio=ratio.toFixed(2);host.dataset.roomComposition=compact?'mobile-hero':'desktop';
   wantedFov=focusFov();if(!announced)fieldOfView=wantedFov;camera.fov=fieldOfView;camera.updateProjectionMatrix();lastFrame=null;shadows?.invalidate();invalidate();
  };
  observer = new ResizeObserver(resize); observer.observe(host); resize(); motion?.addEventListener('change', motionChanged);
  if(config.shadowReceiverUrl)shadows=mountCollectionShadows({scene,renderer,light:keyLight,source:config.shadowReceiverUrl,origin:location.origin,signal:downloads.signal,isCurrent:active,worldPosition:config.worldPosition,worldRotation:config.worldRotation,worldScale:config.worldScale,validateGLB:validateCollectionGLB,
   casters:()=>[...slots.filter(slot=>slot.group.visible&&slot.model&&!expired(slot.item)).map(slot=>slot.model!),...scene.children.filter(root=>root.userData.provider==='Tripo')],onInvalidate:invalidate,onState:value=>{if(active())host.dataset.roomShadows=value;}});
  const pointerEvent = (name: string, listener: (event: PointerEvent) => void) => renderer!.domElement.addEventListener(name, listener as EventListener, {signal: events.signal});
  pointerEvent('pointerdown', event => { if (!active() || event.button !== 0) return; pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, dragged: false}; try { renderer!.domElement.setPointerCapture(event.pointerId); } catch {} });
  pointerEvent('pointermove', event => { if (!active()) return; if (pointer && pointer.id === event.pointerId) { const dx = event.clientX - pointer.x; pointer.dragged ||= Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 6; pointer.x = event.clientX; pointer.y = event.clientY; if (pointer.dragged) { const previous = belt.playing; conveyorSetPlaying(belt, false); look(-dx * .0017); publishPlayback(previous); } } else { const found = hit(event), next = found && ('slot' in found ? found.slot.item.id : found.prop) || null; if (next !== hovered) { hovered = next; host.style.cursor = next ? 'pointer' : ''; renderer!.domElement.title = found && 'prop' in found ? found.prop === 'photo-frame' ? 'Your memories' : 'Create a gift' : ''; invalidate(); } } });
  pointerEvent('pointerup', event => { if (!pointer || pointer.id !== event.pointerId) return; const found = !pointer.dragged && active() ? hit(event) : undefined; releasePointer(); if (found && 'slot' in found) { setFocus(found.slot.item.id); options.onSelect(found.slot.item.id); } else if (found && 'prop' in found) { setPlaying(false); props?.activate(found.prop); } });
  pointerEvent('pointercancel', releasePointer); pointerEvent('lostpointercapture', releasePointer); pointerEvent('pointerleave', () => { if (!pointer) { hovered = null; host.style.cursor = ''; renderer!.domElement.title = ''; } });
  renderer.domElement.addEventListener('keydown', event => { if (!active() || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); step(event.key === 'ArrowRight' ? 1 : -1); } else if (event.code === 'Space' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setPlaying(!belt.playing); } else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(-1); } else if (event.key === '-') { event.preventDefault(); zoom(1); } else if (event.key.toLowerCase() === 'r') { event.preventDefault(); reset(); } }, {signal: events.signal});
  void environmentJob(loadWorld, () => { fail('The 3D studio could not load. Your photos and gift stories remain available.'); });
  void environmentJob(loadPanorama, () => { /* Imported models remain usable with the scene lights. */ });
  const propStates = new Map<string, string>();
  const propConfigs = options.props ?? DEFAULT_COLLECTION_PROPS.map(prop => mobile() ? {...prop, modelUrl: prop.modelUrl.replace('.glb', '-mobile.glb')} : prop);
  props = mountCollectionProps({parent: scene, props: propConfigs, origin: location.origin, isCurrent: active, validateGLB: validateCollectionGLB, textureLimit: 2048, onActivate: id => { if (active()) options.onPropSelect?.(id); }, onInvalidate: invalidate, onState: outcome => { propStates.set(outcome.id, outcome.state); host.dataset.roomPropsReady = String([...propStates.values()].filter(value => value === 'ready').length); host.dataset.roomPropsFailed = String([...propStates.values()].filter(value => value === 'failed').length); }});
  void props.ready.then(() => { if (!active()) return; propsReady = true; desk.elapsed = 0; lastFrame = null; environmentState(); invalidate(); });
  const jobs = slots.flatMap(slot => [{slot, kind: 'photo', run: () => thumbnail(slot)}, {slot, kind: 'model', run: () => model(slot)}]);
  async function runJobs() { for (;;) { if (!active()) return; const job = jobs.shift(); if (!job) return; const timer = setTimeout(() => { job.slot.controller.abort(); if (job.kind === 'model') modelFailed(job.slot); }, VIEWER_LOAD_TIMEOUT); deadlines.add(timer); try { await job.run(); } catch { if (job.kind === 'model') modelFailed(job.slot); } finally { clearTimeout(timer); deadlines.delete(timer); if (job.kind === 'model') settleModel(job.slot); } } }
  void Promise.all([runJobs(), runJobs()]); invalidate();
 } catch { fail('The studio renderer is unavailable. Your photos and gift stories remain available.'); }
 return {select: setFocus, reset, look, zoom, setMood, setPlaying, step, destroy};
}
