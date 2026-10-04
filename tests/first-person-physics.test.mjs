import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ts from 'typescript';

const source = await readFile(new URL('../src/first-person-physics.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`)
  .replace(/from ['"]@dimforge\/rapier3d-compat['"]/g, `from '${import.meta.resolve('@dimforge/rapier3d-compat')}'`);
const { createFirstPersonPhysics } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const motionSource = await readFile(new URL('../src/first-person-motion.ts', import.meta.url), 'utf8');
const motionCompiled = ts.transpileModule(motionSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { createFirstPersonMotion } = await import(`data:text/javascript;base64,${Buffer.from(motionCompiled).toString('base64')}`);
const floor = (width = 30, depth = 30) => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
};
const meshBox = (w,h,d,x,y,z) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.set(x,y,z); return mesh;
};
const create = (root, spawn = [0,1.65,0], extra = {}) => createFirstPersonPhysics(root, { spawn, eyeHeight: 1.65, radius: .20, maxRadius: 20, ...extra });
const walk = (physics, displacement, count, start = physics.spawn) => {
  let position = start.slice(), grounded = false;
  for (let i=0;i<count;i++) ({ position,grounded } = physics.advance(position, displacement, 1/120));
  return { position,grounded };
};
const dispose = root => root.traverse(item=> { if(item instanceof THREE.Mesh) { item.geometry.dispose(); for (const material of Array.isArray(item.material)?item.material:[item.material]) material.dispose(); } });

test('real Rapier capsule walks continuously across floor beyond the old 2.5-unit radius', async () => {
  const root = floor(), physics = await create(root);
  try {
    const moved = walk(physics, [0,0,-.01], 700);
    assert.ok(moved.position[2] < -6.6, JSON.stringify(moved));
    assert.ok(Math.abs(moved.position[1] - 1.668) < .025, JSON.stringify(moved));
    assert.equal(moved.grounded, true);
    assert.deepEqual(physics.reset(), physics.spawn);
  } finally { physics.destroy(); physics.destroy(); dispose(root); }
});

test('capsule stops at solid wall and slides tangentially while preserving eye height', async () => {
  const root = new THREE.Group(); root.add(floor(), meshBox(10,3,.1,0,1.5,-2));
  const physics = await create(root);
  try {
    const blocked = walk(physics, [0,0,-.01], 300);
    assert.ok(blocked.position[2] > -1.76 && blocked.position[2] < -1.60, JSON.stringify(blocked));
    const sliding = walk(physics, [.01,0,-.01], 240);
    assert.ok(sliding.position[0] > 2.2, JSON.stringify(sliding));
    assert.ok(sliding.position[2] > -1.76, JSON.stringify(sliding));
    assert.ok(Math.abs(sliding.position[1] - physics.spawn[1]) < .03, JSON.stringify(sliding));
  } finally { physics.destroy(); dispose(root); }
});

test('provider mesh edges do not introduce an invented floor or let the player fall out', async () => {
  const root = floor(2,2), physics = await create(root);
  try {
    const moved = walk(physics, [.01,0,0], 400);
    assert.ok(moved.position[0] > .6 && moved.position[0] <= 1.001, JSON.stringify(moved));
    assert.ok(moved.position[1] > 1.6, JSON.stringify(moved));
    const invalid = physics.advance([NaN,0,0],[Infinity,0,0], NaN);
    assert.ok(invalid.position.every(Number.isFinite));
    assert.deepEqual(invalid.position,moved.position);
  } finally { physics.destroy(); dispose(root); }
});

test('small real steps climb and snap back down; large obstacles remain blocked', async () => {
  const root = new THREE.Group(); root.add(floor(),meshBox(4,.12,1,0,.06,-1.5));
  const physics = await create(root);
  try {
    const onStep = walk(physics,[0,0,-.01],150);
    assert.ok(onStep.position[2] < -1.4, JSON.stringify(onStep));
    assert.ok(onStep.position[1] > 1.75 && onStep.position[1] < 1.82, JSON.stringify(onStep));
    const down = walk(physics,[0,0,-.01],150,onStep.position);
    assert.ok(down.position[2] < -2.8, JSON.stringify(down));
    assert.ok(Math.abs(down.position[1]-physics.spawn[1]) < .03, JSON.stringify(down));
  } finally { physics.destroy(); dispose(root); }
});

test('invalid dimensions and missing floors reject before presenting a walking mode', async () => {
  await assert.rejects(create(new THREE.Group()), /WALK_COLLIDER_INVALID/);
  const root=floor();
  try {
    await assert.rejects(create(root,[NaN,1,0]), /WALK_CONFIGURATION_INVALID/);
    await assert.rejects(create(root,[0,1]), /WALK_CONFIGURATION_INVALID/);
    await assert.rejects(create(root,[0,1,0],{radius:-1}), /WALK_CONFIGURATION_INVALID/);
    await assert.rejects(create(root,[0,1,0],{radius:NaN}), /WALK_CONFIGURATION_INVALID/);
    await assert.rejects(create(root,[0,1,0],{maxRadius:NaN}), /WALK_CONFIGURATION_INVALID/);
    await assert.rejects(create(root,[0,1,0],{maxRadius:Infinity}), /WALK_CONFIGURATION_INVALID/);
    await assert.rejects(create(root,[0,1,0],{maxRadius:0}), /WALK_CONFIGURATION_INVALID/);
    await assert.rejects(create(root,[0,1,0],{eyeHeight:4}), /WALK_CONFIGURATION_INVALID/);
    await assert.rejects(create(root,[50,1,50]), /WALK_SPAWN_HAS_NO_FLOOR/);
  } finally { dispose(root); }
});

for(const scene of [
  { id: 'V22 Paris promenade', path: '../public/demo/v22/paris-collider.glb', scale: 2.578505, offset: 1.5054234, spawn: [-1.2892525,-.3125626848,-1.2892525] },
  { id: 'V23 Eiffel approach', path: '../public/demo/v23/paris-approach-collider.glb', scale: 2.9049978, offset: 1.6893421, spawn: [0,1.329693671938,0] },
]) test(`${scene.id}: actual cached collider supports an uninterrupted metric walk`, async () => {
  const bytes = await readFile(new URL(scene.path,import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const root=gltf.scene; root.rotation.x=Math.PI;root.scale.setScalar(scene.scale);root.position.y=scene.offset;
  const physics = await create(root,scene.spawn);
  try {
    const moved=walk(physics,[0,0,-.01],1700);
    assert.ok(moved.position[2] < physics.spawn[2]-16.5, JSON.stringify({spawn:physics.spawn,...moved}));
    assert.ok(Math.abs(moved.position[1]-physics.spawn[1]) < .5, JSON.stringify(moved));
    assert.ok(physics.triangles > 1000 && physics.meshes > 0);
    assert.ok(moved.position.every(Number.isFinite));
  } finally { physics.destroy(); dispose(root); }
});

for(const scene of [
  { id: 'V22 Paris promenade', path: '../public/demo/v22/paris-collider.glb', scale: 2.578505, offset: 1.5054234, spawn: [-1.2892525,-.3125626848,-1.2892525] },
  { id: 'V23 Eiffel approach', path: '../public/demo/v23/paris-approach-collider.glb', scale: 2.9049978, offset: 1.6893421, spawn: [0,1.329693671938,0] },
]) test(`${scene.id}: actual motion and Rapier compose into sustained walking at 30, 40 and 60 fps`, async () => {
  const bytes = await readFile(new URL(scene.path,import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const root=gltf.scene; root.rotation.x=Math.PI;root.scale.setScalar(scene.scale);root.position.y=scene.offset;
  const physics=await create(root,scene.spawn);
  const measured=[];
  try {
    for(const fps of [30,40,60]) {
      physics.reset();
      const locomotion=createFirstPersonMotion(physics.spawn,{walkSpeed:1.6,sprintSpeed:2.7,acceleration:9,damping:13,strideLength:1.2,headSway:.009,maxHorizontalCorrection:.02});
      const corrections=[];
      for(let frame=0;frame<fps*8;frame++)locomotion.step(1/fps,{forward:1,strafe:0,yaw:0},(position,displacement,dt)=>{
        const result=physics.advance(position,displacement,dt);
        if(corrections.length<12)corrections.push({position,displacement,dt,result,requestedLength:Math.hypot(displacement[0],displacement[2]),actualLength:Math.hypot(result.position[0]-position[0],result.position[2]-position[2]),verticalCorrection:result.position[1]-position[1]});
        return result;
      });
      const state=locomotion.snapshot();
      if(state.distance<10)console.log('Rapier-motion-corrections',JSON.stringify(corrections));
      measured.push({scene:scene.id,fps,seconds:8,commandedSpeed:1.6,distance:state.distance,forwardDistance:physics.spawn[2]-state.position[2],grounded:state.grounded,finalPosition:state.position});
      assert.ok(state.distance>10,JSON.stringify({fps,...state}));
      assert.ok(state.position[2]<physics.spawn[2]-10,JSON.stringify({fps,...state}));
      assert.equal(state.grounded,true);
    }
    console.log('Rapier-motion-measurements',JSON.stringify(measured));
    const distances=measured.map(m=>m.forwardDistance);
    assert.ok(Math.max(...distances)-Math.min(...distances)<1,'Real collider contact corrections must retain comparable movement across browser frame rates.');
  } finally {physics.destroy();dispose(root);}
});
