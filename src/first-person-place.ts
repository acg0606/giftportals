import './first-person-place.css';
import { mountGeneratedWorld, type GeneratedWorldHandle } from './generated-world';
import { mountStoryReader, type StoryReaderHandle } from './story-reader';
import { giftIcon } from './gift-icon';
import { safeGiftWalkHref, walkSceneFirstPerson, type WalkScene } from './gift-walk-types';
import type { StoryReaderMode } from './story-reader';
export type { WalkScene } from './gift-walk-types';

const esc = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

const svg = (path: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
const icons = { walk: svg('M13 4h.01M12 8l-2 5 4 3 2 5M10 13l-3 8m3-9-4 1m6-5 3 5 4 1'), close: svg('m6 6 12 12M18 6 6 18'), reset: svg('M4 10a8 8 0 1 1 1 8M4 4v6h6'), mouse: svg('M12 3a6 6 0 0 0-6 6v6a6 6 0 0 0 12 0V9a6 6 0 0 0-6-6ZM12 3v7'), up: svg('M12 20V4m-6 6 6-6 6 6'), left: svg('M20 12H4m6-6-6 6 6 6'), right: svg('M4 12h16m-6-6 6 6-6 6'), down: svg('M12 4v16m-6-6 6 6 6-6'), book: svg('M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15'), pause: svg('M8 5v14M16 5v14') };

export const WALK_SCENES = [
  { id: 'tower', title: 'A walk toward the tower', name: 'The tower gardens', world: '/demo/v23/paris-approach-world.spz', collider: '/demo/v23/paris-approach-collider.glb', panorama: '/demo/v23/paris-approach-panorama.png', metricScale: 2.9049978, groundOffset: 1.6893421, spawn: [0, 1.329693672, 0] as const, yaw: 0, pitch: .18, livingGarden: false, intro: 'Walk toward the tower.\nTurn your head. Take your time.', story: 'Look up through the branches. Walk closer and watch the tower rise between them. A familiar silhouette becomes a place around you, and a memory becomes somewhere to return.' },
] as const satisfies readonly WalkScene[];

export interface FirstPersonPlaceOptions {
  isCurrent(): boolean;
  onExit(): void;
  scenes?: readonly WalkScene[];
  giftTitle?: string;
  giftHref?: string;
  intro?: string;
  journalMode?: StoryReaderMode;
}
export function mountFirstPersonPlace(host: HTMLElement, options: FirstPersonPlaceOptions) {
  const scenes: readonly WalkScene[] = options.scenes ?? WALK_SCENES;
  const defaultParis = options.scenes === undefined;
  const giftTitle = options.giftTitle?.trim() || (defaultParis ? 'A little Paris' : 'Your gift');
  const giftHref = safeGiftWalkHref(options.giftHref, defaultParis ? '#/generated/paris-example?from=room' : '#/collection');
  const events = new AbortController(); let dead = false, epoch = 0, selected = 0, readerVersion = 0;
  let viewer: GeneratedWorldHandle | undefined, reader: StoryReaderHandle | undefined;
  let rendered = false, physics = false, active = false, failed = false, pressed: number | undefined, strolling = false, strollStartDistance = 0;
  let arrivalViewpoint: string | undefined, selectedViewpoint: string | undefined;
  const viewpointIds = new Set<string>();
  const current = (token = epoch) => !dead && token === epoch && options.isCurrent();
  host.innerHTML = `<main class="first-person-place" data-state="loading" aria-label="${esc(`Walk through ${giftTitle}`)}">
    <div class="wp-world" data-wp-world></div><div class="wp-shade" aria-hidden="true"></div>
    <header class="wp-header"><a href="#/home" class="wp-brand"><img src="/assets/portal-dusk/brand-mark.png" alt=""/>GiftPortals</a><button type="button" class="wp-icon" data-wp-exit aria-label="${esc(`Close the walk through ${giftTitle}`)}">${icons.close}</button></header>
    <div class="wp-place"><span>YOUR MEMORY, AROUND YOU</span><h1 data-wp-title></h1><nav aria-label="Choose a walking place" ${scenes.length ? '' : 'hidden'}>${scenes.map((scene, index) => `<button type="button" data-wp-scene="${index}" aria-pressed="${index === 0}">${esc(scene.name)}</button>`).join('')}</nav><nav data-wp-viewpoints aria-label="Choose a supported walking viewpoint" hidden></nav></div>
    <a href="${esc(giftHref)}" class="wp-gift" aria-label="${esc(`Return to ${giftTitle}`)}">${giftIcon}</a>
    <div class="wp-reticle" aria-hidden="true"></div>
    <section class="wp-invite" data-wp-invite><div class="wp-step-symbol">${icons.walk}</div><h2>Be here.</h2><p data-wp-intro></p><button type="button" data-wp-start disabled>${icons.walk}<span>Opening your place…</span></button><div class="wp-key-hint"><span>W</span><span>A</span><span>S</span><span>D</span><small>walk · drag to look</small></div></section>
    <div class="wp-reader" data-wp-reader hidden></div>
    <div class="wp-pad" data-wp-pad role="group" aria-label="Hold a direction to walk"><button type="button" data-wp-move="forward" aria-label="Walk forward">${icons.up}</button><button type="button" data-wp-move="left" aria-label="Walk left">${icons.left}</button><span>${icons.walk}</span><button type="button" data-wp-move="right" aria-label="Walk right">${icons.right}</button><button type="button" data-wp-move="backward" aria-label="Walk backward">${icons.down}</button><small>Hold to walk</small></div>
    <div class="wp-actions"><button type="button" data-wp-stroll disabled aria-label="Take a short stroll" aria-pressed="false">${icons.walk}<span>Stroll</span></button><button type="button" data-wp-mouse disabled aria-label="Enter mouse look">${icons.mouse}<span>Mouse look</span></button><button type="button" data-wp-story disabled aria-label="Journal">${icons.book}<span>Journal</span></button><button type="button" data-wp-pause disabled aria-label="Pause walking">${icons.pause}</button><button type="button" data-wp-reset disabled aria-label="Return to the starting point">${icons.reset}</button></div>
    <p class="wp-hint" data-wp-hint role="status">Opening the scene and its paths…</p>
  </main>`;
  const get = <T extends HTMLElement = HTMLElement>(name: string) => host.querySelector<T>(`[data-wp-${name}]`)!;
  const root = host.querySelector<HTMLElement>('main')!, world = get('world');
  get('intro').style.whiteSpace = 'pre-line';
  get('viewpoints').style.marginTop = '6px';
  get('viewpoints').style.flexWrap = 'wrap';
  get('viewpoints').style.maxWidth = 'min(560px, calc(100vw - 88px))';
  function sync() {
    if (!current()) return;
    const ready = rendered && physics && !failed;
    root.dataset.state = failed ? 'error' : !ready ? 'loading' : active ? 'walking' : 'ready';
    get<HTMLButtonElement>('start').disabled = !ready;
    get('start').querySelector('span')!.textContent = ready ? 'Start walking' : failed ? 'This place could not open' : 'Opening your place…';
    for (const name of ['stroll', 'mouse', 'story', 'pause', 'reset']) get<HTMLButtonElement>(name).disabled = !ready;
    get('viewpoints').querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = !ready; });
    get('stroll').setAttribute('aria-pressed', String(strolling));
    get('invite').hidden = active;
    get('pad').hidden = !active;
    get<HTMLButtonElement>('pause').setAttribute('aria-label', active ? 'Pause walking' : 'Resume walking');
    get('pause').innerHTML = active ? icons.pause : icons.walk;
    if (ready) get('hint').textContent = active ? 'Hold W A S D or a direction to walk · drag to look · Shift to walk faster' : 'Your place is ready. Start walking when you are ready.';
  }
  const stopStroll = () => { strolling = false; viewer?.setMoveInput(0, 0); get('stroll').setAttribute('aria-pressed', 'false'); };
  const stop = () => { stopStroll(); viewer?.setWalking(false); active = false; pressed = undefined; sync(); };
  const start = () => { if (!current() || !rendered || !physics || failed) return; active = Boolean(viewer?.setWalking(true)); world.focus({ preventScroll: true }); sync(); };
  const closeReader = () => { readerVersion++; reader?.destroy(); reader = undefined; get('reader').hidden = true; };
  function openScene(index: number) {
    const scene = scenes[index]; if (!scene || dead) return;
    const token = ++epoch; viewer?.destroy(); closeReader(); selected = index; pressed = undefined; rendered = physics = active = failed = strolling = false;
    viewpointIds.clear(); arrivalViewpoint = selectedViewpoint = undefined; get('viewpoints').replaceChildren(); get('viewpoints').hidden = true;
    get('title').textContent = scene.title;
    get('intro').textContent = scene.intro || options.intro || 'Walk into this memory. Turn your head. Take your time.';
    root.setAttribute('aria-label', `Walk through ${giftTitle}: ${scene.name}`);
    host.querySelectorAll<HTMLButtonElement>('[data-wp-scene]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.wpScene) === selected)));
    get('hint').textContent = 'Opening the scene and its paths…'; sync();
    const firstPerson = { ...walkSceneFirstPerson(scene), livingGarden: false };
    viewer = mountGeneratedWorld(world, scene.world, { points: [], collisionUrl: scene.collider, panoramaUrl: scene.panorama, initialYaw: scene.yaw, initialPitch: scene.pitch,
      firstPerson,
      onReady() { if (current(token)) { rendered = true; sync(); } },
      onError(message) { if (current(token)) { failed = true; sync(); get('hint').textContent = message; } },
      onWalkingChange(state) { if (current(token)) { physics = state.available; active = state.enabled; sync(); } },
      onWalkingViewpoints(points) {
        if (!current(token) || scenes.length !== 1 || !firstPerson.autoCalibrate) return;
        const buttons: HTMLButtonElement[] = []; viewpointIds.clear(); arrivalViewpoint = undefined;
        for (const point of points) {
          if (!point || typeof point.id !== 'string' || !point.id || point.id.length > 120 || viewpointIds.has(point.id) || typeof point.name !== 'string' || !point.name.trim() ||
            !Array.isArray(point.position) || point.position.length !== 3 || !point.position.every(Number.isFinite) || !Number.isFinite(point.yaw)) continue;
          const button = document.createElement('button'); button.type = 'button'; button.setAttribute('data-wp-viewpoint', point.id); button.textContent = point.name;
          button.disabled = true;
          viewpointIds.add(point.id); if (!arrivalViewpoint || point.id === 'arrival' || point.name.trim().toLowerCase() === 'arrival') arrivalViewpoint = point.id; buttons.push(button);
          if (buttons.length === 6) break;
        }
        selectedViewpoint = selectedViewpoint && viewpointIds.has(selectedViewpoint) ? selectedViewpoint : arrivalViewpoint;
        buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.wpViewpoint === selectedViewpoint)));
        get('viewpoints').replaceChildren(...buttons); get('viewpoints').hidden = buttons.length === 0; sync();
      },
      onFrameStats(state) { if (current(token)) world.dataset.renderFps = state.framesPerSecond.toFixed(1); },
      onGardenState(state) { if (current(token)) { world.dataset.gardenActors = String(state.actors); world.dataset.gardenPlaying = String(state.playing); world.dataset.gardenPositions = JSON.stringify(state.positions.map(position => position.map(value => Number(value.toFixed(4))))); } },
      onCameraPose(pose) { if (current(token)) { world.dataset.cameraPosition = JSON.stringify(pose.position.map(value => Number(value.toFixed(4)))); world.dataset.cameraTarget = JSON.stringify(pose.target.map(value => Number(value.toFixed(4)))); } },
      onFirstPersonState(state) { if (!current(token)) return; physics = state.ready; world.dataset.walkDistance = state.distance.toFixed(3); world.dataset.grounded = String(state.grounded); root.dataset.mouseLook = String(state.locked); if (strolling && state.distance - strollStartDistance >= 10) { stopStroll(); sync(); } if (!state.ready) { failed = true; sync(); get('hint').textContent = 'This place has no usable walking path. Return to your gift and reopen the place.'; } },
    });
  }
  const input = (button: HTMLElement) => { if (!current() || !rendered || !physics || failed) return; stopStroll(); if (!active) start(); if (!active) return; const direction = button.dataset.wpMove; viewer?.setMoveInput(direction === 'left' ? -1 : direction === 'right' ? 1 : 0, direction === 'forward' ? 1 : direction === 'backward' ? -1 : 0); };
  host.addEventListener('click', event => {
    if (!current()) return; const button = (event.target as Element).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
    if (button.hasAttribute('data-wp-exit')) options.onExit();
    else if (button.hasAttribute('data-wp-scene')) openScene(Number(button.dataset.wpScene));
    else if (button.hasAttribute('data-wp-viewpoint')) {
      const id = button.dataset.wpViewpoint;
      if (!id || !button.isConnected || !viewpointIds.has(id) || !rendered || !physics || failed) return;
      const resumeWalking = active; stopStroll(); pressed = undefined; closeReader();
      if (viewer?.setWalkingViewpoint(id)) {
        active = Boolean(viewer.setWalking(resumeWalking));
        selectedViewpoint = id;
        get('viewpoints').querySelectorAll<HTMLButtonElement>('button').forEach(viewpoint => viewpoint.setAttribute('aria-pressed', String(viewpoint.dataset.wpViewpoint === id)));
        world.focus({ preventScroll: true }); sync();
      } else { sync(); get('hint').textContent = 'This viewpoint could not open. Stay on the current path or return to your gift.'; }
    }
    else if (button.hasAttribute('data-wp-start')) start();
    else if (button.hasAttribute('data-wp-stroll')) { if (strolling) stopStroll(); else { start(); if (active) { strollStartDistance = Number(world.dataset.walkDistance || 0); strolling = true; viewer?.setMoveInput(0, 1); } } sync(); }
    else if (button.hasAttribute('data-wp-mouse')) { stopStroll(); start(); const mouseEpoch = epoch; if (active) void viewer?.lockPointer().then(locked => { if (current(mouseEpoch)) get('hint').textContent = locked ? 'Move the mouse to look · W A S D to walk · Escape releases the mouse' : 'Drag the view to look · hold W A S D or the arrows to walk'; }); }
    else if (button.hasAttribute('data-wp-pause')) active ? stop() : start();
    else if (button.hasAttribute('data-wp-reset')) { stopStroll(); viewer?.reset(); selectedViewpoint = arrivalViewpoint; get('viewpoints').querySelectorAll<HTMLButtonElement>('button').forEach(viewpoint => viewpoint.setAttribute('aria-pressed', String(viewpoint.dataset.wpViewpoint === selectedViewpoint))); world.focus({ preventScroll: true }); }
    else if (button.hasAttribute('data-wp-story')) { const scene = scenes[selected]; if (!scene) return; stop(); closeReader(); get('invite').hidden = true; get('reader').hidden = false; const readerEpoch = epoch, storyVersion = ++readerVersion; reader = mountStoryReader(get('reader'), { isCurrent: () => current(readerEpoch) && storyVersion === readerVersion, onClose() { if (!current(readerEpoch) || storyVersion !== readerVersion) return; closeReader(); start(); } }); reader.update({ mode: scene.journalMode || options.journalMode || 'book', title: scene.title, body: scene.story, eyebrow: 'A moment to keep', worldTitle: giftTitle, index: selected, count: scenes.length, playback: 'still', note: 'An artistic interpretation, made as a digital gift.', closeLabel: 'Return to the walk' }); reader.focus(); }
  }, { signal: events.signal });
  host.addEventListener('pointerdown', event => { const button = (event.target as Element).closest<HTMLElement>('[data-wp-move]'); if (!current() || !rendered || !physics || failed || !button || pressed !== undefined) return; event.preventDefault(); pressed = event.pointerId; button.setPointerCapture(event.pointerId); input(button); }, { signal: events.signal });
  const release = (event: PointerEvent) => { if (event.pointerId === pressed) { pressed = undefined; viewer?.setMoveInput(0, 0); } };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) host.addEventListener(type, release, { signal: events.signal });
  host.addEventListener('keydown', event => { if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(event.key.toLowerCase()) && strolling) stopStroll(); const button = (event.target as Element).closest<HTMLElement>('[data-wp-move]'); if (button && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); input(button); } }, { signal: events.signal });
  host.addEventListener('keyup', event => { if ([' ', 'Enter'].includes(event.key)) viewer?.setMoveInput(0, 0); }, { signal: events.signal });
  window.addEventListener('blur', () => { pressed = undefined; stopStroll(); }, { signal: events.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pressed = undefined; stopStroll(); } }, { signal: events.signal });
  if (scenes.length) openScene(0);
  else { failed = true; get('title').textContent = giftTitle; get('intro').textContent = 'Return to your gift to explore its available view.'; sync(); get('hint').textContent = 'This gift has no usable walking scene. Return to your gift to explore its available view.'; }
  return { destroy() { if (dead) return; dead = true; epoch++; events.abort(); viewer?.destroy(); closeReader(); host.replaceChildren(); } };
}
