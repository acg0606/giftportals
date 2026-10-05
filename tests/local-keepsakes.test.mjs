import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const modules = new Map();
async function moduleUrl(path) {
  if (modules.has(path.href)) return modules.get(path.href);
  let source = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const match of [...source.matchAll(/from\s*(['"])(\.{1,2}\/[^'"]+)\1/g)]) {
    const url = await moduleUrl(new URL(`${match[2]}.ts`, path));
    source = source.replaceAll(`${match[1]}${match[2]}${match[1]}`, JSON.stringify(url));
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  modules.set(path.href, url); return url;
}
const { createdSessionKeepsake } = await import(await moduleUrl(new URL('../src/local-keepsakes.ts', import.meta.url)));
const completed = {
  id: 'test gift/#1', token: 'fictional-test-capability?&=', state: 'completed',
  tripo: { state: 'completed' }, worldlabs: { state: 'completed' },
  title: 'A gift', story: 'Our memory.', worldPrompt: 'An imagined place.', photoIntent: 'place',
  assets: { photoUrl: '/photo.jpg', modelUrl: '/model.glb', worldUrl: '/world.spz' },
};
test('only authorized terminal outputs can enter the room; pending jobs and failed stages with stale URLs cannot', () => {
  for (const job of [{ ...completed, state: 'processing' }, { ...completed, token: '' }, { ...completed, tripo: { state: 'processing' }, worldlabs: { state: 'processing' } }, { ...completed, state: 'partial', tripo: { state: 'failed' }, worldlabs: { state: 'failed' } }, { ...completed, assets: { photoUrl: '/photo.jpg' } }]) assert.equal(createdSessionKeepsake(job), undefined);
});

test('a completed world survives model failure with its photo, story and private world route, without a fabricated miniature', () => {
  const partial = { ...completed, state: 'partial', tripo: { state: 'failed' }, assets: { photoUrl: '/photo.jpg', worldUrl: '/world.spz' } };
  const item = createdSessionKeepsake(partial);
  assert.equal(item.modelUrl, undefined); assert.equal(item.imageUrl, '/photo.jpg'); assert.equal(item.story, completed.story);
  assert.equal(item.worldPath, `${item.openPath}&view=world`);
  assert.equal(createdSessionKeepsake({ ...partial, state: 'processing' }), undefined);
});
test('a completed souvenir survives world failure and has no world action or fabricated world route', () => {
  const partial = { ...completed, state: 'partial', worldlabs: { state: 'failed', errorCode: 'PROVIDER_FAILED' }, assets: { photoUrl: '/photo.jpg', modelUrl: '/model.glb' } };
  const item = createdSessionKeepsake(partial);
  assert.equal(item.modelUrl, '/model.glb'); assert.equal(item.originalImageUrl, '/photo.jpg'); assert.equal(item.story, completed.story);
  assert.equal(item.openPath, `generated/${encodeURIComponent(partial.id)}?key=${encodeURIComponent(partial.token)}`);
  assert.equal(item.worldPath, undefined);
  assert.equal(createdSessionKeepsake({ ...partial, assets: { ...partial.assets, worldUrl: '/stale.spz' } }).worldPath, undefined, 'A failed stage cannot advertise a world even if a stale URL exists');
});
test('session keepsake preserves the original and uses encoded private routes without mutating the source', () => {
  const item = createdSessionKeepsake(completed);
  assert.equal(item.demo, false); assert.match(item.subtitle, /saved on this device/);
  assert.equal(item.imageUrl, completed.assets.photoUrl); assert.equal(item.photoIntent, 'place');
  assert.equal(item.openPath, `generated/${encodeURIComponent(completed.id)}?key=${encodeURIComponent(completed.token)}`);
  assert.equal(item.worldPath, `${item.openPath}&view=world`);
  assert.equal(completed.title, 'A gift');
  assert.equal(createdSessionKeepsake({ ...completed, story: '' }).story, completed.worldPrompt);
});

test('known public square copies use the same English device presentation without rewriting the authorized job', () => {
  const source = { ...completed, id: 'c864acd7-88d0-4b02-bff7-67ae186243dc', title: 'pracinha', story: 'plantei uma arvore' }, before = structuredClone(source);
  const item = createdSessionKeepsake(source);
  assert.equal(item.title, 'A quiet square'); assert.equal(item.story, 'A quiet square to enjoy nature. I planted a tree here.'); assert.deepEqual(source, before);
  assert.equal(item.openPath, `generated/${source.id}?key=${encodeURIComponent(source.token)}`); assert.equal(item.originalImageUrl, source.assets.photoUrl); assert.equal(item.modelUrl, source.assets.modelUrl);
  const playground = createdSessionKeepsake({ ...completed, id: 'cc997d6d-faf2-4b5a-8bfa-9196716bec71', story: '', worldPrompt: 'Uma praca para curtir.' });
  assert.equal(playground.title, 'A little square to share'); assert.equal(playground.story, '', 'No unreviewed place prompt becomes the empty curated story');
});

test('a miniature uses its own reference thumbnail and preserves original, representation and explicit model yaw', () => {
  const job = { ...completed, objectRepresentation: 'souvenir-miniature', modelYaw: -Math.PI / 2, assets: { ...completed.assets, tripoInputUrl: '/souvenir-reference.png' } };
  const item = createdSessionKeepsake(job);
  assert.equal(item.imageUrl, '/souvenir-reference.png'); assert.equal(item.originalImageUrl, '/photo.jpg');
  assert.equal(item.objectRepresentation, 'souvenir-miniature'); assert.equal(item.modelYaw, -Math.PI / 2);
  assert.equal(item.modelUrl, '/model.glb'); assert.equal(job.assets.photoUrl, '/photo.jpg');
  assert.equal(createdSessionKeepsake(completed).originalImageUrl, '/photo.jpg');
  assert.equal(createdSessionKeepsake({ ...job, objectRepresentation: 'framed-postcard' }).imageUrl, '/photo.jpg', 'Legacy photo overlays retain the unframed original');
  const native = { ...job, modelYaw: undefined }, roomItem = createdSessionKeepsake(native);
  assert.equal(roomItem.modelYaw, -Math.PI / 2); assert.equal(native.modelYaw, undefined, 'Room facing does not mutate the viewer job orientation');
  assert.equal(createdSessionKeepsake({ ...job, modelYaw: 0 }).modelYaw, 0, 'An explicit cache or job orientation remains authoritative');
  assert.equal(createdSessionKeepsake(completed).modelYaw, undefined, 'Ordinary objects retain their prior orientation');
});
