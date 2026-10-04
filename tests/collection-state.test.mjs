import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(await readFile(new URL('../src/collection-state.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { publicCollectionItems, collectionItemsFromWorld } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const media = (kind, url, expiresAt = 0, mimeType = kind === 'model' ? 'model/gltf-binary' : kind === 'world' ? 'application/octet-stream' : 'image/jpeg') => ({ id: kind, kind, url, expiresAt, mimeType, bytes: 100, generated: false });
const memory = (id = 'own', extra = {}) => ({ id, ownerId: 'me', ownerName: 'Alex', title: 'A little memory', story: 'Words chosen by the author.', archivedAt: null, demo: false, shareLocation: false, location: { placeId: 'private-place', label: 'A private workshop', latitude: 12.345678, longitude: 76.54321, source: 'gps-consent', experiencedAt: '2026-10-01' }, media: [], ...extra });
const world = memories => ({ user: { id: 'me', displayName: 'Alex', demo: false }, memories, sent: [], received: [], discoveries: [], jobs: [] });

test('public showroom contains exactly three completed cached gifts and only static public navigation', async () => {
  const items = publicCollectionItems();
  assert.deepEqual(items.map(item => item.id), ['rio-example', 'paris-example', 'antikythera-example']);
  for (const item of items) {
    const name = item.id.replace('-example', ''), manifestPath = name === 'rio' ? '../public/demo/rio-generated-gift.json' : `../public/demo/${name === 'paris' ? 'v17' : 'v13'}/${name}-generated-gift.json`;
    const manifest = JSON.parse(await readFile(new URL(manifestPath, import.meta.url), 'utf8'));
    assert.equal(item.title, manifest.title); assert.equal(item.story, manifest.story); assert.equal(item.imageUrl, name === 'paris' ? manifest.keepsakeImageUrl : manifest.originalUrl); assert.equal(item.modelUrl, manifest.modelUrl); assert.equal(item.photoIntent, manifest.photoIntent);
    assert.equal(item.openPath, `generated/${item.id}`); assert.equal(item.worldPath, `generated/${item.id}?view=world`);
    assert.equal(item.kind, 'generated'); assert.equal(item.demo, true);
    if (name === 'paris') { assert.equal(item.originalImageUrl, manifest.originalUrl); assert.equal(item.objectRepresentation, 'souvenir-miniature'); assert.equal(manifest.objectRepresentation, 'souvenir-miniature'); assert.equal(item.modelYaw, -Math.PI / 2); assert.equal(manifest.modelYaw, undefined, 'The keepsake viewer retains native orientation'); assert.notEqual(item.imageUrl, item.originalImageUrl); }
    assert.equal(item.mobileModelUrl, `/assets/daylight-desk/keepsakes/${name}-mobile.glb`);
    for (const path of [item.imageUrl, item.modelUrl, item.mobileModelUrl, manifest.worldUrl]) { assert.match(path, /^\/(assets|demo)\//); assert.equal(/[?#]/.test(path), false); await access(new URL(`../public${path}`, import.meta.url)); }
  }
  const first = publicCollectionItems(); first[0].modelUrl = '/api/instant?action=asset&token=private'; first.pop();
  assert.equal(publicCollectionItems().length, 3); assert.equal(publicCollectionItems()[0].modelUrl, '/demo/rio-keepsake.glb');
  assert.equal(JSON.stringify(publicCollectionItems()).includes('token='), false);
});

test('only authorized nonarchived snapshot memories are projected, including received items, without mutating the source', () => {
  const source = world([memory(), memory('received', { ownerId: 'other', ownerName: 'Maya' }), memory('archive', { archivedAt: '2026-10-01T10:00:00Z' }), memory('own', { title: 'Duplicate' })]);
  source.received.push({ memoryId: 'not-in-snapshot', senderName: 'Not authorized', token: 'secret-capability' });
  source.sent.push({ memoryId: 'another-missing', token: 'another-secret' });
  const before = JSON.stringify(source), items = collectionItemsFromWorld(source, 100);
  assert.deepEqual(items.map(item => item.id), ['own', 'received']); assert.equal(items[0].subtitle, 'Your memory'); assert.equal(items[1].subtitle, 'Received from Maya');
  assert.equal(items[0].story, source.memories[0].story); assert.equal(items[0].kind, 'memory'); assert.equal(items[0].demo, false);
  items[0].title = 'Changed projection'; assert.equal(JSON.stringify(source), before);
  assert.equal(JSON.stringify(items).includes('secret-capability'), false);
});

test('unshared geography never enters subtitle or projection while explicit shared labels remain human readable', () => {
  const items = collectionItemsFromWorld(world([memory(), memory('shared', { shareLocation: true }), memory('default', { shareLocation: undefined })]), 100);
  assert.equal(items[0].subtitle.includes('private'), false); assert.equal(items[2].subtitle.includes('private'), false); assert.match(items[1].subtitle, /A private workshop/);
  for (const item of items) { assert.equal('location' in item, false); assert.equal(JSON.stringify(item).includes('12.345678'), false); assert.equal(JSON.stringify(item).includes('76.54321'), false); assert.equal(JSON.stringify(item).includes('gps-consent'), false); }
});

test('media expiration uses Unix seconds, skips expired URLs, and retains the earliest selected positive expiry', () => {
  const items = collectionItemsFromWorld(world([memory('valid', { media: [media('gift-photo', '/photo.jpg', 110), media('model', '/gift.glb', 120), media('world', '/world.spz', 115)] }), memory('expired', { media: [media('gift-photo', '/expired.jpg', 99), media('model', '/expired.glb', 100), media('world', '/expired.spz', 100)] }), memory('fallback', { media: [media('gift-photo', '/expired.jpg', 99), media('place-photo', '/place.jpg'), media('model', '/gift.glb')] })]), 100);
  assert.equal(items[0].imageUrl, '/photo.jpg'); assert.equal(items[0].modelUrl, '/gift.glb'); assert.equal(items[0].mediaExpiresAt, 110); assert.equal(items[0].worldPath, 'memory/valid?view=world');
  for (const key of ['imageUrl', 'modelUrl', 'worldPath', 'mediaExpiresAt']) assert.equal(key in items[1], false);
  assert.equal(items[1].openPath, 'memory/expired'); assert.equal(items[2].imageUrl, '/place.jpg'); assert.equal('mediaExpiresAt' in items[2], false);
  for (const url of ['/expired.jpg', '/expired.glb', '/expired.spz']) assert.equal(JSON.stringify(items).includes(url), false);
});

test('only valid image, model and spatial-world roles are used, with unsafe URLs or expiry metadata omitted', () => {
  const items = collectionItemsFromWorld(world([memory('roles', { media: [media('audio', '/note.mp3', 105, 'audio/mpeg'), media('world', '/panorama.jpg', 105, 'image/jpeg'), media('world', '/collider.glb', 105, 'model/gltf-binary'), media('model', '/not-a-model.png', 105, 'image/png'), media('model', 'javascript:alert(1)', 110), media('gift-photo', 'data:text/html,hello', 0), media('place-photo', 'https://user:password@example.com/photo.jpg', 0), media('gift-photo', 'https://example.com/expired.jpg', NaN), media('model', '/invalid.glb', -1)] })]), 100);
  for (const key of ['imageUrl', 'modelUrl', 'worldPath', 'mediaExpiresAt']) assert.equal(key in items[0], false);
  const safe = collectionItemsFromWorld(world([memory('safe', { media: [media('gift-photo', 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E'), media('model', 'https://storage.example.com/model.glb?signature=authorized', 150)] })]), 100)[0];
  assert.match(safe.imageUrl, /^data:image\/svg/); assert.equal(safe.modelUrl, 'https://storage.example.com/model.glb?signature=authorized'); assert.equal(safe.mediaExpiresAt, 150);
});

test('memory navigation encodes only the identifier and never gains gift credentials or persists authorized state', () => {
  const names = ['localStorage', 'sessionStorage', 'fetch'], saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, get() { throw Error('Projection must not fetch or persist'); } });
    const id = 'a/b?key=private#fragment', source = world([memory(id)]); source.received.push({ memoryId: id, token: 'private', claimToken: 'claim-private', url: 'https://example.com/private' });
    const item = collectionItemsFromWorld(source, 100)[0]; assert.equal(item.openPath, `memory/${encodeURIComponent(id)}`); assert.equal(item.worldPath, undefined); assert.equal(item.openPath.includes('?key='), false);
    assert.equal('token' in item, false); assert.equal('ownerId' in item, false); assert.equal('claimToken' in item, false);
    assert.equal(publicCollectionItems().length, 3);
  } finally { for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
});
