import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDiscovery, FICTIONAL_DEMO_DISCOVERIES, MAP_PLACES, getPilotPlace, placePath, pilotPlaces } from '../src/map-data.ts';

test('physical Perdizes visit colors only its ancestors', () => {
  const result = aggregateDiscovery([{ placeId: 'tuca', kind: 'physical' }]);
  for (const id of ['world', 'br', 'br-sp', 'sao-paulo', 'perdizes', 'tuca']) {
    assert.equal(result[id].physicallyVisited, true, id);
    assert.equal(result[id].physicalPointCount, 1, id);
  }
  for (const id of ['santos', 'jabaquara', 'paulista-corridor', 'masp', 'sitio-da-ressaca', 'fr', 'paris']) {
    assert.equal(result[id].physicallyVisited, false, id);
  }
});

test('required fictional example includes both municipalities and leaves Jabaquara unvisited', () => {
  const result = aggregateDiscovery(FICTIONAL_DEMO_DISCOVERIES);
  for (const id of ['br', 'br-sp', 'sao-paulo', 'santos', 'perdizes']) assert.equal(result[id].physicallyVisited, true, id);
  assert.equal(result.jabaquara.physicallyVisited, false);
  assert.equal(result['br-sp'].physicalPointCount, 2);
});

test('a Paris memory is a portal and never a physical visit', () => {
  const result = aggregateDiscovery([{ placeId: 'paris', kind: 'memory', memoryId: 'received-paris' }]);
  for (const id of ['world', 'fr', 'fr-idf', 'paris']) {
    assert.equal(result[id].physicallyVisited, false);
    assert.equal(result[id].memoryPointCount, 1);
    assert.equal(result[id].memoryCount, 1);
  }
  assert.equal(result.br.memoryPointCount, 0);
});

test('wishlist does not convert a memory or physical visit state', () => {
  const result = aggregateDiscovery([{ placeId: 'masp', kind: 'wish' }]);
  assert.equal(result.masp.wishlistPointCount, 1);
  assert.equal(result['paulista-corridor'].wishlistPointCount, 1);
  assert.equal(result.masp.physicallyVisited, false);
  assert.equal(result.masp.memoryPointCount, 0);
});

test('deleting the last visit decolors all its parents on recomputation', () => {
  const records = [{ id: 'visit', placeId: 'tuca', kind: 'physical' }];
  assert.equal(aggregateDiscovery(records).br.physicallyVisited, true);
  const result = aggregateDiscovery(records.filter(record => record.id !== 'visit'));
  for (const id of ['world', 'br', 'br-sp', 'sao-paulo', 'perdizes', 'tuca']) assert.equal(result[id].physicallyVisited, false, id);
});

test('deleting a capital visit keeps Santos and the common state visited', () => {
  const result = aggregateDiscovery(FICTIONAL_DEMO_DISCOVERIES.filter(record => record.placeId !== 'tuca'));
  assert.equal(result.santos.physicallyVisited, true);
  assert.equal(result['br-sp'].physicallyVisited, true);
  assert.equal(result['sao-paulo'].physicallyVisited, false);
  assert.equal(result.perdizes.physicallyVisited, false);
});

test('correcting a visit moves the state without stale or sibling coloring', () => {
  const record = { placeId: 'tuca', kind: 'physical' };
  const result = aggregateDiscovery([{ ...record, placeId: 'centro-cultural-jabaquara' }]);
  assert.equal(result.perdizes.physicallyVisited, false);
  assert.equal(result.jabaquara.physicallyVisited, true);
  assert.equal(result['sitio-da-ressaca'].physicallyVisited, false);
  assert.equal(result['sao-paulo'].physicalPointCount, 1);
});

test('visits in another owner world are excluded when an owner field is supplied', () => {
  const result = aggregateDiscovery([
    { ownerId: 'ana', placeId: 'tuca', kind: 'physical' },
    { ownerId: 'leo', placeId: 'centro-cultural-jabaquara', kind: 'physical' }
  ], 'ana');
  assert.equal(result.perdizes.physicallyVisited, true);
  assert.equal(result.jabaquara.physicallyVisited, false);
});

test('duplicate visits count distinct places, while separate memories retain their count', () => {
  const records = [
    { id: 'v1', placeId: 'tuca', kind: 'physical' },
    { id: 'v2', placeId: 'tuca', kind: 'physical' },
    { id: 'p1', placeId: 'tuca', kind: 'memory', memoryId: 'a' },
    { id: 'p2', placeId: 'tuca', kind: 'memory', memoryId: 'b' }
  ];
  const result = aggregateDiscovery(records);
  assert.equal(result.tuca.physicalPointCount, 1);
  assert.equal(result.tuca.memoryPointCount, 1);
  assert.equal(result.tuca.memoryCount, 2);
});

test('unknown records and object prototype names do not manufacture geography', () => {
  const result = aggregateDiscovery([{ placeId: 'unknown-place', kind: 'physical' }, { placeId: 'constructor', kind: 'physical' }, { placeId: '__proto__', kind: 'memory' }]);
  assert.equal(result.world.physicallyVisited, false);
  assert.deepEqual(placePath('constructor'), []);
  assert.deepEqual(placePath('__proto__'), []);
});

test('aggregation never mutates inputs and works with frozen DTO snapshots', () => {
  const records = Object.freeze([Object.freeze({ placeId: 'tuca', kind: 'physical' })]);
  assert.equal(aggregateDiscovery(records).tuca.physicallyVisited, true);
  assert.deepEqual(records, [{ placeId: 'tuca', kind: 'physical' }]);
});

test('catalog distinguishes official districts and the curated Paulista corridor', () => {
  assert.equal(MAP_PLACES.find(place => place.id === 'perdizes').kind, 'district');
  assert.equal(MAP_PLACES.find(place => place.id === 'jabaquara').kind, 'district');
  assert.equal(MAP_PLACES.find(place => place.id === 'paulista-corridor').kind, 'corridor');
  assert.deepEqual(placePath('museu-pele').map(place => place.id), ['world', 'br', 'br-sp', 'santos', 'santos-valongo', 'museu-pele']);
});

test('all eight pilot POIs have a direct source and unknown coordinates stay absent', () => {
  const points = MAP_PLACES.filter(place => place.kind === 'point');
  assert.equal(points.length, 8);
  for (const point of points) assert.match(point.sourceUrl, /^https:\/\//);
  assert.equal(getPilotPlace('japan-house'), undefined);
  assert.equal(pilotPlaces.length, 7);
  assert.match(getPilotPlace('tuca').coordinateNote, /Approximate/);
  for (const place of pilotPlaces) {
    assert.ok(place.lat < -23 && place.lat > -25);
    assert.ok(place.lon < -46 && place.lon > -47);
  }
});

test('corrupt custom hierarchy fails explicitly rather than looping forever', () => {
  const catalog = [{ id: 'a', parentId: 'b', kind: 'district' }, { id: 'b', parentId: 'a', kind: 'district' }];
  assert.throws(() => placePath('a', catalog), /cycle/);
});
