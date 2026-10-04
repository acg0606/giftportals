import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const flight = url(compile(await readFile(new URL('../src/world-flight.ts', import.meta.url), 'utf8')));
const runtime = await import(url(compile(await readFile(new URL('../src/paris-flight-state.ts', import.meta.url), 'utf8')).replace(/from '\.\/world-flight'/, `from '${flight}'`)));
const { sampleWorldFlight, validatedWorldFlightRoute } = await import(flight);
const ready = id => ({ id, title: `${id} title`, subtitle: 'Paris at dusk.', status: 'complete', worldUrl: `/demo/v23/${id}-world.spz`, panoramaUrl: `/demo/v23/${id}-panorama.png` });
const read = chapters => runtime.readParisFlightManifest({ version: 1, title: 'Paris, beyond the postcard', chapters });
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));

test('only a completed local SPZ can open a chapter, never a provider URL or a panorama substitution', () => {
  const manifest = read([
    { ...ready('approach'), worldUrl: 'https://provider.example/world.spz?token=private' },
    { ...ready('summit'), worldUrl: '/demo/v23/summit-panorama.png' },
    { ...ready('riverside'), status: 'pending' },
  ]);
  assert.ok(manifest); assert.equal(manifest.chapters.length, 3);
  for (const chapter of manifest.chapters) { assert.equal(chapter.status, 'unavailable'); assert.equal(chapter.worldUrl, undefined); assert.equal(runtime.parisFlightAsset(chapter, 1280, 'balanced'), undefined); }
  for (const path of ['/demo/v23/../private.spz', '/demo/v23/%2e%2e/private.spz', '/demo/v23//world.spz', '//demo/v23/world.spz', '/api/instant/media.spz?token=x', '/demo/v22/paris-world.spz']) assert.equal(runtime.parisFlightAssetPath(path, '.spz'), undefined);
});

test('chapter identity stays unique and itinerary ordered even when export records arrive out of order', () => {
  assert.deepEqual(read([ready('riverside'), ready('summit'), ready('approach')]).chapters.map(chapter => chapter.id), ['approach', 'summit', 'riverside']);
  assert.equal(read([ready('summit'), ready('summit')]), undefined);
  assert.equal(read([ready('fake-summit')]), undefined);
  assert.equal(read([]), undefined);
  assert.equal(runtime.readParisFlightManifest({ version: 2, title: 'Paris', chapters: [ready('approach')] }), undefined);
});

test('desktop details preserve the verified full point count and phones use their completed smaller world', () => {
  const chapter = read([{ ...ready('summit'), worldUrlFullRes: '/demo/v23/summit-full.spz', fullResBytes: 32 * 1024 * 1024, fullResSplats: 2083441, mobileWorldUrl: '/demo/v23/summit-mobile.spz' }]).chapters[0];
  assert.deepEqual(runtime.parisFlightAsset(chapter, 390, 'detailed'), { url: '/demo/v23/summit-mobile.spz', maxSplats: 100000, byteLimit: 25 * 1024 * 1024, label: 'Balanced' });
  assert.equal(runtime.parisFlightAsset(chapter, 1280, 'balanced').maxSplats, 500000);
  assert.equal(runtime.parisFlightAsset(chapter, 1280, 'detailed').maxSplats, 2083441);
  assert.equal(runtime.parisFlightAsset(chapter, 1280, 'detailed').byteLimit, 50 * 1024 * 1024);
  for (const fullResSplats of [undefined, 2500001, 100000.5, NaN]) {
    const unsafe = read([{ ...ready('summit'), worldUrlFullRes: '/demo/v23/summit-full.spz', fullResBytes: 32 * 1024 * 1024, fullResSplats }]).chapters[0];
    assert.equal(runtime.parisFlightAsset(unsafe, 1280, 'detailed').label, 'Balanced');
  }
  const oversized = read([{ ...ready('summit'), worldUrlFullRes: '/demo/v23/summit-full.spz', fullResBytes: 51 * 1024 * 1024, fullResSplats: 2000000 }]).chapters[0];
  assert.equal(runtime.parisFlightAsset(oversized, 1280, 'detailed').label, 'Balanced');
});

test('phones preserve compact 500k architecture while larger or unmeasured assets use the completed 100k export', () => {
  for (const [worldBytes, expectedCount] of [[8 * 1024 * 1024, 500000], [10 * 1024 * 1024, 500000], [10 * 1024 * 1024 + 1, 100000], [undefined, 100000]]) {
    const chapter = read([{ ...ready('approach'), worldBytes, mobileWorldUrl: '/demo/v23/approach-mobile.spz', worldUrlFullRes: '/demo/v23/approach-full.spz', fullResBytes: 32 * 1024 * 1024, fullResSplats: 2083441 }]).chapters[0];
    const selected = runtime.parisFlightAsset(chapter, 390, 'detailed');
    assert.equal(selected.maxSplats, expectedCount); assert.equal(selected.byteLimit, 25 * 1024 * 1024);
    assert.equal(selected.url, expectedCount === 500000 ? chapter.worldUrl : chapter.mobileWorldUrl);
    assert.equal(selected.label, 'Balanced', 'Phone requests cannot select a large detailed world');
  }
});

test('real XYZ arrival motion stays inside reviewed bounds and never degenerates into a photo zoom', () => {
  for (const id of ['approach', 'summit', 'riverside']) {
    const chapter = read([ready(id)]).chapters[0], route = chapter.route;
    assert.ok(validatedWorldFlightRoute(route));
    assert.ok(distance(route.arrival[0].position, route.arrival.at(-1).position) > 1.8);
    assert.ok(distance(route.viewpoints[0].pose.position, route.viewpoints[1].pose.position) > .7);
    let prior = sampleWorldFlight(route.arrival, 0);
    for (let i = 1; i <= 400; i++) {
      const pose = sampleWorldFlight(route.arrival, i / 400);
      assert.ok(distance(prior.position, pose.position) < .03);
      assert.ok(distance(pose.position, pose.target) > 3);
      for (let axis = 0; axis < 3; axis++) { assert.ok(pose.position[axis] >= Math.min(...route.arrival.map(frame => frame.position[axis]))); assert.ok(pose.position[axis] <= Math.max(...route.arrival.map(frame => frame.position[axis]))); }
      prior = pose;
    }
  }
});

test('bad reviewed routes cannot steer a camera into unbounded coordinates or mismatch story IDs', () => {
  const base = runtime.defaultParisFlightRoute('summit');
  for (const route of [
    { ...base, arrival: [] }, { ...base, arrival: [{ position: [NaN, 0, 0], target: [0, 0, -5], fov: 68 }, base.arrival[1]] },
    { ...base, arrival: [{ position: [10000, 0, 0], target: [0, 0, -5], fov: 68 }, base.arrival[1]] },
    { ...base, arrival: [{ position: [0, 0, 0], target: [0, 0, 0], fov: 68 }, base.arrival[1]] },
    { ...base, viewpoints: [base.viewpoints[0], base.viewpoints[0]] },
  ]) assert.equal(validatedWorldFlightRoute(route), undefined);
  assert.equal(validatedWorldFlightRoute(base, ['reveal', 'wrong']), undefined);
  const parsed = read([{ ...ready('summit'), route: { ...base, arrival: [] } }]);
  assert.deepEqual(parsed.chapters[0].route, base);
});

test('authored story object and language survive validation without rendering untrusted HTML', () => {
  const manifest = read([{ ...ready('summit'), stories: [{ id: 'reveal', title: '<script>A different scale</script>', body: 'The river catches the last light.', mode: 'tablet' }] }]);
  assert.equal(manifest.chapters[0].stories[0].body, 'The river catches the last light.');
  assert.equal(manifest.chapters[0].stories[0].mode, 'tablet');
  assert.equal(manifest.chapters[0].stories[0].title, '<script>A different scale</script>'); // StoryReader uses textContent, never interpreted markup.
  assert.equal(read([ready('approach')]).chapters[0].stories[0].mode, 'newspaper');
  assert.equal(read([ready('riverside')]).chapters[0].stories[0].mode, 'book');
});

test('chapter switches and disposal suppress obsolete decoder/transition callbacks', async () => {
  const guard = runtime.createParisFlightLoadGuard(), first = guard.next();
  let resolve; const opening = new Promise(done => { resolve = done; });
  const publication = opening.then(() => guard.current(first));
  const second = guard.next(); assert.equal(guard.current(second), true); resolve();
  assert.equal(await publication, false, 'Late completion cannot revive the first chapter or hide the current lift');
  guard.destroy(); assert.equal(guard.current(second), false); assert.equal(guard.next(), -1); assert.equal(guard.current(-1), false);
});
