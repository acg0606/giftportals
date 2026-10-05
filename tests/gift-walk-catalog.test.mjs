import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const canonical = 'C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals';
const project = fileURLToPath(new URL('../', import.meta.url));
const assetProject = existsSync(resolve(project, 'public/demo')) ? project : process.env.GIFTPORTALS_TEST_APP_ROOT || canonical;
let require = createRequire(import.meta.url);
try { require.resolve('typescript'); } catch { require = createRequire(resolve(canonical, 'package.json')); }
const ts = require('typescript');
const compiled = ts.transpileModule(await readFile(new URL('../src/gift-walk-catalog.ts', import.meta.url), 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const { createGiftWalkScenes, readGiftWorldSemantics, readGiftWorldSpawn, readGiftWorldEyeHeight } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const gift = extra => ({title:'The memory title',senderName:'The sender',recipientName:'The recipient',dedication:'  For the person I remember.  ',story:'  This is our own story, with its exact meaning.  ',worldUrl:'/private/world.spz',collisionUrl:'/private/collider.glb',panoramaUrl:'/private/panorama.png',...extra});

for (const profile of [
  {id:'paris-example',views:3,scale:2.9049978,offset:1.6893421,mode:'book'},
  {id:'antikythera-example',views:3,scale:2.4615827,offset:1.4774647,mode:'tablet'},
]) test(`${profile.id}: audited views retain the calibrated body, story and independent visitor routes`, () => {
  const input = freeze(gift()), snapshot = structuredClone(input), scenes = createGiftWalkScenes(profile.id, input);
  assert.equal(scenes.length, profile.views); assert.equal(new Set(scenes.map(scene => scene.id)).size, scenes.length); assert.equal(new Set(scenes.map(scene => JSON.stringify(scene.spawn))).size, scenes.length);
  for (const scene of scenes) {
    assert.equal(scene.metricScale, profile.scale); assert.equal(scene.groundOffset, profile.offset); assert.equal(scene.journalMode, profile.mode);
    assert.equal(scene.story, 'For the person I remember.\n\nThis is our own story, with its exact meaning.');
    assert.equal(scene.maxRadius, 20); assert.equal(scene.walkSpeed, 1.6); assert.equal(scene.livingGarden, false); assert.equal(scene.gardenRoutes.length, 2);
    assert.ok(scene.spawn.every(Number.isFinite)); assert.ok(Number.isFinite(scene.yaw) && Number.isFinite(scene.pitch) && Number.isFinite(scene.groundProbeY));
    assert.ok(scene.name && scene.title && scene.intro); assert.notEqual(scene.autoCalibrate, true);
    for (const route of scene.gardenRoutes) { assert.equal(route.start.length, 2); assert.equal(route.end.length, 2); assert.ok([...route.start, ...route.end].every(Number.isFinite)); }
  }
  assert.deepEqual(input, snapshot);
  scenes[0].spawn[0] = 999; scenes[0].gardenRoutes[0].start[0] = 999; scenes[0].gardenRoutes[1].end[1] = 999;
  if (scenes.length > 1) assert.notEqual(scenes[1].gardenRoutes[0].start[0], 999, 'Views do not share writable route vectors');
  const reopened = createGiftWalkScenes(profile.id, input); assert.notEqual(reopened[0].spawn[0], 999); assert.notEqual(reopened[0].gardenRoutes[0].start[0], 999); assert.notEqual(reopened[0].gardenRoutes[1].end[1], 999);
});

test('Rio retains its waterside route identity while calibrating only its own delivered world and collider', () => {
  const input = freeze(gift({worldUrl:'/demo/v12/rio-world-500k.spz',collisionUrl:'/demo/v12/rio-collider.glb',panoramaUrl:'/demo/v12/rio-panorama.png',worldSemantics:{metricScaleFactor:1.25,groundPlaneOffset:.7},initialYaw:.2,initialPitch:0})), before = structuredClone(input);
  const scenes = createGiftWalkScenes('rio-example', input);
  assert.equal(scenes.length,1);const scene=scenes[0];assert.equal(scene.id,'rio-waterside');assert.equal(scene.name,'The waterside path');
  assert.equal(scene.world,input.worldUrl);assert.equal(scene.collider,input.collisionUrl);assert.equal(scene.panorama,input.panoramaUrl);
  assert.equal(scene.metricScale,1.25);assert.equal(scene.groundOffset,.7);assert.equal(scene.yaw,.2);assert.equal(scene.pitch,0);
  assert.equal(scene.autoCalibrate,true);assert.equal(scene.spawn,undefined);assert.equal(scene.groundProbeY,undefined);assert.equal(scene.gardenRoutes,undefined);assert.equal(scene.journalMode,'newspaper');
  assert.equal(scene.story,'For the person I remember.\n\nThis is our own story, with its exact meaning.');assert.deepEqual(input,before);
  const unmeasured=createGiftWalkScenes('rio-example',gift())[0];assert.equal(unmeasured.metricScale,undefined);assert.equal(unmeasured.groundOffset,undefined);assert.equal(unmeasured.spawn,undefined);assert.equal(unmeasured.autoCalibrate,true);
  for (const id of ['paris-example','antikythera-example']) assert.deepEqual(createGiftWalkScenes(id,gift()).map(scene=>scene.id),[`${id}-0`,`${id}-1`,`${id}-2`], 'Other profiles retain their existing IDs/order');
});

test('Paris preserves its actual approved V23 walking pair while other gifts use their own assets', async () => {
  const paris = createGiftWalkScenes('paris-example', gift());
  for (const scene of paris) {
    assert.equal(scene.world, '/demo/v23/paris-approach-world.spz'); assert.equal(scene.collider, '/demo/v23/paris-approach-collider.glb'); assert.equal(scene.panorama, '/demo/v23/paris-approach-panorama.png');
    await Promise.all([scene.world, scene.collider, scene.panorama].map(url => access(resolve(assetProject, 'public', url.slice(1)))));
  }
  for (const id of ['rio-example', 'antikythera-example']) for (const scene of createGiftWalkScenes(id, gift())) {
    assert.equal(scene.world, '/private/world.spz'); assert.equal(scene.collider, '/private/collider.glb'); assert.equal(scene.panorama, '/private/panorama.png');
  }
});

test('semantic numeric bounds accept exact endpoints and reject malformed, nonfinite and out-of-range values', () => {
  for (const value of [{metricScaleFactor:.05,groundPlaneOffset:-500},{metricScaleFactor:100,groundPlaneOffset:500},{metricScaleFactor:2.9049978,groundPlaneOffset:1.6893421}]) {
    const parsed = readGiftWorldSemantics(freeze(value)); assert.deepEqual(parsed, value); assert.notEqual(parsed, value);
  }
  for (const value of [null,undefined,0,'metadata',{},[],{metricScaleFactor:'2',groundPlaneOffset:0},{metricScaleFactor:2,groundPlaneOffset:'0'},
    {metricScaleFactor:.04999,groundPlaneOffset:0},{metricScaleFactor:100.00001,groundPlaneOffset:0},{metricScaleFactor:0,groundPlaneOffset:0},{metricScaleFactor:-1,groundPlaneOffset:0},
    {metricScaleFactor:NaN,groundPlaneOffset:0},{metricScaleFactor:Infinity,groundPlaneOffset:0},{metricScaleFactor:2,groundPlaneOffset:NaN},{metricScaleFactor:2,groundPlaneOffset:Infinity},
    {metricScaleFactor:2,groundPlaneOffset:500.00001},{metricScaleFactor:2,groundPlaneOffset:-500.00001}]) assert.equal(readGiftWorldSemantics(value), undefined, JSON.stringify(value));
});

test('world spawns require exactly three finite bounded numbers, copy the tuple and ignore malformed or untrusted coordinates', () => {
  for (const value of [[0,1.76932806,4],[-250,250,0]]) {
    const input = freeze(value), spawn = readGiftWorldSpawn(input); assert.deepEqual(spawn,input); assert.notEqual(spawn,input);
    spawn[0]=123; assert.notEqual(spawn[0],input[0]);
  }
  for (const value of [undefined,null,{},'0,2,4',[],[0,2],[0,2,4,0],new Array(3),{0:0,1:2,2:4,length:3},new Float32Array([0,2,4]),['0',2,4],[0,NaN,4],[0,2,Infinity],[-Infinity,2,4],[250.000001,2,4],[0,-250.000001,4],[0,2,1e30]]) {
    assert.equal(readGiftWorldSpawn(value),undefined);
    const scene=createGiftWalkScenes('rio-example',gift({initialSpawn:value}))[0];assert.equal(scene.spawn,undefined);assert.equal(scene.autoCalibrate,true);
  }
});

test('a gift supplies only its own copied starting viewpoint and cannot replace the prepared Paris or observatory profiles', () => {
  const input=freeze(gift({initialSpawn:[0,1.76932806,4]})), scenes=createGiftWalkScenes('rio-example',input);
  assert.deepEqual(scenes[0].spawn,input.initialSpawn);assert.notEqual(scenes[0].spawn,input.initialSpawn);assert.equal(scenes[0].autoCalibrate,true);
  scenes[0].spawn[2]=200;assert.equal(input.initialSpawn[2],4);assert.deepEqual(createGiftWalkScenes('rio-example',input)[0].spawn,[0,1.76932806,4]);
  assert.equal(createGiftWalkScenes('another-gift',gift())[0].spawn,undefined,'Rio does not set a global starting position');
  for(const id of ['paris-example','antikythera-example']) assert.deepEqual(createGiftWalkScenes(id,input).map(scene=>scene.spawn),createGiftWalkScenes(id,gift()).map(scene=>scene.spawn));
});

test('curated eye height uses only finite safe values and leaves other gifts and prepared profiles at their existing defaults', () => {
  for(const height of [.5,2.2,3]) {
    assert.equal(readGiftWorldEyeHeight(height),height);
    const scene=createGiftWalkScenes('rio-example',gift({initialEyeHeight:height}))[0];assert.equal(scene.eyeHeight,height);assert.equal(scene.autoCalibrate,true);
  }
  for(const height of [undefined,null,'2.2',{},NaN,Infinity,-Infinity,0,.499999,3.000001,1e9]) {
    assert.equal(readGiftWorldEyeHeight(height),undefined);
    assert.equal(createGiftWalkScenes('rio-example',gift({initialEyeHeight:height}))[0].eyeHeight,undefined);
  }
  assert.equal(createGiftWalkScenes('another-gift',gift())[0].eyeHeight,undefined);
  for(const id of ['paris-example','antikythera-example']) assert.deepEqual(createGiftWalkScenes(id,gift({initialEyeHeight:2.2})),createGiftWalkScenes(id,gift()),'A new Rio height cannot override prepared profiles');
});

test('prototype-like gift IDs cannot select or mutate prepared profiles', () => {
  for (const id of ['__proto__','constructor','toString','hasOwnProperty','valueOf']) {
    const scenes = createGiftWalkScenes(id, freeze(gift())); assert.equal(scenes.length, 1); assert.equal(scenes[0].id, 'your-place'); assert.equal(scenes[0].autoCalibrate, true); assert.equal(scenes[0].world, '/private/world.spz');
  }
  assert.equal(createGiftWalkScenes('paris-example', gift()).length, 3);
});

test('expired media offers no walking scenes even when a prepared profile has permanent local assets', t => {
  t.mock.method(Date, 'now', () => 2_000_000);
  for (const id of ['rio-example','paris-example','antikythera-example','future-gift']) for (const expiry of [1999,2000]) assert.deepEqual(createGiftWalkScenes(id, gift({mediaExpiresAt:expiry})), []);
  assert.equal(createGiftWalkScenes('future-gift', gift({mediaExpiresAt:2001})).length, 1);
  assert.equal(createGiftWalkScenes('future-gift', gift({mediaExpiresAt:undefined})).length, 1);
});

test('future input retains its own assets and prose, opts into real collider calibration and copies bounded semantics', () => {
  const input = freeze(gift({worldUrl:'/api/instant?action=asset&name=world&id=future',collisionUrl:undefined,colliderUrl:'/api/instant?action=asset&name=collider&id=future',worldSemantics:{metricScaleFactor:2.361576,groundPlaneOffset:1.2409216},initialYaw:-.3,initialPitch:.15}));
  const before = structuredClone(input), scenes = createGiftWalkScenes('new-user-gift', input); assert.equal(scenes.length, 1);
  const scene = scenes[0]; assert.equal(scene.autoCalibrate, true); assert.equal(scene.spawn, undefined, 'A future spawn must be measured from its collider, not copied from Paris');
  assert.equal(scene.title, input.title); assert.equal(scene.world, input.worldUrl); assert.equal(scene.collider, input.colliderUrl); assert.equal(scene.panorama, input.panoramaUrl);
  assert.equal(scene.metricScale, 2.361576); assert.equal(scene.groundOffset, 1.2409216); assert.equal(scene.yaw, -.3); assert.equal(scene.pitch, .15); assert.equal(scene.livingGarden, false); assert.equal(scene.journalMode, 'book');
  assert.equal(scene.story, `${input.dedication.trim()}\n\n${input.story.trim()}`); assert.deepEqual(input, before);
});

test('future missing or invalid semantics remain an automatic collider calibration instead of inheriting Paris scale', () => {
  for (const worldSemantics of [undefined,{metricScaleFactor:-2,groundPlaneOffset:1},{metricScaleFactor:2,groundPlaneOffset:Infinity}]) {
    const scene = createGiftWalkScenes('future', gift({worldSemantics}))[0]; assert.equal(scene.autoCalibrate, true); assert.equal(scene.metricScale, undefined); assert.equal(scene.groundOffset, undefined); assert.equal(scene.spawn, undefined);
  }
});

test('missing world/collider cannot enable unprepared gift walking; empty prose has a usable journal fallback', () => {
  assert.deepEqual(createGiftWalkScenes('future', gift({worldUrl:undefined})), []);
  assert.deepEqual(createGiftWalkScenes('future', gift({collisionUrl:undefined,colliderUrl:undefined})), []);
  const scene = createGiftWalkScenes('future', gift({story:'  ',dedication:'  '}))[0]; assert.equal(scene.story, 'A little place to keep close. Take your time here.');
  assert.equal(createGiftWalkScenes('paris-example', gift({worldUrl:undefined,collisionUrl:undefined})).length, 3, 'The approved Paris profile supplies its own verified assets');
});
