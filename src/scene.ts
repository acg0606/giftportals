import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFrameGate,fetchViewerBytes,observeViewerVisibility,viewerAssetUrl,viewerPixelRatio,VIEWER_LOAD_TIMEOUT,type ViewerProgress } from './viewer-runtime';
import { mountGiftUnboxing } from './gift-unboxing';
import { mountKeepsakeAtmosphere } from './keepsake-atmosphere';
import type { InstantObjectRepresentation } from '../shared/instant-examples';

export interface MemorySceneOptions { modelUrl: string; theme?: 'studio' | 'dusk'; backgroundUrl?: string; photoIntent?:'object'|'place'; objectRepresentation?:InstantObjectRepresentation; modelYaw?:number; photoUrl?:string; unboxing?:boolean; onReady?: () => void; onReveal?: () => void; onError?: (message: string) => void; onProgress?:(state:ViewerProgress)=>void }

export function mountMemoryScene(host: HTMLElement, options: MemorySceneOptions) {
  let dead = false;
  let ready=false;
  const abort=new AbortController();
  let deadline:ReturnType<typeof setTimeout>|undefined;
  let gate:ReturnType<typeof createFrameGate>|undefined;
  let stopVisibility:(()=>void)|undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  let observer: ResizeObserver | undefined;
  let controls: OrbitControls | undefined;
  let keyboard:((event:KeyboardEvent)=>void)|undefined;
  let lost:((event:Event)=>void)|undefined;
  let displayMode:'textured'|'wireframe'='textured';
  let autoRotate=false;
  let lastFrame:number|null=null;
  let unboxing:ReturnType<typeof mountGiftUnboxing>|undefined;
  let atmosphere:ReturnType<typeof mountKeepsakeAtmosphere>|undefined;
  let blurred=false;
  const lifecycleEvents=new AbortController();
  const modelMaterials=new Map<THREE.MeshStandardMaterial,boolean>();
  const scene = new THREE.Scene();
  const dusk = options.theme === 'dusk';
  scene.background = dusk ? null : new THREE.Color('#f8f6f0');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  const focus=new THREE.Vector3(0,1.1,0);
  const home=options.theme === 'dusk' ? new THREE.Vector3(4.65,1.9,1.2) : new THREE.Vector3(0,1.9,4.8);
  let modelMinDistance=3.8;
  camera.position.copy(home);
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced=motionPreference.matches;
  const motionChange=()=>{
    reduced=motionPreference.matches;
    if(reduced)autoRotate=false;
    if(controls){controls.enableDamping=!reduced;controls.autoRotate=autoRotate;}
    unboxing?.setReduced(reduced);
    atmosphere?.setReduced(reduced);
    lastFrame=null;gate?.request();
  };
  motionPreference.addEventListener('change',motionChange);
  const content = new THREE.Group();
  scene.add(content);
  function disposeTree(root: THREE.Object3D) {
    root.traverse((item) => {
      if (!(item instanceof THREE.Mesh) && !(item instanceof THREE.LineSegments)) return;
      item.geometry.dispose();
      const materials = Array.isArray(item.material) ? item.material : [item.material];
      materials.forEach((material) => {
        Object.values(material).forEach((value) => { if (value instanceof THREE.Texture) value.dispose(); });
        material.dispose();
      });
    });
  }
  function destroy() {
    if (dead) return;
    dead = true;
    clearTimeout(deadline);abort.abort();lifecycleEvents.abort();gate?.destroy();stopVisibility?.();unboxing?.destroy();unboxing=undefined;atmosphere?.destroy();atmosphere=undefined;
    observer?.disconnect(); controls?.dispose();
    motionPreference.removeEventListener('change',motionChange);modelMaterials.clear();
    if(keyboard)renderer?.domElement.removeEventListener('keydown',keyboard);
    if(lost)renderer?.domElement.removeEventListener('webglcontextlost',lost);
    disposeTree(scene); renderer?.dispose(); renderer?.forceContextLoss();
    renderer?.domElement.remove();
  }
  function fail(message:string){if(dead)return;destroy();options.onError?.(message);}
  function rotate(delta:number){
    if(dead||!controls||!Number.isFinite(delta))return;
    const offset=camera.position.clone().sub(controls.target),spherical=new THREE.Spherical().setFromVector3(offset);spherical.theta+=delta;spherical.phi=THREE.MathUtils.clamp(spherical.phi,controls.minPolarAngle,controls.maxPolarAngle);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));controls.update();gate?.request();
  }
  function zoom(delta:number){
    if(dead||!controls||!Number.isFinite(delta))return;const offset=camera.position.clone().sub(controls.target),distance=THREE.MathUtils.clamp(offset.length()*(1+THREE.MathUtils.clamp(delta,-0.5,0.5)),controls.minDistance,controls.maxDistance);offset.setLength(distance);camera.position.copy(controls.target).add(offset);controls.update();gate?.request();
  }
  function fitWrappedGift(){
    if(!unboxing)return;
    if(unboxing.revealed){
      if(controls)controls.minDistance=modelMinDistance;
      if(host.getBoundingClientRect().width>600)return;
      // Frame the actual model's bounds in the compact viewer, without altering
      // the decoded geometry. The same orbit/zoom controls remain available.
      const direction=camera.position.clone().sub(focus).normalize();
      let distance=camera.position.distanceTo(focus);
      for(let pass=0;pass<6;pass++){
        camera.position.copy(focus).addScaledVector(direction,distance);camera.lookAt(focus);camera.updateMatrixWorld();
        let horizontal=0,vertical=0;
        const point=new THREE.Vector3();
        content.traverse(item=>{
          if(!(item instanceof THREE.Mesh))return;
          const positions=item.geometry.getAttribute('position');if(!positions)return;
          for(let index=0;index<positions.count;index++){
            point.fromBufferAttribute(positions,index).applyMatrix4(item.matrixWorld).project(camera);
            horizontal=Math.max(horizontal,Math.abs(point.x));vertical=Math.max(vertical,Math.abs(point.y));
          }
        });
        distance=Math.max(unboxing.size.length()/2+.3,distance*Math.max(horizontal/.66,vertical/.78));
      }
      camera.position.copy(focus).addScaledVector(direction,distance);
      return;
    }
    const halfWidth=Math.hypot(unboxing.size.x,unboxing.size.z)/2+.12,halfHeight=unboxing.size.y/2+.34;
    const fit=Math.max(halfHeight,halfWidth/Math.max(.25,camera.aspect))/Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    const offset=camera.position.clone().sub(focus),distance=Math.max(offset.length(),fit+.7);
    // Fit the actual sponsor model while its HTML gift note is visible.
    offset.set(.9,.75,1.1).setLength(distance);camera.position.copy(focus).add(offset);
  }
  function reset(){if(dead)return;camera.position.copy(home);fitWrappedGift();atmosphere?.setComposition(focus,camera.position);controls?.target.copy(focus);lastFrame=null;controls?.update(0);gate?.request();}
  function setDisplayMode(mode:'textured'|'wireframe'){
    if(dead||(mode!=='textured'&&mode!=='wireframe'))return;
    displayMode=mode;
    for(const [material,original] of modelMaterials){material.wireframe=mode==='wireframe'||original;material.needsUpdate=true;}
    gate?.request();
  }
  function setWireframe(enabled:boolean){setDisplayMode(enabled?'wireframe':'textured');}
  function setAutoRotate(enabled:boolean){
    if(dead)return false;
    autoRotate=Boolean(enabled)&&!reduced;
    if(controls)controls.autoRotate=autoRotate;
    lastFrame=null;gate?.request();return autoRotate;
  }
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: dusk, powerPreference: 'low-power' });
    renderer.setPixelRatio(viewerPixelRatio('gift',devicePixelRatio,innerWidth));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = options.unboxing ? 1 : 1.1;

    renderer.domElement.tabIndex=0;
    renderer.domElement.setAttribute('aria-label','Interactive 3D gift. Drag to rotate, pinch to zoom. Arrow keys rotate, plus and minus zoom, R resets.');
    renderer.domElement.setAttribute('role','img');
    host.append(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(focus);
    controls.enableDamping = !reduced;
    controls.autoRotateSpeed=0.6;
    controls.enablePan = false; controls.minDistance = 3.8; controls.maxDistance = 13;
    controls.minPolarAngle = 0.3; controls.maxPolarAngle = Math.PI / 2.05;
    controls.addEventListener('change',()=>gate?.request());
    renderer.domElement.addEventListener('pointerdown',()=>renderer?.domElement.focus({preventScroll:true}));
    keyboard=(event)=>{if(event.altKey||event.ctrlKey||event.metaKey)return;let handled=true;if(event.key==='ArrowLeft')rotate(0.15);else if(event.key==='ArrowRight')rotate(-0.15);else if(event.key==='+'||event.key==='=')zoom(-0.12);else if(event.key==='-'||event.key==='_')zoom(0.12);else if(event.key.toLowerCase()==='r')reset();else handled=false;if(handled)event.preventDefault();};
    renderer.domElement.addEventListener('keydown',keyboard);
    lost=(event)=>{event.preventDefault();fail('The 3D view was interrupted. Your original image and story are still available. Try opening the gift again.');};renderer.domElement.addEventListener('webglcontextlost',lost);
    if(options.unboxing){atmosphere=mountKeepsakeAtmosphere(scene,{focus,cameraPosition:home,reduced});}else{
    scene.add(new THREE.HemisphereLight(dusk ? '#edf8ed' : '#ffffff', dusk ? '#0b2d36' : '#20252e', 2));
    const sun = new THREE.DirectionalLight(dusk ? '#fff0d1' : '#ffffff', 3);
    sun.position.set(3, 6, 5); scene.add(sun);
    const rim=new THREE.DirectionalLight('#d5dded',1.8);
    rim.position.set(-4,3,-3);scene.add(rim);
    }
    const resize = () => {
      if (dead || !renderer) return;
      const { width, height } = host.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      camera.aspect = width / height; camera.updateProjectionMatrix();fitWrappedGift(); renderer.setPixelRatio(viewerPixelRatio('gift',devicePixelRatio,innerWidth));renderer.setSize(width,height,false);gate?.request();
    };
    gate=createFrameGate((now)=>{
      if(dead||!renderer||blurred)return;
      // Explicit orbit is capped at 30 rendered frames per second. The gate cancels
      // every pending frame while offscreen or hidden; resuming never jumps ahead.
      if((autoRotate||atmosphere?.animated)&&lastFrame!==null&&now-lastFrame<1000/30){gate?.request();return;}
      const delta=lastFrame===null?1/30:THREE.MathUtils.clamp((now-lastFrame)/1000,0,0.05);
      lastFrame=now;
      try{
        const changingWrap=unboxing?.update(delta)||false;
        const changingAtmosphere=atmosphere?.update(delta)||false;
        const changed=controls?.update(autoRotate?delta:undefined);
        renderer.render(scene,camera);
        if(ready){ready=false;clearTimeout(deadline);options.onReady?.();}
        if(changingWrap||changingAtmosphere||autoRotate||(changed&&controls?.enableDamping))gate?.request();
      }catch{fail('The 3D view could not render on this device. Your original image and story remain available.');}
    });
    stopVisibility=observeViewerVisibility(host,gate);
    if(options.unboxing){
      document.addEventListener('visibilitychange',()=>{lastFrame=null;if(blurred)gate?.setHidden(true);},{signal:lifecycleEvents.signal});
      if(typeof window!=='undefined'){
        window.addEventListener('blur',()=>{blurred=true;lastFrame=null;gate?.setHidden(true);},{signal:lifecycleEvents.signal});
        window.addEventListener('focus',()=>{blurred=false;lastFrame=null;gate?.setHidden(document.visibilityState==='hidden');},{signal:lifecycleEvents.signal});
      }
    }
    observer = new ResizeObserver(resize); observer.observe(host); resize();
    const modelUrl=viewerAssetUrl(options.modelUrl,location.origin);
    deadline=setTimeout(()=>fail('The 3D gift took too long to open. Your original and story are available. Try again when your connection is ready.'),VIEWER_LOAD_TIMEOUT);
    void fetchViewerBytes(modelUrl.href,abort.signal,(state)=>{if(!dead)options.onProgress?.(state);}).then(bytes=>{
      if(dead)return null;
      if(bytes.byteLength<12||new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0,true)!==0x46546c67)throw new Error('VIEWER_MODEL_INVALID');
      return new GLTFLoader().parseAsync(bytes.buffer,new URL('.',modelUrl).href);
    }).then(async gltf=>{
      if(!gltf)return;
      if (dead) { disposeTree(gltf.scene); return; }
      const object = gltf.scene;

      if (typeof options.modelYaw === 'number' && Number.isFinite(options.modelYaw)) object.rotation.y += THREE.MathUtils.clamp(options.modelYaw, -Math.PI, Math.PI);
      object.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(object);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = 2.2 / Math.max(size.x, size.y, size.z, 0.01);
      object.scale.setScalar(scale);
      object.position.set(-center.x * scale, -bounds.min.y * scale + 0.07, -center.z * scale);
      if(!Number.isFinite(size.x+size.y+size.z)||Math.max(size.x,size.y,size.z)<=0){disposeTree(object);throw new Error('VIEWER_MODEL_INVALID');}
      object.traverse(item=>{
        if(!(item instanceof THREE.Mesh))return;
        if(options.unboxing){item.castShadow=true;item.receiveShadow=true;}
        for(const material of Array.isArray(item.material)?item.material:[item.material]){
          if(!(material instanceof THREE.MeshStandardMaterial)||modelMaterials.has(material))continue;
          modelMaterials.set(material,material.wireframe);
          if(displayMode==='wireframe')material.wireframe=true;
        }
      });
      focus.y=size.y*scale/2+0.07;home.y=focus.y+0.8;
      // Keep decoded sponsor geometry and materials intact. Original photographs live in the story UI.
      content.add(object);
      object.updateMatrixWorld(true);
      // Every orbit, wheel, pinch and explicit zoom shares this bound. Keep the
      // camera outside the decoded gift in every direction, with near-plane
      // clearance, while allowing its details to fill the viewport.
      const zoomSphere=new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
      modelMinDistance=zoomSphere.radius+zoomSphere.center.distanceTo(focus)+camera.near*2;
      if(controls&&!options.unboxing)controls.minDistance=modelMinDistance;
      atmosphere?.setComposition(focus,home);
      if(options.unboxing){
        object.updateMatrixWorld(true);const wrappedBounds=new THREE.Box3().setFromObject(object);
        unboxing=mountGiftUnboxing({host,parent:content,model:object,bounds:wrappedBounds,reduced,requestFrame:()=>gate?.request(),onReveal:()=>{reset();options.onReveal?.();renderer?.domElement.focus({preventScroll:true});}});
        content.traverse(item=>{if(item instanceof THREE.Mesh){item.castShadow=true;item.receiveShadow=true;}});
      }
      reset();clearTimeout(deadline);ready=true;gate?.request();
    }).catch(()=>{if(!dead)fail('The 3D gift could not be opened. Your original image and story are still available. Retry the gift view to try again.');});
  } catch {
    fail('3D is unavailable on this device. Explore the original image and story instead.');
  }
  return{destroy,reset,rotate,zoom,setDisplayMode,setWireframe,setAutoRotate,advanceUnboxing(){if(!dead)unboxing?.advance();},getUnboxingState(){return dead?'off':unboxing?.step||(options.unboxing?'loading':'off');}};
}
