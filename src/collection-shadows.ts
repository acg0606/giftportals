import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {fetchViewerBytes,viewerAssetUrl} from './viewer-runtime';

export interface CollectionShadowsOptions {
 scene:THREE.Scene;renderer:THREE.WebGLRenderer;light:THREE.DirectionalLight;
 source:string;origin:string;signal:AbortSignal;isCurrent():boolean;
 worldPosition:readonly[number,number,number];worldRotation:readonly[number,number,number];worldScale:number;
 casters():readonly THREE.Object3D[];validateGLB(bytes:Uint8Array):void;
 onInvalidate():void;onState?(state:'ready'|'unavailable'):void;
}
export interface CollectionShadowsHandle {beforeRender(mobile:boolean):void;invalidate():void;destroy():void}

/** The receiver is an exact subset of the provider collider. It contributes
 * only shadow alpha; neither its surface nor its depth replaces the splats. */
export function mountCollectionShadows(options:CollectionShadowsOptions):CollectionShadowsHandle {
 const {scene,renderer,light}=options,controller=new AbortController(),casts=new Map<THREE.Mesh,boolean>();
 let dead=false,dirty=true,receiver:THREE.Group|undefined,release:(()=>void)|undefined,signature='',mapSize=0;
 const footprints={value:[new THREE.Vector4(),new THREE.Vector4(),new THREE.Vector4()]},supportHeights={value:new THREE.Vector3()},contactCount={value:0};
 const active=()=>!dead&&!controller.signal.aborted&&options.isCurrent();
 const abort=()=>controller.abort();options.signal.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>{controller.abort();if(!dead&&options.isCurrent())options.onState?.('unavailable');},12_000);
 function resources(body:THREE.Object3D){
  const geometry=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  body.traverse(object=>{if(object instanceof THREE.Mesh){geometry.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material]){materials.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);}}});
  let disposed=false;
  return {materials,dispose(){if(disposed)return;disposed=true;const closed=new Set<unknown>();for(const texture of textures){const image=texture.image as{close?():void}|undefined;if(image?.close&&!closed.has(image)){closed.add(image);image.close();}texture.dispose();}geometry.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());body.removeFromParent();body.clear();}};
 }
 async function load(){
  try{
   const bytes=await fetchViewerBytes(viewerAssetUrl(options.source,options.origin).href,controller.signal);
   if(bytes.byteLength>512*1024)throw new Error('COLLECTION_SHADOW_LIMIT');options.validateGLB(bytes);controller.signal.throwIfAborted();if(!active())return;
   const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{if(!url.startsWith('blob:'))throw new Error('COLLECTION_SHADOW_EXTERNAL_RESOURCE');return url;});
   const {scene:body}=await new GLTFLoader(manager).parseAsync(bytes.buffer as ArrayBuffer,'');
   const owned=resources(body);let transferred=false;
   try{
    if(!active())return;
    let vertices=0,triangles=0;body.traverse(object=>{
     if(![...object.position.toArray(),...object.quaternion.toArray(),...object.scale.toArray(),...object.matrix.elements].every(Number.isFinite))throw new Error('COLLECTION_SHADOW_INVALID');
     if(!(object instanceof THREE.Mesh))return;
     const count=object.geometry.getAttribute('position')?.count||0;vertices+=count;triangles+=(object.geometry.index?.count||count)/3;
     if(!count||vertices>20_000||triangles>20_000||object instanceof THREE.SkinnedMesh)throw new Error('COLLECTION_SHADOW_LIMIT');
    });if(!vertices)throw new Error('COLLECTION_SHADOW_INVALID');
    const material=new THREE.ShadowMaterial({color:'#342a20',opacity:.18,depthWrite:false});owned.materials.add(material);
    // The provider mesh stays exact. Fade only shadow alpha beyond the real
    // casters' support footprints, where collider facets are least reliable.
    material.onBeforeCompile=shader=>{
     shader.uniforms.collectionFootprints=footprints;shader.uniforms.collectionSupportHeights=supportHeights;shader.uniforms.collectionContactCount=contactCount;
     shader.vertexShader='varying vec3 collectionShadowWorld;\n'+shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\ncollectionShadowWorld = worldPosition.xyz;');
     shader.fragmentShader='varying vec3 collectionShadowWorld;\nuniform vec4 collectionFootprints[3];\nuniform vec3 collectionSupportHeights;\nuniform int collectionContactCount;\n'+shader.fragmentShader.replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',`float contact = 0.0;
      for (int i=0;i<3;i++) { if(i>=collectionContactCount) break;
       vec4 footprint=collectionFootprints[i];
       vec2 outside=max(abs(collectionShadowWorld.xz-footprint.xy)-footprint.zw,vec2(0.0));
       float horizontal=1.0-smoothstep(0.0,0.045,length(outside));
       float vertical=1.0-smoothstep(0.02,0.065,abs(collectionShadowWorld.y-collectionSupportHeights[i]));
       contact=max(contact,horizontal*vertical);
      }
      gl_FragColor=vec4(color,opacity*(1.0-getShadowMask())*contact);`);
    };material.customProgramCacheKey=()=> 'gp-provider-contact-v1';
    body.traverse(object=>{if(object instanceof THREE.Mesh){object.material=material;object.castShadow=false;object.receiveShadow=true;object.renderOrder=10;if(!object.geometry.hasAttribute('normal'))object.geometry.computeVertexNormals();}});
    const root=new THREE.Group();root.name='World Labs desk shadow receiver';root.userData.provider='WorldLabs';root.rotation.set(...options.worldRotation);root.position.set(...options.worldPosition);root.scale.setScalar(options.worldScale);root.add(body);root.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(root);if(bounds.isEmpty()||![...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite))throw new Error('COLLECTION_SHADOW_INVALID');
    receiver=root;release=()=>{root.removeFromParent();owned.dispose();root.clear();};scene.add(root);transferred=true;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
    light.castShadow=true;light.shadow.autoUpdate=false;light.shadow.bias=-.0001;light.shadow.normalBias=.001;scene.add(light.target);
    options.onState?.('ready');options.onInvalidate();
   }finally{if(!transferred)owned.dispose();}
  }catch{if(active())options.onState?.('unavailable');}
  finally{clearTimeout(timer);}
 }
 function visible(root:THREE.Object3D){for(let value:THREE.Object3D|null=root;value;value=value.parent)if(!value.visible)return false;return true;}
 function beforeRender(mobile:boolean){
  if(!active()||!receiver)return;
  const roots=options.casters().filter(visible),next=roots.map(root=>root.id).join(','),size=mobile?512:1024;
  if(next!==signature){signature=next;dirty=true;}
  for(const root of roots)root.traverse(object=>{if(object instanceof THREE.Mesh){if(!casts.has(object))casts.set(object,object.castShadow);object.castShadow=true;}});
  if(mapSize!==size){mapSize=size;light.shadow.map?.dispose();light.shadow.mapPass?.dispose();light.shadow.map=null;light.shadow.mapPass=null;light.shadow.mapSize.set(size,size);dirty=true;}
  if(!dirty)return;
  scene.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(receiver);contactCount.value=Math.min(3,roots.length);
  for(const[index,root]of roots.entries()){const caster=new THREE.Box3().setFromObject(root);bounds.union(caster);if(index<3){const size=caster.getSize(new THREE.Vector3()),center=caster.getCenter(new THREE.Vector3());footprints.value[index].set(center.x,center.z,size.x/2,size.z/2);supportHeights.value.setComponent(index,caster.min.y);}}
  const center=bounds.getCenter(new THREE.Vector3());light.target.position.copy(center);light.target.updateMatrixWorld();
  const camera=light.shadow.camera;camera.position.copy(light.position);camera.lookAt(center);camera.updateMatrixWorld(true);
  let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity,near=Infinity,far=0;
  for(const x of[bounds.min.x,bounds.max.x])for(const y of[bounds.min.y,bounds.max.y])for(const z of[bounds.min.z,bounds.max.z]){const point=new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse);left=Math.min(left,point.x);right=Math.max(right,point.x);bottom=Math.min(bottom,point.y);top=Math.max(top,point.y);near=Math.min(near,-point.z);far=Math.max(far,-point.z);}
  camera.left=left-.12;camera.right=right+.12;camera.bottom=bottom-.12;camera.top=top+.12;camera.near=Math.max(.05,near-.5);camera.far=Math.max(camera.near+1,far+.5);camera.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate=true;light.shadow.needsUpdate=true;dirty=false;
 }
 function destroy(){
  if(dead)return;dead=true;controller.abort();clearTimeout(timer);options.signal.removeEventListener('abort',abort);release?.();release=undefined;receiver=undefined;
  for(const[mesh,value]of casts)mesh.castShadow=value;casts.clear();light.castShadow=false;light.target.removeFromParent();light.shadow.dispose();light.shadow.map=null;light.shadow.mapPass=null;renderer.shadowMap.enabled=false;renderer.shadowMap.needsUpdate=false;
 }
 void load();return{beforeRender,invalidate(){dirty=true;},destroy};
}
