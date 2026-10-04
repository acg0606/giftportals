import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../src/world-navigation.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/import \* as THREE from 'three';/,`import * as THREE from '${import.meta.resolve('three')}';`).replace(/from 'three-mesh-bvh'/,`from '${import.meta.resolve('three-mesh-bvh')}'`);
const {createGroundNavigation}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const reports=[];
for(const [name,file] of [['Rio','../public/demo/rio-collider.glb'],['Bamboo','../.local-giftportals/312bb8d2-93d9-4660-91a2-d89a7b8a2070/collider.glb']]){
  const bytes=await readFile(new URL(file,import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  gltf.scene.rotation.x=Math.PI;gltf.scene.traverse(item=>{if(item instanceof THREE.Mesh)for(const mat of Array.isArray(item.material)?item.material:[item.material])mat.side=THREE.DoubleSide;});
  const start=new THREE.Vector3(0,0,.03),nav=createGroundNavigation(gltf.scene,start);
  let current=start.clone();const began=performance.now();for(let i=0;nav&&i<8;i++)current=nav.advance(current,new THREE.Vector3(0,0,-.12));
  reports.push({name,bytes:bytes.byteLength,walkingAvailable:Boolean(nav),eyeHeight:nav?.eyeHeight,afterEightSteps:current.toArray(),distance:current.distanceTo(start),averageStepMs:(performance.now()-began)/8});
}
await mkdir(new URL('../outputs/v11/',import.meta.url),{recursive:true});
await writeFile(new URL('../outputs/v11/ground-probe.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),basis:'Actual World Labs collider GLBs, Three raycasting; browser rendering verified separately.',reports},null,2));
console.log(JSON.stringify(reports));
