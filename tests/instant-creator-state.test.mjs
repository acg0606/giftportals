import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext };
const catalog = ts.transpileModule(await readFile(new URL('../shared/instant-examples.ts', import.meta.url), 'utf8'), { compilerOptions }).outputText;
const catalogUrl = `data:text/javascript;base64,${Buffer.from(catalog).toString('base64')}`;
const compiled = ts.transpileModule(await readFile(new URL('../src/instant-creator-state.ts', import.meta.url), 'utf8'), { compilerOptions }).outputText.replaceAll("'../shared/instant-examples'", JSON.stringify(catalogUrl));
const { validateInstantPhoto, instantFailureMessage, instantGiftReady, instantJobFinished, instantModelReady, instantProviderLabel, instantWorldReady, readInstantJobReference, readInstantPendingReference, instantImagePlan, instantIntentExamples, instantPostcardLayout, addInstantSpark, INSTANT_EXAMPLES } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const complete = { state: 'completed', tripo: { state: 'completed' }, worldlabs: { state: 'completed' }, assets: { photoUrl: '/photo.png', modelUrl: '/gift.glb', worldUrl: '/place.spz' } };

test('a usable gift requires a terminal creation and a real completed keepsake; a photo or world cannot substitute for its model', () => {
  assert.equal(instantGiftReady(complete), true);
  for (const job of [
    { ...complete, state: 'processing' },
    { ...complete, tripo: { state: 'processing' } },
    { ...complete, state: 'failed' },
    { ...complete, assets: { ...complete.assets, modelUrl: undefined } },
    { ...complete, assets: { photoUrl: '/photo.png', worldUrl: '/place.spz', panoramaUrl: '/panorama.png' } },
  ]) assert.equal(instantGiftReady(job), false);
});

test('a partial keepsake stays usable when the world fails, without making a failed or missing world ready', () => {
  const partial = { ...complete, state: 'partial', worldlabs: { state: 'failed', errorCode: 'PROVIDER_GENERATION_FAILED' }, assets: { photoUrl: '/photo.png', modelUrl: '/gift.glb' } };
  assert.equal(instantGiftReady(partial), true);assert.equal(instantModelReady(partial), true);assert.equal(instantWorldReady(partial), false);
  assert.equal(instantWorldReady({ ...partial, assets: { ...partial.assets, worldUrl: '/stale-world.spz' } }), false, 'Failed-world stale URLs do not make a world available');
  assert.equal(instantGiftReady({ ...partial, tripo: { state: 'failed' }, worldlabs: { state: 'completed' }, assets: { photoUrl: '/photo.png', worldUrl: '/place.spz' } }), false);
  assert.equal(instantGiftReady({ ...partial, assets: { photoUrl: '/photo.png', panoramaUrl: '/panorama.png' } }), false);
  assert.equal(instantWorldReady({ ...complete, assets: { modelUrl: '/gift.glb' } }), false);
  assert.equal(instantGiftReady({ ...complete, assets: { photoUrl: '/photo.png', modelUrl: '/gift.glb' } }), true, 'A delivered souvenir remains usable without a world asset');
});

test('partial and failed jobs stop polling; only a partial with a delivered keepsake can open', () => {
  for (const state of ['partial', 'failed']) {
    const job = { ...complete, state };
    assert.equal(instantJobFinished(job), true);
    assert.equal(instantGiftReady(job), state === 'partial');
  }
  assert.equal(instantJobFinished({ ...complete, state: 'processing' }), false);
  assert.match(instantProviderLabel('worldlabs', 'failed'), /could not/);
  assert.match(instantProviderLabel('tripo', 'processing'), /Sculpting/);
});

test('a world-only retry keeps the delivered souvenir usable while a first creation still waits for completion', () => {
  const retry = { ...complete, state: 'processing', worldlabs: { state: 'processing' }, worldRetry: { available: false, attempts: 1 }, assets: { photoUrl: '/photo', modelUrl: '/gift.glb' } };
  assert.equal(instantGiftReady(retry), true); assert.equal(instantWorldReady(retry), false); assert.equal(instantJobFinished(retry), false);
  assert.equal(instantGiftReady({ ...retry, worldRetry: undefined }), false);
  assert.equal(instantGiftReady({ ...retry, tripo: { state: 'processing' } }), false);
  assert.equal(instantGiftReady({ ...retry, assets: { photoUrl: '/photo' } }), false);
});

test('terminal photo failures offer an honest next action while an uncertain submission stays uncertain', () => {
  const failed = code => ({ ...complete, state: 'failed', tripo: { state: 'failed', errorCode: code }, worldlabs: { state: 'failed', errorCode: code } });
  for (const code of ['PHOTO_SAFETY_BLOCKED', 'PHOTO_SAFETY_REVIEW_REQUIRED']) {
    const message = instantFailureMessage(failed(code));
    assert.match(message, /photo check .*approve this photo/i);assert.match(message, /Choose a different photo/);
    assert.doesNotMatch(message, /sexual|adult|still being created|PHOTO_SAFETY|retry automatically/i);
  }
  assert.match(instantFailureMessage(failed('IMAGE_CONTENT_INVALID')), /could not be verified.*original photo/);
  assert.match(instantFailureMessage(failed('PROVIDER_INSUFFICIENT_CREDITS')), /not have enough credits.*words are kept/);
  assert.match(instantFailureMessage(failed('SUBMISSION_AMBIGUOUS')), /could not confirm.*recovery details are kept/);
  assert.match(instantFailureMessage({ ...complete, state: 'failed', tripo: { state: 'pending' }, worldlabs: { state: 'pending' } }), /could not be created/);
  assert.equal(instantFailureMessage(complete), undefined);assert.equal(instantFailureMessage({ ...complete, state: 'processing' }), undefined);
});

test('invalid photo data and provider upload limits fail before submission', () => {
  assert.equal(validateInstantPhoto({ type: 'image/jpeg', size: 6 * 1024 * 1024 }), null);
  assert.match(validateInstantPhoto({ type: 'image/jpeg', size: 6 * 1024 * 1024 + 1 }), /under 6 MB/);
  assert.match(validateInstantPhoto({ type: 'image/png', size: 0 }), /empty/);
  assert.match(validateInstantPhoto({ type: 'image/png', size: NaN }), /empty/);
  assert.match(validateInstantPhoto({ type: 'image/svg+xml', size: 200 }), /JPG, PNG, or WebP/);
  assert.equal(validateInstantPhoto({ type: 'image/webp', size: 100 }), null);
});

test('refresh recovery keeps only validated capability references', () => {
  const id = 'd7b36439-521d-4bbd-b537-78178140801b', token = 'a'.repeat(43), dedupeKey = 'gift-' + id;
  assert.deepEqual(readInstantJobReference(JSON.stringify({ id, token, story: 'not retained' })), { id, token });
  assert.deepEqual(readInstantPendingReference(JSON.stringify({ dedupeKey, requestToken: token })), { dedupeKey, token });
  for (const raw of [null, '', '{', 'null', '{}', JSON.stringify({ id, token: 'short' }), JSON.stringify({ id: '../private', token })]) assert.equal(readInstantJobReference(raw), null);
  for (const raw of [null, '{', '{}', JSON.stringify({ dedupeKey, requestToken: 'short' }), JSON.stringify({ dedupeKey: '<script>', requestToken: token })]) assert.equal(readInstantPendingReference(raw), null);
});

test('a place preserves its original and permits automatic miniature derivation or an explicit curated reference', () => {
  const original = 'data:image/png;base64,original', miniature = 'data:image/png;base64,miniature', otherPlace = 'data:image/jpeg;base64,other-place';
  assert.deepEqual(instantImagePlan('place', original), { photoIntent: 'place', imageDataUrl: original });
  assert.deepEqual(instantImagePlan('place', original, miniature), { photoIntent: 'place', imageDataUrl: original, objectImageDataUrl: miniature, objectImageRole: 'miniature-reference' });
  assert.deepEqual(instantImagePlan('place', original, miniature, otherPlace), { photoIntent: 'place', imageDataUrl: original, objectImageDataUrl: miniature, objectImageRole: 'miniature-reference', worldImageDataUrl: otherPlace });
  assert.deepEqual(instantImagePlan('object', original, undefined, undefined, otherPlace), { photoIntent: 'object', imageDataUrl: original, worldImageDataUrl: otherPlace });
});

test('reference preparation labels never claim a GLB has begun or completed', () => {
  assert.equal(instantProviderLabel('tripo', 'pending', 'processing'), 'Imagining your little souvenir…');
  assert.equal(instantProviderLabel('tripo', 'processing', 'completed'), 'Sculpting your keepsake…');
  assert.equal(instantProviderLabel('tripo', 'failed', 'failed'), 'The souvenir reference could not be made.');
  assert.equal(instantProviderLabel('tripo', 'completed', 'completed'), 'Your keepsake is sculpted.');
  assert.equal(instantProviderLabel('worldlabs', 'processing', 'processing'), 'Building the place inside…');
});

test('unknown provider acknowledgement is not presented as a definitive generation failure', () => {
  assert.equal(instantProviderLabel('tripo', 'failed', 'failed', 'SUBMISSION_AMBIGUOUS'), 'We couldn’t confirm your souvenir.');
  assert.equal(instantProviderLabel('worldlabs', 'failed', undefined, 'SUBMISSION_AMBIGUOUS'), 'We couldn’t confirm the world creation.');
  assert.equal(instantGiftReady({ ...complete, state: 'processing', tripo: { state: 'failed', errorCode: 'SUBMISSION_AMBIGUOUS' } }), false);
});

test('real provider credit failures explain the unavailable stage without imposing a daily limit or changing completed stages', () => {
  assert.match(instantProviderLabel('tripo', 'pending', 'failed', 'PROVIDER_INSUFFICIENT_CREDITS'), /service has insufficient credits/, 'A failed miniature reference explains the interrupted souvenir before model submission');
  for (const provider of ['tripo', 'worldlabs']) {
    const label = instantProviderLabel(provider, 'failed', 'failed', 'PROVIDER_INSUFFICIENT_CREDITS');
    assert.match(label, /service has insufficient credits for this creation/);
    assert.doesNotMatch(label, /quota|per day|daily|reset|billing/i);
    assert.match(instantProviderLabel(provider, 'completed', 'completed', 'PROVIDER_INSUFFICIENT_CREDITS'), /ready|sculpted/);
  }
});

test('city and object examples keep distinct references and changing intent never mutates the catalog', () => {
  const before = JSON.stringify(INSTANT_EXAMPLES), places = instantIntentExamples(INSTANT_EXAMPLES, 'place');
  assert.equal(places.length, 5);
  assert.equal(places[0].imageUrl, '/assets/examples/v13/rio.jpg');
  assert.equal(places[1].imageUrl, '/assets/examples/v13/paris.jpg');
  assert.equal(places[0].worldImageUrl, undefined);
  assert.equal(instantIntentExamples(INSTANT_EXAMPLES, 'object').length, 5);
  assert.equal(instantIntentExamples(INSTANT_EXAMPLES, 'object')[0].imageUrl, '/assets/examples/v13/antikythera.jpg');
  assert.equal(JSON.stringify(INSTANT_EXAMPLES), before);
});

test('framed references fit whole panorama and portrait photos inside bounded dimensions', () => {
  for (const [width, height] of [[4032, 1008], [1200, 3000], [1600, 1600]]) {
    const layout = instantPostcardLayout(width, height);
    assert.equal(layout.canvas, 1536);
    assert.ok(layout.frameX >= 0 && layout.frameY >= 0);
    assert.ok(layout.frameX + layout.frameWidth <= layout.canvas && layout.frameY + layout.frameHeight <= layout.canvas);
    assert.ok(layout.photoWidth <= 1120 && layout.photoHeight <= 880);
    assert.ok(Math.abs(layout.photoWidth / layout.photoHeight - width / height) < .01);
  }
  assert.throws(() => instantPostcardLayout(0, 10), TypeError);
});

test('local waiting-room lights do not unlock an unfinished job or substitute for a ready 3D model', () => {
  const waiting = { ...complete, state: 'processing', worldlabs: { state: 'processing' } };
  let lights = 0; for (let press = 0; press < 50; press++) lights = addInstantSpark(lights);
  assert.equal(lights, 12);
  assert.equal(instantGiftReady(waiting), false);
  assert.equal(instantModelReady(waiting), true);
  assert.equal(instantModelReady({ ...waiting, tripo: { state: 'processing' } }), false);
  assert.equal(instantModelReady({ ...waiting, assets: { photoUrl: '/photo.png' } }), false);
  assert.equal(addInstantSpark(NaN), 1);
});
