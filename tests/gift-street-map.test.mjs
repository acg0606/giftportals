import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/gift-street-map.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { giftStreetPoint, giftStreetPosition, giftStreetTiles } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('street map locates rounded São Paulo GPS in its real OSM tile', () => {
  const selected = Object.freeze({ latitude: -23.61, longitude: -46.64 });
  const tiles = giftStreetTiles(selected, 12, 320, 260);
  assert.ok(tiles.some(tile => tile.url === 'https://tile.openstreetmap.org/12/1517/2324.png'));
  assert.ok(tiles.length <= 9, 'a phone viewport must not fetch a neighborhood of hidden tiles');
  assert.deepEqual(selected, { latitude: -23.61, longitude: -46.64 });
});

test('camera navigation across the date line preserves the selected position', () => {
  const selected = Object.freeze({ latitude: 35.68, longitude: 179.99 });
  const point = giftStreetPoint(selected, 12);
  const moved = giftStreetPosition({ x: point.x + 800, y: point.y }, 12);
  assert.ok(moved.longitude < -179.7 && moved.longitude >= -180);
  assert.ok(Math.abs(moved.latitude - selected.latitude) < 1e-8);
  assert.deepEqual(selected, { latitude: 35.68, longitude: 179.99 });
  const tiles = giftStreetTiles(selected, 12, 720, 320);
  for (const tile of tiles) {
    const [z, x, y] = tile.url.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/).slice(1).map(Number);
    assert.ok(x >= 0 && x < 2 ** z && y >= 0 && y < 2 ** z);
  }
});

test('zoom and polar bounds never request nonexistent OSM tiles', () => {
  for (const position of [{ latitude: 90, longitude: 180 }, { latitude: -90, longitude: -180 }]) {
    for (const zoom of [-100, 12, 100]) {
      const tiles = giftStreetTiles(position, zoom, 390, 320);
      assert.ok(tiles.length > 0);
      for (const tile of tiles) {
        const [z, x, y] = tile.url.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/).slice(1).map(Number);
        assert.ok(z >= 2 && z <= 16 && x >= 0 && x < 2 ** z && y >= 0 && y < 2 ** z);
      }
    }
  }
});

test('hidden and invalid viewports make no tile requests', () => {
  const selected = { latitude: -23.61, longitude: -46.64 };
  for (const [width, height] of [[0, 260], [320, 0], [-1, 260], [Infinity, 260]]) assert.deepEqual(giftStreetTiles(selected, 12, width, height), []);
  assert.deepEqual(giftStreetTiles({ latitude: NaN, longitude: 0 }, 12, 320, 260), []);
});
