import './story-reader.css';

export type StoryReaderMode = 'book' | 'newspaper' | 'tablet';
export interface StoryReaderData {
  mode: StoryReaderMode;
  title: string;
  body: string;
  eyebrow?: string;
  worldTitle?: string;
  /** The selected chapter, zero based. */
  index: number;
  count: number;
  sourceTitle?: string;
  /** A reviewed primary source supplied by the owning gift controller. */
  sourceUrl?: string;
  note?: string;
  playback?: 'playing' | 'paused' | 'completed' | 'still';
  closeLabel?: string;
}
export interface StoryReaderOptions {
  isCurrent(): boolean;
  onClose(): void;
  onPrevious?(): void;
  onNext?(): void;
  onTogglePlayback?(): void;
}
export interface StoryReaderHandle {
  update(data: StoryReaderData): void;
  focus(): void;
  destroy(): void;
}

const svgNS = 'http://www.w3.org/2000/svg';
const value = (input: unknown) => typeof input === 'string' ? input : '';
const paths = {
  close: ['m6 6 12 12M18 6 6 18'],
  previous: ['m14 6-6 6 6 6M8 12h13'],
  next: ['m10 6 6 6-6 6M3 12h13'],
  pause: ['M8 5v14M16 5v14'],
  play: ['m8 5 11 7-11 7V5Z'],
  book: ['M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15'],
  newspaper: ['M5 4h15v16H5c-2 0-3-1-3-3V8h3m0-4v13M8 8h9M8 12h4M8 16h4M15 12h2v4h-2Z'],
  tablet: ['M6 3h12c1 0 2 1 2 2v14c0 1-1 2-2 2H6c-1 0-2-1-2-2V5c0-1 1-2 2-2ZM11 18h2'],
  external: ['M13 4h7v7M20 4l-9 9M10 4H4v16h16v-6'],
} as const;
function icon(name: keyof typeof paths): SVGSVGElement {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  for (const d of paths[name]) { const path = document.createElementNS(svgNS, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}

/** Protocol safety only. The parent still owns fact and source approval. */
export function storyReaderSourceUrl(input: unknown): string {
  if (typeof input !== 'string') return '';
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.href : '';
  } catch { return ''; }
}

/** A physical reading object at a camera stop. No camera, generation or tour clock. */
export function mountStoryReader(host: HTMLElement, options: StoryReaderOptions): StoryReaderHandle {
  let dead = false, currentIndex = 0, currentCount = 1, turn = false, contentKey = '';
  let playback: StoryReaderData['playback'];
  const listeners: Array<() => void> = [];
  const active = () => !dead && options.isCurrent() && host.isConnected;
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
    const node = document.createElement(tag); node.className = className; return node;
  };
  const listen = (node: EventTarget, type: string, callback: EventListener) => {
    node.addEventListener(type, callback); listeners.push(() => node.removeEventListener(type, callback));
  };
  const button = (className: string, name: keyof typeof paths, label: string) => {
    const node = element('button', className); node.type = 'button'; node.setAttribute('aria-label', label);
    const caption = element('span', `${className}-label`); caption.textContent = label; node.append(icon(name), caption); return node;
  };

  const root = element('section', 'story-reader'); root.dataset.mode = 'book'; root.setAttribute('aria-label', 'Story reading object');
  const object = element('div', 'story-reader-object');
  const cover = element('div', 'story-reader-cover'); cover.setAttribute('aria-hidden', 'true');
  const seam = element('span', 'story-reader-seam'); seam.setAttribute('aria-hidden', 'true');
  const side = element('aside', 'story-reader-side'); side.setAttribute('aria-hidden', 'true');
  const imprint = element('span', 'story-reader-imprint'); imprint.textContent = 'A LITTLE WORLD';
  const ornament = document.createElementNS(svgNS, 'svg'); ornament.setAttribute('viewBox', '0 0 120 120'); ornament.classList.add('story-reader-ornament');
  for (const radius of [46, 36, 12]) { const circle = document.createElementNS(svgNS, 'circle'); circle.setAttribute('cx', '60'); circle.setAttribute('cy', '60'); circle.setAttribute('r', String(radius)); ornament.append(circle); }
  for (const d of ['M60 7v106M7 60h106M22 22l76 76M22 98l76-76', 'm60 27 8 25 25 8-25 8-8 25-8-25-25-8 25-8 8-25Z', 'M25 101c17 10 53 10 70 0']) { const path = document.createElementNS(svgNS, 'path'); path.setAttribute('d', d); ornament.append(path); }
  const chapter = element('span', 'story-reader-chapter');
  const worldTitle = element('span', 'story-reader-world');
  side.append(imprint, ornament, worldTitle, chapter);

  const page = element('article', 'story-reader-page');
  const masthead = element('header', 'story-reader-masthead');
  const objectLabel = element('span', 'story-reader-object-label'); objectLabel.append(icon('book'));
  const labelText = element('span', 'story-reader-object-label-text'); labelText.textContent = 'Travel journal'; objectLabel.append(labelText);
  const edition = element('span', 'story-reader-edition');
  masthead.append(objectLabel, edition);
  const content = element('div', 'story-reader-content'); content.tabIndex = 0; content.setAttribute('aria-label', 'Read this chapter');
  const eyebrow = element('span', 'story-reader-eyebrow'); eyebrow.setAttribute('data-story-reader-eyebrow', '');
  const title = element('h2', 'story-reader-title'); title.tabIndex = -1; title.setAttribute('data-story-reader-title', '');
  const body = element('p', 'story-reader-body'); body.setAttribute('data-story-reader-body', '');
  const source = element('a', 'story-reader-source'); source.setAttribute('data-story-reader-source', ''); source.target = '_blank'; source.rel = 'noopener noreferrer'; source.referrerPolicy = 'no-referrer'; source.hidden = true;
  const sourceLabel = element('span', 'story-reader-source-label'); source.append(sourceLabel, icon('external'));
  content.append(eyebrow, title, body, source);
  const controls = element('nav', 'story-reader-controls'); controls.setAttribute('aria-label', 'Story reader controls');
  const previous = button('story-reader-previous', 'previous', 'Previous chapter');
  const counter = element('span', 'story-reader-counter'); counter.setAttribute('aria-label', 'Chapter position');
  const next = button('story-reader-next', 'next', 'Next chapter');
  const playbackButton = button('story-reader-playback', 'pause', 'Pause tour');
  const close = button('story-reader-close', 'close', 'Close story');
  previous.hidden = !options.onPrevious; next.hidden = !options.onNext; playbackButton.hidden = true;
  controls.append(previous, counter, next, playbackButton, close);
  const note = element('small', 'story-reader-note'); note.hidden = true;
  page.append(masthead, content, controls, note); object.append(cover, side, seam, page); root.append(object); host.append(root);

  listen(close, 'click', () => { if (active()) options.onClose(); });
  listen(previous, 'click', () => { if (active() && currentIndex > 0) options.onPrevious?.(); });
  listen(next, 'click', () => { if (active() && currentIndex < currentCount - 1) options.onNext?.(); });
  listen(playbackButton, 'click', () => { if (active() && (playback === 'playing' || playback === 'paused')) options.onTogglePlayback?.(); });
  listen(root, 'keydown', event => {
    if ((event as KeyboardEvent).key !== 'Escape' || !active()) return;
    event.preventDefault(); event.stopPropagation(); options.onClose();
  });

  function update(data: StoryReaderData) {
    if (!active()) return;
    const mode: StoryReaderMode = data.mode === 'tablet' || data.mode === 'newspaper' ? data.mode : 'book';
    const count = Number.isFinite(data.count) ? Math.max(1, Math.min(1000, Math.floor(data.count))) : 1;
    const index = Number.isFinite(data.index) ? Math.max(0, Math.min(count - 1, Math.floor(data.index))) : 0;
    const nextKey = JSON.stringify([mode, index, value(data.title), value(data.body)]);
    if (nextKey !== contentKey) { contentKey = nextKey; turn = !turn; root.dataset.turn = turn ? 'a' : 'b'; content.scrollTop = 0; }
    root.dataset.mode = mode; root.setAttribute('aria-label', `${mode === 'book' ? 'Open travel journal' : mode === 'newspaper' ? 'Story newspaper' : 'Story tablet'} · chapter ${index + 1} of ${count}`);
    currentIndex = index; currentCount = count; playback = data.playback;
    objectLabel.replaceChildren(icon(mode), labelText);
    labelText.textContent = mode === 'book' ? 'Travel journal' : mode === 'newspaper' ? 'The Gift Gazette' : 'Field notes';
    worldTitle.textContent = value(data.worldTitle) || 'A world worth remembering';
    chapter.textContent = `CHAPTER ${String(index + 1).padStart(2, '0')}`;
    edition.textContent = mode === 'newspaper' ? `A personal edition · ${index + 1} / ${count}` : mode === 'tablet' ? 'EXPLORE / READ' : 'MEMORIES & DISCOVERIES';
    eyebrow.textContent = value(data.eyebrow) || 'Personal story'; title.textContent = value(data.title); body.textContent = value(data.body);
    const safeSource = storyReaderSourceUrl(data.sourceUrl); source.hidden = !safeSource; sourceLabel.textContent = safeSource ? value(data.sourceTitle) || 'Read the primary source' : '';
    if (safeSource) source.setAttribute('href', safeSource); else source.removeAttribute('href');
    counter.textContent = `${index + 1} / ${count}`; previous.disabled = index === 0; next.disabled = index === count - 1;
    playbackButton.hidden = !options.onTogglePlayback || (playback !== 'playing' && playback !== 'paused');
    const playbackLabel = playback === 'playing' ? 'Pause tour' : 'Resume tour';
    playbackButton.setAttribute('aria-label', playbackLabel); playbackButton.replaceChildren(icon(playback === 'playing' ? 'pause' : 'play'), document.createTextNode(playbackLabel));
    const closeLabel = value(data.closeLabel) || 'Close story'; close.setAttribute('aria-label', closeLabel); close.querySelector('span')!.textContent = closeLabel;
    note.textContent = value(data.note); note.hidden = !note.textContent;
  }
  function destroy() {
    if (dead) return; dead = true; listeners.splice(0).forEach(remove => remove()); root.remove(); source.removeAttribute('href');
  }
  return { update, focus: () => { if (active()) title.focus({ preventScroll: true }); }, destroy };
}
