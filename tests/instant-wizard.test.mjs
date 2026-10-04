import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setMaxListeners } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const urlOf = source => `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=instant-wizard-fixture.js`).toString('base64')}`;
const wizard = await import(urlOf(compile(await readFile(new URL('../src/instant-wizard.ts', import.meta.url), 'utf8'))));

test('optional stages need no words, but creation requires Photo, Review and consent together', () => {
  assert.equal(wizard.instantWizardDestination('photo', 1, false), 'photo');
  assert.equal(wizard.instantWizardDestination('photo', -1, false), 'photo');
  assert.equal(wizard.instantWizardDestination('photo', 1, true), 'place');
  assert.equal(wizard.instantWizardDestination('place', 1, true), 'story');
  assert.equal(wizard.instantWizardDestination('story', 1, true), 'review');
  assert.equal(wizard.instantWizardDestination('review', 1, true), 'review');
  for (const step of wizard.INSTANT_WIZARD_STEPS) for (const photo of [false, true]) for (const consent of [false, true]) assert.equal(wizard.instantWizardCanCreate(step, photo, consent), step === 'review' && photo && consent);
  for (const intent of ['object', 'place']) assert.ok(wizard.instantDefaultWorldPrompt(intent).length >= 8);
});
test('reviewed voice appends editable words without truncation and only a coded 404 releases uncertain creation', () => {
  assert.deepEqual(wizard.appendInstantTranscript('A memory.  ', '  More words. '), { story: 'A memory.\n\nMore words.', error: '' });
  assert.deepEqual(wizard.appendInstantTranscript('', ' hello '), { story: 'hello', error: '' });
  assert.equal(wizard.appendInstantTranscript('x'.repeat(1197), 'x').story.length, 1200);
  const over = wizard.appendInstantTranscript('x'.repeat(1198), 'x'); assert.equal(over.story.length, 1198); assert.match(over.error, /1,200/);
  assert.deepEqual(wizard.appendInstantTranscript('retain', '  '), { story: 'retain', error: '' });
  assert.equal(wizard.instantJobConfirmedMissing(Object.assign(new Error('No job'), { code: 'JOB_UNAVAILABLE' })), true);
  for (const value of [new Error('404 or JOB_UNAVAILABLE in human text'), { code: 'NETWORK_ERROR' }, null, 'JOB_UNAVAILABLE']) assert.equal(wizard.instantJobConfirmedMissing(value), false);
});

// Exercise the actual creator mount and event handlers. Only the independent
// GPS/curiosity/audio/transformation modules and browser media/DOM are fixtures,
// not the wizard. The transformation's real DOM contract has its own tests.
const modules = new Map();
const stubs = {
  './gift-context': 'export const mountGiftContext=(host,options)=>globalThis.__instantWizard.context(host,options);',
  './gift-curiosities': 'export const mountGiftCuriosities=(host,options)=>globalThis.__instantWizard.curiosities(host,options);',
  './story-audio': 'export const mountStoryAudio=(host,options)=>globalThis.__instantWizard.audio(host,options);',
  './gift-transformation': 'export const mountGiftTransformation=(host,options)=>globalThis.__instantWizard.transformation(host,options);',
};
async function moduleUrl(path) {
  if (modules.has(path.href)) return modules.get(path.href);
  let source = compile(await readFile(path, 'utf8'));
  for (const match of [...source.matchAll(/from\s*(['"])(\.{1,2}\/[^'"]+)\1/g)]) {
    const name = match[2];
    const url = stubs[name] ? urlOf(stubs[name]) : await moduleUrl(new URL(name.endsWith('.ts') ? name : `${name}.ts`, path));
    source = source.replaceAll(`${match[1]}${name}${match[1]}`, JSON.stringify(url));
  }
  const url = urlOf(source); modules.set(path.href, url); return url;
}
const { mountInstantCreator, instantCreatorService } = await import(await moduleUrl(new URL('../src/instant-creator.ts', import.meta.url)));
const flush = async () => { for (let i = 0; i < 5; i++) await setImmediate(); };
const missing = () => Object.assign(new Error('No previous job'), { code: 'JOB_UNAVAILABLE' });
async function fixture(action, settings = {}) {
  const names = ['window', 'document', 'HTMLInputElement', 'HTMLTextAreaElement', 'sessionStorage', 'URL', 'FileReader', 'fetch', 'createImageBitmap', 'matchMedia', '__instantWizard'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const state = { current: true, creates: [], jobs: [], resumes: [], opened: [], focus: [], audioStops: 0, audioDestroyed: 0, fetches: 0, fetchUrls: [], storage: new Map(settings.storage || []), revoked: [], locationRequests: 0, transformations: [], modelVisibility: [], transformationPulses: 0, transformationDestroyed: 0, scheduled: [] };
  class Element extends EventTarget {
    constructor(tag = 'div', attrs = {}) {
      super(); this.tagName = tag; this.attrs = attrs; this.children = []; this.dataset = {}; this.value = attrs.value || ''; this.name = attrs.name || ''; this.type = attrs.type || ''; this.hidden = 'hidden' in attrs; this.disabled = 'disabled' in attrs; this.checked = 'checked' in attrs; this.open = false; this.isConnected = true; this.scrollLeft = 0; this.scrollWidth = 720; this.clientWidth = 350; this.scrollTop = 0; this.validityMessage = ''; this.style = {};
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
      this.classList = { add() {}, remove() {} };
    }
    get className() { return this.attrs.class || ''; } set className(value) { this.attrs.class = value; }
    get src() { return this.attrs.src || ''; } set src(value) { this.attrs.src = value; }
    setAttribute(name, value) { this.attrs[name] = String(value); } getAttribute(name) { return this.attrs[name] ?? null; } removeAttribute(name) { delete this.attrs[name]; }
    addEventListener(type, cb, options) { if (options?.signal) setMaxListeners(0, options.signal); super.addEventListener(type, cb, options); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    set innerHTML(html) {
      this.html = html; this.children = []; const stack = [this], voidTags = new Set(['img', 'input', 'br']);
      for (const token of html.matchAll(/<\/?[A-Za-z][^>]*>/g)) {
        const raw = token[0], tag = /^<\/?([\w-]+)/.exec(raw)[1];
        if (raw.startsWith('</')) { if (!voidTags.has(tag)) { while (stack.length > 1 && stack.at(-1).tagName !== tag) stack.pop(); if (stack.length > 1) stack.pop(); } continue; }
        const attrs = {}; for (const match of raw.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[match[1]] = match[2] ?? '';
        const child = tag === 'input' ? new Input(tag, attrs) : tag === 'textarea' ? new Textarea(tag, attrs) : new Element(tag, attrs); stack.at(-1).append(child); if (!voidTags.has(tag) && !raw.endsWith('/>')) stack.push(child);
      }
    }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    matches(selector) {
      const parts = selector.trim().split(/\s*>\s*|\s+/), own = parts.pop();
      const simple = (element, rule) => {
        const tag = /^[a-z][\w-]*/i.exec(rule)?.[0]; if (tag && element.tagName !== tag) return false;
        for (const [, name] of rule.matchAll(/\.([\w-]+)/g)) if (!element.className.split(' ').includes(name)) return false;
        const id = /#([\w-]+)/.exec(rule)?.[1]; if (id && element.attrs.id !== id) return false;
        for (const [, name, value] of rule.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) if (!(name in element.attrs) || value !== undefined && element.attrs[name] !== value) return false;
        return true;
      };
      if (!simple(this, own)) return false;
      let parent = this.parent;
      while (parts.length) { const rule = parts.pop(); while (parent && !simple(parent, rule)) parent = parent.parent; if (!parent) return false; parent = parent.parent; }
      return true;
    }
    querySelectorAll(selector) { return this.descendants().filter(element => selector.split(',').some(part => element.matches(part))); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get elements() { return { namedItem: name => this.descendants().find(element => element.name === name) || null }; }
    focus() { state.focus.push(this.attrs.id || this.name); }
    scrollIntoView() {} scrollBy({ left }) { this.scrollLeft += left; }
    click() { if (!this.disabled && !this.parents().some(parent => parent.tagName === 'fieldset' && parent.disabled)) this.dispatchEvent(new Event('click')); }
    parents() { const list = []; let parent = this.parent; while (parent) { list.push(parent); parent = parent.parent; } return list; }
    setCustomValidity(message) { this.validityMessage = message; }
    checkValidity() { return !this.validityMessage && (!('required' in this.attrs) || (this.type === 'checkbox' ? this.checked : Boolean(this.value.trim()))) && (!this.attrs.maxlength || this.value.length <= +this.attrs.maxlength); }
    reportValidity() { this.reported = true; if (!this.checkValidity()) this.focus(); return this.checkValidity(); }
  }
  class Input extends Element {} class Textarea extends Element {}
  class Reader { readAsDataURL(file) { file.arrayBuffer().then(bytes => { this.result = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload(); }); } abort() { this.onabort?.(); } }
  const win = new EventTarget(); win.setTimeout = (cb, ms) => { const id = setTimeout(cb, ms); state.scheduled.push({ callback: cb, delay: ms, id }); return id; }; win.clearTimeout = clearTimeout;
  const doc = { createElement: tag => tag === 'canvas' ? { getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob: callback => callback(new Blob(['prepared original'], { type: 'image/jpeg' })) } : new Element(tag) };
  const values = { window: win, document: doc, HTMLInputElement: Input, HTMLTextAreaElement: Textarea, sessionStorage: { getItem: key => state.storage.get(key) || null, setItem: (key, value) => state.storage.set(key, value), removeItem: key => state.storage.delete(key) }, URL: { createObjectURL: file => `blob:${file.name}`, revokeObjectURL: url => state.revoked.push(url) }, FileReader: Reader, fetch: async url => { state.fetches++; state.fetchUrls.push(url); return { ok: true, blob: async () => new Blob([`example source ${url}`], { type: 'image/png' }) }; }, createImageBitmap: async () => ({ width: 100, height: 80, close() {} }), matchMedia: () => ({ matches: true }), __instantWizard: {
    context: (host, options) => { state.contextOptions = options; return { getContext: () => ({ mode: 'off', includeInStory: false }), destroy() {} }; },
    curiosities: (host, options) => { state.curioOptions = options; state.ids = []; return { reset() { options.onDecision(undefined); state.ids = []; }, preset(value) { state.seed = value.story; }, refreshRegion() {}, selectedIds: () => state.ids, destroy() {} }; },
    audio: (host, options) => { state.audioHost = host; state.audioOptions = options; return { stop() { state.audioStops++; }, destroy() { state.audioDestroyed++; } }; },
    transformation: (host, options) => {
      let destroyed = false;
      const modelHost = new Element('div', { class: 'gift-transformation-model', 'data-transform-model': '' });
      modelHost.hidden = false; modelHost.inert = true;
      modelHost.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 350, bottom: 330, width: 350, height: 330 });
      host.append(modelHost); state.modelHost = modelHost;
      return {
        modelHost,
        update(value) { if (!destroyed && options.isCurrent()) state.transformations.push(structuredClone(value)); },
        setModelVisible(value) { if (!destroyed && options.isCurrent()) { modelHost.inert = !value; state.modelVisibility.push(value); } },
        pulse() { if (!destroyed && options.isCurrent()) state.transformationPulses++; },
        destroy() { if (destroyed) return; destroyed = true; state.transformationDestroyed++; host.replaceChildren(); },
      };
    },
  } };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const service = { status: async () => ({ available: true, localOnly: true, generationEnabled: true, providers: { tripo: true, worldlabs: true }, maxImageBytes: 6291456, examples: [] }), create: async input => { state.creates.push(input); if (settings.createError) throw settings.createError; return state.job; }, job: async reference => { state.jobs.push(reference); if (settings.jobHandler) return settings.jobHandler(reference, state); throw missing(); } };
  if (settings.resumeHandler) service.resumeUpload = async (reference, images, signal) => { state.resumes.push({ reference, images, signal }); return settings.resumeHandler(reference, images, signal, state); };
  state.job = { id: 'actual-job', token: 'capability', state: 'completed', assets: { photoUrl: '/photo', modelUrl: '/model', worldUrl: '/world' }, tripo: { state: 'completed' }, worldlabs: { state: 'completed' }, title: 'Gift', story: '', worldPrompt: 'A quiet world', senderName: '', recipientName: '' };
  state.host = new Element(); state.handle = mountInstantCreator(state.host, { isCurrent: () => state.current, onHome() {}, onGiftReady(job) { state.opened.push(job); }, service });
  state.find = selector => { const element = state.host.querySelector(selector); assert.ok(element, `Missing fixture element ${selector}`); return element; };
  state.field = name => state.find('[data-instant-form]').elements.namedItem(name);
  state.edit = (name, value) => { const input = state.field(name); input.value = value; const event = new Event('input'); Object.defineProperty(event, 'target', { value: input }); state.find('[data-instant-form]').dispatchEvent(event); };
  state.submit = () => state.find('[data-instant-form]').dispatchEvent(new Event('submit', { cancelable: true }));
  state.upload = (file, place = false) => { const input = state.find(place ? '[data-instant-place-file]' : '[data-instant-upload-file]'); input.files = [file]; input.dispatchEvent(new Event('change')); };
  state.consent = () => { const input = state.field('consent'); input.checked = true; const event = new Event('input'); Object.defineProperty(event, 'target', { value: input }); state.find('[data-instant-form]').dispatchEvent(event); };
  state.next = () => state.find('[data-instant-continue]').click();
  state.stage = () => state.host.dataset.instantStep;
  state.activeCards = () => state.host.querySelectorAll('[data-instant-step]').filter(card => !card.hidden);
  try { await flush(); await action(state); }
  finally { state.handle.destroy(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
}

test('actual wizard keeps one card active; selecting a photo stays put; Enter reaches Review without generation', async () => {
  await fixture(async state => {
    assert.equal(state.stage(), 'photo'); assert.equal(state.activeCards().length, 1); state.submit(); assert.equal(state.creates.length, 0);
    assert.equal(state.contextOptions.presentation, 'step'); assert.equal(state.locationRequests, 0);
    state.upload(new File(['pixels'], 'my photo.jpg', { type: 'image/jpeg' }));
    assert.equal(state.stage(), 'photo'); assert.ok(state.field('worldPrompt').value.length > 8); assert.equal(state.fetches, 0);
    state.next(); assert.equal(state.stage(), 'place'); assert.equal(state.activeCards().length, 1); assert.equal(state.focus.at(-1), 'instant-world-heading');
    state.submit(); assert.equal(state.stage(), 'story'); assert.equal(state.audioOptions.isCurrent(), true);
    state.edit('story', 'Our own memory.'); state.next(); assert.equal(state.stage(), 'review'); assert.equal(state.audioOptions.isCurrent(), false);
    assert.equal(state.find('[data-instant-review-story]').textContent, 'Our own memory.'); state.submit(); await flush(); assert.equal(state.creates.length, 0);
    state.consent(); assert.equal(state.field('consent').checked, true); state.submit(); state.submit(); await flush();
    assert.equal(state.creates.length, 1); assert.equal(state.creates[0].story, 'Our own memory.'); assert.equal(state.creates[0].consent, true); assert.equal(state.creates[0].imageDataUrl, 'data:image/jpeg;base64,cHJlcGFyZWQgb3JpZ2luYWw=');
    assert.equal(state.find('[data-instant-form]').hidden, true); assert.equal(state.find('[data-instant-progress]').hidden, false);
  });
});

test('Back and edit links preserve words; catalog defaults replace defaults while personalized words survive source changes', async () => {
  await fixture(async state => {
    state.find('[data-instant-example="antikythera"]').click(); const firstStory = state.field('story').value;
    state.next(); state.next(); state.curioOptions.onStory(state.seed); assert.equal(state.field('story').value, firstStory);
    state.edit('story', 'Our handwritten story.'); state.edit('title', '<img src=x onerror=alert(1)>'); state.edit('worldPrompt', 'Our quiet garden.');
    state.next(); assert.equal(state.find('[data-instant-review-title]').textContent, '<img src=x onerror=alert(1)>');
    state.find('[data-instant-edit-step="photo"]').click(); state.find('[data-instant-example="astrolabe"]').click();
    assert.equal(state.field('story').value, 'Our handwritten story.'); assert.equal(state.field('worldPrompt').value, 'Our quiet garden.');
    state.upload(new File(['our photo'], 'new.jpg', { type: 'image/jpeg' })); assert.equal(state.field('story').value, 'Our handwritten story.'); assert.equal(state.field('title').value, '<img src=x onerror=alert(1)>');
    state.next(); state.next(); state.next(); state.consent(); state.find('[data-instant-step-back]').click();
    assert.equal(state.field('story').value, 'Our handwritten story.'); assert.equal(state.audioOptions.onTranscript('Spoken addition.'), true); assert.equal(state.field('story').value, 'Our handwritten story.\n\nSpoken addition.'); assert.equal(state.field('consent').checked, false);
    state.edit('story', 'x'.repeat(1199)); assert.equal(state.audioOptions.onTranscript('too much'), false); assert.equal(state.field('story').value.length, 1199); assert.match(state.find('[data-instant-error]').textContent, /1,200/);
    state.next(); const words = state.field('story').value; assert.equal(state.audioOptions.onTranscript('late'), false); assert.equal(state.field('story').value, words);
    state.handle.destroy(); assert.equal(state.audioDestroyed, 1); assert.ok(state.audioStops >= 7);
  });
  await fixture(async state => {
    state.find('[data-instant-example="antikythera"]').click(); assert.ok(state.field('story').value);
    state.upload(new File(['fresh'], 'fresh.jpg', { type: 'image/jpeg' })); assert.equal(state.field('story').value, ''); assert.equal(state.field('title').value, 'A little world for you'); assert.equal(state.field('worldPrompt').value, wizard.instantDefaultWorldPrompt('object'));
  });
});

test('a fresh place WebP becomes a metadata-free JPEG original without a fabricated frame or preexisting miniature', async () => {
  await fixture(async state => {
    state.find('[data-instant-intent="place"]').click(); state.upload(new File(['place pixels'], 'garden.webp', { type: 'image/webp' }));
    state.next(); state.next(); state.next();
    assert.equal(state.find('[data-instant-review-miniature]').hidden, true); assert.match(state.find('[data-instant-review-representation]').textContent, /inspires a small 3D souvenir/);
    state.consent(); state.submit(); await flush();
    assert.equal(state.creates.length, 1); const submitted = state.creates[0];
    assert.equal(submitted.photoIntent, 'place'); assert.equal(submitted.imageDataUrl, 'data:image/jpeg;base64,cHJlcGFyZWQgb3JpZ2luYWw=');
    assert.equal(submitted.objectImageDataUrl, undefined); assert.equal(submitted.objectImageRole, undefined); assert.equal(submitted.worldImageDataUrl, undefined);
    assert.equal(state.fetches, 0);
  });
});

test('city Review shows a distinct curated miniature reference and submits its approved PNG bytes without reframing the original', async () => {
  await fixture(async state => {
    state.find('[data-instant-intent="place"]').click(); state.find('[data-instant-example="kyoto"]').click(); state.next(); state.next(); state.next();
    assert.equal(state.find('[data-instant-review-photo]').src, '/assets/examples/v13/kyoto.jpg');
    assert.equal(state.find('[data-instant-review-miniature]').src, '/assets/examples/v17/kyoto-souvenir-reference.png'); assert.equal(state.find('[data-instant-review-miniature]').hidden, false);
    assert.match(state.find('[data-instant-review-representation]').textContent, /reference guides/); state.consent(); state.submit(); await flush();
    assert.equal(state.creates.length, 1); const submitted = state.creates[0];
    assert.equal(submitted.objectImageRole, 'miniature-reference'); assert.notEqual(submitted.imageDataUrl, submitted.objectImageDataUrl);
    assert.equal(Buffer.from(submitted.imageDataUrl.split(',')[1], 'base64').toString(), 'example source /assets/examples/v13/kyoto.jpg');
    assert.equal(Buffer.from(submitted.objectImageDataUrl.split(',')[1], 'base64').toString(), 'example source /assets/examples/v17/kyoto-souvenir-reference.png');
    assert.equal(submitted.worldImageDataUrl, undefined); assert.deepEqual(state.fetchUrls, ['/assets/examples/v13/kyoto.jpg', '/assets/examples/v17/kyoto-souvenir-reference.png']);
  });
});

test('Review exposes the effective persistent place photo and validation reveals a hidden invalid field before preparation', async () => {
  await fixture(async state => {
    state.upload(new File(['object'], 'gift.jpg', { type: 'image/jpeg' })); state.next();
    state.upload(new File(['place'], 'our place.png', { type: 'image/png' }), true); state.next(); state.next();
    assert.equal(state.find('[data-instant-review-place-photo]').src, 'blob:our place.png'); assert.match(state.find('[data-instant-review-place-name]').textContent, /our place.png/);
    state.edit('title', '   '); state.consent(); state.submit(); assert.equal(state.stage(), 'story'); assert.equal(state.find('.instant-personal').open, true); assert.equal(state.field('title').reported, true); assert.equal(state.fetches, 0); assert.equal(state.creates.length, 0);
    state.edit('title', 'Gift'); state.next(); state.edit('worldPrompt', 'Rio'); state.consent(); state.submit(); assert.equal(state.stage(), 'place'); assert.equal(state.find('.instant-place-custom').open, true); assert.equal(state.field('worldPrompt').reported, true); assert.equal(state.creates.length, 0);
    state.edit('worldPrompt', ''); state.next(); assert.equal(state.stage(), 'story'); assert.equal(state.field('worldPrompt').value, wizard.instantDefaultWorldPrompt('object'));
    state.find('[data-instant-step-back]').click(); state.find('[data-instant-place-remove]').click(); state.next(); state.next(); assert.equal(state.find('[data-instant-review-reference]').hidden, true); assert.ok(state.revoked.includes('blob:our place.png'));
  });
});

test('lost POST plus unavailable recovery locks editing and preserves capability; a GET resumes without another paid create', async () => {
  await fixture(async state => {
    state.upload(new File(['object'], 'gift.jpg', { type: 'image/jpeg' })); state.next(); state.next(); state.next(); state.consent(); state.submit(); await flush();
    assert.equal(state.creates.length, 1); assert.equal(state.jobs.length, 1); const pending = state.storage.get('giftportals.instant.pending.v1'); assert.ok(pending); assert.equal(state.find('[data-instant-inputs]').disabled, true);
    state.next(); state.find('[data-instant-step-back]').click(); state.submit(); state.edit('story', 'synthetic event despite disabled field'); assert.equal(state.storage.get('giftportals.instant.pending.v1'), pending); assert.equal(state.stage(), 'review'); assert.equal(state.creates.length, 1);
    state.readyToRecover = true; state.find('[data-instant-recover]').click(); await flush(); assert.equal(state.creates.length, 1); assert.equal(state.jobs.length, 2); assert.equal(state.find('[data-instant-progress]').hidden, false); assert.equal(state.storage.has('giftportals.instant.pending.v1'), false);
    assert.equal(state.jobs[0].dedupeKey, state.creates[0].dedupeKey); assert.equal(state.jobs[0].token, state.creates[0].requestToken);
  }, { createError: new TypeError('Connection lost'), jobHandler: (reference, state) => state.readyToRecover ? state.job : Promise.reject(new TypeError('Connection lost')) });
});

test('refresh holds unresolved pending creation; confirmed missing job restores Photo and never starts a generation', async () => {
  const pending = JSON.stringify({ dedupeKey: 'gift-existing', requestToken: 'x'.repeat(43) });
  await fixture(async state => {
    assert.equal(state.stage(), 'review'); assert.equal(state.find('[data-instant-inputs]').disabled, true); assert.match(state.find('#instant-review-heading').textContent, /last gift/); assert.equal(state.find('[data-instant-review-photo]').parents()[0].hidden, true);
    state.missingConfirmed = true; state.find('[data-instant-recover]').click(); await flush(); assert.equal(state.stage(), 'photo'); assert.equal(state.find('[data-instant-inputs]').disabled, false); assert.equal(state.creates.length, 0); assert.equal(state.storage.has('giftportals.instant.pending.v1'), false);
  }, { storage: [['giftportals.instant.pending.v1', pending]], jobHandler: (reference, state) => Promise.reject(state.missingConfirmed ? missing() : new TypeError('Network unavailable')) });
});

test('reload of an interrupted cloud PUT exposes only missing photo inputs and stops generation polling', async () => {
  const reference = { id: 'saved-upload-job', token: 'x'.repeat(43) };
  await fixture(async state => {
    assert.equal(state.creates.length, 0); assert.equal(state.jobs.length, 1);
    assert.equal(state.find('[data-instant-form]').hidden, true);
    assert.equal(state.find('[data-instant-upload-recovery]').hidden, false);
    assert.equal(state.find('[data-instant-resume-field="original"]').hidden, true);
    assert.equal(state.find('[data-instant-resume-field="object"]').hidden, true);
    assert.equal(state.find('[data-instant-resume-field="world"]').hidden, false);
    assert.equal(state.find('[data-instant-provider-progress]').hidden, true);
    assert.equal(state.find('[data-instant-open]').hidden, true); assert.equal(state.find('[data-instant-edit]').hidden, true);
    assert.match(state.find('#instant-progress-heading').textContent, /Finish uploading/);
    assert.deepEqual(state.scheduled, [], 'No provider poll runs while photos are missing');
    const file = new File(['the exact place photo'], 'place.png', { type: 'image/png' });
    state.find('[data-instant-resume-file="world"]').files = [file];
    state.find('[data-instant-resume-upload]').click(); state.find('[data-instant-resume-upload]').click(); await flush();
    assert.equal(state.resumes.length, 1); assert.deepEqual(state.resumes[0].reference, reference);
    assert.deepEqual(state.resumes[0].images, { world: 'data:image/png;base64,' + Buffer.from('the exact place photo').toString('base64') });
    assert.equal(state.creates.length, 0); assert.equal(state.find('[data-instant-upload-recovery]').hidden, true);
    assert.equal(state.find('[data-instant-open]').hidden, false);
    state.find('[data-instant-open]').click(); assert.equal(state.opened.length, 1); assert.equal(state.opened[0].id, reference.id); assert.equal(state.opened[0].token, reference.token);
    assert.deepEqual(JSON.parse(state.storage.get('giftportals.instant.job.v1')), reference);
    assert.ok([...state.storage.values()].every(value => !value.includes('base64') && !value.includes('the exact place photo')), 'Photos never enter browser storage');
  }, {
    storage: [['giftportals.instant.job.v1', JSON.stringify(reference)]],
    jobHandler: (_reference, state) => ({ ...state.job, ...reference, state: 'processing', uploadState: 'pending', tripo: { state: 'pending' }, worldlabs: { state: 'pending' }, assets: { photoUrl: '' }, uploads: [{ id: 'world', mime: 'image/png' }] }),
    resumeHandler: (_reference, _images, _signal, state) => ({ ...state.job, ...reference, uploadState: 'finalized' }),
  });
});

test('resume failure keeps the existing draft locked and retries the same reference without new creation', async () => {
  const reference = { id: 'saved-upload-job', token: 'x'.repeat(43) };
  await fixture(async state => {
    state.find('[data-instant-resume-upload]').click(); await flush();
    assert.equal(state.find('[data-instant-upload-error]').hidden, false); assert.match(state.find('[data-instant-upload-error]').textContent, /same photo/);
    assert.equal(state.find('[data-instant-resume-upload]').disabled, false);
    assert.equal(state.find('[data-instant-edit]').hidden, true); assert.equal(state.creates.length, 0); assert.deepEqual(state.scheduled, []);
    state.reselected = true; state.find('[data-instant-resume-file="original"]').files = [new File(['source'], 'source.webp', { type: 'image/webp' })];
    state.find('[data-instant-resume-upload]').click(); await flush();
    assert.equal(state.resumes.length, 2); assert.deepEqual(state.resumes[1].reference, reference);
    const candidates = state.resumes[1].images.original;
    assert.deepEqual(candidates, ['data:image/webp;base64,c291cmNl', 'data:image/jpeg;base64,cHJlcGFyZWQgb3JpZ2luYWw=']);
    assert.equal(state.find('[data-instant-upload-recovery]').hidden, true); assert.equal(state.scheduled.length, 1);
  }, {
    storage: [['giftportals.instant.job.v1', JSON.stringify(reference)]],
    jobHandler: (_reference, state) => ({ ...state.job, ...reference, state: 'processing', uploadState: 'pending', tripo: { state: 'pending' }, worldlabs: { state: 'pending' }, assets: { photoUrl: '' }, uploads: [{ id: 'original', mime: 'image/jpeg' }] }),
    resumeHandler: (_reference, _images, _signal, state) => state.reselected ? { ...state.job, ...reference, state: 'processing', uploadState: 'finalized', tripo: { state: 'pending' }, worldlabs: { state: 'pending' }, assets: { photoUrl: '' } } : Promise.reject(new Error('Choose the same photo used for this gift.')),
  });
});

test('closing an uploading recovery aborts it and ignores a late completed reply', async () => {
  let resolve;
  const reference = { id: 'saved-upload-job', token: 'x'.repeat(43) };
  await fixture(async state => {
    state.find('[data-instant-resume-upload]').click(); await flush(); assert.equal(state.resumes.length, 1);
    state.handle.destroy(); assert.equal(state.resumes[0].signal.aborted, true);
    resolve({ ...state.job, ...reference, uploadState: 'finalized' }); await flush();
    assert.equal(state.host.children.length, 0); assert.equal(state.opened.length, 0); assert.deepEqual(state.scheduled, []);
    assert.equal(state.creates.length, 0); assert.deepEqual(JSON.parse(state.storage.get('giftportals.instant.job.v1')), reference);
  }, {
    storage: [['giftportals.instant.job.v1', JSON.stringify(reference)]],
    jobHandler: (_reference, state) => ({ ...state.job, ...reference, state: 'processing', uploadState: 'pending', assets: { photoUrl: '' }, tripo: { state: 'pending' }, worldlabs: { state: 'pending' }, uploads: [{ id: 'original', mime: 'image/png' }] }),
    resumeHandler: () => new Promise(done => { resolve = done; }),
  });
});

test('restoring an ambiguous souvenir preserves interruption while only the backend world is still processing', async () => {
  const reference = { id: 'restored-interrupted-job', token: 'x'.repeat(43) };
  await fixture(async state => {
    assert.equal(state.jobs.length, 1); assert.equal(state.creates.length, 0);
    assert.equal(state.find('[data-instant-form]').hidden, true); assert.equal(state.find('[data-instant-progress]').hidden, false);
    assert.equal(state.find('[data-instant-progress]').dataset.jobState, 'processing');
    assert.equal(state.find('[data-instant-tripo-label]').textContent, 'We couldn’t confirm your souvenir.');
    assert.equal(state.find('[data-instant-worldlabs-label]').textContent, 'Building the place inside…');
    assert.equal(state.find('[data-instant-job-status]').textContent, 'The keepsake needs attention. Your little world is still being created.');
    assert.equal(state.find('[data-instant-model-preview]').hidden, true); assert.equal(state.find('[data-instant-open]').hidden, true);
    assert.equal(state.find('[data-instant-edit]').hidden, true, 'An active world does not unlock another creation');
    assert.deepEqual(state.transformations.map(value => [value.jobId, value.phase, value.modelReady]), [[reference.id, 'interrupted', false]]);
    assert.deepEqual(state.scheduled.map(value => value.delay), [4000], 'Only a backend poll is scheduled, with no cosmetic phase clock');

    state.submit(); assert.equal(state.creates.length, 0);
    state.scheduled[0].callback(); await flush();
    assert.equal(state.jobs.length, 2); assert.equal(state.creates.length, 0);
    assert.ok(state.transformations.every(value => value.jobId === reference.id && value.phase === 'interrupted' && !value.modelReady));
    assert.equal(state.transformationPulses, 0); assert.deepEqual(state.modelVisibility, []);
    assert.equal(JSON.parse(state.storage.get('giftportals.instant.job.v1')).id, reference.id);

    const lastPoll = state.scheduled.at(-1), updates = state.transformations.length;
    state.handle.destroy(); lastPoll.callback(); await flush();
    assert.equal(state.jobs.length, 2); assert.equal(state.transformations.length, updates); assert.equal(state.transformationDestroyed, 1);
  }, {
    storage: [['giftportals.instant.job.v1', JSON.stringify(reference)]],
    jobHandler: (restored, state) => ({ ...state.job, id: restored.id, token: restored.token, state: 'processing', assets: { photoUrl: '/synthetic/stored-original.png' }, tripoReference: { state: 'failed', errorCode: 'SUBMISSION_AMBIGUOUS' }, tripo: { state: 'failed', errorCode: 'SUBMISSION_AMBIGUOUS' }, worldlabs: { state: 'processing' } }),
  });
});

test('actual service preserves the missing-job code while network uncertainty remains distinct', async () => {
  await fixture(async state => {
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ ok: false, error: { code: 'JOB_UNAVAILABLE', message: 'No job found.' } }) });
    await assert.rejects(instantCreatorService.job({ dedupeKey: 'gift-existing', token: 'x'.repeat(43) }, new AbortController().signal), error => wizard.instantJobConfirmedMissing(error));
    globalThis.fetch = async () => { throw new TypeError('Network unavailable'); };
    await assert.rejects(instantCreatorService.job({ dedupeKey: 'gift-existing', token: 'x'.repeat(43) }, new AbortController().signal), error => !wizard.instantJobConfirmedMissing(error) && /Could not reach/.test(error.message));
    assert.equal(state.creates.length, 0);
  });
});

test('late optional facts refresh Review after selection mutation and revoke earlier consent; Remove clears the effective reference', async () => {
  await fixture(async state => {
    state.upload(new File(['object'], 'gift.jpg', { type: 'image/jpeg' })); state.next(); state.upload(new File(['place'], 'world.jpg', { type: 'image/jpeg' }), true); state.next(); state.next();
    state.ids = ['rio-gardens']; state.curioOptions.onChange(); await flush(); assert.equal(state.find('[data-instant-review-curiosities]').children.length, 1); state.consent();
    state.curioOptions.onDecision('allow'); state.ids = []; await flush(); assert.equal(state.find('[data-instant-review-curiosities]').hidden, true); assert.equal(state.field('consent').checked, false);
    state.find('[data-instant-review-place-remove]').click(); assert.equal(state.find('[data-instant-review-reference]').hidden, true); assert.equal(state.find('[data-instant-place-selected]').hidden, true); assert.equal(state.stage(), 'review');
    state.consent(); state.submit(); await flush(); assert.equal(state.creates.length, 1); assert.deepEqual(state.creates[0].curiosityIds, []); assert.equal(state.creates[0].worldImageDataUrl, undefined);
  });
});
