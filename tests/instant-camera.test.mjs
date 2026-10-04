import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';

// Actual camera session/modal code, with local DOM/media/canvas fixtures.
// This proves lifecycle behavior, not access to a physical notebook camera.
const code = ts.transpileModule(await readFile(new URL('../src/instant-camera.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { createInstantCameraSession, mountInstantCamera } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const flush = async () => { await setImmediate(); await setImmediate(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(action, settings = {}) {
  const names = ['navigator', 'document', 'window', 'URL', 'isSecureContext', 'fetch'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const state = { current: true, requests: [], plans: [], streams: [], states: [], photos: [], canvases: [], urls: [], revoked: [], dialogs: [], handles: [], fallbacks: 0, closes: 0, network: 0, devices: [{ kind: 'videoinput', deviceId: 'front' }] };
  class Element extends EventTarget {
    hidden = false; disabled = false; isConnected = true; attrs = new Map(); dataset = {}; textContent = ''; focusCount = 0;
    addEventListener(type, callback, options) { if (options?.signal) setMaxListeners(0, options.signal); super.addEventListener(type, callback, options); }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    removeAttribute(name) { this.attrs.delete(name); }
    focus() { state.document.activeElement = this; this.focusCount++; }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
    remove() { this.isConnected = false; }
  }
  class Video extends Element {
    srcObject = null; videoWidth = 1920; videoHeight = 1080; plays = 0; pauses = 0;
    play() { this.plays++; return settings.playPromise || Promise.resolve(); }
    pause() { this.pauses++; }
  }
  class Dialog extends Element {
    open = false; elements = new Map();
    set innerHTML(value) {
      this.html = value;
      for (const [, tag, attribute, attributes] of value.matchAll(/<(\w+)\b([^>]*?\b(data-camera-[\w-]+)[^>]*)>/g)) {
        const selector = `[${attributes}]`; const element = tag === 'video' ? new Video() : new Element();
        element.hidden = /\bhidden\b/.test(attribute); element.disabled = /\bdisabled\b/.test(attribute); this.elements.set(selector, element);
      }
    }
    querySelector(selector) { return this.elements.get(selector) || null; }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
  }
  state.newStream = (id = 'front') => {
    const tracks = Array.from({ length: 2 }, () => ({ stopped: 0, stop() { this.stopped++; }, getSettings: () => ({ deviceId: id }) }));
    const stream = { tracks, getTracks: () => tracks, getVideoTracks: () => [tracks[0]] }; state.streams.push(stream); return stream;
  };
  const mediaDevices = {
    async getUserMedia(constraints) {
      state.requests.push(constraints); const plan = state.plans.shift();
      if (plan instanceof Error) throw plan;
      return typeof plan === 'function' ? plan() : state.newStream(constraints.video.deviceId?.exact || 'front');
    },
    enumerateDevices: async () => { if (settings.enumerationFailure) throw new Error('Unavailable device list'); return state.devices; },
  };
  const doc = new EventTarget(); doc.visibilityState = 'visible'; state.document = doc; state.window = new EventTarget();
  state.before = new Element(); doc.activeElement = state.before;
  doc.body = { append(root) { root.isConnected = true; } };
  doc.createElement = tag => {
    if (tag === 'dialog') { const dialog = new Dialog(); state.dialogs.push(dialog); return dialog; }
    assert.equal(tag, 'canvas');
    const canvas = { width: 0, height: 0, draws: [], getContext() { return settings.noCanvas ? null : { drawImage: (...args) => canvas.draws.push(args) }; }, toBlob(callback, type, quality) { canvas.encoding = { type, quality }; if (settings.deferCapture) canvas.complete = callback; else callback(new Blob(['local captured pixels'], { type })); } };
    state.canvases.push(canvas); return canvas;
  };
  const values = { navigator: settings.noMedia ? {} : { mediaDevices }, document: doc, window: state.window, isSecureContext: settings.insecure ? false : true,
    URL: { createObjectURL(file) { const url = `blob:local-camera-${state.urls.length}`; state.urls.push({ url, file }); return url; }, revokeObjectURL(url) { state.revoked.push(url); } },
    fetch: async () => { state.network++; throw new Error('Camera must not contact a server'); },
  };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  state.video = new Video();
  state.session = createInstantCameraSession(state.video, { isCurrent: () => state.current, onState: value => state.states.push(value), onPhoto: file => state.photos.push(file) });
  state.mount = () => { const handle = mountInstantCamera({ isCurrent: () => state.current, onPhoto: file => state.photos.push(file), onChoosePhoto: () => state.fallbacks++, onClose: () => state.closes++ }); state.handles.push(handle); return state.dialogs.at(-1); };
  try { await action(state); assert.equal(state.network, 0); }
  finally { state.session.destroy(); for (const handle of state.handles) handle.destroy(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
}

test('capture remains local until Use photo, preserves the whole frame, and stops every camera track during review', async () => {
  await fixture(async state => {
    assert.equal(state.requests.length, 0); await state.session.start();
    assert.equal(state.requests[0].audio, false); assert.deepEqual(state.requests[0].video.facingMode, { ideal: 'environment' });
    assert.equal(state.video.srcObject, state.streams[0]); assert.equal(state.states.at(-1).phase, 'live');
    await state.session.capture();
    assert.deepEqual([state.canvases[0].width, state.canvases[0].height], [1600, 900]);
    assert.deepEqual(state.canvases[0].draws[0], [state.video, 0, 0, 1600, 900]);
    assert.deepEqual(state.canvases[0].encoding, { type: 'image/jpeg', quality: .86 });
    assert.equal(state.video.srcObject, null); assert.ok(state.streams[0].tracks.every(track => track.stopped === 1));
    assert.equal(state.states.at(-1).phase, 'review'); assert.equal(state.photos.length, 0);
    state.session.usePhoto(); state.session.usePhoto();
    assert.equal(state.photos.length, 1); assert.ok(state.photos[0] instanceof File); assert.equal(state.photos[0].type, 'image/jpeg');
    assert.deepEqual(state.revoked, ['blob:local-camera-0']); assert.equal(state.states.at(-1).phase, 'closed');
  });
});

test('camera switching releases the old stream and Retake discards the previous photo before reopening the selected camera', async () => {
  await fixture(async state => {
    state.devices.push({ kind: 'videoinput', deviceId: 'rear' });
    await state.session.start(); await flush(); assert.equal(state.states.at(-1).canSwitch, true);
    await state.session.switchCamera();
    assert.deepEqual(state.requests[1].video.deviceId, { exact: 'rear' });
    assert.ok(state.streams[0].tracks.every(track => track.stopped === 1)); assert.equal(state.video.srcObject, state.streams[1]);
    await state.session.capture(); assert.equal(state.photos.length, 0);
    await state.session.retake();
    assert.deepEqual(state.revoked, ['blob:local-camera-0']); assert.deepEqual(state.requests[2].video.deviceId, { exact: 'rear' });
    assert.equal(state.states.at(-1).phase, 'live'); assert.equal(state.states.at(-1).previewUrl, undefined);
    state.session.destroy(); assert.ok(state.streams.every(stream => stream.tracks.every(track => track.stopped === 1)));
  });
});

test('blocked, missing and busy cameras show actionable errors; a retry can open video without an upload', async () => {
  for (const [name, phrase] of [['NotAllowedError', /blocked/], ['NotFoundError', /No available camera/], ['NotReadableError', /another app/]]) await fixture(async state => {
    state.plans.push(new DOMException('Synthetic camera error', name)); await state.session.start();
    assert.equal(state.states.at(-1).phase, 'error'); assert.match(state.states.at(-1).message, phrase); assert.match(state.states.at(-1).message, /choose a photo/i);
    assert.equal(state.photos.length, 0); await state.session.start(); assert.equal(state.states.at(-1).phase, 'live');
  });
  for (const settings of [{ noMedia: true }, { insecure: true }]) await fixture(async state => {
    await state.session.start(); assert.equal(state.requests.length, 0); assert.equal(state.states.at(-1).phase, 'error');
    assert.match(state.states.at(-1).message, /choose a photo/i);
  }, settings);
  await fixture(async state => { await state.session.start(); await flush(); assert.equal(state.states.at(-1).phase, 'live'); assert.equal(state.states.at(-1).canSwitch, false); }, { enumerationFailure: true });
});

test('closing during permission or playback releases late streams without reviving a camera or publishing a photo', async () => {
  await fixture(async state => {
    const permission = deferred(); state.plans.push(() => permission.promise);
    const opening = state.session.start(); state.session.destroy();
    const late = state.newStream(); permission.resolve(late); await opening;
    assert.ok(late.tracks.every(track => track.stopped === 1)); assert.equal(state.video.plays, 0);
    assert.deepEqual(state.states.map(value => value.phase), ['requesting', 'closed']); assert.equal(state.photos.length, 0);
  });
  const playback = deferred();
  await fixture(async state => {
    const opening = state.session.start(); await flush(); assert.equal(state.video.plays, 1);
    state.session.destroy(); playback.resolve(); await opening;
    assert.ok(state.streams[0].tracks.every(track => track.stopped === 1)); assert.equal(state.video.srcObject, null);
    assert.deepEqual(state.states.map(value => value.phase), ['requesting', 'closed']);
  }, { playPromise: playback.promise });
  await fixture(async state => {
    const permission = deferred(); state.plans.push(() => permission.promise); const opening = state.session.start();
    state.current = false; const late = state.newStream(); permission.resolve(late); await opening;
    assert.ok(late.tracks.every(track => track.stopped === 1)); assert.equal(state.states.at(-1).phase, 'closed');
  });
});

test('an image finishing encoding after close cannot create a preview or select a stale photo', async () => {
  await fixture(async state => {
    await state.session.start(); const capturing = state.session.capture();
    assert.ok(state.streams[0].tracks.every(track => track.stopped === 1)); state.session.destroy();
    state.canvases[0].complete(new Blob(['late pixels'], { type: 'image/jpeg' })); await capturing;
    assert.equal(state.urls.length, 0); assert.equal(state.photos.length, 0); assert.equal(state.states.at(-1).phase, 'closed');
  }, { deferCapture: true });
});

test('the actual modal supports live preview, capture, Retake and explicit Use photo', async () => {
  await fixture(async state => {
    const root = state.mount(); await flush(); assert.equal(root.open, true); assert.equal(root.dataset.phase, 'live');
    const button = selector => root.querySelector(`[data-camera-${selector}]`);
    assert.equal(button('capture').disabled, false); assert.equal(button('video').hidden, false);
    button('capture').click(); await flush(); assert.equal(root.dataset.phase, 'review'); assert.equal(button('review').hidden, false);
    assert.equal(state.photos.length, 0); assert.equal(button('use').hidden, false);
    button('retake').click(); await flush(); assert.equal(root.dataset.phase, 'live'); assert.deepEqual(state.revoked, ['blob:local-camera-0']);
    button('capture').click(); await flush(); button('use').click();
    assert.equal(root.isConnected, false); assert.equal(state.photos.length, 1); assert.equal(state.closes, 1);
    assert.ok(state.streams.every(stream => stream.tracks.every(track => track.stopped === 1))); assert.equal(state.before.focusCount, 1);
  });
});

test('modal close, Escape, backdrop, navigation and page hiding stop the camera; upload fallback remains explicit', async () => {
  const exits = [
    (state, root) => root.querySelector('[data-camera-close]').click(),
    (state, root) => root.dispatchEvent(new Event('cancel', { cancelable: true })),
    (state, root) => root.dispatchEvent(new Event('click')),
    state => state.window.dispatchEvent(new Event('hashchange')),
    state => state.window.dispatchEvent(new Event('pagehide')),
    state => { state.document.visibilityState = 'hidden'; state.document.dispatchEvent(new Event('visibilitychange')); },
    (state, root) => root.querySelector('[data-camera-choose]').click(),
  ];
  for (const exit of exits) await fixture(async state => {
    const root = state.mount(); await flush(); exit(state, root);
    assert.equal(root.isConnected, false); assert.ok(state.streams[0].tracks.every(track => track.stopped === 1));
    assert.equal(state.photos.length, 0); assert.equal(state.closes, 1);
  });
  await fixture(async state => {
    state.plans.push(new DOMException('Denied', 'NotAllowedError')); const root = state.mount(); await flush();
    assert.equal(root.dataset.phase, 'error'); assert.equal(state.fallbacks, 0);
    root.querySelector('[data-camera-choose]').click(); assert.equal(state.fallbacks, 1); assert.equal(root.isConnected, false);
  });
  await fixture(async state => {
    const permission = deferred(); state.plans.push(() => permission.promise); const root = state.mount();
    state.window.dispatchEvent(new Event('hashchange')); const late = state.newStream(); permission.resolve(late); await flush();
    assert.equal(root.isConnected, false); assert.ok(late.tracks.every(track => track.stopped === 1)); assert.equal(state.photos.length, 0);
  });
});
