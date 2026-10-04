import './paris-flight.css';
import { giftIcon } from './gift-icon';
import { mountGeneratedWorld, type GeneratedWorldHandle, type GeneratedWorldTourState } from './generated-world';
import { mountStoryReader, type StoryReaderHandle } from './story-reader';
import { createParisFlightLoadGuard, parisFlightAsset, readParisFlightManifest, type ParisFlightChapter, type ParisFlightManifest, type ParisFlightQuality } from './paris-flight-state';

export interface ParisFlightOptions { isCurrent(): boolean; onExit(): void }
export interface ParisFlightHandle { destroy(): void }
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const svg = (path: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
const icons = {
  close: svg('m6 6 12 12M18 6 6 18'), next: svg('M4 12h16m-6-6 6 6-6 6'), play: svg('m8 5 11 7-11 7V5Z'), pause: svg('M8 5v14M16 5v14'),
  tower: svg('M12 2 7 20m5-18 5 18M5 22h14M8 16h8M9 11h6M10 6h4M8 22v-2c0-6 8-6 8 0v2'),
  flight: svg('m3 16 7-4-5-7 2-1 9 6 5-2 1 2-5 4-1 6-2 1-3-5-7 2Z'),
  book: svg('M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15'),
  detail: svg('m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z'),
  lookLeft: svg('M2 9s4-5 10-5 10 5 10 5-4 5-10 5S2 9 2 9ZM8 20h12m-8-4-4 4 4 4'),
  lookRight: svg('M2 9s4-5 10-5 10 5 10 5-4 5-10 5S2 9 2 9ZM4 20h12m-4-4 4 4-4 4'),
  up: svg('M12 20V4m-6 6 6-6 6 6'), down: svg('M12 4v16m-6-6 6 6 6-6'),
  rise: svg('M3 21h18M12 17V3m-4 4 4-4 4 4'), lower: svg('M3 21h18M12 3v14m-4-4 4 4 4-4'),
  reset: svg('M4 10a8 8 0 1 1 1 8M4 4v6h6'),
};

/** A cinematic itinerary through distinct, completed World Labs worlds. Each
 * chapter has its own SPZ and physical camera corridor; the luminous lift is an
 * explicit transition between generations, never a claim of one shared mesh. */
export function mountParisFlight(host: HTMLElement, options: ParisFlightOptions): ParisFlightHandle {
  const events = new AbortController(), requests = new AbortController(), guard = createParisFlightLoadGuard();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let dead = false, manifest: ParisFlightManifest | undefined, chapterIndex = 0, quality: ParisFlightQuality = 'balanced';
  let viewer: GeneratedWorldHandle | undefined, reader: StoryReaderHandle | undefined, phase = 'opening', tour: GeneratedWorldTourState | undefined;
  let currentPoint = 0, autoContinue = true, sceneReady = false, warmedIndex = -1;
  const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
  let reduced = motion?.matches ?? false;
  const current = () => !dead && !requests.signal.aborted && options.isCurrent();
  const chapter = () => manifest?.chapters[chapterIndex];
  const delay = (callback: () => void, duration: number) => { const timer = setTimeout(() => { timers.delete(timer); if (current()) callback(); }, duration); timers.add(timer); return timer; };
  const cancelTimers = () => { for (const timer of timers) clearTimeout(timer); timers.clear(); };
  const closeReader = () => { reader?.destroy(); reader = undefined; const region = host.querySelector<HTMLElement>('[data-pf-reader]'); if (region) region.hidden = true; };
  const stopViewer = () => { cancelTimers(); closeReader(); viewer?.destroy(); viewer = undefined; sceneReady = false; };

  host.innerHTML = `<main class="paris-flight" data-phase="opening" data-reduced="${reduced}" aria-label="Paris cinematic journey">
    <div class="pf-world" data-pf-world></div><div class="pf-vignette" aria-hidden="true"></div>
    <header class="pf-header"><a class="pf-brand" href="#/home"><img src="/assets/portal-dusk/brand-mark.png" alt=""/><span>GiftPortals</span></a><span class="pf-journey-label">A LITTLE GIFT. AN EXTRAORDINARY JOURNEY.</span><button class="pf-icon" type="button" data-pf-exit aria-label="Close Paris journey">${icons.close}</button></header>
    <a class="pf-keepsake" href="#/generated/paris-example" aria-label="Return to the Paris miniature"><img src="/demo/v22/paris-tripo-reference.png" alt=""/>${giftIcon}<span>Your Paris gift</span></a>
    <section class="pf-scene-heading" aria-live="polite"><span class="pf-eyebrow" data-pf-kicker>PARIS, BEYOND THE POSTCARD</span><h1 data-pf-title>A new point of view.</h1><p data-pf-subtitle>The tower. The sky. The river.</p></section>
    <div class="pf-reader" data-pf-reader hidden></div>
    <div class="pf-lift" data-pf-lift role="status"><div class="pf-lift-rays" aria-hidden="true"></div><div class="pf-lift-core">${icons.tower}<span data-pf-load-title>Opening your journey…</span><p data-pf-load-note>Loading completed 3D scenes.</p><div class="pf-load-track"><span data-pf-load-bar></span></div><button type="button" class="pf-retry" data-pf-retry hidden>Try opening this view again ${icons.reset}</button></div></div>
    <div class="pf-controls"><div class="pf-chapters" data-pf-chapters role="navigation" aria-label="Paris viewpoints"></div><div class="pf-command-row">
      <button type="button" class="pf-play" data-pf-play disabled>${icons.pause}<span>Pause flight</span></button>
      <button type="button" class="pf-icon" data-pf-next aria-label="Next Paris viewpoint" disabled>${icons.next}</button>
      <span class="pf-divider"></span><button type="button" class="pf-story" data-pf-story aria-label="Open the story" disabled>${icons.book}<span>Open the story</span></button>
      <button type="button" class="pf-icon" data-pf-explore aria-label="Show flight controls" aria-expanded="false">${icons.flight}</button>
      <button type="button" class="pf-quality" data-pf-quality hidden>${icons.detail}<span>Balanced</span></button>
    </div><p class="pf-hint" data-pf-hint>Real 3D viewpoints · drag to look around</p></div>
    <aside class="pf-manual" data-pf-manual hidden aria-label="Explore this 3D scene"><div>${[['left', icons.lookLeft, 'Look left'], ['right', icons.lookRight, 'Look right'], ['forward', icons.up, 'Fly forward'], ['backward', icons.down, 'Fly backward'], ['rise', icons.rise, 'Rise'], ['lower', icons.lower, 'Lower'], ['reset', icons.reset, 'Reset view']].map(([id, icon, label]) => `<button type="button" class="pf-icon" data-pf-move="${id}" aria-label="${label}" title="${label}">${icon}</button>`).join('')}</div><p>Drag to look · W A S D to fly · Q / E to descend / rise</p></aside>
  </main>`;
  const root = host.querySelector<HTMLElement>('.paris-flight')!, worldHost = host.querySelector<HTMLElement>('[data-pf-world]')!;
  const get = (selector: string) => host.querySelector<HTMLElement>(selector)!;
  const text = (selector: string, value: string) => { get(selector).textContent = value; };
  function sync() {
    if (!current()) return;
    root.dataset.phase = phase;
    const selected = chapter(), playing = tour?.phase === 'playing';
    const play = get('[data-pf-play]') as HTMLButtonElement;
    play.disabled = !sceneReady; play.innerHTML = `${playing ? icons.pause : icons.play}<span>${playing ? 'Pause flight' : phase === 'finished' ? 'Replay journey' : 'Resume flight'}</span>`;
    (get('[data-pf-next]') as HTMLButtonElement).disabled = !sceneReady;
    (get('[data-pf-story]') as HTMLButtonElement).disabled = !sceneReady;
    const qualityButton = get('[data-pf-quality]'); qualityButton.hidden = innerWidth <= 640 || !selected?.worldUrlFullRes || !selected.fullResBytes || !selected.fullResSplats;
    qualityButton.querySelector('span')!.textContent = quality === 'detailed' ? 'Detailed' : 'Balanced';
    text('[data-pf-hint]', reduced ? 'Reduced motion · choose any viewpoint to explore' : phase === 'paused' ? 'Flight paused · drag to explore · resume when you are ready' : phase === 'finished' ? 'A little world to return to. Replay or open your gift.' : tour?.stage === 'reading' ? 'Take in the view · open its story or keep flying' : 'Drag to look around · movement pauses the guided flight');
    get('[data-pf-chapters]').querySelectorAll<HTMLButtonElement>('[data-pf-chapter]').forEach(button => { const active = button.dataset.pfChapter === selected?.id; button.setAttribute('aria-current', active ? 'step' : 'false'); button.classList.toggle('is-current', active); });
  }
  function setLift(visible: boolean, title?: string, note?: string) {
    get('[data-pf-lift]').classList.toggle('is-hidden', !visible);
    get('[data-pf-lift]').setAttribute('aria-hidden', String(!visible));
    if (title) text('[data-pf-load-title]', title); if (note) text('[data-pf-load-note]', note);
    get('[data-pf-retry]').hidden = true;
  }
  function showError(message: string) {
    if (!current()) return; sceneReady = false; phase = 'error';
    setLift(true, 'This view could not open.', message); get('[data-pf-retry]').hidden = false; sync();
  }
  function openStory() {
    const selected = chapter(); if (!current() || !sceneReady || !selected) return;
    autoContinue = false; viewer?.pauseTour('user'); phase = 'paused'; closeReader();
    const region = get('[data-pf-reader]'); region.hidden = false;
    reader = mountStoryReader(region, { isCurrent: current, onClose: () => { closeReader(); sync(); } });
    const story = selected.stories[Math.min(currentPoint, selected.stories.length - 1)];
    reader.update({ mode: story.mode, title: story.title, body: story.body, eyebrow: selected.title, worldTitle: manifest!.title, index: chapterIndex, count: manifest!.chapters.length, playback: 'still', note: 'An artistic interpretation of Paris, made as a digital gift.', closeLabel: 'Return to the view' }); reader.focus(); sync();
  }
  async function warmNext(index: number) {
    const next = manifest?.chapters[index]; if (!current() || !next?.worldUrl || warmedIndex === index) return;
    warmedIndex = index;
    // Metadata warming only: no second WebGL renderer, no large panorama bitmap,
    // and no unbounded background SPZ download on an 8 GB device.
    try { await fetch(next.worldUrl, { method: 'HEAD', signal: requests.signal, credentials: 'omit', redirect: 'error' }); } catch { /* Opening the actual chapter owns its error UI. */ }
  }
  function nextChapter() {
    if (!manifest || !current()) return;
    const next = manifest.chapters.findIndex((entry, index) => index > chapterIndex && entry.status === 'complete');
    if (next < 0) { autoContinue = false; phase = 'finished'; viewer?.pauseTour('user'); sync(); return; }
    void openChapter(next, !reduced);
  }
  async function openChapter(index: number, autoplay = true) {
    const selected = manifest?.chapters[index]; if (!selected || selected.status !== 'complete' || !current()) return;
    const token = guard.next(); stopViewer(); chapterIndex = index; currentPoint = 0; tour = undefined; autoContinue = autoplay && !reduced; phase = 'opening';
    const asset = parisFlightAsset(selected, innerWidth, quality); if (!asset) { showError('The completed world is not available yet.'); return; }
    text('[data-pf-kicker]', `${String(index + 1).padStart(2, '0')} / ${String(manifest!.chapters.length).padStart(2, '0')} · PARIS`);
    text('[data-pf-title]', selected.title); text('[data-pf-subtitle]', selected.subtitle);
    const transition = selected.id === 'summit' ? 'Rising above Paris…' : selected.id === 'riverside' ? 'Returning to the river…' : 'Arriving in the city of light…';
    setLift(true, transition, 'A new view is waiting beyond the light.'); get('[data-pf-load-bar]').style.width = '2%'; sync();
    const active = () => current() && guard.current(token);
    try {
      const check = await fetch(asset.url, { method: 'HEAD', signal: requests.signal, credentials: 'omit', redirect: 'error' });
      if (!active()) return;
      if (!check.ok || /text\/html/i.test(check.headers.get('content-type') || '') || Number(check.headers.get('content-length')) > asset.byteLimit) throw new Error('The completed 3D asset is unavailable. Reopen the journey after the preview is refreshed.');
      viewer = mountGeneratedWorld(worldHost, asset.url, {
        points: selected.route.viewpoints.map(point => ({ id: point.pointId, position: point.pose.target })),
        authoredRoute: selected.route, flightTiming: { arrivalMs: 14000, travelMs: 8500, readingMs: 6000 },
        initialYaw: selected.initialYaw, initialPitch: selected.initialPitch, collisionUrl: selected.collisionUrl,
        panoramaUrl: selected.panoramaUrl, panoramaYaw: selected.panoramaYaw,
        freeFlight: true, manualRadius: 4, manualStep: .32, scenicDrift: .18, maxSplats: asset.maxSplats, byteLimit: asset.byteLimit,
        onCameraPose(pose) { if (active()) { worldHost.dataset.cameraPosition = JSON.stringify(pose.position.map(value => Number(value.toFixed(4)))); worldHost.dataset.cameraTarget = JSON.stringify(pose.target.map(value => Number(value.toFixed(4)))); } },
        onProgress(state) { if (!active()) return; get('[data-pf-load-bar]').style.width = `${state.totalBytes ? Math.min(92, state.loadedBytes / state.totalBytes * 92) : state.phase === 'decoding' ? 94 : 12}%`; text('[data-pf-load-note]', state.phase === 'decoding' ? 'The world is becoming a place you can explore…' : `Opening the ${asset.label.toLowerCase()} view…`); },
        onReady() {
          if (!active()) return; sceneReady = true; get('[data-pf-load-bar]').style.width = '100%';
          delay(() => { if (!active()) return; viewer?.startTour(); if (!autoContinue) viewer?.pauseTour('user'); phase = autoContinue ? 'flying' : 'paused'; setLift(false); sync(); }, reduced ? 0 : 500);
          void warmNext(index + 1);
        },
        onError(message) { if (active()) showError(message); },
        onTourChange(state) {
          if (!active()) return; tour = state; currentPoint = state.index;
          if (state.phase === 'playing') phase = 'flying';
          if (state.phase === 'paused') { phase = 'paused'; if (state.reason === 'manual' || state.reason === 'hidden' || state.reason === 'offscreen' || state.reason === 'motion') autoContinue = false; }
          if (state.phase === 'completed') { phase = 'paused'; if (autoContinue && !reduced) delay(() => { if (active() && autoContinue && tour?.phase === 'completed') nextChapter(); }, 1200); }
          sync();
        },
      });
    } catch (error) { if (active()) showError(error instanceof Error ? error.message : 'This 3D view could not load.'); }
  }
  host.addEventListener('click', event => {
    if (!current()) return; const button = (event.target as Element).closest<HTMLElement>('button'); if (!button) return;
    if (button.hasAttribute('data-pf-exit')) options.onExit();
    else if (button.hasAttribute('data-pf-chapter')) { const index = manifest?.chapters.findIndex(entry => entry.id === button.dataset.pfChapter); if (index !== undefined && index >= 0) void openChapter(index, !reduced); }
    else if (button.hasAttribute('data-pf-play')) {
      closeReader(); if (phase === 'finished') { void openChapter(0, !reduced); return; }
      if (tour?.phase === 'playing') { autoContinue = false; viewer?.pauseTour('user'); }
      else if (tour?.phase === 'completed') { autoContinue = true; nextChapter(); }
      else { autoContinue = true; if (!viewer?.resumeTour() && reduced) viewer?.nextTour(); } sync();
    }
    else if (button.hasAttribute('data-pf-next')) { autoContinue = !reduced; closeReader(); if (tour?.phase === 'completed') nextChapter(); else viewer?.nextTour(); }
    else if (button.hasAttribute('data-pf-story')) openStory();
    else if (button.hasAttribute('data-pf-explore')) { const manual = get('[data-pf-manual]'); manual.hidden = !manual.hidden; button.setAttribute('aria-expanded', String(!manual.hidden)); if (!manual.hidden) { autoContinue = false; viewer?.pauseTour('manual'); worldHost.focus({ preventScroll: true }); } sync(); }
    else if (button.hasAttribute('data-pf-quality')) { quality = quality === 'balanced' ? 'detailed' : 'balanced'; void openChapter(chapterIndex, autoContinue); }
    else if (button.hasAttribute('data-pf-retry')) { if (manifest) void openChapter(chapterIndex, !reduced); else void load(); }
    else if (button.hasAttribute('data-pf-move') && viewer) {
      autoContinue = false; closeReader(); const command = button.dataset.pfMove;
      if (command === 'left') viewer.look(.18, 0); else if (command === 'right') viewer.look(-.18, 0); else if (command === 'forward') viewer.forward(); else if (command === 'backward') viewer.backward(); else if (command === 'rise') viewer.elevate(1); else if (command === 'lower') viewer.elevate(-1); else if (command === 'reset') { viewer.reset(); viewer.startTour(); viewer.pauseTour('user'); } sync();
    }
  }, { signal: events.signal });
  const motionChanged = () => { reduced = motion?.matches ?? false; root.dataset.reduced = String(reduced); if (reduced) { autoContinue = false; cancelTimers(); if (sceneReady && phase === 'opening') { viewer?.startTour(); setLift(false); } viewer?.pauseTour('motion'); } sync(); };
  motion?.addEventListener('change', motionChanged);
  async function load() {
    setLift(true, 'Opening your journey…', 'Loading completed 3D viewpoints.');
    try {
      const response = await fetch('/demo/v23/paris-flight.json', { signal: requests.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
      if (!current()) return; if (!response.ok || /text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('The new Paris viewpoints are still being prepared. Return to the gift collection and reopen this journey when they are ready.');
      manifest = readParisFlightManifest(await response.json()); if (!current()) return;
      if (!manifest) throw new Error('The journey manifest is incomplete. No provisional scene was substituted.');
      get('[data-pf-chapters]').innerHTML = manifest.chapters.map((entry, index) => `<button type="button" data-pf-chapter="${entry.id}" ${entry.status === 'complete' ? '' : 'disabled'} aria-label="Go to ${escape(entry.title)}"><span class="pf-chapter-number">${String(index + 1).padStart(2, '0')}</span><span>${escape(entry.title)}</span><span class="pf-chapter-track" aria-hidden="true"></span></button>`).join('');
      const first = manifest.chapters.findIndex(entry => entry.status === 'complete'); if (first < 0) throw new Error('The real 3D chapters are still generating. There is no completed scene to open yet.');
      void openChapter(first, !reduced);
    } catch (error) { if (current()) showError(error instanceof Error ? error.message : 'The journey could not open.'); }
  }
  void load();
  function destroy() { if (dead) return; dead = true; guard.destroy(); requests.abort(); events.abort(); motion?.removeEventListener('change', motionChanged); stopViewer(); host.replaceChildren(); }
  return { destroy };
}
