import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinateFrame } from '../src/globe-navigation.ts';
import { parseCoordinateQuery, formatCoordinateLabel } from '../src/vendor/gods-eye/coordinateParser.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`);

test('signed São Paulo coordinates keep latitude/longitude order and western hemisphere', () => {
  const point = parseCoordinateQuery('-23.538868, -46.671081');
  assert.equal(point.lat, -23.538868);
  assert.equal(point.lon, -46.671081);
  assert.equal(point.label, '23.5389° S, 46.6711° W');
  assert.deepEqual(parseCoordinateQuery('-23.538868 -46.671081'), point);
});

test('hemisphere letters resolve reversed axis order without guessing', () => {
  const expected = { lat: -23.538868, lon: -46.671081, label: '23.5389° S, 46.6711° W' };
  for (const query of ['23.538868 S, 46.671081 W', 'W 46.671081; S 23.538868', '46.671081° W, 23.538868° S']) {
    assert.deepEqual(parseCoordinateQuery(query), expected, query);
  }
  assert.equal(formatCoordinateLabel(48.8566, 2.3522), '48.8566° N, 2.3522° E');
});

test('coordinate navigation declines junk, ambiguous axes, contradictory signs and wrong arity', () => {
  for (const query of [
    '', 'Perdizes', '12junk, 34oops', '12, 34 trailing text', 'NaN, 34', 'Infinity, 34',
    '1e2, 20', '10N, 20N', '10W, 20E', '-23.5S, 46.6W', '+23.5N, 46.6W',
    'N23S, W46', '23, 46, 12', '23', null, undefined, 123, {}, ['23', '46'],
  ]) assert.equal(parseCoordinateQuery(query), null, String(query));
});

test('coordinate parsing accepts geographic limits and rejects finite but out-of-range values', () => {
  assert.deepEqual(parseCoordinateQuery('90, 180'), { lat: 90, lon: 180, label: '90.0000° N, 180.0000° E' });
  assert.deepEqual(parseCoordinateQuery('90 S, 180 W'), { lat: -90, lon: -180, label: '90.0000° S, 180.0000° W' });
  for (const query of ['90.00001, 0', '-90.00001, 0', '0, 180.00001', '0, -180.00001', '91N, 1E', '181W, 1N']) {
    assert.equal(parseCoordinateQuery(query), null, query);
  }
});

test('camera framing preserves a real southern/western point and a caller-selected span', () => {
  const frame = coordinateFrame(-23.538868, -46.671081);
  close(frame.south, -23.553868); close(frame.north, -23.523868);
  close(frame.west, -46.686081); close(frame.east, -46.656081);
  const wide = coordinateFrame(0, 0, 20);
  assert.deepEqual(wide, { west: -20, south: -20, east: 20, north: 20 });
});

test('camera framing crosses the antimeridian through a short wrapped extent', () => {
  const east = coordinateFrame(12, 180), west = coordinateFrame(12, -180);
  assert.ok(east.west > east.east, 'west > east denotes a dateline crossing');
  close(east.west, 179.985); close(east.east, -179.985);
  close((east.east + 360) - east.west, 0.03);
  assert.deepEqual(west, east, 'both representations of the dateline frame the same point');
});

test('camera framing clips at both poles without an invalid latitude extent', () => {
  const north = coordinateFrame(90, 10), south = coordinateFrame(-90, 10);
  assert.equal(north.north, 90); close(north.south, 89.985);
  assert.equal(south.south, -90); close(south.north, -89.985);
  for (const frame of [north, south]) {
    assert.ok(frame.south < frame.north);
    assert.ok(frame.south >= -90 && frame.north <= 90);
    assert.ok(frame.west >= -180 && frame.east <= 180);
  }
});

test('camera framing refuses invalid centers or spans before creating a destination', () => {
  for (const [lat, lon, span] of [
    [NaN, 0, 0.015], [0, Infinity, 0.015], [90.001, 0, 0.015], [-90.001, 0, 0.015],
    [0, 180.001, 0.015], [0, -180.001, 0.015], ['23', 46, 0.015], [23, '46', 0.015],
    [0, 0, NaN], [0, 0, Infinity], [0, 0, 0], [0, 0, -0.015], [0, 0, 90.001],
  ]) assert.equal(coordinateFrame(lat, lon, span), null, `${lat}, ${lon}, ${span}`);
  assert.deepEqual(coordinateFrame(0, 0, 90), { west: -90, south: -90, east: 90, north: 90 });
});
