import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
// Load the actual static helper modules without a browser CSS loader. This
// fixture exercises text validation; it does not mount camera, GPS or GPU UI.
const compiledModules = new Map();
async function moduleUrl(path) {
  if (compiledModules.has(path.href)) return compiledModules.get(path.href);
  let source = compile(await readFile(path, 'utf8')).replace(/import\s*['"][^'"]+\.css['"];?\s*/g, '');
  for (const match of [...source.matchAll(/from\s*(['"])(\.{1,2}\/[^'"]+)\1/g)]) {
    const specifier = match[2].replace(/\.js$/, '.ts');
    const dependency = new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, path), url = await moduleUrl(dependency);
    source = source.replaceAll(`${match[1]}${match[2]}${match[1]}`, JSON.stringify(url));
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`; compiledModules.set(path.href, url); return url;
}
const { validateInstantText, instantReadyGiftHref } = await import(await moduleUrl(new URL('../src/instant-creator.ts', import.meta.url)));

test('short place names get actionable feedback before an image is prepared or sent', () => {
  for (const prompt of ['', '   ', 'Rio', 'Paris', '  seven77  ']) assert.match(validateInstantText('A gift', prompt).worldPrompt, /at least 8 characters/);
  assert.equal(validateInstantText('A gift', '  eight888  ').worldPrompt, '');
  assert.deepEqual(validateInstantText('  A gift  ', 'A quiet garden at dusk'), { title: '', worldPrompt: '' });
});

test('empty or oversized titles remain invalid even when their optional panel is closed', () => {
  assert.match(validateInstantText('   ', 'A quiet garden at dusk').title, /name/);
  assert.equal(validateInstantText('x'.repeat(120), 'A quiet garden at dusk').title, '');
  assert.match(validateInstantText('x'.repeat(121), 'A quiet garden at dusk').title, /120/);
  assert.equal(validateInstantText('A gift', 'x'.repeat(1600)).worldPrompt, '');
  assert.match(validateInstantText('A gift', 'x'.repeat(1601)).worldPrompt, /1,600/);
});

test('ready examples only open their own public route after readiness is explicitly supplied', () => {
  for (const id of ['rio', 'paris', 'antikythera']) {
    const readyGiftUrl = `#/generated/${id}-example`;
    assert.equal(instantReadyGiftHref({ id, readyGiftUrl }), readyGiftUrl);
    assert.equal(instantReadyGiftHref({ id }), undefined);
  }
  assert.equal(instantReadyGiftHref(null), undefined);
  assert.equal(instantReadyGiftHref({ id: 'kyoto', readyGiftUrl: '#/generated/kyoto-example' }), undefined);
  assert.equal(instantReadyGiftHref({ id: 'paris', readyGiftUrl: '#/generated/rio-example' }), undefined);
});

test('ready gift links reject external URLs, scripts and protected job credentials', () => {
  for (const readyGiftUrl of ['javascript:alert(1)', 'https://example.com/gift', '//example.com/gift', '#/generated/paris-example?key=private-token', '#/generated/private-job?key=private-token', ' #/generated/paris-example', '#/generated/paris-example/../private-job', '#/generated/paris-example%3fkey=token']) {
    assert.equal(instantReadyGiftHref({ id: 'paris', readyGiftUrl }), undefined);
  }
  assert.equal(instantReadyGiftHref({ id: 'toString', readyGiftUrl: '#/generated/paris-example' }), undefined);
});
