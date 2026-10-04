import './collection-room.css';
import { giftIcon } from './gift-icon';
import type { CollectionMood, CollectionProjection, CollectionRoomItem, CollectionRoomOptions, CollectionSceneHandle } from './collection-types';
export type { CollectionRoomOptions } from './collection-types';
export interface CollectionRoomHandle { destroy(): void }

const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const drawings: Record<string, string> = {
  conveyor: '<path d="M3 16h18M5 20h14M7 16V9h10v7M7 9l5-4 5 4M12 5v11"/><circle cx="6" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  orbit: '<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="4"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7"/>',
  left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>',
  closer: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>',
  farther: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6"/>',
  lamp: '<path d="m7 3-3 10h16L17 3H7ZM12 13v8m-4 0h8M17 13v4"/>',
  reset: '<path d="M3 9h5M3 9V4m0 5a9 9 0 1 1 0 6M12 7v5l3 2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${drawings[name] || drawings.conveyor}</svg>`;
const control = (name: string, glyph: string, label: string) => `<button type="button" class="cr-icon-button" data-cr-control="${name}" aria-label="${label}" title="${label}">${icon(glyph)}<span class="cr-tooltip" aria-hidden="true">${label}</span></button>`;
let sequence = 0;

/** Source thumbnails are decoration only; routes remain delegated to the owner. */
function imageUrl(item: CollectionRoomItem): string {
  if (item.mediaExpiresAt && item.mediaExpiresAt <= Date.now() / 1000) return '';
  const value = item.imageUrl?.trim() || '';
  if (!value || /[\u0000-\u001f]/.test(value)) return '';
  if (/^\/(?!\/)/.test(value) || /^blob:/i.test(value)) return value;
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : ''; }
  catch { return ''; }
}

/** A room shell for authorized gifts. It never fetches gift records, starts
 * generation, changes access, or persists a photo, route or capability. */
export function mountCollectionRoom(host: HTMLElement, options: CollectionRoomOptions): CollectionRoomHandle {
  const previousClass = host.className, events = new AbortController(), instance = ++sequence;
  const items = options.items.filter((item, index, all) => item && typeof item.id === 'string' && all.findIndex(candidate => candidate.id === item.id) === index);
  const pages = Math.max(1, Math.ceil(items.length / 6));
  const byId = new Map(items.map(item => [item.id, item]));
  let dead = false, page = 0, epoch = 0, selected: string | null = null, mood: CollectionMood = 'sunset';
  let scene: CollectionSceneHandle | undefined, pageEvents = new AbortController(), sceneReady = false;
  let latestProjection: readonly CollectionProjection[] = [];
  let expiryTimer: number | undefined;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let playing = items.length > 0 && !reducedMotion.matches, pendingIndex = 0;
  let roomPhase: 'loading' | 'ready' | 'unavailable' = 'loading';
  let drawerReturn: HTMLElement | null = null;
  const hotspots = new Map<string, HTMLButtonElement>();
  const active = () => !dead && host.isConnected && options.isCurrent();
  host.className = 'collection-room'; host.dataset.mood = mood; host.dataset.playing = String(playing);
  host.innerHTML = `<section class="cr-stage" data-cr-stage tabindex="0" aria-label="Memory desk. Left and right arrows move between gifts; Space pauses or plays."><div class="cr-scene" data-cr-scene></div><div class="cr-hotspots" data-cr-hotspots></div></section>
    <header class="cr-header"><button class="cr-brand" type="button" data-cr-home aria-label="GiftPortals home"><img src="/assets/portal-dusk/brand-mark.png" alt=""/><span>GiftPortals</span></button><nav aria-label="Collection actions"><button class="cr-icon-button" type="button" data-cr-home aria-label="Home" title="Home">${icon('home')}</button><button type="button" class="cr-glass-button cr-drawer-trigger" data-cr-drawer-open aria-controls="cr-drawer-${instance}" aria-expanded="false">${giftIcon}<span>Gifts <small>${items.length}</small></span></button><button class="cr-create" type="button" data-cr-create>${giftIcon}<span>Create a gift</span></button></nav></header>
    <div class="cr-room-title"><span class="cr-eyebrow">LITTLE THINGS. LASTING CONNECTIONS.</span><h1>${esc(options.title)}</h1><p>A little world appears on your desk. Tap it to open.</p><span class="cr-sr-only">${esc(options.subtitle)}</span></div>
    <div class="cr-page-control" data-cr-pagination ${pages === 1 ? 'hidden' : ''}><button type="button" class="cr-icon-button" data-cr-page="previous" aria-label="Previous set" title="Previous set">${icon('left')}</button><span data-cr-page-label></span><button type="button" class="cr-icon-button" data-cr-page="next" aria-label="Next set" title="Next set">${icon('right')}</button></div>
    <div class="cr-loading" data-cr-loading><div class="cr-loading-panel"><span class="cr-loading-mark" aria-hidden="true">${giftIcon}</span><p data-cr-status role="status" aria-live="polite">Opening your 3D memory desk…</p><button type="button" class="cr-primary" data-cr-retry hidden>Try again</button><button type="button" class="cr-glass-button" data-cr-browse hidden>Browse gifts</button></div></div>
    <div class="cr-empty" data-cr-empty ${items.length ? 'hidden' : ''}>${giftIcon}<h2>A memory starts here.</h2><p>Choose a photo. Make a little world for someone.</p><button type="button" class="cr-primary" data-cr-create>${giftIcon}<span>Create a gift</span></button></div>
    <aside class="cr-detail" data-cr-detail hidden aria-labelledby="cr-selected-title-${instance}"><button type="button" class="cr-detail-close cr-icon-button" data-cr-clear aria-label="Back to the desk" title="Back to the desk">${icon('close')}</button><div class="cr-detail-identity"><div class="cr-detail-image"><img data-cr-selected-image alt="" hidden/><span data-cr-selected-placeholder data-cr-image-placeholder>${giftIcon}</span></div><div><span class="cr-eyebrow" data-cr-selected-kind></span><h2 id="cr-selected-title-${instance}" data-cr-selected-title tabindex="-1"></h2><p data-cr-selected-subtitle></p></div></div><p class="cr-selected-story" data-cr-selected-story></p><div class="cr-detail-actions"><button type="button" class="cr-primary" data-cr-open>${giftIcon}<span>Open gift</span></button><button type="button" class="cr-glass-button" data-cr-world hidden>${icon('globe')}<span>Step inside</span></button></div></aside>
    <footer class="cr-footer"><span class="cr-room-hint" data-cr-hint><span class="cr-live-light" aria-hidden="true"></span><span data-cr-playback-label>Memories in motion</span></span><div class="cr-controls" aria-label="Desk controls">${control('previous', 'left', 'Previous gift')}<button type="button" class="cr-icon-button cr-playback" data-cr-play aria-pressed="${playing}" aria-label="${playing ? 'Pause desk' : 'Play desk'}" title="${playing ? 'Pause desk' : 'Play desk'}">${icon(playing ? 'pause' : 'play')}</button>${control('next', 'right', 'Next gift')}<span class="cr-control-divider" aria-hidden="true"></span>${control('closer', 'closer', 'Move closer')}${control('farther', 'farther', 'Move back')}<button type="button" class="cr-icon-button cr-mood" data-cr-mood aria-pressed="false" aria-label="Switch to night lighting" title="Switch to night lighting">${icon('lamp')}</button>${control('reset', 'orbit', 'Reset view')}</div></footer>
    <dialog class="cr-drawer" id="cr-drawer-${instance}" data-cr-drawer aria-labelledby="cr-drawer-title-${instance}"><header><div>${giftIcon}<h2 id="cr-drawer-title-${instance}">Your gifts</h2></div><button class="cr-icon-button" type="button" data-cr-drawer-close aria-label="Close gift list" title="Close gift list">${icon('close')}</button></header><p>Choose a memory to bring it into focus.</p><ul data-cr-list></ul><footer>${options.onManage ? '<button type="button" class="cr-glass-button" data-cr-manage>Manage collection</button>' : ''}<button class="cr-primary" type="button" data-cr-create>${giftIcon}<span>Create a gift</span></button></footer></dialog>`;
  const find = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const stage = find('[data-cr-stage]'), sceneHost = find('[data-cr-scene]'), loading = find('[data-cr-loading]'), tray = find('[data-cr-detail]'), drawer = find<HTMLDialogElement>('[data-cr-drawer]');
  const on = (selector: string, callback: (event: Event) => void, signal = events.signal) => host.querySelectorAll<HTMLElement>(selector).forEach(element => element.addEventListener('click', callback, { signal }));
  const text = (selector: string, value: string) => { find(selector).textContent = value; };
  const currentItems = () => items.slice(page * 6, page * 6 + 6);
  const chosen = () => items.find(item => item.id === selected);

  function syncPlayback(next: boolean, delegate = true) {
    if (!active()) return;
    playing = next && items.length > 0 && !reducedMotion.matches;
    host.dataset.playing = String(playing);
    const button = find<HTMLButtonElement>('[data-cr-play]'), label = playing ? 'Pause desk' : 'Play desk';
    button.disabled = roomPhase !== 'ready' || !items.length || reducedMotion.matches; button.setAttribute('aria-pressed', String(playing)); button.setAttribute('aria-label', label); button.setAttribute('title', reducedMotion.matches ? 'Reduced motion · use the arrows' : label); button.innerHTML = icon(playing ? 'pause' : 'play');
    text('[data-cr-playback-label]', reducedMotion.matches ? 'Reduced motion · use the arrows' : playing ? 'Memories in motion' : 'Paused · choose a gift');
    if (delegate) scene?.setPlaying(playing);
  }
  function positionPending(index: number) {
    const pageItems = currentItems(); if (!pageItems.length) return;
    pendingIndex = (index % pageItems.length + pageItems.length) % pageItems.length;
  }
  function togglePlayback() {
    if (!active() || !items.length || reducedMotion.matches) return;
    const next = !playing;
    if (next && selected) selectItem(null, false);
    syncPlayback(next);
  }
  function stepConveyor(direction: -1 | 1) {
    if (!active() || !currentItems().length) return;
    syncPlayback(false); if (selected) selectItem(null, false);
    scene?.step(direction); if (!sceneReady) positionPending(pendingIndex + direction);
  }

  function closeDrawer(restore = true) {
    if (!drawer.open && !drawer.hasAttribute('open')) return;
    if (typeof drawer.close === 'function') drawer.close(); else drawer.removeAttribute('open');
    find('[data-cr-drawer-open]').setAttribute('aria-expanded', 'false');
    if (restore && active()) (drawerReturn || find('[data-cr-drawer-open]')).focus({ preventScroll: true });
    drawerReturn = null;
  }
  function showDrawer() {
    if (!active()) return;
    syncPlayback(false);
    refreshExpiredImages();
    drawerReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try { drawer.showModal(); } catch { drawer.setAttribute('open', ''); }
    find('[data-cr-drawer-open]').setAttribute('aria-expanded', 'true');
    (drawer.querySelector<HTMLElement>('[data-cr-list] button[aria-current="true"]') || drawer.querySelector<HTMLElement>('[data-cr-list] button') || find('[data-cr-drawer-close]')).focus({ preventScroll: true });
  }
  function setImage(element: HTMLImageElement, placeholder: HTMLElement, item: CollectionRoomItem) {
    element.setAttribute('data-cr-photo-id', item.id);
    element.alt = item.objectRepresentation === 'souvenir-miniature' && item.originalImageUrl && item.imageUrl !== item.originalImageUrl ? 'Miniature reference thumbnail' : 'Original photo thumbnail';
    const url = imageUrl(item); element.hidden = !url; placeholder.hidden = Boolean(url);
    if (url) element.src = url; else element.removeAttribute('src');
  }
  function refreshExpiredImages() {
    if (!active()) return;
    clearTimeout(expiryTimer); expiryTimer = undefined;
    for (const image of host.querySelectorAll<HTMLImageElement>('[data-cr-photo-id]')) {
      const item = byId.get(image.dataset.crPhotoId || '');
      if (!item?.mediaExpiresAt || item.mediaExpiresAt > Date.now() / 1000) continue;
      image.removeAttribute('src'); image.hidden = true;
      const placeholder = image.parentElement?.querySelector<HTMLElement>('[data-cr-image-placeholder]'); if (placeholder) placeholder.hidden = false;
    }
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-cr-list-item]')) {
      const item = byId.get(button.dataset.crListItem || '');
      if (item?.mediaExpiresAt && item.mediaExpiresAt <= Date.now() / 1000) button.querySelector('small')!.textContent = 'Photo preview expired · gift details are available';
    }
    const upcoming = items.map(item => item.mediaExpiresAt).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > Date.now() / 1000);
    if (upcoming.length) expiryTimer = window.setTimeout(refreshExpiredImages, Math.min(2_147_483_647, Math.max(1, Math.min(...upcoming) * 1000 - Date.now() + 25)));
  }
  function updateSelection(focus = false) {
    const item = chosen(); tray.hidden = !item; host.classList.toggle('has-selection', Boolean(item));
    for (const [id, button] of hotspots) button.setAttribute('aria-pressed', String(id === selected));
    host.querySelectorAll<HTMLButtonElement>('[data-cr-list-item]').forEach(button => { if (button.dataset.crListItem === selected) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current'); });
    if (!item) return;
    text('[data-cr-selected-kind]', item.demo ? 'PUBLIC DEMO' : 'SAVED GIFT'); text('[data-cr-selected-title]', item.title); text('[data-cr-selected-subtitle]', item.subtitle);
    text('[data-cr-selected-story]', item.story || 'A little world, waiting for its story.');
    find<HTMLButtonElement>('[data-cr-world]').hidden = !item.worldPath;
    setImage(find<HTMLImageElement>('[data-cr-selected-image]'), find('[data-cr-selected-placeholder]'), item);
    if (focus) find('[data-cr-selected-title]').focus({ preventScroll: true });
  }
  function selectItem(id: string | null, focus = true, delegate = true) {
    if (!active() || id !== null && !currentItems().some(item => item.id === id)) return;
    const previous = selected;
    syncPlayback(false); selected = id;
    if (id !== null) positionPending(currentItems().findIndex(item => item.id === id));
    updateSelection(focus && id !== null); if (delegate) scene?.select(id);
    refreshExpiredImages();
    if (id === null && focus) {
      const hotspot = previous ? hotspots.get(previous) : undefined;
      (hotspot && !hotspot.hidden ? hotspot : find('[data-cr-drawer-open]')).focus({ preventScroll: true });
    }
  }
  function project(points: readonly CollectionProjection[]) {
    for (const button of hotspots.values()) button.hidden = true;
    for (const point of points) {
      const button = hotspots.get(point.id); if (!button || !point.visible || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      // Renderer coordinates are pixels within this same full-viewport host.
      if (point.x < 22 || point.y < 22 || point.x > stage.clientWidth - 22 || point.y > stage.clientHeight - 22) continue;
      button.hidden = false; button.style.left = `${point.x}px`; button.style.top = `${point.y}px`;
    }
  }
  function loadingState(message: string, failed = false) {
    sceneReady = false; roomPhase = failed ? 'unavailable' : 'loading'; host.dataset.roomPhase = roomPhase;
    stage.classList.remove('is-ready'); sceneHost.inert = true; loading.hidden = false; hotspots.forEach(button => button.hidden = true);
    text('[data-cr-status]', message); find('[data-cr-retry]').hidden = !failed; find('[data-cr-browse]').hidden = !failed; find('[data-cr-empty]').hidden = true;
    host.querySelectorAll<HTMLButtonElement>('[data-cr-control]').forEach(button => button.disabled = true);
    find<HTMLButtonElement>('[data-cr-mood]').disabled = true;
    syncPlayback(playing, false);
  }
  function renderConveyor() {
    epoch++; const generation = epoch; scene?.destroy(); scene = undefined; sceneReady = false; latestProjection = [];
    pageEvents.abort(); pageEvents = new AbortController(); sceneHost.replaceChildren(); hotspots.clear();
    const pageItems = currentItems(), points = find('[data-cr-hotspots]'); points.replaceChildren(); pendingIndex = 0;
    for (const item of pageItems) {
        const hotspot = document.createElement('button'); hotspot.type = 'button'; hotspot.className = 'cr-hotspot'; hotspot.hidden = true; hotspot.setAttribute('aria-label', `View ${item.title}`); hotspot.setAttribute('aria-pressed', String(item.id === selected));
        hotspot.innerHTML = `<span class="cr-hotspot-label">${giftIcon}${esc(item.title)}</span>`;
        hotspot.addEventListener('focus', () => { if (active() && generation === epoch) syncPlayback(false); }, { signal: pageEvents.signal });
        hotspot.addEventListener('click', () => selectItem(item.id), { signal: pageEvents.signal }); points.append(hotspot); hotspots.set(item.id, hotspot);
    }
    if (!playing || reducedMotion.matches) positionPending(0);
    text('[data-cr-page-label]', `Set ${page + 1} / ${pages}`);
    find<HTMLButtonElement>('[data-cr-page="previous"]').disabled = page === 0; find<HTMLButtonElement>('[data-cr-page="next"]').disabled = page === pages - 1;
    loadingState('Opening your 3D memory desk…'); updateSelection(); refreshExpiredImages();
    const current = () => active() && epoch === generation && sceneHost.isConnected;
    void (async () => {
      let unavailable = false, mounted = false;
      try {
        const { mountCollectionScene } = await import('./collection-scene'); if (!current()) return;
        const desiredPlayback = playing;
        const handle = mountCollectionScene(sceneHost, {
          items: pageItems, isCurrent: () => current() && !unavailable,
          onPlaybackChange: (next: boolean) => { if (mounted && current() && !unavailable) syncPlayback(next, false); },
          onSelect: (id: string) => { if (current() && !unavailable) selectItem(id, true, false); },
          onPropSelect: (id: 'photo-frame' | 'travel-journal') => { if (!current() || unavailable) return; syncPlayback(false); if (id === 'photo-frame') showDrawer(); else { closeDrawer(false); options.onCreate(); } },
          onProject: (positions: readonly CollectionProjection[]) => { if (current() && !unavailable) { latestProjection = positions; if (sceneReady) project(positions); } },
          onReady: () => { if (!current() || unavailable) return; sceneReady = true; roomPhase = 'ready'; host.dataset.roomPhase = roomPhase; stage.classList.add('is-ready'); sceneHost.inert = false; loading.hidden = true; find('[data-cr-empty]').hidden = !!items.length; host.querySelectorAll<HTMLButtonElement>('[data-cr-control]').forEach(button => button.disabled = !pageItems.length && ['previous','next'].includes(button.dataset.crControl || '')); find<HTMLButtonElement>('[data-cr-mood]').disabled = false; syncPlayback(playing, false); project(latestProjection); },
          onUnavailable: () => { if (!current() || unavailable) return; unavailable = true; scene?.destroy(); scene = undefined; loadingState('The 3D desk could not open. Try again or browse your gifts.', true); },
        });
        if (!current() || unavailable) { handle.destroy(); return; }
        scene = handle; mounted = true; handle.setMood(mood);
        if (selected) handle.select(selected);
        else if (!desiredPlayback) for (let index = 0; index < pendingIndex; index++) handle.step(1);
        handle.setPlaying(selected ? false : desiredPlayback);
      } catch { if (current()) { scene?.destroy(); scene = undefined; loadingState('The 3D desk could not open. Try again or browse your gifts.', true); } }
    })();
  }
  function changePage(next: number, selectId: string | null = null) {
    if (!active() || next < 0 || next >= pages) return;
    if (next === page) { if (selectId) selectItem(selectId); return; }
    page = next; selected = selectId; if (selectId) syncPlayback(false); renderConveyor(); if (selectId) { positionPending(currentItems().findIndex(item => item.id === selectId)); updateSelection(true); }
  }
  const list = find('[data-cr-list]');
  for (const item of items) {
    const li = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.dataset.crListItem = item.id; button.setAttribute('data-cr-list-item', item.id);
    const photo = imageUrl(item); button.innerHTML = `<span class="cr-list-image"><span data-cr-image-placeholder>${giftIcon}</span>${photo ? `<img src="${esc(photo)}" data-cr-photo-id="${esc(item.id)}" alt="" referrerpolicy="no-referrer"/>` : ''}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.subtitle || (item.demo ? 'Public demo' : 'Saved gift'))}</small></span>${icon('right')}`;
    button.addEventListener('click', () => { closeDrawer(false); const targetPage = Math.floor(items.indexOf(item) / 6); if (targetPage !== page) changePage(targetPage, item.id); else selectItem(item.id); }, { signal: events.signal });
    button.querySelector('img')?.addEventListener('error', event => { if (active()) (event.currentTarget as HTMLElement).hidden = true; }, { signal: events.signal }); li.append(button); list.append(li);
  }
  on('[data-cr-home]', () => { if (active()) { closeDrawer(false); options.onHome(); } });
  on('[data-cr-create]', () => { if (active()) { closeDrawer(false); options.onCreate(); } });
  on('[data-cr-manage]', () => { if (active()) { closeDrawer(false); options.onManage?.(); } });
  on('[data-cr-open]', () => { const item = chosen(); if (active() && item) options.onOpen(item, false); });
  on('[data-cr-world]', () => { const item = chosen(); if (active() && item?.worldPath) options.onOpen(item, true); });
  on('[data-cr-clear]', () => selectItem(null));
  on('[data-cr-play]', togglePlayback);
  on('[data-cr-drawer-open]', showDrawer); on('[data-cr-drawer-close]', () => closeDrawer());
  on('[data-cr-browse]', showDrawer); on('[data-cr-retry]', () => { if (active() && roomPhase === 'unavailable') renderConveyor(); });
  on('[data-cr-page]', event => changePage(page + ((event.currentTarget as HTMLElement).dataset.crPage === 'next' ? 1 : -1)));
  on('[data-cr-control]', event => {
    if (!active()) return;
    const action = (event.currentTarget as HTMLElement).dataset.crControl;
    if (action === 'previous' || action === 'next') stepConveyor(action === 'previous' ? -1 : 1);
    else if (sceneReady && action === 'reset') { selectItem(null, false, false); scene?.reset(); }
    else if (sceneReady && (action === 'closer' || action === 'farther')) scene?.zoom(action === 'closer' ? -.35 : .35);
  });
  on('[data-cr-mood]', () => {
    if (!active()) return; mood = mood === 'sunset' ? 'night' : 'sunset'; host.dataset.mood = mood; scene?.setMood(mood);
    const button = find('[data-cr-mood]'), label = mood === 'night' ? 'Switch to warm lighting' : 'Switch to night lighting'; button.setAttribute('aria-pressed', String(mood === 'night')); button.setAttribute('aria-label', label); button.setAttribute('title', label);
  });
  drawer.addEventListener('cancel', event => { event.preventDefault(); closeDrawer(); }, { signal: events.signal });
  drawer.addEventListener('click', event => { if (event.target === drawer) { const rect = drawer.getBoundingClientRect(); const click = event as MouseEvent; if (click.clientX < rect.left || click.clientX > rect.right || click.clientY < rect.top || click.clientY > rect.bottom) closeDrawer(); } }, { signal: events.signal });
  host.addEventListener('keydown', event => {
    if (!active() || drawer.open || event.defaultPrevented) return;
    const target = event.target instanceof HTMLElement ? event.target : null, tag = target?.tagName.toLowerCase();
    if (event.key === 'Escape' && selected) { event.preventDefault(); event.stopPropagation(); selectItem(null); return; }
    if (['input', 'textarea', 'select', 'a', 'button'].includes(tag || '') || target?.isContentEditable) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); stepConveyor(event.key === 'ArrowLeft' ? -1 : 1); }
    else if (event.key === ' ' || event.key === 'Spacebar') { event.preventDefault(); event.stopPropagation(); togglePlayback(); }
  }, { signal: events.signal, capture: true });
  reducedMotion.addEventListener('change', () => { if (active()) { syncPlayback(reducedMotion.matches ? false : playing); if (!sceneReady && !playing) positionPending(pendingIndex); } }, { signal: events.signal });
  find<HTMLImageElement>('[data-cr-selected-image]').addEventListener('error', event => { if (active()) { (event.currentTarget as HTMLElement).hidden = true; find('[data-cr-selected-placeholder]').hidden = false; } }, { signal: events.signal });
  renderConveyor(); syncPlayback(playing, false);
  return { destroy() {
    if (dead) return; dead = true; epoch++; closeDrawer(false); clearTimeout(expiryTimer); events.abort(); pageEvents.abort(); scene?.destroy(); scene = undefined; hotspots.clear(); host.replaceChildren(); host.className = previousClass; delete host.dataset.mood; delete host.dataset.playing; delete host.dataset.roomPhase;
  } };
}
