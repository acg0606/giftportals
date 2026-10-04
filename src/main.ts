import './style.css';
import './map.css';
import './trail.css';
import './nexus-shell.css';
import './studio.css';
import './memory-portal.css';
import './rio-souvenir.css';
import './rio-creator.css';
import './portal-dusk.css';
import './portal-dusk-gift.css';
import './instant-creator.css';
import './generated-gift.css';
import './instant-shell.css';
import './theme-v10.css';
import type { CreateMemoryInput, GiftDTO, GiftViewDTO, JobDTO, MemoryDTO, SessionDTO, StatusDTO, UploadDTO, WorldDTO } from '../shared/contracts';
import { api, ApiError, putFile, session, sessionGeneration, setSession } from './api-client';
import { miniArt, portalArt } from './art';
import { demoWorld, fictionalMemories, orderDemoMemories } from './demo';
import { projectWorldToGlobe, type GlobePlace } from './globe-data';
import { mountDiscoveryMap } from './map';
import { getPilotPlace, MAP_PLACES, pilotPlaces } from './map-data';
import { validateOriginalFiles } from './original-upload-rules';
import { cancelTrain, takeMemoryTrain } from './train';
import { demoFixtureKey, journeyCatalog, newJourney, nextJourneyMemory, reconcileJourney, type JourneyScope, type JourneyState } from './journey-state';
import { mountMemoryTrail } from './trail';
import { mountRioSouvenir } from './rio-souvenir';
import { mountRioCreator } from './rio-creator';
import { decodeRioCreatorDraft, newRioCreatorDraft, type RioCreatorDraft } from './rio-creator-state';
import { mountInstantCreator, type InstantJob } from './instant-creator';
import { instantGiftReady, instantWorldReady, readInstantJobReference } from './instant-creator-state';
import { mountGeneratedGift, type GeneratedGiftData } from './generated-gift';
import { giftIcon } from './gift-icon';
import { createGiftWalkScenes, readGiftWorldSemantics } from './gift-walk-catalog';
import { collectionIcon } from './collection-icon';
import { createdSessionKeepsake } from './local-keepsakes';
import { clearKeepsakeScope, forgetKeepsakeReference, instantJobStorageKey, readKeepsakeJob, rememberCreatedKeepsake, storedKeepsakeReferences, type KeepsakeStorage } from './keepsake-library';
import type { CollectionRoomItem } from './collection-types';

const app = document.querySelector<HTMLDivElement>('#app')!;
let world: WorldDTO | null = null;
let publicMemories: MemoryDTO[] = fictionalMemories;
let cloudStatus: StatusDTO | null = null;
let staticDemo = false;
let activePersona: 'sender' | 'recipient' = 'sender';
let cleanup: (() => void) | null = null;
let renderId = 0;
let arrivals: string[] = [];
let currentGift: GiftViewDTO | null = null;
const sessionKeepsakes = new Map<string, CollectionRoomItem>();
const keepsakeReadAt = new Map<string, number>();
const keepsakeScope = () => session() && !session()!.user.demo ? `owner:${session()!.user.id}` : 'anonymous';
let activeKeepsakeScope = keepsakeScope();
const keepsakeStorage = (): KeepsakeStorage | undefined => { try { return localStorage; } catch { try { return sessionStorage; } catch { return undefined; } } };
let closeActiveDialog: (() => void) | null = null;
let trailState: JourneyState | null = null;
let trailScopeKey = '';
let trailScopeEpoch = 0;
const draftInvitations = new Map<string, { recipient: string; message: string }>();
let rioCreatorDraft = newRioCreatorDraft();
let privateRioSeed: RioCreatorDraft | null = null;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const icon = (name: string) => ({ arrow: '↗', globe: '◎', gift: giftIcon, train: '↔', gallery: '▦', plus: '+', close: '×', check: '✓' }[name] || '·');
const date = (value: string) => { const parsed = new Date(`${value?.slice(0, 10)}T12:00:00Z`); return Number.isNaN(parsed.getTime()) ? 'Date not shared' : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed); };
const photo = (memory: MemoryDTO) => memory.media.find((item) => item.kind === 'gift-photo' || item.kind === 'place-photo');
const route = () => {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash.startsWith('gift=')) return `gift/${new URLSearchParams(hash).get('gift') || ''}`;
  return (hash || location.pathname.replace(/^\//, '') || 'home').split('?')[0];
};
const routeParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
const demoScope = () => routeParams().get('demo');
const scopedPath = (path: string) => { const [base, query = ''] = path.split('?'); const params = new URLSearchParams(query); if (demoScope() && !params.has('demo')) params.set('demo', demoScope()!); const suffix = params.toString(); return `${base}${suffix ? `?${suffix}` : ''}`; };
function navigate(path: string) { const next = `#/${path}`; if (location.hash === next) void render(); else location.hash = next; }
function progressTrail(stage: 'open' | 'explore' | 'travel') {
  const current = ['open', 'explore', 'travel'].indexOf(stage);
  return `<ol class="recipient-progress" aria-label="Your gift journey">${['Open the gift', 'Explore the memory', 'Travel & discover'].map((label, index) => `<li class="${index === current ? 'current' : index < current ? 'complete' : ''}" ${index === current ? 'aria-current="step"' : ''}><span>${index < current ? '✓' : `0${index + 1}`}</span>${label}</li>`).join('')}</ol>`;
}
function toast(message: string) { const element = document.querySelector<HTMLElement>('#toast')!; element.textContent = message; element.classList.add('visible'); setTimeout(() => element.classList.remove('visible'), 5000); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
function rememberKeepsake(job: InstantJob) {
  if (demoScope() || session()?.user.demo) return;
  const reference = rememberCreatedKeepsake(keepsakeStorage(), keepsakeScope(), job);
  const item = createdSessionKeepsake(job);
  if (item && reference) sessionKeepsakes.set(item.id, { ...item, mediaExpiresAt: reference.expiresAt });
  if (item && reference) keepsakeReadAt.set(item.id, Date.now());
}
function resetKeepsakeSession() {
  const nextScope = keepsakeScope();
  if (activeKeepsakeScope.startsWith('owner:') && activeKeepsakeScope !== nextScope) clearKeepsakeScope(keepsakeStorage(), activeKeepsakeScope);
  activeKeepsakeScope = nextScope; sessionKeepsakes.clear(); keepsakeReadAt.clear();
  // Old unscoped recovery keys have no account provenance. They must never
  // become an anonymous collection after someone signs out or switches users.
  try { sessionStorage.removeItem('giftportals.instant.job.v1'); sessionStorage.removeItem('giftportals.instant.pending.v1'); }
  catch { /* Scoped v10.2 catalogs remain separate even without legacy cleanup. */ }
}
function currentKeepsakes(): CollectionRoomItem[] {
  if (demoScope() || session()?.user.demo) return [];
  const now = Date.now() / 1000;
  for (const [id, item] of sessionKeepsakes) if (item.mediaExpiresAt && item.mediaExpiresAt <= now) sessionKeepsakes.delete(id);
  return [...sessionKeepsakes.values()].reverse();
}
async function hydrateKeepsakes(epoch: number, signal: AbortSignal) {
  if (demoScope() || session()?.user.demo) return;
  const scope = keepsakeScope(), generation = sessionGeneration();
  const active = () => epoch === renderId && !signal.aborted && scope === keepsakeScope() && generation === sessionGeneration();
  const references = new Map(storedKeepsakeReferences(keepsakeStorage(), scope).map(value => [value.id, { id: value.id, token: value.token }]));
  // v10 kept only the last creator capability. Recover it without adopting any
  // unrelated recipient link or attributing an anonymous gift to another account.
  try {
    const raw = sessionStorage.getItem(instantJobStorageKey(scope)) || (scope === 'anonymous' ? sessionStorage.getItem('giftportals.instant.job.v1') : null);
    const latest = readInstantJobReference(raw);
    if (latest) references.set(latest.id, latest);
  } catch { /* A blocked browser store does not interrupt the memory desk. */ }
  const queue = [...references.values()].filter(reference => !sessionKeepsakes.has(`session:${reference.id}`) || Date.now() - (keepsakeReadAt.get(`session:${reference.id}`) || 0) > 60_000);
  const hydration = new AbortController();
  const cancel = () => hydration.abort(); signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) hydration.abort();
  const deadline = setTimeout(cancel, 8_000);
  try {
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length && active() && !hydration.signal.aborted) {
      const reference = queue.shift()!;
      try {
        const job = await readKeepsakeJob(reference, hydration.signal, location.hostname);
        if (active() && !hydration.signal.aborted && instantGiftReady(job)) rememberKeepsake(job);
      } catch (error) {
        if (!active()) return;
        const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
        if (['JOB_UNAVAILABLE', 'JOB_EXPIRED', 'GIFT_REFERENCE_MISMATCH'].includes(String(code))) {
          forgetKeepsakeReference(keepsakeStorage(), scope, reference.id); sessionKeepsakes.delete(`session:${reference.id}`);
        }
        // Network interruptions retain the known capability for a later retry.
      }
    }
  }));
  } finally { clearTimeout(deadline); signal.removeEventListener('abort', cancel); }
}
function keepsakeCard(item: CollectionRoomItem, index = 0) {
  const preview = !item.mediaExpiresAt || item.mediaExpiresAt > Date.now() / 1000 ? item.imageUrl : undefined;
  return `<a class="memory-card card-${index % 3}" href="#/${esc(item.openPath)}"><div class="memory-card-art">${preview ? `<img src="${esc(preview)}" alt="Keepsake for ${esc(item.title)}" loading="lazy" referrerpolicy="no-referrer"/>` : miniArt('cup')}<span class="model-pill">3D KEEPSAKE</span></div><div class="memory-card-copy"><span class="eyebrow">${esc(item.subtitle)}</span><h3>${esc(item.title)}</h3><span class="text-link">Open gift <span>${icon('arrow')}</span></span></div></a>`;
}
function notice() {
  if (session()?.user.demo) return '<div class="service-note">Read-only fictional demo. Sign in to your own account to create or receive private gifts.</div>';
  return staticDemo || cloudStatus?.configured === false ? '<div class="service-note"><span class="demo-status-dot"></span>Explore the public demo · real 3D assets, fictional people. Private gifting is not available in this preview.</div>' : '';
}
function header(active = '') {
  const href = (path: string) => `#/${scopedPath(path)}`;
  return `<header class="site-header"><a class="brand" href="#/home" aria-label="GiftPortals home"><img class="brand-image" src="/assets/portal-dusk/brand-mark.png" alt=""/><span>GiftPortals</span></a><nav aria-label="Main navigation"><a class="${active === 'gallery' ? 'active' : ''}" href="${href('collection')}">Explore</a><a class="${active === 'world' ? 'active' : ''}" href="${href('world')}">My world</a><a class="${active === 'atlas' ? 'active' : ''}" href="${href('atlas')}">Atlas</a></nav><div class="header-actions">${session() ? `<button class="avatar-button" data-account title="Account and sign out">${esc(session()!.user.displayName.slice(0, 1))}</button>` : `<button class="quiet-button login-trigger" data-auth>Sign in</button>`}<button class="button button-small" data-create>${giftIcon}Make a gift</button></div></header>`;
}
function footer() { return '<footer class="site-footer"><a class="brand footer-brand" href="#/home">GiftPortals</a><span>People. Places. Stories. Always with you.</span><span>Version 10.2.1 · Tripothon S1</span><a href="#/about">About & credits</a></footer>'; }
function bindCommon() {
  app.querySelectorAll<HTMLButtonElement>('[data-auth]').forEach((button) => button.onclick = () => showAuth());
  app.querySelectorAll<HTMLButtonElement>('[data-create]').forEach((button) => button.onclick = () => navigate('make'));
  app.querySelectorAll<HTMLButtonElement>('[data-demo]').forEach((button) => button.onclick = () => { world = demoWorld(publicMemories, activePersona); navigate(`demo-gift/${publicMemories[0].id}`); });
  app.querySelector<HTMLButtonElement>('[data-account]')?.addEventListener('click', () => showAccount());
  app.querySelectorAll<HTMLElement>('[data-memory]').forEach((button) => button.onclick = () => navigate(scopedPath(`memory/${encodeURIComponent(button.dataset.memory!)}`)));
  app.querySelectorAll<HTMLButtonElement>('[data-persona]').forEach((button) => button.onclick = () => switchWorld(button.dataset.persona as 'sender' | 'recipient'));
}
function memoryCard(memory: MemoryDTO, index = 0) {
  const sharedPlace = memory.shareLocation === true || memory.ownerId === world?.user.id;
  const hasModel = memory.media.some(media => media.kind === 'model');
  return `<button class="memory-card card-${index % 3}" data-memory="${esc(memory.id)}"><div class="memory-card-art">${photo(memory) ? `<img src="${esc(photo(memory)!.url)}" alt="Original media for ${esc(memory.title)}" loading="lazy" />` : miniArt(index % 3 === 0 ? 'cup' : index % 3 === 1 ? 'shell' : 'bird')}<span class="card-postmark">${sharedPlace ? esc(memory.location.label.split(' · ')[0]) : 'Location not shared'}</span><span class="model-pill">${hasModel ? '3D OBJECT' : 'ILLUSTRATED STORY'}</span></div><div class="memory-card-copy"><span class="eyebrow">${esc(memory.ownerName)} ${sharedPlace ? ' / ' + esc(date(memory.location.experiencedAt)) : ''}</span><h3>${esc(memory.title)}</h3><span class="text-link">Explore memory <span>${icon('arrow')}</span></span></div></button>`;
}
function home() {
  app.innerHTML = `<main class="v10-welcome" aria-labelledby="welcome-title"><img class="v10-welcome-art" src="/assets/v10/hero.jpg" alt="A travel suitcase holding a miniature coastal world, overlooking a quiet bay" fetchpriority="high"/><header class="v10-home-header"><a class="v10-brand" href="#/home" aria-label="GiftPortals home"><img src="/assets/portal-dusk/brand-mark.png" alt=""/><span>GiftPortals</span></a><nav aria-label="Main navigation"><a href="#/collection">Explore</a><button type="button" data-create>Create</button>${session() ? '<button type="button" data-account>Account</button>' : '<button type="button" data-auth>Sign in</button>'}</nav></header><div class="v10-welcome-content"><h1 id="welcome-title">Turn your<br/>travels into<br/>living memories.</h1><p>A small gift. A place they can open.</p><button class="v10-primary" type="button" data-create>${giftIcon}<span>Make a gift</span><span aria-hidden="true">→</span></button><a class="v10-explore" href="#/collection">${collectionIcon}<span>Explore keepsakes</span></a></div><p class="v10-home-motto">People&nbsp; Places&nbsp; Stories&nbsp; Always with you</p><a class="v10-home-about" href="#/about">About GiftPortals</a></main>`;
  app.querySelector<HTMLImageElement>('.v10-welcome-art')?.addEventListener('error', event => {
    (event.currentTarget as HTMLImageElement).src = '/assets/portal-dusk/welcome-bg.webp';
  }, { once: true });
  bindCommon();
}
function rioGiftPage(epoch: number) {
  const token = routeParams().get('draft');
  const content = token ? decodeRioCreatorDraft(token) : undefined;
  if (token && !content) { missing('This Rio preview link is incomplete or unreadable. Create a new gift preview.'); return; }
  app.innerHTML = `<main id="rio-gift-root"></main>`;
  bindCommon();
  const gift = mountRioSouvenir(app.querySelector<HTMLElement>('#rio-gift-root')!, {
    isCurrent: () => epoch === renderId,
    onHome: () => navigate('home'),
    ...(content ? { content, onKeep: () => {
      rioCreatorDraft = { ...content };
      navigate('compose?step=preview');
    } } : {}),
  });
  cleanup = () => gift.destroy();
}
function rioCreatorPage(epoch: number) {
  app.innerHTML = `<main id="rio-creator-root"></main>`;
  bindCommon();
  const creator = mountRioCreator(app.querySelector<HTMLElement>('#rio-creator-root')!, {
    isCurrent: () => epoch === renderId, onHome: () => navigate('home'),
    initialDraft: rioCreatorDraft, initialStep: routeParams().get('step') === 'preview' ? 2 : 0,
    onChange: draft => { rioCreatorDraft = draft; },
    ...(cloudStatus?.configured === true ? { onPrivateStudio: (draft: RioCreatorDraft) => {
      rioCreatorDraft = { ...draft }; privateRioSeed = { ...draft };
      if (session() && !session()!.user.demo) navigate('create?from=rio');
      else showAuth('create?from=rio');
    } } : {}),
  });
  cleanup = () => creator.destroy();
}
function instantCreatorPage(epoch: number) {
  const generation = sessionGeneration();
  app.innerHTML = '<main id="instant-creator-root"></main>';
  const creator = mountInstantCreator(app.querySelector<HTMLElement>('#instant-creator-root')!, {
    isCurrent: () => epoch === renderId,
    storageScope: keepsakeScope(),
    onHome: () => navigate('home'),
    onGiftCompleted: job => { if (epoch === renderId && generation === sessionGeneration()) rememberKeepsake(job); },
    onGiftReady: (job: InstantJob) => {
      if (epoch !== renderId || generation !== sessionGeneration() || !instantGiftReady(job)) return;
      rememberKeepsake(job);
      navigate(`generated/${encodeURIComponent(job.id)}?key=${encodeURIComponent(job.token)}`);
    },
    onExploreExample: () => navigate('generated/rio-example'),
  });
  cleanup = () => creator.destroy();
}
async function transformationPreviewPage(epoch: number) {
  app.innerHTML = '<main class="generated-loading" role="status">Opening a little transformation…</main>';
  const { mountGiftTransformationPreview } = await import('./gift-transformation-preview');
  if (epoch !== renderId) return;
  const preview = mountGiftTransformationPreview(app, { isCurrent: () => epoch === renderId, onCreate: () => navigate('make') });
  cleanup = () => preview.destroy();
}

async function qualityComparisonPage(epoch: number) {
  const { mountQualityComparison } = await import('./quality-comparison');
  if (epoch !== renderId) return;
  const comparison = mountQualityComparison(app, { initialKind: routeParams().get('kind') === 'world' ? 'world' : 'miniature', isCurrent: () => epoch === renderId, onExit: () => navigate('collection') });
  cleanup = () => comparison.destroy();
}

async function parisFlightPage(epoch: number) {
  const { mountParisFlight } = await import('./paris-flight');
  if (epoch !== renderId) return;
  const fromGift = routeParams().get('from') === 'gift';
  const flight = mountParisFlight(app, { isCurrent: () => epoch === renderId, onExit: () => navigate(fromGift ? 'generated/paris-example?from=room' : 'quality-comparison?kind=world') });
  cleanup = () => flight.destroy();
}

async function parisJourneyReady(signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch('/demo/v23/paris-flight.json', { signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!response.ok || /text\/html/i.test(response.headers.get('content-type') || '')) return false;
    const { readParisFlightManifest } = await import('./paris-flight-state');
    const journey = readParisFlightManifest(await response.json());
    if (!journey || journey.chapters.length !== 3 || journey.chapters.some(chapter => chapter.status !== 'complete' || !chapter.worldUrl)) return false;
    const assets = await Promise.allSettled(journey.chapters.map(chapter => fetch(chapter.worldUrl!, { method: 'HEAD', signal, credentials: 'omit', redirect: 'error' })));
    return !signal.aborted && assets.every(result => result.status === 'fulfilled' && result.value.ok && !/text\/html/i.test(result.value.headers.get('content-type') || ''));
  } catch { return false; }
}

async function parisWalkPage(epoch: number) {
  const { mountFirstPersonPlace } = await import('./first-person-place');
  if (epoch !== renderId) return;
  const exitPath = routeParams().get('from') === 'comparison' ? 'quality-comparison?kind=world' : 'generated/paris-example?from=room';
  const walk = mountFirstPersonPlace(app, { isCurrent: () => epoch === renderId, onExit: () => navigate(exitPath) });
  cleanup = () => walk.destroy();
}

async function qualityReferenceCapturePage(epoch: number) {
  const { mountQualityReferenceCapture } = await import('./quality-reference-capture');
  if (epoch !== renderId) return;
  const capture = mountQualityReferenceCapture(app, { isCurrent: () => epoch === renderId, onExit: () => navigate('quality-comparison') });
  cleanup = () => capture.destroy();
}
async function readGeneratedGift(id: string, signal: AbortSignal): Promise<GeneratedGiftData> {
  const examples: Record<string, string> = { 'rio-example': '/demo/rio-generated-gift.json', 'paris-example': '/demo/v17/paris-generated-gift.json', 'antikythera-example': '/demo/v13/antikythera-generated-gift.json' };
  if (Object.hasOwn(examples, id)) {
    const response = await fetch(examples[id], { signal });
    if (!response.ok) throw new Error('This example could not open. Return to your collection and try again.');
    return await response.json() as GeneratedGiftData;
  }
  const job = await readKeepsakeJob({ id, token: routeParams().get('key') || '' }, signal, location.hostname);
  if (!instantGiftReady(job)) throw new Error('Your gift is still taking shape. Reopen the creator to check its progress.');
  const worldReady = instantWorldReady(job);
  return {
    title: job.title, senderName: job.senderName, recipientName: job.recipientName,
    dedication: job.dedication, story: job.story || job.worldPrompt, curiosities: job.curiosities,
    originalUrl: job.assets.photoUrl, modelUrl: job.assets.modelUrl, mediaExpiresAt: job.mediaExpiresAt,
    ...(worldReady ? { worldUrl: job.assets.worldUrl, panoramaUrl: job.assets.panoramaUrl, collisionUrl: job.assets.colliderUrl,
      worldSemantics: readGiftWorldSemantics(job.generation?.worldlabs?.worldSemantics) } : {}),
    photoIntent: job.photoIntent, objectRepresentation: job.objectRepresentation, modelYaw: job.modelYaw,
    keepsakeImageUrl: job.assets.tripoInputUrl,
  };
}
function generatedGiftPath(id: string) {
  const params = new URLSearchParams(); const key = routeParams().get('key'); if (key) params.set('key', key);
  params.set('from', 'room'); return 'generated/' + encodeURIComponent(id) + '?' + params.toString();
}
async function mountGiftWalk(id: string, gift: GeneratedGiftData, epoch: number, abort: AbortController) {
  const scenes = createGiftWalkScenes(id, gift);
  if (!scenes.length) throw new Error('This world does not have a walking path yet. Its keepsake and story remain available.');
  const { mountFirstPersonPlace } = await import('./first-person-place');
  if (epoch !== renderId || abort.signal.aborted) return;
  const returnPath = generatedGiftPath(id);
  const walk = mountFirstPersonPlace(app, { scenes, giftTitle: gift.title, giftHref: '#/' + returnPath,
    isCurrent: () => epoch === renderId, onExit: () => navigate(returnPath) });
  cleanup = () => { abort.abort(); walk.destroy(); };
}
async function generatedWalkPage(id: string, epoch: number) {
  const abort = new AbortController(); cleanup = () => abort.abort();
  app.innerHTML = '<main class="generated-loading" role="status">Opening the place around your gift…</main>';
  try { const gift = await readGeneratedGift(id, abort.signal); if (epoch !== renderId || abort.signal.aborted) return; await mountGiftWalk(id, gift, epoch, abort); }
  catch (error) { if (epoch === renderId && !abort.signal.aborted) { app.innerHTML = '<main class="generated-loading"><h1>Your gift is still here.</h1><p>' + esc(errorMessage(error)) + '</p><a class="dusk-start" href="#/' + esc(generatedGiftPath(id)) + '">Return to the keepsake</a></main>'; } }
}
async function generatedGiftPage(id: string, epoch: number) {
  const abort = new AbortController(); cleanup = () => abort.abort();
  app.innerHTML = '<main class="generated-loading" role="status">Opening your keepsake…</main>';
  try {
    const gift = await readGeneratedGift(id, abort.signal);
    if (epoch !== renderId || abort.signal.aborted) return;
    const walking = createGiftWalkScenes(id, gift).length > 0;
    if (walking && routeParams().get('view') === 'world') { await mountGiftWalk(id, gift, epoch, abort); return; }
    app.innerHTML = '<main id="generated-gift-root"></main>';
    const journeyPath = generatedGiftPath(id).replace(/^generated\//, 'walk/');
    const viewer = mountGeneratedGift(app.querySelector<HTMLElement>('#generated-gift-root')!, {
      gift, shareScope: ['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname) ? 'local' : 'cloud', initialView: routeParams().get('view') === 'world' && gift.worldUrl ? 'world' : 'object',
      isCurrent: () => epoch === renderId, onExit: () => navigate('collection'),
      onCollection: () => navigate('collection'),
      ...(walking ? { onJourney: () => navigate(journeyPath), journeyLabel: 'Walk inside' } : {}),
      onShare: async () => {
        try { await navigator.clipboard.writeText(location.href); toast(['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname) ? 'Local gift link copied. Opens on this device while the preview is running.' : 'Gift link copied. Anyone with this link can open the gift until it expires.'); }
        catch { toast('Copy this page address to reopen the gift.'); }
      },
    });
    cleanup = () => { abort.abort(); viewer.destroy(); };
  } catch (error) {
    if (epoch === renderId && !abort.signal.aborted) {
      app.innerHTML = '<main class="generated-loading"><h1>This little world is still waiting.</h1><p>' + esc(errorMessage(error)) + '</p><a class="dusk-start" href="#/collection">Explore keepsakes</a><a class="dusk-explore" href="#/home">Back home</a></main>';
    }
  }
}
async function loadWorld(): Promise<WorldDTO> {
  const scope = sessionGeneration(); const actor = session()?.user.id;
  if (!actor) throw new ApiError('SESSION_EXPIRED', 'Sign in to reopen your private world.');
  const next = await api<WorldDTO>('world');
  if (sessionGeneration() !== scope || session()?.user.id !== actor || next.user.id !== actor) throw new ApiError('SESSION_CHANGED', 'Your account changed while this request was running.');
  world = next; return next;
}
async function ensureWorld(): Promise<WorldDTO> {
  if (demoScope() === 'sender' || demoScope() === 'recipient') return (world = demoWorld(publicMemories, demoScope()!));
  if (session()) { const next = await loadWorld(); staticDemo = false; return next; }
  return (world = demoWorld(publicMemories, activePersona));
}
function syncTrail(current: WorldDTO) {
  const persona = demoScope() === 'sender' || demoScope() === 'recipient' ? demoScope() as 'sender' | 'recipient' : activePersona;
  const key = current.user.demo ? `demo:${persona}:${sessionGeneration()}` : `owner:${current.user.id}:${sessionGeneration()}`;
  if (key !== trailScopeKey) { trailScopeKey = key; trailScopeEpoch++; trailState = null; }
  const scope: JourneyScope = current.user.demo ? { kind: 'public-demo', persona, epoch: trailScopeEpoch } : { kind: 'owner', actorId: current.user.id, epoch: trailScopeEpoch };
  const catalog = journeyCatalog(current, scope);
  trailState = reconcileJourney(trailState || newJourney(scope), catalog, scope);
  return { scope, catalog, state: trailState };
}
function trailJournal(current: WorldDTO) {
  const { catalog, state } = syncTrail(current);
  const kept = catalog.filter(item => state.progress[item.memory.id]?.kept);
  if (!kept.length) return '';
  const next = nextJourneyMemory(catalog, state, kept[kept.length - 1].memory.id);
  return `<section class="trail-journal-strip" aria-label="Explored memories in this session"><div><span class="eyebrow">YOUR MEMORY TRAIL</span><h2>${kept.length === 1 ? 'One little world, kept.' : `${kept.length} little worlds, kept.`}</h2><p>Digital keepsakes from this session. Your physical visit history stays separate.</p>${next ? `<a class="trail-journal-next" href="#/${scopedPath('trail?memory=' + encodeURIComponent(next.memory.id))}">Next discovery: ${esc(next.memory.title)} ↗</a>` : `<a class="trail-journal-next" href="#/${scopedPath('trail')}">Revisit your memory trail ↗</a>`}</div><div>${kept.map(item => `<a href="#/${scopedPath('trail?memory=' + encodeURIComponent(item.memory.id))}">${photo(item.memory) ? `<img src="${esc(photo(item.memory)!.url)}" alt="" />` : ''}<span>${esc(item.memory.title)}<small>Three fragments revealed · session keepsake ↗</small></span></a>`).join('')}</div></section>`;
}
async function trailPage(epoch: number) {
  let current: WorldDTO;
  try { current = await ensureWorld(); } catch (error) { if (epoch === renderId) missing(errorMessage(error)); return; }
  if (epoch !== renderId) return;
  const { scope, state } = syncTrail(current);
  const params = routeParams();
  const openPortalOnMount = params.get('portal') === '1';
  if (openPortalOnMount) {
    params.delete('portal');
    history.replaceState(null, '', '#/trail' + (params.toString() ? '?' + params.toString() : ''));
  }
  const authEpoch = sessionGeneration();
  app.innerHTML = `${header('trail')}${notice()}<main id="memory-trail"></main>${footer()}`;
  bindCommon();
  const active = () => epoch === renderId && sessionGeneration() === authEpoch && trailState?.scope.epoch === scope.epoch;
  const trail = mountMemoryTrail(app.querySelector<HTMLElement>('#memory-trail')!, {
    world: current, scope, state, initialMemoryId: params.get('memory') || undefined,
    openPortalOnMount, isCurrent: active,
    onStateChange: next => { if (active()) trailState = next; },
    onOpenMemory: id => { if (active()) navigate(scopedPath('memory/' + encodeURIComponent(id))); },
    onAtlas: placeId => { if (active()) navigate(scopedPath('atlas?view=story' + (placeId ? '&focus=' + encodeURIComponent(placeId) : ''))); },
    onRefresh: async (id?: string) => { if (!active()) return; if (id) history.replaceState(null, '', '#/' + scopedPath('trail?memory=' + encodeURIComponent(id))); await render(); },
    onTravel: async memory => {
      if (!active()) return;
      // The train displays current readable memories only; it does not record a visit.
      const latest = await ensureWorld(); if (!active()) return;
      const context = syncTrail(latest);
      const allowed = context.catalog.find(item => item.memory.id === memory.id);
      if (!allowed || !context.state.progress[memory.id]?.kept) { await render(); return; }
      const trainMemory = allowed.memory.ownerId !== latest.user.id && allowed.memory.shareLocation !== true
        ? { ...allowed.memory, location: { ...allowed.memory.location, label: 'Location not shared' } } : allowed.memory;
      const seen = await takeMemoryTrain(`${latest.user.displayName}’s memory atlas`, [trainMemory]);
      if (!active()) return;
      arrivals = seen;
      navigate(scopedPath('atlas?view=story' + (allowed.publicPlaceId ? '&focus=' + encodeURIComponent(allowed.publicPlaceId) : '')));
    },
  });
  cleanup = () => trail.destroy();
}
async function worldPage(epoch: number) {
  const abort = new AbortController(); cleanup = () => abort.abort();
  let current: WorldDTO;
  try { [current] = await Promise.all([ensureWorld(), hydrateKeepsakes(epoch, abort.signal)]); } catch (error) { if (epoch !== renderId) return; app.innerHTML = `${header('world')}<main class="narrow"><span class="eyebrow">YOUR WORLD</span><h1>Let’s reconnect.</h1><p>${esc(errorMessage(error))}</p><button class="button" data-world-retry>Try again</button></main>${footer()}`; bindCommon(); app.querySelector<HTMLButtonElement>('[data-world-retry]')!.onclick = () => void render(); return; }
  if (epoch !== renderId) return;
  const isDemo = current.user.demo || !session();
  const traveled = current.discoveries.filter((item) => item.kind === 'physical').length;
  const remembered = current.discoveries.filter((item) => item.kind === 'memory').length;
  const owned = current.memories.filter((item) => item.ownerId === current.user.id);
  app.innerHTML = `${header('world')}${notice()}<main class="world-page studio-world"><div class="world-heading"><div><span class="eyebrow">${isDemo ? 'FICTIONAL DEMO / ' : 'PERSONAL COLLECTION / '}${esc(current.user.displayName.toUpperCase())}</span><h1>Your world, in one place.</h1><p>The things you keep. The stories you receive. The places still ahead.</p></div><div class="world-personas">${isDemo ? `<span>View as</span><button class="persona ${current.user.displayName === 'Maya' ? 'selected' : ''}" data-persona="sender"><i>M</i> Maya</button><button class="persona ${current.user.displayName === 'Noah' ? 'selected' : ''}" data-persona="recipient"><i>N</i> Noah</button>` : '<button class="button" data-create>Create a memory</button>'}</div></div><section class="studio-world-dashboard" aria-label="World overview"><a href="#/${scopedPath('gallery')}"><span>YOUR ORIGINAL STORIES</span><strong>${owned.length}</strong><small>Objects and memories you created</small></a><a href="#/${scopedPath('gallery')}"><span>RECEIVED MEMORIES</span><strong>${current.memories.filter(memory=>memory.ownerId!==current.user.id).length}</strong><small>Stories currently shared with you</small></a><a href="#/${scopedPath('atlas')}"><span>PHYSICAL VISITS</span><strong>${traveled}</strong><small>${isDemo ? 'Fictional demo history' : 'Places recorded by you'}</small></a><a href="#/${scopedPath('atlas')}"><span>MEMORY CONNECTIONS</span><strong>${remembered}</strong><small>A shared memory is separate from a visit</small></a></section>${arrivals.length ? `<section class="arrival-strip"><span class="eyebrow">RECENT TRAIN FRAGMENTS</span>${arrivals.map(id=>current.memories.find(memory=>memory.id===id)).filter((memory):memory is MemoryDTO=>!!memory).map(memory=>`<button data-memory="${esc(memory.id)}">${esc(memory.title)} ↗</button>`).join('')}<button data-train-replay>Replay journey</button></section>` : ''}<section class="world-collection"><div class="section-title"><div><span class="eyebrow">YOUR MEMORY LIBRARY</span><h2>Objects with a story.</h2></div><a class="text-link" href="#/${scopedPath('gallery')}">View all memories ↗</a></div><div class="memory-grid">${current.memories.slice(0,3).map(memoryCard).join('') || '<div class="empty-state"><h2>Your first memory starts here.</h2><p>Add an original gift and a story to begin.</p><button class="button" data-create>Create a memory</button></div>'}</div></section><section class="mini-atlas"><div class="section-title"><div><span class="eyebrow">EXPLORE YOUR CONNECTIONS</span><h2>Memory atlas</h2></div><a class="text-link" href="#/${scopedPath('atlas')}">Open atlas ↗</a></div><div id="discovery-map"></div></section></main>${footer()}`;
  bindCommon(); mountMap(current); app.querySelector('.world-collection')?.insertAdjacentHTML('beforebegin', trailJournal(current));
  const localItems = currentKeepsakes();
  if (localItems.length) app.querySelector('.studio-world-dashboard')?.insertAdjacentHTML('beforebegin', `<section class="world-collection"><div class="section-title"><div><span class="eyebrow">CREATED BY YOU</span><h2>Your gifts.</h2></div><a class="text-link" href="#/gallery?view=list">View your memories ↗</a></div><div class="memory-grid">${localItems.slice(0, 3).map(keepsakeCard).join('')}</div></section>`);
  app.querySelector<HTMLButtonElement>('[data-train-replay]')?.addEventListener('click', async () => { const authEpoch = sessionGeneration(); const seen = await takeMemoryTrain(`${current.user.displayName}’s world`, current.memories); if (epoch === renderId && authEpoch === sessionGeneration()) arrivals = seen; });
}
function mountMap(current: WorldDTO) {
  const host = app.querySelector<HTMLElement>('#discovery-map'); if (!host) return;
  const map = mountDiscoveryMap(host, mapOptions(current));
  function mapOptions(latest: WorldDTO) {
    return { ownerId: latest.user.id, ownerName: latest.user.displayName, memories: latest.memories, discoveries: latest.discoveries, demo: latest.user.demo || !session(), canEdit: !!session() && !session()!.user.demo && !latest.user.demo, initialPlaceId: routeParams().get('focus') || undefined, onOpenMemory: (id: string) => navigate(scopedPath(`memory/${encodeURIComponent(id)}`)), onWishlist: (placeId: string, active: boolean) => change(placeId, 'wish', active), onVisitChange: (placeId: string, active: boolean) => change(placeId, 'physical', active) };
  }
  async function change(placeId: string, kind: 'wish' | 'physical', active: boolean) {
    try { const next = await updateDiscovery(world || current, placeId, kind, active); map.update(mapOptions(next)); } catch (error) { toast(errorMessage(error)); throw error; }
  }
  const oldCleanup = cleanup; cleanup = () => { oldCleanup?.(); map.destroy(); };
}
async function updateDiscovery(current: WorldDTO, placeId: string, kind: 'wish' | 'physical', active: boolean): Promise<WorldDTO> {
  if (!session()) throw new Error('Sign in to save your own history. The demonstration uses fictional travelers.');
  const existing = current.discoveries.find((item) => item.placeId === placeId && item.kind === kind);
  if (!active && existing) await api('discovery', undefined, { id: existing.id }, 'DELETE');
  else if (active && !existing) await api('discovery', { placeId, kind });
  const next = await loadWorld();
  toast(kind === 'physical' ? 'Your visit record was updated.' : 'Your wish list was updated.'); return next;
}
async function switchWorld(persona: 'sender' | 'recipient') {
  const epoch = renderId; const authEpoch = sessionGeneration();
  const destination = demoWorld(publicMemories, persona);
  const seen = await takeMemoryTrain(`${destination.user.displayName}’s world`, destination.memories);
  if (epoch !== renderId || authEpoch !== sessionGeneration()) return;
  arrivals = seen;
  activePersona = persona;
  world = destination;
  navigate(`world?demo=${persona}`);
}
async function collectionPage(epoch: number) {
  const abort = new AbortController(); cleanup = () => abort.abort();
  app.innerHTML = '<main class="generated-loading" role="status">Bringing your memories around…</main>';
  try {
    const [{ mountCollectionRoom }, { publicCollectionItems, collectionItemsFromWorld }] = await Promise.all([import('./collection-room'), import('./collection-state')]);
    if (epoch !== renderId) return;
    const [current] = await Promise.all([
      session() && !session()!.user.demo && !demoScope() ? ensureWorld() : Promise.resolve(null),
      hydrateKeepsakes(epoch, abort.signal),
    ]);
    if (epoch !== renderId) return;
    const localItems = currentKeepsakes();
    const personal = Boolean(current) || localItems.length > 0;
    const items = current ? [...localItems, ...collectionItemsFromWorld(current)] : localItems.length ? localItems : publicCollectionItems();
    app.innerHTML = '<main id="collection-room-root"></main>';
    const room = mountCollectionRoom(app.querySelector<HTMLElement>('#collection-room-root')!, {
      items, title: personal ? 'Your memory desk.' : 'The memory desk.',
      subtitle: current ? 'Your stories and gifts shared with you.' : localItems.length ? 'Your creations · saved on this device while their links are available.' : 'Three real keepsakes. Let a little world come to you.',
      isCurrent: () => epoch === renderId,
      onHome: () => navigate('home'), onCreate: () => navigate('make'),
      onOpen: (item, inside) => {
        const destination = inside ? item.worldPath : item.openPath;
        if (!destination || epoch !== renderId) return;
        const path = item.kind === 'memory' ? scopedPath(destination) : destination;
        navigate(`${path}${path.includes('?') ? '&' : '?'}from=room`);
      },
      ...(personal ? { onManage: () => navigate(scopedPath('gallery?view=list')) } : {}),
    });
    cleanup = () => { abort.abort(); room.destroy(); };
  } catch (error) { if (epoch === renderId) missing(errorMessage(error)); }
}

async function galleryList(epoch: number) {
  const abort = new AbortController(); cleanup = () => abort.abort();
  let current: WorldDTO;
  try { [current] = await Promise.all([ensureWorld(), hydrateKeepsakes(epoch, abort.signal)]); } catch (error) { if (epoch === renderId) missing(errorMessage(error)); return; }
  if (epoch !== renderId) return;
  const localItems = currentKeepsakes();
  const deviceCollection = !session() && !demoScope() && localItems.length > 0;
  app.innerHTML = `${header('gallery')}${notice()}<main class="gallery-page"><div class="world-heading"><div><span class="eyebrow">${current.user.demo || !session() ? 'FICTIONAL DEMONSTRATION COLLECTION' : `${esc(current.user.displayName.toUpperCase())}’S COLLECTION`}</span><h1>Keep the feeling.</h1><p>Every gift has a place. Every place has a story.</p></div><button class="button" data-create>Add a little world ＋</button></div><div class="gallery-filters"><div class="filter-tabs" role="group" aria-label="Memory type"><button class="selected" data-filter="all">All memories</button><button data-filter="received">Received</button><button data-filter="sent">Sent</button><button data-filter="self">My stories</button>${session() && !session()!.user.demo && !current.user.demo ? '<button data-filter="archived">Archived</button>' : ''}</div><label class="search-field"><span>Search person, place, or story</span><input type="search" placeholder="Find a memory…" aria-label="Search memories"/></label><label class="date-filter">Date<input type="month" aria-label="Filter memories by month"/></label></div><div class="memory-grid gallery-grid" id="gallery-grid"></div><p class="fine-print">Only your own memories and gifts you are authorized to read appear here.</p></main>${footer()}`;
  let filter = 'all'; let archivedMemories: MemoryDTO[] = [];
  if (deviceCollection) {
    app.querySelector('.world-heading .eyebrow')!.textContent = 'YOUR CREATIONS ON THIS DEVICE';
    app.querySelector('.service-note')?.remove();
  }
  const draw = () => {
    if (epoch !== renderId) return;
    const search = app.querySelector<HTMLInputElement>('input[type="search"]')!.value.toLowerCase(); const month = app.querySelector<HTMLInputElement>('input[type="month"]')!.value;
    const filtered = (filter === 'archived' ? archivedMemories : deviceCollection ? [] : current.memories).filter((memory) => (!search || `${memory.title} ${memory.story} ${memory.ownerName} ${memory.location.label}`.toLowerCase().includes(search)) && (!month || memory.location.experiencedAt.startsWith(month)) && (filter === 'all' || filter === 'archived' || (filter === 'self' && memory.ownerId === current.user.id) || (filter === 'received' && current.received.some((gift) => gift.memoryId === memory.id)) || (filter === 'sent' && current.sent.some((gift) => gift.memoryId === memory.id))));
    const local = filter === 'all' || filter === 'self' ? localItems.filter(item => (!search || `${item.title} ${item.story} ${item.subtitle}`.toLowerCase().includes(search)) && (!month || item.createdAt?.startsWith(month))) : [];
    const cards = filter === 'archived' ? filtered.map((memory) => `<div class="archive-card"><span class="eyebrow">ARCHIVED · ORIGINALS RETAINED</span><h3>${esc(memory.title)}</h3><p>${esc(memory.location.label)}</p><button class="button" data-restore="${esc(memory.id)}">Restore this memory ↗</button></div>`).join('') : local.map(keepsakeCard).join('') + filtered.map(memoryCard).join('');
    app.querySelector<HTMLElement>('#gallery-grid')!.innerHTML = cards || '<div class="empty-state"><span>◇</span><h2>A quiet corner, for now.</h2><p>No memories match these filters. Try another person, place, or month.</p></div>'; bindCommon();
    app.querySelectorAll<HTMLButtonElement>('[data-restore]').forEach((button) => button.onclick = async () => { button.disabled = true; try { await api<MemoryDTO>('restore', { memoryId: button.dataset.restore }); world = null; toast('Memory restored. Revoked invitations remain revoked.'); void render(); } catch (error) { toast(errorMessage(error)); button.disabled = false; } });
  };
  app.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.onclick = async () => { filter = button.dataset.filter!; app.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('selected', item === button)); if (filter === 'archived') { try { const archive = await api<WorldDTO>('world', undefined, { archived: 'true' }); if (epoch !== renderId) return; archivedMemories = archive.memories.filter((memory) => !!memory.archivedAt); } catch (error) { toast(errorMessage(error)); } } draw(); });
  app.querySelectorAll<HTMLInputElement>('.gallery-filters input').forEach((input) => input.oninput = draw); draw();
}
async function atlas(epoch: number) {
  let current: WorldDTO;
  try { current = await ensureWorld(); } catch (error) { if (epoch === renderId) missing(errorMessage(error)); return; }
  if (epoch !== renderId) return;
  const geographic = routeParams().get('view') === 'globe';
  const focus = routeParams().get('focus');
  const viewPath = (view: 'story' | 'globe') => scopedPath('atlas?view=' + view + (focus ? '&focus=' + encodeURIComponent(focus) : ''));
  app.innerHTML =
    header('atlas') + notice() + '<main class="atlas-page"><div class="world-heading"><div><span class="eyebrow">' + esc(current.user.displayName.toUpperCase()) + '’S HISTORY ' + (current.user.demo || !session() ? '· FICTIONAL DEMONSTRATION' : '') + '</span><h1>Your atlas. Still unfolding.</h1><p>Places visited, stories received, and places you want to explore.</p></div><a class="quiet-button" href="#/' + scopedPath('world') + '">Back to your world ↖</a></div><section class="atlas-view-choice" aria-label="Choose your atlas view"><div><span class="eyebrow">TWO WAYS TO FIND A PLACE</span><p>' + (geographic ? 'See published places on Earth, then open the stories you may read.' : 'Browse the sourced pilot catalog and the memories you can open.') + '</p></div><nav aria-label="Atlas display"><a ' + (!geographic ? 'aria-current="page"' : '') + ' href="#/' + viewPath('story') + '"><span>▦</span> Story atlas</a><a ' + (geographic ? 'aria-current="page"' : '') + ' href="#/' + viewPath('globe') + '"><span>◎</span> Geographic globe</a></nav></section>' + (geographic ? '<div id="geographic-atlas"></div>' : '<div id="discovery-map"></div>') + '<aside class="map-explainer"><span class="eyebrow">HOW TO READ YOUR ATLAS</span><p>A colored territory means there is at least one recorded visit inside it. It does not mean you have seen every street. A received memory opens a window, and keeps physical visits separate.</p><p>São Paulo is our detailed pilot. Elsewhere, missing detail does not mean you have never been there.' + (geographic ? ' Globe points use published catalog coordinates, not private GPS tracks or live feeds.' : ' This illustrated view is schematic; it does not draw geographic boundaries.') + '</p></aside></main>' + footer();
  bindCommon();
  app.querySelector('.atlas-view-choice')?.insertAdjacentHTML('beforebegin', trailJournal(current));
  if (geographic) mountGlobeAtlas(current, epoch); else mountMap(current);
}
function mountGlobeAtlas(current: WorldDTO, epoch: number) {
  const host = app.querySelector<HTMLElement>('#geographic-atlas'); if (!host) return;
  const snapshot = projectWorldToGlobe(current, { scope: current.user.demo ? 'public-demo' : 'owner', viewerId: session()?.user.id });
  const permittedMemories = new Map(current.memories.map(memory => [memory.id, memory]));
  const placeNames = new Map(MAP_PLACES.map(place => [place.id, place.name]));
  let disposed = false; let attempt = 0; let ready = false;
  let handle: { focusPlace: (id: string) => void; showPilot: () => void; destroy: () => void } | null = null;
  let selected = snapshot.places.find(place => place.id === routeParams().get('focus')) || snapshot.places.find(place => place.memoryCount > 0) || snapshot.places[0];
  const active = () => !disposed && epoch === renderId;
  const oldCleanup = cleanup;
  cleanup = () => { disposed = true; attempt++; handle?.destroy(); handle = null; oldCleanup?.(); };
  const statusSummary = (place: GlobePlace) => (place.physicallyVisited ? '● Visited in person' : '○ No physical visit recorded') + (place.memoryCount ? ' · ◇ ' + place.memoryCount + (place.memoryCount === 1 ? ' memory' : ' memories') : '') + (place.wishlistPointCount ? ' · ☆ Want to visit' : '');
  host.innerHTML = '<section class="globe-atlas" aria-label="' + esc(current.user.displayName) + '’s geographic atlas"><div class="globe-topline"><div><span class="eyebrow">' + esc(current.user.displayName.toUpperCase()) + '’S PLACES ON EARTH</span><h2>Stories have coordinates.</h2></div><span class="globe-scope-label">' + (current.user.demo ? 'Fictional history · published places' : 'Your authorized world') + '</span></div><ul class="globe-legend" aria-label="Globe legend"><li>● Visited in person</li><li>◇ Known through a memory</li><li>☆ Want to visit</li></ul><div class="globe-layout"><div class="globe-stage"><div id="geographic-viewer" class="geographic-viewer" aria-label="Interactive geographic globe"></div><div class="globe-loading" id="globe-load-status" role="status"><span class="loading-dot"></span><span>Preparing the geographic globe…</span></div><div id="globe-recovery" class="globe-recovery" hidden></div><p class="globe-geography-note">Local geography opens without an external account. Street imagery is optional and contacts OpenStreetMap if you enable it.</p></div><aside class="globe-place-panel"><div class="globe-place-selector"><label for="globe-place-select">Find a published place</label><select id="globe-place-select">' + snapshot.places.map(place => '<option value="' + esc(place.id) + '" ' + (place.id === selected?.id ? 'selected' : '') + '>' + esc(place.name) + '</option>').join('') + '</select></div><div id="globe-place-detail" aria-live="polite"></div></aside></div><details class="globe-accessible-list"><summary>All published places · ' + snapshot.places.length + ' catalog points</summary><ul>' + snapshot.places.map(place => '<li><button data-globe-place="' + esc(place.id) + '"><strong>' + esc(place.name) + '</strong><span>' + esc(statusSummary(place)) + '</span></button></li>').join('') + '</ul></details>' + (snapshot.unlocated.length ? '<div class="globe-unlocated"><span class="eyebrow">SOME STORIES STAY IN THE ILLUSTRATED ATLAS</span><p>These places have no usable published coordinate for this view. No marker is placed at an invented location.</p><ul>' + snapshot.unlocated.map(place => '<li><strong>' + esc(place.name) + '</strong>' + place.memoryIds.filter(id => permittedMemories.has(id)).map(id => '<button data-memory="' + esc(id) + '">' + esc(permittedMemories.get(id)!.title) + ' ↗</button>').join('') + '</li>').join('') + '</ul></div>' : '') + '<p class="globe-method-note">The globe locates real published points. The 3D gift and World Labs place inside a memory are separate artistic interpretations. Opening a marker never records a visit.</p></section>';
  const viewer = host.querySelector<HTMLElement>('#geographic-viewer')!;
  const loading = host.querySelector<HTMLElement>('#globe-load-status')!;
  const recovery = host.querySelector<HTMLElement>('#globe-recovery')!;
  const picker = host.querySelector<HTMLSelectElement>('#globe-place-select')!;
  function showDetail(place: GlobePlace) {
    const memories = place.memoryIds.map(id => permittedMemories.get(id)).filter((memory): memory is MemoryDTO => !!memory);
    host!.querySelector<HTMLElement>('#globe-place-detail')!.innerHTML = '<span class="eyebrow">' + esc(place.path.map(id => placeNames.get(id) || id).join(' / ')) + '</span><h3>' + esc(place.name) + '</h3><p class="globe-place-history">' + esc(statusSummary(place)) + '</p><div class="globe-place-coordinates"><span>Published location</span><strong>' + esc(place.latitude.toFixed(6)) + '°, ' + esc(place.longitude.toFixed(6)) + '°</strong></div><p class="globe-provenance">' + esc(place.coordinateNote) + '</p><a class="text-link globe-source-link" href="' + esc(place.coordinateSourceUrl) + '" target="_blank" rel="noopener noreferrer">Coordinate source ↗</a><div class="globe-memory-list">' + (memories.length ? '<span class="eyebrow">STORIES YOU MAY OPEN HERE</span>' + memories.map(memory => '<button class="globe-memory-card" data-memory="' + esc(memory.id) + '">' + (photo(memory) && (photo(memory)!.expiresAt === 0 || photo(memory)!.expiresAt > Date.now() / 1000 + 5) ? '<img src="' + esc(photo(memory)!.url) + '" alt="Original media for ' + esc(memory.title) + '" loading="lazy"/>' : '<span class="globe-memory-symbol">◇</span>') + '<span><small>' + esc(memory.ownerName) + '’s memory</small><strong>' + esc(memory.title) + '</strong><em>Open this memory ↗</em></span></button>').join('') : '<p class="globe-empty-place">No authorized memory is attached to this point. You can explore the published place without adding a visit.</p>') + '</div><a class="text-link globe-story-link" href="#/' + scopedPath('atlas?view=story&focus=' + encodeURIComponent(place.id)) + '">Explore this place in the story atlas ↗</a>';
    bindCommon();
  }
  function selectPlace(id: string, focusCamera = true) {
    if (!active()) return;
    const place = snapshot.places.find(item => item.id === id); if (!place) return;
    selected = place; picker.value = id; showDetail(place);
    host!.querySelectorAll<HTMLButtonElement>('[data-globe-place]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.globePlace === id)));
    const path = scopedPath('atlas?view=globe&focus=' + encodeURIComponent(id)); history.replaceState(null, '', '#/' + path);
    app.querySelectorAll<HTMLAnchorElement>('.atlas-view-choice nav a').forEach((link, index) => link.href = '#/' + scopedPath('atlas?view=' + (index ? 'globe' : 'story') + '&focus=' + encodeURIComponent(id)));
    if (focusCamera && ready) handle?.focusPlace(id);
  }
  picker.onchange = () => selectPlace(picker.value);
  host.querySelectorAll<HTMLButtonElement>('[data-globe-place]').forEach(button => button.onclick = () => selectPlace(button.dataset.globePlace!));
  function fail(message: string, freshPage = false) {
    if (!active()) return;
    attempt++; ready = false; loading.hidden = true; handle?.destroy(); handle = null;
    recovery.hidden = false;
    recovery.innerHTML = '<span aria-hidden="true">◎</span><h3>The story still has a place.</h3><p>' + esc(message) + '</p><div><a class="button" href="#/' + scopedPath('atlas?view=story' + (selected ? '&focus=' + encodeURIComponent(selected.id) : '')) + '">Continue with the story atlas ↗</a><button class="quiet-button" data-globe-retry>Retry the globe ↻</button></div><small>No new 3D generation is requested.</small>';
    recovery.querySelector<HTMLButtonElement>('[data-globe-retry]')!.onclick = () => { if (freshPage) location.reload(); else void load(); };
  }
  async function load() {
    const version = ++attempt; handle?.destroy(); handle = null; ready = false;
    recovery.hidden = true; loading.hidden = false; viewer.replaceChildren();
    try {
      const { mountGeographicGlobe } = await import('./geographic-globe');
      if (!active() || version !== attempt) return;
      const next = await mountGeographicGlobe(viewer, { places: snapshot.places, selectedPlaceId: selected?.id, onSelectPlace: id => { if (active() && version === attempt) selectPlace(id, false); }, onError: message => { if (active() && version === attempt) fail(message); } });
      if (!active() || version !== attempt) { next.destroy(); return; }
      handle = next; ready = true; loading.hidden = true;
    } catch (error) { console.error('Geographic renderer could not load:', String(error)); if (active() && version === attempt) fail('The geographic view could not load on this device. Your atlas and memories remain available. Retry or continue with the story atlas.', true); }
  }
  if (selected) selectPlace(selected.id, false);
  bindCommon(); void load();
}
async function memoryPage(id: string, epoch: number) {
  let memory = publicMemories.find((item) => item.id === id);
  if (session() && !demoScope()) { try { const current = await loadWorld(); if (epoch !== renderId) return; memory = current.memories.find((item) => item.id === id) || publicMemories.find((item) => item.id === id); } catch { memory = publicMemories.find((item) => item.id === id); } }
  else if (memory?.media.some((item) => item.expiresAt > 0 && item.expiresAt < Date.now() / 1000 + 10)) { try { publicMemories = orderDemoMemories((await api<MemoryDTO[]>('demo')).filter(memory => memory.demo)); memory = publicMemories.find((item) => item.id === id); } catch { memory = undefined; } }
  if (epoch !== renderId) return;
  if (!memory) return missing('This memory is private or no longer available.');
  renderMemory(memory, null, epoch);
}
async function giftPage(token: string, epoch: number) {
  app.innerHTML = `${header()}<main class="loading-state"><span class="loading-orbit">◎</span><p>Finding your little world…</p></main>`; bindCommon();
  try {
    const claimToken = new URLSearchParams(location.hash.replace(/^#\/?/, '')).get('claim') || '';
    const response = await api<GiftViewDTO>('gift', undefined, {}, undefined, { 'X-Gift-Token': token, ...(claimToken ? { 'X-Gift-Claim': claimToken } : {}) }); if (epoch !== renderId) return;
    currentGift = response;
    const gift = response.gift;
    app.innerHTML = `${header()}<main class="gift-arrival">${progressTrail('open')}<span class="eyebrow">A LITTLE WORLD FROM ${esc(gift.senderName.toUpperCase())}</span><h1>Someone thought of you.</h1><p>${esc(gift.message || 'There is a story inside this little gift.')}</p><button class="gift-box-button" aria-label="Open your gift" data-open-box><span class="box-halo"></span><span class="gift-box"><i class="box-top"></i><i class="box-ribbon"></i><i class="box-bow"></i><i class="box-star">✧</i></span><span class="box-callout">Touch to open <span>↗</span></span></button><p class="fine-print">This invitation grants access to this gift only. It does not open the sender’s entire world.</p></main>${footer()}`; bindCommon();
    app.querySelector<HTMLButtonElement>('[data-open-box]')!.onclick = async () => { const button = app.querySelector<HTMLButtonElement>('[data-open-box]')!; button.classList.add('opened'); button.disabled = true; let opened: GiftViewDTO; try { opened = await api<GiftViewDTO>('gift', undefined, {}, undefined, { 'X-Gift-Token': token, ...(claimToken ? { 'X-Gift-Claim': claimToken } : {}) }); if (epoch !== renderId) return; currentGift = opened; } catch (error) { if (epoch === renderId) missing(errorMessage(error)); return; } setTimeout(() => { if (epoch === renderId) { renderMemory(opened.memory, { ...opened, gift: { ...opened.gift, token, claimToken } }, epoch); app.querySelector<HTMLElement>('.memory-intro h1')?.focus(); } }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 800); };
  } catch (error) { if (epoch === renderId) missing(errorMessage(error)); }
}
function demoGiftPage(id: string, epoch: number) {
  const memory = publicMemories.find((item) => item.id === id);
  if (!memory || demoFixtureKey(memory) !== 'bird') return missing('This demonstration box contains Maya’s bird. Other available stories can be explored from Memories.');
  const gift: GiftViewDTO = { gift: { id: 'precomputed-public-gift', memoryId: memory.id, senderName: memory.ownerName, recipientName: 'Noah', message: 'A little bird, until I can give it to you in person.', createdAt: memory.createdAt, revokedAt: null, claimedBy: null }, memory, canClaim: false };
  app.innerHTML = `${header()}${notice()}<main class="gift-arrival">${progressTrail('open')}<span class="eyebrow">PUBLIC FICTIONAL DEMONSTRATION · FROM ${esc(memory.ownerName.toUpperCase())}</span><h1>Someone thought of you.</h1><p>${esc(gift.gift.message)}</p><span class="arrival-relationship">Maya found the bird. You are Noah, opening its story.</span><button class="gift-box-button" aria-label="Open the demonstration gift" data-open-box><span class="box-halo"></span><span class="gift-box"><i class="box-top"></i><i class="box-ribbon"></i><i class="box-bow"></i><i class="box-star">✧</i></span><span class="box-callout">Touch to open <span>↗</span></span></button><p class="fine-print">A precomputed gift with real Tripo and World Labs assets. The people and story are fictional. This is a read-only preview, not a live personal invitation.</p></main>${footer()}`; bindCommon();
  app.querySelector<HTMLButtonElement>('[data-open-box]')!.onclick = () => { const button = app.querySelector<HTMLButtonElement>('[data-open-box]')!; button.classList.add('opened'); button.disabled = true; setTimeout(() => { if (epoch === renderId) { activePersona = 'recipient'; world = demoWorld(publicMemories, activePersona); navigate('trail?demo=recipient&memory=' + encodeURIComponent(memory.id)); } }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 800); };
}
function renderMemory(memory: MemoryDTO, gift: GiftViewDTO | null, epoch: number) {
  cleanup?.(); cleanup = null;
  let disposed = false; const teardown: (() => void)[] = [];
  let viewerVersion = 0; let viewerReady = false;
  let activeViewer: { destroy: () => void; reset: () => void; rotate?: (delta: number) => void; zoom?: (delta: number) => void; forward?: () => void; backward?: () => void } | null = null;
  cleanup = () => { disposed = true; viewerVersion++; activeViewer?.destroy(); activeViewer = null; teardown.forEach(destroy => destroy()); };
  const model = memory.media.find(item => item.kind === 'model');
  const original = photo(memory);
  const audio = memory.media.find(item => item.kind === 'audio');
  const generatedWorld = memory.media.find(item => item.kind === 'world' && !item.mimeType.startsWith('image/'));
  const panorama = memory.media.find(item => item.kind === 'world' && item.mimeType.startsWith('image/'));
  const owned = session()?.user.id === memory.ownerId && !session()?.user.demo && !memory.demo;
  const atlasWorld = world && (world.user.demo ? memory.demo : world.user.id === session()?.user.id) ? world : null;
  const atlasPlace = atlasWorld && (owned || memory.shareLocation === true) && memory.location.placeId !== 'world' && (!gift || memory.demo || gift.gift.claimedBy === session()?.user.id) ? projectWorldToGlobe(atlasWorld, { scope: atlasWorld.user.demo ? 'public-demo' : 'owner', viewerId: session()?.user.id }).places.find(place => place.id === memory.location.placeId && place.memoryIds.includes(memory.id)) : undefined;
  const geographyHref = atlasPlace ? scopedPath(`atlas?view=globe&focus=${encodeURIComponent(atlasPlace.id)}${atlasWorld!.user.demo && !demoScope() ? `&demo=${activePersona}` : ''}`) : '';
  const refreshAuthorized = async (): Promise<MemoryDTO> => {
    if (gift?.gift.token) {
      const latest = await api<GiftViewDTO>('gift', undefined, {}, undefined, { 'X-Gift-Token': gift.gift.token, ...(gift.gift.claimToken ? { 'X-Gift-Claim': gift.gift.claimToken } : {}) });
      gift = { ...latest, gift: { ...latest.gift, token: gift.gift.token, claimToken: gift.gift.claimToken } };
      return latest.memory;
    }
    if (memory.demo && memory.media.every(item => item.expiresAt === 0)) return memory;
    if (session() && !demoScope()) {
      const current = await loadWorld(); const latest = current.memories.find(item => item.id === memory.id);
      if (latest) return latest; throw new Error('This memory is no longer available to this account.');
    }
    publicMemories = orderDemoMemories((await api<MemoryDTO[]>('demo')).filter(item => item.demo));
    const latest = publicMemories.find(item => item.id === memory.id);
    if (latest) return latest; throw new Error('This memory is no longer available.');
  };
  const stateCopy = (state: string, label: string) => ({ 'not-requested': 'Originals kept', pending: `${label} queued`, processing: `${label} is being created`, completed: `${label} ready`, failed: `${label} needs a retry` } as Record<string, string>)[state] || 'Originals kept';
  app.innerHTML = `${header()}${notice()}<main class="memory-page">
    <div class="memory-heading"><a class="text-link" href="#/${scopedPath('gallery')}">← Back to memories</a><span class="eyebrow">${memory.demo ? 'FICTIONAL DEMONSTRATION' : owned ? 'YOUR PRIVATE MEMORY' : 'A MEMORY SHARED WITH YOU'}</span></div>
    ${owned ? '<div class="creator-path">Your memory is saved privately. Review it, create an interpretation if you choose, then make an invitation.</div>' : progressTrail('explore')}
    <div class="memory-intro"><div><span class="eyebrow">${esc(memory.ownerName.toUpperCase())}’S POSTCARD · ${esc(memory.location.label)}</span><h1 tabindex="-1">${esc(memory.title)}</h1></div>${gift ? `<div class="gift-connection"><span>${esc(gift.gift.senderName)}</span><i aria-hidden="true">→</i><span>${esc(gift.gift.recipientName || 'You')}</span><small>${memory.demo ? 'A fictional gift, ready to explore' : 'This invitation opens one memory'}</small></div>` : ''}</div>
    <div class="memory-experience">
      <section class="memory-visual">
        <div class="viewer-mode-tabs" role="tablist" aria-label="Explore the gift and its place"><button id="mode-gift" role="tab" aria-selected="true" aria-controls="memory-scene" tabindex="0" data-mode="gift"><span>◇</span> The gift</button><button id="mode-place" role="tab" aria-selected="false" aria-controls="memory-scene" tabindex="-1" data-mode="place" ${generatedWorld || panorama ? '' : 'disabled'}><span>⌖</span> The place</button></div>
        <div class="scene-container aurora-viewport" id="memory-scene" role="tabpanel" aria-labelledby="mode-gift"></div>
        <div class="viewer-tools" id="viewer-tools" aria-label="3D viewer controls"></div>
        <div class="scene-caption"><span id="viewer-instructions">Explore the original gift and its story.</span><span id="viewer-provider" class="provider-credit"></span></div>
        <p class="fine-print">${esc(memory.artisticNote || 'AI objects and scenery are artistic interpretations. The author’s words and original files remain available.')}</p>
      </section>
      <aside class="memory-story"><span class="eyebrow">A MOMENT IN ${esc(memory.ownerName.toUpperCase())}’S WORDS</span><h2>What the gift carries.</h2><div class="story-place"><span>⌖ ${esc(memory.location.label)}</span><span>${esc(date(memory.location.experiencedAt))}</span></div>${atlasPlace ? `<a class="memory-geography-link" href="#/${geographyHref}"><span>◎</span><span>Find this published place on Earth<small>Geographic globe · separate from the artistic 3D place</small></span><i>↗</i></a>` : ''}<p class="story-body">${esc(memory.story)}</p>
        ${gift ? `<blockquote><span>A NOTE FOR ${esc(gift.gift.recipientName || 'YOU')}</span>${esc(gift.gift.message)}</blockquote>` : ''}
        ${audio ? `<label class="audio-story">Hear the original narration<audio controls preload="none" src="${esc(audio.url)}"></audio></label>` : ''}
        <div class="memory-buttons">${gift ? gift.canClaim ? '<button class="button" data-claim>Keep this gift in my collection ＋</button>' : `<p class="gift-read-note">${memory.demo ? 'Public demo · this fictional gift is here to explore. Your personal collection stays unchanged.' : gift.gift.claimedBy === session()?.user.id ? 'This gift is in your collection.' : 'This is a read-only invitation. The sender can give you a separate invitation to keep it.'}</p>` : owned ? '<button class="button" data-share>Create an invitation ↗</button>' : '<button class="quiet-button" data-create>How to make a gift like this ↗</button>'}${owned ? `<button class="quiet-button" data-generation>${memory.objectStatus === 'failed' ? 'Retry the 3D gift' : model ? '3D gift ready ✓' : 'Create the 3D gift'}</button>` : ''}</div>
        ${owned ? `<div class="memory-status"><span>Originals preserved</span><span>${esc(stateCopy(memory.objectStatus, '3D gift'))}</span><span>${esc(stateCopy(memory.environmentStatus, 'Place'))}</span></div>` : ''}
        <details class="original-details"><summary>Original media & interpretation notes</summary>${original ? `<img src="${esc(original.url)}" alt="Original image provided with this memory" />` : '<p>No original image was attached to this memory.</p>'}${memory.media.filter(item => item.kind === 'place-photo').map(item => `<img src="${esc(item.url)}" alt="Original place photo from the author" loading="lazy" />`).join('')}<p class="fine-print">${esc(memory.artisticNote)}<br/>Location source: ${esc(memory.location.source)}. Receiving a gift does not record a physical visit.</p></details>
      </aside>
    </div>
    ${memory.demo ? `<section class="journey-next"><div><span class="eyebrow">NEXT: FOLLOW THE MEMORY</span><h2>A gift connects two worlds.</h2><p>Reveal three fragments, make a digital keepsake, then ride to your atlas. A shared memory never becomes a physical visit.</p></div><button class="button" data-next-journey>Follow this memory trail ↗</button></section>` : owned ? '<section class="journey-next"><div><span class="eyebrow">NEXT: MAKE IT SOMEONE’S GIFT</span><h2>The moment is ready to travel.</h2><p>Choose who it is for, add your note, and decide whether the invitation permits reading or keeping the memory.</p></div><button class="button" data-share>Create an invitation ↗</button></section>' : '<section class="journey-next"><div><span class="eyebrow">YOUR INVITATION, YOUR CHOICE</span><h2>Keep the connection.</h2><p>A gift opens this memory only. Keeping it requires an explicit recipient invitation and your own account. It never adds a physical visit.</p></div><a class="text-link" href="#/gallery">Go to my collection ↗</a></section>'}
    ${owned ? '<section class="owner-sharing" id="owner-sharing"></section>' : ''}
  </main>${footer()}`;
  bindCommon();
  const host = app.querySelector<HTMLElement>('#memory-scene')!;
  const tools = app.querySelector<HTMLElement>('#viewer-tools')!;
  const instructions = app.querySelector<HTMLElement>('#viewer-instructions')!;
  const provider = app.querySelector<HTMLElement>('#viewer-provider')!;
  let currentMode: 'gift' | 'place' = 'gift';
  function controls(mode: 'gift' | 'place') {
    tools.innerHTML = mode === 'gift'
      ? '<button data-view-rotate-left aria-label="Rotate gift left">↶ <span>Rotate</span></button><button data-view-rotate-right aria-label="Rotate gift right">↷ <span>Rotate</span></button><button data-view-zoom-in aria-label="Zoom in on gift">＋ <span>Closer</span></button><button data-view-zoom-out aria-label="Zoom out from gift">− <span>Further</span></button><button data-view-reset aria-label="Reset gift view">↺ <span>Reset</span></button>'
      : '<button data-world-back aria-label="Step backward">← <span>Back</span></button><button data-world-forward aria-label="Step forward">→ <span>Forward</span></button><button data-view-reset aria-label="Reset place view">↺ <span>Reset</span></button>';
    tools.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = true);
    tools.querySelector<HTMLButtonElement>('[data-view-rotate-left]')?.addEventListener('click', () => activeViewer?.rotate?.(-0.2));
    tools.querySelector<HTMLButtonElement>('[data-view-rotate-right]')?.addEventListener('click', () => activeViewer?.rotate?.(0.2));
    tools.querySelector<HTMLButtonElement>('[data-view-zoom-in]')?.addEventListener('click', () => activeViewer?.zoom?.(-0.15));
    tools.querySelector<HTMLButtonElement>('[data-view-zoom-out]')?.addEventListener('click', () => activeViewer?.zoom?.(0.15));
    tools.querySelector<HTMLButtonElement>('[data-view-reset]')?.addEventListener('click', () => activeViewer?.reset());
    tools.querySelector<HTMLButtonElement>('[data-world-back]')?.addEventListener('click', () => activeViewer?.backward?.());
    tools.querySelector<HTMLButtonElement>('[data-world-forward]')?.addEventListener('click', () => activeViewer?.forward?.());
  }
  function showPoster(mode: 'gift' | 'place', source: string | undefined, loading: boolean) {
    host.classList.remove('viewer-ready', 'viewer-failed');
    host.innerHTML = `<div class="viewer-poster">${source ? `<img src="${esc(source)}" alt="${mode === 'gift' ? 'Original gift image' : 'Published panorama of the artistic place'}" />` : miniArt('bird')}</div>${loading ? `<div class="viewer-loading" role="status"><span class="loading-dot"></span><span data-load-status>${mode === 'gift' ? 'Preparing your 3D gift…' : 'Preparing the artistic place…'}</span></div>` : ''}`;
  }
  async function setMode(mode: 'gift' | 'place') {
    const version = ++viewerVersion; currentMode = mode; viewerReady = false;
    activeViewer?.destroy(); activeViewer = null;
    host.setAttribute('aria-labelledby', mode === 'gift' ? 'mode-gift' : 'mode-place');
    app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => { const active = button.dataset.mode === mode; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
    controls(mode);
    const asset = mode === 'gift' ? model : generatedWorld;
    showPoster(mode, mode === 'gift' ? original?.url : panorama?.url, !!asset);
    instructions.textContent = mode === 'gift' ? model ? 'Drag to turn the gift. Pinch or use the controls to get closer.' : 'Original gift image · its story is beside it.' : generatedWorld ? 'Drag to look around. Use the controls or arrow keys for small viewing offsets.' : 'Published panorama · an artistic interpretation of the place.';
    provider.textContent = mode === 'gift' ? model ? '3D gift · Tripo' : 'Original media' : 'Artistic place · World Labs';
    tools.hidden = !asset;
    if (!asset) return;
    const stillCurrent = () => !disposed && epoch === renderId && version === viewerVersion;
    const ready = () => { if (!stillCurrent()) return; viewerReady = true; host.classList.add('viewer-ready'); host.querySelector('.viewer-loading')?.remove(); tools.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = false); };
    const failed = (message: string) => {
      if (!stillCurrent()) return;
      viewerReady = false; activeViewer?.destroy(); activeViewer = null;
      showPoster(mode, mode === 'gift' ? original?.url : panorama?.url, false); host.classList.add('viewer-failed');
      instructions.textContent = mode === 'gift' ? 'Original image fallback · your story is still here.' : 'Panorama fallback · your story is still here.';
      provider.textContent = mode === 'gift' ? 'Original media' : 'World Labs panorama';
      tools.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = true);
      host.insertAdjacentHTML('beforeend', `<div class="viewer-recovery" role="status"><p>${esc(message)}</p><button class="button" data-retry-view>Retry 3D viewing ↻</button><span>No new generation is requested.</span></div>`);
      host.querySelector<HTMLButtonElement>('[data-retry-view]')!.onclick = () => void setMode(mode);
    };
    const progress = (value: { phase: 'loading' | 'decoding'; loadedBytes: number; totalBytes: number | null }) => { if (!stillCurrent()) return; const label = host.querySelector<HTMLElement>('[data-load-status]'); if (label) label.textContent = value.phase === 'decoding' ? 'Preparing the scene for this device…' : value.loadedBytes > 0 ? `Loading the scene · ${Math.round(value.loadedBytes / 1024)} KB received` : 'Loading the scene…'; };
    try {
      const latest = asset.expiresAt > 0 ? await refreshAuthorized() : memory;
      if (!stillCurrent()) return;
      const accessible = latest.media.find(item => item.id === asset.id); if (!accessible) throw new Error('This 3D asset is no longer accessible.');
      if (mode === 'gift') {
        const { mountMemoryScene } = await import('./scene'); if (!stillCurrent()) return;
        activeViewer = mountMemoryScene(host, { modelUrl: accessible.url, onReady: ready, onError: failed, onProgress: progress });
      } else {
        const { mountGeneratedEnvironment } = await import('./environment'); if (!stillCurrent()) return;
        activeViewer = mountGeneratedEnvironment(host, accessible.url, ready, failed, progress);
      }
    } catch (error) { failed(errorMessage(error)); }
  }
  app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    button.onclick = () => { if (button.dataset.mode !== currentMode || !viewerReady) void setMode(button.dataset.mode as 'gift' | 'place'); };
    button.onkeydown = event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const tabs = [...app.querySelectorAll<HTMLButtonElement>('[data-mode]:not(:disabled)')]; const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs.find(tab => tab !== button) || button; next.focus(); void setMode(next.dataset.mode as 'gift' | 'place'); };
  });
  void setMode(routeParams().get('view') === 'world' ? 'place' : 'gift');
  app.querySelector<HTMLButtonElement>('[data-next-journey]')?.addEventListener('click', () => navigate(scopedPath('trail?memory=' + encodeURIComponent(memory.id) + (!demoScope() ? '&demo=' + (demoFixtureKey(memory) === 'sea' ? 'sender' : 'recipient') : ''))));
  if (!memory.demo && atlasWorld) {
    const trailContext = syncTrail(atlasWorld);
    if (trailContext.catalog.some(item => item.memory.id === memory.id)) {
      app.querySelector('.memory-buttons')?.insertAdjacentHTML('beforeend', `<a class="button" href="#/${scopedPath('trail?memory=' + encodeURIComponent(memory.id))}">Follow this memory trail ↗</a>`);
    }
  }
  app.querySelectorAll<HTMLButtonElement>('[data-share]').forEach(button => button.onclick = () => showShare(memory));
  app.querySelector<HTMLButtonElement>('[data-generation]')?.addEventListener('click', () => model ? toast('This gift already has a published 3D model.') : requestGeneration(memory, 'tripo'));
  app.querySelector<HTMLButtonElement>('[data-claim]')?.addEventListener('click', async () => {
    if (!session() || session()!.user.demo) { showAuth(); return; }
    try { await api<GiftViewDTO>('claim', { token: gift!.gift.token, claimToken: gift!.gift.claimToken }); world = null; toast('Gift saved in your cloud collection.'); navigate('gallery'); } catch (error) { toast(errorMessage(error)); }
  });
  if (memory.media.some(item => item.expiresAt > 0)) {
    app.querySelector<HTMLElement>('.memory-heading')!.insertAdjacentHTML('beforeend', '<button class="quiet-button" data-refresh-access>Refresh media access ↻</button>');
    app.querySelector<HTMLButtonElement>('[data-refresh-access]')!.onclick = async () => { try { const latest = await refreshAuthorized(); if (!disposed && epoch === renderId) renderMemory(latest, gift, epoch); } catch (error) { if (!disposed && epoch === renderId) { cleanup?.(); cleanup = null; missing(errorMessage(error)); } } };
    app.querySelector<HTMLDetailsElement>('.original-details')?.addEventListener('toggle', async event => {
      if (!(event.currentTarget as HTMLDetailsElement).open || !memory.media.some(item => item.expiresAt > 0 && item.expiresAt < Date.now() / 1000 + 5)) return;
      try { const latest = await refreshAuthorized(); if (disposed) return; const originals = latest.media.filter(item => item.kind === 'gift-photo' || item.kind === 'place-photo'); app.querySelectorAll<HTMLImageElement>('.original-details img').forEach((image, index) => { if (originals[index]) image.src = originals[index].url; }); } catch (error) { toast(errorMessage(error)); }
    });
  }
  const jobs = world?.jobs.filter(job => job.memoryId === memory.id && (job.state === 'pending' || job.state === 'processing'));
  if (jobs?.length && owned) {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void loadWorld().then(next => { if (disposed || epoch !== renderId) return; const updated = next.memories.find(item => item.id === memory.id); if (updated && (updated.objectStatus !== memory.objectStatus || updated.environmentStatus !== memory.environmentStatus)) void render(); }).catch(() => undefined); }, 10000);
    teardown.push(() => clearInterval(timer));
  }
  if (owned) renderOwnerPanel(memory);
}
async function requestGeneration(memory: MemoryDTO, provider: 'tripo' | 'worldlabs') {
  if (!cloudStatus?.generationEnabled || session()?.user.demo) { toast(session()?.user.demo ? 'This fictional demo is read-only. Use your own account to generate a memory.' : 'Generation is unavailable right now. Your original memory remains here.'); return; }
  if (!memory.aiConsent) { toast('Authorize AI processing in Edit memory before requesting an interpretation.'); showEditMemory(memory); return; }
  const failed = world?.jobs.find((job) => job.memoryId === memory.id && job.provider === provider && job.state === 'failed');
  try { if (failed) await api<JobDTO>('retry', { jobId: failed.id }); else await api<JobDTO>('generate', { memoryId: memory.id, provider, dedupeKey: `${provider}-${memory.id}` }); toast('Generation queued in the cloud. You may close this page and return later.'); world = null; void render(); } catch (error) { toast(errorMessage(error)); }
}
function renderOwnerPanel(memory: MemoryDTO) {
  const host = app.querySelector<HTMLElement>('#owner-sharing'); if (!host) return;
  const gifts = world?.sent.filter((gift) => gift.memoryId === memory.id) || [];
  host.innerHTML = `<div class="owner-controls"><div><span class="eyebrow">ONLY YOU CAN CHANGE THIS MEMORY</span><h2>Your controls</h2></div><div><button class="quiet-button" data-edit-memory>Edit memory ↗</button><button class="quiet-button" data-archive-memory>Archive memory</button></div></div><button class="quiet-button" data-world-generation>${memory.environmentStatus === 'completed' ? 'Artistic environment ready ✓' : memory.environmentStatus === 'failed' ? 'Retry the artistic environment' : 'Create the artistic environment'} ↗</button><div class="invitation-list"><span class="eyebrow">YOUR INVITATIONS</span>${gifts.length ? gifts.map((gift) => `<div class="invitation-row"><div>For ${esc(gift.recipientName || 'a link holder')}<br/><span>${esc(date(gift.createdAt))} · ${gift.revokedAt ? 'Revoked' : gift.claimedBy ? 'Claimed · reading permission remains revocable' : 'Active invitation'}</span></div>${gift.revokedAt ? '<span>Access closed</span>' : `<button class="quiet-button" data-revoke-saved="${esc(gift.id)}">Revoke access</button>`}</div>`).join('') : '<p class="fine-print">No invitation yet. Your memory is private. Create a link only when you are ready.</p>'}</div><p class="fine-print">Links are shown once at creation. Revocation controls remain available after you return.</p>`;
  host.querySelector<HTMLButtonElement>('[data-edit-memory]')!.onclick = () => showEditMemory(memory);
  host.querySelector<HTMLButtonElement>('[data-archive-memory]')!.onclick = () => {
    const dialog = modal(`<span class="eyebrow">MOVE THIS MEMORY TO THE ARCHIVE</span><h2 id="archive-title">A quiet place for now.</h2><p>Archiving hides this memory from the active collection, revokes its invitations, and cancels pending jobs. Originals are retained. You can restore the memory from your archive; revoked invitations remain revoked.</p><p class="form-error" role="alert"></p><button class="button" data-confirm-archive>Archive memory</button>`, 'archive-title');
    dialog.root.querySelector<HTMLButtonElement>('[data-confirm-archive]')!.onclick = async () => { try { await api('memory', undefined, { id: memory.id }, 'DELETE'); world = null; dialog.close(); toast('Memory archived. Your originals are retained.'); navigate('gallery'); } catch (error) { dialog.root.querySelector('.form-error')!.textContent = errorMessage(error); } };
  };
  host.querySelector<HTMLButtonElement>('[data-world-generation]')!.onclick = () => memory.environmentStatus === 'completed' ? toast('This memory already has an artistic environment.') : requestGeneration(memory, 'worldlabs');
  host.querySelectorAll<HTMLButtonElement>('[data-revoke-saved]').forEach((button) => button.onclick = async () => { button.disabled = true; try { await api('revoke', { giftId: button.dataset.revokeSaved }); await loadWorld(); renderOwnerPanel(memory); toast('Invitation revoked.'); } catch (error) { toast(errorMessage(error)); button.disabled = false; } });
}
function showEditMemory(memory: MemoryDTO) {
  const dialog = modal(`<span class="eyebrow">KEEP IT IN YOUR OWN WORDS</span><h2 id="edit-title">Edit your memory.</h2><form><label>Title<input name="title" maxlength="120" required value="${esc(memory.title)}"/></label><label>Story<textarea name="story" rows="5" maxlength="4000" required>${esc(memory.story)}</textarea></label><label>Selected place<select name="placeId">${pilotPlaces.map((place) => `<option value="${esc(place.id)}" ${memory.location.placeId === place.id ? 'selected' : ''}>${esc(place.name)}</option>`).join('')}</select></label><label>Experience date<input name="experiencedAt" type="date" required value="${esc(memory.location.experiencedAt.slice(0, 10))}"/></label><label class="checkbox"><input name="shareLocation" type="checkbox" ${memory.shareLocation !== false ? 'checked' : ''}/><span>Show the place and date to authorized gift readers.</span></label><label class="checkbox"><input name="aiConsent" type="checkbox" ${memory.aiConsent ? 'checked' : ''}/><span>I authorize Tripo and World Labs to process my gift images, place images, and story when I request artistic interpretations.</span></label><p class="fine-print">Changing the place corrects associated memory markers. Physical visits remain separate manual records in your atlas.</p><p class="form-error" role="alert"></p><button class="button" type="submit">Save changes ✓</button></form>`, 'edit-title');
  const form = dialog.root.querySelector<HTMLFormElement>('form')!;
  form.onsubmit = async (event) => { event.preventDefault(); const data = new FormData(form); const place = getPilotPlace(String(data.get('placeId')))!; try { await api<MemoryDTO>('memory', { memoryId: memory.id, title: String(data.get('title')), story: String(data.get('story')), location: { placeId: place.id, label: place.label, latitude: place.lat, longitude: place.lon, source: 'manual', experiencedAt: String(data.get('experiencedAt')) }, aiConsent: data.has('aiConsent'), shareLocation: data.has('shareLocation') }, {}, 'PATCH'); world = null; dialog.close(); toast('Memory updated.'); void render(); } catch (error) { form.querySelector('.form-error')!.textContent = errorMessage(error); } };
}
function modal(content: string, labelledBy: string) {
  closeActiveDialog?.();
  const root = document.createElement('div'); root.id = 'dialog-root'; root.className = 'dialog-root'; root.innerHTML = `<div class="dialog-scrim"></div><section class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="${labelledBy}"><button class="dialog-close" aria-label="Close dialog">×</button>${content}</section>`; document.body.append(root);
  const before = document.activeElement as HTMLElement;
  let closed = false;
  const close = () => { if (closed) return; closed = true; document.removeEventListener('keydown', keys); root.remove(); if (closeActiveDialog === close) closeActiveDialog = null; if (before?.isConnected) before.focus(); };
  const keys = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); if (event.key === 'Tab') { const all = [...root.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]')].filter(element => element.getClientRects().length > 0); const first = all[0]; const last = all[all.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } };
  closeActiveDialog = close; document.addEventListener('keydown', keys); root.querySelector<HTMLButtonElement>('.dialog-close')!.onclick = close; root.querySelector<HTMLElement>('.dialog-scrim')!.onclick = close; root.querySelector<HTMLElement>('input,button')?.focus(); return { root, close };
}
function showAuth(after = '') {
  if (cloudStatus?.configured !== true) {
    const dialog = modal(`<img class="dusk-auth-object" src="/assets/portal-dusk/rio-keepsake.png" alt="A little Rio keepsake"/><h2 id="auth-title">Welcome back.</h2><p>You can explore and make a gift without an account. Email sign-in is unavailable in this preview.</p><button class="button" type="button" data-auth-continue>Continue without an account</button><button class="quiet-button" type="button" data-auth-explore>Explore a gift</button>`, 'auth-title');
    dialog.root.querySelector<HTMLButtonElement>('[data-auth-continue]')!.onclick = () => { dialog.close(); navigate('make'); };
    dialog.root.querySelector<HTMLButtonElement>('[data-auth-explore]')!.onclick = () => { dialog.close(); navigate('generated/rio-example'); };
    return;
  }
  const dialog = modal(`<span class="eyebrow">A HOME FOR YOUR MEMORIES</span><h2 id="auth-title">Step into your world.</h2><p>Your saved gifts stay with you across devices. The public demonstration is always open.</p><form id="auth-form"><label id="signup-name" hidden>Your name<input name="displayName" maxlength="80" autocomplete="name"/></label><label>Email<input name="email" type="email" autocomplete="email" required/></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" required aria-describedby="password-guidance"/></label><small id="password-guidance">Use your existing password.</small><p class="form-error" role="alert"></p><p class="form-status" role="status"></p><button class="button" type="submit">Sign in ↗</button>${cloudStatus?.signupEnabled ? '<button class="quiet-button" type="button" data-signup-toggle>Create a private account</button>' : ''}</form><div class="dialog-divider"><span>OR VISIT A FICTIONAL WORLD</span></div><div class="demo-signin"><button class="persona" data-login-demo="sender"><i>M</i> Maya · sender</button><button class="persona" data-login-demo="recipient"><i>N</i> Noah · recipient</button></div><p class="fine-print">Read-only fictional demonstration. Use your own account for private gifts. Demo personas cannot start paid generation.</p>`, 'auth-title');
  const form = dialog.root.querySelector<HTMLFormElement>('form')!;
  let signup = false;
  form.querySelector<HTMLButtonElement>('[data-signup-toggle]')?.addEventListener('click', (event) => { signup = !signup; (event.currentTarget as HTMLButtonElement).textContent = signup ? 'I already have an account' : 'Create a private account'; form.querySelector<HTMLElement>('#signup-name')!.hidden = !signup; (form.elements.namedItem('displayName') as HTMLInputElement).required = signup; form.querySelector<HTMLButtonElement>('[type="submit"]')!.textContent = signup ? 'Create my private world ↗' : 'Sign in ↗'; (form.elements.namedItem('password') as HTMLInputElement).autocomplete = signup ? 'new-password' : 'current-password'; (form.elements.namedItem('password') as HTMLInputElement).minLength = signup ? 12 : 8; form.querySelector<HTMLElement>('#password-guidance')!.textContent = signup ? 'Use at least 12 characters for your new password.' : 'Use your existing password.'; });
  form.onsubmit = async (event) => { event.preventDefault(); const data = new FormData(form); const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!; submit.disabled = true; form.querySelector('.form-error')!.textContent = ''; try { if (signup) { const result = await api<{ session: SessionDTO | null; confirmationRequired: boolean }>('signup', { email: data.get('email'), password: data.get('password'), displayName: data.get('displayName') }); if (!result.session) { form.querySelector('.form-status')!.textContent = result.confirmationRequired ? 'Check your email for the confirmation link. Confirm your address, then sign in here.' : 'Account request received. Sign in when your account is ready.'; (form.elements.namedItem('password') as HTMLInputElement).value = ''; submit.disabled = false; return; } setSession(result.session); } else setSession(await api<SessionDTO>('login', { email: data.get('email'), password: data.get('password') })); world = null; staticDemo = false; dialog.close(); if (route().startsWith('gift/')) void render(); else navigate(after || 'world'); } catch (error) { form.querySelector('.form-error')!.textContent = errorMessage(error); submit.disabled = false; } };
  dialog.root.querySelectorAll<HTMLButtonElement>('[data-login-demo]').forEach((button) => button.onclick = () => { activePersona = button.dataset.loginDemo as 'sender' | 'recipient'; if (session()?.user.demo) setSession(null); world = demoWorld(publicMemories, activePersona); dialog.close(); navigate('world'); });
}
function showAccount() {
  const user = session()!.user;
  const dialog = modal(`<span class="eyebrow">YOUR ACCOUNT</span><h2 id="account-title">Hello, ${esc(user.displayName)}.</h2><p>${user.demo ? 'Read-only fictional demonstration. Sign in to your own account to create or receive private gifts.' : 'Your memories and gift permissions are stored in the cloud.'}</p><button class="button" data-signout>Sign out</button><p class="fine-print">Signing out clears this browser session. Your cloud memories are kept.</p>`, 'account-title');
  dialog.root.querySelector<HTMLButtonElement>('[data-signout]')!.onclick = () => { setSession(null); world = null; dialog.close(); navigate('home'); };
}
function showShare(memory: MemoryDTO) {
  const draft = draftInvitations.get(memory.id);
  const dialog = modal(`<span class="eyebrow">ONE MEMORY, ONE INVITATION</span><h2 id="share-title">Send a little world.</h2><form id="share-form"><label>For someone called<input name="recipientName" maxlength="80" placeholder="A name for your dedication" value="${esc(draft?.recipient || '')}"/></label><label>Your personal note<textarea name="message" rows="3" maxlength="1200" placeholder="I found this and thought of you…" required>${esc(draft?.message || '')}</textarea></label><label class="checkbox"><input name="allowLinkRead" type="checkbox" required/><span>Anyone with this unpredictable link may read this gift. It opens only this memory, and I can revoke access.</span></label><label class="checkbox"><input name="allowClaim" type="checkbox"/><span>Also create a separate invitation to keep this memory. The first signed-in holder can claim it. Forward this invitation only to my intended recipient.</span></label><p class="form-error" role="alert"></p><button class="button" type="submit">Create an invitation ↗</button></form><div id="share-result"></div>`, 'share-title');
  const form = dialog.root.querySelector<HTMLFormElement>('form')!;
  form.onsubmit = async (event) => {
    event.preventDefault(); const data = new FormData(form); const button = form.querySelector<HTMLButtonElement>('button')!; button.disabled = true;
    try {
      const gift = await api<GiftDTO>('share', { memoryId: memory.id, message: data.get('message'), recipientName: data.get('recipientName'), allowLinkRead: data.has('allowLinkRead'), allowClaim: data.has('allowClaim') });
      const url = gift.url || `${location.origin}/#gift=${gift.token}`;
      const claimUrl = gift.claimUrl || (gift.claimToken ? `${url}&claim=${gift.claimToken}` : null);
      form.hidden = true;
      dialog.root.querySelector<HTMLElement>('#share-result')!.innerHTML = `<p class="success-copy">Your invitation is ready. Copy it and send it yourself.</p><label>Read-only gift link<input data-view-link value="${esc(url)}" readonly/></label><div class="share-actions"><button class="button" data-copy>Copy read-only link ↗</button><button class="quiet-button" data-revoke>Revoke invitation</button></div>${claimUrl ? `<label>Separate invitation to keep the memory<input data-claim-link value="${esc(claimUrl)}" readonly/></label><button class="button" data-copy-claim>Copy recipient invitation ↗</button><p class="fine-print">The first signed-in holder can keep this memory. Share this second link only with the intended recipient.</p>` : ''}<p class="fine-print">No email has been sent. These links are shown only now. You can revoke the invitation later in the memory’s controls.</p>`;
      dialog.root.querySelector<HTMLButtonElement>('[data-copy]')!.onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Invitation copied.'); } catch { const input = dialog.root.querySelector<HTMLInputElement>('#share-result input')!; input.select(); toast('Select and copy the invitation above.'); } };
      dialog.root.querySelector<HTMLButtonElement>('[data-revoke]')!.onclick = async () => { try { await api('revoke', { giftId: gift.id }); dialog.close(); toast('Invitation revoked. The original memory is still yours.'); } catch (error) { toast(errorMessage(error)); } };
      dialog.root.querySelector<HTMLButtonElement>('[data-copy-claim]')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(claimUrl!); toast('Recipient invitation copied. Send it only to your intended recipient.'); } catch { dialog.root.querySelector<HTMLInputElement>('[data-claim-link]')!.select(); toast('Select and copy the recipient invitation.'); } });
      await loadWorld(); draftInvitations.delete(memory.id); renderOwnerPanel(memory);
    } catch (error) { form.querySelector('.form-error')!.textContent = errorMessage(error); button.disabled = false; }
  };
}
function createPage() {
  if (cloudStatus?.configured !== true) { app.innerHTML = `${header()}${notice()}<main class="narrow"><span class="eyebrow">A GIFT BEGINS WITH A MOMENT</span><h1>A little photo.<br/>A story only you know.</h1><p>Make and preview your Rio gift before creating an account. Save a local draft here while the private cloud service is being prepared.</p><button class="button" data-create>Make a Rio gift</button><a class="text-link" href="#/trail?experience=rio">Open the example gift</a></main>${footer()}`; bindCommon(); return; }
  if (!session() || session()!.user.demo) { app.innerHTML = `${header()}<main class="narrow"><h1>Every story needs a home.</h1><p>Sign in to preserve originals and create a gift in your cloud world.</p><button class="button" data-auth>Sign in ↗</button></main>${footer()}`; bindCommon(); return; }
  app.innerHTML = `${header()}<main class="create-page"><div class="create-heading"><span class="eyebrow">A POSTCARD ONLY YOU CAN MAKE</span><h1>Give the moment a world.</h1><p>The physical gift can wait. The feeling does not have to.</p></div><div class="creation-layout"><form id="create-form" class="creation-form"><div class="wizard-progress"><span class="current" data-step-label="0">01 The gift</span><span data-step-label="1">02 The story</span><span data-step-label="2">03 The invitation</span></div><section class="wizard-step" data-step="0"><h2>Start with something small.</h2><p>Keep the original. Add a 3D interpretation after your memory is safely saved.</p><label class="upload-zone"><span>◇</span><strong>Add a photo of the gift</strong><small>JPG, PNG, or WebP · up to 8 MiB each</small><input type="file" name="giftPhotos" accept="image/jpeg,image/png,image/webp" multiple required/></label><div id="gift-photo-previews" class="upload-previews"></div><label>Photos of the place, if you have them<input name="placePhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple/></label><div class="wizard-actions"><span>Original media stays part of the memory.</span><button type="button" class="button" data-next>Next: the story ↗</button></div></section><section class="wizard-step" data-step="1" hidden><h2>What would you tell them?</h2><label>A title for the memory<input name="title" maxlength="120" placeholder="A little cup, a slow afternoon" required/></label><label>Your story<textarea name="story" rows="5" maxlength="4000" placeholder="Where were you? What made you think of them? Keep it in your own words." required></textarea></label><label>Original narration (optional) · up to 4 MiB<input name="audio" type="file" accept="audio/webm,audio/ogg,audio/mpeg"/></label><div class="record-control"><button class="quiet-button" type="button" data-record>Record a short narration ○</button><span id="record-status">Text works just as well.</span></div><label>Where did this happen?<select name="placeId">${pilotPlaces.map((place) => `<option value="${esc(place.id)}">${esc(place.name)} · ${esc(place.label.split(' · ').slice(-2).join(' · '))}</option>`).join('')}</select><span class="fine-print" id="coordinate-note"></span></label><label>When did you experience it?<input name="experiencedAt" type="date" value="${new Date().toISOString().slice(0, 10)}" required/></label><p class="fine-print">Location is selected manually. A current GPS position is not used to replace the place of an older memory.</p><div class="wizard-actions"><button type="button" class="quiet-button" data-back>← Back</button><button type="button" class="button" data-next>Next: the invitation ↗</button></div></section><section class="wizard-step" data-step="2" hidden><h2>A world worth sharing.</h2><div id="creation-review" class="creation-review" aria-label="Your memory before saving"></div><label>For someone called<input name="recipient" maxlength="80" placeholder="Their name, for the dedication"/></label><label>A personal dedication<textarea name="dedication" rows="3" maxlength="1200" placeholder="This made me think of you…"></textarea></label><label class="checkbox"><input name="shareLocation" type="checkbox" checked/><span>Show the selected place and experience date to authorized gift readers. Precise GPS is not collected.</span></label><label class="checkbox"><input name="aiConsent" type="checkbox"/><span>I authorize Tripo and World Labs to process my gift images, place images, and story only when I request artistic interpretations. Generated objects and scenery are not documentary records.</span></label><label class="checkbox"><input name="mediaRights" type="checkbox" required/><span>I have permission to use these files and share their original embedded metadata (such as photo location) with gift-link holders. My memory is private until I explicitly create an invitation.</span></label><div class="review-note" id="saved-draft-note"><strong>Save first. Review. Then share.</strong><p>Your originals and story will be stored in your cloud account. Generation and sharing are separate actions after review.</p></div><div class="wizard-actions"><button type="button" class="quiet-button" data-back>← Back</button><button type="submit" class="button">Save this private memory ↗</button></div></section><p id="create-error" class="form-error" role="alert"></p><p id="create-status" class="form-status" role="status"></p></form><aside class="creation-postcard"><div id="creation-preview">${miniArt('cup')}</div><span class="eyebrow">THE MOMENT COMES FIRST</span><h2>Not just the object.<br/><em>Everything it carries.</em></h2><p>A story stays in your words. Original photos and narration remain accessible. A 3D gift opens another way to explore it.</p><span class="creation-stamp">SENT WITH FEELING<br/>GIFT PORTALS / EARTH</span></aside></div></main>${footer()}`;
  bindCommon();
  const form = app.querySelector<HTMLFormElement>('#create-form')!;
  const epoch = renderId; const authScope = sessionGeneration(); const actor = session()!.user.id;
  let disposed = false; let submitting = false; let step = 0;
  const urls: string[] = [];
  let audioFile: File | null = null; let recorder: MediaRecorder | null = null; let stream: MediaStream | null = null;
  let recordingDone: Promise<void> | null = null; let recordTimer: ReturnType<typeof setTimeout> | null = null; let recordingVersion = 0;
  let persisted: MemoryDTO | null = null;
  type Original = { file: File; kind: 'gift-photo' | 'place-photo' | 'audio' };
  type Snapshot = { input: CreateMemoryInput; files: Original[]; mediaConsent: boolean; recipient: string; dedication: string };
  let savedSnapshot: Snapshot | null = null;
  const uploaded = new Set<string>();
  const pendingUploads = new Map<string, { signed: UploadDTO; bytesUploaded: boolean }>();
  const active = () => !disposed && renderId === epoch && sessionGeneration() === authScope && session()?.user.id === actor;
  const assertActive = () => { if (!active()) throw new ApiError('SESSION_CHANGED', 'Your account or page changed. Reopen the saved memory from your own collection.'); };
  const status = form.querySelector<HTMLElement>('#create-status')!;
  const error = form.querySelector<HTMLElement>('#create-error')!;
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const recordButton = form.querySelector<HTMLButtonElement>('[data-record]')!;
  const recordStatus = form.querySelector<HTMLElement>('#record-status')!;
  const gifts = form.elements.namedItem('giftPhotos') as HTMLInputElement;
  const placeSelect = form.elements.namedItem('placeId') as HTMLSelectElement;
  const stopRecording = async () => {
    if (recordTimer) clearTimeout(recordTimer); recordTimer = null;
    if (recorder?.state === 'recording') { recordStatus.textContent = 'Finishing the original narration…'; recorder.stop(); }
    stream?.getTracks().forEach(track => track.stop());
    if (recordingDone) await recordingDone;
  };
  cleanup = () => { disposed = true; recordingVersion++; audioFile = null; urls.forEach(url => URL.revokeObjectURL(url)); void stopRecording(); };
  const selectedFiles = (): Original[] => {
    const files: Original[] = [...(gifts.files || [])].map(file => ({ file, kind: 'gift-photo' }));
    const placeFiles = (form.elements.namedItem('placePhotos') as HTMLInputElement).files;
    [...(placeFiles || [])].forEach(file => files.push({ file, kind: 'place-photo' }));
    const chosenAudio = (form.elements.namedItem('audio') as HTMLInputElement).files?.[0] || audioFile;
    if (chosenAudio) files.push({ file: chosenAudio, kind: 'audio' });
    return files;
  };
  const review = () => {
    const data = new FormData(form); const place = getPilotPlace(placeSelect.value);
    const files = savedSnapshot?.files || selectedFiles();
    const input = savedSnapshot?.input;
    const title = input?.title || String(data.get('title') || 'Your memory title');
    const story = input?.story || String(data.get('story') || 'Your story stays in your own words.');
    const recipient = savedSnapshot?.recipient || String(data.get('recipient') || 'Choose later');
    const dedication = savedSnapshot?.dedication || String(data.get('dedication') || 'You can add the note when you make the invitation.');
    form.querySelector<HTMLElement>('#creation-review')!.innerHTML = '<div class="review-image">' + (urls[0] ? '<img src="' + urls[0] + '" alt="Your original gift photo"/>' : miniArt('bird')) + '</div><div><span class="eyebrow">YOUR PRIVATE MEMORY · FINAL REVIEW</span><h3>' + esc(title) + '</h3><p class="review-story">' + esc(story) + '</p><dl><div><dt>Place & date</dt><dd>' + esc(input?.location.label || place?.label || '') + ' · ' + esc(date(input?.location.experiencedAt || String(data.get('experiencedAt') || ''))) + '</dd></div><div><dt>Original files</dt><dd>' + files.filter(item => item.kind !== 'audio').length + ' photo(s) · ' + (files.some(item => item.kind === 'audio') ? 'original narration included' : recorder?.state === 'recording' ? 'narration is recording' : 'no narration') + '</dd></div><div><dt>Dedication for</dt><dd>' + esc(recipient) + '</dd></div><div><dt>Your note</dt><dd>' + esc(dedication) + '</dd></div><div><dt>Gift readers may see</dt><dd>' + ((input ? input.shareLocation : data.has('shareLocation')) ? 'The selected place and date' : 'Your story and media; place and date hidden') + '</dd></div><div><dt>AI processing</dt><dd>' + ((input ? input.aiConsent : data.has('aiConsent')) ? 'Allowed only when you request an interpretation' : 'Not authorized') + '</dd></div></dl></div>';
  };
  const showCoordinateNote = () => { form.querySelector<HTMLElement>('#coordinate-note')!.textContent = getPilotPlace(placeSelect.value)?.coordinateNote || ''; };
  placeSelect.onchange = showCoordinateNote; showCoordinateNote();
  form.addEventListener('input', review); form.addEventListener('change', review);
  const setStep = (next: number) => { step = next; form.querySelectorAll<HTMLElement>('[data-step]').forEach(section => section.hidden = Number(section.dataset.step) !== step); form.querySelectorAll<HTMLElement>('[data-step-label]').forEach(label => label.classList.toggle('current', Number(label.dataset.stepLabel) === step)); const heading = form.querySelector<HTMLElement>('[data-step="' + step + '"] h2')!; heading.setAttribute('tabindex', '-1'); heading.focus(); review(); };
  const validStep = () => [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-step="' + step + '"] input,[data-step="' + step + '"] textarea,[data-step="' + step + '"] select')].every(field => field.reportValidity());
  form.querySelectorAll<HTMLButtonElement>('[data-next]').forEach(button => button.onclick = () => { if (!validStep()) return; if (step === 0) { const issue = validateOriginalFiles(selectedFiles()); if (issue) { error.textContent = issue.message; return; } } error.textContent = ''; setStep(step + 1); });
  form.querySelectorAll<HTMLButtonElement>('[data-back]').forEach(button => button.onclick = () => setStep(step - 1));
  const lockFields = (locked: boolean) => { form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select').forEach(field => field.disabled = locked); recordButton.disabled = locked; };
  const lockSavedSnapshot = () => {
    lockFields(true);
    form.querySelector<HTMLElement>('#saved-draft-note')!.innerHTML = '<strong>Your private draft has been saved.</strong><p>The displayed photos, story, place, date, permissions, and dedication are locked while the original files finish saving. Retry continues this saved version. After completion, use Edit memory to change its story or permissions.</p>';
    submit.textContent = 'Finish saving the originals ↻'; review();
  };
  gifts.onchange = () => {
    urls.forEach(url => URL.revokeObjectURL(url)); urls.length = 0;
    const files = [...(gifts.files || [])]; const issue = files.length ? validateOriginalFiles(files.map(file => ({ file, kind: 'gift-photo' }))) : null;
    if (issue) { gifts.value = ''; error.textContent = issue.message; } else { error.textContent = ''; files.forEach(file => urls.push(URL.createObjectURL(file))); }
    form.querySelector<HTMLElement>('#gift-photo-previews')!.innerHTML = urls.map(url => '<img src="' + url + '" alt="Original gift photo preview"/>').join('');
    app.querySelector<HTMLElement>('#creation-preview')!.innerHTML = urls[0] ? '<img src="' + urls[0] + '" alt="Your original gift photo"/>' : miniArt('cup'); review();
  };
  recordButton.onclick = async () => {
    if (submitting || savedSnapshot) return;
    if (recorder?.state === 'recording' || recordingDone) { await stopRecording(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Recording is not supported here. Upload audio or write your story instead.'); return; }
    recordButton.disabled = true; const recordingAttempt = ++recordingVersion;
    try {
      const mimeType = ['audio/webm', 'audio/ogg'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) { toast('This browser’s audio format is not supported. Upload MP3 audio or write your story instead.'); return; }
      const recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active() || submitting || savedSnapshot || recordingAttempt !== recordingVersion) { recordingStream.getTracks().forEach(track => track.stop()); return; }
      stream = recordingStream; audioFile = null;
      const chunks: Blob[] = []; let bytes = 0; const nextRecorder = new MediaRecorder(recordingStream, { mimeType }); recorder = nextRecorder;
      let finish!: () => void;
      const done = new Promise<void>(resolve => { finish = resolve; }); recordingDone = done;
      const release = () => { recordingStream.getTracks().forEach(track => track.stop()); if (recorder === nextRecorder || recordingDone === done) { if (recordTimer) clearTimeout(recordTimer); recordTimer = null; } if (recorder === nextRecorder) recorder = null; if (recordingDone === done) recordingDone = null; finish(); };
      nextRecorder.ondataavailable = event => { if (!active() || recordingAttempt !== recordingVersion || recorder !== nextRecorder) return; chunks.push(event.data); bytes += event.data.size; if (bytes > 4 * 1024 * 1024 && nextRecorder.state === 'recording') void stopRecording(); };
      nextRecorder.onerror = () => { if (active() && recordingAttempt === recordingVersion) { recordingVersion++; audioFile = null; error.textContent = 'Narration recording failed. Upload supported audio or keep your text story.'; recordButton.textContent = 'Record a short narration ○'; } if (nextRecorder.state === 'recording') nextRecorder.stop(); release(); };
      nextRecorder.onstop = () => {
        if (active() && recordingAttempt === recordingVersion && recorder === nextRecorder) { const blob = new Blob(chunks, { type: mimeType }); audioFile = new File([blob], 'original-narration.' + (mimeType === 'audio/ogg' ? 'ogg' : 'webm'), { type: mimeType }); recordStatus.textContent = blob.size > 4 * 1024 * 1024 ? 'Narration exceeds 4 MiB. Record a shorter take or choose a smaller file.' : 'Original narration recorded. It will be saved with your memory.'; recordButton.textContent = 'Record again ○'; review(); }
        release();
      };
      nextRecorder.start(1000); recordButton.textContent = 'Stop recording □'; recordStatus.textContent = 'Recording · up to 60 seconds'; recordTimer = setTimeout(() => void stopRecording(), 60000); review();
    } catch { stream?.getTracks().forEach(track => track.stop()); if (active()) toast('Microphone access was unavailable. Your text story works without it.'); }
    finally { if (active() && !submitting && !savedSnapshot) recordButton.disabled = false; }
  };
  form.onsubmit = async event => {
    event.preventDefault(); if (submitting || !validStep()) return;
    submitting = true; submit.disabled = true; lockFields(true); error.textContent = '';
    try {
      await stopRecording(); assertActive();
      let snapshot = savedSnapshot;
      if (!snapshot) {
        lockFields(false); const data = new FormData(form); lockFields(true);
        const place = getPilotPlace(String(data.get('placeId'))); if (!place) throw new Error('Choose a supported place for this memory.');
        const files = selectedFiles(); const issue = validateOriginalFiles(files); if (issue) throw new Error(issue.message);
        if (!data.has('mediaRights')) throw new Error('Confirm permission to use and share the original files before saving.');
        snapshot = { input: { title: String(data.get('title')), story: String(data.get('story')), location: { placeId: place.id, label: place.label, latitude: place.lat, longitude: place.lon, source: 'manual', experiencedAt: String(data.get('experiencedAt')) }, aiConsent: data.has('aiConsent'), shareLocation: data.has('shareLocation') }, files, mediaConsent: true, recipient: String(data.get('recipient') || ''), dedication: String(data.get('dedication') || '') };
        status.textContent = 'Saving your private story…';
        persisted = await api<MemoryDTO>('memory', snapshot.input); assertActive(); savedSnapshot = snapshot; lockSavedSnapshot();
      }
      assertActive();
      for (const [index, item] of snapshot.files.entries()) {
        const key = item.kind + ':' + item.file.name + ':' + item.file.size + ':' + item.file.lastModified;
        if (uploaded.has(key)) continue;
        assertActive(); status.textContent = 'Saving original file ' + (index + 1) + ' of ' + snapshot.files.length + '…';
        let pending = pendingUploads.get(key);
        if (pending) {
          // A previous PUT may have succeeded even when its response was lost. Reconcile the owner-validated reservation first.
          try { const completed = await api<MemoryDTO>('media-complete', { mediaId: pending.signed.mediaId }); assertActive(); persisted = completed; uploaded.add(key); pendingUploads.delete(key); continue; }
          catch (failure) { assertActive(); if (!(failure instanceof ApiError) || !['DATABASE_REQUEST_FAILED', 'RESOURCE_UNAVAILABLE', 'MEDIA_CONTENT_INVALID'].includes(failure.code)) throw failure; if (pending.bytesUploaded) throw failure; }
        } else {
          const signed = await api<UploadDTO>('upload', { memoryId: persisted!.id, kind: item.kind, mimeType: item.file.type, bytes: item.file.size, consent: snapshot.mediaConsent, metadataConsent: snapshot.mediaConsent }); assertActive();
          pending = { signed, bytesUploaded: false }; pendingUploads.set(key, pending);
        }
        if (!pending.bytesUploaded) { await putFile(pending.signed.signedUploadUrl, item.file); assertActive(); pending.bytesUploaded = true; }
        persisted = await api<MemoryDTO>('media-complete', { mediaId: pending.signed.mediaId }); assertActive(); uploaded.add(key); pendingUploads.delete(key);
      }
      draftInvitations.set(persisted!.id, { recipient: snapshot.recipient, message: snapshot.dedication }); await loadWorld(); assertActive();
      status.textContent = 'Your private memory and originals are saved. No invitation has been sent.'; toast('Memory saved privately. Review it before creating an invitation.'); navigate('memory/' + encodeURIComponent(persisted!.id));
    } catch (failure) {
      if (active()) { error.textContent = errorMessage(failure) + (persisted ? ' Your private draft is saved. Retry to finish this displayed version, or return to your collection and edit it there.' : ''); submit.disabled = false; if (savedSnapshot) lockSavedSnapshot(); else lockFields(false); }
    } finally { submitting = false; }
  };
  if (routeParams().get('from') === 'rio' && privateRioSeed) {
    for (const name of ['title', 'story', 'recipient', 'dedication'] as const) (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value = privateRioSeed[name];
    const choose = new Option('Choose the supported place of your original memory', '');
    choose.disabled = true; choose.selected = true; placeSelect.prepend(choose); placeSelect.required = true;
    showCoordinateNote();
    status.textContent = 'Your words are here. Add your original gift photo and choose its supported place before saving privately. The Rio artistic preview has not been uploaded.';
  }
  review();
}
function about() {
  app.innerHTML = `${header()}<main class="narrow about-page"><span class="eyebrow">GIFTPORTALS · VERSION 10.2.1</span><h1>GiftPortals</h1><p class="large-copy">Some gifts fit in your hand. Others take you to an entire world.</p><p>Start with a photo of a place you love. Tripo turns it into a 3D keepsake; World Labs creates the place its story carries. Open the gift, turn it in your hands, then step inside its little world.</p><h2>Make a gift before creating an account.</h2><p>Start with a camera photo, a selected file or an original example. Add an optional place reference and your words. Live availability is shown before creation. Local previews keep jobs on this device; the cloud creator uses private storage and gift links that expire after seven days.</p><h2>What is real, and what is artistic?</h2><p>The generated gift viewer loads actual completed Tripo GLB and World Labs SPZ assets. The Rio example uses fictional people and an artistic interpretation of the bay. Completed gifts with a compatible collision mesh let you walk inside and choose physically supported viewpoints. These worlds are artistic interpretations rather than exact geographic reconstructions. Narrative points contain the sender's words; they are not detected landmarks. The original photo and story remain accessible if 3D cannot load.</p><h2>Private cloud gifting.</h2><p>A cloud gift link acts as a private access key. Anyone holding it can open the gift during its seven-day lifetime. Permanent cross-device collections, authenticated cloud accounts and revocable invitations require separate deployment verification. Opening a gift never records a physical visit. Existing Studio, atlas and earlier illustrated Rio routes remain available.</p><h2>Built with</h2><p>Tripo, World Labs, Three.js, Spark, TypeScript and Vite. The local provider keys stay on the server. Credits, original artwork, earlier work and map sources are documented in the project.</p><button class="button" data-create>Make your little world ↗</button><a class="text-link" href="#/generated/rio-example">Open the Rio example ↗</a></main>${footer()}`; bindCommon();
}

function missing(message: string) { app.innerHTML = `${header()}<main class="narrow"><span class="eyebrow">A CLOSED DOOR</span><h1>This little world is unavailable.</h1><p>${esc(message)}</p><a class="button" href="#/world">Explore the public demonstration ↗</a></main>${footer()}`; bindCommon(); }
async function render() {
  const epoch = ++renderId; cleanup?.(); cleanup = null; cancelTrain();
  const current = route();
  const rioTheme = current.startsWith('walk/') || current === 'paris-walk' || current === 'paris-flight' || current === 'quality-comparison' || current === 'quality-reference-capture' || current === 'collection' || current === 'transformation-preview' || current === 'gallery' && routeParams().get('view') !== 'list' || current === 'home' || current === 'make' || current.startsWith('generated/') || current === 'compose' || current === 'trail' && routeParams().get('experience') === 'rio';
  document.documentElement.classList.toggle('rio-theme', rioTheme);
  document.body.classList.toggle('rio-theme', rioTheme);
  document.documentElement.classList.toggle('dusk-theme', rioTheme);
  document.body.classList.toggle('dusk-theme', rioTheme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f8f6f0');
  if (current === 'home') home();
  else if (current === 'make') instantCreatorPage(epoch);
  else if (current === 'transformation-preview') await transformationPreviewPage(epoch);
  else if (current === 'quality-comparison') await qualityComparisonPage(epoch);
  else if (current === 'paris-flight') await parisFlightPage(epoch);
  else if (current === 'paris-walk') await parisWalkPage(epoch);
  else if (current.startsWith('walk/')) await generatedWalkPage(decodeURIComponent(current.slice(5)), epoch);
  else if (current === 'quality-reference-capture') await qualityReferenceCapturePage(epoch);
  else if (current.startsWith('generated/')) await generatedGiftPage(decodeURIComponent(current.slice(10)), epoch);
  else if (current === 'compose') rioCreatorPage(epoch);
  else if (current === 'world') await worldPage(epoch);
  else if (current === 'trail' && routeParams().get('experience') === 'rio') rioGiftPage(epoch);
  else if (current === 'trail') await trailPage(epoch);
  else if (current === 'gallery') { if (routeParams().get('view') === 'list') await galleryList(epoch); else await collectionPage(epoch); }
  else if (current === 'collection') await collectionPage(epoch);
  else if (current === 'atlas') await atlas(epoch);
  else if (current === 'create') createPage();
  else if (current === 'about') about();
  else if (current.startsWith('demo-gift/')) demoGiftPage(decodeURIComponent(current.slice(10)), epoch);
  else if (current.startsWith('memory/')) await memoryPage(decodeURIComponent(current.slice(7)), epoch);
  else if (current.startsWith('gift/')) await giftPage(decodeURIComponent(current.slice(5)), epoch);
  else missing('We could not find this route.');
  if (epoch !== renderId) return;
  document.title = `GiftPortals — ${current === 'transformation-preview' ? 'A little transformation' : current === 'home' || current === 'trail' && routeParams().get('experience') === 'rio' ? 'A little piece of Rio' : current === 'make' || current === 'compose' ? 'Make a little world' : current.startsWith('generated/') ? 'A little world for you' : current === 'trail' ? 'Memory Studio' : current.startsWith('gift/') ? 'A memory for you' : current.startsWith('memory/') ? 'Memory detail' : current[0].toUpperCase() + current.slice(1)}`;
  window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', () => void render());
window.addEventListener('giftportals-session-changed', () => { resetKeepsakeSession(); world = null; currentGift = null; arrivals = []; trailState = null; trailScopeKey = ''; trailScopeEpoch++; draftInvitations.clear(); if (!session()) { privateRioSeed = null; rioCreatorDraft = newRioCreatorDraft(); } closeActiveDialog?.(); cleanup?.(); cleanup = null; cancelTrain(); void render(); });
window.addEventListener('pagehide', () => { cleanup?.(); cancelTrain(); });
window.addEventListener('pageshow', event => { if (event.persisted) void render(); });
void render();
void Promise.allSettled([api<StatusDTO>('status'), api<MemoryDTO[]>('demo')]).then((results) => {
  const statusResult = results[0]; if (statusResult.status === 'fulfilled') cloudStatus = statusResult.value; else staticDemo = true;
  const demoResult = results[1]; if (demoResult.status === 'fulfilled' && demoResult.value.length) { publicMemories = orderDemoMemories(demoResult.value.filter(memory => memory.demo)); if (!session()) world = null; }
  // The standalone Rio invitation has no cloud dependency; startup metadata must
  // not replace its active encounter or reset its local controls.
  const rioExperience = route() === 'trail' && routeParams().get('experience') === 'rio';
  if (!rioExperience && !app.querySelector('dialog[open]') && (route() === 'home' || (!session() && (['world', 'atlas', 'trail'].includes(route()) || route() === 'gallery' && routeParams().get('view') === 'list')))) void render();
});
