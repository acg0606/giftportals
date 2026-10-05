import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const modules = new Map();
async function moduleURL(path) {
  if (modules.has(path.href)) return modules.get(path.href);
  let source = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const match of [...source.matchAll(/from\s*(['"])(\.{1,2}\/[^'"]+)\1/g)]) {
    const target = new URL(match[2].endsWith('.ts') ? match[2] : `${match[2].replace(/\.js$/, '')}.ts`, path);
    source = source.replaceAll(`${match[1]}${match[2]}${match[1]}`, JSON.stringify(await moduleURL(target)));
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  modules.set(path.href, url); return url;
}
const { publicWorldOverlayPath, publicWorldOverlay, readPublicWorldOverlay } = await import(await moduleURL(new URL('../src/public-world-overlay.ts', import.meta.url)));
const { readPublicGift } = await import(await moduleURL(new URL('../src/public-gallery.ts', import.meta.url)));
const court = 'c864acd7-88d0-4b02-bff7-67ae186243dc', playground = 'cc997d6d-faf2-4b5a-8bfa-9196716bec71';
const hashes = { [court]: '2364ff368b4c479088b0d33ee01129a26ad2aaef00e3db5a63b214b9119f2dda', [playground]: '7ec67ecc34a519689e69a6aa972849385907382ac77a7d91a8fb9c9814b3db82' };
const overlay = (id = court) => {
  const base = `/demo/v12/${id === court ? 'pracinha-court' : 'pracinha-playground'}`;
  return { version: 1, targetPublicGiftId: id, referenceSha256: hashes[id], worldUrl: `${base}/world-500k.spz`, mobileWorldUrl: `${base}/world-100k.spz`, panoramaUrl: `${base}/panorama.png`, collisionUrl: `${base}/collider.glb`, worldSemantics: { metricScaleFactor: 1.25, groundPlaneOffset: .7 }, initialYaw: .2, initialPitch: .1 };
};
const gift = extra => ({ title: 'Original praça name', story: 'Queria voce aqui tambem , curtindo esse role!', dedication: 'For my friend', senderName: 'André', recipientName: 'Você', originalUrl: 'https://archive.example/original.jpg?signature=public', keepsakeImageUrl: '/existing/reference.png', modelUrl: '/existing/model.glb', worldUrl: '/existing/world.spz', panoramaUrl: '/existing/panorama.png', collisionUrl: '/existing/collider.glb', colliderUrl: '/existing/collider-alias.glb', worldSemantics: { metricScaleFactor: 3, groundPlaneOffset: 2 }, initialYaw: -.4, initialPitch: -.2, mediaExpiresAt: Date.now() / 1000 + 3600, ...extra });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('both reviewed praça overlays bind the exact gift and archived original photo without exposing identity fields', () => {
  for (const id of [court, playground]) {
    const data = overlay(id), world = publicWorldOverlay(id, data);
    assert.equal(publicWorldOverlayPath(id), `${data.worldUrl.replace(/\/[^/]+$/, '')}/world-overlay.json`);
    assert.equal(world.worldUrl, data.worldUrl); assert.equal(world.panoramaUrl, data.panoramaUrl); assert.equal(world.collisionUrl, data.collisionUrl);
    assert.deepEqual(world.worldSemantics, data.worldSemantics); assert.notEqual(world.worldSemantics, data.worldSemantics);
    assert.equal(world.initialYaw, .2); assert.equal(world.initialPitch, .1);
    assert.equal(world.colliderUrl, undefined); assert.equal('targetPublicGiftId' in world, false); assert.equal('referenceSha256' in world, false);
  }
  for (const id of ['__proto__', 'constructor', 'other-gift', '00000000-0000-4000-8000-000000000001']) {
    assert.equal(publicWorldOverlayPath(id), undefined); assert.equal(publicWorldOverlay(id, overlay()), undefined);
  }
});

test('wrong gift or photo, unsafe world fields and invalid geometry metadata cannot replace the archived world', () => {
  for (const change of [
    { version: 2 }, { targetPublicGiftId: playground }, { referenceSha256: hashes[playground] }, { referenceSha256: 'a'.repeat(64) },
    { worldUrl: '/demo/v12/pracinha-playground/world-500k.spz' }, { worldUrl: 'https://cdn.example/world.spz' },
    { worldUrl: '/demo/v12/pracinha-court/../world.spz' }, { worldUrl: '/demo/v12/pracinha-court/world.spz?token=secret' },
    { worldUrl: '/demo/v12/pracinha-court/world.spz#secret' }, { worldUrl: '//example.com/world.spz' },
    { mobileWorldUrl: '/demo/v12/pracinha-court/wrong.glb' }, { collisionUrl: '/existing/collider.glb' },
    { panoramaUrl: '/demo/v12/pracinha-court/panorama.svg' }, { panoramaUrl: 'javascript:alert(1)' },
    { modelUrl: '/new/model.glb' }, { originalUrl: '/new/photo.jpg' }, { title: 'Changed title' }, { story: 'Changed words' }, { token: 'private' },
    { worldSemantics: { metricScaleFactor: 0, groundPlaneOffset: 0 } }, { worldSemantics: { metricScaleFactor: 1, groundPlaneOffset: Infinity } },
    { initialYaw: Math.PI + .01 }, { initialYaw: '0' }, { initialPitch: .851 }, { initialPitch: NaN },
  ]) assert.equal(publicWorldOverlay(court, { ...overlay(), ...change }), undefined, JSON.stringify(change));
  for (const value of [null, [], 'invalid', {}]) assert.equal(publicWorldOverlay(court, value), undefined);
  const withoutCollider = overlay(); delete withoutCollider.collisionUrl; delete withoutCollider.initialYaw; delete withoutCollider.initialPitch;
  const world = publicWorldOverlay(court, withoutCollider);
  assert.equal(world.collisionUrl, undefined); assert.equal(world.colliderUrl, undefined); assert.equal(world.initialYaw, undefined); assert.equal(world.initialPitch, undefined);
});

test('runtime overlay changes only world media and pose while preserving the original public gift and source object', async () => {
  const original = Object.freeze(gift()), before = structuredClone(original), data = overlay(), calls = [];
  const replaced = await readPublicWorldOverlay(court, original, new AbortController().signal, async (url, init) => { calls.push({ url, init }); return response(data); });
  assert.deepEqual(original, before); assert.equal(calls.length, 1); assert.equal(calls[0].url, publicWorldOverlayPath(court));
  assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].init.credentials, 'omit'); assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.headers, undefined); assert.equal(calls[0].init.body, undefined);
  for (const key of ['title', 'story', 'dedication', 'senderName', 'recipientName', 'originalUrl', 'keepsakeImageUrl', 'modelUrl', 'mediaExpiresAt']) assert.equal(replaced[key], original[key]);
  assert.equal(replaced.worldUrl, data.worldUrl); assert.equal(replaced.collisionUrl, data.collisionUrl); assert.equal(replaced.colliderUrl, undefined);
  const missing = overlay(); delete missing.collisionUrl; delete missing.initialYaw; delete missing.initialPitch;
  const cleared = await readPublicWorldOverlay(court, original, new AbortController().signal, async () => response(missing));
  for (const key of ['collisionUrl', 'colliderUrl', 'initialYaw', 'initialPitch']) assert.equal(cleared[key], undefined, 'Old world calibration cannot leak into a replacement');
});

test('missing, invalid, oversized or unavailable overlays retain the exact original gift; unrelated gifts do not request one', async () => {
  const original = gift(), signal = new AbortController().signal;
  for (const fetcher of [
    async () => response({}, 404), async () => response({ ...overlay(), story: 'Changed personal words' }),
    async () => new Response('<html>Missing SPA route</html>'), async () => new Response('x'.repeat(16_385)),
    async () => new Response('{}', { headers: { 'content-length': '16385' } }), async () => { throw Error('Unavailable'); },
  ]) assert.equal(await readPublicWorldOverlay(court, original, signal, fetcher), original);
  let calls = 0;
  assert.equal(await readPublicWorldOverlay('unknown', original, signal, async () => { calls++; return response(overlay()); }), original);
  assert.equal(calls, 0);
  const abort = new AbortController();
  await assert.rejects(readPublicWorldOverlay(court, original, abort.signal, async () => { abort.abort(); return response(overlay()); }), error => error.name === 'AbortError');
});

test('public gift read combines owner-approved English presentation with its world overlay while the archive stays intact', async () => {
  const publicRecord = { id: court, title: 'pracinha', story: 'My original approved words', dedication: 'For you', senderName: 'André', recipientName: 'Você', photoIntent: 'place', objectRepresentation: 'souvenir-miniature', sourcePhotoUrl: 'https://archive.example/source.jpg?signature=public', thumbnailUrl: 'https://archive.example/reference.png?signature=public', modelUrl: 'https://archive.example/model.glb?signature=public', worldUrl: 'https://archive.example/old-world.spz?signature=public', colliderUrl: 'https://archive.example/old-collider.glb?signature=public', mediaExpiresAt: Date.now() / 1000 + 3600 };
  const before = structuredClone(publicRecord);
  const calls = [], data = await readPublicGift(court, new AbortController().signal, async (url, init) => {
    calls.push({ url, init }); return url.startsWith('/api/') ? response({ ok: true, data: publicRecord }) : response(overlay());
  });
  assert.deepEqual(calls.map(call => call.url), [`/api/instant-gallery?action=gift&id=${court}`, publicWorldOverlayPath(court)]);
  assert.equal(data.title, 'A quiet square'); assert.equal(data.story, 'A quiet square to enjoy nature. I planted a tree here.'); assert.equal(data.senderName, 'Andrew'); assert.equal(data.recipientName, 'You');
  assert.equal(data.dedication, 'I wish you were here, enjoying this place with me!'); assert.deepEqual(publicRecord, before);
  assert.equal(data.originalUrl, publicRecord.sourcePhotoUrl); assert.equal(data.modelUrl, publicRecord.modelUrl); assert.equal(data.worldUrl, overlay().worldUrl);
});
