import type { MediaDTO, MemoryDTO, WorldDTO } from '../shared/contracts';
import { pilotPlaces } from './map-data';
import { demoFixtureKey, journeyCatalog, journeyProgress, nextJourneyMemory, reconcileJourney, reduceJourney, type JourneyMemory, type JourneyScope, type JourneyState } from './journey-state';
import { mountMemoryPortal } from './memory-portal';

export interface MemoryTrailOptions {
  world: WorldDTO;
  scope: JourneyScope;
  state: JourneyState;
  initialMemoryId?: string;
  openPortalOnMount?: boolean;
  isCurrent?: () => boolean;
  onStateChange: (state: JourneyState) => void;
  onOpenMemory: (id: string) => void;
  onAtlas: (placeId?: string) => void;
  onTravel: (memory: MemoryDTO) => Promise<void>;
  onRefresh?: (memoryId: string) => Promise<void>;
}
export interface MemoryTrailHandle { destroy(): void }
type Fragment = 'object' | 'place' | 'story';
type Mode = Fragment | 'keepsake';
interface ViewerHandle { destroy(): void; reset(): void; rotate?: (delta: number) => void; zoom?: (delta: number) => void; forward?: () => void; backward?: () => void; setDisplayMode?: (mode: 'textured' | 'wireframe') => void; setAutoRotate?: (enabled: boolean) => boolean }
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const labels: Record<Fragment, string> = { object: 'Object', place: 'World', story: 'Story' };
const symbols: Record<Fragment, string> = { object: '◇', place: '⌖', story: '✎' };
const modes: Fragment[] = ['object', 'place', 'story'];
let trailInstance = 0;

/** An explicit reading journey over the current authorized world. No DTO writes or storage. */
export function mountMemoryTrail(host: HTMLElement, options: MemoryTrailOptions): MemoryTrailHandle {
  const instance = ++trailInstance;
  const catalog = journeyCatalog(options.world, options.scope);
  let state = reconcileJourney(options.state, catalog, options.scope);
  let selected: JourneyMemory | undefined = catalog.find(entry => entry.memory.id === options.initialMemoryId);
  let mode: Mode = selected && journeyProgress(state, selected.memory.id).kept ? 'keepsake' : 'object';
  let dead = false, viewerVersion = 0, viewer: ViewerHandle | undefined;
  let portal: ReturnType<typeof mountMemoryPortal> | undefined;
  let originalView = false, wireframe = false, orbit = false, libraryCollapsed = !!selected;
  let busy = false, celebration: ReturnType<typeof setTimeout> | undefined;
  const events = new AbortController();
  let deskEvents = new AbortController();
  const root = document.createElement('section'); root.className = 'memory-trail memory-studio'; root.setAttribute('aria-label', 'Memory Studio');
  host.replaceChildren(root);
  const active = () => !dead && root.isConnected && host.contains(root) && (options.isCurrent?.() ?? true);
  const scrollBehavior = (): ScrollBehavior => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const count = (id: string) => { const progress = journeyProgress(state, id); return Number(progress.object) + Number(progress.place) + Number(progress.story); };
  const keptCount = () => catalog.filter(entry => journeyProgress(state, entry.memory.id).kept).length;
  const original = (memory: MemoryDTO) => memory.media.find(media => media.kind === 'gift-photo') || memory.media.find(media => media.kind === 'place-photo');
  const expired = (media: MediaDTO | undefined) => !!media?.expiresAt && media.expiresAt <= Date.now() / 1000;
  const imageUrl = (media: MediaDTO | undefined) => {
    if (!media || expired(media)) return '';
    try { const url = new URL(media.url, location.origin); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password || options.scope.kind === 'public-demo' && url.protocol === 'data:' && media.mimeType.startsWith('image/') ? media.url : ''; } catch { return ''; }
  };
  const locationLabel = (entry: JourneyMemory) => options.scope.kind === 'owner' && entry.memory.ownerId === options.scope.actorId || entry.memory.shareLocation === true ? entry.memory.location.label || 'A place in this story' : 'Location not shared';
  const memoryRole = (entry: JourneyMemory) => entry.memory.ownerId === options.world.user.id ? `${options.world.user.displayName}’s story` : `Received from ${entry.memory.ownerName}`;
  const picture = (entry: JourneyMemory, className = '', alt = 'Original media for this memory') => {
    const url = imageUrl(original(entry.memory));
    return url ? `<img class="${className}" src="${escape(url)}" alt="${escape(alt)}" loading="lazy"/>` : `<div class="${className} studio-unavailable"><span aria-hidden="true">◇</span><small>Original unavailable</small></div>`;
  };
  const current = () => selected ? journeyProgress(state, selected.memory.id) : { object: false, place: false, story: false, kept: false };
  const assetType = (entry: JourneyMemory) => {
    const object = entry.memory.media.some(media => media.kind === 'model');
    const world = entry.memory.media.some(media => media.kind === 'world' && !media.mimeType.startsWith('image/'));
    return object && world ? '3D object + world' : object ? '3D object' : world ? '3D world' : 'Original + story';
  };
  function progressMarkup() { const progress = current(); return `<div class="studio-checklist-heading"><span>Exploration</span><strong>${selected ? count(selected.memory.id) : 0} / 3</strong></div><ol class="trail-fragment-progress" aria-label="Memory fragments">${modes.map(fragment => `<li data-progress-fragment="${fragment}" class="${progress[fragment] ? 'is-revealed' : mode === fragment ? 'is-current' : ''}"><span>${progress[fragment] ? '✓' : symbols[fragment]}</span><strong>${labels[fragment]}</strong><small>${progress[fragment] ? 'Revealed' : 'To reveal'}</small></li>`).join('')}</ol>`; }
  function destroyViewer() { viewerVersion++; viewer?.destroy(); viewer = undefined; }
  const canEnterPortal = (entry: JourneyMemory) => entry.memory.media.some(media => media.kind === 'model') && entry.memory.media.some(media => media.kind === 'world' && !media.mimeType.startsWith('image/'));
  function enterPortal() {
    if (!active() || !selected || busy || portal || !canEnterPortal(selected)) return;
    const entry = selected;
    destroyViewer();
    const version = viewerVersion;
    let finished = false;
    const finish = (explore: boolean) => {
      finished = true;
      portal?.destroy(); portal = undefined;
      if (!active() || selected !== entry) return;
      if (explore) mode = 'object';
      renderDesk(true);
      if (explore) announce('Your memory is open. Reveal the three fragments to make a session keepsake.');
    };
    const next = mountMemoryPortal(root, { memory: entry.memory, isCurrent: () => active() && selected === entry && viewerVersion === version, onExit: () => finish(false), onExplore: () => finish(true) });
    if (!finished && active() && selected === entry && viewerVersion === version) portal = next;
    else next.destroy();
  }
  function announce(message: string) { if (active()) root.querySelector<HTMLElement>('[data-trail-status]')!.textContent = message; }
  function listen<T extends Element>(target: T | null, type: string, callback: (event: Event) => void) { target?.addEventListener(type, callback, { signal: target.closest('[data-trail-desk]') ? deskEvents.signal : events.signal }); }
  function updateState(type: 'reveal-object' | 'reveal-place' | 'reveal-story' | 'keep') {
    if (!active() || !selected || busy) return;
    state = reduceJourney(state, catalog, { scopeEpoch: options.scope.epoch, memoryId: selected.memory.id, type });
    options.onStateChange(state); updateMap();
  }
  function detail(entry: JourneyMemory, fragment: Fragment): { title: string; text: string } {
    const fixture = demoFixtureKey(entry.memory);
    const authored = {
      bird: {
        object: { title: 'A small thing. A future conversation.', text: 'Maya’s ceramic bird carries the conversations still ahead of them. The real Tripo model gives her imagined souvenir another form.' },
        place: { title: 'An afternoon you can step inside.', text: 'Perdizes is the setting of this fictional postcard. World Labs turns its illustrated feeling into an artistic place, rather than reconstructing the actual neighborhood.' },
        story: { title: 'The gift can wait. The feeling can arrive.', text: '“The physical gift can wait. This little world can arrive today.” Maya’s words connect the bird to Noah before they meet again.' }
      },
      sea: {
        object: { title: 'A pause, small enough for a pocket.', text: 'The imagined shell is a reminder to slow down and listen. Its original illustration stays an illustration; no 3D reconstruction is attached.' },
        place: { title: 'Salt in the air. Soft light.', text: 'Santos is the setting of Maya’s fictional sea postcard. A published catalog reference can orient you; this memory does not reconstruct the city.' },
        story: { title: 'Listen to what the little thing carries.', text: 'The shell carries a pause. Maya’s story invites someone else to share that feeling, rather than prove a trip.' }
      },
      paris: {
        object: { title: 'A little window, sent between friends.', text: 'Noah’s original bird illustration becomes a gift-memory for Maya. Its story opens a connection without inventing a 3D asset.' },
        place: { title: 'A memory opens a window onto Paris.', text: 'Paris is outside this pilot. The postcard gives no verified map coordinate and records no physical visit.' },
        story: { title: 'Knowing a place through someone.', text: 'Maya receives Noah’s fictional memory and keeps its story. A place known through a gift remains separate from places visited in person.' }
      }
    };
    if (fixture) return authored[fixture][fragment];
    if (fragment === 'object') return { title: 'The original comes first.', text: 'This fragment belongs to the author’s original gift media. An attached 3D interpretation offers another way to look; it does not replace the original.' };
    if (fragment === 'place') return { title: entry.publicPlaceId ? 'A place behind the memory.' : 'A place shared on the author’s terms.', text: entry.memory.shareLocation === true || options.scope.kind === 'owner' && entry.memory.ownerId === options.scope.actorId ? `${locationLabel(entry)} is the setting selected for this memory. Exploring its artistic interpretation does not record a physical visit.` : 'The author has kept this location private. You can still explore the gift and the words they authorized you to read.' };
    return { title: 'A moment in the author’s words.', text: entry.memory.story };
  }

  function render() {
    root.innerHTML = `<div class="studio-toolbar"><div><span class="studio-product-mark" aria-hidden="true">◇</span><h1>Memory Studio</h1><span class="studio-owner">${escape(options.world.user.displayName)}’s collection</span></div><div class="trail-session-note"><span>${options.scope.kind === 'public-demo' ? 'Public demo · fictional stories' : 'Authorized collection'}</span><small>Exploration resets on reload or account/person switch</small></div></div><div class="studio-shell"><aside class="studio-library ${libraryCollapsed ? 'is-collapsed' : ''}" aria-label="Authorized asset library"><div class="studio-library-heading"><h2>Asset library <span>${catalog.length}</span></h2><button data-library-toggle aria-expanded="${!libraryCollapsed}" aria-label="Toggle asset library">${libraryCollapsed ? 'Show assets ＋' : 'Collapse −'}</button></div><div class="studio-library-list">${catalog.map(entry => `<button class="studio-asset" data-signal="${escape(entry.memory.id)}" aria-pressed="false">${picture(entry, 'studio-asset-image', `Original reference for ${entry.memory.title}`)}<span class="studio-asset-copy"><strong>${escape(entry.memory.title)}</strong><span>${escape(assetType(entry))}</span><small data-signal-progress="${escape(entry.memory.id)}"></small></span></button>`).join('') || '<p class="studio-library-empty">No authorized assets in this collection.</p>'}</div><div class="studio-library-footer"><span data-kept-total></span><button data-full-atlas>⌖ Open discovery atlas ↗</button><p>Memory discovery is separate from physical visits.</p></div></aside><section class="trail-desk" aria-label="Memory workspace" data-trail-desk></section></div><details class="trail-context"><summary>Published pilot places <span>7 sourced reference points</span></summary><p>Public geography for context. Opening a landmark does not unlock a private memory or record a visit.</p><div>${pilotPlaces.map(place => `<button data-catalog-place="${escape(place.id)}">⌖ ${escape(place.name)} ↗</button>`).join('')}</div></details><p class="trail-announcement" role="status" aria-live="polite" data-trail-status></p>`;
    root.querySelectorAll<HTMLElement>('[data-signal]').forEach(button => listen(button, 'click', () => select(button.dataset.signal!, true)));
    listen(root.querySelector('[data-library-toggle]'), 'click', () => {
      libraryCollapsed = !libraryCollapsed; root.querySelector('.studio-library')?.classList.toggle('is-collapsed', libraryCollapsed);
      const button = root.querySelector<HTMLButtonElement>('[data-library-toggle]')!; button.setAttribute('aria-expanded', String(!libraryCollapsed)); button.textContent = libraryCollapsed ? 'Show assets ＋' : 'Collapse −';
    });
    listen(root.querySelector('[data-full-atlas]'), 'click', () => options.onAtlas());
    root.querySelectorAll<HTMLElement>('[data-catalog-place]').forEach(button => listen(button, 'click', () => options.onAtlas(button.dataset.catalogPlace)));
    updateMap(); renderDesk();
  }
  function updateMap() {
    if (!active()) return;
    root.querySelector<HTMLElement>('[data-kept-total]')!.textContent = `${keptCount()} ${keptCount() === 1 ? 'keepsake' : 'keepsakes'} in this session`;
    root.querySelectorAll<HTMLElement>('[data-signal],[data-list-signal]').forEach(button => {
      const id = button.dataset.signal || button.dataset.listSignal!;
      button.setAttribute('aria-pressed', String(id === selected?.memory.id));
      button.classList.toggle('is-kept', journeyProgress(state, id).kept);
      button.setAttribute('aria-label', `Follow ${catalog.find(entry => entry.memory.id === id)?.memory.title || 'this memory'} · ${journeyProgress(state, id).kept ? 'kept in this session' : `${count(id)} of 3 fragments revealed`}`);
    });
    root.querySelectorAll<HTMLElement>('[data-signal-progress],[data-list-progress]').forEach(label => {
      const id = label.dataset.signalProgress || label.dataset.listProgress!;
      label.textContent = journeyProgress(state, id).kept ? '✓ Kept in this session' : `${count(id)} / 3 fragments`;
    });
  }
  function select(id: string, focus = false) {
    if (!active() || busy) return;
    const entry = catalog.find(item => item.memory.id === id); if (!entry) return;
    selected = entry; mode = journeyProgress(state, id).kept ? 'keepsake' : 'object'; originalView = false; wireframe = false; orbit = false;
    if (innerWidth <= 960) { libraryCollapsed = true; root.querySelector('.studio-library')?.classList.add('is-collapsed'); const toggle = root.querySelector<HTMLButtonElement>('[data-library-toggle]')!; toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = 'Show assets ＋'; }
    updateMap(); renderDesk();
    if (focus) {
      root.querySelector<HTMLElement>('[data-memory-heading]')?.focus({ preventScroll: true });
      if (innerWidth <= 760) root.querySelector<HTMLElement>('[data-trail-desk]')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }
    announce(`Following ${entry.memory.title}. ${count(id)} of three fragments revealed.`);
  }
  function renderDesk(focusMode = false) {
    portal?.destroy(); portal = undefined;
    destroyViewer(); deskEvents.abort(); deskEvents = new AbortController(); if (!active()) return;
    const desk = root.querySelector<HTMLElement>('[data-trail-desk]')!;
    if (!selected) {
      desk.innerHTML = catalog.length ? `<div class="trail-empty trail-choose"><div class="studio-empty-reference">${picture(catalog[0], '', 'Original reference for the first authorized memory')}</div><span class="eyebrow">YOUR MEMORY WORKSPACE</span><h2>One object. A world behind it.</h2><p>Inspect the original, explore its attached 3D assets, and reveal the story. Three fragments become one digital keepsake.</p><button class="button" data-first-signal>Open first memory ↗</button><small>No location, camera, or microphone access is needed.</small></div>` : `<div class="trail-empty"><span>◇</span><h2>Your memory workspace is ready.</h2><p>This collection has no authorized memory to explore. Published places remain available in the discovery atlas.</p><button class="button" data-empty-atlas>Open discovery atlas ↗</button></div>`;
      listen(desk.querySelector('[data-first-signal]'), 'click', () => select(catalog[0].memory.id, true));
      listen(desk.querySelector('[data-empty-atlas]'), 'click', () => options.onAtlas()); return;
    }
    const entry = selected;
    desk.innerHTML = `<div class="trail-memory-title"><div><span class="eyebrow">${escape(memoryRole(entry))}</span><h2 tabindex="-1" data-memory-heading>${escape(entry.memory.title)}</h2></div><span class="trail-place-label">⌖ ${escape(locationLabel(entry))}</span></div><div class="trail-mode-tabs" role="tablist" aria-label="Memory workspace views">${modes.map(fragment => `<button id="trail-${instance}-${fragment}" role="tab" aria-selected="${mode === fragment}" aria-controls="trail-${instance}-panel" tabindex="${mode === fragment ? 0 : -1}" data-trail-mode="${fragment}">${symbols[fragment]} ${labels[fragment]}</button>`).join('')}<button id="trail-${instance}-keepsake" role="tab" aria-selected="${mode === 'keepsake'}" aria-controls="trail-${instance}-panel" tabindex="${mode === 'keepsake' ? 0 : -1}" data-trail-mode="keepsake" ${count(entry.memory.id) === 3 ? '' : 'disabled'}>▧ Keepsake</button></div><div id="trail-${instance}-panel" class="trail-stage" role="tabpanel" aria-labelledby="trail-${instance}-${mode}" data-stage></div><div class="trail-retention"><button class="text-link" data-open-original>Original files & full memory ↗</button><span>${demoFixtureKey(entry.memory) === 'bird' ? 'AI-generated reference · fictional people and story' : entry.memory.demo ? 'Original illustration · fictional people and story' : 'Author-controlled original media'}</span><details><summary>Interpretation notes</summary><p>${escape(entry.memory.artisticNote || 'Attached 3D assets are artistic interpretations. Original files and the author’s words remain available.')}</p></details></div>`;
    desk.querySelectorAll<HTMLButtonElement>('[data-trail-mode]').forEach(button => {
      listen(button, 'click', () => { mode = button.dataset.trailMode as Mode; originalView = false; renderDesk(true); });
      listen(button, 'keydown', event => {
        const key = (event as KeyboardEvent).key; if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
        event.preventDefault(); const buttons = [...desk.querySelectorAll<HTMLButtonElement>('[data-trail-mode]:not(:disabled)')];
        const index = buttons.indexOf(button); const next = key === 'Home' ? buttons[0] : key === 'End' ? buttons.at(-1)! : buttons[(index + (key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
        mode = next.dataset.trailMode as Mode; originalView = false; renderDesk(true);
      });
    });
    if (canEnterPortal(entry)) {
      const launch = document.createElement('button');
      launch.className = 'button trail-portal-launch';
      launch.dataset.enterPortal = '';
      launch.textContent = 'Step inside this memory ↗';
      desk.querySelector('.trail-memory-title')!.append(launch);
      listen(launch, 'click', enterPortal);
    }
    listen(desk.querySelector('[data-open-original]'), 'click', () => options.onOpenMemory(entry.memory.id));
    if (mode === 'keepsake') renderKeepsake(); else renderFragment();
    if (focusMode) desk.querySelector<HTMLElement>(`[data-trail-mode="${mode}"]`)?.focus({ preventScroll: true });
  }
  function renderFragment() {
    if (!selected || mode === 'keepsake' || !active()) return;
    const entry = selected, fragment = mode, progress = current(), stage = root.querySelector<HTMLElement>('[data-stage]')!;
    const source = detail(entry, fragment);
    const attachedViewer = entry.memory.media.some(media => fragment === 'object' ? media.kind === 'model' : fragment === 'place' && media.kind === 'world' && !media.mimeType.startsWith('image/'));
    const revealLabel = `Reveal ${labels[fragment].toLowerCase()} fragment`;
    const cardMarkup = (revealed: boolean) => `<span class="trail-fragment-label">${revealed ? '✓ Fragment revealed' : `Fragment ${modes.indexOf(fragment) + 1} of 3`}</span>${revealed ? `<h3>${escape(source.title)}</h3><p>${escape(source.text)}</p>${count(entry.memory.id) === 3 ? '<button class="button trail-action" data-assemble>Assemble keepsake ↗</button>' : `<button class="button trail-action" data-continue>${fragment === 'object' ? 'Explore the world' : fragment === 'place' ? 'Read the story' : 'Explore next fragment'} →</button>`}` : `<h3>${fragment === 'object' ? 'Inspect the object.' : fragment === 'place' ? 'Enter its world.' : 'Find the connection.'}</h3><p>${fragment === 'object' ? attachedViewer ? 'Compare the original with its attached 3D interpretation. Reveal the detail that connects this object to its story.' : 'Inspect the original and reveal the detail that connects this object to its story.' : fragment === 'place' ? 'Explore an artistic world or its available image. Digital exploration remains separate from physical visits.' : 'Read the author’s words, then reveal the thread that brings this memory together.'}</p><button class="button trail-action" data-reveal>${revealLabel} ↗</button>`}`;
    stage.classList.remove('is-keepsake'); stage.classList.toggle('is-story', fragment === 'story');
    const worldImage = entry.memory.media.find(media => media.kind === 'world' && media.mimeType.startsWith('image/'));
    const placePhoto = entry.memory.media.find(media => media.kind === 'place-photo');
    const originalLabel = fragment === 'object' ? 'Original' : worldImage ? 'World image' : placePhoto ? 'Source photo' : 'Reference';
    const referenceLabel = fragment === 'object' ? demoFixtureKey(entry.memory) === 'bird' ? 'AI-generated fictional reference → Tripo 3D interpretation' : attachedViewer ? 'Original reference → artistic 3D interpretation' : 'Original media · no 3D object attached' : attachedViewer ? demoFixtureKey(entry.memory) === 'bird' ? 'World Labs artistic environment · generated from fictional source material' : 'Attached artistic environment · original files remain available' : 'Original media and authorized location · no 3D world attached';
    stage.innerHTML = `${fragment === 'story' ? `<div class="studio-display-bar"><span>Author’s words</span><span>Original story</span></div><div class="trail-reading"><span class="eyebrow">FROM ${escape(entry.memory.ownerName)}</span><p>${escape(entry.memory.story || 'No story text is attached to this memory.')}</p></div>` : `<div class="studio-display-bar"><div class="studio-compare" role="group" aria-label="${fragment === 'object' ? 'Object comparison' : 'World comparison'}"><button data-view-original aria-pressed="${originalView || !attachedViewer}">${originalLabel}</button>${attachedViewer ? `<button data-view-3d aria-pressed="${!originalView}">3D ${fragment === 'object' ? 'object' : 'world'}</button>` : ''}</div><span>${attachedViewer ? fragment === 'object' ? 'GLB asset' : 'Gaussian splat' : 'Original only'}</span></div><div class="trail-viewer" data-trail-viewer><div class="trail-poster" data-trail-poster>${fragment === 'place' ? placePoster(entry) : picture(entry, '', demoFixtureKey(entry.memory) === 'bird' ? 'AI-generated fictional bird reference' : 'Original gift media')}</div><div class="trail-load" role="status" data-trail-load>Loading ${fragment === 'object' ? 'object' : 'world'}…</div></div><div class="trail-control-row ${attachedViewer ? '' : 'trail-no-3d-controls'}" data-controls-row><p class="trail-control-status" data-controls-status>Preparing 3D controls…</p><div class="trail-viewer-controls" aria-label="${fragment === 'object' ? 'Object' : 'World'} viewer controls" data-trail-tools hidden></div></div><div class="trail-viewer-caption" data-trail-caption></div><div class="trail-original-reference">${picture(entry, '', demoFixtureKey(entry.memory) === 'bird' ? 'AI-generated fictional bird reference' : 'Author’s original reference')}<span><strong>Source & interpretation</strong>${escape(referenceLabel)}</span></div>`}<aside class="studio-inspector" aria-label="Exploration inspector"><div data-progress>${progressMarkup()}</div><div class="trail-fragment-card ${progress[fragment] ? 'is-revealed' : ''}">${cardMarkup(progress[fragment])}</div><div class="studio-inspector-note"><span>Session progress</span><p>Reveals and keepsakes reset on reload or when you switch accounts or people. They do not record a physical visit.</p></div></aside>`;
    listen(stage.querySelector('[data-reveal]'), 'click', () => {
      updateState(`reveal-${fragment}`); if (!active()) return;
      const card = stage.querySelector<HTMLElement>('.trail-fragment-card')!; card.classList.add('is-revealed');
      card.innerHTML = cardMarkup(true); stage.querySelector<HTMLElement>('[data-progress]')!.innerHTML = progressMarkup();
      if (count(entry.memory.id) === 3) root.querySelector<HTMLButtonElement>('[data-trail-mode="keepsake"]')!.disabled = false;
      wireFragmentContinuation(stage); announce(`${labels[fragment]} fragment revealed. ${count(entry.memory.id)} of three.`); root.querySelector<HTMLElement>('[data-assemble],[data-continue]')?.focus({ preventScroll: true });
    });
    listen(stage.querySelector('[data-view-original]'), 'click', () => { if (originalView || !attachedViewer) return; originalView = true; renderDesk(); root.querySelector<HTMLElement>('[data-view-original]')?.focus({ preventScroll: true }); });
    listen(stage.querySelector('[data-view-3d]'), 'click', () => { if (!originalView) return; originalView = false; renderDesk(); root.querySelector<HTMLElement>('[data-view-3d]')?.focus({ preventScroll: true }); });
    wireFragmentContinuation(stage);
    if (fragment !== 'story') void loadViewer(entry, fragment);
  }
  function wireFragmentContinuation(stage: HTMLElement) {
    listen(stage.querySelector('[data-continue]'), 'click', () => { mode = modes.find(item => !current()[item]) || 'keepsake'; originalView = false; renderDesk(true); });
    listen(stage.querySelector('[data-assemble]'), 'click', () => {
      mode = 'keepsake'; renderDesk();
      const heading = root.querySelector<HTMLElement>('.trail-keepsake-copy h3'); if (!heading) return;
      heading.tabIndex = -1; heading.focus({ preventScroll: true }); heading.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    });
  }
  function placePoster(entry: JourneyMemory) {
    const panorama = entry.memory.media.find(media => media.kind === 'world' && media.mimeType.startsWith('image/')) || entry.memory.media.find(media => media.kind === 'place-photo');
    const url = imageUrl(panorama); return url ? `<img src="${escape(url)}" alt="${panorama?.kind === 'world' ? 'Authorized artistic panorama' : 'Author’s original place photo'}"/>` : picture(entry, '', 'Original reference · no separate world image attached');
  }
  async function loadViewer(entry: JourneyMemory, fragment: 'object' | 'place') {
    const version = ++viewerVersion, stage = root.querySelector<HTMLElement>('[data-stage]')!, canvasHost = stage.querySelector<HTMLElement>('[data-trail-viewer]')!;
    const currentView = () => active() && version === viewerVersion && canvasHost.isConnected && selected === entry && mode === fragment;
    const source = entry.memory.media.find(media => fragment === 'object' ? media.kind === 'model' : media.kind === 'world' && !media.mimeType.startsWith('image/'));
    const status = stage.querySelector<HTMLElement>('[data-trail-load]')!, caption = stage.querySelector<HTMLElement>('[data-trail-caption]')!, tools = stage.querySelector<HTMLElement>('[data-trail-tools]')!;
    const controlRow = stage.querySelector<HTMLElement>('[data-controls-row]')!, controlStatus = stage.querySelector<HTMLElement>('[data-controls-status]')!;
    let failed = false;
    const fallback = (message: string, retry = true, freshPage = false) => {
      if (!currentView()) return; failed = true; canvasHost.classList.remove('is-ready'); viewer?.destroy(); viewer = undefined; tools.hidden = true;
      controlStatus.hidden = true; controlRow.append(status); status.hidden = false;
      status.className = 'trail-load trail-load-fallback'; status.title = message;
      status.innerHTML = `<span>${freshPage ? '3D could not load. Reloading resets this exploration session.' : retry ? '3D unavailable. Your original and story remain available.' : 'Media access expired. Refresh authorization to continue.'}</span>${retry ? `<button data-view-retry>${freshPage ? 'Reload preview ↻' : 'Retry 3D view ↻'}</button>` : ''}`;
      listen(status.querySelector('[data-view-retry]'), 'click', () => { if (freshPage) location.reload(); else renderDesk(true); });
      caption.textContent = fragment === 'object' ? 'Original media · the fragment remains available' : 'Image and story · the fragment remains available';
    };
    if (!source) { status.remove(); caption.textContent = fragment === 'object' ? 'Original media · no 3D object attached' : 'Original media · no generated 3D world attached'; return; }
    if (originalView) { status.remove(); controlStatus.textContent = 'Image view · 3D controls paused'; caption.textContent = fragment === 'object' ? 'Original reference · 3D interpretation remains available' : entry.memory.media.some(media => media.kind === 'world' && media.mimeType.startsWith('image/')) ? 'Artistic panorama · generated 3D world remains available' : 'Original reference · artistic 3D world remains available'; return; }
    if (expired(source)) {
      fallback('This media access has expired. Refresh authorization to open it again.', false);
      const refresh = document.createElement('button'); refresh.textContent = options.onRefresh ? 'Refresh authorized media ↻' : 'Return to the memory to refresh ↗'; status.append(refresh);
      listen(refresh, 'click', async () => { if (!currentView() || busy) return; if (!options.onRefresh) { options.onOpenMemory(entry.memory.id); return; } busy = true; refresh.disabled = true; try { await options.onRefresh(entry.memory.id); } catch { if (currentView()) { refresh.disabled = false; announce('Media could not be refreshed. The authorized story remains available.'); } } finally { busy = false; } }); return;
    }
    const ready = () => {
      if (!currentView() || failed) return; canvasHost.classList.add('is-ready'); status.hidden = true; controlStatus.hidden = true; tools.hidden = false;
      caption.textContent = fragment === 'object' ? `Drag to rotate · scroll to zoom${source.provider === 'tripo' ? ' · Tripo 3D' : ' · artistic 3D'}` : `Drag to look · small viewing offsets${source.provider === 'worldlabs' ? ' · World Labs' : ''}`;
    };
    const progress = (value: { phase: 'loading' | 'decoding'; loadedBytes: number; totalBytes: number | null }) => { if (currentView() && !failed) status.textContent = value.phase === 'decoding' ? 'Preparing this scene for your device…' : value.loadedBytes ? `Opening the scene · ${Math.round(value.loadedBytes / 1024)} KB received` : 'Opening the scene…'; };
    try {
      let handle: ViewerHandle;
      if (fragment === 'object') { const module = await import('./scene'); if (!currentView()) return; handle = module.mountMemoryScene(canvasHost, { modelUrl: source.url, onReady: ready, onError: message => fallback(message), onProgress: progress }); }
      else { const module = await import('./environment'); if (!currentView()) return; handle = module.mountGeneratedEnvironment(canvasHost, source.url, ready, message => fallback(message), progress); }
      if (!currentView() || failed) { handle.destroy(); return; } viewer = handle;
      if (fragment === 'object') { viewer.setDisplayMode?.(wireframe ? 'wireframe' : 'textured'); orbit = viewer.setAutoRotate?.(orbit) ?? false; }
      tools.innerHTML = fragment === 'object' ? `<button data-control="left" aria-label="Rotate object left" title="Rotate left">↶ <span>Left</span></button><button data-control="right" aria-label="Rotate object right" title="Rotate right">↷ <span>Right</span></button><button data-control="closer" aria-label="Zoom in on object" title="Zoom in">＋</button><button data-control="further" aria-label="Zoom out from object" title="Zoom out">−</button><button data-control="reset" aria-label="Reset object view" title="Reset view">↺ <span>Reset</span></button><button data-control="wireframe" aria-label="Wireframe" aria-pressed="${wireframe}" title="Wireframe">▦ <span>Wireframe</span></button><button data-control="orbit" aria-label="Auto orbit" aria-pressed="${orbit}" ${matchMedia('(prefers-reduced-motion: reduce)').matches ? 'disabled title="Auto orbit is off for reduced motion"' : 'title="Auto orbit"'}>⟳ <span>Orbit</span></button>` : `<button data-control="back" aria-label="Small viewing offset backward">← <span>Back</span></button><button data-control="forward" aria-label="Small viewing offset forward">→ <span>Forward</span></button><button data-control="reset" aria-label="Reset world view">↺ <span>Reset</span></button>`;
      tools.querySelectorAll<HTMLElement>('[data-control]').forEach(button => listen(button, 'click', () => { if (!currentView()) return; const action = button.dataset.control; if (action === 'left') viewer?.rotate?.(0.2); if (action === 'right') viewer?.rotate?.(-0.2); if (action === 'closer') viewer?.zoom?.(-0.15); if (action === 'further') viewer?.zoom?.(0.15); if (action === 'back') viewer?.backward?.(); if (action === 'forward') viewer?.forward?.(); if (action === 'reset') viewer?.reset(); }));
      listen(tools.querySelector('[data-control="wireframe"]'), 'click', event => { if (!currentView()) return; wireframe = !wireframe; viewer?.setDisplayMode?.(wireframe ? 'wireframe' : 'textured'); (event.currentTarget as HTMLElement).setAttribute('aria-pressed', String(wireframe)); });
      listen(tools.querySelector('[data-control="orbit"]'), 'click', event => { if (!currentView()) return; orbit = viewer?.setAutoRotate?.(!orbit) ?? false; (event.currentTarget as HTMLElement).setAttribute('aria-pressed', String(orbit)); });
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      motion.addEventListener('change', () => { if (!currentView()) return; const button = tools.querySelector<HTMLButtonElement>('[data-control="orbit"]'); if (!button) return; button.disabled = motion.matches; if (motion.matches) { orbit = viewer?.setAutoRotate?.(false) ?? false; button.setAttribute('aria-pressed', 'false'); } }, { signal: deskEvents.signal });
    } catch { fallback('This device could not open the 3D view. Explore the original image and story instead.', true, true); }
  }
  function renderKeepsake() {
    if (!selected || !active()) return;
    const entry = selected, progress = current(), stage = root.querySelector<HTMLElement>('[data-stage]')!;
    if (count(entry.memory.id) !== 3) { mode = 'object'; renderDesk(); return; }
    const next = nextJourneyMemory(catalog, state, entry.memory.id);
    stage.classList.add('is-keepsake'); stage.classList.remove('is-story');
    stage.innerHTML = `<div class="studio-display-bar"><span>Digital keepsake</span><span>${progress.kept ? 'Saved for this session' : 'Ready to keep'}</span></div><div class="trail-keepsake ${progress.kept ? 'is-kept' : ''}"><div class="trail-keepsake-art">${picture(entry, '', 'Original image on your digital keepsake')}<span class="trail-postage">GIFT PORTALS / MEMORY STUDIO</span></div><div class="trail-keepsake-copy"><span class="eyebrow">OBJECT + WORLD + STORY</span><h3>${escape(entry.memory.title)}</h3><div class="trail-keepsake-fragments">${modes.map(fragment => `<span>${symbols[fragment]} ${escape(detail(entry, fragment).title)}</span>`).join('')}</div><p>From ${escape(entry.memory.ownerName)} · ${escape(locationLabel(entry))}</p><span class="trail-keepsake-stamp">${progress.kept ? '✓ KEPT IN THIS SESSION' : '3 OF 3 FRAGMENTS REVEALED'}</span></div></div><aside class="studio-inspector" aria-label="Keepsake inspector"><div data-progress>${progressMarkup()}</div><div class="trail-reward"><span class="trail-fragment-label">${progress.kept ? '✓ Session keepsake' : 'Exploration complete'}</span><h3>${progress.kept ? 'Memory, connected.' : 'Keep the connection.'}</h3><p>${options.scope.kind === 'public-demo' ? 'This fictional keepsake lasts until reload or person switch. It creates no private collection entry, invitation, or physical visit.' : 'This keepsake lasts until reload or account switch. Your original collection and gift permissions remain controlled by your account.'}</p>${progress.kept ? `<button class="button trail-action" data-ride>Ride to my atlas ↔</button><button class="text-link" data-next-memory>${next ? 'Open next memory →' : 'Open discovery atlas →'}</button>` : '<button class="button trail-action" data-keep>Keep this memory ↗</button>'}<p class="trail-travel-error" role="alert" data-travel-error></p></div><div class="studio-inspector-note"><span>Digital exploration only</span><p>Keeping this memory does not claim a gift, record a physical visit, or change the original files.</p></div></aside>`;
    listen(stage.querySelector('[data-keep]'), 'click', () => { updateState('keep'); if (!active() || !current().kept) return; renderDesk(); root.classList.add('trail-celebrating'); clearTimeout(celebration); celebration = setTimeout(() => root.classList.remove('trail-celebrating'), 1800); announce('Memory kept in this session. A digital trace is ready for your atlas.'); root.querySelector<HTMLElement>('[data-ride]')?.focus({ preventScroll: true }); });
    listen(stage.querySelector('[data-next-memory]'), 'click', () => { if (busy) return; if (next) select(next.memory.id, true); else options.onAtlas(entry.publicPlaceId); });
    listen(stage.querySelector('[data-ride]'), 'click', async event => {
      if (busy || !active()) return; busy = true;
      const button = event.currentTarget as HTMLButtonElement; button.disabled = true; button.textContent = 'The memory train is waiting…';
      try { await options.onTravel(entry.memory); }
      catch { if (active()) { stage.querySelector<HTMLElement>('[data-travel-error]')!.textContent = 'The journey could not open. Your session keepsake is still here. Try again.'; button.disabled = false; button.textContent = 'Ride to my atlas ↔'; } }
      finally { busy = false; }
    });
  }
  function destroy() { if (dead) return; dead = true; portal?.destroy(); portal = undefined; destroyViewer(); events.abort(); deskEvents.abort(); clearTimeout(celebration); root.remove(); }
  render();
  if (options.openPortalOnMount) enterPortal();
  return { destroy };
}
