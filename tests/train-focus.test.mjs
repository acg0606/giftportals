import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function sourceModule(name) {
  const compiled = ts.transpileModule(await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
}
const art = await sourceModule('art.ts');
const trainSource = Buffer.from((await sourceModule('train.ts')).split(',')[1], 'base64').toString().replaceAll("'./art'", JSON.stringify(art));
const { trainFocusBoundary } = await import(`data:text/javascript;base64,${Buffer.from(trainSource).toString('base64')}`);
const button = (name, extra = {}) => ({ name, disabled: false, hidden: false, ...extra });

test('a train without narration wraps from Replay to Skip, not to the disabled sound control', () => {
  const skip = button('skip'), replay = button('replay'), unavailable = button('sound', { disabled: true });
  assert.equal(trainFocusBoundary([skip, replay, unavailable], replay, false), skip);
  assert.equal(trainFocusBoundary([skip, replay, unavailable], skip, true), replay);
});

test('available narration participates in the boundary while interior Tab uses normal browser order', () => {
  const skip = button('skip'), replay = button('replay'), sound = button('sound');
  assert.equal(trainFocusBoundary([skip, replay, sound], sound, false), skip);
  assert.equal(trainFocusBoundary([skip, replay, sound], skip, true), sound);
  assert.equal(trainFocusBoundary([skip, replay, sound], replay, false), null);
  assert.equal(trainFocusBoundary([skip, replay, sound], replay, true), null);
});

test('hidden controls cannot trap keyboard focus at an unreachable endpoint', () => {
  const skip = button('skip'), replay = button('replay'), hidden = button('hidden', { hidden: true });
  assert.equal(trainFocusBoundary([hidden, skip, replay, hidden], replay, false), skip);
  assert.equal(trainFocusBoundary([hidden, skip, replay, hidden], skip, true), replay);
});

test('unexpected outside focus is returned to the modal in the requested direction', () => {
  const skip = button('skip'), replay = button('replay');
  assert.equal(trainFocusBoundary([skip, replay], { name: 'background' }, false), skip);
  assert.equal(trainFocusBoundary([skip, replay], null, true), replay);
  assert.equal(trainFocusBoundary([], null, false), null);
});

test('the boundary respects frozen controls and handles a single available button', () => {
  const skip = Object.freeze(button('skip')), disabled = Object.freeze(button('unavailable', { disabled: true }));
  const controls = Object.freeze([skip, disabled]), before = JSON.stringify(controls);
  assert.equal(trainFocusBoundary(controls, skip, false), skip);
  assert.equal(trainFocusBoundary(controls, skip, true), skip);
  assert.equal(JSON.stringify(controls), before);
});
