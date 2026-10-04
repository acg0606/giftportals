import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(await readFile(new URL('../src/rio-creator-state.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { newRioCreatorDraft, normalizeRioCreatorDraft, encodeRioCreatorDraft, decodeRioCreatorDraft, saveRioCreatorDraft, loadRioCreatorDraft } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('drafts start independently with the fictional Rio story and no implicit storage access', () => {
  const first = newRioCreatorDraft(), second = newRioCreatorDraft();
  assert.deepEqual(first, {
    version: 1, title: 'A little piece of Rio', sender: 'Clara', recipient: '',
    dedication: 'This little piece of Rio made me think of you.',
    story: 'I wanted you to feel the light, the breeze, and the afternoon that made me think of you.', theme: 'paper',
  });
  first.title = 'A changed draft';
  assert.equal(second.title, 'A little piece of Rio');
});

test('Unicode, URL-special characters and HTML-looking text survive as plain data', () => {
  const draft = {
    ...newRioCreatorDraft(), title: 'Pão de Açúcar 🌅 東京', sender: 'João & Clara', recipient: 'Ana + Luísa',
    dedication: 'Meet me? #Rio = 100% sunshine / water & sky',
    story: '<img src=x onerror="throw new Error()">\nA memory, not markup. 💌', theme: 'ocean',
  };
  assert.deepEqual(decodeRioCreatorDraft(encodeRioCreatorDraft(draft)), draft);
  const outer = new URLSearchParams({ draft: encodeRioCreatorDraft(draft) });
  assert.deepEqual(decodeRioCreatorDraft(new URLSearchParams(outer.toString()).get('draft')), draft);
});

test('temporary empty input remains restorable without enforcing the controller submission rules', () => {
  const empty = { version: 1, title: '', sender: '', recipient: '', dedication: '', story: '', theme: 'paper' };
  assert.deepEqual(normalizeRioCreatorDraft(empty), empty);
  assert.deepEqual(decodeRioCreatorDraft(encodeRioCreatorDraft(empty)), empty);
});

test('normalization rejects non-drafts and never evaluates getters or coerces values', () => {
  const draft = newRioCreatorDraft();
  for (const input of [null, [], 'draft', new Date(), Object.create(draft), { ...draft, version: 2 },
    { ...draft, sender: 5 }, { ...draft, theme: 'custom-url' }, { ...draft, title: '\uD800' }]) {
    assert.equal(normalizeRioCreatorDraft(input), null);
  }
  let getterCalls = 0;
  const accessor = { ...draft };
  Object.defineProperty(accessor, 'story', { get() { getterCalls++; return 'Not evaluated'; } });
  assert.equal(normalizeRioCreatorDraft(accessor), null);
  assert.equal(getterCalls, 0);
  const { recipient, ...incomplete } = draft;
  assert.equal(normalizeRioCreatorDraft(incomplete), null);
});

test('bounded fields accept their limit and reject oversized drafts before persistence', () => {
  const limits = { title: 80, sender: 60, recipient: 60, dedication: 280, story: 900 };
  const longest = { ...newRioCreatorDraft(), ...Object.fromEntries(Object.entries(limits).map(([field, length]) => [field, '海'.repeat(length)])) };
  assert.deepEqual(decodeRioCreatorDraft(encodeRioCreatorDraft(longest)), longest);
  for (const [field, length] of Object.entries(limits)) {
    const oversized = { ...newRioCreatorDraft(), [field]: 'x'.repeat(length + 1) };
    assert.equal(normalizeRioCreatorDraft(oversized), null);
    assert.throws(() => encodeRioCreatorDraft(oversized), TypeError);
    assert.equal(saveRioCreatorDraft(oversized, { setItem() { assert.fail('Invalid draft must not be written'); } }), false);
  }
});

test('unknown properties are omitted without changing the caller draft', () => {
  const draft = { ...newRioCreatorDraft(), providerUrl: 'https://example.invalid/', token: 'unrelated' };
  const clean = normalizeRioCreatorDraft(draft);
  assert.deepEqual(clean, newRioCreatorDraft());
  assert.notEqual(clean, draft);
  assert.equal(draft.token, 'unrelated');
});

test('corrupt, ambiguous, missing-field and oversized tokens are rejected', () => {
  const token = encodeRioCreatorDraft(newRioCreatorDraft());
  for (const corrupt of ['', '%', '%ZZ', '%C0%AF', '%ED%A0%80', '{"version":1}', token + '&theme=ocean',
    token + '&external=1', token + '&', token.replace('&sender=', '&&sender='), token.replace(/&title=[^&]*/, '&title'),
    token.replace('version=1', 'version=01'), token.replace('theme=paper', 'theme=unknown'),
    token.replace(/&sender=[^&]*/, ''), token.replace(/&title=[^&]*/, '&title=%'),
    token.replace(/&title=[^&]*/, '&title=%FF'), 'x'.repeat(14_001)]) {
    assert.equal(decodeRioCreatorDraft(corrupt), null, `Rejected token: ${corrupt.slice(0, 100)}`);
  }
  assert.equal(decodeRioCreatorDraft(undefined), null);
  assert.equal(decodeRioCreatorDraft(null), null);
  const oversizedField = new URLSearchParams(token);
  oversizedField.set('story', 'x'.repeat(901));
  assert.equal(decodeRioCreatorDraft(oversizedField.toString()), null);
});

test('explicit save/load uses the versioned key and handles blocked storage', () => {
  const data = new Map();
  const storage = { setItem(key, value) { data.set(key, value); }, getItem(key) { return data.get(key) ?? null; } };
  const draft = { ...newRioCreatorDraft(), recipient: 'Noah', theme: 'sunset' };
  assert.equal(data.size, 0);
  assert.equal(saveRioCreatorDraft(draft, storage), true);
  assert.deepEqual([...data.keys()], ['giftportals.rio.creator.v1']);
  assert.deepEqual(loadRioCreatorDraft(storage), draft);
  const denied = { setItem() { throw new Error('Quota denied'); }, getItem() { throw new Error('Access denied'); } };
  assert.equal(saveRioCreatorDraft(draft, denied), false);
  assert.equal(loadRioCreatorDraft(denied), null);
});

test('missing, stale and corrupt saved drafts never become a valid gift', () => {
  for (const raw of [null, '', '{', 'null', '[]', JSON.stringify({ ...newRioCreatorDraft(), version: 0 }),
    JSON.stringify({ ...newRioCreatorDraft(), story: 'x'.repeat(901) }), ' '.repeat(14_001)]) {
    assert.equal(loadRioCreatorDraft({ getItem() { return raw; } }), null);
  }
});
