import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/gift-marker-layout.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { packGiftMarkers, placeGiftMarkerLabel, markerRectsOverlap } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const anchors = count => Array.from({ length: count }, (_, index) => ({ id: String(index), x: 195, y: 175, visible: true }));
const nonoverlapping = (markers, obstacles, width, height) => {
  const visible = markers.filter(marker => marker.visible);
  for (const marker of visible) {
    assert.ok(marker.rect.x >= 10 && marker.rect.y >= 10);
    assert.ok(marker.rect.x + marker.rect.width <= width - 10 && marker.rect.y + marker.rect.height <= height - 10);
    for (const obstacle of obstacles) assert.equal(markerRectsOverlap(marker.rect, obstacle, 8), false);
  }
  for (let a = 0; a < visible.length; a++) for (let b = a + 1; b < visible.length; b++) assert.equal(markerRectsOverlap(visible[a].rect, visible[b].rect, 8), false);
};
test('six coincident projected story pins remain distinct at mobile and desktop widths', () => {
  for (const [width, height] of [[390, 420], [1366, 620]]) {
    const packed = packGiftMarkers(anchors(6), width, height);
    assert.equal(packed.filter(marker => marker.visible).length, 6);
    nonoverlapping(packed, [], width, height);
    assert.deepEqual(packGiftMarkers(anchors(6), width, height), packed);
  }
});
test('story overlay and keepsake dock reserve space; impossible pins defer to story list', () => {
  const obstacles = [{ x: 14, y: 14, width: 136, height: 60 }, { x: 160, y: 80, width: 215, height: 230 }];
  const packed = packGiftMarkers(anchors(6), 390, 420, obstacles);
  assert.ok(packed.some(marker => marker.visible)); nonoverlapping(packed, obstacles, 390, 420);
  assert.equal(packGiftMarkers(anchors(3), 390, 420, [{ x: 0, y: 0, width: 390, height: 420 }]).filter(marker => marker.visible).length, 0);
});
test('labels choose a side free of neighbouring pins and story cards or remain hidden', () => {
  const pin = { x: 160, y: 150, width: 44, height: 44 };
  const neighbour = { x: 216, y: 150, width: 44, height: 44 };
  const label = placeGiftMarkerLabel(pin, 140, 38, 390, 420, [neighbour]);
  assert.ok(label); assert.equal(markerRectsOverlap(label, neighbour, 6), false);
  assert.equal(placeGiftMarkerLabel(pin, 140, 38, 390, 420, [{ x: 0, y: 0, width: 390, height: 420 }]), undefined);
});
test('offscreen/nonfinite anchors and tiny viewports never generate broken DOM coordinates', () => {
  const packed = packGiftMarkers([{ id: 'off', x: 12, y: 12, visible: false }, { id: 'bad', x: NaN, y: 20, visible: true }], 390, 420);
  assert.equal(packed.some(marker => marker.visible), false);
  assert.equal(packGiftMarkers(anchors(1), 30, 420)[0].visible, false);
});
