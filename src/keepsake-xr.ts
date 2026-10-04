import type * as Three from 'three';
import { fetchViewerBytes, viewerAssetUrl, VIEWER_LOAD_TIMEOUT } from './viewer-runtime';
import './keepsake-xr.css';

export interface KeepsakeXROptions {
 modelUrl: string; title: string; modelYaw?: number; worldUrl?: string; worldScale?: number; isCurrent(): boolean;
 /** Release the ordinary gift renderer only once the browser accepts XR. */
 onSessionStarting?(): void; onExit(): void;
}
export interface KeepsakeXRRuntime {
 THREE: typeof Three; createRenderer(): Three.WebGLRenderer;
 loadModel(bytes: Uint8Array<ArrayBuffer>): Promise<Three.Object3D>;
 loadWorld?(renderer: Three.WebGLRenderer, bytes: Uint8Array<ArrayBuffer>): Promise<{object: Three.Object3D; destroy(): void}>;
}
export interface KeepsakeXRDependencies {
 loadRuntime?(): Promise<KeepsakeXRRuntime>;
 fetchBytes?: typeof fetchViewerBytes;
}
/** Preserve source transforms and geometry; place a clone at comfortable display scale. */
export function createKeepsakeXRDisplay(source: Three.Object3D, engine: typeof Three, modelYaw = 0): Three.Group {
 const clone = source.clone(true), centered = new engine.Group(), display = new engine.Group(); centered.add(clone); centered.updateMatrixWorld(true);
 const bounds = new engine.Box3().setFromObject(centered), size = bounds.getSize(new engine.Vector3()), longest = Math.max(size.x,size.y,size.z);
 if (!Number.isFinite(longest) || longest <= 1e-8 || ![bounds.min.x,bounds.min.y,bounds.min.z,bounds.max.x,bounds.max.y,bounds.max.z].every(Number.isFinite)) throw new Error('XR_MODEL_GEOMETRY_INVALID');
 const center = bounds.getCenter(new engine.Vector3()); centered.position.set(-center.x,-bounds.min.y,-center.z); display.add(centered); display.scale.setScalar(.42/longest);
 display.rotation.y = Number.isFinite(modelYaw) ? modelYaw : 0; display.position.set(0,1.11,-1.25); display.updateMatrixWorld(true); return display;
}
export function disposeKeepsakeXRResources(root: Three.Object3D, engine: typeof Three): void {
 const geometries = new Set<Three.BufferGeometry>(), materials = new Set<Three.Material>(), textures = new Set<Three.Texture>(), images = new Set<{close?(): void}>();
 root.traverse(object => { if (!(object instanceof engine.Mesh || object instanceof engine.Line || object instanceof engine.Points)) return; geometries.add(object.geometry); for (const material of Array.isArray(object.material)?object.material:[object.material]) { materials.add(material); for (const value of Object.values(material)) if (value instanceof engine.Texture) textures.add(value); } if (object instanceof engine.SkinnedMesh && object.skeleton.boneTexture) textures.add(object.skeleton.boneTexture); });
 textures.forEach(texture => { const image=texture.image as {close?(): void}|undefined; if(image?.close)images.add(image); texture.dispose(); }); images.forEach(image=>image.close?.()); geometries.forEach(value=>value.dispose()); materials.forEach(value=>value.dispose()); root.clear();
}
/** Only a ray actually hitting this gift can rotate it. */
export function rotateKeepsakeXRFromController(controller: Three.Object3D, gift: Three.Object3D, engine: typeof Three): boolean {
 controller.updateWorldMatrix(true,false); gift.updateWorldMatrix(true,true); const ray = new engine.Raycaster(), rotation = new engine.Matrix4().extractRotation(controller.matrixWorld);
 ray.ray.origin.setFromMatrixPosition(controller.matrixWorld); ray.ray.direction.set(0,0,-1).applyMatrix4(rotation).normalize(); ray.far=3;
 if (!ray.intersectObject(gift,true).length) return false; gift.rotation.y += Math.PI/12; return true;
}
export async function loadKeepsakeXRRuntime(): Promise<KeepsakeXRRuntime> {
 const [THREE,{GLTFLoader},{validateCollectionGLB}] = await Promise.all([import('three'),import('three/addons/loaders/GLTFLoader.js'),import('./collection-scene')]);
 return {THREE,createRenderer:()=>new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'}),async loadModel(bytes){ validateCollectionGLB(bytes); const manager=new THREE.LoadingManager(); manager.setURLModifier(url=>{if(!url.startsWith('blob:'))throw new Error('XR_EXTERNAL_RESOURCE');return url;}); return (await new GLTFLoader(manager).parseAsync(bytes.buffer,'')).scene; }, async loadWorld(renderer, bytes) {
  const {SparkRenderer,SplatMesh}=await import('@sparkjsdev/spark');
  const object=new THREE.Group(), spark=new SparkRenderer({renderer}), splats=new SplatMesh({fileBytes:bytes,fileName:'xr-world.spz',maxSplats:600000});
  object.add(spark,splats); let destroyed=false;
  const destroy=()=>{if(destroyed)return;destroyed=true;object.removeFromParent();splats.dispose();spark.dispose();object.clear();};
  try {await splats.initialized;if(splats.numSplats<1||splats.numSplats>600000)throw Error('XR_WORLD_LIMIT');splats.rotation.x=Math.PI;return {object,destroy};}catch(error){destroy();throw error;}
 }};
}

/** Opt-in standard WebXR. Capability checks allocate no WebGL context and transmit no model. */
export function mountKeepsakeXR(host: HTMLElement, options: KeepsakeXROptions, dependencies: KeepsakeXRDependencies = {}) {
 let dead=false, epoch=0, supported=false, session:XRSession|undefined, renderer:Three.WebGLRenderer|undefined, scene:Three.Scene|undefined, runtime:KeepsakeXRRuntime|undefined, accepted=false, notified=false, busy=false;
 let abort:AbortController|undefined, timer:ReturnType<typeof setTimeout>|undefined, removeSessionListeners:(()=>void)|undefined;
 const events=new AbortController(), panel=document.createElement('section'); panel.className='kx-panel'; panel.setAttribute('aria-label','Open your keepsake in a headset');
 let environment: {object: Three.Object3D; destroy(): void}|undefined, environmentEpoch=0;
 panel.innerHTML='<div class="kx-heading"><span aria-hidden="true">◉</span><div><h3>Step inside your memory</h3><p data-kx-title></p></div></div><p class="kx-description">Open this gift in a compatible headset browser. Point and squeeze a grip to hold it. The first trigger turns the gift; the second opens its World Labs memory.</p><div class="kx-actions"><button type="button" data-kx-enter disabled>Enter Portal in VR</button><button type="button" data-kx-portal hidden>Step into the memory</button><button type="button" data-kx-exit hidden>Leave headset</button></div><p data-kx-status role="status" aria-live="polite">Checking headset support…</p><p class="kx-note">WebXR · Real Tripo and World Labs assets. Physical PICO device validation is pending.</p>';
 host.append(panel); const enter=panel.querySelector<HTMLButtonElement>('[data-kx-enter]')!, exit=panel.querySelector<HTMLButtonElement>('[data-kx-exit]')!, status=panel.querySelector<HTMLElement>('[data-kx-status]')!; panel.querySelector<HTMLElement>('[data-kx-title]')!.textContent=options.title;
 const active=()=>!dead&&host.isConnected&&options.isCurrent(), endedSessions=new WeakSet<XRSession>();
 function endSession(value:XRSession){if(endedSessions.has(value))return;endedSessions.add(value);void value.end().catch(()=>{});}
 function notifyExit(){if(accepted&&!notified){notified=true;options.onExit();}}
 function release(){clearTimeout(timer);timer=undefined;environmentEpoch++;environment?.destroy();environment=undefined;abort?.abort();abort=undefined;removeSessionListeners?.();removeSessionListeners=undefined;renderer?.setAnimationLoop(null);if(scene&&runtime)disposeKeepsakeXRResources(scene,runtime.THREE);scene=undefined;if(renderer){renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();renderer=undefined;}runtime=undefined;busy=false;exit.hidden=true;const portal=panel.querySelector<HTMLElement>('[data-kx-portal]');if(portal)portal.hidden=true;enter.disabled=!supported;}
 function finished(message='Headset closed. Your gift is ready to open again.'){epoch++;session=undefined;release();if(active())status.textContent=message;notifyExit();}
 function end(){const current=session;if(!current){if(busy){epoch++;release();if(active())status.textContent='Headset request cancelled. Your ordinary gift stays available.';}return;}finished();endSession(current);}
 function destroy(){if(dead)return;dead=true;epoch++;const current=session;session=undefined;release();events.abort();panel.remove();if(current)endSession(current);notifyExit();}
 function stale(run:number,granted:XRSession){if(active()&&run===epoch)return false;if(session===granted)end();else endSession(granted);return true;}
 exit.addEventListener('click',end,{signal:events.signal});
 window.addEventListener('pagehide',destroy,{signal:events.signal});
 enter.addEventListener('click',()=>{
  if(!active()||!supported||busy||!navigator.xr)return;busy=true;enter.disabled=true;accepted=false;notified=false;exit.hidden=false;exit.textContent='Cancel';const run=++epoch;status.textContent='Accept headset access in your browser…';
  // Request immediately inside the click; imports and model I/O follow permission.
  let requested:Promise<XRSession>;try{requested=navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor']});}catch{busy=false;exit.hidden=true;enter.disabled=false;status.textContent='Headset access was unavailable. You can keep enjoying the ordinary gift.';return;}
  void (async()=>{let loaded:Three.Object3D|undefined;try{
   const granted=await requested;if(!active()||run!==epoch){endSession(granted);return;}session=granted;accepted=true;
   const ended=()=>{endedSessions.add(granted);if(session===granted)finished();};granted.addEventListener('end',ended);removeSessionListeners=()=>granted.removeEventListener('end',ended);
   options.onSessionStarting?.();if(!active()||run!==epoch){end();return;}
   status.textContent='Opening your actual 3D gift…';exit.hidden=false;exit.textContent='Leave headset';abort=new AbortController();const requestAbort=abort;timer=setTimeout(()=>{if(session===granted){end();if(active())status.textContent='The gift took too long to open. Try again.';}},VIEWER_LOAD_TIMEOUT);
   const loadedRuntime=await (dependencies.loadRuntime||loadKeepsakeXRRuntime)();if(stale(run,granted))return;runtime=loadedRuntime;const engine=loadedRuntime.THREE;
   let floor=true;try{await granted.requestReferenceSpace('local-floor');}catch{floor=false;}if(stale(run,granted))return;
   renderer=runtime.createRenderer();renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType(floor?'local-floor':'local');renderer.xr.setFramebufferScaleFactor(.8);renderer.setPixelRatio(1);renderer.setSize(Math.max(1,host.clientWidth),Math.max(1,host.clientHeight));renderer.outputColorSpace=engine.SRGBColorSpace;renderer.domElement.className='kx-canvas';panel.append(renderer.domElement);
   scene=new engine.Scene();scene.background=new engine.Color('#eef3f4');const room=new engine.Group();room.position.y=floor?0:-1.6;scene.add(room);const camera=new engine.PerspectiveCamera(55,1,.05,100);camera.position.y=floor?1.6:0;
   room.add(new engine.HemisphereLight('#fff6ec','#23445a',2.5));const sun=new engine.DirectionalLight('#fff0d9',3);sun.position.set(-2,3,-2);room.add(sun);
   let gift:Three.Group|undefined, portalMode=false, changingEnvironment=false;
   const portalButton=panel.querySelector<HTMLButtonElement>('[data-kx-portal]')!;
   async function switchEnvironment(url:string, memory:boolean) {
    if(changingEnvironment||!loadedRuntime.loadWorld||!renderer||!active()||session!==granted)return;
    changingEnvironment=true; const revision=++environmentEpoch; portalButton.disabled=true;
    try {const source=viewerAssetUrl(url,location.origin),data=await(dependencies.fetchBytes||fetchViewerBytes)(source.href,requestAbort.signal);
     if(!active()||session!==granted||revision!==environmentEpoch||requestAbort.signal.aborted||!renderer)return;
     const next=await loadedRuntime.loadWorld(renderer,data);
     if(!active()||session!==granted||revision!==environmentEpoch){next.destroy();return;}
     environment?.destroy();environment=next;next.object.position.y=floor?1.6:0;
     if(memory&&Number.isFinite(options.worldScale)&&options.worldScale!>0&&options.worldScale!<100)next.object.scale.setScalar(options.worldScale!);
     scene!.add(next.object);portalMode=memory;if(gift)gift.visible=!memory;
     portalButton.textContent=memory?'Return to the desk':'Step into the memory';status.textContent=memory?'You are inside the generated World Labs memory. Look around; use the second trigger to return.':'Look around the gift. Squeeze a grip to hold it; the second trigger opens its memory.';
    }catch{if(active()&&session===granted)status.textContent='This world could not open in the headset. Your gift is still available.';}
    finally{changingEnvironment=false;if(active()&&session===granted)portalButton.disabled=false;}
   }
   const travel=()=>{if(!options.worldUrl)return;void switchEnvironment(portalMode?'/assets/v10/memory-studio-mobile.spz':options.worldUrl,!portalMode);};
   portalButton.addEventListener('click',travel,{signal:events.signal});
   for(let index=0;index<2;index++){const controller=renderer.xr.getController(index),geometry=new engine.BufferGeometry().setFromPoints([new engine.Vector3(),new engine.Vector3(0,0,-2)]),line=new engine.Line(geometry,new engine.LineBasicMaterial({color:'#d4e9f1'}));controller.add(line);scene.add(controller);controller.addEventListener('select',()=>{if(!active()||session!==granted)return;if(index===1&&options.worldUrl)travel();else if(gift&&!portalMode)rotateKeepsakeXRFromController(controller,gift,engine);});
    controller.addEventListener('squeezestart',()=>{if(!gift||portalMode||changingEnvironment||gift.parent!==room)return;const rotation=new engine.Matrix4().extractRotation(controller.matrixWorld),ray=new engine.Raycaster();ray.ray.origin.setFromMatrixPosition(controller.matrixWorld);ray.ray.direction.set(0,0,-1).transformDirection(rotation);ray.far=3;if(ray.intersectObject(gift,true).length)controller.attach(gift);});
    controller.addEventListener('squeezeend',()=>{if(gift&&gift.parent===controller){room.attach(gift);gift.position.set(0,1.11,-1.25);gift.rotation.set(0,Number.isFinite(options.modelYaw)?options.modelYaw!:0,0);}});
   }
   await renderer.xr.setSession(granted);if(stale(run,granted))return;
   renderer.setAnimationLoop(()=>{if(!active()){end();return;}if(granted.visibilityState==='hidden')return;if(scene&&renderer)renderer.render(scene,camera);});
   const url=viewerAssetUrl(options.modelUrl,location.origin),bytes=await (dependencies.fetchBytes||fetchViewerBytes)(url.href,requestAbort.signal);if(stale(run,granted))return;
   loaded=await loadedRuntime.loadModel(bytes);if(stale(run,granted)){disposeKeepsakeXRResources(loaded,engine);loaded=undefined;return;}gift=createKeepsakeXRDisplay(loaded,engine,options.modelYaw);room.add(gift);loaded=undefined;clearTimeout(timer);timer=undefined;status.textContent='Look around the gift. Point and press a trigger to turn it.';
   if(options.worldUrl&&loadedRuntime.loadWorld){portalButton.hidden=false;void switchEnvironment('/assets/v10/memory-studio-mobile.spz',false);}
  }catch{if(loaded&&runtime)disposeKeepsakeXRResources(loaded,runtime.THREE);if(active()&&run===epoch){const current=session;finished(accepted?'The headset could not open this gift. Your ordinary gift is still available.':'Headset access was declined or unavailable. Your ordinary gift is still available.');if(current)endSession(current);}}
  })();
 },{signal:events.signal});
 void (async()=>{try{supported=globalThis.isSecureContext===true&&Boolean(navigator.xr)&&await navigator.xr!.isSessionSupported('immersive-vr');if(!active())return;enter.disabled=!supported;status.textContent=supported?'Ready. Enter headset when you choose.':'This browser cannot open a VR session. Your ordinary 3D gift stays available.';}catch{if(active())status.textContent='Headset support is unavailable here. Your ordinary 3D gift stays available.';}})();
 return {destroy};
}
