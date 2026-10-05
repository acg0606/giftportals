import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/world-flight.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { createWorldFlightRoute, sampleWorldFlight, connectWorldFlight, createBoundedWorldFlight, createWorldCinematicSession, WORLD_CINEMATIC_DURATION_MS } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const points = [
  { id: 'letter', position: [-1.05, .22, -2.6] }, { id: 'moment', position: [.55, .38, -3] },
  { id: 'farewell', position: [1.4, -.2, -2.65] }, { id: 'curiosity', position: [-.75, -.15, -3.5] },
];
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));

test('V11 arrival measures the scene, checks every camera corridor, starts elevated and lands at the real walking spawn', () => {
  const bounds = { min: [-4,-2,-4], max: [4,6,4] }, spawn = [0,1.6,0], checks = [];
  const path = createBoundedWorldFlight(bounds, spawn, 0, (a,b) => { checks.push([a,b]); return true; });
  assert.ok(path); assert.equal(checks.length,241); assert.ok(path[0].position[1] - spawn[1] > 2);
  assert.deepEqual(path.at(-1).position,spawn);
  assert.ok(path[0].target[2] < -2, 'The photo direction frames scenery beyond the small safe camera corridor');
  for (let i=0;i<=1000;i++) { const pose=sampleWorldFlight(path,i/1000); pose.position.forEach((value,axis)=>assert.ok(value>bounds.min[axis]&&value<bounds.max[axis])); }
  assert.equal(createBoundedWorldFlight(bounds,spawn,0,()=>false),undefined,'Collision failure never invents a route');
  assert.equal(createBoundedWorldFlight(bounds,spawn),undefined,'An unverified corridor is not assumed safe');
  assert.equal(createBoundedWorldFlight(bounds,[8,1.6,0],0,()=>true),undefined,'Unknown spawn outside measured reconstruction cannot fly');
  assert.equal(createBoundedWorldFlight({min:[0,0,0],max:[NaN,5,5]},spawn,0,()=>true),undefined);
  const wide=createBoundedWorldFlight({min:[-80,-5,-180],max:[80,90,50]},spawn,0,()=>true);
  assert.deepEqual(wide[0].target,[0,1.6,-12]);
  assert.ok(Math.atan2(wide[0].position[1]-wide[0].target[1],Math.hypot(wide[0].position[0]-wide[0].target[0],wide[0].position[2]-wide[0].target[2]))<.25,'An elevated arrival frames the photo direction, not nearby ground');
  const turned=createBoundedWorldFlight(bounds,spawn,Math.PI/2,()=>true);assert.ok(turned[0].target[0]<-2);assert.ok(Math.abs(turned[0].target[2])<1e-8);
});

test('a low local ceiling retains a checked lateral thirty-second arrival, while insufficient headroom remains unavailable', () => {
  const bounds={min:[-10,-3,-20],max:[10,30,10]},spawn=[0,1.6,0],ceiling=2.3,checks=[];
  const clear=(a,b)=>{checks.push([a,b]);return a[1]<ceiling&&b[1]<ceiling;};
  const path=createBoundedWorldFlight(bounds,spawn,0,clear);
  assert.ok(path);assert.ok(path[0].position[1]>spawn[1]+.2);assert.ok(path[0].position[1]<ceiling);
  assert.ok(Math.abs(path[0].position[0])>1,'A safe lateral arc is preferred over a stationary vertical descent');
  assert.deepEqual(path.at(-1).position,spawn);assert.ok(checks.length>241,'Blocked high arrivals are checked before the smaller supported arc');
  for(let index=0;index<=1000;index++){const pose=sampleWorldFlight(path,index/1000);assert.ok(pose.position[1]<ceiling);pose.position.forEach((value,axis)=>assert.ok(value>bounds.min[axis]&&value<bounds.max[axis]));}
  const flight=createWorldCinematicSession(path);for(let step=0;step<29;step++)flight.step(1000);assert.equal(flight.state().phase,'flying');flight.step(1000);assert.equal(flight.state().phase,'completed');
  const unsupported=createBoundedWorldFlight(bounds,spawn,0,(a,b)=>a[1]<spawn[1]+.1&&b[1]<spawn[1]+.1);
  assert.equal(unsupported,undefined);assert.deepEqual(createWorldCinematicSession(unsupported||[]).state(),{phase:'completed',progress:1,reason:'unavailable'});
});

test('the cinematic uses thirty seconds of foreground time, pauses without catch-up and completes once', () => {
  const path=createBoundedWorldFlight({min:[-4,-2,-4],max:[4,6,4]},[0,1.6,0],0,()=>true), flight=createWorldCinematicSession(path);
  assert.equal(WORLD_CINEMATIC_DURATION_MS,30000);
  for(let i=0;i<29;i++) flight.step(1000); assert.equal(flight.state().phase,'flying');
  flight.pause(); const progress=flight.state().progress; flight.step(60000); assert.equal(flight.state().progress,progress);
  flight.resume(); flight.step(1000); assert.equal(flight.state().phase,'completed'); assert.deepEqual(flight.pose(),path.at(-1));
  flight.resume();flight.pause();flight.step(1000);assert.equal(flight.state().phase,'completed');
  assert.deepEqual(createWorldCinematicSession(path,true).state(),{phase:'completed',progress:1,reason:'motion'});
  assert.deepEqual(createWorldCinematicSession([]).state(),{phase:'completed',progress:1,reason:'unavailable'});
});

test('cached-world profiles have real spatial arrival and different camera positions for every story point', () => {
  for (const profile of ['coast', 'river', 'terrace', 'generic']) {
    const route = createWorldFlightRoute(points, profile);
    assert.equal(route.arrival.length, 3); assert.equal(route.viewpoints.length, 4);
    assert.ok(distance(route.arrival[0].position, route.arrival.at(-1).position) > 2, 'Arrival translates the camera rather than scaling a photo');
    const heights = route.arrival.map(pose => pose.position[1]); assert.ok(Math.max(...heights) - Math.min(...heights) > .5);
    for (let i = 0; i < route.viewpoints.length; i++) {
      assert.equal(route.viewpoints[i].pointId, points[i].id); assert.deepEqual(route.viewpoints[i].pose.target, points[i].position);
      for (let j = i + 1; j < route.viewpoints.length; j++) assert.ok(distance(route.viewpoints[i].pose.position, route.viewpoints[j].pose.position) > 1);
    }
  }
});

test('arrival splines remain inside authored scene bounds, land exactly, and preserve gradual motion', () => {
  for (const profile of ['coast', 'river', 'terrace', 'generic']) {
    const { arrival } = createWorldFlightRoute(points, profile);
    assert.strictEqual(sampleWorldFlight(arrival, 0), arrival[0]); assert.strictEqual(sampleWorldFlight(arrival, 1), arrival.at(-1));
    let prior = sampleWorldFlight(arrival, 0);
    for (let i = 1; i <= 800; i++) {
      const pose = sampleWorldFlight(arrival, i / 800);
      assert.ok(distance(pose.position, prior.position) < .05, 'Eight-second arrivals do not jump across scenery');
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(pose.position[axis] >= Math.min(...arrival.map(frame => frame.position[axis])) - 1e-9);
        assert.ok(pose.position[axis] <= Math.max(...arrival.map(frame => frame.position[axis])) + 1e-9);
      }
      assert.ok(pose.fov >= 56 && pose.fov <= 76); assert.ok(distance(pose.position, pose.target) > .3); prior = pose;
    }
    assert.ok(distance(sampleWorldFlight(arrival, .001).position, arrival[0].position) < 1e-6);
    assert.ok(distance(sampleWorldFlight(arrival, .999).position, arrival.at(-1).position) < 1e-6);
  }
});

test('between-stop flights follow their authored straight corridor while moving the look target and field of view', () => {
  const { viewpoints } = createWorldFlightRoute(points, 'terrace'), from = viewpoints[0].pose, to = viewpoints[1].pose;
  const path = connectWorldFlight(from, to), half = sampleWorldFlight(path, .5);
  for (const field of ['position', 'target']) half[field].forEach((value, axis) => assert.ok(Math.abs(value - (from[field][axis] + to[field][axis]) / 2) < 1e-9));
  assert.ok(half.fov < from.fov && half.fov > to.fov);
  assert.strictEqual(sampleWorldFlight(path, -1), from); assert.strictEqual(sampleWorldFlight(path, 2), to); assert.strictEqual(sampleWorldFlight(path, NaN), from);
});

test('initial yaw rotates flight positions consistently with the Three Y-up camera without rotating authored story anchors', () => {
  const plain = createWorldFlightRoute(points, 'coast'), turned = createWorldFlightRoute(points, 'coast', Math.PI / 2);
  plain.arrival.forEach((pose, index) => {
    assert.ok(Math.abs(turned.arrival[index].position[0] - pose.position[2]) < 1e-9);
    assert.ok(Math.abs(turned.arrival[index].position[2] + pose.position[0]) < 1e-9);
    assert.deepEqual(turned.arrival[index].target, pose.target);
  });
});

test('malformed or coincident anchors are rejected or bounded, and empty tours do not invent scenes', () => {
  assert.deepEqual(createWorldFlightRoute([], 'coast'), { arrival: [], viewpoints: [] });
  const route = createWorldFlightRoute([
    { id: '', position: [1, 2, 3] }, { id: 'bad', position: [NaN, 0, 0] },
    { id: 'coincident', position: [-.8, .4, .9] }, { id: 'huge', position: [1e10, 1e10, 1e10] },
  ], 'unknown', NaN);
  assert.equal(route.viewpoints.length, 2); assert.ok(distance(route.viewpoints[0].pose.position, route.viewpoints[0].pose.target) > .3);
  assert.deepEqual(route.viewpoints[1].pose.target, [12, 6, 12]);
  assert.throws(() => sampleWorldFlight([], .5), /at least one/);
});

test('the V22 Plus promenade uses distinct conservative camera positions with a shallow gaze at every chapter', () => {
  const route = createWorldFlightRoute(points, 'river-plus');
  assert.equal(route.viewpoints.length, 4);
  for (const { pose } of route.viewpoints) {
    assert.ok(distance(pose.position, [0, 0, .03]) < 1, 'Each viewpoint stays close to the reconstructed promenade origin');
    const horizontal = Math.hypot(pose.target[0] - pose.position[0], pose.target[2] - pose.position[2]);
    const pitch = Math.atan2(pose.target[1] - pose.position[1], horizontal);
    assert.ok(horizontal > 2, 'Narrative anchors cannot be almost beneath the camera');
    assert.ok(Math.abs(pitch) < Math.PI / 12, 'The chapter gaze stays within fifteen degrees of the horizon');
    assert.deepEqual(pose.target, points[route.viewpoints.findIndex(view => view.pose === pose)].position, 'Candidate geometry does not rewrite narrative anchors');
  }
  for (let i = 0; i < route.viewpoints.length; i++) for (let j = i + 1; j < route.viewpoints.length; j++) {
    assert.ok(distance(route.viewpoints[i].pose.position, route.viewpoints[j].pose.position) > .35, 'Every chapter still has a distinct spatial viewpoint');
  }
  for (let i = 0; i <= 100; i++) {
    const pose = sampleWorldFlight(route.arrival, i / 100);
    assert.ok(distance(pose.position, [0, 0, .03]) < 1.6, 'Candidate arrival remains within its modest scene corridor');
    assert.ok(pose.position[1] >= .08 && pose.position[1] <= .3);
    const horizontal = Math.hypot(pose.target[0] - pose.position[0], pose.target[2] - pose.position[2]);
    assert.ok(Math.abs(Math.atan2(pose.target[1] - pose.position[1], horizontal)) < Math.PI / 12);
  }
});

test('candidate profile is isolated from the baseline Paris river route', () => {
  const baseline = createWorldFlightRoute(points, 'river'), candidate = createWorldFlightRoute(points, 'river-plus');
  assert.deepEqual(baseline.arrival.map(pose => pose.position), [[1.8, 1.2, -5], [1.3, .7, -2.5], [-1.3, .35, 1.3]]);
  assert.deepEqual(baseline.viewpoints[2].pose.position, [1.4, .5, -2.7]);
  assert.ok(distance(candidate.arrival[0].position, baseline.arrival[0].position) > 5);
  assert.ok(distance(candidate.viewpoints[2].pose.position, points[2].position) > 3, 'Candidate third chapter avoids the old nearly vertical bridge/water view');
});
