import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import ts from 'typescript';
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const{deriveWalkingTour,createWalkingTourSession}=await import(data(compile(await readFile(new URL('../src/walking-tour.ts',import.meta.url),'utf8'))));
const physics=compile(await readFile(new URL('../src/first-person-physics.ts',import.meta.url),'utf8')).replace(/from ['"]three['"]/g,`from '${import.meta.resolve('three')}'`).replace(/from ['"]@dimforge\/rapier3d-compat['"]/g,`from '${import.meta.resolve('@dimforge/rapier3d-compat')}'`);
const{createFirstPersonPhysics}=await import(data(physics));
const{createGiftWalkScenes}=await import(data(compile(await readFile(new URL('../src/gift-walk-catalog.ts',import.meta.url),'utf8'))));
const calibration=compile(await readFile(new URL('../src/walk-calibration.ts',import.meta.url),'utf8')).replace(/from ['"]three['"]/g,`from '${import.meta.resolve('three')}'`).replace(/from ['"]three-mesh-bvh['"]/g,`from '${import.meta.resolve('three-mesh-bvh')}'`);
const{findWalkSpawn}=await import(data(calibration));
const{walkSceneFirstPerson}=await import(data(compile(await readFile(new URL('../src/gift-walk-types.ts',import.meta.url),'utf8'))));
const floor=(w=30,d=30)=>{const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.rotation.x=-Math.PI/2;return mesh;};
const dispose=root=>root.traverse(node=>{if(node instanceof THREE.Mesh){node.geometry.dispose();for(const m of Array.isArray(node.material)?node.material:[node.material])m.dispose();}});
const create=(root,spawn=[0,1.65,0])=>createFirstPersonPhysics(root,{spawn,eyeHeight:1.65,radius:.2,maxRadius:20});
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);

test('connected real capsule paths yield a two-minute six-chapter approach/detail/return tour and restore spawn',async()=>{
 const root=floor(),controller=await create(root);
 try{const plan=deriveWalkingTour(controller,0);assert.ok(plan);assert.equal(plan.chapters.length,6);assert.ok(plan.estimatedDurationMs>=130000&&plan.estimatedDurationMs<150000);assert.ok(plan.distance>23&&plan.distance<25);assert.deepEqual(controller.reset(),controller.spawn);
  assert.deepEqual(plan.chapters.map(c=>c.title),['Take in the place','Into the scene','A closer look','Another perspective','Stay a little','Back at the beginning']);
  for(const chapter of plan.chapters){assert.ok(chapter.fov>=56&&chapter.fov<=75);assert.ok(chapter.dwellMs>=9000&&chapter.dwellMs<=18000);for(const p of chapter.path){assert.ok(p.every(Number.isFinite));assert.ok(distance(p,controller.spawn)<=6.05);}}
  let position=controller.reset(),session=createWalkingTourSession(plan),ticks=0;while(session.state().phase==='playing'&&ticks++<4000){const pose=session.step(50,position,controller.advance);assert.ok(pose.position.every(Number.isFinite));assert.ok(distance(position,pose.position)<=.028+.001);position=pose.position;}
  assert.equal(session.state().phase,'completed');assert.ok(ticks*50>=130000&&ticks*50<155000);assert.ok(Math.abs(ticks*50-plan.estimatedDurationMs)<8000);assert.ok(distance(position,controller.spawn)<.04);
 }finally{controller.destroy();dispose(root);}
});

test('an island cannot produce a guided bridge, and an interrupted audit restores the capsule',async()=>{
 const root=floor(1.8,1.8),controller=await create(root);try{assert.equal(deriveWalkingTour(controller),undefined);assert.deepEqual(controller.reset(),controller.spawn);
  let resets=0;const failing={...controller,reset(){resets++;return controller.reset();},advance(){throw Error('interrupted audit');}};assert.throws(()=>deriveWalkingTour(failing),/interrupted audit/);assert.ok(resets>=3);assert.deepEqual(controller.reset(),controller.spawn);
 }finally{controller.destroy();dispose(root);}
});

test('Next never skips through geometry, movement stalls are bounded, pause and reduced motion prevent catch-up',async()=>{
 const root=floor(),controller=await create(root);try{const plan=deriveWalkingTour(controller),session=createWalkingTourSession(plan);let position=controller.reset();
  session.next();session.step(0,position,controller.advance);assert.equal(session.state().index,1);session.next();const first=session.step(100000,position,controller.advance);assert.ok(distance(first.position,position)<=.055+.001);assert.equal(session.state().index,1);position=first.position;
  session.pause('hidden');const paused=session.step(60000,position,()=>assert.fail('paused physics'));assert.deepEqual(paused.position,position);assert.equal(session.resume(),true);session.motion(true);assert.equal(session.state().phase,'paused');assert.equal(session.resume(),false);session.step(100000,position,()=>assert.fail('reduced motion must be still'));
  const still=session.staticNext();assert.ok(still.position.every(Number.isFinite));assert.equal(session.state().index,2);session.stop();assert.equal(session.state().phase,'idle');
  const stuck=createWalkingTourSession(plan);stuck.next();stuck.step(0,controller.spawn,controller.advance);for(let i=0;i<30;i++)stuck.step(100,controller.spawn,p=>({position:[...p],grounded:true}));assert.equal(stuck.state().phase,'paused');assert.equal(stuck.state().reason,'blocked');assert.equal(stuck.resume(),false);
 }finally{controller.destroy();dispose(root);}
});

test('visible low frame rates preserve observation duration while translated frames remain bounded',async()=>{
 const root=floor(),controller=await create(root);try{const plan=deriveWalkingTour(controller),session=createWalkingTourSession(plan);let position=controller.reset();
  for(let i=0;i<11;i++)session.step(1000,position,controller.advance);assert.equal(session.state().index,0);session.step(1000,position,controller.advance);assert.equal(session.state().index,1);
  const next=session.step(1000,position,controller.advance);assert.ok(distance(next.position,position)<=.055+.001);assert.equal(session.state().index,1);
 }finally{controller.destroy();dispose(root);}
});

test('near-180-degree returns turn consistently in place until the real eye is aligned',async()=>{
 const root=floor(),controller=await create(root,[0,1.65,-1]);try{
  for(const epsilon of[-.0000001,.0000001]){
   const arrival=controller.reset(),path=[arrival,[epsilon,arrival[1],0]],plan={chapters:[{title:'Return',note:'',path,yaw:Math.PI,fov:72,dwellMs:1000}],distance:1,estimatedDurationMs:7000},session=createWalkingTourSession(plan);let position=arrival,yaw=0,calls=0,moving=false;
   for(let frame=0;frame<100&&!moving;frame++){
    const before=calls,pose=session.step(50,position,(...args)=>{calls++;return controller.advance(...args);},yaw);
    if(pose.turning){assert.deepEqual(pose.position,position);assert.equal(calls,before);assert.ok(pose.yaw-yaw>0,'both sides of the yaw seam use the same turn direction');}
    else if(pose.moving){assert.ok(Math.abs(pose.yaw-yaw)<=.1);moving=true;}
    yaw+=Math.max(-.04,Math.min(.04,pose.yaw-yaw));position=pose.position;
   }
   assert.equal(moving,true);assert.ok(calls>0);assert.ok(yaw>3,'navigation starts after the turn, never while facing backwards');
  }
 }finally{controller.destroy();dispose(root);}
});

test('a slow frame spends its motion budget across multiple original waypoints with small collision substeps',()=>{
 const path=Array.from({length:151},(_,i)=>[0,1.65,-i*.04]),plan={chapters:[{title:'Straight',note:'',path,yaw:0,fov:75,dwellMs:1000}],distance:6,estimatedDurationMs:12000};const runs=[];
 for(const elapsed of[1000/60,1000/30,100]){const session=createWalkingTourSession(plan);let position=[0,1.65,0],calls=0;for(let ms=0;ms<1000-.001;ms+=elapsed){const pose=session.step(elapsed,position,(eye,delta,seconds)=>{calls++;assert.ok(Math.hypot(delta[0],delta[2])<=.55/60+.000001);assert.ok(seconds<=1/60+.000001);return {position:eye.map((v,i)=>v+delta[i]),grounded:true};},0);position=pose.position;}runs.push(-position[2]);assert.ok(calls>=60);}
 for(const travelled of runs)assert.ok(Math.abs(travelled-.55)<.000001,'waypoint spacing does not change commanded speed at 10/30/60 fps');
});

for(const[id,manifest]of[
 ['rio-example','/demo/v12/rio-generated-gift.json'],
 ['paris-example','/demo/v11/paris-generated-gift.json'],
])test(`${id}: the actual matching transformed collider supplies only grounded continuous chapters`,async()=>{
 const gift=JSON.parse(await readFile(new URL('../public'+manifest,import.meta.url),'utf8'));
 const scene=createGiftWalkScenes(id,gift)[0],bytes=await readFile(new URL('../public'+scene.collider,import.meta.url)),parsed=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const root=parsed.scene;root.rotation.x=Math.PI;root.scale.setScalar(scene.metricScale);root.position.y=scene.groundOffset;
 const options=walkSceneFirstPerson(scene),spawn=options.autoCalibrate?findWalkSpawn(root,options.spawn||[0,scene.groundOffset,0],options.eyeHeight,options.radius):options.spawn;
 assert.ok(spawn,`${id}: the matching mesh must support the preferred human arrival`);
 if(id==='rio-example'){
  assert.equal(scene.collider,gift.collisionUrl);assert.equal(scene.world,gift.worldUrl);assert.equal(scene.panorama,gift.panoramaUrl);
  assert.equal(scene.metricScale,gift.worldSemantics.metricScaleFactor);assert.equal(scene.groundOffset,gift.worldSemantics.groundPlaneOffset);assert.equal(options.autoCalibrate,true);
  assert.deepEqual(scene.spawn,gift.initialSpawn);assert.ok(gift.initialSpawn,'The approved Rio manifest provides its own supported arrival');
  assert.ok(distance(spawn,gift.initialSpawn)<=2.000001,'Calibration stays within the supported arrival search');
 }
 const controller=await createFirstPersonPhysics(root,{...options,spawn});
 try{const plan=deriveWalkingTour(controller,scene.yaw);assert.ok(plan,`${id} supports a connected real walk`);assert.ok(plan.chapters.length>=4&&plan.chapters.length<=6);assert.ok(plan.estimatedDurationMs>=55000&&plan.estimatedDurationMs<155000);
  assert.ok(plan.chapters.every(chapter=>chapter.path.every(p=>p.every(Number.isFinite)&&distance(p,controller.spawn)<=6.05)));assert.deepEqual(controller.reset(),controller.spawn);
  let groundedSteps=0;const advance=(...args)=>{const result=controller.advance(...args);assert.equal(result.grounded,true,`${id}: every tour substep stays on the actual collider`);groundedSteps++;return result;};
  const session=createWalkingTourSession(plan);let position=controller.reset(),yaw=scene.yaw,ticks=0,turnFrames=0,straightYaw=[];while(session.state().phase==='playing'&&ticks++<12000){const before=session.state(),pose=session.step(1000/60,position,advance,yaw);assert.ok(pose.position.every(Number.isFinite));if(pose.turning){turnFrames++;assert.deepEqual(pose.position,position,'alignment never translates the body');}const change=Math.max(-.8/60,Math.min(.8/60,pose.yaw-yaw));if(before.index===1&&pose.moving&&ticks/60>15)straightYaw.push(Math.abs(change)*180/Math.PI);yaw+=change;position=pose.position;}
  assert.equal(session.state().phase,'completed',`${id}: ${JSON.stringify(session.state())}`);assert.ok(distance(position,controller.spawn)<.06);
  assert.ok(groundedSteps>100,'Continuous physical movement is exercised beyond the starting floor');
  assert.ok(turnFrames>100,'real returns align before translating');straightYaw.sort((a,b)=>a-b);assert.ok(straightYaw.length>100);assert.ok(straightYaw[Math.floor(straightYaw.length*.99)]<.08,`${id}: stable route yaw excludes capsule correction jitter`);
 }finally{controller.destroy();dispose(root);}
});
