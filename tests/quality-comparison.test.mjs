import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/quality-comparison.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/import '\.\/quality-comparison.css';\s*/, '')
  .replace(/import \{ giftIcon \} from '\.\/gift-icon';/, "const giftIcon = '';" )
  .replace(/import \{ mountGeneratedGift \} from '\.\/generated-gift';/, 'const mountGeneratedGift = () => { throw new Error("The asset-validation tests must not mount a renderer."); };');
const { comparisonAssetPath, comparisonGiftData } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const gift = { title: 'Paris', senderName: 'GiftPortals', story: 'An evening along the river.', modelUrl: '/demo/v22/paris-model.glb', worldUrl: '/demo/v22/paris-world.spz' };

test('comparison accepts published local demo paths and excludes private capability URLs', () => {
  assert.equal(comparisonAssetPath('/demo/v22/front-768.png'), '/demo/v22/front-768.png');
  for (const path of ['https://media.example/asset.glb?token=private', '/api/instant/media?id=private', '/demo/v22/model.glb?key=private', '//demo/v22/model.glb', '/demo/../private.glb', '/demo/%2e%2e/private.glb', '/demo/v22//model.glb', '/demo/./model.glb', undefined]) assert.equal(comparisonAssetPath(path), '');
});
test('an incomplete generation cannot be presented as a completed miniature or world', () => {
  assert.equal(comparisonGiftData({ ...gift, modelUrl: undefined }, 'miniature'), undefined);
  assert.equal(comparisonGiftData({ ...gift, worldUrl: undefined }, 'world'), undefined);
  assert.equal(comparisonGiftData({ ...gift, modelUrl: '/demo/v22/front.png' }, 'miniature'), undefined);
  assert.equal(comparisonGiftData({ ...gift, worldUrl: '/demo/v22/paris-panorama.png' }, 'world'), undefined);
  assert.equal(comparisonGiftData({ ...gift, senderName: undefined }, 'miniature'), undefined);
});
test('ready configs retain public 3D assets and remove private optional media', () => {
  const prepared = comparisonGiftData({ ...gift, originalUrl: '/demo/v22/paris-reference.png', collisionUrl: 'https://private.example/collider.glb?key=secret', modelYaw: NaN, initialYaw: .25, objectRepresentation: 'souvenir-miniature' }, 'world');
  assert.ok(prepared);
  assert.equal(prepared.worldUrl, '/demo/v22/paris-world.spz');
  assert.equal(prepared.modelUrl, '/demo/v22/paris-model.glb');
  assert.equal(prepared.originalUrl, '/demo/v22/paris-reference.png');
  assert.equal(prepared.collisionUrl, undefined);
  assert.equal(prepared.modelYaw, undefined);
  assert.equal(prepared.initialYaw, .25);
  assert.equal(prepared.objectRepresentation, 'souvenir-miniature');
});
