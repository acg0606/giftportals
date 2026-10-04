import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import ts from 'typescript';
const compiled=ts.transpileModule(await readFile(new URL('../src/keepsake-atmosphere.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from 'three'/,`from '${import.meta.resolve('three')}'`);
const {mountKeepsakeAtmosphere}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const options={focus:new THREE.Vector3(0,1.17,0),cameraPosition:new THREE.Vector3(4.65,1.97,1.2),reduced:false};
test('lighting contains no authored meshes, particles or fog and preserves the sponsor model',()=>{
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial({color:'#79a7d1',roughness:.6}),model=new THREE.Mesh(geometry,material);scene.add(model);
  const lighting=mountKeepsakeAtmosphere(scene,options),before=model.position.clone();let visuals=0;lighting.group.traverse(item=>{if(item instanceof THREE.Mesh||item instanceof THREE.Points)visuals++;});assert.equal(visuals,0);assert.equal(scene.fog,null);assert.equal(scene.background.getHexString(),'f8f6f0');
  assert.ok(scene.getObjectByName('Gentle keepsake key') instanceof THREE.DirectionalLight);assert.ok(scene.getObjectByName('Soft keepsake ambient light') instanceof THREE.HemisphereLight);
  assert.equal(model.material,material);assert.equal(material.roughness,.6);assert.equal(material.color.getHexString(),'79a7d1');assert.ok(model.position.equals(before));lighting.destroy();geometry.dispose();material.dispose();
});
test('lighting never schedules animation regardless of motion preferences',()=>{
  const saved=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>{throw new Error('No private RAF allowed');};const lighting=mountKeepsakeAtmosphere(new THREE.Scene(),options);
  try{for(const value of [.05,1000,NaN,Infinity,-1])assert.equal(lighting.update(value),false);assert.equal(lighting.animated,false);lighting.setReduced(true);assert.equal(lighting.animated,false);lighting.setReduced(false);assert.equal(lighting.animated,false);}finally{lighting.destroy();if(saved===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=saved;}
});
test('destruction detaches once and restores the original background and fog',()=>{
  const scene=new THREE.Scene(),background=new THREE.Color('#123456'),fog=new THREE.Fog('#123456',12,24);scene.background=background;scene.fog=fog;const lighting=mountKeepsakeAtmosphere(scene,options);let disposed=0;lighting.group.traverse(item=>{if(item instanceof THREE.Light)item.addEventListener('dispose',()=>disposed++);});lighting.destroy();lighting.destroy();assert.equal(disposed,3);assert.equal(lighting.group.parent,null);assert.equal(scene.background,background);assert.equal(scene.fog,fog);assert.equal(lighting.update(.05),false);assert.equal(scene.children.length,0);
});