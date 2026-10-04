import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function sourceModule(name, replacements = {}) {
  let js = ts.transpileModule(await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [path, target] of Object.entries(replacements)) js = js.replaceAll(`'${path}'`, JSON.stringify(target));
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
}
const art = await sourceModule('art.ts'), places = await sourceModule('map-data.ts');
const { demoWorld, fictionalMemories, orderDemoMemories } = await import(await sourceModule('demo.ts', { './art': art, './map-data': places }));
const mayaId = '10000000-0000-4000-8000-000000000001', noahId = '10000000-0000-4000-8000-000000000002';
const apiMemories = fictionalMemories.map((memory, index) => ({
  ...structuredClone(memory), id: `20000000-0000-4000-8000-00000000000${index + 1}`,
  ownerId: memory.ownerName === 'Maya' ? mayaId : noahId,
}));
const bird = apiMemories.find((memory) => memory.location.placeId === 'tuca');
const sea = apiMemories.find((memory) => memory.location.placeId === 'museu-pele');
const paris = apiMemories.find((memory) => memory.location.placeId === 'paris');

test('reverse-ordered API UUID fixtures resolve Maya ownership and real gift references', () => {
  const reversed = Object.freeze([...apiMemories].reverse().map((memory) => Object.freeze(memory)));
  const before = JSON.stringify(reversed);
  const world = demoWorld(reversed, 'sender');
  assert.equal(world.user.id, mayaId);
  assert.equal(world.user.demo, true);
  assert.deepEqual(new Set(world.memories.map((memory) => memory.id)), new Set(apiMemories.map((memory) => memory.id)));
  assert.equal(world.sent[0].memoryId, bird.id);
  assert.equal(world.received[0].memoryId, paris.id);
  assert.equal(world.received[0].claimedBy, mayaId);
  assert.equal(world.discoveries.find((record) => record.kind === 'memory' && record.placeId === 'paris').memoryId, paris.id);
  assert.equal(JSON.stringify(reversed), before);
});

test('Noah receives only the intended public gift and keeps Paris as his own story', () => {
  const world = demoWorld([...apiMemories].reverse(), 'recipient');
  assert.equal(world.user.id, noahId);
  assert.deepEqual(new Set(world.memories.map((memory) => memory.id)), new Set([bird.id, paris.id]));
  assert.equal(world.memories.some((memory) => memory.id === sea.id), false);
  assert.deepEqual(world.memories.filter((memory) => memory.ownerId === world.user.id).map((memory) => memory.id), [paris.id]);
  assert.deepEqual(world.memories.filter((memory) => world.received.some((gift) => gift.memoryId === memory.id)).map((memory) => memory.id), [bird.id]);
  assert.equal(world.sent[0].memoryId, paris.id);
  assert.equal(world.received[0].claimedBy, noahId);
  assert.equal(world.discoveries.some((record) => record.kind === 'physical'), false);
  assert.equal(world.discoveries.find((record) => record.placeId === 'tuca').memoryId, bird.id);
});

test('missing API fixtures create no phantom gift or discovery memory reference', () => {
  const subset = apiMemories.filter((memory) => memory.id !== paris.id);
  for (const persona of ['sender', 'recipient']) {
    const world = demoWorld(subset, persona), visibleIds = new Set(world.memories.map((memory) => memory.id));
    for (const gift of [...world.sent, ...world.received]) assert.equal(visibleIds.has(gift.memoryId), true);
    for (const discovery of world.discoveries) if (discovery.memoryId) assert.equal(visibleIds.has(discovery.memoryId), true);
    assert.equal(world.discoveries.some((record) => record.placeId === 'paris' && record.kind === 'memory'), false);
  }
});

test('Maya self and received filters use actual UUID ownership', () => {
  const world = demoWorld(apiMemories, 'sender');
  assert.deepEqual(new Set(world.memories.filter((memory) => memory.ownerId === world.user.id).map((memory) => memory.id)), new Set([bird.id, sea.id]));
  assert.deepEqual(world.memories.filter((memory) => world.received.some((gift) => gift.memoryId === memory.id)).map((memory) => memory.id), [paris.id]);
});

test('opening the demonstration gift prioritizes its real 3D asset regardless of API order', () => {
  const reversed = Object.freeze([...apiMemories].reverse()), before = JSON.stringify(reversed);
  const ordered = orderDemoMemories(reversed);
  assert.equal(ordered[0].id, bird.id);
  assert.equal(ordered[0].media.some((media) => media.kind === 'model' && media.provider === 'tripo'), true);
  assert.equal(JSON.stringify(reversed), before);
});

test('a private non-demo memory cannot enter either fictional persona world', () => {
  const privateMemory = { ...bird, id: '30000000-0000-4000-8000-000000000001', demo: false, title: 'Synthetic private story' };
  for (const persona of ['sender', 'recipient']) {
    const world = demoWorld([privateMemory, ...apiMemories], persona);
    assert.equal(world.memories.some((memory) => memory.id === privateMemory.id), false);
    assert.equal([...world.sent, ...world.received].some((gift) => gift.memoryId === privateMemory.id), false);
  }
});
