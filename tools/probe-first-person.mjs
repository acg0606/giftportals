// Offline ground and capsule corridor audit. No browser or provider calls.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  ['paris-v22', 'public/demo/v22/paris-collider.glb'],
  ['paris-approach-v23', 'public/demo/v23/paris-approach-collider.glb'],
  ['paris-riverside-v23', 'public/demo/v23/paris-riverside-collider.glb'],
  ['paris-summit-v23', 'public/demo/v23/paris-summit-collider.glb'],
  ['paris-v13', 'public/demo/v13/paris-collider.glb'],
  ['rio', 'public/demo/rio-collider.glb'],
  ['antikythera', 'public/demo/v13/antikythera-collider.glb'],
];
const cachedTrialByScene = {
  'paris-v22': 'paris-plus-v22-retry-20261003',
  'paris-approach-v23': 'paris-approach-v23-20261003',
  'paris-riverside-v23': 'paris-riverside-v23-20261003',
  'paris-summit-v23': 'paris-summit-v23-simple-20261003',
};
const hash = data => createHash('sha256').update(data).digest('hex');
const round = n => Number(n.toFixed(5));
const arr = v => v.toArray().map(round);
const report = { protocol: 'giftportals-collider-walk-audit-v24', checkedAt: new Date().toISOString(), units: 'Raw rotated asset coordinates, with per-scene metric calibration only where cached provider semantics are available. Provider metric scale is not geographic survey accuracy.', transform: 'rotateX(Math.PI); optional metric scale applied to rotated positions; groundPlaneOffset then added to rotated Y', methods: { cachedAssetsOnly: true, providerCalls: 0, metricEyeHeight: 1.65, metricCapsuleRadius: .20, unknownScaleEyeHeight: 1.55, unknownScaleCapsuleRadius: .18, floorGridStep: .5, maxSlopeDegrees: 47, maxFloorStep: .2, denseDirectionalStep: .05 }, sourceHashes: {}, scenes: [], limitations: ['Collider-only audit does not establish splat image fidelity, semantic water vs paving, actual geographic scale, or browser frame rate.', 'A coherent ground corridor should be visually checked against splats before selection.', 'Capsule clearance is sampled against actual coarse mesh; collider topology is not certified.', 'Grid connectivity samples endpoints and is a candidate-finding method; only dense directional corridors test intermediate floor and capsule clearances.', 'A sampled capsule-axis clearance is not a rigorous continuous swept capsule proof.', 'Three scenes lacking cached numeric metadata retain an explicitly uncalibrated artistic body.'] };
for (const src of ['src/generated-world.ts','src/world-navigation.ts','src/first-person-physics.ts']) report.sourceHashes[src] = hash(await readFile(resolve(app,src)));
for (const [id,path] of candidates) {
  let semantics;
  if (cachedTrialByScene[id]) {
    const receipt=JSON.parse(await readFile(resolve(app,`outputs/${id==='paris-v22'?'v22':'v23'}/${cachedTrialByScene[id]}-world-receipt.json`),'utf8'));
    const candidate=receipt.semantics;
    if(candidate&&Number.isFinite(candidate.metricScaleFactor)&&candidate.metricScaleFactor>0&&Number.isFinite(candidate.groundPlaneOffset))semantics={metricScaleFactor:candidate.metricScaleFactor,groundPlaneOffset:candidate.groundPlaneOffset};
  }
  const scale=semantics?.metricScaleFactor??1,eyeHeight=semantics?1.65/scale:1.55,radius=semantics?.metricScaleFactor ? .20/scale:.18,skin=.02/scale;
  const bytes=await readFile(resolve(app,path));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const root=gltf.scene;root.rotation.x=Math.PI;root.updateMatrixWorld(true);
  const meshes=[];
  root.traverse(mesh=>{if(!(mesh instanceof THREE.Mesh))return;mesh.geometry.boundsTree=new MeshBVH(mesh.geometry,{indirect:true,targetLeafSize:10});mesh.raycast=acceleratedRaycast;mesh.material.side=THREE.DoubleSide;meshes.push(mesh);});
  const bounds=new THREE.Box3().setFromObject(root), ray=new THREE.Raycaster();
  const floor=(x,z,ceiling=2.5)=>{
    ray.set(new THREE.Vector3(x,ceiling,z),new THREE.Vector3(0,-1,0));ray.far=20;ray.near=0;
    return ray.intersectObject(root,true).filter(h=>h.face).map(h=>({hit:h,normal:h.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld)).normalize()})).find(h=>Math.abs(h.normal.y)>=Math.cos(47*Math.PI/180));
  };
  const capsuleClearance=(x,z,floorY)=>{
    const bottom=new THREE.Vector3(x,floorY+radius+skin,z),top=new THREE.Vector3(x,floorY+eyeHeight+.12/scale-radius,z),segment=new THREE.Line3(bottom,top);
    let clearance=Infinity;
    for(const mesh of meshes){
      const inverse=mesh.matrixWorld.clone().invert(), local=new THREE.Line3(segment.start.clone().applyMatrix4(inverse),segment.end.clone().applyMatrix4(inverse));
      const center=local.getCenter(new THREE.Vector3()),box=new THREE.Box3().setFromPoints([local.start,local.end]);
      mesh.geometry.boundsTree.shapecast({boundsTraverseOrder: b=>b.distanceToPoint(center),intersectsBounds:b=>b.distanceToPoint(center)<=local.distance()/2+Math.min(clearance,1),intersectsTriangle:t=>{const distance=t.closestPointToSegment(local);if(distance<clearance)clearance=distance;return clearance<=radius;}});
    }
    return clearance;
  };
  const nodes=new Map(), grid=[];
  for(let xi=-16;xi<=16;xi++)for(let zi=-16;zi<=16;zi++){
    const x=xi*.5,z=zi*.5,h=floor(x,z);if(!h)continue;
    const y=h.hit.point.y;if(y>1.2||y<-6)continue;
    const clearance=capsuleClearance(x,z,y);if(clearance<radius)continue;
    const n={x,z,y,xi,zi,clearance,slope:Math.acos(Math.abs(h.normal.y))*180/Math.PI};nodes.set(`${xi},${zi}`,n);grid.push(n);
  }
  const components=[];const remaining=new Set(nodes.keys());
  while(remaining.size){const first=remaining.values().next().value,keys=[first],queue=[first];remaining.delete(first);while(queue.length){const k=queue.shift(),n=nodes.get(k);for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){const nk=`${n.xi+dx},${n.zi+dz}`,nn=nodes.get(nk);if(nn&&remaining.has(nk)&&Math.abs(nn.y-n.y)<=.2){remaining.delete(nk);keys.push(nk);queue.push(nk);}}}components.push(keys);}
  components.sort((a,b)=>b.length-a.length);
  const eligible=components[0]||[], near=eligible.map(k=>nodes.get(k)).sort((a,b)=>a.x*a.x+a.z*a.z-(b.x*b.x+b.z*b.z))[0];
  // Breadth-first path from nearest-origin floor to most distant connected node.
  let route=[];
  if(near){const start=`${near.xi},${near.zi}`,parents=new Map([[start,null]]),queue=[start];let far=start;while(queue.length){const k=queue.shift(),n=nodes.get(k);if(Math.hypot(n.x-near.x,n.z-near.z)>Math.hypot(nodes.get(far).x-near.x,nodes.get(far).z-near.z))far=k;for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){const nk=`${n.xi+dx},${n.zi+dz}`,nn=nodes.get(nk);if(nn&&!parents.has(nk)&&Math.abs(nn.y-n.y)<=.2){parents.set(nk,k);queue.push(nk);}}}let k=far;while(k!==null){const n=nodes.get(k);route.unshift({eye:[round(n.x),round(n.y+eyeHeight),round(n.z)],floorY:round(n.y),clearance:round(n.clearance),slopeDegrees:round(n.slope)});k=parents.get(k);}}
  const originFloor=floor(0,.03,.0);
  const directionalCorridors=[];
  if(near)for(let angle=0;angle<360;angle+=45){
    const rad=angle*Math.PI/180,dx=Math.sin(rad),dz=-Math.cos(rad),samples=[];let lastFloor=near.y,stoppedReason='maximum_distance',clearanceMin=Infinity;
    for(let i=0;i<=160;i++){
      const distance=i*.05,x=near.x+dx*distance,z=near.z+dz*distance,h=floor(x,z,lastFloor+.25);
      if(!h){stoppedReason='ground_missing';break;}
      const y=h.hit.point.y;
      if(Math.abs(y-lastFloor)>.1){stoppedReason='ground_discontinuity';break;}
      const clearance=capsuleClearance(x,z,y);if(clearance<radius+.01/scale){stoppedReason='capsule_clearance';break;}
      clearanceMin=Math.min(clearanceMin,clearance);lastFloor=y;samples.push({eye:[round(x),round(y+eyeHeight),round(z)],floorY:round(y),clearance:round(clearance)});
    }
    directionalCorridors.push({yawDegrees:angle,length:round(Math.max(0,samples.length-1)*.05),minimumSampledCapsuleAxisClearance:samples.length?round(clearanceMin):null,stoppedReason,from:samples[0]?.eye,to:samples.at(-1)?.eye,samples});
  }
  const rawSpawn=near?[round(near.x),round(near.y+eyeHeight),round(near.z)]:null;
  const scene={id,path,bytes:bytes.length,sha256:hash(bytes),bounds:{min:arr(bounds.min),max:arr(bounds.max)},semantics:semantics??null,body:{rawEyeHeight:round(eyeHeight),rawCapsuleRadius:round(radius),calibration:semantics?'provider-metric':'artistic-unverified'},originFloor:originFloor?round(originFloor.hit.point.y):null,originEyeHeight:originFloor?round(-originFloor.hit.point.y):null,validGridCells:grid.length,largestComponents:components.slice(0,5).map(c=>c.length),spawn:near?{eye:rawSpawn,floorY:round(near.y),clearance:round(near.clearance),metricEye:semantics?[round(rawSpawn[0]*scale),round(rawSpawn[1]*scale+semantics.groundPlaneOffset),round(rawSpawn[2]*scale)]:null}:null,corridor:route,corridorLength:route.length?round((route.length-1)*.5):0,directionalCorridors};
  report.scenes.push(scene);console.log(JSON.stringify({id,originFloor:scene.originFloor,originEyeHeight:scene.originEyeHeight,validGridCells:scene.validGridCells,largestComponents:scene.largestComponents,spawn:scene.spawn,corridorLength:scene.corridorLength,last:route.at(-1)}));
  for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}
}
await mkdir(resolve(app,'outputs/v24'),{recursive:true});await writeFile(resolve(app,'outputs/v24/collider-walk-audit.json'),JSON.stringify(report,null,2));
