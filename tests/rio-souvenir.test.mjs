import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';

// Execute the controller with fixture DOM and delayed viewer imports. These
// regressions do not establish real image/WebGL quality; browser QA does that.
const compiled = ts.transpileModule(await readFile(new URL('../src/rio-souvenir.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace("import('./rio-panorama')", 'globalThis.__rioFixture.importPanorama()');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
let sequence = 0;
const flush = async () => { await setImmediate(); await setImmediate(); };

async function fixture(action, settings = {}) {
  const names = ['document', '__rioFixture', 'fetch', 'localStorage', 'sessionStorage'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const pending = [], viewers = [], events = [];
  let current = true, network = 0, storage = 0, home = 0;
  let document;
  class Node extends EventTarget {
    constructor(tag = 'div', connected = false) {
      super(); this.tagName = tag; this.parent = null; this.children = []; this.connected = connected;
      this.attributes = new Map(); this.hidden = false; this.disabled = false; this.open = false;
      this.complete = false; this.naturalWidth = 0; this.focusCount = 0;
      const classes = new Set();
      this.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name),
        toggle(name, value) { const on = value ?? !classes.has(name); if (on) classes.add(name); else classes.delete(name); return on; } };
      const styles = new Map();
      this.style = { getPropertyValue: name => styles.get(name)?.value || '', getPropertyPriority: name => styles.get(name)?.priority || '',
        setProperty: (name, value, priority = '') => styles.set(name, { value, priority }), removeProperty: name => styles.delete(name) };
    }
    get isConnected() { return this.connected || !!this.parent?.isConnected; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'hidden') this.hidden = true; if (name === 'disabled') this.disabled = true; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(name, listener, options) { if (options?.signal) setMaxListeners(0, options.signal); super.addEventListener(name, listener, options); }
    append(node) { node.remove(); node.parent = this; this.children.push(node); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; this.connected = false; }
    replaceChildren() { for (const child of this.children) child.parent = null; this.children = []; }
    matches(selector) { return selector.startsWith('[') ? this.attributes.has(selector.slice(1, -1)) : this.tagName === selector; }
    querySelectorAll(selector) { const names = selector.split(','); return this.children.flatMap(child => [...(names.some(name => child.matches(name)) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    set innerHTML(html) {
      this.replaceChildren(); const stack = [this];
      for (const token of html.matchAll(/<\/?[a-z][^>]*>/gi)) {
        const end = token[0].match(/^<\/([a-z][\w-]*)/i);
        if (end) { while (stack.length > 1) { const item = stack.pop(); if (item.tagName === end[1]) break; } continue; }
        const tag = token[0].match(/^<([a-z][\w-]*)/i)[1], node = new Node(tag);
        for (const item of token[0].slice(tag.length + 1).replace(/\/?\s*>$/, '').matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) node.setAttribute(item[1], item[2] ?? item[3] ?? item[4] ?? '');
        stack.at(-1).append(node); if (!['img', 'br', 'input', 'hr'].includes(tag)) stack.push(node);
      }
    }
    focus() { this.focusCount++; document.activeElement = this; }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
    showModal() { if (settings.modalFailure) throw new Error('Synthetic unavailable dialog'); this.open = true; }
    close() { if (this.open) { this.open = false; this.dispatchEvent(new Event('close')); } }
  }
  const host = new Node('main', true), html = new Node('html', true), body = new Node('body', true);
  html.style.setProperty('overflow', 'auto', 'important'); body.style.setProperty('overflow', 'clip');
  document = { documentElement: html, body, activeElement: null, createElement: tag => new Node(tag) };
  const modules = { mountRioPanorama(canvas, url, callbacks) {
    const viewer = { canvas, url, callbacks, destroyed: false, destroyCount: 0,
      destroy() { if (!this.destroyed) { this.destroyed = true; this.destroyCount++; events.push('destroy'); } },
      reset() { events.push('reset'); }, look(x, y) { events.push(['look', x, y]); } };
    viewers.push(viewer); events.push('mount');
    assert.equal(viewers.filter(viewer => !viewer.destroyed).length, 1);
    if (settings.synchronousFailure) callbacks.onError();
    return viewer;
  } };
  const forbiddenStore = new Proxy({}, { get() { storage++; throw new Error('No browser storage allowed'); } });
  const values = { document, __rioFixture: { importPanorama: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
    fetch() { network++; throw new Error('No network from controller'); }, localStorage: forbiddenStore, sessionStorage: forbiddenStore };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  let controller;
  try {
    const { mountRioSouvenir } = await import(`${moduleUrl}#${++sequence}`);
    controller = mountRioSouvenir(host, { ...settings.options, isCurrent: () => current, onHome: () => home++ });
    await action({ host, document, pending, viewers, events, controller,
      dialog: () => host.querySelector('dialog'), button: name => host.querySelector(`[data-rio-${name}]`),
      invalidate: () => current = false, homeCount: () => home,
      resolve: async (index = 0) => { pending[index].resolve(modules); await flush(); },
      reject: async (index = 0) => { pending[index].reject(new Error('Synthetic failed import')); await flush(); },
    });
    assert.equal(network, 0); assert.equal(storage, 0);
  } finally {
    controller?.destroy();
    for (const name of names) { const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
}

test('the gift stays image-only until Enter; Back during import prevents a late renderer and restores scrolling and focus', async () => {
  await fixture(async state => {
    assert.equal(state.pending.length, 0); const enter = state.button('enter'); enter.click();
    assert.equal(state.pending.length, 1); assert.equal(state.dialog().open, true);
    assert.equal(state.document.documentElement.style.getPropertyValue('overflow'), 'hidden');
    state.button('close').click(); await state.resolve();
    assert.equal(state.viewers.length, 0); assert.equal(state.dialog(), null);
    assert.equal(state.document.activeElement, enter); assert.equal(enter.focusCount, 1);
    assert.equal(state.document.documentElement.style.getPropertyValue('overflow'), 'auto');
    assert.equal(state.document.documentElement.style.getPropertyPriority('overflow'), 'important');
    assert.equal(state.document.body.style.getPropertyValue('overflow'), 'clip');
  });
});

test('a ready panorama supports explicit message visibility, direction/reset controls and Escape cleanup', async () => {
  await fixture(async state => {
    state.button('enter').click(); await state.resolve();
    state.viewers[0].callbacks.onReady(); const message = state.host.querySelector('[data-rio-message]');
    assert.equal(message.hidden, false); assert.equal(state.button('toggle').getAttribute('aria-expanded'), 'true');
    state.button('toggle').click(); assert.equal(message.hidden, true);
    state.button('toggle').click(); assert.equal(message.hidden, false);
    state.button('left').click(); state.button('up').click(); state.button('reset').click();
    assert.deepEqual(state.events, ['mount', ['look', 0.12, 0], ['look', 0, 0.08], 'reset']);
    state.dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    assert.equal(state.dialog(), null); assert.equal(state.viewers[0].destroyCount, 1);
    assert.equal(state.document.body.style.getPropertyValue('overflow'), 'clip');
  });
});

test('viewer failure keeps an honest image/message fallback and Retry cannot reuse stale callbacks', async () => {
  await fixture(async state => {
    state.button('enter').click(); await state.resolve(); const old = state.viewers[0];
    old.callbacks.onError(); assert.equal(old.destroyed, true);
    assert.equal(state.button('retry').hidden, false); assert.equal(state.host.querySelector('[data-rio-message]').hidden, false);
    assert.equal(state.button('reset').disabled, true); state.button('retry').click();
    await state.resolve(1); const next = state.viewers[1];
    old.callbacks.onReady(); old.callbacks.onError();
    assert.equal(next.destroyed, false); assert.equal(state.dialog().classList.contains('is-ready'), false);
    next.callbacks.onReady(); assert.equal(state.dialog().classList.contains('is-ready'), true);
    assert.equal(state.button('reset').disabled, false);
    state.button('close').click(); assert.equal(next.destroyCount, 1);
  });
});

test('synchronous construction failure disposes its returned handle while preserving the gift and message', async () => {
  await fixture(async state => {
    state.button('enter').click(); await state.resolve();
    assert.equal(state.viewers[0].destroyCount, 1); assert.equal(state.button('retry').hidden, false);
    assert.equal(state.host.querySelector('[data-rio-message]').hidden, false);
    state.button('close').click(); assert.ok(state.button('enter'));
  }, { synchronousFailure: true });
});

test('route destruction cancels pending imports, unlocks scroll and prevents disposed callbacks from reviving a dialog', async () => {
  await fixture(async state => {
    state.button('enter').click(); state.controller.destroy(); await state.resolve();
    assert.equal(state.host.children.length, 0); assert.equal(state.viewers.length, 0);
    assert.equal(state.document.documentElement.style.getPropertyValue('overflow'), 'auto');
    state.controller.destroy();
  });
});

test('import rejection permits explicit Retry with no writes; an invalidated route cannot mount a panorama', async () => {
  await fixture(async state => {
    state.button('enter').click(); await state.reject();
    assert.equal(state.button('retry').hidden, false); state.button('retry').click();
    state.invalidate(); await state.resolve(1); assert.equal(state.viewers.length, 0);
  });
});

test('personalized drafts remain plain text; external open and Keep have the same disposal boundaries as the gift controls', async () => {
  let keeps = 0, closes = 0, closedFocus;
  const attack = '<img data-rio-attacker src="x" onerror="globalThis.__injected = true">';
  const content = { title: attack, sender: '<script data-rio-attacker>bad()</script>', recipient: 'Noah "<b>"', dedication: attack, story: '<iframe data-rio-attacker src="javascript:bad()"></iframe>', theme: 'ocean' };
  await fixture(async state => {
    assert.equal(state.host.querySelector('[data-rio-attacker]'), null);
    assert.equal(state.host.querySelector('[data-rio-gift-subtitle]').textContent, content.title);
    assert.equal(state.host.querySelector('[data-rio-sender]').textContent, `A GIFT FROM ${content.sender}`);
    assert.equal(state.host.querySelector('[data-rio-gift-dedication]').textContent, `“${content.dedication}”`);
    assert.equal(state.host.querySelector('[data-rio-recipient]').textContent, `For ${content.recipient}`);
    assert.equal(state.host.getAttribute('data-rio-theme'), 'ocean');
    assert.equal(state.pending.length, 0); state.controller.open(); state.controller.open();
    assert.equal(state.pending.length, 1); await state.resolve(); state.viewers[0].callbacks.onReady();
    assert.equal(state.dialog().querySelector('[data-rio-attacker]'), null);
    assert.equal(state.dialog().getAttribute('data-rio-theme'), 'ocean');
    assert.equal(state.host.querySelector('[data-rio-world-title]').textContent, content.title);
    assert.equal(state.host.querySelector('[data-rio-world-story]').textContent, `“${content.story}”`);
    assert.equal(state.host.querySelector('[data-rio-world-signature]').textContent, `With love, ${content.sender}`);
    assert.equal(state.host.querySelector('[data-rio-world-caption]').textContent, 'Personalized local preview · artistic recreation');
    const keep = state.button('keep'); assert.equal(keep.hidden, false); assert.equal(keeps, 0);
    keep.click(); assert.equal(keeps, 1);
    state.button('close').click(); assert.equal(closes, 1); assert.equal(closedFocus, state.button('enter'));
    keep.click(); assert.equal(keeps, 1);
    state.controller.open(); state.controller.destroy(); await state.resolve(1); state.controller.open();
    assert.equal(keeps, 1); assert.equal(closes, 1); assert.equal(state.pending.length, 2); assert.equal(state.dialog(), null);
    assert.equal(state.viewers[0].destroyCount, 1);
    assert.equal(state.document.documentElement.style.getPropertyValue('overflow'), 'auto');
  }, { options: { content, onKeep: () => keeps++, onClose: () => { closes++; closedFocus = globalThis.document.activeElement; } } });
});
