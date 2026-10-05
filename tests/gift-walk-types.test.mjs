import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/gift-walk-types.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { safeGiftWalkHref, walkSceneFirstPerson } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('gift return links only accept bounded internal hash routes, including private capability queries', () => {
  for (const path of ['#/collection', '#/generated/rio-example?from=room', '#/generated/a-b?key=abc_123-xyz&view=world', '#/memory/123%20a']) assert.equal(safeGiftWalkHref(path), path);
  for (const path of [undefined, null, '', '/gift', 'https://example.com/', '//example.com/', '#javascript:alert(1)', 'javascript:alert(1)', '#/gift" onclick="alert(1)', '#/gift\n', '#/gift\\escape', '#/gift#other', '#/' + 'x'.repeat(2048)]) assert.equal(safeGiftWalkHref(path), '#/collection');
  assert.equal(safeGiftWalkHref('unsafe', '#/generated/paris-example?from=room'), '#/generated/paris-example?from=room');
  assert.equal(safeGiftWalkHref('unsafe', 'javascript:alert(1)'), '#/collection');
});

test('unmeasured gifts ask for calibration without fabricating Paris coordinates or visitors', () => {
  const state = walkSceneFirstPerson({});
  assert.equal(state.spawn, undefined); assert.equal(state.metricScale, undefined); assert.equal(state.groundOffset, undefined);
  assert.equal(state.autoCalibrate, true); assert.equal(state.eyeHeight, 1.65); assert.equal(state.livingGarden, false);
  assert.equal(state.maxRadius, 20); assert.equal(state.walkSpeed, 1.6); assert.equal(state.groundProbeY, undefined);
  assert.equal(walkSceneFirstPerson({ metricScale: 2, groundOffset: 0 }).autoCalibrate, true);
  assert.equal(walkSceneFirstPerson({ metricScale: 2, groundOffset: 0, spawn: [0, 1.65, 0] }).autoCalibrate, false);
});

test('authored calibration and audited XZ visitor routes pass through while motion stays bounded', () => {
  const spawn = [1, 1.65, -2], routes = [{ start: [2, -3], end: [4, -3], initialProgress: .2, reverse: true }];
  const state = walkSceneFirstPerson({ spawn, metricScale: 1.7, groundOffset: -.3, groundProbeY: 4, livingGarden: true, gardenRoutes: routes, walkSpeed: 999, maxRadius: Infinity });
  assert.equal(state.spawn, spawn); assert.equal(state.metricScale, 1.7); assert.equal(state.groundOffset, -.3); assert.equal(state.gardenRoutes, routes); assert.equal(state.groundProbeY, 4);
  assert.equal(state.autoCalibrate, false); assert.equal(state.livingGarden, true); assert.equal(state.walkSpeed, 2.4); assert.equal(state.maxRadius, 20);
  assert.equal(walkSceneFirstPerson({ walkSpeed: -1, maxRadius: -100 }).walkSpeed, .4);
  assert.equal(walkSceneFirstPerson({ maxRadius: -100 }).maxRadius, 2);
  assert.equal(walkSceneFirstPerson({ maxRadius: 999 }).maxRadius, 60);
  assert.equal(walkSceneFirstPerson({ autoCalibrate: false }).autoCalibrate, false);
});

test('a validated curated eye height reaches walking without changing the collider calibration or other body defaults', () => {
  const spawn=[0,2.13686443,2], scene={spawn,metricScale:2.8094594,groundOffset:2.1216264,autoCalibrate:true};
  for(const eyeHeight of [.5,2.2,3]) {
    const state=walkSceneFirstPerson({...scene,eyeHeight});assert.equal(state.eyeHeight,eyeHeight);assert.equal(state.spawn,spawn);assert.equal(state.autoCalibrate,true);
    assert.equal(state.metricScale,scene.metricScale);assert.equal(state.groundOffset,scene.groundOffset);assert.equal(state.radius,.2);assert.equal(state.walkSpeed,1.6);assert.equal(state.maxRadius,20);
  }
  for(const eyeHeight of [undefined,null,'2.2',NaN,Infinity,-Infinity,.499999,3.000001,1e20]) assert.equal(walkSceneFirstPerson({...scene,eyeHeight}).eyeHeight,1.65,'Malformed heights preserve the existing walking default');
  assert.equal(walkSceneFirstPerson(scene).eyeHeight,1.65,'A curated height does not become a global default');
});
