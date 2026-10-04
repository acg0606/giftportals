import './generated-gift.css';
import { giftIcon } from './gift-icon';
import { collectionIcon } from './collection-icon';
import { mountStoryReader, type StoryReaderHandle, type StoryReaderMode } from './story-reader';
import { viewerAssetUrl, type ViewerProgress } from './viewer-runtime';
import type { GeneratedWorldHandle, GeneratedWorldPoint, ProjectedWorldPoint, GeneratedWorldTourState } from './generated-world';
import { packGiftMarkers, placeGiftMarkerLabel, type MarkerRect } from './gift-marker-layout';
import { CURIOSITY_FACTS, type CuriosityFact } from '../shared/gift-curiosities';
import type { InstantObjectRepresentation } from '../shared/instant-examples';

export interface GeneratedGiftTouchpoint extends GeneratedWorldPoint { title: string; text: string; sourceTitle?: string; sourceUrl?: string }
export interface GeneratedGiftData {
  title: string; senderName: string; recipientName?: string; dedication?: string; story: string;
  originalUrl?: string; keepsakeImageUrl?: string; modelUrl?: string; panoramaUrl?: string; worldUrl?: string;
  mediaExpiresAt?: number; touchpoints?: readonly GeneratedGiftTouchpoint[];
  initialYaw?: number; initialPitch?: number;
  photoIntent?: 'object' | 'place'; collisionUrl?: string; colliderUrl?: string;
  objectRepresentation?: InstantObjectRepresentation; modelYaw?: number;
  curiosities?: readonly CuriosityFact[];
  worldSemantics?: { metricScaleFactor: number; groundPlaneOffset: number };
  worldRetry?: { available: boolean; attempts: number };
}
export interface GeneratedGiftOptions { gift: GeneratedGiftData; initialView?: 'object' | 'world'; isCurrent(): boolean; onExit(): void; onShare?(): void; onCollection?(): void; onJourney?(): void; onRetryWorld?(signal: AbortSignal): Promise<void>; worldRetryPending?: boolean; journeyLabel?: string; shareScope?: 'local' | 'cloud' }
export interface GeneratedGiftHandle { destroy(): void }
interface ObjectHandle { destroy(): void; reset(): void; rotate(delta: number): void; zoom(delta: number): void }
type Phase = 'object' | 'world';
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const icons: Record<string, string> = {
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9m-4-16.5 8 4.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
  rotateLeft: '<path d="M3 8h5M3 8V3m0 5a9 9 0 1 1 0 8"/><path d="m10 9 5 3-5 3V9Z"/>',
  rotateRight: '<path d="M21 8h-5m5 0V3m0 5a9 9 0 1 0 0 8"/><path d="m14 9-5 3 5 3V9Z"/>',
  lookLeft: '<path d="M3 8s4-5 9-5 9 5 9 5-4 5-9 5-9-5-9-5Z"/><circle cx="12" cy="8" r="2"/><path d="M19 19H5m4-4-4 4 4 4"/>',
  lookRight: '<path d="M3 8s4-5 9-5 9 5 9 5-4 5-9 5-9-5-9-5Z"/><circle cx="12" cy="8" r="2"/><path d="M5 19h14m-4-4 4 4-4 4"/>',
  plus: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>',
  minus: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6"/>',
  forward: '<path d="m6 10 6-6 6 6M12 4v16"/>',
  backward: '<path d="m6 14 6 6 6-6M12 4v16"/>',
  left: '<path d="m10 6-6 6 6 6M4 12h16"/>',
  right: '<path d="m14 6 6 6-6 6M4 12h16"/>',
  walk: '<path d="M9 8c2 2 1 6-1 7-2 1-4-1-4-3s2-5 5-4Zm7-5c2 1 2 5 0 7-2 1-4 0-4-2s1-6 4-5ZM5 18l2 2m9-7 2 2"/>',
  hand: '<path d="M8 12V5a2 2 0 0 1 4 0v5-6a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v8c0 4-3 7-7 7-3 0-5-1-7-4l-3-4c-1-2 1-4 3-2l2 2"/>',
  reset: '<path d="M3 9h5M3 9V4m0 5a9 9 0 1 1 0 6M12 7v5l3 2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  tour: '<path d="m9 5 11 7-11 7V5Z"/><path d="M4 4v16"/>',
  printer: '<path d="M7 8V3h10v5M7 17H4V8h16v9h-3M7 14h10v7H7v-7Z"/><path d="M17 11h1"/>',
  headset: '<path d="M4 9V7a8 8 0 0 1 16 0v2M5 9h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-4l-3-3-3 3H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z"/><path d="M7 12h2m6 0h2"/>',
};
const icon = (name: string) => name === 'gift' ? giftIcon : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.hand}</svg>`;
const iconButton = (action: string, name: string, label: string, extra = '') => `<button class="gg-icon-button" type="button" data-gg-control="${action}" aria-label="${label}" title="${label}" ${extra}>${icon(name)}<span class="gg-tooltip" aria-hidden="true">${label}</span></button>`;
let sequence = 0;

const officialSourceDomains = new Set(CURIOSITY_FACTS.map(fact => new URL(fact.sourceUrl).hostname));
/** Primary source links are distinct from generated media capabilities. */
export function generatedGiftSourceUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && officialSourceDomains.has(url.hostname) ? url.href : '';
  } catch { return ''; }
}
function giftCuriosities(gift: GeneratedGiftData): CuriosityFact[] {
  const selected: CuriosityFact[] = [], ids = new Set<string>();
  if (!Array.isArray(gift.curiosities)) return selected;
  for (const supplied of gift.curiosities) {
    const approved = CURIOSITY_FACTS.find(fact => fact.id === supplied?.id);
    if (!approved || ids.has(approved.id) || !generatedGiftSourceUrl(approved.sourceUrl)) continue;
    // Resolve IDs back to the reviewed facts; payload text cannot invent provenance.
    selected.push({ ...approved }); ids.add(approved.id); if (selected.length === 2) break;
  }
  return selected;
}

function storyPoints(gift: GeneratedGiftData): GeneratedGiftTouchpoint[] {
  const context = giftCuriosities(gift).map((fact, index) => ({ id: `curiosity-${index}`, title: fact.title, text: fact.text,
    sourceTitle: fact.sourceTitle, sourceUrl: fact.sourceUrl, position: (index ? [-1.55, .55, -3.8] : [-.75, -.15, -3.5]) as [number, number, number] }));
  const provided = gift.touchpoints?.filter(point => point && typeof point.id === 'string' && typeof point.title === 'string' && typeof point.text === 'string' && Array.isArray(point.position)
    && point.position.length === 3 && point.position.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 20)).slice(0, 6 - context.length);
  if (provided?.length) return [...provided.map((point, index) => ({ ...point, id: `story-${index}`, position: [...point.position] as [number, number, number],
    sourceUrl: generatedGiftSourceUrl(point.sourceUrl) || undefined, sourceTitle: typeof point.sourceTitle === 'string' ? point.sourceTitle : undefined })), ...context];
  // Deliberately authored narrative markers, not detected geographic landmarks.
  return [
    ...(gift.dedication?.trim() ? [{ id: 'note', title: 'A note for you', text: gift.dedication, position: [-1.05, .22, -2.6] as const }] : []),
    { id: 'story', title: 'The moment', text: gift.story.trim() || 'No story text is attached to this gift.', position: [.55, .38, -3] as const },
    { id: 'sender', title: 'Until next time', text: `A little world from ${gift.senderName}${gift.recipientName ? `, for ${gift.recipientName}` : ''}.`, position: [1.4, -.2, -2.65] as const },
    ...context,
  ];
}

/** Display delivered per-gift media; world generation requires its explicit retry action. */
export function mountGeneratedGift(host: HTMLElement, options: GeneratedGiftOptions): GeneratedGiftHandle {
  const gift = options.gift, instance = ++sequence, points = storyPoints(gift), curiosities = giftCuriosities(gift);
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog'); dialog.className = 'generated-gift'; dialog.setAttribute('aria-labelledby', `generated-gift-title-${instance}`);
  let dead = false, version = 0, phase: Phase = options.initialView === 'world' && hasWorld() ? 'world' : 'object', viewer: ObjectHandle | GeneratedWorldHandle | undefined;
  let selected: string | undefined, hovered: string | undefined, projectedPoints: ProjectedWorldPoint[] = [];
  let pendingFocus: string | undefined;
  let tour: GeneratedWorldTourState | undefined;
  let pointReader: StoryReaderHandle | undefined, tourReader: StoryReaderHandle | undefined;
  let printPanel: { destroy(): void } | undefined, printPending = false, printEpoch = 0;
  let xrPanel: { destroy(): void } | undefined, xrPending = false, xrEpoch = 0, xrOwnsViewer = false;
  let worldRetryAbort: AbortController | undefined;
  const worldAsset = gift.worldUrl || '';
  let plusCandidate = false;
  try {
    const source = new URL(worldAsset, location.origin);
    plusCandidate = source.origin === location.origin && source.pathname === '/demo/v22/paris-world.spz' && !source.username && !source.password;
  } catch { /* A malformed media URL will use the existing fallback. */ }
  const flightProfile = plusCandidate ? 'river-plus' : /\/rio-world-(?:500k|100k)\.spz(?:\?|$)/.test(worldAsset) ? 'coast'
    : /\/paris-world\.spz(?:\?|$)/.test(worldAsset) ? 'river'
    : /\/antikythera-world\.spz(?:\?|$)/.test(worldAsset) ? 'terrace' : 'generic';
  const readerMode: StoryReaderMode = flightProfile === 'river' || flightProfile === 'river-plus' ? 'newspaper' : flightProfile === 'coast' ? 'tablet' : 'book';
  const events = new AbortController(); let viewEvents = new AbortController();
  let scrolling: Array<{ style: CSSStyleDeclaration; value: string; priority: string }> | undefined;
  const active = () => !dead && options.isCurrent() && host.isConnected && dialog.isConnected && dialog.open && host.contains(dialog);
  function expired() { return typeof gift.mediaExpiresAt === 'number' && gift.mediaExpiresAt > 0 && gift.mediaExpiresAt <= Date.now() / 1000; }
  function mediaUrl(value?: string) { if (!value || expired()) return ''; try { return viewerAssetUrl(value, location.origin).href; } catch { return ''; } }
  function hasWorld() { return Boolean(mediaUrl(gift.worldUrl)); }
  function canEnterWorld() { return hasWorld() || Boolean(options.onJourney && !expired()); }
  function destroyXR() { xrEpoch++; xrPending = false; xrOwnsViewer = false; const panel = xrPanel; xrPanel = undefined; panel?.destroy(); }
  function restoreObjectViewer() {
    if (!active() || phase !== 'object') return;
    const status = dialog.querySelector<HTMLElement>('[data-gg-status]');
    if (status) { status.hidden = false; status.classList.remove('is-fallback'); status.textContent = 'Returning to your keepsake…'; }
    void loadViewer();
  }
  function destroyViewer() { version++; destroyXR(); printEpoch++; printPending = false; printPanel?.destroy(); printPanel = undefined; pendingFocus = undefined; viewer?.destroy(); viewer = undefined; pointReader?.destroy(); tourReader?.destroy(); pointReader = undefined; tourReader = undefined; }
  function destroy() {
    if (dead) return; dead = true; worldRetryAbort?.abort(); worldRetryAbort = undefined; destroyViewer(); events.abort(); viewEvents.abort();
    if (dialog.open) dialog.close(); dialog.remove();
    for (const saved of scrolling || []) { if (saved.value) saved.style.setProperty('overflow', saved.value, saved.priority); else saved.style.removeProperty('overflow'); }
    scrolling = undefined; if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  const exit = () => { if (active()) { destroy(); options.onExit(); } };
  const listen = (selector: string, action: (event: Event) => void) => dialog.querySelectorAll<HTMLElement>(selector).forEach(element => element.addEventListener('click', action, { signal: viewEvents.signal }));
  const text = (selector: string, value: string) => { const element = dialog.querySelector<HTMLElement>(selector); if (element) element.textContent = value; };
  function readerData(point: GeneratedGiftTouchpoint) {
    const source = generatedGiftSourceUrl(point.sourceUrl);
    return { mode: readerMode, title: point.title, body: point.text, eyebrow: source ? 'Historical context' : 'Personal story',
      worldTitle: gift.title, index: points.indexOf(point), count: points.length,
      sourceTitle: source ? point.sourceTitle || 'Read the primary source' : undefined, sourceUrl: source || undefined };
  }
  function markSelected(id: string) {
    dialog.querySelectorAll<HTMLButtonElement>('[data-gg-point],[data-gg-story-item]').forEach(button => button.setAttribute('aria-pressed', String(button.getAttribute('data-gg-point') === id || button.getAttribute('data-gg-story-item') === id)));
  }
  function showPoint(point: GeneratedGiftTouchpoint) {
    pointReader?.update(readerData(point));
    dialog.querySelector<HTMLElement>('[data-gg-story]')!.hidden = false;
    dialog.querySelector<HTMLButtonElement>('[data-gg-show-story]')!.setAttribute('aria-expanded', 'true');
    const hint = dialog.querySelector<HTMLElement>('.gg-world-hint'); if (hint) hint.hidden = true;
    pointReader?.focus(); layoutPoints();
  }
  function hidePoint() {
    const holder = dialog.querySelector<HTMLElement>('[data-gg-story]'); if (holder) holder.hidden = true;
    dialog.querySelector('[data-gg-show-story]')?.setAttribute('aria-expanded', 'false'); layoutPoints();
    const hint = dialog.querySelector<HTMLElement>('.gg-world-hint'); if (hint) hint.hidden = Boolean(tour && tour.phase !== 'idle');
  }
  function reveal(id: string, move = true) {
    if (!active() || phase !== 'world') return;
    const point = points.find(candidate => candidate.id === id); if (!point) return;
    selected = id; markSelected(id); hidePoint();
    const tourPanel = dialog.querySelector<HTMLElement>('[data-gg-tour-panel]'); if (tourPanel) tourPanel.hidden = true;
    const tourHolder = dialog.querySelector<HTMLElement>('[data-gg-tour-reader]'); if (tourHolder) tourHolder.hidden = true;
    const world = viewer as GeneratedWorldHandle | undefined;
    pendingFocus = move ? id : undefined;
    if (move && world?.focusPoint?.(id)) return;
    pendingFocus = undefined;
    world?.stopTour?.(); showPoint(point);
  }
  function layoutPoints() {
    const visual = dialog.querySelector<HTMLElement>('.gg-visual'); if (!visual || phase !== 'world') return;
    const bounds = typeof visual.getBoundingClientRect === 'function' ? visual.getBoundingClientRect() : { width: 1000, height: 600, left: 0, top: 0 };
    dialog.style.setProperty('--story-reader-height', `${Math.max(220, bounds.height - 112)}px`);
    const obstacles: MarkerRect[] = [];
    dialog.querySelectorAll<HTMLElement>('[data-gg-obstacle]').forEach(element => {
      if (element.hidden || typeof element.getBoundingClientRect !== 'function') return;
      const rect = element.getBoundingClientRect(); obstacles.push({ x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height });
    });
    const placed = packGiftMarkers(projectedPoints.map(point => ({ ...point, x: point.x / 100 * bounds.width, y: point.y / 100 * bounds.height })), bounds.width, bounds.height, obstacles);
    for (const point of points) {
      const button = dialog.querySelector<HTMLElement>(`[data-gg-point="${point.id}"]`), pin = placed.find(item => item.id === point.id); if (!button) continue;
      button.hidden = !pin?.visible;
      const label = button.querySelector<HTMLElement>('[data-gg-pin-label]'); if (label) label.hidden = true;
      if (!pin?.visible || !pin.rect) continue;
      button.style.left = `${pin.x / bounds.width * 100}%`; button.style.top = `${pin.y / bounds.height * 100}%`;
      if (label && hovered === point.id) {
        const width = Math.min(220, Math.max(90, point.title.length * 7.2 + 24));
        const rectangle = placeGiftMarkerLabel(pin.rect, width, 38, bounds.width, bounds.height, [...obstacles, ...placed.filter(other => other.id !== pin.id && other.rect).map(other => other.rect!)]);
        if (rectangle) { label.hidden = false; label.style.width = `${width}px`; label.style.left = `${rectangle.x - pin.rect.x}px`; label.style.top = `${rectangle.y - pin.rect.y}px`; }
      }
    }
  }
  function render() {
    destroyViewer(); viewEvents.abort(); viewEvents = new AbortController(); hovered = undefined; projectedPoints = []; tour = undefined;
    if (!active()) return;
    const world = phase === 'world', poster = mediaUrl(world ? gift.panoramaUrl || gift.originalUrl : gift.keepsakeImageUrl || gift.originalUrl), original = mediaUrl(gift.originalUrl), keepsake = mediaUrl(gift.keepsakeImageUrl || gift.originalUrl);
    dialog.classList.toggle('is-world', world);
    const modebar = `<nav class="gg-modebar" aria-label="Gift views"><button type="button" data-gg-mode="object" aria-pressed="${!world}">${icon('gift')}<span>Keepsake</span></button><button type="button" data-gg-mode="world" aria-pressed="${world}" ${canEnterWorld() ? '' : 'disabled aria-disabled="true"'}>${icon('globe')}<span>${canEnterWorld() ? 'World' : 'World unavailable'}</span></button>${world ? `<button type="button" data-gg-show-story aria-expanded="false">${icon('book')}<span>Stories</span></button><button type="button" data-gg-tour-start aria-pressed="false" disabled>${icon('tour')}<span data-gg-tour-start-label>Guided tour</span></button>` : ''}</nav>`;
    const controls = world
      ? `${iconButton('left', 'lookLeft', 'Look left')}${iconButton('right', 'lookRight', 'Look right')}<span class="gg-control-divider"></span>${iconButton('forward', 'forward', 'Move closer', 'data-gg-offset')}${iconButton('backward', 'backward', 'Move back', 'data-gg-offset')}${iconButton('walk', 'walk', 'Walk in this world', 'data-gg-walk disabled aria-pressed="false"')}<div class="gg-walk-controls" data-gg-walk-controls hidden>${iconButton('move-left', 'left', 'Walk left')}${iconButton('move-forward', 'forward', 'Walk forward')}${iconButton('move-right', 'right', 'Walk right')}${iconButton('move-back', 'backward', 'Walk backward')}</div>`
      : `${iconButton('left', 'rotateLeft', 'Rotate keepsake left')}${iconButton('right', 'rotateRight', 'Rotate keepsake right')}<span class="gg-control-divider"></span>${iconButton('in', 'plus', 'Zoom in')}${iconButton('out', 'minus', 'Zoom out')}`;
    const chapters = `<nav class="gg-story-list" aria-label="Story chapters">${points.map((point, index) => `<button type="button" data-gg-story-item="${escape(point.id)}" aria-label="Read ${escape(point.title)}" title="${escape(point.title)}" aria-pressed="false"><span>${index + 1}</span><span>${escape(point.title)}</span></button>`).join('')}</nav>`;
    const contextCards = curiosities.length ? `<details class="gg-context" data-gg-context><summary>${icon('book')}Historical context</summary><p class="gg-context-intro">Discoveries about the place or object category.</p>${curiosities.map(fact => `<article data-gg-curiosity="${escape(fact.id)}"><h3>${escape(fact.title)}</h3><p>${escape(fact.text)}</p><a class="gg-source" href="${escape(generatedGiftSourceUrl(fact.sourceUrl))}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escape(fact.sourceTitle)} ↗</a></article>`).join('')}</details>` : '';
    const tourPanel = world ? `<section class="gg-tour-panel" data-gg-tour-panel data-gg-obstacle hidden aria-label="Drone tour controls"><header>${keepsake ? `<img src="${escape(keepsake)}" alt="" referrerpolicy="no-referrer"/>` : icon('cube')}<div><span data-gg-tour-status role="status" aria-live="polite"></span><strong>${escape(gift.title)}</strong></div><button type="button" class="gg-icon-button" data-gg-tour-stop aria-label="Exit tour">${icon('close')}</button></header><div class="gg-tour-steps" aria-hidden="true">${points.map((_, index) => `<span data-gg-tour-step="${index}"></span>`).join('')}</div><nav aria-label="Guided tour controls"><button class="gg-tour-toggle" type="button" data-gg-tour-toggle>Pause</button><button type="button" data-gg-tour-next>Next viewpoint <span aria-hidden="true">→</span></button></nav><small data-gg-tour-note></small></section>` : '';
    dialog.innerHTML = `<div class="gg-shell">
      <header class="gg-header"><span class="gg-brand"><img src="/assets/portal-dusk/brand-mark.png" alt=""/>GiftPortals</span>${world ? `<span class="gg-header-title" id="generated-gift-title-${instance}" role="heading" aria-level="1">${escape(gift.title)}</span>` : ''}<div class="gg-header-actions">${options.onCollection ? `<button class="gg-quiet gg-room-link" type="button" data-gg-collection aria-label="Open collection" title="Open collection">${collectionIcon}<span>Collection</span></button>` : ''}${options.onShare ? `<button class="gg-quiet" type="button" data-gg-share aria-label="Copy gift link" title="Copy gift link">${icon('gift')}<span>Copy gift link</span></button>` : ''}<button class="gg-quiet" type="button" data-gg-exit aria-label="Close gift">${icon('close')}<span>Close</span></button></div></header>
      <div class="gg-encounter"><div class="gg-visual">
        ${!world ? `<div class="gg-atmosphere" aria-hidden="true">${original ? `<img src="${escape(original)}" alt="" referrerpolicy="no-referrer"/>` : ''}</div><span class="gg-object-badge">${icon('gift')}${gift.objectRepresentation === 'framed-postcard' ? 'A framed keepsake' : gift.objectRepresentation === 'souvenir-miniature' ? 'Your 3D souvenir' : 'Your keepsake'}</span>` : ''}
        <div class="gg-poster" data-gg-poster>${poster ? `<img src="${escape(poster)}" referrerpolicy="no-referrer" alt="${world ? 'Artistic panorama attached to this gift' : gift.keepsakeImageUrl ? 'Miniature reference image for this gift' : 'Original photograph for this gift'}"/>${!world ? `<span class="gg-poster-label">${gift.keepsakeImageUrl ? 'Reference image preview' : 'Original photo preview'}</span>` : ''}` : '<div class="gg-no-image">Your story is still here.</div>'}</div>
        <div class="gg-canvas" data-gg-canvas></div>
        <div class="gg-points" data-gg-points hidden>${world ? points.map((point, index) => `<button class="gg-point" type="button" data-gg-point="${escape(point.id)}" aria-label="Read ${escape(point.title)}" aria-pressed="false" hidden><span class="gg-pin-number">${index + 1}</span><span class="gg-pin-label" data-gg-pin-label hidden>${escape(point.title)}</span></button>`).join('') : ''}</div>
        ${world ? `<button class="gg-keepsake-dock" type="button" data-gg-return data-gg-obstacle aria-label="Return to your keepsake">${keepsake ? `<img src="${escape(keepsake)}" referrerpolicy="no-referrer" alt=""/>` : icon('cube')}<span><span class="gg-gift-identity">${icon('gift')}Your gift</span><small>${icon('cube')}Open 3D</small></span></button><div class="gg-world-hint" data-gg-obstacle>${icon('hand')}<span>Drag to look around · tap a light to read</span></div>` : ''}
        <div class="gg-loading" role="status" data-gg-status>${world ? 'Opening the world inside…' : 'Opening your 3D keepsake…'}</div>
        ${tourPanel}
        ${world ? `<aside class="gg-story" data-gg-story data-gg-obstacle hidden aria-labelledby="gg-point-title-${instance}">${chapters}<div data-gg-point-reader></div></aside><div class="gg-tour-reader" data-gg-tour-reader data-gg-obstacle hidden></div>` : ''}
      </div>${world ? '' : `<section class="gg-copy"><span class="gg-kicker">${gift.recipientName ? `FOR ${escape(gift.recipientName)}` : canEnterWorld() ? 'A LITTLE WORLD FOR YOU' : 'A KEEPSAKE FOR YOU'}</span><h1 id="generated-gift-title-${instance}" tabindex="-1">${escape(gift.title)}</h1><p class="gg-dedication">${escape(gift.dedication || 'A photo. A place. A moment to return to.')}</p>${gift.senderName ? `<span class="gg-signature">From ${escape(gift.senderName)}</span>` : ''}${canEnterWorld() ? options.onJourney ? `<button class="gg-primary" type="button" data-gg-journey>${icon('walk')}<span>${escape(options.journeyLabel || 'Walk inside')}</span>${icon('arrow')}</button>` : `<button class="gg-primary" type="button" data-gg-enter>${icon('globe')}<span>Step inside</span>${icon('arrow')}</button>` : '<p class="gg-world-unavailable" data-gg-world-unavailable>The world is unavailable. Your keepsake and story are here.</p>'}${mediaUrl(gift.modelUrl) ? `<div class="gg-keepsake-actions"><button class="gg-print-link gg-quiet" type="button" data-gg-print>${icon('printer')}<span>Print a keepsake</span></button><button class="gg-print-link gg-quiet" type="button" data-gg-xr>${icon('headset')}<span>View in VR</span></button></div><div class="gg-xr-holder" data-gg-xr-host hidden><button class="gg-quiet gg-xr-close" type="button" data-gg-xr-close>${icon('close')}<span>Close VR panel</span></button></div>` : ''}<details class="gg-original-story"><summary>${icon('book')}Read the story</summary><p>${escape(gift.story || 'No story text is attached to this gift.')}</p></details>${contextCards}</section>`}</div>
      <footer class="gg-footer"><div class="gg-toolbar">${modebar}<div class="gg-controls" data-gg-controls hidden>${controls}${iconButton('reset', 'reset', world ? 'Return to the starting view' : 'Reset keepsake view')}</div></div><p class="gg-caption" data-gg-caption>${world ? 'World Labs artistic scene · preparing 3D' : 'Tripo keepsake · preparing 3D'}</p>${options.onShare ? `<small class="gg-local-note">${options.shareScope === 'cloud' ? gift.mediaExpiresAt ? 'Private gift link · original photos and generated gifts expire after 7 days.' : 'Gift link · opens this keepsake online.' : 'Local preview link · available while this preview is running.'}</small>` : ''}</footer>
    </div>`;
    if (world) {
      const currentPoint = () => Math.max(0, points.findIndex(point => point.id === selected));
      pointReader = mountStoryReader(dialog.querySelector<HTMLElement>('[data-gg-point-reader]')!, { isCurrent: active,
        onClose: () => { hidePoint(); dialog.querySelector<HTMLElement>('[data-gg-show-story]')?.focus({ preventScroll: true }); },
        onPrevious: () => reveal(points[Math.max(0, currentPoint() - 1)].id),
        onNext: () => reveal(points[Math.min(points.length - 1, currentPoint() + 1)].id) });
      tourReader = mountStoryReader(dialog.querySelector<HTMLElement>('[data-gg-tour-reader]')!, { isCurrent: active,
        onClose: () => { (viewer as GeneratedWorldHandle | undefined)?.stopTour?.(); dialog.querySelector<HTMLElement>('[data-gg-tour-start]')?.focus({ preventScroll: true }); } });
      for (const prefix of ['point', 'tour']) {
        const holder = dialog.querySelector<HTMLElement>(`[data-gg-${prefix}-reader]`)!;
        for (const [field, alias] of [['title', 'title'], ['body', 'text'], ['eyebrow', 'context'], ['source', 'source']]) holder.querySelector(`[data-story-reader-${field}]`)?.setAttribute(`data-gg-${prefix}-${alias}`, '');
      }
      dialog.querySelector('[data-gg-point-title]')?.setAttribute('id', `gg-point-title-${instance}`);
      dialog.querySelector('[data-gg-point-reader] .story-reader-close')?.setAttribute('data-gg-hide-story', '');
      pointReader.update(readerData(points[0])); tourReader.update({ ...readerData(points[0]), closeLabel: 'Exit tour' });
    }
    if (phase === 'object' && !canEnterWorld() && !expired() && options.onRetryWorld) {
      const unavailable = dialog.querySelector<HTMLElement>('[data-gg-world-unavailable]');
      if (unavailable) {
        const retry = document.createElement('div'); retry.className = 'gg-world-retry';
        retry.innerHTML = `<button class="gg-quiet" type="button" data-gg-world-retry>${options.worldRetryPending ? 'Check world retry' : 'Try world again'}</button><small>A new attempt uses World Labs credits. Your photo, story and keepsake stay here.</small><p data-gg-world-retry-status role="status" aria-live="polite" hidden></p>`;
        unavailable.after(retry);
        listen('[data-gg-world-retry]', () => {
          if (!active() || expired() || worldRetryAbort || !options.onRetryWorld) return;
          const abort = new AbortController(); worldRetryAbort = abort;
          const button = dialog.querySelector<HTMLButtonElement>('[data-gg-world-retry]')!, result = dialog.querySelector<HTMLElement>('[data-gg-world-retry-status]')!;
          button.disabled = true; button.textContent = 'Requesting world…'; result.hidden = false; result.textContent = 'Requesting only the world. Your keepsake and story remain available.';
          void options.onRetryWorld(abort.signal).catch(cause => {
            if (!active() || abort.signal.aborted) return;
            if (typeof cause === 'object' && cause !== null && 'worldRetryUnavailable' in cause && cause.worldRetryUnavailable === true) {
              button.hidden = true; result.textContent = 'A world retry is unavailable for this gift right now. Reopen the gift to check its status.'; return;
            }
            button.textContent = 'Check world retry'; result.textContent = 'We could not confirm this retry. Check world retry to recover the same attempt.';
          }).finally(() => { if (worldRetryAbort === abort) { worldRetryAbort = undefined; if (active()) button.disabled = false; } });
        });
      }
    }
    listen('[data-gg-exit]', exit);
    listen('[data-gg-share]', () => { if (active()) options.onShare?.(); });
    listen('[data-gg-print]', () => {
      if (!active() || printPending || printPanel) return;
      const model = mediaUrl(gift.modelUrl); if (!model) return;
      printPending = true; const epoch = ++printEpoch;
      const button = dialog.querySelector<HTMLButtonElement>('[data-gg-print]'); if (button) button.disabled = true;
      void import('./keepsake-print').then(module => {
        if (!active() || epoch !== printEpoch || mediaUrl(gift.modelUrl) !== model) return;
        printPanel = module.mountKeepsakePrint(host, { modelUrl: model, title: gift.title, modelYaw: gift.modelYaw,
          isCurrent: () => active() && epoch === printEpoch,
          onClose: () => { printPanel = undefined; if (active() && epoch === printEpoch && button) button.disabled = false; } });
      }).catch(() => { if (active() && epoch === printEpoch) text('[data-gg-status]', 'Print preparation could not open. Your gift is still available.'); })
        .finally(() => { if (epoch === printEpoch) { printPending = false; if (!printPanel && active() && button) button.disabled = false; } });
    });
    listen('[data-gg-xr]', () => {
      if (!active() || phase !== 'object' || xrPending || xrPanel) return;
      const model = mediaUrl(gift.modelUrl); if (!model) return;
      xrPending = true; const epoch = ++xrEpoch;
      const button = dialog.querySelector<HTMLButtonElement>('[data-gg-xr]'), holder = dialog.querySelector<HTMLElement>('[data-gg-xr-host]');
      if (!holder) { xrPending = false; return; } if (button) button.disabled = true; holder.hidden = false;
      const current = () => active() && phase === 'object' && epoch === xrEpoch && mediaUrl(gift.modelUrl) === model;
      void import('./keepsake-xr').then(module => {
        if (!current()) return;
        xrPanel = module.mountKeepsakeXR(holder, { modelUrl: model, title: gift.title, modelYaw: gift.modelYaw, worldUrl: mediaUrl(gift.worldUrl), worldScale: gift.worldSemantics?.metricScaleFactor, isCurrent: current,
          onSessionStarting: () => {
            if (!current()) return;
            // Invalidate only the ordinary renderer, including any late scene import.
            // The independent XR epoch and accepted headset panel stay current.
            version++; viewer?.destroy(); viewer = undefined; xrOwnsViewer = true;
            dialog.querySelector<HTMLElement>('[data-gg-controls]')!.hidden = true;
            dialog.querySelector<HTMLElement>('.gg-visual')?.classList.remove('is-ready');
          },
          onExit: () => {
            if (!current() || !xrOwnsViewer) return;
            xrOwnsViewer = false; restoreObjectViewer();
          } });
      }).catch(() => { if (current()) text('[data-gg-status]', 'The VR panel could not open. Your ordinary gift is still available.'); })
        .finally(() => { if (epoch === xrEpoch) { xrPending = false; if (!xrPanel && active()) { holder.hidden = true; if (button) button.disabled = false; } } });
    });
    listen('[data-gg-xr-close]', () => {
      if (!active()) return; const restore = xrOwnsViewer; destroyXR();
      const holder = dialog.querySelector<HTMLElement>('[data-gg-xr-host]'); if (holder) holder.hidden = true;
      const button = dialog.querySelector<HTMLButtonElement>('[data-gg-xr]'); if (button) button.disabled = false;
      if (restore && phase === 'object') restoreObjectViewer();
    });
    listen('[data-gg-collection]', () => { if (active() && options.onCollection) { destroy(); options.onCollection(); } });
    const switchView = (next: Phase) => { if (!active() || next === phase || next === 'world' && !canEnterWorld()) return; if (next === 'world' && options.onJourney) { destroy(); options.onJourney(); return; } phase = next; selected = undefined; render(); dialog.querySelector<HTMLElement>(next === 'world' ? '[data-gg-mode="world"]' : '[data-gg-enter]')?.focus({ preventScroll: true }); };
    listen('[data-gg-enter]', () => switchView('world'));
    listen('[data-gg-journey]', () => { if (active() && options.onJourney) { destroy(); options.onJourney(); } });
    listen('[data-gg-return]', () => switchView('object'));
    listen('[data-gg-mode]', event => switchView((event.currentTarget as HTMLElement).getAttribute('data-gg-mode') === 'world' ? 'world' : 'object'));
    listen('[data-gg-point]', event => reveal((event.currentTarget as HTMLElement).getAttribute('data-gg-point') || ''));
    listen('[data-gg-story-item]', event => reveal((event.currentTarget as HTMLElement).getAttribute('data-gg-story-item') || ''));
    listen('[data-gg-show-story]', () => reveal(selected || points[0].id, false));
    dialog.querySelectorAll<HTMLElement>('[data-gg-point]').forEach(button => {
      const enter = () => { hovered = button.getAttribute('data-gg-point') || undefined; layoutPoints(); };
      const leave = () => { if (document.activeElement !== button) { hovered = undefined; layoutPoints(); } };
      button.addEventListener('pointerenter', enter, { signal: viewEvents.signal }); button.addEventListener('focus', enter, { signal: viewEvents.signal });
      button.addEventListener('pointerleave', leave, { signal: viewEvents.signal }); button.addEventListener('blur', () => { hovered = undefined; layoutPoints(); }, { signal: viewEvents.signal });
    });
    dialog.querySelector<HTMLImageElement>('[data-gg-poster] img')?.addEventListener('error', event => { if (active()) { (event.currentTarget as HTMLElement).hidden = true; if (!dialog.querySelector('.gg-visual')?.classList.contains('is-ready')) text('[data-gg-caption]', 'Image unavailable · the story is still readable.'); } }, { signal: viewEvents.signal });
    void loadViewer();
  }
  async function loadViewer() {
    const generation = ++version, which = phase;
    const canvas = dialog.querySelector<HTMLElement>('[data-gg-canvas]')!, visual = dialog.querySelector<HTMLElement>('.gg-visual')!;
    const status = dialog.querySelector<HTMLElement>('[data-gg-status]')!, controls = dialog.querySelector<HTMLElement>('[data-gg-controls]')!;
    const current = () => active() && version === generation && phase === which && canvas.isConnected;
    const source = mediaUrl(which === 'object' ? gift.modelUrl : gift.worldUrl);
    let failed = false;
    let walking = false;
    const tourState = (state: GeneratedWorldTourState) => {
      if (!current() || failed || which !== 'world') return;
      tour = state;
      const panel = dialog.querySelector<HTMLElement>('[data-gg-tour-panel]')!, button = dialog.querySelector<HTMLButtonElement>('[data-gg-tour-start]')!;
      const activeTour = state.phase !== 'idle', playing = state.phase === 'playing', complete = state.phase === 'completed';
      panel.hidden = !activeTour; button.setAttribute('aria-pressed', String(activeTour));
      const reader = dialog.querySelector<HTMLElement>('[data-gg-tour-reader]')!;
      reader.hidden = !activeTour || (state.stage !== 'reading' && !complete);
      panel.classList.toggle('is-reading', activeTour && !reader.hidden);
      text('[data-gg-tour-start-label]', complete ? 'Replay tour' : playing ? 'Pause tour' : activeTour ? state.reducedMotion ? 'Tour chapters' : 'Resume tour' : 'Guided tour');
      const hint = dialog.querySelector<HTMLElement>('.gg-world-hint'); if (hint) hint.hidden = activeTour;
      const dock = dialog.querySelector<HTMLElement>('.gg-keepsake-dock'); if (dock) dock.hidden = activeTour;
      if (!activeTour) { text('[data-gg-caption]', 'Drag to look around · tap a numbered light to read'); layoutPoints(); return; }
      hidePoint();
      const point = points.find(point => point.id === state.pointId); if (!point) return;
      selected = point.id;
      markSelected(point.id);
      const journey = state.stage === 'arrival' ? 'Flying in' : state.stage === 'travel' ? 'Flying to the next view' : 'At the viewpoint';
      text('[data-gg-tour-status]', `${complete ? 'Tour complete' : state.reducedMotion ? 'Still tour' : playing ? journey : 'Tour paused'} · ${state.index + 1} / ${state.count}`);
      tourReader?.update({ ...readerData(point), playback: complete ? 'completed' : state.reducedMotion ? 'still' : playing ? 'playing' : 'paused', closeLabel: 'Exit tour' });
      const toggle = dialog.querySelector<HTMLButtonElement>('[data-gg-tour-toggle]')!; toggle.hidden = state.reducedMotion && !complete;
      toggle.textContent = complete ? 'Replay tour' : playing ? 'Pause' : 'Resume';
      dialog.querySelector<HTMLButtonElement>('[data-gg-tour-next]')!.hidden = complete;
      dialog.querySelectorAll<HTMLElement>('[data-gg-tour-step]').forEach(step => step.classList.toggle('is-current', step.getAttribute('data-gg-tour-step') === String(state.index)));
      text('[data-gg-tour-note]', complete ? 'Your world is still here. Explore at your own pace.' : state.reducedMotion ? 'Still viewpoints. Next changes the view without animation.' : state.reason === 'hidden' || state.reason === 'offscreen' ? 'Paused while this view was away. Resume when you are ready.' : state.reason === 'manual' ? 'Paused so you can explore. Resume whenever you like.' : state.stage === 'reading' ? 'A moment to read. Pause to stay here.' : 'A new angle ahead. Drag or use the controls to pause.');
      text('[data-gg-caption]', complete ? 'Tour complete · keep exploring' : playing ? 'Drone tour · drag to pause' : state.reducedMotion ? 'Still tour · choose Next viewpoint' : 'Tour paused · explore or resume');
      layoutPoints();
    };
    const walkingState = (state: { available: boolean; enabled: boolean }) => {
      if (!current() || failed || which !== 'world') return;
      walking = state.enabled;
      const button = dialog.querySelector<HTMLButtonElement>('[data-gg-walk]');
      if (button) { button.disabled = !state.available; button.setAttribute('aria-pressed', String(state.enabled)); button.setAttribute('title', state.available ? state.enabled ? 'Stop walking' : 'Walk in this world' : 'Walking is unavailable for this world'); button.setAttribute('aria-label', state.available ? state.enabled ? 'Stop walking' : 'Walk in this world' : 'Walking is unavailable for this world'); }
      dialog.querySelector<HTMLElement>('[data-gg-walk-controls]')!.hidden = !state.enabled;
      dialog.querySelectorAll<HTMLElement>('[data-gg-offset]').forEach(element => element.hidden = state.enabled);
      text('[data-gg-caption]', state.enabled ? 'Walk with the arrows or WASD · drag to look around' : tour?.phase === 'playing' ? 'Drone tour · drag to pause' : tour?.phase === 'paused' ? tour.reducedMotion ? 'Still tour · choose Next viewpoint' : 'Tour paused · explore or resume' : 'Drag to look around · tap a numbered light to read');
    };
    const fallback = (message: string) => {
      if (!current()) return; failed = true; viewer?.destroy(); viewer = undefined; controls.hidden = true;
      if (which === 'world') { dialog.querySelector<HTMLElement>('[data-gg-tour-panel]')!.hidden = true; dialog.querySelector<HTMLElement>('[data-gg-tour-reader]')!.hidden = true; dialog.querySelector<HTMLButtonElement>('[data-gg-tour-start]')!.disabled = true; }
      visual.classList.remove('is-ready'); dialog.querySelector<HTMLElement>('[data-gg-points]')!.hidden = true;
      status.hidden = false; status.classList.add('is-fallback'); status.innerHTML = `<span>${escape(message)}</span><button class="gg-quiet" type="button" data-gg-retry>${expired() ? 'Close to refresh' : 'Retry 3D'}</button>`;
      text('[data-gg-caption]', which === 'world' ? 'Image and story view · spatial 3D unavailable' : 'Image and story view · 3D object unavailable');
      listen('[data-gg-retry]', () => { if (!current()) return; if (expired()) exit(); else { render(); dialog.querySelector<HTMLElement>(which === 'object' ? '[data-gg-enter]' : '[data-gg-return]')?.focus({ preventScroll: true }); } });
    };
    if (!source) { fallback(expired() ? 'Media access has expired. Reopen the gift to refresh it.' : 'This 3D asset is not available yet. Your image and story remain here.'); return; }
    const ready = () => {
      if (!current() || failed) return; visual.classList.add('is-ready'); status.hidden = true; controls.hidden = false;
      text('[data-gg-caption]', which === 'object' ? 'Drag to rotate · pinch or scroll to zoom' : 'Drag to look around · tap a numbered light to read');
      if (which === 'world') dialog.querySelector<HTMLElement>('[data-gg-points]')!.hidden = false;
      if (which === 'world') dialog.querySelector<HTMLButtonElement>('[data-gg-tour-start]')!.disabled = false;
    };
    const progress = (state: ViewerProgress) => { if (current() && !failed) status.textContent = state.phase === 'decoding' ? 'Preparing this scene for your device…' : state.loadedBytes ? `Opening the scene · ${Math.round(state.loadedBytes / 1024)} KB received` : 'Opening the scene…'; };
    const projected = (positions: ProjectedWorldPoint[]) => {
      if (!current() || failed || which !== 'world') return;
      projectedPoints = positions; layoutPoints();
    };
    try {
      let next: ObjectHandle | GeneratedWorldHandle;
      if (which === 'object') { const module = await import('./scene'); if (!current()) return; next = module.mountMemoryScene(canvas, { modelUrl: source, backgroundUrl: mediaUrl(gift.originalUrl), photoIntent:gift.photoIntent,objectRepresentation:gift.objectRepresentation,modelYaw:gift.modelYaw,photoUrl:mediaUrl(gift.originalUrl),theme: 'dusk', unboxing: false, onReady: ready, onError: () => fallback('The 3D souvenir could not open. Your image and story remain available.'), onProgress: progress }); }
      else { const module = await import('./generated-world'); if (!current()) return; next = module.mountGeneratedWorld(canvas, source, { points: points.map(point => ({ ...point, readingDurationMs: Math.max(12000, Math.min(35000, point.text.length * 38 + 8000)) })), flightProfile, collisionUrl: mediaUrl(gift.collisionUrl || gift.colliderUrl), onWalkingChange: walkingState, onTourChange: tourState,
        onViewpointChange: state => { if (!current() || failed || selected !== state.pointId || pendingFocus !== state.pointId) return; if (state.phase === 'arrived') { pendingFocus = undefined; const point = points.find(point => point.id === state.pointId); if (point) showPoint(point); text('[data-gg-caption]', 'At your viewpoint · close the story to explore'); } else { if (state.phase === 'cancelled') pendingFocus = undefined; hidePoint(); text('[data-gg-caption]', state.phase === 'travelling' ? 'Flying to your viewpoint…' : 'Explore at your own pace · open Stories to read'); } },
        onReady: ready, onError: () => fallback('The 3D world could not open. Your image and story remain available.'), onProgress: progress, onPoints: projected, initialYaw: gift.initialYaw, initialPitch: gift.initialPitch }); }
      if (!current() || failed) { next.destroy(); return; } viewer = next;
      if (which === 'world') {
        const world = next as GeneratedWorldHandle;
        const toggleTour = () => {
          if (!current() || failed || !visual.classList.contains('is-ready')) return;
          if (!tour || tour.phase === 'idle' || tour.phase === 'completed') world.startTour();
          else if (tour.phase === 'playing') world.pauseTour();
          else if (tour.reducedMotion) dialog.querySelector<HTMLElement>('[data-gg-tour-panel]')!.hidden = false;
          else world.resumeTour();
        };
        listen('[data-gg-tour-start],[data-gg-tour-toggle]', toggleTour);
        listen('[data-gg-tour-next]', () => { if (current() && !failed) world.nextTour(); });
        listen('[data-gg-tour-stop]', () => { if (current() && !failed) { world.stopTour(); dialog.querySelector<HTMLElement>('[data-gg-tour-start]')!.focus({ preventScroll: true }); } });
      }
      listen('[data-gg-control]', event => {
        if (!current() || failed || !viewer) return;
        const action = (event.currentTarget as HTMLElement).getAttribute('data-gg-control');
        if (action === 'reset') viewer.reset();
        else if (which === 'object') { const object = viewer as ObjectHandle; if (action === 'left') object.rotate(.2); if (action === 'right') object.rotate(-.2); if (action === 'in') object.zoom(-.12); if (action === 'out') object.zoom(.12); }
        else {
          const world = viewer as GeneratedWorldHandle;
          if (action === 'left') world.look(.2, 0); if (action === 'right') world.look(-.2, 0); if (action === 'forward') world.forward(); if (action === 'backward') world.backward();
          if (action === 'walk') { const enabled = world.setWalking(!walking); walkingState({ available: world.walkingAvailable, enabled }); }
          if (action === 'move-left') world.move(-1, 0); if (action === 'move-right') world.move(1, 0); if (action === 'move-forward') world.move(0, 1); if (action === 'move-back') world.move(0, -1);
        }
      });
    } catch { fallback('The 3D viewer could not load. Your image and story remain available. Retry to reopen the viewer.'); }
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); exit(); }, { signal: events.signal });
  dialog.addEventListener('close', () => { if (!dead && options.isCurrent()) { destroy(); options.onExit(); } }, { signal: events.signal });
  if (!host.isConnected || !options.isCurrent()) { destroy(); return { destroy }; }
  host.append(dialog);
  try {
    dialog.showModal(); scrolling = [document.documentElement.style, document.body.style].map(style => ({ style, value: style.getPropertyValue('overflow'), priority: style.getPropertyPriority('overflow') }));
    for (const saved of scrolling) saved.style.setProperty('overflow', 'hidden');
    render(); (dialog.querySelector<HTMLElement>(phase === 'world' ? '[data-gg-mode="world"]' : '[data-gg-enter],[data-gg-journey]') || dialog.querySelector<HTMLElement>(`[id="generated-gift-title-${instance}"]`))?.focus({ preventScroll: true });
  } catch { destroy(); if (options.isCurrent()) options.onExit(); }
  return { destroy };
}
