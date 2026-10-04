import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
let require = createRequire(import.meta.url); try { require.resolve('typescript'); } catch { require = createRequire((process.env.GIFTPORTALS_TEST_APP_ROOT || 'C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals') + '/package.json'); }
const ts = require('typescript'), appRoot = process.env.GIFTPORTALS_TEST_APP_ROOT || 'C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals';
const readSource = name => readFile(existsSync(new URL('../' + name, import.meta.url)) ? new URL('../' + name, import.meta.url) : resolve(appRoot, name), 'utf8');

// Execute the real controller; the DOM, import latency and GPU renderers are
// fixtures. Real GLB/SPZ rendering and mobile appearance require browser QA.
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const runtime = asModule(transpile(await readSource('src/viewer-runtime.ts')));
const markerLayout = asModule(transpile(await readSource('src/gift-marker-layout.ts')));
const curiosities = asModule(transpile(await readSource('shared/gift-curiosities.ts')));
const giftIcon = asModule(transpile(await readSource('src/gift-icon.ts')));
const collectionIcon = asModule(transpile(await readSource('src/collection-icon.ts')));
const storyReader = asModule(transpile(await readSource('src/story-reader.ts')).replace(/import '\.\/story-reader.css';\s*/, ''));
const { CURIOSITY_FACTS } = await import(curiosities);
const controller = transpile(await readSource('src/generated-gift.ts'))
  .replace(/import '\.\/generated-gift.css';\s*/, '')
  .replace(/from '\.\/viewer-runtime'/, `from '${runtime}'`)
  .replace(/from '\.\/gift-marker-layout'/, `from '${markerLayout}'`)
  .replace(/from '\.\/gift-icon'/, `from '${giftIcon}'`)
  .replace(/from '\.\/collection-icon'/, `from '${collectionIcon}'`)
  .replace(/from '\.\/story-reader'/, `from '${storyReader}'`)
  .replace(/from '\.\.\/shared\/gift-curiosities'/, `from '${curiosities}'`)
  .replace(/await import\('\.\/scene'\)/g, 'await globalThis.__generatedGiftFixture.importObject()')
  .replace(/await import\('\.\/generated-world'\)/g, 'await globalThis.__generatedGiftFixture.importWorld()')
  .replace(/import\('\.\/keepsake-print'\)/g, 'globalThis.__generatedGiftFixture.importPrint()')
  .replace(/import\('\.\/keepsake-xr'\)/g, 'globalThis.__generatedGiftFixture.importXR()');
const moduleUrl = asModule(controller);
const flush = async () => { await setImmediate(); await setImmediate(); };
let sequence = 0;

class Classes {
  values = new Set();
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) { const enabled = force ?? !this.contains(name); if (enabled) this.add(name); else this.remove(name); return enabled; }
}
class Style {
  values = new Map();
  setProperty(name, value, priority = '') { this.values.set(name, { value, priority }); }
  getPropertyValue(name) { return this.values.get(name)?.value ?? ''; }
  getPropertyPriority(name) { return this.values.get(name)?.priority ?? ''; }
  removeProperty(name) { this.values.delete(name); }
}

async function fixture(action, settings = {}) {
  const globalNames = ['HTMLElement', 'document', 'location', '__generatedGiftFixture', 'fetch', 'localStorage', 'sessionStorage'];
  const previous = new Map(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const imports = { object: [], world: [], print: [], xr: [] }, viewers = [], panels = [], xrPanels = [], events = [], actions = [], dialogs = [];
  let current = true, exits = 0, shares = 0, network = 0, storage = 0, document;
  class Element extends EventTarget {
    constructor(tag = 'div', connected = false) {
      super(); this.tagName = tag.toUpperCase(); this.connected = connected; this.children = []; this.parentElement = null; this.attributes = new Map(); this.classList = new Classes(); this.style = new Style(); this.open = false; this.hidden = false; this.disabled = false; this.focusCount = 0; this.html = ''; this.text = ''; this.scrollTop = 0;
      this.dataset = new Proxy({}, {
        get: (_target, key) => this.getAttribute('data-' + String(key).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())) ?? undefined,
        set: (_target, key, value) => { this.setAttribute('data-' + String(key).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value); return true; },
      });
    }
    addEventListener(type, callback, options) { if (options?.signal) setMaxListeners(0, options.signal); super.addEventListener(type, callback, options); }
    get isConnected() { return this.connected || !!this.parentElement?.isConnected; }
    set className(value) { this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classList.values].join(' '); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'class') this.className = value; if (name === 'hidden') this.hidden = true; if (name === 'disabled') this.disabled = true; }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'hidden') this.hidden = false; if (name === 'disabled') this.disabled = false; }
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
    replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.text = ''; this.append(...children); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; this.connected = false; }
    contains(child) { return child === this || this.children.some(candidate => candidate.contains(child)); }
    matches(selector) {
      const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attribute) return this.attributes.has(attribute[1]) && (attribute[2] === undefined || this.attributes.get(attribute[1]) === attribute[2]);
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      return this.tagName.toLowerCase() === selector;
    }
    querySelectorAll(selector) {
      const selectors = selector.split(',').map(value => value.trim());
      const found = [];
      for (const child of this.children) {
        for (const candidate of selectors) {
          const parts = candidate.split(/\s+/), last = parts.pop();
          if (!child.matches(last)) continue;
          let ancestor = child.parentElement, matched = true;
          for (const part of parts.reverse()) { while (ancestor && !ancestor.matches(part)) ancestor = ancestor.parentElement; if (!ancestor) { matched = false; break; } ancestor = ancestor.parentElement; }
          if (matched) { found.push(child); break; }
        }
        found.push(...child.querySelectorAll(selector));
      }
      return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    set innerHTML(value) {
      for (const child of this.children) child.parentElement = null;
      this.children = []; this.html = String(value);
      const stack = [this], voidTags = new Set(['br', 'img', 'input', 'hr', 'meta', 'link']);
      for (const token of this.html.matchAll(/<\/?[a-z][^>]*>/gi)) {
        const closing = token[0].match(/^<\/([a-z][\w-]*)/i);
        if (closing) { while (stack.length > 1) { const child = stack.pop(); if (child.tagName.toLowerCase() === closing[1].toLowerCase()) break; } continue; }
        const tag = token[0].match(/^<([a-z][\w-]*)/i)[1].toLowerCase(), child = new Element(tag);
        for (const attribute of token[0].slice(tag.length + 1).replace(/\/?\s*>$/, '').matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) child.setAttribute(attribute[1], attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
        stack.at(-1).append(child);
        if (!voidTags.has(tag) && !token[0].endsWith('/>')) stack.push(child);
      }
    }
    get innerHTML() { return this.html; }
    set textContent(value) { for (const child of this.children) child.parentElement = null; this.children = []; this.text = String(value); }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set target(value) { this.setAttribute('target', value); }
    get target() { return this.getAttribute('target') || ''; }
    set rel(value) { this.setAttribute('rel', value); }
    get rel() { return this.getAttribute('rel') || ''; }
    set referrerPolicy(value) { this.setAttribute('referrerpolicy', value); }
    get referrerPolicy() { return this.getAttribute('referrerpolicy') || ''; }
    focus() { this.focusCount++; document.activeElement = this; }
    showModal() { if (settings.modalFailure) throw new Error('Synthetic modal failure'); this.open = true; }
    close() { if (this.open) { this.open = false; this.dispatchEvent(new Event('close')); } }
    click() { this.dispatchEvent(new Event('click')); }
  }
  const opener = new Element('button', true), host = new Element('div', settings.connected ?? true);
  const html = new Element('html', true), body = new Element('body', true);
  html.style.setProperty('overflow', 'auto', 'important'); body.style.setProperty('overflow', 'clip');
  document = { activeElement: opener, documentElement: html, body,
    createElement(tag) { const element = new Element(tag); if (tag === 'dialog') dialogs.push(element); return element; },
    createElementNS(_namespace, tag) { return new Element(tag); },
    createTextNode(text) { const node = new Element('#text'); node.textContent = text; return node; },
  };
  function mount(kind, canvas, source, callbacks) {
    let tourPhase = 'idle', tourIndex = 0, decoded = false;
    const ready = callbacks.onReady;
    callbacks = { ...callbacks, onReady: (...args) => { decoded = true; ready(...args); } };
    const tourState = reason => callbacks.onTourChange?.({ phase: tourPhase, stage: 'reading', index: tourIndex, count: callbacks.points?.length || 0, pointId: tourPhase === 'idle' ? undefined : callbacks.points?.[tourIndex]?.id, reducedMotion: Boolean(settings.reducedMotion), reason });
    const handle = { kind, canvas, source, callbacks, destroyed: false, destroyCount: 0,
      destroy() { this.destroyCount++; if (this.destroyed) return; this.destroyed = true; events.push(`destroy:${kind}`); },
      reset() { actions.push(['reset', kind]); }, rotate(delta) { actions.push(['rotate', kind, delta]); }, zoom(delta) { actions.push(['zoom', kind, delta]); },
      look(horizontal, vertical) { actions.push(['look', kind, horizontal, vertical]); }, forward() { actions.push(['forward', kind]); }, backward() { actions.push(['backward', kind]); },
      walkingAvailable: false, setWalking(enabled) { actions.push(['walking', kind, enabled]); return enabled && this.walkingAvailable; }, move(horizontal, forward) { actions.push(['move', kind, horizontal, forward]); },
      startTour() { actions.push(['tour-start', kind]); tourIndex = 0; tourPhase = settings.reducedMotion ? 'paused' : 'playing'; tourState(settings.reducedMotion ? 'motion' : undefined); return true; },
      pauseTour(reason = 'user') { if (tourPhase !== 'playing') return; actions.push(['tour-pause', kind, reason]); tourPhase = 'paused'; tourState(reason); },
      resumeTour() { if (settings.reducedMotion || tourPhase !== 'paused') return false; actions.push(['tour-resume', kind]); tourPhase = 'playing'; tourState(); return true; },
      stopTour() { actions.push(['tour-stop', kind]); tourPhase = 'idle'; tourState(); },
      nextTour() { actions.push(['tour-next', kind]); if (tourIndex + 1 < callbacks.points.length) tourIndex++; else tourPhase = 'completed'; tourState(); },
      focusPoint(id) {
        if (!decoded || this.destroyed || settings.focusUnsupported || !callbacks.points.some(point => point.id === id)) return false;
        actions.push(['focus', kind, id]);
        if (tourPhase !== 'idle') { tourPhase = 'idle'; tourState(); }
        if (!settings.reducedMotion) callbacks.onViewpointChange?.({ pointId: id, phase: 'travelling' });
        if (settings.reducedMotion || !settings.deferredFocus) callbacks.onViewpointChange?.({ pointId: id, phase: 'arrived' });
        return true;
      },
    };
    viewers.push(handle); events.push(`mount:${kind}`);
    assert.equal(viewers.filter(viewer => !viewer.destroyed).length + xrPanels.filter(panel => panel.gpu).length, 1, 'Only one GPU renderer may be alive');
    if (settings.constructorFailure === kind) callbacks.onError('Synthetic initialization failure');
    return handle;
  }
  const modules = {
    object: { mountMemoryScene: (canvas, options) => mount('object', canvas, options.modelUrl, options) },
    world: { mountGeneratedWorld: (canvas, source, options) => mount('world', canvas, source, options) },
    print: { mountKeepsakePrint: (parent, options) => {
      const element = new Element('section'); element.setAttribute('data-fixture-print', ''); parent.append(element);
      const panel = { parent, element, options, destroyed: false, destroyCount: 0,
        destroy() { this.destroyCount++; if (this.destroyed) return; this.destroyed = true; element.remove(); },
        close() { this.destroy(); options.onClose(); },
      };
      panels.push(panel); assert.equal(panels.filter(candidate => !candidate.destroyed).length, 1, 'Only one print panel may be alive');
      return panel;
    } },
    xr: { mountKeepsakeXR: (parent, options) => {
      const element = new Element('section'); element.setAttribute('data-fixture-xr', ''); parent.append(element);
      const panel = { parent, element, options, destroyed: false, destroyCount: 0, gpu: false, accepted: false,
        accept() { if (settings.xrUnsupported || this.destroyed || !options.isCurrent()) return; this.accepted = true; options.onSessionStarting(); assert.equal(options.isCurrent(), true, 'Accepting XR must not retire its independent epoch'); this.gpu = true; events.push('mount:xr'); assert.equal(viewers.filter(viewer => !viewer.destroyed).length + xrPanels.filter(panel => panel.gpu).length, 1, 'Only one GPU renderer may be alive'); },
        end() { if (!this.accepted) return; this.gpu = false; events.push('destroy:xr'); options.onExit(); },
        cancel() { assert.equal(this.accepted, false); },
        destroy() { this.destroyCount++; if (this.destroyed) return; this.destroyed = true; this.gpu = false; element.remove(); if (this.accepted) options.onExit(); },
      }; xrPanels.push(panel); return panel;
    } },
  };
  const importViewer = kind => new Promise((resolve, reject) => imports[kind].push({ resolve, reject }));
  const store = new Proxy({}, { get() { storage++; throw new Error('This viewer must not read or write browser storage'); } });
  const globals = { HTMLElement: Element, document, location: { origin: 'http://127.0.0.1:4323' },
    __generatedGiftFixture: { importObject: () => importViewer('object'), importWorld: () => importViewer('world'), importPrint: () => importViewer('print'), importXR: () => importViewer('xr') },
    fetch: () => { network++; throw new Error('Controller fixture must not make network requests'); }, localStorage: store, sessionStorage: store,
  };
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  const gift = { title: 'Your afternoon', senderName: 'Alex', recipientName: 'Sam', dedication: 'For our next adventure.', story: 'We watched the last ferry cross the bay.',
    originalUrl: '/synthetic/source.png', modelUrl: '/synthetic/gift.glb', panoramaUrl: '/synthetic/panorama.png', worldUrl: '/synthetic/world.spz', ...settings.gift };
  let portal;
  try {
    const { mountGeneratedGift } = await import(`${moduleUrl}#fixture-${++sequence}`);
    portal = mountGeneratedGift(host, { gift, isCurrent: () => current, onExit: () => { exits++; }, ...(settings.share ? { onShare: () => shares++ } : {}), ...(settings.shareScope ? { shareScope: settings.shareScope } : {}), ...(settings.initialView ? { initialView: settings.initialView } : {}), ...(settings.onCollection ? { onCollection: settings.onCollection } : {}), ...(settings.onJourney ? { onJourney: settings.onJourney } : {}) });
    const state = { host, opener, document, gift, imports, viewers, panels, xrPanels, events, actions, portal,
      dialog: () => dialogs[0], element: name => dialogs[0].querySelector(`[data-gg-${name}]`), selector: selector => dialogs[0].querySelector(selector),
      exitCount: () => exits, shareCount: () => shares, invalidate: () => current = false,
      resolve: async (kind, index = 0) => { assert.ok(imports[kind][index], `Pending ${kind} import required`); imports[kind][index].resolve(modules[kind]); await flush(); },
      reject: async (kind, index = 0) => { imports[kind][index].reject(new Error('Synthetic failed import')); await flush(); },
    };
    await action(state);
    assert.equal(network, 0); assert.equal(storage, 0);
  } finally { portal?.destroy(); for (const name of globalNames) { const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
}

test('room world entry skips the object renderer, and returning to the room disposes the world once', async () => {
  let opened = 0;
  await fixture(async state => {
    assert.equal(state.imports.object.length, 0);
    await state.resolve('world');
    const world = state.viewers[0]; assert.equal(world.kind, 'world'); world.callbacks.onReady();
    state.element('collection').click();
    assert.equal(opened, 1); assert.equal(world.destroyed, true); assert.equal(state.exitCount(), 0);
    assert.equal(state.host.children.length, 0); state.portal.destroy(); assert.equal(opened, 1);
  }, { initialView: 'world', onCollection: () => opened++ });
});

test('souvenir identity and orientation metadata reach the actual model viewer without changing original-photo provenance', async () => {
  await fixture(async state => {
    assert.ok(state.selector('.gg-object-badge')); assert.match(state.dialog().innerHTML, /Your 3D souvenir/);
    await state.resolve('object'); const options = state.viewers[0].callbacks;
    assert.equal(options.objectRepresentation, 'souvenir-miniature'); assert.equal(options.modelYaw, -Math.PI / 2);
    assert.equal(options.photoUrl, 'http://127.0.0.1:4323/synthetic/source.png'); assert.equal(options.photoIntent, 'place');
  }, { gift: { photoIntent: 'place', objectRepresentation: 'souvenir-miniature', modelYaw: -Math.PI / 2 } });
  await fixture(async state => {
    assert.ok(state.selector('.gg-object-badge')); assert.match(state.dialog().innerHTML, /A framed keepsake/); await state.resolve('object');
    assert.equal(state.viewers[0].callbacks.objectRepresentation, 'framed-postcard');
  }, { gift: { photoIntent: 'place', objectRepresentation: 'framed-postcard' } });
  await fixture(async state => {
    await state.resolve('object'); assert.equal(state.viewers[0].callbacks.modelYaw, undefined, 'The native souvenir front is retained in the +X keepsake viewer');
  }, { gift: { photoIntent: 'place', objectRepresentation: 'souvenir-miniature' } });
});

test('closing during object import prevents late renderer creation and restores focus and scroll styles once', async () => {
  await fixture(async state => {
    assert.equal(state.dialog().open, true); assert.equal(state.document.body.style.getPropertyValue('overflow'), 'hidden');
    state.element('exit').click(); await state.resolve('object');
    assert.equal(state.viewers.length, 0); assert.equal(state.exitCount(), 1); assert.equal(state.host.children.length, 0);
    assert.equal(state.document.activeElement, state.opener); assert.equal(state.opener.focusCount, 1);
    assert.equal(state.document.documentElement.style.getPropertyValue('overflow'), 'auto'); assert.equal(state.document.documentElement.style.getPropertyPriority('overflow'), 'important');
    assert.equal(state.document.body.style.getPropertyValue('overflow'), 'clip'); state.portal.destroy(); assert.equal(state.exitCount(), 1);
  });
});

test('per-gift GLB controls lead to real per-gift SPZ, projected story points, and return with one renderer', async () => {
  await fixture(async state => {
    await state.resolve('object'); const object = state.viewers[0];
    assert.equal(object.source, 'http://127.0.0.1:4323/synthetic/gift.glb'); object.callbacks.onReady();
    state.selector('[data-gg-control="left"]').click(); state.selector('[data-gg-control="in"]').click();
    assert.deepEqual(state.actions, [['rotate', 'object', .2], ['zoom', 'object', -.12]]);
    state.element('enter').click(); assert.deepEqual(state.events, ['mount:object', 'destroy:object']);
    await state.resolve('world'); const world = state.viewers[1];
    assert.equal(world.source, 'http://127.0.0.1:4323/synthetic/world.spz'); assert.equal(world.callbacks.points.length, 3);
    world.callbacks.onReady(); world.callbacks.onPoints([{ id: 'story', x: 37, y: 54, visible: true }, { id: 'note', x: 140, y: 54, visible: false }]);
    const point = state.selector('[data-gg-point="story"]'); assert.equal(point.hidden, false); assert.equal(point.style.left, '37%'); assert.equal(point.style.top, '54%'); assert.equal(state.selector('[data-gg-point="note"]').hidden, true);
    assert.equal(state.element('story').hidden, true); point.click(); assert.equal(state.element('point-text').textContent, state.gift.story); assert.equal(state.element('story').hidden, false);
    state.element('hide-story').click(); assert.equal(state.element('story').hidden, true);
    state.selector('[data-gg-story-item="note"]').click(); assert.equal(state.element('point-text').textContent, state.gift.dedication);
    state.selector('[data-gg-control="forward"]').click(); assert.deepEqual(state.actions.at(-1), ['forward', 'world']);
    state.element('return').click(); assert.equal(world.destroyed, true); await state.resolve('object', 1);
    assert.deepEqual(state.events, ['mount:object', 'destroy:object', 'mount:world', 'destroy:world', 'mount:object']);
  });
});

test('a souvenir without a delivered world opens its real model and story while World stays unavailable, including a legacy world link', async () => {
  for (const initialView of ['object', 'world']) await fixture(async state => {
    assert.equal(state.dialog().classList.contains('is-world'), false);assert.equal(state.imports.world.length, 0);
    assert.equal(state.element('enter'), null);assert.equal(state.element('journey'), null);
    const world = state.selector('[data-gg-mode="world"]');assert.equal(world.disabled, true);assert.equal(world.getAttribute('aria-disabled'), 'true');
    assert.match(state.dialog().innerHTML, /World unavailable/);assert.match(state.dialog().innerHTML, /The world is unavailable/);
    assert.match(state.dialog().innerHTML, /Read the story/);assert.match(state.dialog().innerHTML, /We watched the last ferry cross the bay/);
    const poster = state.selector('[data-gg-poster] img');assert.equal(poster.getAttribute('src'), 'http://127.0.0.1:4323/synthetic/miniature.png');
    assert.notEqual(poster.getAttribute('src'), state.gift.panoramaUrl, 'A panorama cannot substitute for a failed world');
    await state.resolve('object');const object = state.viewers[0];object.callbacks.onReady();
    assert.equal(object.source, 'http://127.0.0.1:4323/synthetic/gift.glb');
    state.selector('[data-gg-control="left"]').click();assert.deepEqual(state.actions.at(-1), ['rotate', 'object', .2]);
    world.click();assert.equal(state.imports.world.length, 0);assert.equal(object.destroyed, false);assert.equal(state.dialog().classList.contains('is-world'), false);
    assert.ok(state.element('print'));state.element('xr').click();await state.resolve('xr');
    assert.equal(state.xrPanels[0].options.worldUrl, '');assert.equal(state.xrPanels[0].options.modelUrl, object.source);
    assert.equal(state.imports.world.length, 0);assert.equal(state.events.includes('mount:world'), false);
  }, { initialView, gift: { worldUrl: undefined, keepsakeImageUrl: '/synthetic/miniature.png', panoramaUrl: '/synthetic/leftover-panorama.png' } });
});

test('switching before object import resolves ignores the obsolete import and late callbacks', async () => {
  await fixture(async state => {
    state.element('enter').click(); await state.resolve('world'); await state.resolve('object');
    assert.deepEqual(state.events, ['mount:world']); assert.equal(state.viewers[0].destroyed, false);
    state.viewers[0].callbacks.onReady(); state.element('return').click();
    state.viewers[0].callbacks.onError('Late error'); assert.equal(state.element('retry'), null); await state.resolve('object', 1);
  });
});

test('world failure preserves explicit story navigation and Retry replaces the failed renderer', async () => {
  await fixture(async state => {
    state.element('enter').click(); await state.resolve('world'); const failed = state.viewers[0];
    failed.callbacks.onError('Synthetic context loss'); assert.equal(failed.destroyed, true); assert.equal(state.element('controls').hidden, true);
    assert.match(state.element('caption').textContent, /spatial 3D unavailable/); state.element('show-story').click();
    assert.equal(state.element('point-text').textContent, state.gift.dedication); state.element('retry').click(); await state.resolve('world', 1);
    assert.equal(state.viewers.filter(viewer => !viewer.destroyed).length, 1); assert.equal(failed.destroyCount, 1);
  });
});

test('synchronous renderer initialization failure disposes the returned handle and offers recovery', async () => {
  await fixture(async state => {
    await state.resolve('object'); assert.equal(state.viewers[0].destroyCount, 1); assert.ok(state.element('retry'));
    assert.equal(state.element('controls').hidden, true); state.element('enter').click(); await state.resolve('world'); assert.equal(state.viewers[1].destroyed, false);
  }, { constructorFailure: 'object' });
});

test('expired assets never mount and close-to-refresh exits without fabricating refreshed access', async () => {
  await fixture(async state => {
    assert.equal(state.imports.object.length, 0); assert.match(state.element('status').innerHTML, /Media access has expired/);
    assert.equal(state.element('enter'), null);assert.equal(state.selector('[data-gg-mode="world"]').disabled, true);
    state.selector('[data-gg-mode="world"]').click();assert.equal(state.imports.world.length, 0);assert.match(state.dialog().innerHTML, /Read the story/);assert.match(state.dialog().innerHTML, /We watched the last ferry/);
    state.element('retry').click(); assert.equal(state.exitCount(), 1); assert.equal(state.host.children.length, 0);
  }, { gift: { mediaExpiresAt: 1 } });
});

test('unsafe asset URLs remain image-and-story fallback with no viewer imports', async () => {
  await fixture(async state => {
    assert.equal(state.imports.object.length, 0); assert.equal(state.selector('[data-gg-poster] img'), null);
    assert.equal(state.element('enter'), null);assert.equal(state.selector('[data-gg-mode="world"]').disabled, true);state.selector('[data-gg-mode="world"]').click();
    assert.equal(state.imports.world.length, 0); assert.match(state.element('caption').textContent, /3D object unavailable/);
  }, { gift: { modelUrl: 'javascript:alert(1)', worldUrl: 'http://other-origin.invalid/scene.spz', originalUrl: 'https://user:password@invalid.test/a.png', panoramaUrl: 'data:image/png;base64,invalid' } });
});

test('user content is inert and custom spatial points are bounded, normalized, and available in the list', async () => {
  await fixture(async state => {
    assert.equal(state.dialog().querySelector('script'), null); assert.match(state.dialog().innerHTML, /&lt;script&gt;/);
    state.element('enter').click(); await state.resolve('world');
    const points = state.viewers[0].callbacks.points; assert.equal(points.length, 1); assert.equal(points[0].id, 'story-0'); assert.deepEqual(points[0].position, [1, .2, -3]);
    state.selector('[data-gg-story-item="story-0"]').click(); assert.equal(state.element('point-text').textContent, '<img src=x onerror=alert(1)>'); assert.equal(state.element('point-text').children.length, 0);
  }, { gift: { title: '<script>alert(1)</script>', touchpoints: [
    { id: 'unsafe"] selector', title: 'Your story', text: '<img src=x onerror=alert(1)>', position: [1, .2, -3] },
    { id: 'bad', title: 'Impossible marker', text: 'Ignored', position: [999, 0, -3] },
  ] } });
});

test('route guard, detached host, failed imports, and native modal failure do not leak renderers', async () => {
  await fixture(async state => { state.invalidate(); await state.resolve('object'); assert.equal(state.viewers.length, 0); state.element('enter').click(); assert.equal(state.imports.world.length, 0); });
  await fixture(async state => { assert.equal(state.imports.object.length, 0); assert.equal(state.host.children.length, 0); }, { connected: false });
  await fixture(async state => { await state.reject('object'); assert.ok(state.element('retry')); assert.equal(state.viewers.length, 0); });
  await fixture(async state => { assert.equal(state.host.children.length, 0); assert.equal(state.exitCount(), 1); assert.equal(state.document.body.style.getPropertyValue('overflow'), 'clip'); }, { modalFailure: true });
});

test('share is optional and explicitly delegates the local-link action; native cancel exits once', async () => {
  await fixture(async state => { assert.equal(state.element('share'), null); });
  await fixture(async state => {
    state.element('share').click(); assert.equal(state.shareCount(), 1); assert.match(state.dialog().innerHTML, /Local preview link/);
    const cancel = new Event('cancel', { cancelable: true }); state.dialog().dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true); assert.equal(state.exitCount(), 1); await state.resolve('object'); assert.equal(state.viewers.length, 0);
  }, { share: true });
});

test('world walking stays unavailable until a collider reports readiness, and retired callbacks cannot change the next view', async () => {
  await fixture(async state => {
    state.selector('[data-gg-mode="world"]').click(); await state.resolve('world'); const world = state.viewers[0];
    world.callbacks.onReady(); const walk = state.element('walk');
    assert.equal(walk.getAttribute('aria-pressed'), 'false');
    world.walkingAvailable = true; world.callbacks.onWalkingChange({ available: true, enabled: false });
    assert.equal(walk.disabled, false); walk.click();
    assert.deepEqual(state.actions.at(-1), ['walking', 'world', true]); assert.equal(walk.getAttribute('aria-pressed'), 'true');
    assert.equal(state.element('walk-controls').hidden, false);
    state.selector('[data-gg-control="move-forward"]').click(); assert.deepEqual(state.actions.at(-1), ['move', 'world', 0, 1]);
    state.selector('[data-gg-mode="object"]').click(); world.callbacks.onWalkingChange({ available: true, enabled: true });
    assert.equal(state.element('walk'), null); await state.resolve('object', 1);
    assert.equal(state.viewers.filter(viewer => !viewer.destroyed).length, 1);
  }, { gift: { collisionUrl: '/synthetic/collider.glb' } });
});

test('approved discoveries appear as sourced historical context alongside the personal story in both gift views', async () => {
  const facts = CURIOSITY_FACTS.filter(fact => ['rio-gardens', 'clock-pocket'].includes(fact.id));
  await fixture(async state => {
    const cards = state.dialog().querySelectorAll('[data-gg-curiosity]'); assert.equal(cards.length, 2);
    assert.match(state.element('context').innerHTML || state.dialog().innerHTML, /Historical context/);
    const originalLinks = state.element('context').querySelectorAll('a');
    assert.deepEqual(originalLinks.map(link => link.getAttribute('href')), facts.map(fact => fact.sourceUrl));
    for (const link of originalLinks) { assert.equal(link.getAttribute('target'), '_blank'); assert.equal(link.getAttribute('rel'), 'noopener noreferrer'); assert.equal(link.getAttribute('referrerpolicy'), 'no-referrer'); }
    state.element('enter').click(); await state.resolve('world');
    assert.equal(state.viewers[0].callbacks.points.length, 5);
    state.selector('[data-gg-story-item="curiosity-0"]').click();
    assert.equal(state.element('point-context').textContent, 'Historical context');
    assert.equal(state.element('point-text').textContent, facts[0].text);
    assert.equal(state.element('point-source').getAttribute('href'), facts[0].sourceUrl);
    assert.equal(state.element('point-source').textContent, facts[0].sourceTitle);
    assert.equal(state.element('point-source').hidden, false);
    state.selector('[data-gg-story-item="story"]').click();
    assert.equal(state.element('point-context').textContent, 'Personal story'); assert.equal(state.element('point-text').textContent, state.gift.story);
    assert.equal(state.element('point-source').hidden, true); assert.equal(state.element('point-source').getAttribute('href'), null);
    state.element('return').click(); await state.resolve('object', 1);
    assert.equal(state.dialog().querySelectorAll('[data-gg-curiosity]').length, 2);
    assert.equal(state.viewers.filter(viewer => !viewer.destroyed).length, 1);
  }, { gift: { curiosities: facts } });
});

test('source labels and story content stay inert, and sources reject executable, spoofed, credentialed or insecure URLs', async () => {
  const title = '<img src=x onerror=alert(1)>', label = 'UNESCO <script>alert(1)</script>';
  await fixture(async state => {
    state.element('enter').click(); await state.resolve('world');
    assert.equal(state.dialog().querySelector('script'), null); assert.match(state.dialog().innerHTML, /&lt;img src=x/);
    state.selector('[data-gg-story-item="story-0"]').click();
    assert.equal(state.element('point-title').textContent, title); assert.equal(state.element('point-title').children.length, 0);
    assert.equal(state.element('point-text').textContent, '<svg onload=alert(1)>'); assert.equal(state.element('point-text').children.length, 0);
    assert.equal(state.element('point-source').textContent, label);
    assert.equal(state.element('point-source').querySelector('.story-reader-source-label').textContent, label);
    assert.equal(state.element('point-source').querySelector('script'), null); assert.equal(state.element('point-source').querySelector('img'), null);
    assert.equal(state.element('point-source').getAttribute('href'), 'https://whc.unesco.org/en/list/1100/');
  }, { gift: { touchpoints: [{ id: 'source', title, text: '<svg onload=alert(1)>', position: [0, 0, -3], sourceTitle: label, sourceUrl: 'https://whc.unesco.org/en/list/1100/' }] } });
  for (const sourceUrl of ['javascript:alert(1)', 'data:text/html,unsafe', 'http://whc.unesco.org/en/list/1100/', 'https://whc.unesco.org.evil.test/', 'https://user:secret@whc.unesco.org/', 'https://whc.unesco.org@evil.test/', 'https://whc.unesco.org:444/', 'not a URL']) await fixture(async state => {
    state.element('enter').click(); await state.resolve('world'); state.selector('[data-gg-story-item="story-0"]').click();
    assert.equal(state.element('point-source').hidden, true); assert.equal(state.element('point-source').getAttribute('href'), null);
    assert.equal(state.element('point-context').textContent, 'Personal story');
  }, { gift: { touchpoints: [{ id: 'source', title: 'A note', text: 'Your words', position: [0, 0, -3], sourceTitle: 'Unverified link', sourceUrl }] } });
});

test('historical chapters use only reviewed facts, deduplicate and leave room within the six-point world limit', async () => {
  const approved = CURIOSITY_FACTS[0], second = CURIOSITY_FACTS[1];
  const altered = { ...approved, title: '<script>Invented provenance</script>', text: 'This proves your object is ancient.', sourceUrl: 'javascript:alert(1)' };
  await fixture(async state => {
    assert.equal(state.dialog().querySelectorAll('[data-gg-curiosity]').length, 2);
    assert.doesNotMatch(state.dialog().innerHTML, /Invented provenance|your object is ancient|javascript:/);
    state.element('enter').click(); await state.resolve('world');
    const points = state.viewers[0].callbacks.points; assert.equal(points.length, 6);
    assert.deepEqual(points.map(point => point.id), ['story-0', 'story-1', 'story-2', 'story-3', 'curiosity-0', 'curiosity-1']);
    state.selector('[data-gg-story-item="curiosity-0"]').click();
    assert.equal(state.element('point-title').textContent, approved.title); assert.equal(state.element('point-text').textContent, approved.text);
    assert.equal(state.element('point-source').getAttribute('href'), approved.sourceUrl);
  }, { gift: { curiosities: [altered, altered, { ...approved, id: 'unknown' }, second, CURIOSITY_FACTS[2]], touchpoints: Array.from({ length: 6 }, (_, index) => ({ id: `custom-${index}`, title: `Personal chapter ${index}`, text: 'Personal words', position: [0, 0, -3] })) } });
  await fixture(async state => { assert.equal(state.element('context'), null); state.element('enter').click(); await state.resolve('world'); assert.equal(state.viewers[0].callbacks.points.length, 3); }, { gift: { curiosities: [{ id: 'unknown' }] } });
});

test('guided tour starts only after a real world is ready and offers thumbnail captions, Pause, Resume, Next and Exit', async () => {
  await fixture(async state => {
    state.element('enter').click(); await state.resolve('world'); const world = state.viewers[0];
    assert.equal(state.element('tour-panel').hidden, true); state.element('tour-start').click(); assert.equal(state.actions.length, 0);
    world.callbacks.onReady(); assert.equal(state.element('tour-start').disabled, false);
    state.element('tour-start').click(); assert.deepEqual(state.actions.at(-1), ['tour-start', 'world']);
    world.callbacks.onWalkingChange({ available: true, enabled: false });
    assert.equal(state.element('caption').textContent, 'Drone tour · drag to pause', 'A late collider cannot replace the tour caption');
    assert.equal(state.element('tour-panel').hidden, false); assert.equal(state.element('tour-title').textContent, 'A note for you');
    assert.equal(state.element('tour-text').textContent, state.gift.dedication);
    assert.equal(state.selector('[data-gg-tour-panel] img').getAttribute('src'), 'http://127.0.0.1:4323/synthetic/source.png');
    assert.equal(state.element('tour-context').textContent, 'Personal story'); assert.equal(state.element('tour-source').hidden, true);
    state.element('tour-toggle').click(); assert.deepEqual(state.actions.at(-1), ['tour-pause', 'world', 'user']);
    assert.equal(state.element('tour-toggle').textContent, 'Resume'); assert.match(state.element('tour-status').textContent, /Tour paused/);
    state.element('tour-toggle').click(); assert.deepEqual(state.actions.at(-1), ['tour-resume', 'world']);
    state.element('tour-next').click(); assert.equal(state.element('tour-text').textContent, state.gift.story);
    state.selector('[data-gg-story-item="note"]').click(); assert.deepEqual(state.actions.at(-1), ['focus', 'world', 'note']);
    assert.equal(state.element('tour-panel').hidden, true); assert.equal(state.element('story').hidden, false);
    state.element('hide-story').click(); assert.equal(state.element('tour-panel').hidden, true, 'Reading an individual viewpoint stops the tour');
    state.element('tour-stop').click(); assert.equal(state.element('tour-panel').hidden, true);
    assert.equal(state.element('tour-start').getAttribute('aria-pressed'), 'false'); assert.deepEqual(state.actions.at(-1), ['tour-stop', 'world']);
    assert.equal(state.viewers.length, 1); assert.equal(state.exitCount(), 0);
  });
});

test('tour captions preserve inert personal wording and clearly sourced historical context; reduced motion offers distinct still viewpoints', async () => {
  const fact = CURIOSITY_FACTS[0];
  await fixture(async state => {
    state.element('enter').click(); await state.resolve('world'); const world = state.viewers[0]; world.callbacks.onReady(); state.element('tour-start').click();
    assert.match(state.element('tour-status').textContent, /Still tour/); assert.equal(state.element('tour-toggle').hidden, true);
    assert.equal(state.element('tour-note').textContent, 'Still viewpoints. Next changes the view without animation.');
    assert.equal(state.element('tour-text').textContent, '<img src=x onerror=alert(1)>'); assert.equal(state.element('tour-text').children.length, 0);
    state.element('tour-next').click(); state.element('tour-next').click(); state.element('tour-next').click();
    assert.equal(state.element('tour-context').textContent, 'Historical context'); assert.equal(state.element('tour-text').textContent, fact.text);
    const source = state.element('tour-source'); assert.equal(source.hidden, false); assert.equal(source.getAttribute('href'), fact.sourceUrl);
    assert.equal(source.getAttribute('rel'), 'noopener noreferrer'); assert.equal(source.getAttribute('referrerpolicy'), 'no-referrer');
    state.element('tour-next').click(); assert.match(state.element('tour-status').textContent, /Tour complete/);
    assert.equal(state.element('tour-next').hidden, true); assert.equal(state.element('tour-toggle').textContent, 'Replay tour');
    assert.ok(state.actions.every(action => action[0] !== 'tour-resume'));
  }, { reducedMotion: true, gift: { dedication: '<img src=x onerror=alert(1)>', curiosities: [fact] } });
});

test('retired or failed world tour callbacks cannot revive controls or captions after a view switch', async () => {
  await fixture(async state => {
    state.element('enter').click(); await state.resolve('world'); const world = state.viewers[0]; world.callbacks.onReady(); state.element('tour-start').click();
    state.element('return').click(); assert.equal(world.destroyCount, 1); await state.resolve('object', 1);
    world.callbacks.onTourChange({ phase: 'playing', index: 0, count: 3, pointId: 'note', reducedMotion: false });
    assert.equal(state.element('tour-panel'), null); assert.equal(state.element('tour-start'), null);
    assert.equal(state.viewers.filter(viewer => !viewer.destroyed).length, 1);
  });
  await fixture(async state => {
    state.element('enter').click(); await state.resolve('world'); const world = state.viewers[0]; world.callbacks.onReady(); state.element('tour-start').click();
    world.callbacks.onError('Synthetic interrupted tour'); const caption = state.element('caption').textContent;
    world.callbacks.onTourChange({ phase: 'playing', index: 0, count: 3, pointId: 'note', reducedMotion: false });
    assert.equal(state.element('tour-panel').hidden, true); assert.equal(state.element('tour-start').disabled, true); assert.equal(state.element('caption').textContent, caption);
    assert.equal(world.destroyCount, 1);
  });
});

test('a selected story stays closed during flight and only the current, uncancelled arrival opens its physical reader', async () => {
  await fixture(async state => {
    await state.resolve('world'); const world = state.viewers[0]; world.callbacks.onReady();
    state.selector('[data-gg-story-item="story"]').click();
    assert.deepEqual(state.actions.at(-1), ['focus', 'world', 'story']); assert.equal(state.element('story').hidden, true);
    assert.equal(state.element('show-story').getAttribute('aria-expanded'), 'false');
    world.callbacks.onViewpointChange({ pointId: 'note', phase: 'arrived' }); assert.equal(state.element('story').hidden, true, 'An arrival for another selected point is stale');
    world.callbacks.onViewpointChange({ pointId: 'story', phase: 'arrived' }); assert.equal(state.element('story').hidden, false); assert.equal(state.element('point-text').textContent, state.gift.story);
    assert.equal(state.selector('[data-gg-point-reader] .story-reader').getAttribute('data-mode'), 'book');
    state.element('hide-story').click(); state.selector('[data-gg-story-item="note"]').click(); assert.equal(state.element('story').hidden, true);
    world.callbacks.onViewpointChange({ pointId: 'note', phase: 'cancelled' });
    world.callbacks.onViewpointChange({ pointId: 'note', phase: 'arrived' }); assert.equal(state.element('story').hidden, true, 'A cancelled flight must not later reopen the reader');
    state.selector('[data-gg-story-item="story"]').click(); state.element('return').click(); await state.resolve('object');
    world.callbacks.onViewpointChange({ pointId: 'story', phase: 'arrived' }); assert.equal(state.element('story'), null);
    assert.equal(world.destroyCount, 1); assert.equal(state.viewers.filter(viewer => !viewer.destroyed).length, 1);
  }, { initialView: 'world', deferredFocus: true });
});

test('arrival and travelling stages keep the world visible, and a physical reading object appears only at a settled viewpoint', async () => {
  await fixture(async state => {
    await state.resolve('world'); const world = state.viewers[0]; world.callbacks.onReady();
    const report = (stage, pointId = 'note', index = 0) => world.callbacks.onTourChange({ phase: 'playing', stage, pointId, index, count: 3, reducedMotion: false });
    report('arrival'); assert.equal(state.element('tour-panel').hidden, false); assert.equal(state.element('tour-reader').hidden, true); assert.equal(state.element('story').hidden, true);
    report('reading'); assert.equal(state.element('tour-reader').hidden, false); assert.equal(state.element('tour-title').textContent, 'A note for you'); assert.equal(state.element('tour-text').textContent, state.gift.dedication);
    report('travel', 'story', 1); assert.equal(state.element('tour-reader').hidden, true); assert.equal(state.element('story').hidden, true);
    report('reading', 'story', 1); assert.equal(state.element('tour-reader').hidden, false); assert.equal(state.element('tour-text').textContent, state.gift.story);
    world.callbacks.onTourChange({ phase: 'idle', index: 0, count: 3, reducedMotion: false }); assert.equal(state.element('tour-reader').hidden, true); assert.equal(state.element('tour-panel').hidden, true);
  }, { initialView: 'world' });
});

test('each environment selects a distinct flight profile and reading object, with enough dwell for the actual chapter text', async () => {
  for (const [asset, profile, mode] of [['/demo/rio-world-500k.spz', 'coast', 'tablet'], ['/demo/paris-world.spz', 'river', 'newspaper'], ['/demo/antikythera-world.spz', 'terrace', 'book']]) {
    await fixture(async state => {
      await state.resolve('world'); const world = state.viewers[0]; world.callbacks.onReady();
      assert.equal(world.callbacks.flightProfile, profile); assert.equal(state.selector('[data-gg-point-reader] .story-reader').getAttribute('data-mode'), mode);
      const points = world.callbacks.points; assert.ok(points.every(point => point.readingDurationMs >= 12000 && point.readingDurationMs <= 35000));
      assert.ok(points.find(point => point.id === 'story').readingDurationMs > points.find(point => point.id === 'note').readingDurationMs, 'A long story needs more settled reading time than a short dedication');
      state.element('tour-start').click(); assert.equal(state.element('tour-reader').hidden, false); assert.equal(state.element('tour-note').textContent, 'Still viewpoints. Next changes the view without animation.');
      state.element('tour-next').click(); assert.equal(state.element('tour-text').textContent, state.gift.story.trim()); assert.equal(state.element('tour-reader').hidden, false);
      assert.ok(state.actions.every(action => action[0] !== 'tour-resume'));
    }, { initialView: 'world', reducedMotion: true, gift: { worldUrl: asset, story: 'A memory shared beside the sea. '.repeat(100) } });
  }
});

test('only the exact local V22 Plus world selects the conservative candidate profile and retains its newspaper', async () => {
  for (const [asset, profile] of [
    ['/demo/v22/paris-world.spz', 'river-plus'],
    ['/demo/v22/paris-world.spz?preview=1', 'river-plus'],
    ['http://127.0.0.1:4323/demo/v22/paris-world.spz', 'river-plus'],
    ['/demo/v13/paris-world.spz', 'river'],
    ['/demo/v22/other/paris-world.spz', 'river'],
    ['https://example.test/demo/v22/paris-world.spz', 'river'],
  ]) await fixture(async state => {
    await state.resolve('world'); const world = state.viewers[0]; world.callbacks.onReady();
    assert.equal(world.callbacks.flightProfile, profile);
    assert.equal(state.selector('[data-gg-point-reader] .story-reader').getAttribute('data-mode'), 'newspaper');
    assert.deepEqual(world.callbacks.points.find(point => point.id === 'sender').position, [1.4, -.2, -2.65], 'Camera adaptation preserves the gift narrative point');
  }, { initialView: 'world', gift: { worldUrl: asset } });
});


test('gift walk delegates its action and disposes the active renderer before navigation', async () => {
  await fixture(async state => { assert.equal(state.element('journey'), null); });
  let flights = 0;
  await fixture(async state => {
    assert.match(state.dialog().innerHTML, /Walk inside/);
    assert.equal(state.element('enter'), null, 'A walking gift has one consistent journey entry');
    await state.resolve('object'); const object = state.viewers[0];
    state.element('journey').click();
    assert.equal(flights, 1); assert.equal(object.destroyed, true);
    assert.equal(state.host.children.length, 0); assert.equal(state.exitCount(), 0);
    state.portal.destroy(); assert.equal(flights, 1);
  }, { onJourney: () => flights++ });
});

test('World tab uses the same walk as the primary action without constructing a legacy world renderer', async () => {
  let walks = 0;
  await fixture(async state => {
    await state.resolve('object'); const object = state.viewers[0];
    state.selector('[data-gg-mode="world"]').click();
    assert.equal(walks, 1); assert.equal(object.destroyed, true);
    assert.equal(state.imports.world.length, 0); assert.equal(state.host.children.length, 0);
  }, { onJourney: () => walks++ });
});

test('concurrent print clicks import and mount one panel using the exact private model without replacing the GPU viewer', async () => {
  const modelUrl = 'https://project.supabase.co/storage/v1/object/sign/gp-instant-generated/job/model.glb?token=synthetic-read-token';
  await fixture(async state => {
    await state.resolve('object'); const viewer = state.viewers[0]; viewer.callbacks.onReady();
    const button = state.element('print'); assert.ok(button);
    button.click(); button.click(); button.click();
    assert.equal(state.imports.print.length, 1); assert.equal(button.disabled, true); assert.equal(state.panels.length, 0);
    await state.resolve('print'); assert.equal(state.panels.length, 1);
    const panel = state.panels[0]; assert.equal(panel.parent, state.host); assert.equal(panel.options.modelUrl, modelUrl);
    assert.equal(panel.options.title, state.gift.title); assert.equal(panel.options.modelYaw, -Math.PI / 2); assert.equal(panel.options.isCurrent(), true);
    assert.equal(viewer.destroyCount, 0); assert.equal(state.viewers.length, 1);
    button.click(); assert.equal(state.imports.print.length, 1); assert.equal(state.panels.length, 1);
    assert.doesNotMatch(state.dialog().innerHTML, /synthetic-read-token/, 'Signed model credentials are not copied into HTML');
  }, { gift: { modelUrl, modelYaw: -Math.PI / 2 } });
});

test('print rejects missing, unsafe and expired assets before opening any print module', async () => {
  for (const modelUrl of ['', 'javascript:alert(1)', 'data:model/gltf-binary;base64,AA==', 'https://user:password@unsafe.test/model.glb', 'http://other-origin.test/model.glb']) {
    await fixture(async state => { assert.equal(state.element('print'), null); assert.equal(state.imports.print.length, 0); }, { gift: { modelUrl } });
  }
  await fixture(async state => { assert.equal(state.element('print'), null); assert.equal(state.imports.print.length, 0); }, { gift: { mediaExpiresAt: 1 } });
  await fixture(async state => {
    state.invalidate(); state.element('print').click(); assert.equal(state.imports.print.length, 0);
  });
});

test('close, destroy, route invalidation and detached host prevent a late print import from mounting', async () => {
  for (const retire of [state => state.element('exit').click(), state => state.portal.destroy(), state => state.invalidate(), state => state.host.connected = false]) {
    await fixture(async state => {
      state.element('print').click(); assert.equal(state.imports.print.length, 1);
      retire(state); await state.resolve('print'); await state.resolve('object');
      assert.equal(state.panels.length, 0); assert.equal(state.viewers.length, 0);
      assert.equal(state.host.querySelector('[data-fixture-print]'), null);
    });
  }
});

test('switching views retires the pending print epoch while a subsequent current print can open once', async () => {
  await fixture(async state => {
    state.element('print').click(); state.element('enter').click(); await state.resolve('print');
    assert.equal(state.panels.length, 0); assert.equal(state.imports.world.length, 1);
    state.element('return').click(); const current = state.element('print'); assert.equal(current.disabled, false);
    current.click(); assert.equal(state.imports.print.length, 2); await state.resolve('print', 1);
    assert.equal(state.panels.length, 1); assert.equal(state.panels[0].options.isCurrent(), true);
    await state.resolve('world'); await state.resolve('object', 0); await state.resolve('object', 1);
    assert.equal(state.viewers.length, 1); assert.equal(state.viewers[0].kind, 'object');
  });
});

test('print close permits reopening and destroying the gift disposes the current child panel exactly once', async () => {
  await fixture(async state => {
    state.element('print').click(); await state.resolve('print'); const first = state.panels[0];
    first.close(); assert.equal(first.destroyCount, 1); assert.equal(state.element('print').disabled, false);
    state.element('print').click(); await state.resolve('print', 1); const second = state.panels[1];
    state.portal.destroy(); state.portal.destroy();
    assert.equal(first.destroyCount, 1); assert.equal(second.destroyCount, 1);
    assert.equal(first.options.isCurrent(), false); assert.equal(second.options.isCurrent(), false);
    assert.equal(state.host.children.length, 0);
    second.options.onClose(); assert.equal(state.host.children.length, 0);
  });
});

test('failed print import leaves the current gift usable and retryable while a stale failure cannot overwrite the next view', async () => {
  await fixture(async state => {
    state.element('print').click(); await state.reject('print');
    assert.match(state.element('status').textContent, /Print preparation could not open/); assert.equal(state.element('print').disabled, false);
    state.element('print').click(); await state.resolve('print', 1); assert.equal(state.panels.length, 1);
  });
  await fixture(async state => {
    state.element('print').click(); state.element('enter').click(); const before = state.element('status').textContent;
    await state.reject('print'); assert.equal(state.element('status').textContent, before); assert.equal(state.panels.length, 0);
  });
});

test('a private asset expiring during the lazy import cannot open a print panel with stale access', async () => {
  await fixture(async state => {
    state.element('print').click(); state.gift.mediaExpiresAt = 1;
    await state.resolve('print'); assert.equal(state.panels.length, 0);
    assert.equal(state.element('print').disabled, false, 'The stale import releases its pending button state');
  }, { gift: { mediaExpiresAt: Math.floor(Date.now() / 1000) + 60 } });
});

test('share copy distinguishes local preview, online cloud gift and finite private cloud retention', async () => {
  for (const [settings, expected] of [
    [{}, /Local preview link · available while this preview is running/],
    [{ shareScope: 'cloud' }, /Gift link · opens this keepsake online/],
    [{ shareScope: 'cloud', gift: { mediaExpiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 } }, /Private gift link · original photos and generated gifts expire after 7 days/],
  ]) await fixture(async state => {
    assert.match(state.dialog().innerHTML, expected); state.element('share').click(); assert.equal(state.shareCount(), 1);
    state.invalidate(); state.element('share').click(); assert.equal(state.shareCount(), 1);
  }, { share: true, ...settings });
});

test('VR panel opens lazily once beside Print with private GLB and orientation, inside the gift modal, preserving ordinary GPU until acceptance', async () => {
  const modelUrl='https://project.supabase.co/storage/v1/object/sign/gp-instant-generated/job/model.glb?token=synthetic-private-xr';
  await fixture(async state=>{
    assert.equal(state.imports.xr.length,0);assert.ok(state.element('print'));assert.ok(state.element('xr'));assert.match(state.dialog().innerHTML,/View in VR/);
    await state.resolve('object');const ordinary=state.viewers[0];ordinary.callbacks.onReady();state.element('xr').click();state.element('xr').click();assert.equal(state.imports.xr.length,1);await state.resolve('xr');
    const panel=state.xrPanels[0];assert.equal(panel.parent,state.element('xr-host'));assert.equal(state.dialog().contains(panel.parent),true);assert.equal(panel.options.modelUrl,modelUrl);assert.equal(panel.options.modelYaw,-Math.PI/2);assert.equal(panel.options.title,state.gift.title);assert.equal(panel.options.isCurrent(),true);assert.equal(ordinary.destroyCount,0);assert.equal(panel.gpu,false);assert.doesNotMatch(state.dialog().innerHTML,/synthetic-private-xr/);
  },{gift:{modelUrl,modelYaw:-Math.PI/2}});
});

test('unsupported and cancelled VR panels keep the ordinary gift renderer and controls alive', async()=>{
  for(const xrUnsupported of[true,false])await fixture(async state=>{
    await state.resolve('object');const ordinary=state.viewers[0];ordinary.callbacks.onReady();state.element('xr').click();await state.resolve('xr');const panel=state.xrPanels[0];if(xrUnsupported)panel.accept();else panel.cancel();
    assert.equal(ordinary.destroyCount,0);assert.equal(state.element('controls').hidden,false);state.element('xr-close').click();assert.equal(panel.destroyCount,1);assert.equal(state.imports.object.length,1);assert.equal(state.element('xr').disabled,false);assert.equal(state.element('xr-host').hidden,true);
  },{xrUnsupported});
});

test('decoded keepsake opens the souvenir directly, with controls and honest copy on the first ready callback', async()=>fixture(async state=>{
  assert.ok(state.selector('[data-gg-poster] img'),'The original image remains available while the actual model loads');
  assert.equal(state.element('controls').hidden,true);
  await state.resolve('object'); const object=state.viewers[0];
  assert.equal(object.callbacks.unboxing,false,'No separate reveal can cover an already visible image');
  object.callbacks.onReady();
  assert.equal(state.selector('.gg-visual').classList.contains('is-ready'),true);
  assert.equal(state.selector('.gg-visual').classList.contains('is-opening'),false);
  assert.equal(state.element('controls').hidden,false);
  assert.equal(state.element('status').hidden,true);
  assert.match(state.element('caption').textContent,/Drag to rotate/);
  assert.doesNotMatch(state.dialog().innerHTML,/Discover the memory|Open your gift to reveal/);
  assert.ok(state.selector('.gg-original-story'),'The story stays readable beside the souvenir');
  state.selector('[data-gg-control="left"]').click(); assert.deepEqual(state.actions.at(-1),['rotate','object',.2]);
  object.callbacks.onReady();
  assert.equal(state.selector('.gg-visual').classList.contains('is-opening'),false);
  assert.equal(state.element('controls').hidden,false);
}));

test('a retired or failed keepsake ready callback cannot alter a world view or replace the image fallback',async()=>{
  await fixture(async state=>{
    await state.resolve('object'); const object=state.viewers[0]; object.callbacks.onReady();
    state.element('enter').click(); await state.resolve('world'); state.viewers[1].callbacks.onReady();
    const caption=state.element('caption').textContent; object.callbacks.onReady();
    assert.equal(state.element('caption').textContent,caption);
    assert.equal(state.selector('.gg-visual').classList.contains('is-opening'),false);
  });
  await fixture(async state=>{
    await state.resolve('object'); const object=state.viewers[0]; object.callbacks.onReady(); object.callbacks.onError('Synthetic render failure');
    object.callbacks.onReady(); assert.equal(state.element('controls').hidden,true);
    assert.equal(state.selector('.gg-visual').classList.contains('is-opening'),false);
    assert.ok(state.element('retry'));
  });
});

test('accepted XR disposes only the ordinary renderer; native end restores one viewer without retiring the XR panel',async()=>fixture(async state=>{
  await state.resolve('object');const ordinary=state.viewers[0];ordinary.callbacks.onReady();state.element('xr').click();await state.resolve('xr');const panel=state.xrPanels[0];panel.accept();assert.equal(ordinary.destroyCount,1);assert.equal(panel.options.isCurrent(),true);assert.equal(panel.destroyCount,0);assert.equal(state.element('controls').hidden,true);
  panel.end();panel.options.onExit();assert.equal(state.imports.object.length,2);assert.equal(state.element('status').hidden,false);assert.match(state.element('status').textContent,/Returning to your keepsake/);await state.resolve('object',1);assert.equal(state.viewers.filter(viewer=>!viewer.destroyed).length,1);assert.equal(panel.gpu,false);assert.equal(panel.destroyCount,0);assert.equal(panel.options.isCurrent(),true);
}));

test('an object import pending before XR acceptance cannot create a second GPU when it resolves late',async()=>fixture(async state=>{
  state.element('xr').click();await state.resolve('xr');const panel=state.xrPanels[0];panel.accept();await state.resolve('object');assert.equal(state.viewers.length,0);assert.equal(panel.gpu,true);assert.equal(panel.options.isCurrent(),true);panel.end();await state.resolve('object',1);assert.equal(state.viewers.length,1);assert.equal(state.viewers[0].destroyed,false);
}));

test('closing VR panel after acceptance restores ordinary view once; a stale child exit cannot reopen it',async()=>fixture(async state=>{
  await state.resolve('object');state.element('xr').click();await state.resolve('xr');const first=state.xrPanels[0];first.accept();state.element('xr-close').click();assert.equal(first.destroyCount,1);assert.equal(first.options.isCurrent(),false);assert.equal(state.imports.object.length,2);first.options.onExit();assert.equal(state.imports.object.length,2);await state.resolve('object',1);
  state.element('xr').click();await state.resolve('xr',1);assert.equal(state.xrPanels.length,2);first.options.onSessionStarting();assert.equal(state.viewers[1].destroyed,false);assert.equal(state.xrPanels[1].options.isCurrent(),true);
}));

test('gift close, destruction and world switch retire accepted XR before child cleanup and never reopen an object viewer',async()=>{
  for(const retire of[state=>state.element('exit').click(),state=>state.portal.destroy(),state=>state.element('enter').click()])await fixture(async state=>{
    await state.resolve('object');state.element('xr').click();await state.resolve('xr');const panel=state.xrPanels[0];panel.accept();retire(state);assert.equal(panel.destroyCount,1);assert.equal(panel.options.isCurrent(),false);assert.equal(panel.gpu,false);assert.equal(state.imports.object.length,1);panel.options.onExit();assert.equal(state.imports.object.length,1);if(state.imports.world.length)await state.resolve('world');
  });
});

test('unsafe, missing and expired assets do not expose a VR button or import a headset module',async()=>{
  for(const modelUrl of['','javascript:alert(1)','data:model/gltf-binary;base64,AA==','https://user:pass@unsafe.test/a.glb','http://other.test/a.glb'])await fixture(async state=>{assert.equal(state.element('xr'),null);assert.equal(state.imports.xr.length,0);},{gift:{modelUrl}});
  await fixture(async state=>{assert.equal(state.element('xr'),null);assert.equal(state.imports.xr.length,0);},{gift:{mediaExpiresAt:1}});
});

test('close, cancel panel, route invalidation, detach and expiry prevent a late XR import from mounting',async()=>{
  for(const retire of[state=>state.element('exit').click(),state=>state.portal.destroy(),state=>state.element('xr-close').click(),state=>state.invalidate(),state=>state.host.connected=false,state=>state.gift.mediaExpiresAt=1])await fixture(async state=>{
    state.element('xr').click();assert.equal(state.imports.xr.length,1);retire(state);await state.resolve('xr');assert.equal(state.xrPanels.length,0);assert.equal(state.host.querySelector('[data-fixture-xr]'),null);
  });
});

test('mounted VR capability expires with the private model and cannot accept or restore stale access',async()=>fixture(async state=>{
  await state.resolve('object');state.element('xr').click();await state.resolve('xr');const panel=state.xrPanels[0];state.gift.mediaExpiresAt=1;assert.equal(panel.options.isCurrent(),false);panel.accept();assert.equal(panel.gpu,false);assert.equal(state.viewers[0].destroyCount,0);panel.options.onExit();assert.equal(state.imports.object.length,1);
},{gift:{mediaExpiresAt:Math.floor(Date.now()/1000)+60}}));

test('failed VR lazy import remains retryable and a stale failure cannot modify the next gift view',async()=>{
 await fixture(async state=>{state.element('xr').click();await state.reject('xr');assert.equal(state.element('xr').disabled,false);assert.match(state.element('status').textContent,/VR panel could not open/);state.element('xr').click();await state.resolve('xr',1);assert.equal(state.xrPanels.length,1);});
 await fixture(async state=>{state.element('xr').click();state.element('enter').click();const before=state.element('status').textContent;await state.reject('xr');assert.equal(state.element('status').textContent,before);assert.equal(state.xrPanels.length,0);});
});
