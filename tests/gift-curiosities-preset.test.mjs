import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const factsUrl = url(compile(await readFile(new URL('../shared/gift-curiosities.ts', import.meta.url), 'utf8')));
const source = compile(await readFile(new URL('../src/gift-curiosities.ts', import.meta.url), 'utf8')).replace(/import '\.\/gift-curiosities.css';\s*/, '').replace(/from '\.\.\/shared\/gift-curiosities'/, `from '${factsUrl}'`);
const { mountGiftCuriosities } = await import(url(source));
async function fixture(action) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document'); let inspected = 0, decisions = [], resolveImage, stories = [], current = true;
  class Element extends EventTarget {
    constructor() { super(); this.nodes = new Map(); this.children = []; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.isConnected = true; this.classList = { add() {} }; }
    addEventListener(type, listener, options) { if (options?.signal) setMaxListeners(0, options.signal); super.addEventListener(type, listener, options); }
    set innerHTML(value) { this.html = value; this.nodes.clear(); for (const match of value.matchAll(/data-curio-([a-z-]+)/g)) this.nodes.set(`[data-curio-${match[1]}]`, new Element()); if (value.includes('<input')) { const input = new Element(); input.checked = /\schecked[\s/>]/.test(value); this.nodes.set('input', input); } }
    get innerHTML() { return this.html || ''; }
    querySelector(selector) { return this.nodes.get(selector) || null; }
    replaceChildren() { this.children = []; }
    append(child) { this.children.push(child); }
    click() { this.dispatchEvent(new Event('click')); }
  }
  const host = new Element(); Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() { return new Element(); } } });
  const handle = mountGiftCuriosities(host, { isCurrent: () => current, getRegion: () => undefined, getImage: () => new Promise(resolve => resolveImage = resolve), inspect: async () => { inspected++; return { decision: 'allow', results: [{ id: 'original', objectHint: 'clock' }] }; }, onDecision: decision => decisions.push(decision), onChange() {}, onStory: story => stories.push(story) });
  try { await action({ host, handle, inspected: () => inspected, decisions, stories, resolveImage: value => resolveImage(value), invalidate: () => current = false }); }
  finally { handle.destroy(); if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document; }
}
test('catalog facts show as artistic inspiration without claiming photo identification or silently including facts', async () => {
  await fixture(async state => {
    state.handle.preset({ objectHint: 'antikythera', factIds: ['antikythera-calendar'], story: 'An imaginative observatory.' });
    assert.equal(state.inspected(), 0); assert.deepEqual(state.decisions, [undefined]); assert.deepEqual(state.handle.selectedIds(), []);
    assert.match(state.host.querySelector('[data-curio-status]').textContent, /Artistic reference/);
    const card = state.host.querySelector('[data-curio-facts]').children[0]; assert.match(card.innerHTML, /National Archaeological Museum/); assert.match(card.innerHTML, /authenticated reconstruction/);
    const input = card.querySelector('input'); assert.equal(input.checked, false); input.checked = true; input.dispatchEvent(new Event('change')); assert.deepEqual(state.handle.selectedIds(), ['antikythera-calendar']);
    state.host.querySelector('[data-curio-use-seed]').click(); assert.deepEqual(state.stories, ['An imaginative observatory.']);
  });
});
test('choosing catalog inspiration cancels an older local inspection and preserves its new facts', async () => {
  await fixture(async state => {
    state.host.querySelector('[data-curio-discover]').click();
    state.handle.preset({ regionId: 'paris', factIds: ['paris-seine'], story: 'A fictional evening by the Seine.' });
    state.resolveImage('data:image/jpeg;base64,old'); await setImmediate(); await setImmediate();
    assert.equal(state.inspected(), 0); const card = state.host.querySelector('[data-curio-facts]').children[0]; assert.match(card.innerHTML, /UNESCO/); assert.match(state.host.querySelector('[data-curio-status]').textContent, /Artistic reference/);
    state.handle.reset(); assert.deepEqual(state.handle.selectedIds(), []); assert.equal(state.host.querySelector('[data-curio-result]').hidden, true);
  });
});
