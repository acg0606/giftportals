import type { MediaDTO, MemoryDTO } from '../shared/contracts';
import { demoFixtureKey } from './journey-state';

export interface MemoryPortalOptions {
  memory: MemoryDTO;
  isCurrent: () => boolean;
  onExit: () => void;
  onExplore: () => void;
}
export interface MemoryPortalHandle { destroy(): void }
interface PortalViewer { destroy(): void; reset(): void; rotate?: (delta: number) => void; forward?: () => void; backward?: () => void }
type Phase = 'object' | 'world';
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
let portalSequence = 0;

/** A reversible encounter with existing authorized assets. No progress or provider writes. */
export function mountMemoryPortal(host: HTMLElement, options: MemoryPortalOptions): MemoryPortalHandle {
  const memory = options.memory, bird = demoFixtureKey(memory) === 'bird', instance = ++portalSequence;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog'); dialog.className = 'memory-portal';
  dialog.setAttribute('aria-labelledby', `memory-portal-title-${instance}`);
  let dead = false, version = 0, phase: Phase = 'object', viewer: PortalViewer | undefined;
  let openingTimer: ReturnType<typeof setTimeout> | undefined;
  const events = new AbortController(); let viewEvents = new AbortController();
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const active = () => !dead && options.isCurrent() && dialog.isConnected && dialog.open && host.contains(dialog);
  const expired = (media?: MediaDTO) => !!media?.expiresAt && media.expiresAt <= Date.now() / 1000;
  const original = memory.media.find(media => media.kind === 'gift-photo') || memory.media.find(media => media.kind === 'place-photo');
  const panorama = memory.media.find(media => media.kind === 'world' && media.mimeType.startsWith('image/')) || memory.media.find(media => media.kind === 'place-photo');
  const model = memory.media.find(media => media.kind === 'model');
  const world = memory.media.find(media => media.kind === 'world' && !media.mimeType.startsWith('image/'));
  function imageUrl(media?: MediaDTO) {
    if (!media || expired(media)) return '';
    try {
      const url = new URL(media.url, location.origin);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password || bird && url.protocol === 'data:' && media.mimeType.startsWith('image/') ? media.url : '';
    } catch { return ''; }
  }
  function poster(which: Phase) {
    const media = which === 'object' ? original : panorama || original, url = imageUrl(media);
    const alt = which === 'object' ? bird ? 'AI-generated fictional bird reference' : 'Author’s original gift reference' : media?.kind === 'world' ? 'Authorized artistic panorama' : 'Author’s original reference';
    return url ? `<img src="${escape(url)}" alt="${alt}"/>` : `<div class="mp-unavailable"><span aria-hidden="true">◇</span><p>${expired(media) ? 'Image access expired' : 'Original image unavailable'}</p></div>`;
  }
  function sourceCaption() {
    return bird ? 'Fictional AI-generated reference · artistic 3D interpretations · originals retained' : 'Artistic interpretations · author-controlled original files remain available';
  }
  function quote() {
    const exact = 'The physical gift can wait. This little world can arrive today.';
    if (bird && memory.story.includes(exact)) return exact;
    const text = memory.story.trim(); if (!text) return 'No story text is attached to this memory.';
    return text.length > 310 ? `${text.slice(0, 310).replace(/\s+\S*$/, '')}…` : text;
  }
  function destroyViewer() { version++; viewer?.destroy(); viewer = undefined; }
  function destroy() {
    if (dead) return; dead = true; destroyViewer(); clearTimeout(openingTimer); events.abort(); viewEvents.abort();
    if (dialog.open) dialog.close(); dialog.remove();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  function exit() { if (!active()) return; destroy(); options.onExit(); }
  function explore() { if (!active()) return; destroy(); options.onExplore(); }
  function listen(target: Element | null, event: string, callback: (event: Event) => void) { target?.addEventListener(event, callback, { signal: viewEvents.signal }); }
  function render(opening = false) {
    destroyViewer(); viewEvents.abort(); viewEvents = new AbortController(); clearTimeout(openingTimer);
    if (dead || !options.isCurrent() || !dialog.isConnected) return;
    dialog.classList.remove('is-looking'); dialog.classList.toggle('is-world', phase === 'world'); dialog.classList.toggle('is-opening', opening && !reduced());
    dialog.innerHTML = `<div class="mp-shell"><header class="mp-header"><div><span class="mp-brand">GIFT PORTALS / MEMORY PORTAL</span><span class="mp-memory-name">${escape(memory.title)}</span></div><button class="mp-close" data-mp-exit aria-label="Close memory portal">Close <span aria-hidden="true">×</span></button></header><div class="mp-encounter"><div class="mp-visual" data-mp-visual><div class="mp-poster" data-mp-poster>${poster(phase)}</div><div class="mp-canvas" data-mp-canvas></div><div class="mp-load" role="status" data-mp-status>${phase === 'object' ? 'Opening the object…' : 'Opening the artistic world…'}</div></div><div class="mp-copy">${phase === 'object' ? `<span class="mp-eyebrow">${bird ? 'MAYA’S FICTIONAL SOUVENIR' : `A MEMORY FROM ${escape(memory.ownerName.toUpperCase())}`}</span><h1 id="memory-portal-title-${instance}" tabindex="-1" data-mp-title>A small gift.<br/> A world within.</h1><p>${bird ? 'A little ceramic bird carries an afternoon, and the conversations still ahead.' : 'The original object carries a story. Its attached world offers another way to feel it.'}</p><button class="mp-primary" data-mp-step>Step inside this memory <span aria-hidden="true">↗</span></button><small>Opens existing artistic media. Your exploration progress stays unchanged.</small>` : `<span class="mp-eyebrow">${bird ? 'MAYA’S WORDS' : `FROM ${escape(memory.ownerName.toUpperCase())}`}</span><h1 id="memory-portal-title-${instance}" tabindex="-1" data-mp-title>A feeling can<br/> arrive today.</h1><blockquote data-mp-quote hidden><p>${escape(quote())}</p><cite>— ${escape(memory.ownerName)}${bird ? ' · fictional story' : ''}</cite></blockquote><button class="mp-primary" data-mp-explore>Explore the three fragments <span aria-hidden="true">→</span></button><small>Continue with Object, World and Story. Nothing is automatically revealed or kept.</small>`}</div></div><footer class="mp-footer"><div class="mp-viewer-controls" data-mp-controls hidden></div><div class="mp-provenance"><span data-mp-view-kind>${phase === 'object' ? 'Original reference · preparing 3D' : panorama?.kind === 'world' ? 'Artistic panorama · preparing 3D' : 'Original reference · preparing 3D'}</span><span>${sourceCaption()}</span></div></footer></div>`;
    listen(dialog.querySelector('[data-mp-exit]'), 'click', exit);
    listen(dialog.querySelector('[data-mp-explore]'), 'click', explore);
    if (phase === 'world') {
      const quick = document.createElement('button'); quick.className = 'mp-primary mp-world-explore'; quick.setAttribute('data-mp-quick-explore', '');
      quick.innerHTML = 'Explore the three fragments <span aria-hidden="true">→</span>';
      dialog.querySelector('.mp-encounter')?.append(quick); listen(quick, 'click', explore);
    }
    listen(dialog.querySelector('[data-mp-step]'), 'click', () => {
      if (!active() || phase !== 'object') return;
      phase = 'world'; render(true); dialog.querySelector<HTMLElement>('[data-mp-title]')?.focus({ preventScroll: true });
    });
    if (opening && !reduced()) openingTimer = setTimeout(() => { if (active()) dialog.classList.remove('is-opening'); }, 720);
    void loadViewer(phase);
  }
  async function loadViewer(which: Phase) {
    const currentVersion = ++version, visual = dialog.querySelector<HTMLElement>('[data-mp-visual]')!, canvasHost = dialog.querySelector<HTMLElement>('[data-mp-canvas]')!;
    const status = dialog.querySelector<HTMLElement>('[data-mp-status]')!, kind = dialog.querySelector<HTMLElement>('[data-mp-view-kind]')!, controls = dialog.querySelector<HTMLElement>('[data-mp-controls]')!;
    const current = () => active() && currentVersion === version && which === phase && canvasHost.isConnected;
    const source = which === 'object' ? model : world; let failed = false;
    const fallback = (accessExpired = false, freshPage = false) => {
      if (!current()) return; dialog.classList.remove('is-looking'); dialog.querySelector<HTMLElement>('[data-mp-quote]')?.removeAttribute('hidden'); failed = true; viewer?.destroy(); viewer = undefined; visual.classList.remove('is-ready'); controls.hidden = true;
      status.hidden = false; status.classList.add('is-fallback');
      status.innerHTML = `<span>${accessExpired ? 'Media access expired. Close and reopen the memory to refresh access.' : freshPage ? 'The 3D viewer could not load. Reloading resets your exploration session.' : '3D is unavailable. The authorized image and story remain here.'}</span><button data-mp-retry>${accessExpired ? 'Close to refresh' : freshPage ? 'Reload preview ↻' : 'Retry 3D ↻'}</button>`;
      kind.textContent = which === 'world' && panorama?.kind === 'world' ? 'Artistic panorama · 3D unavailable' : 'Original reference · 3D unavailable';
      listen(status.querySelector('[data-mp-retry]'), 'click', () => { if (!current()) return; if (accessExpired) exit(); else if (freshPage) location.reload(); else { render(); dialog.querySelector<HTMLElement>(phase === 'object' ? '[data-mp-step]' : '[data-mp-title]')?.focus({ preventScroll: true }); } });
    };
    if (!source) { dialog.querySelector<HTMLElement>('[data-mp-quote]')?.removeAttribute('hidden'); status.remove(); kind.textContent = which === 'object' ? 'Original reference · no 3D object attached' : panorama?.kind === 'world' ? 'Artistic panorama · no 3D world attached' : 'Original reference · no 3D world attached'; return; }
    if (expired(source)) { fallback(true); return; }
    const ready = () => {
      if (!current() || failed) return; dialog.querySelector<HTMLElement>('[data-mp-quote]')?.removeAttribute('hidden'); visual.classList.add('is-ready'); status.hidden = true; controls.hidden = false;
      kind.textContent = which === 'object' ? `${source.provider === 'tripo' ? 'Tripo' : 'Attached'} 3D object · drag to rotate` : `${source.provider === 'worldlabs' ? 'World Labs' : 'Attached'} 3D artistic environment · drag to look`;
    };
    const progress = (value: { phase: 'loading' | 'decoding'; loadedBytes: number; totalBytes: number | null }) => {
      if (!current() || failed) return; status.textContent = value.phase === 'decoding' ? 'Preparing this scene for your device…' : value.loadedBytes ? `Opening the scene · ${Math.round(value.loadedBytes / 1024)} KB received` : 'Opening the scene…';
    };
    try {
      let handle: PortalViewer;
      if (which === 'object') { const module = await import('./scene'); if (!current()) return; handle = module.mountMemoryScene(canvasHost, { modelUrl: source.url, onReady: ready, onError: () => fallback(), onProgress: progress }); }
      else { const module = await import('./environment'); if (!current()) return; handle = module.mountGeneratedEnvironment(canvasHost, source.url, ready, () => fallback(), progress, bird ? { initialYaw: -1.25, fieldOfView: 75 } : undefined); }
      if (!current() || failed) { handle.destroy(); return; } viewer = handle;
      controls.innerHTML = which === 'object' ? '<span>Drag to rotate · pinch or scroll to zoom</span><button data-mp-control="reset">↺ Reset</button>' : '<span>Drag to look around</span><button data-mp-control="back">← Back</button><button data-mp-control="forward">Forward →</button><button data-mp-control="reset">↺ Reset</button><button data-mp-look aria-pressed="false">Look around</button>';
      controls.querySelectorAll<HTMLElement>('[data-mp-control]').forEach(button => listen(button, 'click', () => { if (!current()) return; if (button.dataset.mpControl === 'back') viewer?.backward?.(); if (button.dataset.mpControl === 'forward') viewer?.forward?.(); if (button.dataset.mpControl === 'reset') viewer?.reset(); }));
      listen(controls.querySelector('[data-mp-look]'), 'click', event => { if (!current()) return; const looking = dialog.classList.toggle('is-looking'); const button = event.currentTarget as HTMLButtonElement; button.setAttribute('aria-pressed', String(looking)); button.textContent = looking ? 'Show story' : 'Look around'; });
    } catch { fallback(false, true); }
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); exit(); }, { signal: events.signal });
  dialog.addEventListener('close', () => { if (!dead && options.isCurrent()) { destroy(); options.onExit(); } }, { signal: events.signal });
  if (!host.isConnected || !options.isCurrent()) { dead = true; return { destroy }; }
  host.append(dialog);
  try { dialog.showModal(); render(); dialog.querySelector<HTMLElement>('[data-mp-step]')?.focus({ preventScroll: true }); }
  catch { destroy(); options.onExit(); }
  return { destroy };
}
