import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import ts from 'typescript';

globalThis.__groundThree=THREE;
const source=ts.transpileModule(await readFile(new URL('../src/world-navigation.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/import \* as THREE from 'three';/,'const THREE=globalThis.__groundThree;').replace(/from 'three-mesh-bvh'/,`from '${import.meta.resolve('three-mesh-bvh')}'`);
const {createGroundNavigation}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
delete globalThis.__groundThree;
const floor=(width=8,depth=8)=>{const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.rotation.x=-Math.PI/2;mesh.position.y=-.6;return mesh;};
test('grounded movement retains eye height and rejects walls, edges and excessive range',()=>{
  const group=new THREE.Group();group.add(floor());
  const wall=new THREE.Mesh(new THREE.BoxGeometry(2,2,.05),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));wall.position.set(0,0,-.4);group.add(wall);
  const start=new THREE.Vector3(0,0,0),walk=createGroundNavigation(group,start);assert.ok(walk);assert.ok(Math.abs(walk.eyeHeight-.6)<1e-6);
  let next=start.clone();for(let i=0;i<20;i++)next=walk.advance(next,new THREE.Vector3(0,0,-.12));assert.ok(next.z>-.38);assert.ok(Math.abs(next.y)<1e-6);
  next=start.clone();for(let i=0;i<60;i++)next=walk.advance(next,new THREE.Vector3(.12,0,0));assert.ok(next.x<=2.5);
  const short=createGroundNavigation(floor(.8,.8),start);next=start.clone();for(let i=0;i<20;i++)next=short.advance(next,new THREE.Vector3(.12,0,0));assert.ok(next.x<.41);
});
test('missing floors and steep surfaces do not enable walking; invalid displacement never corrupts camera',()=>{
  assert.equal(createGroundNavigation(new THREE.Group(),new THREE.Vector3()),undefined);
  const steep=floor();steep.rotation.x=-.2;assert.equal(createGroundNavigation(steep,new THREE.Vector3()),undefined);
  const start=new THREE.Vector3(),walk=createGroundNavigation(floor(),start);assert.deepEqual(walk.advance(start,new THREE.Vector3(NaN,0,0)),start);assert.deepEqual(walk.advance(start,new THREE.Vector3()),start);
});
