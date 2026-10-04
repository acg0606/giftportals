import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const helpers = moduleUrl(transpile(await readFile(new URL('../src/gift-walk-types.ts', import.meta.url), 'utf8')));
const source = transpile(await readFile(new URL('../src/first-person-place.ts', import.meta.url), 'utf8'))
  .replace(/import '\.\/first-person-place.css';\s*/, '')
  .replace(/import \{ mountGeneratedWorld \} from '\.\/generated-world';/, 'const mountGeneratedWorld = (...args) => globalThis.__walkFixture.mountWorld(...args);')
  .replace(/import \{ mountStoryReader \} from '\.\/story-reader';/, 'const mountStoryReader = (...args) => globalThis.__walkFixture.mountReader(...args);')
  .replace(/import \{ giftIcon \} from '\.\/gift-icon';/, 'const giftIcon = "<svg aria-hidden=\\"true\\"></svg>";')
  .replace(/from '\.\/gift-walk-types'/, `from '${helpers}'`);
const { mountFirstPersonPlace, WALK_SCENES } = await import(moduleUrl(source));
const scene = (changes = {}) => ({ id: 'shore', name: 'The Rio shore', title: 'Walk beside the bay', story: 'The waves brought us back to this afternoon.', world: '/rio.spz', collider: '/rio.glb', panorama: '/rio.png', intro: 'Walk beside the water. Take your time.', ...changes });

// Exercise the actual shell with controllable renderer/reader and DOM fixtures.
// These tests make no provider calls and do not establish WebGL appearance.
async function fixture(action, options = {}, settings = {}) {
  const previous = new Map(['document', 'window', '__walkFixture'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const state = { current: true, worlds: [], readers: [], exits: 0, focus: [] };
  class Element extends EventTarget {
    constructor(tag = 'div', attrs = {}) { super(); this.tagName = tag; this.attrs = attrs; this.children = []; this.parent = null; this.dataset = {}; this.style = {}; this.hidden = 'hidden' in attrs; this.disabled = 'disabled' in attrs; this.isConnected = true; for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value; }
    addEventListener(type, callback, options) { if (options?.signal) setMaxListeners(0, options.signal); super.addEventListener(type, callback, options); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    disconnect() { this.isConnected = false; this.children.forEach(child => child.disconnect()); }
    replaceChildren(...children) { this.children.forEach(child => child.disconnect()); this.children = []; this.append(...children); }
    set innerHTML(value) { this.html = value; this.replaceChildren(); const stack = [this], voidTags = new Set(['img', 'input', 'br']); for (const match of value.matchAll(/<\/?[A-Za-z][^>]*>/g)) { const raw = match[0], tag = /^<\/?([\w-]+)/.exec(raw)[1]; if (raw.startsWith('</')) { while (stack.length > 1 && stack.at(-1).tagName !== tag) stack.pop(); if (stack.length > 1) stack.pop(); continue; } const attrs = {}; for (const attr of raw.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[attr[1]] = attr[2] ?? ''; const child = new Element(tag, attrs); stack.at(-1).append(child); if (!voidTags.has(tag) && !raw.endsWith('/>')) stack.push(child); } }
    set textContent(value) { this.content = String(value); this.replaceChildren(); }
    get textContent() { return this.content || ''; }
    setAttribute(name, value) { this.attrs[name] = String(value); if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return name in this.attrs; }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    matches(selector) { const tag = /^[a-z][\w-]*/i.exec(selector)?.[0]; if (tag && this.tagName !== tag) return false; for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) if (!(name in this.attrs) || value !== undefined && this.attrs[name] !== value) return false; return true; }
    querySelectorAll(selector) { return this.descendants().filter(child => child.matches(selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { for (let item = this; item; item = item.parent) if (item.matches(selector)) return item; return null; }
    focus() { state.focus.push(this); }
    setPointerCapture(id) { this.pointer = id; }
    click() { if (!this.disabled) state.event('click', this); }
  }
  state.document = new EventTarget(); state.document.hidden = false; state.document.createElement = tag => new Element(tag); state.window = new EventTarget();
  state.host = new Element();
  const implementation = {
    mountWorld(host, url, options) {
      const handle = { host, url, options, calls: [], destroyed: 0, available: true, destroy() { this.destroyed++; options.onWalkingChange({ available: false, enabled: false }); }, setWalking(value) { this.calls.push(['walking', value]); options.onWalkingChange({ available: this.available, enabled: value && this.available }); return value && this.available; }, setMoveInput(...values) { this.calls.push(['move', ...values]); }, setWalkingViewpoint(id) { this.calls.push(['viewpoint', id]); return settings.viewpointAccepted !== false; }, reset() { this.calls.push(['reset']); }, lockPointer() { if (settings.deferMouse) return new Promise(resolve => { this.resolveMouse = resolve; }); return Promise.resolve(false); } };
      Object.assign(handle, { tour: {available: true, phase: 'idle', index: 0, count: 6, estimatedDurationMs: 123000, reducedMotion: Boolean(settings.reducedMotion)},
        startWalkingTour() {this.calls.push(['tour-start']);this.tour.phase=this.tour.reducedMotion?'paused':'playing';options.onWalkingChange({available:true,enabled:false});options.onWalkingTour({...this.tour});return true;},
        pauseWalkingTour(reason='user') {this.calls.push(['tour-pause',reason]);if(this.tour.phase==='playing'){this.tour.phase='paused';this.tour.reason=reason;options.onWalkingTour({...this.tour});}},
        resumeWalkingTour() {if(this.tour.reducedMotion)return false;this.calls.push(['tour-resume']);this.tour.phase='playing';options.onWalkingTour({...this.tour});return true;},
        stopWalkingTour() {if(this.tour.phase==='idle')return;this.calls.push(['tour-stop']);this.tour.phase='idle';options.onWalkingTour({...this.tour});},
        nextWalkingTour() {this.calls.push(['tour-next']);this.tour.index=Math.min(5,this.tour.index+1);options.onWalkingTour({...this.tour});},
      });
      const setWalking=handle.setWalking.bind(handle);handle.setWalking=value=>{if(value)handle.stopWalkingTour();return setWalking(value);};
      state.worlds.push(handle); if (settings.syncFailure) options.onError('The scene asset could not be loaded.'); return handle;
    },
    mountReader(host, options) { const reader = { host, options, updates: [], focused: 0, destroyed: 0, update(value) { this.updates.push(value); }, focus() { this.focused++; }, destroy() { this.destroyed++; } }; state.readers.push(reader); return reader; },
  };
  for (const [name, value] of Object.entries({ document: state.document, window: state.window, __walkFixture: implementation })) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  state.handle = mountFirstPersonPlace(state.host, { isCurrent: () => state.current, onExit: () => state.exits++, ...options });
  state.find = selector => { const value = state.host.querySelector(selector); assert.ok(value, selector); return value; };
  state.event = (type, target, values = {}) => { const event = new Event(type, { cancelable: true }); Object.defineProperties(event, Object.fromEntries(Object.entries({ target, ...values }).map(([name, value]) => [name, { value }]))); state.host.dispatchEvent(event); return event; };
  state.ready = (world = state.worlds.at(-1)) => { world.options.onReady(); world.options.onWalkingChange({ available: true, enabled: false }); world.options.onFirstPersonState({ ready: true, active: false, locked: false, distance: 0, grounded: true }); world.options.onWalkingTour({...world.tour,available:settings.tourUnavailable!==true}); };
  try { await action(state); } finally { state.handle.destroy(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
}

test('legacy Paris route retains its calibrated provider scene and return to the Paris gift without authored visitors', async () => {
  await fixture(state => {
    assert.equal(WALK_SCENES.length, 1); assert.equal(state.worlds[0].url, WALK_SCENES[0].world);
    assert.equal(state.worlds[0].options.firstPerson.metricScale, 2.9049978); assert.equal(state.worlds[0].options.firstPerson.autoCalibrate, false); assert.equal(state.worlds[0].options.firstPerson.livingGarden, false);
    assert.match(state.host.html, /href="#\/generated\/paris-example\?from=room"/); assert.match(state.find('main').getAttribute('aria-label'), /A little Paris/);
    assert.equal(state.find('[data-wp-intro]').textContent, 'Walk toward the tower.\nTurn your head. Take your time.');
    state.ready(); state.find('[data-wp-story]').click(); assert.equal(state.readers[0].updates[0].worldTitle, 'A little Paris'); assert.equal(state.readers[0].updates[0].body, WALK_SCENES[0].story);
  });
});

test('a personal gift supplies its own inert labels, story, intro, internal return link and calibration request', async () => {
  const custom = scene({ name: '<script>shore</script>', title: '<img src=x onerror=alert(1)>', story: '<script>personal words</script>', intro: 'A private walk <b>near home</b>', journalMode: 'tablet' });
  await fixture(state => {
    assert.equal(state.worlds[0].url, '/rio.spz'); assert.equal(state.worlds[0].options.collisionUrl, '/rio.glb'); assert.equal(state.worlds[0].options.panoramaUrl, '/rio.png');
    assert.equal(state.worlds[0].options.firstPerson.autoCalibrate, true); assert.equal(state.worlds[0].options.firstPerson.spawn, undefined); assert.equal(state.worlds[0].options.firstPerson.livingGarden, false);
    assert.equal(state.find('[data-wp-title]').textContent, custom.title); assert.equal(state.find('[data-wp-intro]').textContent, custom.intro);
    assert.equal(state.host.querySelector('script'), null); assert.match(state.host.html, /&lt;script&gt;shore&lt;\/script&gt;/); assert.match(state.host.html, /href="#\/generated\/private-id\?key=abc_123-xyz"/); assert.doesNotMatch(state.host.html, /Paris|toward the tower/);
    state.ready(); state.find('[data-wp-start]').click(); assert.equal(state.find('main').dataset.state, 'walking');
    state.find('[data-wp-story]').click(); const reader = state.readers[0]; assert.equal(state.find('main').dataset.state, 'ready'); assert.equal(reader.updates[0].body, custom.story); assert.equal(reader.updates[0].worldTitle, 'Our <summer>'); assert.equal(reader.updates[0].mode, 'tablet');
    reader.options.onClose(); assert.equal(reader.destroyed, 1); assert.equal(state.find('main').dataset.state, 'walking');
  }, { scenes: [custom], giftTitle: 'Our <summer>', giftHref: '#/generated/private-id?key=abc_123-xyz' });
});

test('scene changes dispose prior viewers/readers and ignore old physics, errors, reader-close and mouse replies', async () => {
  await fixture(async state => {
    const first = state.worlds[0]; state.ready(first); state.find('[data-wp-mouse]').click(); state.find('[data-wp-story]').click(); const reader = state.readers[0];
    state.find('[data-wp-scene="1"]').click(); const second = state.worlds[1]; assert.equal(first.destroyed, 1); assert.equal(reader.destroyed, 1);
    const hint = state.find('[data-wp-hint]').textContent;
    first.options.onReady(); first.options.onWalkingChange({ available: true, enabled: true }); first.options.onError('old failure'); first.options.onFirstPersonState({ ready: false, distance: 100 }); reader.options.onClose(); first.resolveMouse(true); await Promise.resolve();
    assert.equal(state.find('[data-wp-title]').textContent, 'Inside the observatory'); assert.equal(state.find('[data-wp-hint]').textContent, hint); assert.equal(state.find('main').dataset.state, 'loading'); assert.equal(second.calls.length, 0); assert.equal(state.find('[data-wp-start]').disabled, true);
    state.ready(second); state.find('[data-wp-story]').click(); const next = state.readers[1].updates[0]; assert.equal(next.title, 'Inside the observatory'); assert.equal(next.body, 'My observatory memory.'); assert.equal(next.mode, 'newspaper'); assert.equal(next.worldTitle, 'Two places'); assert.equal(next.index, 1); assert.equal(next.count, 2);
  }, { scenes: [scene(), scene({ id: 'observatory', name: 'Antikythera', title: 'Inside the observatory', story: 'My observatory memory.', journalMode: 'newspaper' })], giftTitle: 'Two places' }, { deferMouse: true });
});

test('audited calibration retains the real gift geometry while legacy visitor opt-in stays disabled', async () => {
  const routes = [{ start: [2, -1], end: [4, -1] }, { start: [2, 1], end: [4, 1], reverse: true }], spawn = [1, 1.2, 0];
  await fixture(state => { const config = state.worlds[0].options.firstPerson; assert.equal(config.spawn, spawn); assert.equal(config.metricScale, 1.9); assert.equal(config.groundOffset, -.5); assert.equal(config.gardenRoutes, routes); assert.equal(config.groundProbeY, 4); assert.equal(config.livingGarden, false); assert.equal(config.autoCalibrate, false); }, { scenes: [scene({ metricScale: 1.9, groundOffset: -.5, spawn, livingGarden: true, gardenRoutes: routes, groundProbeY: 4 })] });
});

test('movement and a longer chapter tour stay gated until ready; manual input and blur/hide clear or pause guided motion', async () => {
  await fixture(state => {
    const world = state.worlds[0], forward = state.find('[data-wp-move="forward"]');
    state.event('pointerdown', forward, { pointerId: 1 }); assert.equal(world.calls.length, 0);
    world.options.onReady(); state.event('pointerdown', forward, { pointerId: 1 }); assert.equal(world.calls.length, 0);
    state.ready(); state.find('[data-wp-stroll]').click(); assert.equal(state.find('[data-wp-stroll]').getAttribute('aria-pressed'), 'true');
    world.options.onFirstPersonState({ ready: true, active: true, locked: false, distance: 10.1, grounded: true }); assert.equal(state.find('[data-wp-stroll]').getAttribute('aria-pressed'), 'true'); assert.equal(state.find('[data-wp-tour]').hidden,false);assert.match(state.find('[data-wp-tour-count]').textContent,/Chapter 1 of 6.*2 min/);
    state.event('pointerdown', forward, { pointerId: 2 }); assert.deepEqual(world.calls.at(-1), ['move', 0, 1]); state.event('pointerup', forward, { pointerId: 2 }); assert.deepEqual(world.calls.at(-1), ['move', 0, 0]);
    state.find('[data-wp-stroll]').click(); state.window.dispatchEvent(new Event('blur')); assert.equal(state.find('[data-wp-stroll]').getAttribute('aria-pressed'), 'false'); assert.deepEqual(world.calls.at(-1), ['tour-pause','hidden']);
    state.find('[data-wp-stroll]').click(); state.document.hidden = true; state.document.dispatchEvent(new Event('visibilitychange')); assert.equal(state.find('[data-wp-stroll]').getAttribute('aria-pressed'), 'false'); assert.deepEqual(world.calls.at(-1), ['tour-pause','hidden']);
    state.find('[data-wp-pause]').click(); assert.equal(state.find('main').dataset.state, 'walking'); state.find('[data-wp-pause]').click(); assert.equal(state.find('main').dataset.state, 'ready'); state.find('[data-wp-reset]').click(); assert.deepEqual(world.calls.at(-1), ['reset']);
  }, { scenes: [scene()], giftTitle: 'Rio' });
});

test('empty/failed walks retain a safe return path without enabling movement, journal or a fabricated scene', async () => {
  await fixture(state => { assert.equal(state.worlds.length, 0); assert.equal(state.find('main').dataset.state, 'error'); assert.equal(state.find('[data-wp-start]').disabled, true); assert.equal(state.find('[data-wp-story]').disabled, true); assert.match(state.find('[data-wp-hint]').textContent, /no usable walking scene/); assert.match(state.host.html, /href="#\/collection"/); assert.doesNotMatch(state.host.html, /Paris/); state.find('[data-wp-exit]').click(); assert.equal(state.exits, 1); }, { scenes: [], giftTitle: 'A keepsake', giftHref: 'javascript:alert(1)' });
  await fixture(state => { assert.equal(state.find('main').dataset.state, 'error'); assert.match(state.find('[data-wp-hint]').textContent, /could not be loaded/); assert.equal(state.find('[data-wp-start]').disabled, true); const before = state.worlds[0].calls.length; state.event('pointerdown', state.find('[data-wp-move="forward"]'), { pointerId: 1 }); assert.equal(state.worlds[0].calls.length, before); }, { scenes: [scene()] }, { syncFailure: true });
});

test('destroy aborts event handlers and ignores late callbacks without reviving the walk or story', async () => {
  await fixture(state => { state.ready(); state.find('[data-wp-story]').click(); const world = state.worlds[0], reader = state.readers[0], exit = state.find('[data-wp-exit]'); state.handle.destroy(); assert.equal(world.destroyed, 1); assert.equal(reader.destroyed, 1); assert.equal(state.host.children.length, 0); reader.options.onClose(); world.options.onReady(); world.options.onError('late failure'); state.event('click', exit); assert.equal(state.exits, 0); assert.equal(state.host.children.length, 0); state.handle.destroy(); assert.equal(world.destroyed, 1); }, { scenes: [scene()], giftTitle: 'Rio' });
});

const viewpoints = () => [
  { id: 'arrival', name: 'Arrival', position: [0, 1.65, 0], yaw: 0 },
  { id: 'bay', name: 'Beside the bay', position: [3.2, 1.65, 0], yaw: .5 },
];

test('only single automatically calibrated gifts show validated viewpoint buttons, gated until ready', async () => {
  await fixture(state => {
    const world = state.worlds[0], nav = state.find('[data-wp-viewpoints]'); assert.equal(nav.hidden, true);
    world.options.onWalkingViewpoints([...viewpoints(), viewpoints()[1], { id: 'invalid', name: 'Unsupported', position: [NaN, 0, 0], yaw: 0 }]);
    assert.equal(nav.hidden, false); assert.equal(nav.children.length, 2); assert.equal(state.host.querySelectorAll('[data-wp-scene]').length, 1); assert.equal(nav.children[0].textContent, 'Arrival'); assert.equal(nav.children[0].getAttribute('aria-pressed'), 'true');
    assert.equal(nav.children[1].disabled, true); nav.children[1].click(); assert.equal(world.calls.length, 0);
    world.options.onReady(); assert.equal(nav.children[1].disabled, true); state.ready(); assert.equal(nav.children[1].disabled, false);
    nav.children[1].click(); assert.ok(world.calls.some(call => call[0] === 'viewpoint' && call[1] === 'bay')); assert.equal(state.find('main').dataset.state, 'ready'); assert.equal(nav.children[1].getAttribute('aria-pressed'), 'true');
  }, { scenes: [scene()], giftTitle: 'Rio' });
  for (const scenes of [[scene({ metricScale: 2, groundOffset: 0, spawn: [0, 1.65, 0] })], [scene(), scene({ id: 'second' })]]) await fixture(state => { state.worlds[0].options.onWalkingViewpoints(viewpoints()); assert.equal(state.find('[data-wp-viewpoints]').hidden, true); assert.equal(state.find('[data-wp-viewpoints]').children.length, 0); }, { scenes });
});

test('viewpoint changes stop stroll, close the journal, retain pause/walk state and reset selection to Arrival', async () => {
  await fixture(state => {
    const world = state.worlds[0]; world.options.onWalkingViewpoints(viewpoints()); state.ready(); const bay = state.find('[data-wp-viewpoint="bay"]'), arrival = state.find('[data-wp-viewpoint="arrival"]');
    state.find('[data-wp-stroll]').click(); assert.equal(state.find('main').dataset.state, 'walking'); bay.click(); assert.equal(state.find('[data-wp-stroll]').getAttribute('aria-pressed'), 'false'); assert.equal(state.find('main').dataset.state, 'ready'); assert.deepEqual(world.calls.at(-1), ['walking', false]);
    state.find('[data-wp-story]').click(); const reader = state.readers[0]; assert.equal(state.find('main').dataset.state, 'ready'); arrival.click(); assert.equal(reader.destroyed, 1); assert.equal(state.find('[data-wp-reader]').hidden, true); assert.equal(state.find('main').dataset.state, 'ready'); assert.deepEqual(world.calls.at(-1), ['walking', false]); const calls = world.calls.length; reader.options.onClose(); assert.equal(world.calls.length, calls); assert.equal(state.find('main').dataset.state, 'ready');
    bay.click(); state.find('[data-wp-reset]').click(); assert.equal(arrival.getAttribute('aria-pressed'), 'true'); assert.equal(bay.getAttribute('aria-pressed'), 'false'); assert.deepEqual(world.calls.at(-1), ['reset']); assert.equal(state.find('main').dataset.state, 'ready');
  }, { scenes: [scene()], giftTitle: 'Rio' });
});

test('viewpoint names remain text and failed changes leave the prior selection without resuming motion', async () => {
  await fixture(state => {
    const world = state.worlds[0]; world.options.onWalkingViewpoints([viewpoints()[0], { ...viewpoints()[1], name: '<img src=x onerror=alert(1)>' }]); state.ready();
    const bay = state.find('[data-wp-viewpoint="bay"]'); assert.equal(bay.textContent, '<img src=x onerror=alert(1)>'); assert.equal(bay.children.length, 0);
    bay.click(); assert.equal(state.find('[data-wp-viewpoint="arrival"]').getAttribute('aria-pressed'), 'true'); assert.equal(state.find('main').dataset.state, 'ready'); assert.match(state.find('[data-wp-hint]').textContent, /viewpoint could not open/); assert.equal(world.calls.some(call => call[0] === 'walking' && call[1] === true), false);
  }, { scenes: [scene()] }, { viewpointAccepted: false });
});

test('replaced, hidden, failed or destroyed viewpoints cannot revive a stale walking menu', async () => {
  await fixture(state => {
    const first = state.worlds[0]; first.options.onWalkingViewpoints(viewpoints()); state.ready(); const stale = state.find('[data-wp-viewpoint="bay"]');
    first.options.onWalkingViewpoints([]); assert.equal(state.find('[data-wp-viewpoints]').hidden, true); const calls = first.calls.length; state.event('click', stale); assert.equal(first.calls.length, calls);
    first.options.onWalkingViewpoints(viewpoints()); first.options.onError('Lost scene'); assert.equal(state.find('[data-wp-viewpoint="bay"]').disabled, true);
    state.find('[data-wp-scene="0"]').click(); const second = state.worlds[1]; first.options.onWalkingViewpoints(viewpoints()); assert.equal(state.find('[data-wp-viewpoints]').hidden, true); assert.equal(state.find('[data-wp-viewpoints]').children.length, 0);
    state.ready(second); second.options.onWalkingViewpoints(viewpoints()); const button = state.find('[data-wp-viewpoint="bay"]'); state.current = false; const secondCalls = second.calls.length; state.event('click', button); assert.equal(second.calls.length, secondCalls); second.options.onWalkingViewpoints([]); assert.equal(state.find('[data-wp-viewpoints]').children.length, 2);
    state.current = true; state.handle.destroy(); second.options.onWalkingViewpoints(viewpoints()); assert.equal(state.host.children.length, 0);
  }, { scenes: [scene()], giftTitle: 'Rio' });
});

test('reduced motion offers still Next controls and a manual exit; missing connected paths keep manual walking available', async () => {
  await fixture(state=>{state.ready();const world=state.worlds[0];state.find('[data-wp-stroll]').click();assert.equal(state.find('main').dataset.tour,'paused');assert.match(state.find('[data-wp-tour-note]').textContent,/Reduced motion/);state.find('[data-wp-tour-next]').click();assert.equal(world.tour.index,1);assert.equal(state.find('[data-wp-pause]').getAttribute('aria-label'),'Next still chapter');state.find('[data-wp-pause]').click();assert.equal(world.tour.index,2);state.find('[data-wp-tour-explore]').click();assert.equal(state.find('[data-wp-tour]').hidden,true);assert.equal(state.find('main').dataset.state,'walking');}, {scenes:[scene()]},{reducedMotion:true});
  await fixture(state=>{state.ready();assert.equal(state.find('[data-wp-stroll]').disabled,true);assert.equal(state.find('[data-wp-start]').disabled,false);state.find('[data-wp-start]').click();assert.equal(state.find('main').dataset.state,'walking');},{scenes:[scene()]},{tourUnavailable:true});
});

test('expired media never mounts a world; expiry during a chapter destroys it and ignores late state without blocking return', async () => {
  await fixture(state=>{assert.equal(state.worlds.length,0);assert.equal(state.find('main').dataset.state,'error');assert.equal(state.find('[data-wp-stroll]').disabled,true);state.find('[data-wp-exit]').click();assert.equal(state.exits,1);},{scenes:[scene({mediaExpiresAt:Date.now()/1000-1})]});
  const expiring=scene({mediaExpiresAt:Date.now()/1000+60});await fixture(state=>{state.ready();const world=state.worlds[0];state.find('[data-wp-stroll]').click();expiring.mediaExpiresAt=Date.now()/1000-1;world.options.onWalkingTour({...world.tour,index:1});assert.equal(world.destroyed,1);assert.equal(state.find('main').dataset.state,'error');assert.equal(state.find('[data-wp-tour]').hidden,true);world.options.onWalkingTour({...world.tour,phase:'playing'});world.options.onReady();assert.equal(world.destroyed,1);assert.equal(state.find('main').dataset.state,'error');assert.match(state.find('[data-wp-hint]').textContent,/expired/);state.find('[data-wp-exit]').click();assert.equal(state.exits,1);},{scenes:[expiring]});
});

test('blocked tours disable ineffective resume controls while keeping explicit exploration and reset; still chapters have an accurate label',async()=>{
 await fixture(state=>{state.ready();const world=state.worlds[0];world.options.onWalkingTour({...world.tour,phase:'paused',reason:'blocked'});for(const name of ['stroll','pause','tour-next'])assert.equal(state.find(`[data-wp-${name}]`).disabled,true);assert.equal(state.find('[data-wp-tour-explore]').disabled,false);assert.equal(state.find('[data-wp-reset]').disabled,false);state.find('[data-wp-tour-explore]').click();assert.equal(state.find('main').dataset.state,'walking');},{scenes:[scene()]});
 await fixture(state=>{state.ready();state.find('[data-wp-stroll]').click();assert.equal(state.find('[data-wp-stroll]').getAttribute('aria-label'),'Next still chapter');},{scenes:[scene()]},{reducedMotion:true});
});
