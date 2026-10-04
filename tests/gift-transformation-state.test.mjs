import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/gift-transformation-state.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { giftTransformationState } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const queued = {
  id: 'synthetic-job', state: 'processing', tripo: { state: 'pending' }, worldlabs: { state: 'pending' },
  assets: { photoUrl: '/original.jpg' },
};
const model = { ...queued, tripo: { state: 'completed' }, assets: { ...queued.assets, modelUrl: '/real-model.glb' } };
const completed = { ...model, state: 'completed', worldlabs: { state: 'completed' }, assets: { ...model.assets, worldUrl: '/real-world.spz' } };

test('real stage transitions alone advance the photograph, sculpture, world and completed gift', () => {
  const snapshots = [
    queued,
    { ...queued, tripoReference: { state: 'processing', progress: 100 } },
    { ...queued, tripoReference: { state: 'completed' }, tripo: { state: 'processing', progress: 0 }, assets: { ...queued.assets, tripoInputUrl: '/checked-reference.png' } },
    { ...model, worldlabs: { state: 'processing', progress: 99 } },
    completed,
  ];
  assert.deepEqual(snapshots.map(job => giftTransformationState(job).phase), ['awakening', 'awakening', 'shaping', 'world', 'ready']);
  assert.deepEqual(snapshots.map(job => giftTransformationState(job).modelReady), [false, false, false, true, true]);
  assert.equal(giftTransformationState(snapshots[2]).referenceUrl, '/checked-reference.png');
});

test('a Tripo or reference failure/cancellation stops the transformation even while the world is processing', () => {
  for (const stage of ['tripo', 'tripoReference']) for (const state of ['failed', 'cancelled', 'canceled']) {
    const job = { ...queued, [stage]: { state }, worldlabs: { state: 'processing' }, assets: { ...queued.assets, modelUrl: '/unverified-model.glb' } };
    const result = giftTransformationState(job);
    assert.equal(result.phase, 'interrupted'); assert.equal(result.modelReady, false); assert.equal(result.modelUrl, undefined);
  }
  assert.equal(giftTransformationState({ ...completed, tripoReference: { state: 'failed' } }).phase, 'interrupted', 'A stale overall success flag cannot overrule a failed reference');
});

test('an interrupted world keeps an actually delivered model available for preview without declaring the gift ready', () => {
  for (const state of ['failed', 'cancelled', 'canceled']) {
    const result = giftTransformationState({ ...model, worldlabs: { state } });
    assert.equal(result.phase, 'interrupted'); assert.equal(result.modelReady, true); assert.equal(result.modelUrl, '/real-model.glb');
  }
  assert.equal(giftTransformationState({ ...queued, tripo: { state: 'processing' }, worldlabs: { state: 'failed' } }).phase, 'interrupted');
});

test('terminal partial/failed jobs and contradictory completed snapshots never keep a success animation running', () => {
  for (const state of ['partial', 'failed', 'cancelled']) {
    assert.equal(giftTransformationState({ ...queued, state, worldlabs: { state: 'processing' } }).phase, 'interrupted');
    const result = giftTransformationState({ ...model, state, worldlabs: { state: 'processing' } });
    assert.equal(result.phase, 'interrupted'); assert.equal(result.modelReady, true);
  }
  for (const job of [
    { ...completed, assets: { photoUrl: '/photo.jpg', worldUrl: '/world.spz' } },
    { ...completed, assets: { ...completed.assets, worldUrl: undefined, panoramaUrl: '/photo-is-not-a-world.jpg' } },
    { ...completed, worldlabs: { state: 'processing' } },
    { ...completed, tripo: { state: 'processing' } },
  ]) assert.equal(giftTransformationState(job).phase, 'interrupted');
});

test('provider URLs, 100 percent progress and panoramas do not substitute for usable completion states/assets', () => {
  const pending = giftTransformationState({ ...queued, tripo: { state: 'processing', progress: 100 }, assets: { ...completed.assets } });
  assert.equal(pending.phase, 'shaping'); assert.equal(pending.modelReady, false); assert.equal(pending.modelUrl, undefined);
  assert.equal(giftTransformationState({ ...queued, tripo: { state: 'completed' } }).phase, 'interrupted');
  assert.equal(giftTransformationState({ ...model, assets: { ...model.assets, modelUrl: ' ' } }).modelReady, false);
  assert.equal(giftTransformationState({ ...model, worldlabs: { state: 'completed' } }).phase, 'interrupted');
  assert.equal(giftTransformationState({ ...completed, state: 'processing' }).phase, 'world', 'Final assembly does not declare a complete gift before its overall completion receipt');
});

test('an active reference precedes shaping, while a delivered model takes precedence over a stale active reference', () => {
  assert.equal(giftTransformationState({ ...queued, tripo: { state: 'processing' }, tripoReference: { state: 'queued' } }).phase, 'awakening');
  assert.equal(giftTransformationState({ ...model, tripoReference: { state: 'processing' } }).phase, 'world');
  assert.equal(giftTransformationState({ ...queued, tripo: { state: 'queued' } }).phase, 'awakening');
  assert.equal(giftTransformationState({ ...queued, tripo: { state: 'unexpected' } }).phase, 'interrupted');
});

test('the presentation projection retains only requested fields and does not mutate or copy private source metadata', () => {
  const job = { ...completed, token: 'fictional-private-capability', imageDataUrl: 'data:image/png;base64,private-bytes', privateMetadata: { location: 'precise-location' }, assets: { ...completed.assets, tripoInputUrl: '/checked-reference.png' } };
  const before = JSON.stringify(job), result = giftTransformationState(job);
  assert.deepEqual(result, { phase: 'ready', modelReady: true, photoUrl: '/original.jpg', referenceUrl: '/checked-reference.png', modelUrl: '/real-model.glb', jobId: 'synthetic-job' });
  assert.equal(JSON.stringify(job), before); assert.equal(JSON.stringify(result).includes(job.token), false); assert.equal('assets' in result, false);
  assert.equal(giftTransformationState({ ...queued, assets: { photoUrl: '', tripoInputUrl: ' ' } }).referenceUrl, undefined);
});
