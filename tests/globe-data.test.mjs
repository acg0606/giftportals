import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { findGlobePlace, projectWorldToGlobe } from '../src/globe-data.ts';
import { MAP_PLACES } from '../src/map-data.ts';

async function sourceModule(name, replacements = {}) {
  let js = ts.transpileModule(await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [path, target] of Object.entries(replacements)) js = js.replaceAll(`'${path}'`, JSON.stringify(target));
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
}
const art = await sourceModule('art.ts'), places = await sourceModule('map-data.ts');
const { demoWorld, fictionalMemories } = await import(await sourceModule('demo.ts', { './art': art, './map-data': places }));
const scope = { scope: 'owner', viewerId: 'owner' };
function memory(id, placeId = 'tuca', extra = {}) {
  return { id, ownerId: 'owner', ownerName: 'Private synthetic name', title: 'Private synthetic title', story: 'Private synthetic story',
    location: { placeId, label: 'Private synthetic location', latitude: 12.345678, longitude: 98.765432, source: 'manual', experiencedAt: '2026-09-30' },
    shareLocation: true, demo: false, createdAt: '2026-09-30T12:00:00Z', artisticNote: '', media: [{ id: 'private-media', url: 'https://offline.invalid/private?token=synthetic-secret' }],
    objectStatus: 'not-requested', environmentStatus: 'not-requested', ...extra };
}
function world(memories = [], discoveries = [], received = [], extra = {}) {
  return { user: { id: 'owner', displayName: 'Private synthetic person', demo: false }, memories, discoveries, received, sent: [], jobs: [], ...extra };
}
const discovery = (placeId, kind, extra = {}) => ({ id: `${kind}:${placeId}`, placeId, kind, source: 'manual-confirmation', memoryId: null, createdAt: '2026-09-30T12:00:00Z', ...extra });
const invitation = (memoryId, extra = {}) => ({ id: `gift:${memoryId}`, memoryId, claimedBy: 'owner', revokedAt: null, ...extra });
function noOverlay(snapshot) {
  assert.equal(snapshot.places.length, 7);
  for (const place of snapshot.places) { assert.equal(place.physicallyVisited, false); assert.equal(place.memoryCount, 0); assert.equal(place.wishlistPointCount, 0); assert.deepEqual(place.memoryIds, []); }
  assert.deepEqual(snapshot.unlocated.map(place => place.id), ['japan-house']);
}

test('all seven globe anchors use published WGS84 coordinates and explicit provenance', () => {
  const snapshot = projectWorldToGlobe(world(), scope);
  assert.equal(snapshot.places.length, 7);
  for (const point of snapshot.places) {
    const catalog = MAP_PLACES.find(place => place.id === point.id);
    assert.equal(point.longitude, catalog.lon); assert.equal(point.latitude, catalog.lat);
    assert.match(point.coordinateSourceUrl, /^https:\/\//); assert.ok(point.coordinateNote.length);
    assert.equal(point.path.at(-1), point.id); assert.equal(point.path[0], 'world');
    assert.equal(point.latitude >= -90 && point.latitude <= 90, true); assert.equal(point.longitude >= -180 && point.longitude <= 180, true);
  }
  assert.equal(snapshot.places.some(place => ['perdizes', 'paulista-corridor', 'sao-paulo'].includes(place.id)), false);
  assert.equal(findGlobePlace(snapshot, 'japan-house'), undefined);
});

test('owner mismatch and invalid demo scope erase every collection overlay but retain the public catalog', () => {
  const privateWorld = world([memory('own', 'paris')], [discovery('tuca', 'physical'), discovery('masp', 'wish')]);
  noOverlay(projectWorldToGlobe(privateWorld, { scope: 'owner', viewerId: 'outsider' }));
  noOverlay(projectWorldToGlobe(privateWorld, { scope: 'owner' }));
  noOverlay(projectWorldToGlobe(privateWorld, { scope: 'public-demo' }));
  noOverlay(projectWorldToGlobe(demoWorld(), { scope: 'owner', viewerId: demoWorld().user.id }));
});

test('authenticated owner may see an unshared memory at its catalog anchor without revealing exact private coordinates', () => {
  const snapshot = projectWorldToGlobe(world([memory('own', 'tuca', { shareLocation: false })]), scope);
  const point = findGlobePlace(snapshot, 'tuca');
  assert.deepEqual(point.memoryIds, ['own']); assert.equal(point.memoryCount, 1); assert.equal(point.physicallyVisited, false);
  assert.equal(point.latitude, MAP_PLACES.find(place => place.id === 'tuca').lat);
  const serialized = JSON.stringify(snapshot);
  for (const excluded of ['12.345678', '98.765432', 'Private synthetic', 'synthetic-secret', 'private-media', 'experiencedAt', 'story', 'url', 'ownerId']) assert.equal(serialized.includes(excluded), false, excluded);
});

test('a nonowner memory requires both an active received membership and explicit shared-location consent', () => {
  const shared = memory('received', 'tuca', { ownerId: 'sender' });
  const hidden = memory('hidden', 'masp', { ownerId: 'sender', shareLocation: false });
  const omitted = memory('omitted', 'museu-pele', { ownerId: 'sender', shareLocation: undefined });
  const foreign = memory('not-received', 'orquidario-santos', { ownerId: 'sender' });
  const revoked = memory('revoked', 'sitio-da-ressaca', { ownerId: 'sender' });
  const otherRecipient = memory('other-recipient', 'casa-das-rosas', { ownerId: 'sender' });
  const snapshot = projectWorldToGlobe(world([shared, hidden, omitted, foreign, revoked, otherRecipient], [], [
    invitation('received'), invitation('hidden'), invitation('omitted'), invitation('revoked', { revokedAt: '2026-09-30' }), invitation('other-recipient', { claimedBy: 'outsider' })
  ]), scope);
  assert.deepEqual(snapshot.places.flatMap(place => place.memoryIds), ['received']);
  assert.deepEqual(findGlobePlace(snapshot, 'masp').memoryIds, []);
});

test('hidden, archived, orphan and stale memory discoveries cannot manufacture geographic pins', () => {
  const snapshot = projectWorldToGlobe(world([
    memory('moved', 'masp'), memory('archived', 'tuca', { archivedAt: '2026-09-30' }), memory('hidden', 'world', { shareLocation: false })
  ], [
    discovery('tuca', 'memory', { memoryId: 'moved' }), discovery('museu-pele', 'memory', { memoryId: 'missing' }),
    discovery('orquidario-santos', 'memory', { memoryId: 'hidden' }), discovery('sitio-da-ressaca', 'memory', { memoryId: 'archived' })
  ]), scope);
  assert.deepEqual(findGlobePlace(snapshot, 'masp').memoryIds, ['moved']);
  for (const id of ['tuca', 'museu-pele', 'orquidario-santos', 'sitio-da-ressaca']) assert.equal(findGlobePlace(snapshot, id).memoryCount, 0);
  assert.equal(snapshot.unlocated.some(place => place.id === 'world'), false);
});

test('two authorized memories at one point survive independent revocation and never record a physical visit', () => {
  const first = memory('first', 'tuca', { ownerId: 'sender' }), second = memory('second', 'tuca', { ownerId: 'sender' });
  const snapshot = projectWorldToGlobe(world([first, second, second], [], [invitation('first'), invitation('second')]), scope);
  assert.equal(findGlobePlace(snapshot, 'tuca').memoryCount, 2); assert.equal(findGlobePlace(snapshot, 'tuca').physicallyVisited, false);
  const revoked = projectWorldToGlobe(world([first, second], [], [invitation('first', { revokedAt: '2026-09-30' }), invitation('second')]), scope);
  assert.deepEqual(findGlobePlace(revoked, 'tuca').memoryIds, ['second']);
});

test('manual visits and wishes remain independent of memory archive and do not color sibling points', () => {
  const snapshot = projectWorldToGlobe(world([memory('archived', 'tuca', { archivedAt: '2026-09-30' })], [
    discovery('tuca', 'physical', { memoryId: 'archived' }), discovery('masp', 'wish'), discovery('masp', 'wish'),
    discovery('centro-cultural-jabaquara', 'physical', { ownerId: 'outsider' }), discovery('sao-paulo', 'physical')
  ]), scope);
  assert.equal(findGlobePlace(snapshot, 'tuca').physicallyVisited, true); assert.equal(findGlobePlace(snapshot, 'tuca').memoryCount, 0);
  assert.equal(findGlobePlace(snapshot, 'masp').wishlistPointCount, 1); assert.equal(findGlobePlace(snapshot, 'masp').physicallyVisited, false);
  assert.equal(findGlobePlace(snapshot, 'centro-cultural-jabaquara').physicallyVisited, false);
});

test('Paris, Japan House and unknown places remain unlocated even when DTO coordinates appear valid', () => {
  const snapshot = projectWorldToGlobe(world([memory('paris-memory', 'paris'), memory('japan-memory', 'japan-house'), memory('unknown-memory', '__proto__')]), scope);
  assert.equal(snapshot.places.some(place => ['paris', 'japan-house', '__proto__'].includes(place.id)), false);
  for (const [id, memoryId] of [['paris', 'paris-memory'], ['japan-house', 'japan-memory'], ['__proto__', 'unknown-memory']]) {
    assert.deepEqual(snapshot.unlocated.find(place => place.id === id).memoryIds, [memoryId]);
  }
  assert.equal(snapshot.unlocated.find(place => place.id === '__proto__').name, 'Outside the verified place catalog');
});

test('public fictional personas expose only their authorized subset and flag shared locations explicitly', () => {
  assert.equal(fictionalMemories.every(memory => memory.demo === true && memory.shareLocation === true), true);
  const noah = demoWorld(fictionalMemories, 'recipient');
  const snapshot = projectWorldToGlobe(noah, { scope: 'public-demo' });
  assert.deepEqual(findGlobePlace(snapshot, 'tuca').memoryIds, [fictionalMemories[0].id]);
  assert.equal(findGlobePlace(snapshot, 'museu-pele').memoryCount, 0);
  assert.equal(snapshot.places.some(place => place.physicallyVisited), false);
  assert.deepEqual(snapshot.unlocated.find(place => place.id === 'paris').memoryIds, [fictionalMemories[2].id]);
  const maya = projectWorldToGlobe(demoWorld(fictionalMemories, 'sender'), { scope: 'public-demo' });
  assert.equal(findGlobePlace(maya, 'tuca').physicallyVisited, true); assert.equal(findGlobePlace(maya, 'museu-pele').physicallyVisited, true);
  assert.equal(findGlobePlace(maya, 'centro-cultural-jabaquara').physicallyVisited, false);
});

test('public demo rejects private, hidden or missing-consent memories and nonfictional history', () => {
  const fixtures = fictionalMemories.map(memory => structuredClone(memory));
  fixtures[0].shareLocation = undefined; fixtures[1].shareLocation = false; fixtures[2].demo = false;
  const demo = demoWorld(fixtures, 'sender'); demo.discoveries.push(discovery('sitio-da-ressaca', 'physical'), discovery('casa-das-rosas', 'physical', { source: undefined }));
  const snapshot = projectWorldToGlobe(demo, { scope: 'public-demo' });
  assert.equal(snapshot.places.flatMap(place => place.memoryIds).length, 0);
  assert.equal(snapshot.unlocated.some(place => place.id === 'paris'), false);
  assert.equal(findGlobePlace(snapshot, 'sitio-da-ressaca').physicallyVisited, false);
  assert.equal(findGlobePlace(snapshot, 'casa-das-rosas').physicallyVisited, false);
});

test('conflicting duplicate memory IDs fail closed and input snapshots remain unchanged', () => {
  const data = world([memory('conflict', 'tuca'), memory('conflict', 'masp'), memory('valid', 'museu-pele')]);
  const before = JSON.stringify(data);
  Object.freeze(data.memories); Object.freeze(data.discoveries); Object.freeze(data.received); Object.freeze(data);
  const snapshot = projectWorldToGlobe(data, scope);
  assert.deepEqual(snapshot.places.flatMap(place => place.memoryIds), ['valid']);
  assert.equal(JSON.stringify(data), before);
});
