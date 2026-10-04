import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const input = await readFile(new URL('../src/story-reader.ts', import.meta.url), 'utf8');
const source = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/import\s*['"][^'"]+\.css['"];?\s*/g, '');
const { mountStoryReader, storyReaderSourceUrl } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const chapter = (changes = {}) => ({ mode: 'book', title: 'The sky we remember', body: 'An evening shared by the water.', eyebrow: 'Personal story', worldTitle: 'A world of human curiosity', index: 0, count: 3, ...changes });

function fixture(action, changes = {}) {
  const globals = ['document', 'fetch', 'setTimeout', 'setInterval', 'requestAnimationFrame'];
  const previous = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const state = { current: true, elements: [], closed: 0, previous: 0, next: 0, playback: 0, external: 0 };
  class Element extends EventTarget {
    children = []; attributes = new Map(); dataset = {}; className = ''; hidden = false; disabled = false; isConnected = true; scrollTop = 0; parent = null; content = ''; focused = 0;
    constructor(tag) { super(); this.tagName = tag.toUpperCase(); state.elements.push(this); }
    classList = { add: name => { this.className += (this.className ? ' ' : '') + name; } };
    set textContent(value) { this.content = String(value); this.children = []; }
    get textContent() { return this.content + this.children.map(node => node.textContent || '').join(''); }
    set innerHTML(_value) { throw Error('Story content must never enter HTML markup'); }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.content = ''; this.append(...nodes); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    querySelector(selector) { for (const child of this.children) { if (child.tagName?.toLowerCase() === selector) return child; const found = child.querySelector?.(selector); if (found) return found; } return null; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; this.isConnected = false; }
    focus(settings) { this.focused++; this.focusSettings = settings; }
    click() { this.dispatchEvent(new Event('click')); }
  }
  const document = { createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), createTextNode: text => ({ textContent: text }) };
  const external = () => { state.external++; throw Error('Readers must never schedule tour motion or call providers'); };
  for (const [name, value] of Object.entries({ document, fetch: external, setTimeout: external, setInterval: external, requestAnimationFrame: external })) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  state.host = new Element('div');
  const preserved = new Element('canvas'); state.host.append(preserved); state.preserved = preserved;
  state.handle = mountStoryReader(state.host, { isCurrent: () => state.current, onClose: () => state.closed++, onPrevious: () => state.previous++, onNext: () => state.next++, onTogglePlayback: () => state.playback++, ...changes });
  state.find = className => state.elements.find(node => node.className === className);
  state.root = state.find('story-reader');
  try { action(state); assert.equal(state.external, 0); }
  finally { state.handle.destroy(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
}

test('book, newspaper and tablet remain real reading objects while preserving story text and primary-source semantics', () => fixture(state => {
  const title = state.find('story-reader-title'), body = state.find('story-reader-body'), eyebrow = state.find('story-reader-eyebrow'), source = state.find('story-reader-source');
  for (const [mode, label] of [['book', 'Travel journal'], ['newspaper', 'The Gift Gazette'], ['tablet', 'Field notes']]) {
    state.handle.update(chapter({ mode, index: 1, sourceUrl: 'https://example.com/reviewed-history', sourceTitle: 'Museum collection' }));
    assert.equal(state.root.dataset.mode, mode); assert.equal(state.find('story-reader-object-label-text').textContent, label);
    assert.equal(title.textContent, 'The sky we remember'); assert.equal(body.textContent, 'An evening shared by the water.'); assert.equal(eyebrow.textContent, 'Personal story');
    assert.equal(source.hidden, false); assert.equal(source.getAttribute('href'), 'https://example.com/reviewed-history'); assert.equal(source.textContent, 'Museum collection');
    assert.equal(source.target, '_blank'); assert.equal(source.rel, 'noopener noreferrer'); assert.equal(source.referrerPolicy, 'no-referrer');
    assert.equal(state.find('story-reader-counter').textContent, '2 / 3'); assert.match(state.root.getAttribute('aria-label'), /chapter 2 of 3/);
    assert.equal(title.getAttribute('data-story-reader-title'), ''); assert.equal(body.getAttribute('data-story-reader-body'), ''); assert.equal(eyebrow.getAttribute('data-story-reader-eyebrow'), ''); assert.equal(source.getAttribute('data-story-reader-source'), '');
    assert.equal(state.find('story-reader-title'), title); assert.equal(state.find('story-reader-body'), body);
  }
}));

test('untrusted story text stays literal, long stories remain intact, and source protocols and credentials never execute', () => fixture(state => {
  const text = '<script>fetch("https://evil.invalid")</script>\n' + 'A long personal memory. '.repeat(1000);
  state.handle.update(chapter({ title: '<img src=x onerror=alert(1)>', body: text, eyebrow: '<b>Personal</b>', note: '<iframe src=x>', worldTitle: '<svg/onload=alert(1)>' }));
  assert.equal(state.find('story-reader-title').textContent, '<img src=x onerror=alert(1)>'); assert.equal(state.find('story-reader-body').textContent, text);
  assert.equal(state.find('story-reader-eyebrow').textContent, '<b>Personal</b>'); assert.equal(state.find('story-reader-note').textContent, '<iframe src=x>'); assert.equal(state.find('story-reader-world').textContent, '<svg/onload=alert(1)>');
  assert.equal(state.elements.some(node => ['IMG', 'SCRIPT', 'IFRAME'].includes(node.tagName)), false);
  for (const sourceUrl of ['javascript:alert(1)', 'data:text/html,<script>', 'http://example.com/history', 'https://user:secret@example.com/', 'https://example.com:8443/', '/history', '<a href=x>', undefined]) {
    assert.equal(storyReaderSourceUrl(sourceUrl), ''); state.handle.update(chapter({ sourceUrl })); assert.equal(state.find('story-reader-source').hidden, true); assert.equal(state.find('story-reader-source').getAttribute('href'), null);
  }
  assert.equal(storyReaderSourceUrl('https://museum.example/a?q=history#story'), 'https://museum.example/a?q=history#story');
  state.handle.update(chapter({ sourceUrl: 'https://museum.example/a' })); assert.equal(state.find('story-reader-source-label').textContent, 'Read the primary source');
}));

test('chapter controls obey boundaries and playback actions exist only for current tour states', () => fixture(state => {
  const previous = state.find('story-reader-previous'), next = state.find('story-reader-next'), playback = state.find('story-reader-playback'), close = state.find('story-reader-close');
  state.handle.update(chapter({ playback: 'playing', closeLabel: 'Exit tour' }));
  assert.equal(previous.disabled, true); previous.click(); assert.equal(state.previous, 0); next.click(); assert.equal(state.next, 1);
  assert.equal(playback.hidden, false); assert.equal(playback.getAttribute('aria-label'), 'Pause tour'); playback.click(); assert.equal(state.playback, 1);
  assert.equal(close.getAttribute('aria-label'), 'Exit tour'); close.click(); assert.equal(state.closed, 1);
  state.handle.update(chapter({ index: 2, playback: 'paused' })); assert.equal(next.disabled, true); next.click(); assert.equal(state.next, 1); previous.click(); assert.equal(state.previous, 1);
  assert.equal(playback.getAttribute('aria-label'), 'Resume tour'); playback.click(); assert.equal(state.playback, 2);
  for (const value of ['completed', 'still', undefined]) { state.handle.update(chapter({ playback: value })); assert.equal(playback.hidden, true); playback.click(); assert.equal(state.playback, 2); }
  state.handle.update(chapter({ index: NaN, count: Infinity })); assert.equal(state.find('story-reader-counter').textContent, '1 / 1'); assert.equal(previous.disabled, true); assert.equal(next.disabled, true);
  state.handle.update(chapter({ index: -10, count: 100000 })); assert.equal(state.find('story-reader-counter').textContent, '1 / 1000');
  state.handle.update(chapter({ index: 90, count: 3, mode: 'unexpected' })); assert.equal(state.root.dataset.mode, 'book'); assert.equal(state.find('story-reader-counter').textContent, '3 / 3');
}));

test('ordinary playback updates preserve reading position; a new chapter resets it without a timing loop', () => fixture(state => {
  state.handle.update(chapter({ playback: 'paused' })); const content = state.find('story-reader-content'), turn = state.root.dataset.turn;
  content.scrollTop = 120; state.handle.update(chapter({ playback: 'playing', note: 'A journey you can pause.' })); assert.equal(content.scrollTop, 120); assert.equal(state.root.dataset.turn, turn);
  state.handle.update(chapter({ index: 1, title: 'A second memory' })); assert.equal(content.scrollTop, 0); assert.notEqual(state.root.dataset.turn, turn);
  state.handle.focus(); assert.equal(state.find('story-reader-title').focused, 1); assert.deepEqual(state.find('story-reader-title').focusSettings, { preventScroll: true });
  assert.equal(content.tabIndex, 0); assert.equal(content.getAttribute('aria-label'), 'Read this chapter');
}));

test('Escape closes the reading object; stale and destroyed routes release listeners while preserving the owning renderer', () => fixture(state => {
  state.handle.update(chapter({ playback: 'playing', sourceUrl: 'https://example.com/history' }));
  const escape = new Event('keydown', { cancelable: true, bubbles: true }); Object.defineProperty(escape, 'key', { value: 'Escape' }); state.root.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true); assert.equal(state.closed, 1);
  state.current = false; state.handle.update(chapter({ title: 'stale title' })); state.handle.focus(); state.find('story-reader-next').click(); state.find('story-reader-close').click(); state.find('story-reader-playback').click();
  assert.equal(state.find('story-reader-title').textContent, 'The sky we remember'); assert.equal(state.find('story-reader-title').focused, 0); assert.equal(state.closed, 1); assert.equal(state.next, 0); assert.equal(state.playback, 0);
  state.handle.destroy(); state.handle.destroy(); assert.deepEqual(state.host.children, [state.preserved]); assert.equal(state.find('story-reader-source').getAttribute('href'), null);
  state.current = true; state.root.dispatchEvent(escape); state.find('story-reader-close').click(); state.find('story-reader-next').click(); state.handle.update(chapter()); state.handle.focus(); assert.equal(state.closed, 1); assert.equal(state.next, 0); assert.deepEqual(state.host.children, [state.preserved]);
}));

test('unavailable navigation stays hidden, while all display modes respect reduced motion and bounded scrolling', async () => {
  fixture(state => {
    state.handle.update(chapter({ playback: 'playing' })); assert.equal(state.find('story-reader-previous').hidden, true); assert.equal(state.find('story-reader-next').hidden, true); assert.equal(state.find('story-reader-playback').hidden, true);
    state.find('story-reader-next').click(); state.find('story-reader-playback').click(); assert.equal(state.next, 0); assert.equal(state.playback, 0);
  }, { onPrevious: undefined, onNext: undefined, onTogglePlayback: undefined });
  const css = await readFile(new URL('../src/story-reader.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion:\s*reduce/); assert.match(css, /animation:\s*none/); assert.match(css, /overflow-y:\s*auto/); assert.match(css, /overscroll-behavior:\s*contain/); assert.match(css, /min-height:\s*44px/); assert.match(css, /52dvh/);
});
