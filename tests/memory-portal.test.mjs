import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual portal controller. DOM, native dialog, import latency and GPU
// viewers are fixtures; real-browser WebGL/animation behavior requires browser QA.
let source = ts.transpileModule(await readFile(new URL('../src/memory-portal.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
source = source.replace(/from '\.\/journey-state'/, `from '${import.meta.resolve('../src/journey-state.ts')}'`)
  .replace(/await import\('\.\/scene'\)/g, 'await globalThis.__portalFixture.importScene()')
  .replace(/await import\('\.\/environment'\)/g, 'await globalThis.__portalFixture.importWorld()');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
let fixtureSequence = 0;
const flush = async () => { await setImmediate(); await setImmediate(); };

class Classes {
  values = new Set();
  add(...names) { for (const name of names) this.values.add(name); }
  remove(...names) { for (const name of names) this.values.delete(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) { const enabled = force ?? !this.contains(name); if (enabled) this.add(name); else this.remove(name); return enabled; }
}

async function fixture(action, settings = {}) {
  const names = ['HTMLElement', 'document', 'matchMedia', 'location', 'setTimeout', 'clearTimeout', '__portalFixture', 'fetch', 'localStorage', 'sessionStorage'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const timers = new Map(), events = [], imports = { object: [], world: [] }, viewers = [];
  let timerSequence = 0, current = settings.current ?? true, exits = 0, explores = 0, reloads = 0, network = 0, storage = 0;
  let document;
  class ElementFixture extends EventTarget {
    constructor(tag = 'div', connected = false) {
      super(); this.tagName = tag.toUpperCase(); this.parentElement = null; this.children = []; this.attributes = new Map();
      this.classList = new Classes(); this.dataset = {}; this.hidden = false; this.open = false; this.disabled = false;
      this.connected = connected; this.focusCount = 0; this.text = ''; this.html = '';
    }
    get isConnected() { return this.connected || !!this.parentElement?.isConnected; }
    get className() { return [...this.classList.values].join(' '); }
    set className(value) { this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === 'class') this.className = value;
      if (name === 'hidden') this.hidden = true;
      if (name === 'disabled') this.disabled = true;
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'hidden') this.hidden = false; }
    append(child) { child.remove(); child.parentElement = this; this.children.push(child); }
    contains(child) { return child === this || this.children.some(candidate => candidate.contains(child)); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; this.connected = false; }
    matches(selector) {
      const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attribute) return this.attributes.has(attribute[1]) && (attribute[2] === undefined || this.attributes.get(attribute[1]) === attribute[2]);
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      return this.tagName.toLowerCase() === selector;
    }
    querySelectorAll(selector) {
      const found = [];
      for (const child of this.children) { if (child.matches(selector)) found.push(child); found.push(...child.querySelectorAll(selector)); }
      return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    set innerHTML(value) {
      for (const child of this.children) child.parentElement = null;
      this.children = []; this.html = String(value);
      const stack = [this];
      const voidTags = new Set(['br', 'img', 'input', 'hr', 'meta', 'link']);
      for (const token of this.html.matchAll(/<\/?[a-z][^>]*>/gi)) {
        const closing = token[0].match(/^<\/([a-z][\w-]*)/i);
        if (closing) { while (stack.length > 1) { const node = stack.pop(); if (node.tagName.toLowerCase() === closing[1].toLowerCase()) break; } continue; }
        const tag = token[0].match(/^<([a-z][\w-]*)/i)[1].toLowerCase(), child = new ElementFixture(tag);
        const attributes = token[0].slice(tag.length + 1).replace(/\/?\s*>$/, '');
        for (const attribute of attributes.matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) child.setAttribute(attribute[1], attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
        stack.at(-1).append(child);
        if (!voidTags.has(tag) && !token[0].endsWith('/>')) stack.push(child);
      }
    }
    get innerHTML() { return this.html; }
    set textContent(value) { for (const child of this.children) child.parentElement = null; this.children = []; this.text = String(value); }
    get textContent() { return this.text; }
    focus() { this.focusCount++; document.activeElement = this; }
    showModal() { if (settings.modalFailure) throw new Error('Synthetic dialog failure'); this.open = true; }
    close() { if (!this.open) return; this.open = false; this.dispatchEvent(new Event('close')); }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  }
  const opener = new ElementFixture('button', true), host = new ElementFixture('div', settings.connected ?? true);
  const dialogs = [];
  document = { activeElement: opener, createElement(tag) { const element = new ElementFixture(tag); if (tag === 'dialog') dialogs.push(element); return element; } };
  const media = { matches: settings.reduced ?? false };
  function mount(kind, canvas, callbacks) {
    const handle = { kind, canvas, callbacks, destroyed: false, destroyCount: 0,
      destroy() { this.destroyCount++; if (this.destroyed) return; this.destroyed = true; events.push(`destroy:${kind}`); },
      reset() { events.push(`reset:${kind}`); }, forward() {}, backward() {}, rotate() {} };
    viewers.push(handle); events.push(`mount:${kind}`);
    assert.equal(viewers.filter(viewer => !viewer.destroyed).length, 1, 'At most one renderer may be alive');
    if (settings.failConstructor === kind) callbacks.error('Synthetic GPU failure');
    return handle;
  }
  function importViewer(kind) {
    return new Promise((resolve, reject) => imports[kind].push({ resolve, reject }));
  }
  const modules = {
    object: { mountMemoryScene(canvas, options) { return mount('object', canvas, { ready: options.onReady, error: options.onError, progress: options.onProgress }); } },
    world: { mountGeneratedEnvironment(canvas, url, ready, error, progress) { return mount('world', canvas, { ready, error, progress }); } },
  };
  const store = new Proxy({}, { get() { storage++; throw new Error('Portal must not access browser storage'); } });
  const values = {
    HTMLElement: ElementFixture, document, matchMedia: () => media,
    location: { origin: 'http://127.0.0.1:4323', reload() { reloads++; } },
    setTimeout: (callback, duration) => { const id = ++timerSequence; timers.set(id, { callback, duration }); return id; },
    clearTimeout: id => timers.delete(id), __portalFixture: { importScene: () => importViewer('object'), importWorld: () => importViewer('world') },
    fetch: () => { network++; throw new Error('Portal lifecycle tests must not make network requests'); }, localStorage: store, sessionStorage: store,
  };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const memory = settings.memory ?? { id: 'synthetic-private-memory', ownerId: 'synthetic-owner', ownerName: 'Synthetic author', title: 'Synthetic authorized memory',
    story: 'This is the author’s actual synthetic story.', location: { placeId: 'world', label: 'Location not shared', latitude: 0, longitude: 0, source: 'manual', experiencedAt: '' },
    shareLocation: false, demo: false, createdAt: '2026-09-30T12:00:00Z', artisticNote: 'Artistic interpretation.', objectStatus: 'completed', environmentStatus: 'completed',
    media: [{ id: 'photo', kind: 'gift-photo', url: '/synthetic/photo.png', mimeType: 'image/png', bytes: 100, generated: false, expiresAt: 0 },
      { id: 'model', kind: 'model', url: '/synthetic/model.glb', mimeType: 'model/gltf-binary', bytes: 100, generated: true, provider: 'tripo', expiresAt: 0 },
      { id: 'world', kind: 'world', url: '/synthetic/world.spz', mimeType: 'application/octet-stream', bytes: 100, generated: true, provider: 'worldlabs', expiresAt: 0 },
      { id: 'pano', kind: 'world', url: '/synthetic/pano.png', mimeType: 'image/png', bytes: 100, generated: true, provider: 'worldlabs', expiresAt: 0 }] };
  let portal;
  try {
    const { mountMemoryPortal } = await import(`${moduleUrl}#fixture-${++fixtureSequence}`);
    portal = mountMemoryPortal(host, { memory, isCurrent: () => current,
      onExit: () => { exits++; events.push('exit'); }, onExplore: () => { explores++; events.push('explore'); } });
    const state = { host, opener, document, dialogs, imports, viewers, events, timers, media, memory, portal,
      dialog: () => dialogs[0], button: name => dialogs[0].querySelector(`[data-mp-${name}]`),
      invalidate: () => current = false, exitCount: () => exits, exploreCount: () => explores, reloadCount: () => reloads,
      resolve: async (kind, index = 0) => { assert.ok(imports[kind][index], `A pending ${kind} import is required`); imports[kind][index].resolve(modules[kind]); await flush(); },
      reject: async (kind, index = 0) => { assert.ok(imports[kind][index]); imports[kind][index].reject(new Error('Synthetic import failure')); await flush(); },
    };
    await action(state);
    assert.equal(network, 0); assert.equal(storage, 0);
  } finally {
    portal?.destroy();
    for (const name of names) { const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
}

test('exiting during a pending object import prevents late renderer creation and restores focus exactly once', async () => {
  await fixture(async state => {
    assert.equal(state.dialog().open, true); assert.equal(state.imports.object.length, 1);
    state.button('exit').click();
    assert.equal(state.exitCount(), 1); assert.equal(state.exploreCount(), 0);
    assert.equal(state.host.children.length, 0); assert.equal(state.document.activeElement, state.opener);
    await state.resolve('object'); assert.equal(state.viewers.length, 0);
    state.portal.destroy(); assert.equal(state.opener.focusCount, 1); assert.equal(state.exitCount(), 1);
  });
});

test('a route or authorization guard invalidated before import completion cannot mount or advance exploration', async () => {
  await fixture(async state => {
    state.invalidate(); await state.resolve('object');
    assert.equal(state.viewers.length, 0);
    state.button('step').click(); state.button('exit').click();
    assert.equal(state.imports.world.length, 0); assert.equal(state.exitCount(), 0); assert.equal(state.exploreCount(), 0);
    state.portal.destroy(); assert.equal(state.host.children.length, 0);
  });
});

test('stepping into the world destroys the object before a second renderer mounts, and only explicit Explore advances', async () => {
  await fixture(async state => {
    await state.resolve('object'); state.viewers[0].callbacks.ready();
    assert.equal(state.exploreCount(), 0);
    state.button('step').click();
    assert.deepEqual(state.events, ['mount:object', 'destroy:object']);
    assert.equal(state.imports.world.length, 1); assert.equal(state.dialog().querySelector('[data-mp-quote]').hidden, true);
    await state.resolve('world');
    assert.deepEqual(state.events, ['mount:object', 'destroy:object', 'mount:world']);
    state.viewers[1].callbacks.progress({ phase: 'loading', loadedBytes: 1024, totalBytes: null });
    state.viewers[1].callbacks.ready();
    assert.equal(state.dialog().querySelector('[data-mp-quote]').hidden, false); assert.equal(state.exploreCount(), 0);
    const explore = state.button('explore'); explore.click(); explore.click();
    assert.deepEqual(state.events, ['mount:object', 'destroy:object', 'mount:world', 'destroy:world', 'explore']);
    assert.equal(state.exploreCount(), 1); assert.equal(state.exitCount(), 0); assert.equal(state.host.children.length, 0);
  });
});

test('switching phase before object import resolves suppresses that obsolete import without destroying the world', async () => {
  await fixture(async state => {
    state.button('step').click(); await state.resolve('world');
    assert.deepEqual(state.events, ['mount:world']);
    await state.resolve('object');
    assert.deepEqual(state.events, ['mount:world']); assert.equal(state.viewers[0].destroyed, false); assert.equal(state.exploreCount(), 0);
  });
});

test('reduced motion skips the opening animation/timer and waiting never reveals or keeps fragments', async () => {
  await fixture(async state => {
    state.button('step').click();
    assert.equal(state.dialog().classList.contains('is-opening'), false); assert.equal(state.timers.size, 0);
    await state.resolve('world'); state.viewers[0].callbacks.ready(); await flush();
    assert.equal(state.exploreCount(), 0); assert.equal(state.exitCount(), 0);
    state.button('explore').click(); assert.equal(state.exploreCount(), 1);
  }, { reduced: true });
});

test('normal opening timer is bounded and cancelled on exit; stale callbacks cannot revive the encounter', async () => {
  await fixture(async state => {
    state.button('step').click();
    assert.equal(state.dialog().classList.contains('is-opening'), true);
    assert.equal(state.timers.size, 1); const timer = [...state.timers.values()][0]; assert.equal(timer.duration, 720);
    state.button('exit').click(); assert.equal(state.timers.size, 0);
    timer.callback(); await state.resolve('world'); await state.resolve('object');
    assert.equal(state.host.children.length, 0); assert.equal(state.viewers.length, 0); assert.equal(state.exploreCount(), 0);
  });
});

test('obsolete object readiness/progress/errors cannot overwrite or destroy the world, or act after disposal', async () => {
  await fixture(async state => {
    await state.resolve('object'); const old = state.viewers[0].callbacks;
    state.button('step').click(); await state.resolve('world'); const world = state.viewers[1];
    const status = state.dialog().querySelector('[data-mp-status]'); world.callbacks.progress({ phase: 'decoding', loadedBytes: 500, totalBytes: 500 });
    const before = status.textContent;
    old.ready(); old.progress({ phase: 'loading', loadedBytes: 9000, totalBytes: null }); old.error('Obsolete failure');
    assert.equal(status.textContent, before); assert.equal(world.destroyed, false);
    state.portal.destroy(); const events = [...state.events];
    world.callbacks.ready(); world.callbacks.progress({ phase: 'loading', loadedBytes: 800, totalBytes: null }); world.callbacks.error('Late failure');
    assert.deepEqual(state.events, events); assert.equal(state.exploreCount(), 0); assert.equal(state.exitCount(), 0);
  });
});

test('synchronous viewer failure destroys its returned handle and keeps fallback/explicit Explore available', async () => {
  await fixture(async state => {
    await state.resolve('object');
    assert.deepEqual(state.events, ['mount:object', 'destroy:object']); assert.equal(state.viewers[0].destroyCount, 1);
    assert.equal(state.dialog().querySelector('[data-mp-controls]').hidden, true);
    state.button('step').click(); await state.resolve('world'); state.viewers[1].callbacks.ready();
    assert.equal(state.exploreCount(), 0); state.button('explore').click(); assert.equal(state.exploreCount(), 1);
    assert.equal(state.viewers[0].destroyCount, 1); assert.equal(state.viewers[1].destroyCount, 1);
  }, { failConstructor: 'object' });
});

test('import rejection offers honest reload recovery without generation, progress or implicit navigation', async () => {
  await fixture(async state => {
    await state.reject('object');
    assert.equal(state.viewers.length, 0);
    assert.equal(state.dialog().querySelector('[data-mp-status]').classList.contains('is-fallback'), true);
    assert.equal(state.dialog().querySelector('[data-mp-status]').hidden, false);
    assert.ok(state.button('retry'), 'Failed imports must offer an explicit recovery action');
    state.button('retry').click(); assert.equal(state.reloadCount(), 1);
    assert.equal(state.exploreCount(), 0); assert.equal(state.exitCount(), 0);
    state.button('exit').click(); assert.equal(state.exitCount(), 1);
  });
});

test('native Escape and external dialog close dispose the renderer once and never mark exploration', async () => {
  for (const kind of ['escape', 'close']) await fixture(async state => {
    await state.resolve('object');
    if (kind === 'escape') { const event = new Event('cancel', { cancelable: true }); state.dialog().dispatchEvent(event); assert.equal(event.defaultPrevented, true); }
    else state.dialog().close();
    assert.equal(state.exitCount(), 1); assert.equal(state.exploreCount(), 0); assert.equal(state.viewers[0].destroyCount, 1);
    state.portal.destroy(); assert.equal(state.viewers[0].destroyCount, 1); assert.equal(state.opener.focusCount, 1);
  });
});

test('retry replaces its obsolete focused control with the connected Step or world heading without advancing exploration', async () => {
  for (const phase of ['object', 'world']) await fixture(async state => {
    await state.resolve('object'); state.viewers[0].callbacks.ready();
    if (phase === 'world') { state.button('step').click(); await state.resolve('world'); state.viewers.at(-1).callbacks.ready(); }
    const failed = state.viewers.at(-1); failed.callbacks.error('Synthetic renderer failure');
    const retry = state.button('retry'); retry.focus(); assert.equal(state.document.activeElement, retry);
    retry.click();
    const nextFocus = state.button(phase === 'object' ? 'step' : 'title');
    assert.equal(retry.isConnected, false); assert.equal(nextFocus.isConnected, true);
    assert.equal(state.document.activeElement, nextFocus, 'Removing Retry must not strand keyboard focus on a detached node');
    assert.equal(state.exitCount(), 0); assert.equal(state.exploreCount(), 0); assert.equal(failed.destroyCount, 1);
    assert.equal(state.imports[phase].length, 2);
    await state.resolve(phase, 1); assert.equal(state.viewers.at(-1).destroyed, false);
  });
});

test('world look/story toggle never advances exploration, keeps explicit Explore available, and clears on failure/retry', async () => {
  await fixture(async state => {
    await state.resolve('object'); state.viewers[0].callbacks.ready();
    assert.equal(state.button('look'), null, 'Object mode has no world-only encounter control');
    state.button('step').click(); await state.resolve('world');
    const world = state.viewers.at(-1); world.callbacks.ready();
    const look = state.button('look'); assert.equal(look.getAttribute('aria-pressed'), 'false');
    look.click();
    assert.equal(state.dialog().classList.contains('is-looking'), true); assert.equal(look.getAttribute('aria-pressed'), 'true');
    assert.equal(state.button('quick-explore').isConnected, true); assert.equal(state.button('exit').isConnected, true);
    assert.equal(state.exploreCount(), 0); assert.equal(state.exitCount(), 0);
    look.click(); assert.equal(state.dialog().classList.contains('is-looking'), false); assert.equal(look.getAttribute('aria-pressed'), 'false');
    look.click(); world.callbacks.error('Synthetic world failure');
    assert.equal(state.dialog().classList.contains('is-looking'), false);
    assert.equal(state.dialog().querySelector('[data-mp-quote]').hidden, false);
    assert.equal(state.dialog().querySelector('[data-mp-controls]').hidden, true); assert.equal(state.exploreCount(), 0);
    state.button('retry').click(); assert.equal(state.dialog().classList.contains('is-looking'), false);
    look.click(); assert.equal(state.dialog().classList.contains('is-looking'), false, 'Detached controls must lose their listeners');
    await state.resolve('world', 1); state.viewers.at(-1).callbacks.ready();
    state.button('look').click(); assert.equal(state.dialog().classList.contains('is-looking'), true); assert.equal(state.exploreCount(), 0);
    state.button('quick-explore').click();
    assert.equal(state.exploreCount(), 1); assert.equal(state.exitCount(), 0); assert.equal(state.host.children.length, 0);
    assert.equal(state.viewers.every(viewer => viewer.destroyed && viewer.destroyCount === 1), true);
  });
});
