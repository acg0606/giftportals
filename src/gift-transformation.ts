import './gift-transformation.css';
import type { GiftTransformationState, GiftTransformationPhase } from './gift-transformation-state';

export interface GiftTransformationOptions {
 isCurrent(): boolean;
 onOpenKeepsake?(): void;
}
export interface GiftTransformationHandle {
 readonly modelHost: HTMLElement;
 update(state: GiftTransformationState): void;
 setModelVisible(visible: boolean): void;
 pulse(): void;
 destroy(): void;
}

/** Images are previews only. No provider, model decoder or progress timer runs here. */
export function transformationPhotoUrl(value: string | undefined): string | undefined {
 if (typeof value !== 'string' || !value || value.length > 9 * 1024 * 1024 || value.trim() !== value || /[<>"'\u0000-\u0020]/.test(value)) return;
 if (/^data:image\/(?:jpeg|png|webp);base64,[a-z\d+/=]+$/i.test(value)) return value;
 try {
  const url = new URL(value, location.origin);
  if (url.username || url.password) return;
  if (url.protocol === 'https:' || url.protocol === 'http:' && url.origin === location.origin || url.protocol === 'blob:' && url.origin === location.origin) return url.href;
 } catch { /* Keep a local placeholder for malformed or executable URLs. */ }
}

const phaseNames: Record<GiftTransformationPhase, string> = {
 awakening: 'Your photo, in a new light.',
 shaping: 'A keepsake is taking shape.',
 world: 'Your world is taking shape.',
 ready: 'Your keepsake is ready.',
 interrupted: 'Creation needs attention.',
};
const fragments = [
 'polygon(0 0,50% 0,33% 50%,0 50%)',
 'polygon(50% 0,100% 0,67% 50%,33% 50%)',
 'polygon(100% 0,100% 50%,67% 50%)',
 'polygon(0 50%,33% 50%,50% 100%,0 100%)',
 'polygon(33% 50%,67% 50%,50% 100%)',
 'polygon(67% 50%,100% 50%,100% 100%,50% 100%)',
];

export function mountGiftTransformation(host: HTMLElement, options: GiftTransformationOptions): GiftTransformationHandle {
 const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
  const element = document.createElement(tag); element.className = className; return element;
 };
 const root = node('section', 'gift-transformation');
 root.setAttribute('aria-label', 'Gift transformation'); root.dataset.phase = 'awakening'; root.dataset.modelVisible = 'false';
 const scene = node('div', 'gift-transformation-scene'), glow = node('div', 'gift-transformation-glow');
 scene.dataset.transformScene = ''; glow.setAttribute('aria-hidden', 'true');
 const ribbons = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
 ribbons.classList.add('gift-transformation-ribbons'); ribbons.setAttribute('viewBox', '0 0 400 330'); ribbons.setAttribute('aria-hidden', 'true'); ribbons.setAttribute('focusable', 'false');
 for (const [index, path] of [
  'M 71 269 C 346 290 351 203 122 188 C -27 178 69 90 293 127 C 393 144 311 51 189 39',
  'M 335 271 C 42 236 72 169 300 170 C 420 171 286 75 107 120 C 6 146 121 59 222 30',
  'M 135 293 C 317 257 364 136 204 125 C 30 105 88 57 275 72',
 ].entries()) {
  const ribbon = document.createElementNS('http://www.w3.org/2000/svg', 'path'); ribbon.setAttribute('d', path); ribbon.setAttribute('pathLength', '100'); ribbon.style.setProperty('--ribbon', String(index)); ribbons.append(ribbon);
 }
 const picture = node('figure', 'gift-transformation-picture'), photo = node('img', 'gift-transformation-photo'), placeholder = node('span', 'gift-transformation-placeholder');
 picture.setAttribute('aria-hidden', 'true'); photo.alt = ''; photo.decoding = 'async'; photo.referrerPolicy = 'no-referrer'; photo.hidden = true; placeholder.textContent = 'Your photo';
 picture.append(photo, placeholder);
 const pieces = node('div', 'gift-transformation-fragments'); pieces.setAttribute('aria-hidden', 'true');
 const shardImages = fragments.map((clip, index) => {
  const shard = node('img', 'gift-transformation-fragment'); shard.alt = ''; shard.decoding = 'async'; shard.referrerPolicy = 'no-referrer'; shard.hidden = true;
  shard.style.clipPath = clip; shard.style.setProperty('--fragment', String(index)); shard.style.setProperty('--direction', index % 2 ? '-1' : '1');
  shard.style.setProperty('--drift-x', `${[53, -28, -67, 61, 26, -55][index]}px`); shard.style.setProperty('--drift-y', `${[-41, -68, -18, 25, 54, 32][index]}px`);
  pieces.append(shard); return shard;
 });
 const volume = node('div', 'gift-transformation-volume'); volume.setAttribute('aria-hidden', 'true');
 for (let i = 0; i < 3; i++) { const facet = node('div', 'gift-transformation-facet'); facet.style.setProperty('--facet', String(i)); volume.append(facet); }
 const floor = node('div', 'gift-transformation-floor'); floor.setAttribute('aria-hidden', 'true');
 const modelHost = node('div', 'gift-transformation-model'); modelHost.dataset.transformModel = ''; modelHost.setAttribute('aria-label', 'Your real 3D keepsake');
 scene.append(glow, ribbons, floor, volume, pieces, picture, modelHost);
 const pulseButton = node('button', 'gift-transformation-pulse'); pulseButton.type = 'button'; pulseButton.dataset.transformPulse = '';
 pulseButton.setAttribute('aria-label', 'Send a spark of light. A visual effect only.'); pulseButton.title = 'A little light. Creation continues on its own.';
 const pulseIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), pulsePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
 pulseIcon.setAttribute('viewBox', '0 0 24 24'); pulseIcon.setAttribute('aria-hidden', 'true'); pulseIcon.setAttribute('focusable', 'false'); pulsePath.setAttribute('d', 'm12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2Z'); pulseIcon.append(pulsePath);
 pulseButton.append(pulseIcon, document.createTextNode('Send a spark'));
 const caption = node('p', 'gift-transformation-caption'), title = node('span', 'gift-transformation-title'), detail = node('span', 'gift-transformation-detail');
 caption.setAttribute('role', 'status'); caption.setAttribute('aria-live', 'polite'); caption.setAttribute('aria-atomic', 'true'); title.textContent = phaseNames.awakening; detail.textContent = 'A visual transformation of your photo.'; caption.append(title, detail);
 const open = node('button', 'gift-transformation-open'); open.type = 'button'; open.hidden = true; open.dataset.transformOpen = ''; open.textContent = 'Reveal 3D keepsake';
 root.append(scene, caption, pulseButton, open); host.replaceChildren(root);

 let dead = false, current: GiftTransformationState | undefined, visibleModel = false, displayUrl: string | undefined, displayedReference = false;
 let pulseTimer: ReturnType<typeof setTimeout> | undefined, pulseCount = 0, inView = true;
 const syncModelVisibility = () => {
  // A concealed viewer must keep its layout box so its first real render can
  // happen before onReady asks us to reveal it. Inert keeps it inaccessible.
  modelHost.hidden = false; modelHost.inert = !visibleModel; modelHost.setAttribute('aria-hidden', String(!visibleModel)); root.dataset.modelVisible = String(visibleModel);
  open.hidden = !current?.modelReady || !options.onOpenKeepsake || visibleModel;
 };
 syncModelVisibility();
 const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
 const active = () => !dead && host.isConnected && options.isCurrent();
 const clearPulse = () => { if (pulseTimer !== undefined) { clearTimeout(pulseTimer); pulseTimer = undefined; } delete root.dataset.pulse; };
 const syncVisibility = () => {
  if (dead) return;
  const paused = document.visibilityState === 'hidden' || !inView || !active();
  root.dataset.paused = String(paused); root.dataset.reduced = String(motion?.matches ?? false);
  if (paused || motion?.matches) clearPulse();
 };
 const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.target === root) { inView = entry.isIntersecting && entry.intersectionRatio > 0; syncVisibility(); }
 }) : undefined;
 observer?.observe(root); document.addEventListener('visibilitychange', syncVisibility); motion?.addEventListener('change', syncVisibility); syncVisibility();

 function copy() {
  if (!current) return;
  title.textContent = current.phase === 'interrupted' && current.modelReady ? phaseNames.ready : current.phase === 'ready' && !current.modelReady ? 'Checking your keepsake.' : phaseNames[current.phase];
  if (visibleModel) detail.textContent = current.phase === 'world' ? 'Your real 3D keepsake. Your world is still being created.' : 'Your real 3D keepsake. Drag to explore.';
  else if (current.phase === 'interrupted') detail.textContent = current.modelReady ? 'Your completed 3D keepsake is available to open.' : 'This moment needs a little care. See the generation details below.';
  else if (current.modelReady) detail.textContent = `${displayedReference ? 'Reference image' : 'Original photo'} shown. ${current.phase === 'world' ? 'Your 3D keepsake is ready; the world is still being created.' : 'Open your real 3D keepsake.'}`;
  else if (displayedReference) detail.textContent = 'Souvenir reference shown while your 3D keepsake is created.';
  else if (current.phase === 'shaping') detail.textContent = 'An abstract light sculpture while your 3D keepsake is created.';
  else if (current.phase === 'world') detail.textContent = 'Your place is being created. This is a visual preview.';
  else if (current.phase === 'ready') detail.textContent = 'A 3D keepsake appears only after it is ready.';
  else detail.textContent = 'Light gathers around your original photo.';
 }
 function source(image: HTMLImageElement, url: string | undefined) {
  if (url) { if (image.getAttribute('src') !== url) image.src = url; image.hidden = false; }
  else { image.removeAttribute('src'); image.hidden = true; }
 }
 function display(url: string | undefined, isReference: boolean) {
  displayUrl = url; displayedReference = isReference && !!url; root.dataset.reference = String(displayedReference);
  source(photo, url); placeholder.hidden = !!url;
 }
 const photoLoad = () => { if (active() && displayUrl && (photo.currentSrc || photo.src) === displayUrl) placeholder.hidden = true; };
 const photoError = () => {
  if (!active() || !displayUrl || (photo.currentSrc || photo.src) !== displayUrl) return;
  const original = transformationPhotoUrl(current?.photoUrl);
  if (displayedReference && original && original !== displayUrl) { display(original, false); copy(); }
  else { photo.hidden = true; placeholder.hidden = false; }
 };
 photo.addEventListener('load', photoLoad); photo.addEventListener('error', photoError);
 const fragmentErrors = shardImages.map(shard => { const error = () => { if (active()) shard.hidden = true; }; shard.addEventListener('error', error); return error; });
 function setModelVisible(value: boolean) {
  if (!active()) return;
  visibleModel = !!value && !!current?.modelReady; syncModelVisibility(); copy();
 }
 function pulse() {
  if (!active() || current?.phase === 'interrupted' || document.visibilityState === 'hidden' || !inView) return;
  clearPulse(); root.dataset.pulse = String(++pulseCount % 2);
  pulseTimer = setTimeout(() => { pulseTimer = undefined; if (active()) delete root.dataset.pulse; }, 1000);
 }
 const openKeepsake = () => { if (active() && current?.modelReady) options.onOpenKeepsake?.(); };
 pulseButton.addEventListener('click', pulse); open.addEventListener('click', openKeepsake);
 return {
  modelHost, setModelVisible, pulse,
  update(state) {
   if (!active() || !Object.hasOwn(phaseNames, state.phase)) return;
   const changedJob = current?.jobId !== state.jobId || current?.modelUrl !== state.modelUrl;
   current = { ...state }; root.dataset.phase = state.phase; root.dataset.modelReady = String(!!state.modelReady);
   pulseButton.hidden = state.phase === 'interrupted'; pulseButton.disabled = state.phase === 'interrupted';
   if (state.phase === 'interrupted') clearPulse();
   if (changedJob || !state.modelReady) { clearPulse(); visibleModel = false; }
   const original = transformationPhotoUrl(state.photoUrl), reference = transformationPhotoUrl(state.referenceUrl);
   display(state.phase !== 'awakening' && reference ? reference : original, state.phase !== 'awakening' && !!reference);
   for (const shard of shardImages) source(shard, original);
   syncModelVisibility();
   copy(); syncVisibility();
  },
  destroy() {
   if (dead) return; dead = true; clearPulse(); observer?.disconnect(); document.removeEventListener('visibilitychange', syncVisibility); motion?.removeEventListener('change', syncVisibility);
   pulseButton.removeEventListener('click', pulse); open.removeEventListener('click', openKeepsake); photo.removeEventListener('load', photoLoad); photo.removeEventListener('error', photoError);
   for (const [index, shard] of shardImages.entries()) { shard.removeEventListener('error', fragmentErrors[index]); shard.removeAttribute('src'); }
   photo.removeAttribute('src'); root.remove(); current = undefined;
  },
 };
}
