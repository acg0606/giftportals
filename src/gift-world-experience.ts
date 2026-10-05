import './generated-gift.css';
import type { GeneratedGiftData } from './generated-gift';
import type { GeneratedWorldHandle } from './generated-world';
import type { WorldCinematicState } from './world-flight';
import { viewerAssetUrl } from './viewer-runtime';
import { readGiftWorldSpawn, readGiftWorldEyeHeight } from './gift-walk-catalog';

export interface GiftWorldExperienceOptions {
  gift: GeneratedGiftData; isCurrent(): boolean; onExit(): void; onCollection?(): void;
}
export interface GiftWorldExperienceHandle { destroy(): void }
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]!));
function media(value: string | undefined, gift: GeneratedGiftData, origin: string): string {
  if (!value || gift.mediaExpiresAt && gift.mediaExpiresAt <= Date.now() / 1000) return '';
  try { return viewerAssetUrl(value, origin).href; } catch { return ''; }
}
function creditLink(value: string): string {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function keepsakeReference(gift: GeneratedGiftData, origin: string): string {
  const reference = media(gift.keepsakeImageUrl, gift, origin);
  if (!reference) return '';
  // Signed queries or fragments do not turn the same photograph into a souvenir.
  const identity = (value: string) => { const url = new URL(value); let path = url.pathname; try { path = decodeURIComponent(path); } catch { /* Keep malformed escapes literal. */ } return `${url.origin}${path}`; };
  return [gift.originalUrl, gift.sourcePhotoUrl].some(value => {
    const source = media(value, gift, origin);
    return source && identity(source) === identity(reference);
  }) ? '' : reference;
}

/** One newspaper contains the actual attached narrative and media. It never
 * substitutes a reconstructed panorama for the attached source image. */
export function giftWorldNewspaperMarkup(gift: GeneratedGiftData, origin: string): string {
  const original = media(gift.sourcePhotoUrl || gift.originalUrl, gift, origin), reference = keepsakeReference(gift, origin), model = media(gift.modelUrl, gift, origin);
  const artistic = gift.sourceImageKind === 'artistic-reference', imageCaption = artistic ? 'Scene reference' : 'The original photograph';
  const imageAlt = artistic ? 'Artistic scene reference attached to' : 'Original photo attached to';
  const unavailable = artistic ? 'The scene reference is unavailable.' : 'The original photograph is unavailable.';
  const byline = [gift.senderName ? `From ${gift.senderName}` : '', gift.recipientName ? `For ${gift.recipientName}` : ''].filter(Boolean).join(' · ');
  const attribution = gift.sourceAttribution, source = attribution && creditLink(attribution.sourceUrl), license = attribution && creditLink(attribution.licenseUrl);
  const creditContext = artistic ? gift.worldUrl ? 'World generated from this artistic reference' : 'Artistic scene reference' : gift.worldUrl ? 'World generated from this photograph' : 'Original photograph';
  const credit = attribution ? `<p class="gw-photo-credit">${creditContext} · ${source ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(attribution.author)}</a>` : esc(attribution.author)} · ${license ? `<a href="${esc(license)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(attribution.license)}</a>` : esc(attribution.license)}</p>` : artistic ? `<p class="gw-photo-credit">${creditContext}</p>` : '';
  const referenceMarkup = reference ? `<figure class="gw-keepsake-reference" data-gw-keepsake-reference${model ? ' hidden' : ''}><img src="${esc(reference)}" alt="Keepsake reference attached to ${esc(gift.title)}" referrerpolicy="no-referrer"/><figcaption>Keepsake reference${model ? ' · 3D preview unavailable' : ''}</figcaption></figure>` : '';
  const keepsake = model || reference ? `<aside class="gw-newspaper-keepsake">${model ? `<div class="gw-keepsake-model" data-gw-keepsake-model aria-label="3D souvenir for ${esc(gift.title)}"><div data-gw-keepsake-canvas></div><p role="status" aria-live="polite" data-gw-keepsake-status>Loading your 3D souvenir…</p></div>` : ''}${referenceMarkup}<div><strong>${model ? 'Your Tripo keepsake' : 'Keepsake reference'}</strong><p>${model ? 'The delivered 3D souvenir.' : 'The reference image attached to this gift.'}</p>${model ? `<a href="${esc(model)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open the delivered 3D model ↗</a>` : ''}</div></aside>` : '';
  return `<article class="gw-newspaper" role="dialog" aria-modal="true" aria-labelledby="gw-newspaper-title" tabindex="-1" data-gw-newspaper><header class="gw-newspaper-masthead"><span>THE GIFTPORTALS MEMORY EDITION</span><button type="button" data-gw-close-paper aria-label="Close the newspaper and explore">Close ×</button></header><div class="gw-newspaper-heading"><span>A place worth returning to</span><h1 id="gw-newspaper-title">${esc(gift.title)}</h1>${byline ? `<p class="gw-newspaper-byline">${esc(byline)}</p>` : ''}</div><div class="gw-newspaper-columns"><div>${original ? `<figure class="gw-original-photo"><img src="${esc(original)}" alt="${imageAlt} ${esc(gift.title)}" referrerpolicy="no-referrer"/><figcaption>${imageCaption}</figcaption></figure>${credit}` : `<p class="gw-media-note">${unavailable}</p>`}${keepsake}</div><div class="gw-newspaper-story">${gift.dedication ? `<p class="gw-newspaper-dedication">${esc(gift.dedication)}</p>` : ''}<p>${esc(gift.story || 'No story text is attached to this gift.')}</p><div class="gw-newspaper-end">A memory, kept close.</div></div></div><footer><button type="button" data-gw-close-paper>Explore this world →</button><span>Close this edition to look around at your own pace.</span></footer></article>`;
}

/** This is an arrival in the delivered SPZ, followed by one complete newspaper.
 * No chapters, provider calls, autoplay audio or invented walkable floor. */
export function mountGiftWorldExperience(host: HTMLElement, options: GiftWorldExperienceOptions): GiftWorldExperienceHandle {
  const gift = options.gift, events = new AbortController(), opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let dead = false, viewer: GeneratedWorldHandle | undefined, paperOpen = false, paperOpened = false, ready = false, walkingAvailable = false;
  let miniature: { destroy(): void } | undefined, miniatureRevision = 0;
  const active = () => !dead && host.isConnected && options.isCurrent();
  host.innerHTML = `<section class="gift-world-experience" aria-label="${esc(gift.title)} · world arrival"><header class="gw-header"><a class="gw-brand" href="#/home"><img src="/assets/portal-dusk/brand-mark.png" alt=""/>GiftPortals</a><span>${esc(gift.title)}</span><div>${options.onCollection ? '<button type="button" data-gw-collection>Another gift</button>' : ''}<button type="button" data-gw-exit>${gift.modelUrl ? 'Back to keepsake' : 'Close world'}</button></div></header><div class="gw-canvas" data-gw-canvas></div><div class="gw-arrival" data-gw-arrival><p role="status" aria-live="polite" data-gw-status>Opening the world inside…</p><button type="button" data-gw-skip hidden>Open the newspaper now</button></div><div class="gw-paper-holder" data-gw-paper hidden></div><footer class="gw-explore" data-gw-explore hidden><p role="status" data-gw-explore-status></p><nav aria-label="World exploration"><button type="button" data-gw-direction="left" aria-label="Walk left">←</button><button type="button" data-gw-direction="forward" aria-label="Walk forward">↑</button><button type="button" data-gw-direction="right" aria-label="Walk right">→</button><button type="button" data-gw-direction="backward" aria-label="Walk backward">↓</button><button type="button" data-gw-paper-open>Read the newspaper</button><button type="button" data-gw-reset>Starting view</button></nav></footer></section>`;
  const find = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const canvas = find<HTMLElement>('[data-gw-canvas]'), paper = find<HTMLElement>('[data-gw-paper]'), explore = find<HTMLElement>('[data-gw-explore]'), arrival = find<HTMLElement>('[data-gw-arrival]');
  const stop = () => viewer?.setMoveInput(0, 0);
  function stopMiniature() { miniatureRevision++; miniature?.destroy(); miniature = undefined; }
  function showMiniature() {
    const model = media(gift.modelUrl, gift, location.origin), slot = paper.querySelector<HTMLElement>('[data-gw-keepsake-model]'), target = paper.querySelector<HTMLElement>('[data-gw-keepsake-canvas]');
    if (!model || !slot || !target) return;
    const revision = miniatureRevision, current = () => active() && paperOpen && revision === miniatureRevision;
    const status = paper.querySelector<HTMLElement>('[data-gw-keepsake-status]')!;
    function failed() {
      if (!current()) return;
      status.textContent = 'The 3D preview could not open. Use the model link below.';
      const reference = paper.querySelector<HTMLElement>('[data-gw-keepsake-reference]');
      if (reference) { slot!.hidden = true; reference.hidden = false; }
    }
    void import('./scene').then(module => {
      if (!current()) return;
      let failure = false;
      const next = module.mountMemoryScene(target, { modelUrl: model, theme: 'studio', modelYaw: gift.modelYaw, unboxing: false,
        onReady: () => { if (current()) status.textContent = 'Drag to turn your keepsake.'; },
        onError: () => { failure = true; failed(); },
      });
      if (!current() || failure) { next.destroy(); return; }
      miniature = next;
    }).catch(failed);
  }
  function explorationCopy() {
    if (!active()) return;
    find('[data-gw-explore-status]').textContent = ready ? walkingAvailable ? 'Drag to look · hold the arrows or WASD to walk inside this reconstructed scene.' : 'Drag to look around. Collision walking is unavailable for this world.' : gift.sourceImageKind === 'artistic-reference' ? 'The 3D world is unavailable. Your scene reference and story remain here.' : 'The 3D world is unavailable. Your original photograph and story remain here.';
    host.querySelectorAll<HTMLButtonElement>('[data-gw-direction]').forEach(button => button.hidden = !walkingAvailable || !ready);
    find<HTMLButtonElement>('[data-gw-reset]').hidden = !ready;
  }
  function showPaper() {
    if (!active()) return;
    stopMiniature();
    paperOpened = true; paperOpen = true; stop(); viewer?.setWalking(false); viewer?.setInteractionEnabled(false);
    arrival.hidden = true; explore.hidden = true; paper.innerHTML = giftWorldNewspaperMarkup(gift, location.origin); paper.hidden = false;
    canvas.setAttribute('aria-hidden', 'true');
    paper.querySelectorAll<HTMLButtonElement>('[data-gw-close-paper]').forEach(button => button.addEventListener('click', closePaper, { signal: events.signal }));
    paper.querySelector<HTMLElement>('[data-gw-newspaper]')?.focus({ preventScroll: true });
    showMiniature();
  }
  function closePaper() {
    if (!active() || !paperOpen) return;
    stopMiniature();
    paperOpen = false; paper.hidden = true; canvas.removeAttribute('aria-hidden'); explore.hidden = false;
    viewer?.setInteractionEnabled(true); if (walkingAvailable) viewer?.setWalking(true);
    explorationCopy(); find<HTMLButtonElement>('[data-gw-paper-open]').focus({ preventScroll: true });
  }
  function cinematic(state: WorldCinematicState) {
    if (!active() || paperOpened) return;
    find('[data-gw-status]').textContent = state.phase === 'paused' ? 'Your arrival is paused while this view is hidden.' : 'Arriving inside your memory…';
    find<HTMLButtonElement>('[data-gw-skip]').hidden = state.phase !== 'flying';
    if (state.phase === 'completed') showPaper();
  }
  function fail() { if (!active()) return; ready = false; walkingAvailable = false; if (!paperOpened) showPaper(); explorationCopy(); }
  const bind = (selector: string, action: () => void) => find<HTMLButtonElement>(selector).addEventListener('click', action, { signal: events.signal });
  bind('[data-gw-exit]', () => { if (active()) { destroy(); options.onExit(); } });
  if (options.onCollection) bind('[data-gw-collection]', () => { if (active()) { destroy(); options.onCollection?.(); } });
  bind('[data-gw-paper-open]', showPaper);
  bind('[data-gw-skip]', () => viewer?.skipCinematic());
  bind('[data-gw-reset]', () => { if (active() && !paperOpen) { stop(); viewer?.reset(); if (walkingAvailable) viewer?.setWalking(true); } });
  const directions: Record<string, readonly [number,number]> = { left: [-1,0], right: [1,0], forward: [0,1], backward: [0,-1] };
  host.querySelectorAll<HTMLButtonElement>('[data-gw-direction]').forEach(button => {
    button.addEventListener('pointerdown', event => { if (!active() || paperOpen || !walkingAvailable) return; event.preventDefault(); try { button.setPointerCapture(event.pointerId); } catch { /* A release still stops input. */ } const vector = directions[button.dataset.gwDirection!]; viewer?.setMoveInput(vector[0], vector[1]); }, { signal: events.signal });
    for (const name of ['pointerup','pointercancel','lostpointercapture'] as const) button.addEventListener(name, stop, { signal: events.signal });
    button.addEventListener('click', event => { if (event.detail === 0 && active() && !paperOpen && walkingAvailable) { const vector = directions[button.dataset.gwDirection!]; viewer?.move(vector[0], vector[1]); } }, { signal: events.signal });
  });
  window.addEventListener('blur', stop, { signal: events.signal });
  host.addEventListener('keydown', event => { if (!active()) return; if (paperOpen && event.key === 'Escape') { event.preventDefault(); closePaper(); } if (paperOpen && event.key === 'Tab') { const buttons = Array.from(paper.querySelectorAll<HTMLElement>('button,a[href]')), first = buttons[0], last = buttons.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }, { signal: events.signal });
  const world = media(gift.worldUrl, gift, location.origin);
  if (!world) fail();
  else void import('./generated-world').then(module => {
    if (!active()) return;
    const scale = gift.worldSemantics?.metricScaleFactor;
    const next = module.mountGeneratedWorld(canvas, world, { points: [], cinematicArrival: true, onCinematicState: cinematic,
      initialYaw: gift.initialYaw, initialPitch: gift.initialPitch, collisionUrl: media(gift.collisionUrl || gift.colliderUrl, gift, location.origin), panoramaUrl: media(gift.panoramaUrl, gift, location.origin),
      firstPerson: { spawn: readGiftWorldSpawn(gift.initialSpawn), eyeHeight: readGiftWorldEyeHeight(gift.initialEyeHeight) ?? 1.6, metricScale: scale, groundOffset: gift.worldSemantics?.groundPlaneOffset, autoCalibrate: true, maxRadius: 20, walkSpeed: 1.4 },
      onWalkingChange: state => { if (!active()) return; walkingAvailable = state.available; if (!paperOpen && paperOpened && state.available && !state.enabled) viewer?.setWalking(true); explorationCopy(); },
      onReady: () => { if (active()) ready = true; }, onError: fail,
      onProgress: state => { if (active() && !paperOpened) find('[data-gw-status]').textContent = state.phase === 'decoding' ? 'Preparing your generated world…' : 'Opening the world inside…'; },
    });
    if (!active()) { next.destroy(); return; } viewer = next;
  }).catch(fail);
  function destroy() { if (dead) return; dead = true; stop(); stopMiniature(); events.abort(); viewer?.destroy(); viewer = undefined; host.replaceChildren(); if (opener?.isConnected) opener.focus({ preventScroll: true }); }
  return { destroy };
}
