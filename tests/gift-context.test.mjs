import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/gift-context-state.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { roundedGiftPosition, giftMapPoint, giftMapView, giftCountryAt, nearestGiftCity, createGiftContextState, giftPlacePrompt } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const countries = JSON.parse(await readFile(new URL('../public/assets/context/countries-110m.json', import.meta.url), 'utf8'));
function fixture() {
  const attempts = [], changed = [];
  const geolocation = { getCurrentPosition(success, error, options) { attempts.push({ success, error, options }); } };
  const state = createGiftContextState(geolocation, snapshot => changed.push(snapshot));
  return { state, attempts, changed };
}
test('location starts OFF and makes no GPS request until the explicit action', () => {
  const { state, attempts } = fixture();
  assert.deepEqual(state.getContext(), { mode: 'off', includeInStory: false }); assert.equal(attempts.length, 0);
  state.requestLocation(); state.requestLocation(); assert.equal(attempts.length, 1);
  assert.equal(attempts[0].options.enableHighAccuracy, false); assert.equal(state.snapshot().pending, true);
});
test('GPS is rounded before retention, previews and output, with opt-out clearing output coordinates', () => {
  const { state, attempts, changed } = fixture(); state.requestLocation();
  attempts[0].success({ coords: { latitude: -22.9068471, longitude: -43.1728965, accuracy: 4 } });
  assert.deepEqual(state.getContext(), { mode: 'device', includeInStory: true, latitude: -22.91, longitude: -43.17, precision: 'rounded-0.01-deg' });
  assert.equal(JSON.stringify(changed).includes('-22.9068471'), false); assert.equal(JSON.stringify(state.snapshot()).includes('accuracy'), false);
  state.include(false); assert.deepEqual(state.getContext(), { mode: 'off', includeInStory: false });
  state.skip(); assert.deepEqual(state.snapshot().context, { mode: 'off', includeInStory: false });
});
test('a place lookup can use GPS without including location in the saved story', () => {
  const { state, attempts, changed } = fixture(); state.requestLocation(false);
  attempts[0].success({ coords: { latitude: -23.6141123, longitude: -46.6412234, accuracy: 25 } });
  assert.deepEqual(state.getContext(), { mode: 'off', includeInStory: false });
  assert.equal(state.snapshot().context.latitude, -23.61);
  assert.equal(state.snapshot().context.longitude, -46.64);
  assert.equal(JSON.stringify(changed).includes('-23.6141123'), false);
  state.setLabel('A square the user confirmed');
  assert.equal(state.getContext().mode, 'off', 'confirming the place name must preserve the save opt-out');
  state.include(true);
  assert.deepEqual(state.getContext(), { mode: 'device', includeInStory: true, latitude: -23.61, longitude: -46.64, precision: 'rounded-0.01-deg', placeLabel: 'A square the user confirmed', regionId: undefined });
});
test('Skip, manual choice and destruction invalidate late native GPS callbacks', () => {
  const { state, attempts } = fixture(); state.requestLocation(); state.skip();
  attempts[0].success({ coords: { latitude: 52.123456, longitude: 8.654321 } }); assert.equal(state.getContext().mode, 'off');
  state.requestLocation(); state.manual('A place we love'); attempts[1].success({ coords: { latitude: 10, longitude: 20 } });
  assert.deepEqual(state.getContext(), { mode: 'manual', includeInStory: true, placeLabel: 'A place we love' });
  state.requestLocation(); state.destroy(); attempts[2].success({ coords: { latitude: 10, longitude: 20 } }); assert.equal(state.getContext().mode, 'off');
});
test('denied, unavailable, timeout, unsupported and throwing GPS preserve a usable location-free state', () => {
  for (const [code, status] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']]) {
    const { state, attempts } = fixture(); state.requestLocation(); attempts[0].error({ code, message: 'Do not expose native internal error' });
    assert.equal(state.snapshot().status, status); assert.deepEqual(state.getContext(), { mode: 'off', includeInStory: false });
    state.manual('A chosen garden'); assert.equal(state.getContext().mode, 'manual');
  }
  const unsupported = createGiftContextState(null); unsupported.requestLocation(); assert.equal(unsupported.snapshot().status, 'unsupported');
  const throwing = createGiftContextState({ getCurrentPosition() { throw Error('Native API unavailable'); } }); throwing.requestLocation(); assert.equal(throwing.snapshot().status, 'unavailable');
});
test('coordinate limits, negative zero and map zoom never leak invalid values', () => {
  for (const position of [[NaN, 0], [0, Infinity], [91, 0], [0, -181]]) assert.equal(roundedGiftPosition(...position), undefined);
  assert.deepEqual(roundedGiftPosition(-.001, -.001), { latitude: 0, longitude: 0 });
  assert.deepEqual(giftMapPoint({ latitude: 0, longitude: 0 }), { x: 360, y: 180 });
  const view = giftMapView({ latitude: 90, longitude: 180 }, 32).split(' ').map(Number);
  assert.ok(view[0] + view[2] <= 720 && view[1] + view[3] <= 360); assert.equal(giftMapView(undefined, NaN), '0 0 720 360');
});
test('bundled Natural Earth country matching works offline and respects polygon holes', () => {
  for (const [latitude, longitude, name] of [[-22.91, -43.17, 'Brazil'], [35.68, 139.76, 'Japan'], [48.86, 2.35, 'France'], [40.71, -74.01, 'United States of America']]) assert.equal(giftCountryAt({ latitude, longitude }, countries)?.name, name);
  assert.equal(giftCountryAt({ latitude: 0, longitude: -140 }, countries), undefined);
  const hole = { id: 'test', name: 'Hole test', path: '', polygons: [[[[0,0],[10,0],[10,10],[0,10]],[[4,4],[6,4],[6,6],[4,6]]]] };
  assert.equal(giftCountryAt({ latitude: 5, longitude: 5 }, [hole]), undefined); assert.equal(giftCountryAt({ latitude: 2, longitude: 2 }, [hole]), hole);
});
test('curated city matching has a 35km boundary; no nearby entry means no invented city', () => {
  const cities = [{ id: 'near', label: 'Curated place', latitude: 0, longitude: 0 }];
  assert.equal(nearestGiftCity({ latitude: .1, longitude: .1 }, cities)?.id, 'near');
  assert.equal(nearestGiftCity({ latitude: 1, longitude: 1 }, cities), undefined);
});
test('context output is a detached DTO and state makes no browser storage writes', () => {
  const originals = ['localStorage','sessionStorage'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  let access = 0;
  try {
    for (const [name] of originals) Object.defineProperty(globalThis, name, { configurable: true, get() { access++; throw Error('Location must never enter browser storage'); } });
    const { state, attempts } = fixture(); state.requestLocation(); attempts[0].success({ coords: { latitude: 12.123456, longitude: 45.654321 } });
    const dto = state.getContext(); dto.latitude = 90; assert.equal(state.getContext().latitude, 12.12); state.skip(); state.destroy(); assert.equal(access, 0);
  } finally { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
});
test('applying, changing and skipping a confirmed place preserves the user story without duplicate context', () => {
  const first = giftPlacePrompt('A quiet garden at dusk.', 'Rio de Janeiro, Brazil');
  const repeated = giftPlacePrompt(first.prompt, 'Rio de Janeiro, Brazil', first.sentence); assert.equal(repeated.prompt, first.prompt);
  const changed = giftPlacePrompt(first.prompt, 'Kyoto, Japan', first.sentence); assert.equal(changed.prompt.includes('Rio de Janeiro'), false); assert.equal(changed.prompt.includes('A quiet garden at dusk.'), true);
  const cleared = giftPlacePrompt(changed.prompt, '', changed.sentence); assert.equal(cleared.prompt, 'A quiet garden at dusk.');
  const userEdited = giftPlacePrompt(`${first.prompt}\nI edited this myself.`, '', first.sentence); assert.equal(userEdited.prompt.includes('I edited this myself.'), true);
});
