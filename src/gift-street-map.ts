import type { GiftContextPosition } from './gift-context-state';

const TILE_SIZE = 256;
const MAX_LATITUDE = 85.05112878;
const MIN_ZOOM = 2, MAX_ZOOM = 16;
const wrap = (value: number, size: number) => ((value % size) + size) % size;
const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom)));
export interface GiftStreetTile { key: string; url: string; left: number; top: number }

/** Web Mercator is used only for map navigation. The gift keeps its original
 * rounded position; panning or zooming never changes the chosen place. */
export function giftStreetPoint(position: GiftContextPosition, zoom: number): { x: number; y: number } {
  const world = TILE_SIZE * 2 ** clampZoom(zoom);
  const sine = Math.sin(Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, position.latitude)) * Math.PI / 180);
  return { x: wrap((position.longitude + 180) / 360 * world, world), y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * world };
}
export function giftStreetPosition(point: { x: number; y: number }, zoom: number): GiftContextPosition {
  const world = TILE_SIZE * 2 ** clampZoom(zoom);
  return { longitude: wrap(point.x, world) / world * 360 - 180, latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0, Math.min(world, point.y)) / world))) * 180 / Math.PI };
}
export function giftStreetTiles(position: GiftContextPosition, zoom: number, width: number, height: number): GiftStreetTile[] {
  if (!(width > 0 && height > 0) || !Number.isFinite(width + height + position.latitude + position.longitude + zoom)) return [];
  const level = clampZoom(zoom), count = 2 ** level, centre = giftStreetPoint(position, level);
  // Only the visible viewport is requested. No tile prefetch or offline download.
  const left = centre.x - Math.min(width, 1536) / 2, top = centre.y - Math.min(height, 1024) / 2;
  const result: GiftStreetTile[] = [];
  for (let y = Math.max(0, Math.floor(top / TILE_SIZE)); y <= Math.min(count - 1, Math.ceil((top + Math.min(height, 1024)) / TILE_SIZE) - 1); y++) {
    for (let x = Math.floor(left / TILE_SIZE); x <= Math.ceil((left + Math.min(width, 1536)) / TILE_SIZE) - 1; x++) {
      const column = wrap(x, count);
      result.push({ key: `${level}/${x}/${y}`, url: `https://tile.openstreetmap.org/${level}/${column}/${y}.png`, left: x * TILE_SIZE - left, top: y * TILE_SIZE - top });
    }
  }
  return result;
}

export interface GiftStreetMapHandle {
  setPosition(position: GiftContextPosition, label: string): void;
  setEnabled(enabled: boolean): void;
  zoomBy(delta: number): void;
  recenter(): void;
  destroy(): void;
}

/** Browser image requests use normal HTTP caching and an origin-only Referer.
 * OSM receives map tile coordinates, never the story, photo or gift capability. */
export function mountGiftStreetMap(host: HTMLElement, onUnavailable: () => void): GiftStreetMapHandle {
  const events = new AbortController();
  host.innerHTML = '<div class="gc-street-layer" aria-hidden="true"></div><span class="gc-street-pin" role="img"><svg viewBox="0 0 30 38" fill="none" aria-hidden="true"><path d="M27 14C27 24 15 35 15 35S3 24 3 14a12 12 0 0 1 24 0Z" fill="#064969" stroke="#fffdf7" stroke-width="2.5"/><circle cx="15" cy="14" r="4" fill="#f0ba80"/></svg></span><p class="gc-street-status" role="status">Loading street map…</p><span class="gc-street-hint">Drag to explore · pinch or use + / −</span><a class="gc-street-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>';
  host.tabIndex = 0;
  host.setAttribute('role', 'region');
  host.setAttribute('aria-label', 'Street map of the selected approximate place. Arrow keys pan, plus and minus zoom, Home returns to the pin.');
  const layer = host.querySelector<HTMLElement>('.gc-street-layer')!;
  const marker = host.querySelector<HTMLElement>('.gc-street-pin')!;
  const status = host.querySelector<HTMLElement>('.gc-street-status')!;
  let selected: GiftContextPosition | undefined, centre: GiftContextPosition | undefined;
  let zoom = 12, enabled = false, dead = false, signature = '', frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tiles = new Map<string, HTMLImageElement>();
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: { centre: { x: number; y: number }; midpoint: { x: number; y: number }; distance: number; zoom: number } | undefined;
  function clearTimer() { if (timer) clearTimeout(timer); timer = undefined; }
  function fail() { if (!dead && enabled) { clearTimer(); onUnavailable(); } }
  function render() {
    frame = 0;
    if (dead || !enabled || !centre || !selected) return;
    const { width, height } = host.getBoundingClientRect();
    if (!(width > 0 && height > 0)) return;
    const visible = giftStreetTiles(centre, zoom, width, height), wanted = new Set(visible.map(tile => tile.key));
    for (const [key, image] of tiles) if (!wanted.has(key)) { image.remove(); tiles.delete(key); }
    for (const tile of visible) {
      let image = tiles.get(tile.key);
      if (!image) {
        image = document.createElement('img'); image.alt = ''; image.draggable = false;
        image.width = TILE_SIZE; image.height = TILE_SIZE;
        image.referrerPolicy = 'strict-origin';
        image.dataset.tileState = 'loading';
        image.addEventListener('load', () => { if (dead || !enabled || tiles.get(tile.key) !== image) return; image!.dataset.tileState = 'ready'; status.hidden = true; clearTimer(); }, { signal: events.signal });
        image.addEventListener('error', () => { if (dead || !enabled || tiles.get(tile.key) !== image) return; image!.dataset.tileState = 'failed'; const failed = [...tiles.values()].filter(item => item.dataset.tileState === 'failed').length; if (failed >= Math.max(1, Math.ceil(tiles.size * 0.75))) fail(); }, { signal: events.signal });
        tiles.set(tile.key, image); layer.append(image); image.src = tile.url;
      }
      image.style.left = `${tile.left}px`; image.style.top = `${tile.top}px`;
    }
    const point = giftStreetPoint(selected, zoom), camera = giftStreetPoint(centre, zoom), world = TILE_SIZE * 2 ** zoom;
    let dx = point.x - camera.x;
    if (dx > world / 2) dx -= world; else if (dx < -world / 2) dx += world;
    marker.style.left = `${width / 2 + dx}px`; marker.style.top = `${height / 2 + point.y - camera.y}px`;
    if (visible.length && ![...tiles.values()].some(image => image.dataset.tileState === 'ready')) {
      status.hidden = false; clearTimer(); timer = setTimeout(fail, 7000);
    }
  }
  function schedule() { if (!dead && !frame) frame = requestAnimationFrame(render); }
  function zoomBy(delta: number) { if (dead || !enabled) return; zoom = clampZoom(zoom + delta); schedule(); }
  function recenter() { if (selected) { centre = { ...selected }; schedule(); } }
  function startGesture() {
    if (!centre || !pointers.size) { gesture = undefined; return; }
    const [first, second = first] = [...pointers.values()];
    gesture = { centre: giftStreetPoint(centre, zoom), midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, distance: Math.hypot(first.x - second.x, first.y - second.y), zoom };
  }
  host.addEventListener('pointerdown', event => {
    if (!enabled || !centre || event.target instanceof Element && event.target.closest('a')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault(); host.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); startGesture(); host.classList.add('is-dragging');
  }, { signal: events.signal });
  host.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    event.preventDefault(); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [first, second = first] = [...pointers.values()];
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    if (pointers.size > 1 && gesture.distance > 0) {
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      zoom = clampZoom(gesture.zoom + Math.log2(Math.max(1, distance) / gesture.distance));
    }
    const scale = 2 ** (zoom - gesture.zoom);
    centre = giftStreetPosition({ x: gesture.centre.x * scale - midpoint.x + gesture.midpoint.x, y: gesture.centre.y * scale - midpoint.y + gesture.midpoint.y }, zoom);
    schedule();
  }, { signal: events.signal });
  const endPointer = (event: PointerEvent) => { pointers.delete(event.pointerId); startGesture(); if (!pointers.size) host.classList.remove('is-dragging'); };
  host.addEventListener('pointerup', endPointer, { signal: events.signal });
  host.addEventListener('pointercancel', endPointer, { signal: events.signal });
  host.addEventListener('keydown', event => {
    if (!enabled || !centre || event.target instanceof Element && event.target.closest('a')) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1); }
    else if (event.key === '-') { event.preventDefault(); zoomBy(-1); }
    else if (event.key === 'Home') { event.preventDefault(); recenter(); }
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); const point = giftStreetPoint(centre, zoom);
      centre = giftStreetPosition({ x: point.x + (event.key === 'ArrowLeft' ? -80 : event.key === 'ArrowRight' ? 80 : 0), y: point.y + (event.key === 'ArrowUp' ? -80 : event.key === 'ArrowDown' ? 80 : 0) }, zoom); schedule();
    }
  }, { signal: events.signal });
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
  observer?.observe(host);
  window.addEventListener('resize', schedule, { signal: events.signal });
  return {
    setPosition(position, label) { const next = `${position.latitude},${position.longitude}`; selected = { ...position }; marker.setAttribute('aria-label', `${label || 'Selected place'} · approximate location`); marker.title = `${label || 'Selected place'} · approximate location`; if (next !== signature) { signature = next; centre = { ...position }; zoom = 12; } schedule(); },
    setEnabled(active) { enabled = active; host.hidden = !active; if (active) schedule(); else { clearTimer(); for (const image of tiles.values()) image.remove(); tiles.clear(); pointers.clear(); gesture = undefined; host.classList.remove('is-dragging'); } },
    zoomBy, recenter,
    destroy() { if (dead) return; dead = true; events.abort(); clearTimer(); if (frame) cancelAnimationFrame(frame); observer?.disconnect(); tiles.clear(); host.replaceChildren(); },
  };
}
