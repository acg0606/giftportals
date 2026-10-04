import { INSTANT_EXAMPLES, instantGiftReady, instantImagePlan, instantIntentExamples, instantJobFinished, instantModelReady, instantProviderLabel, readInstantJobReference, readInstantPendingReference, validateInstantPhoto, type InstantCreateInput, type InstantExample, type InstantJob, type InstantPhotoIntent, type InstantStatus } from './instant-creator-state';
import { mountGiftTransformation } from './gift-transformation';
import { giftTransformationState } from './gift-transformation-state';
import { mountGiftContext } from './gift-context';
import { giftPlacePrompt } from './gift-context-state';
import { CURIOSITY_REGIONS } from '../shared/gift-curiosities';
import {mountGiftCuriosities,type GiftCuriositiesHandle} from './gift-curiosities';
import type {InstantPhotoReport} from './instant-creator-state';
import { selectedCuriosities } from '../shared/gift-curiosities';
import { INSTANT_WIZARD_STEPS, appendInstantTranscript, instantDefaultWorldPrompt, instantJobConfirmedMissing, instantWizardCanCreate, instantWizardDestination, type InstantWizardStep } from './instant-wizard';
import { mountStoryAudio } from './story-audio';
import { giftIcon } from './gift-icon';

export type { InstantCreateInput, InstantJob, InstantStatus } from './instant-creator-state';
export type InstantJobReference = { id: string; token: string } | { dedupeKey: string; token: string };
export interface InstantCreatorService {
  status(signal: AbortSignal): Promise<InstantStatus>;
  create(input: InstantCreateInput, signal: AbortSignal): Promise<InstantJob>;
  job(reference: InstantJobReference, signal: AbortSignal): Promise<InstantJob>;
  triage?(imageDataUrl:string,signal:AbortSignal):Promise<InstantPhotoReport>;
}
export interface InstantCreatorOptions {
  isCurrent(): boolean;
  onHome(): void;
  onGiftReady(job: InstantJob): void;
  onExploreExample?(): void;
  service?: InstantCreatorService;
}
export interface InstantCreatorHandle { destroy(): void }

/** Validate trimmed text before any image preparation or generation request. */
export function validateInstantText(title: string, worldPrompt: string): { title: string; worldPrompt: string } {
  return {
    title: !title.trim() ? 'Give your little world a name.' : title.length > 120 ? 'Keep the gift name within 120 characters.' : '',
    worldPrompt: worldPrompt.trim().length < 8 ? 'Tell us a little more about the place, using at least 8 characters.' : worldPrompt.length > 1600 ? 'Keep the place description within 1,600 characters.' : '',
  };
}

/** Only known, completed public examples can appear as a ready gift link. */
export function instantReadyGiftHref(example: Pick<InstantExample, 'id' | 'readyGiftUrl'> | null): string | undefined {
  const routes: Record<string, string> = { rio: '#/generated/rio-example', paris: '#/generated/paris-example', antikythera: '#/generated/antikythera-example' };
  const route = example && Object.hasOwn(routes, example.id) ? routes[example.id] : undefined;
  return route && example?.readyGiftUrl === route ? route : undefined;
}

const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const storageKey = 'giftportals.instant.job.v1';
const pendingStorageKey = 'giftportals.instant.pending.v1';
const cameraIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5.5 9.5 3h5L16 5.5h4a1 1 0 0 1 1 1V20H3V6.5a1 1 0 0 1 1-1h4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12.5" r="4" stroke="currentColor" stroke-width="1.5"/></svg>';
const uploadIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V3m0 0L7 8m5-5 5 5M4 15v6h16v-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const objectIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 0v10m0 8v-8m-9-5 9 5 9-5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const placeIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="16.5" cy="7.5" r="1.5" stroke="currentColor" stroke-width="1.4"/><path d="m3 17 6-7 6 7 3-3 3 3" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const pinIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.5" stroke="currentColor" stroke-width="1.6"/></svg>';
const storyIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M21 4H3v13h4v4l5-4h9V4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 8h10M7 12h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const stepIcons: Record<InstantWizardStep, string> = { photo: cameraIcon, place: pinIcon, story: storyIcon, review: giftIcon };
const makeGiftLabel = `${giftIcon}Make my little world <span aria-hidden="true">↗</span>`;
const exampleChevron = (right: boolean) => `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${right ? 'm9 5 7 7-7 7' : 'm15 5-7 7 7 7'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

async function request<T>(action: string, signal: AbortSignal, body?: unknown, reference?: InstantJobReference): Promise<T> {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) abort.abort();
  const timeout = window.setTimeout(() => abort.abort(), body === undefined ? 25_000 : 190_000);
  try {
    const query = new URLSearchParams({ action, ...(reference ? 'id' in reference ? { id: reference.id } : { dedupeKey: reference.dedupeKey } : {}) });
    const response = await fetch(`/api/instant?${query}`, {
      method: body === undefined ? 'GET' : 'POST', signal: abort.signal,
      headers: { 'Content-Type': 'application/json', ...(reference ? { 'X-Instant-Token': reference.token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Object.assign(new Error(result.error?.message || 'This little world could not be reached. Please try again.'), { code: result.error?.code });
    return result.data as T;
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof Error && error.name !== 'AbortError' && !(error instanceof TypeError) && !(error instanceof SyntaxError)) throw error;
    throw new Error('Could not reach the creator. Your photo is still here. Please try again.');
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', onAbort); }
}

const cloudCreator = () => typeof location !== 'undefined' && Boolean(location.hostname) && !['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname.toLowerCase());
let cloudService: Promise<InstantCreatorService> | undefined;
const cloud = () => cloudService ??= import('./cloud-instant-service').then(module => module.createCloudInstantService());
export const instantCreatorService: InstantCreatorService = {
  status: async signal => cloudCreator() ? (await cloud()).status(signal) : request('status', signal),
  create: async (input, signal) => cloudCreator() ? (await cloud()).create(input, signal) : request('create', signal, input),
  job: async (reference, signal) => cloudCreator() ? (await cloud()).job(reference, signal) : request('job', signal, undefined, reference),
  ...(cloudCreator() ? {} : { triage: (imageDataUrl: string, signal: AbortSignal) => request<InstantPhotoReport>('triage', signal, {imageDataUrl}) }),
};

function fileDataUrl(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    const cleanup = () => signal.removeEventListener('abort', abort);
    reader.onload = () => { cleanup(); typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('The photo could not be read. Choose another image.')); };
    reader.onerror = () => { cleanup(); reject(new Error('The photo could not be read. Choose another image.')); };
    reader.onabort = () => { cleanup(); reject(new DOMException('The photo request was closed.', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { cleanup(); reject(new DOMException('The photo request was closed.', 'AbortError')); return; }
    reader.readAsDataURL(file);
  });
}

/** Camera originals are resized and reencoded; embedded photo metadata is not sent. */
async function preparedPhoto(file: File, signal: AbortSignal): Promise<File> {
  if (signal.aborted) throw new DOMException('The photo request was closed.', 'AbortError');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('This photo could not be opened. Choose a different JPG, PNG, or WebP image.'); }
  try {
    if (signal.aborted) throw new DOMException('The photo request was closed.', 'AbortError');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('This browser could not prepare your photo. Try another browser.');
    context.fillStyle = '#f7f4ec'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Your photo could not be prepared. Choose another image.')), 'image/jpeg', .86));
    if (signal.aborted) throw new DOMException('The photo request was closed.', 'AbortError');
    const ready = new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' });
    const issue = validateInstantPhoto(ready, 3 * 1024 * 1024); if (issue) throw new Error(issue);
    return ready;
  } finally { bitmap.close(); }
}

function newRequestToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Starts from a photo, with no account step. Every generation state comes from the real service. */
export function mountInstantCreator(host: HTMLElement, options: InstantCreatorOptions): InstantCreatorHandle {
  const service = options.service || instantCreatorService;
  const events = new AbortController();
  let dead = false, submitting = false, readingSource = false, status: InstantStatus | null = null, currentJob: InstantJob | null = null;
  let source: File | InstantExample | null = null, placePhoto: File | null = null, previewUrl: string | null = null, placePreviewUrl: string | null = null;
  let pollTimer: number | undefined, dedupeKey = '', requestToken = '', sourceEpoch = 0, intent: InstantPhotoIntent = 'object';
  let previewViewer: { destroy(): void; reset(): void; setWireframe(enabled: boolean): void; setAutoRotate(enabled: boolean): void } | undefined, previewOpen = false, previewAttempt = 0;
  let attemptedModel = '', revealTimer: number | undefined;
  let cameraDialog: { destroy(): void } | undefined, cameraAttempt = 0;
  let storyAudio: ReturnType<typeof mountStoryAudio> | undefined;
  let step: InstantWizardStep = 'photo', confirmingJob = false;
  let pendingReference: InstantJobReference | null = null;
  const editedWords = new Set<string>();
  const active = () => !dead && host.isConnected && options.isCurrent();
  const examples = () => instantIntentExamples(INSTANT_EXAMPLES, intent);
  host.className = 'instant-creator';
  host.innerHTML = `<header class="instant-topline"><a href="#/home" class="instant-brand" aria-label="GiftPortals home"><img src="/assets/portal-dusk/brand-mark.png" alt=""/>GiftPortals</a><button type="button" class="instant-back" data-instant-home>Back</button></header>
    <main class="instant-layout">
      <section class="instant-intro" aria-labelledby="instant-title"><span class="instant-eyebrow">A LITTLE THING. A WHOLE WORLD.</span><h1 id="instant-title"><span class="instant-title-gift" aria-hidden="true">${giftIcon}</span>What will you<br/>turn into a gift?</h1><p>A photo becomes a keepsake.<br/>Your story becomes a place they can step into.</p><div class="instant-art" aria-hidden="true"><img class="instant-art-bg" src="/assets/portal-dusk/welcome-bg.webp" alt=""/><img class="instant-art-object" src="/assets/portal-dusk/rio-keepsake.png" alt=""/></div><p class="instant-intro-foot">Made with Tripo + World Labs.</p></section>
      <section class="instant-workspace" aria-label="Make your little world">
        <form data-instant-form novalidate>
          <nav class="instant-wizard-progress" aria-label="Gift creation steps"><ol>${INSTANT_WIZARD_STEPS.map((name, index) => `<li data-instant-step-marker="${name}"><span aria-hidden="true">${stepIcons[name]}</span><strong>${index + 1}. ${name === 'photo' ? 'Photo' : name === 'place' ? 'Place' : name === 'story' ? 'Story' : 'Review'}</strong></li>`).join('')}</ol><p data-instant-step-status role="status" aria-live="polite">Step 1 of 4 · Photo</p></nav>
          <fieldset class="instant-inputs" data-instant-inputs><legend class="instant-sr-only">Your gift and the place inside</legend>
            <section class="instant-source instant-wizard-card" data-instant-step="photo" aria-labelledby="instant-photo-heading"><div class="instant-section-heading"><span class="instant-step" aria-hidden="true">${cameraIcon}</span><h2 id="instant-photo-heading" tabindex="-1">Start with something small.</h2></div><p data-instant-photo-hint>One clear photo of an object you love.</p>
              <div class="instant-intents" role="group" aria-label="What is in your photo?"><button type="button" data-instant-intent="object" aria-pressed="true">${objectIcon}<span><strong>An object</strong><small>Make a keepsake</small></span></button><button type="button" data-instant-intent="place" aria-pressed="false">${placeIcon}<span><strong>A place</strong><small>Make a miniature</small></span></button></div>
              <div class="instant-upload"><button type="button" class="instant-camera" data-instant-camera>${cameraIcon}<span>Take a photo</span></button><button type="button" class="instant-upload-button" data-instant-upload>${uploadIcon}<span>Choose a photo</span></button></div>
              <input class="instant-sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose your gift photo" data-instant-upload-file tabindex="-1"/>
              <div class="instant-selected" data-instant-selected hidden><img data-instant-photo alt="Your selected gift photo"/><span><strong data-instant-source-name></strong><small data-instant-source-hint>A photo to turn into your 3D keepsake.</small><a class="instant-ready-example" data-instant-ready-example hidden>${giftIcon}Explore this gift <span aria-hidden="true">↗</span></a></span><button type="button" data-instant-change aria-label="Choose a different gift photo">Change</button></div>
              <div class="instant-examples"><span>Or start with a little inspiration</span><nav class="instant-example-categories" aria-label="Inspiration categories"><button type="button" data-instant-catalog="cities" aria-pressed="false">${placeIcon}<span>Cities <small>5</small></span></button><button type="button" data-instant-catalog="objects" aria-pressed="true">${objectIcon}<span>Human ingenuity <small>5</small></span></button></nav><p class="instant-example-caption" data-instant-example-caption>Original artistic references · choose one to make it yours</p><div class="instant-example-navigation"><span>Explore all 5</span><div><button type="button" data-instant-examples-prev aria-label="Previous examples" title="Previous examples">${exampleChevron(false)}</button><button type="button" data-instant-examples-next aria-label="More examples" title="More examples">${exampleChevron(true)}</button></div></div><div data-instant-examples aria-label="Choose an inspiration"></div></div>
            </section>
            <section class="instant-story instant-wizard-card" data-instant-step="place" hidden aria-labelledby="instant-world-heading"><div class="instant-section-heading"><span class="instant-step" aria-hidden="true">${pinIcon}</span><h2 id="instant-world-heading" tabindex="-1">A place to step into.</h2></div><p class="instant-card-copy">Optional. Choose a place, or continue with our gentle setting.</p><div data-instant-context></div><details class="instant-place-custom"><summary>Customize the world <span>optional</span></summary><div><label class="instant-field" for="instant-world">The place inside<textarea id="instant-world" name="worldPrompt" maxlength="1600" rows="3" placeholder="A quiet garden at dusk, warm lanterns, a little bench by the water…"></textarea></label><small class="instant-hint">Your photo and this description guide its imagined world.</small>
              <div class="instant-place-reference"><button type="button" data-instant-place-upload>${uploadIcon}<span>Add a place photo <small>optional</small></span></button><input class="instant-sr-only" type="file" accept="image/jpeg,image/png,image/webp" data-instant-place-file aria-label="Choose an optional place photo" tabindex="-1"/><div data-instant-place-selected hidden><img data-instant-place-photo alt="Your optional place reference"/><span data-instant-place-name></span><button type="button" data-instant-place-remove aria-label="Remove place photo">Remove</button></div></div>
              </div></details>
            </section>
            <section class="instant-story instant-wizard-card" data-instant-step="story" hidden aria-labelledby="instant-story-heading"><div class="instant-section-heading"><span class="instant-step" aria-hidden="true">${storyIcon}</span><h2 id="instant-story-heading" tabindex="-1">What makes it yours?</h2></div><p class="instant-card-copy">Optional. Write a memory, tell it in your own voice, or keep it simple.</p><div data-instant-audio></div><label class="instant-field" for="instant-story">The story waiting inside<textarea id="instant-story" name="story" maxlength="1200" rows="3" placeholder="Tell them what makes this moment yours."></textarea></label>
              <details class="instant-personal"><summary>${giftIcon}Gift name &amp; personal note <span>optional</span></summary><div><label class="instant-field" for="instant-name">Name your gift<input id="instant-name" name="title" maxlength="120" value="A little world for you" required/></label><div class="instant-names"><label class="instant-field" for="instant-from">From<input id="instant-from" name="senderName" maxlength="80" placeholder="Your name" autocomplete="given-name"/></label><label class="instant-field" for="instant-to">To<input id="instant-to" name="recipientName" maxlength="80" placeholder="Someone special" autocomplete="off"/></label></div><label class="instant-field" for="instant-note">A note on the gift<textarea id="instant-note" name="dedication" maxlength="280" rows="2" placeholder="This made me think of you."></textarea></label></div></details>
              <details class="instant-curiosity-panel"><summary>Add a curiosity <span>optional</span></summary><div data-instant-curiosities></div></details>
            </section>
            <section class="instant-story instant-wizard-card instant-review" data-instant-step="review" hidden aria-labelledby="instant-review-heading"><div class="instant-section-heading"><span class="instant-step" aria-hidden="true">${giftIcon}</span><h2 id="instant-review-heading" tabindex="-1">Ready to make it real?</h2></div><p class="instant-card-copy">Check what will go into your gift. Nothing is created until you choose below.</p>
              <article class="instant-review-photo"><img data-instant-review-photo alt="The original photo for this gift"/><img data-instant-review-miniature alt="Approved miniature reference for the 3D souvenir" hidden/><div><span data-instant-review-intent></span><strong data-instant-review-source></strong><small data-instant-review-representation></small></div><button type="button" data-instant-edit-step="photo">Edit photo</button></article>
              <article class="instant-review-block"><div><h3>The place inside</h3><button type="button" data-instant-edit-step="place">Edit place</button></div><p data-instant-review-world></p><div class="instant-review-reference" data-instant-review-reference hidden><img data-instant-review-place-photo alt="The image guiding the world"/><span data-instant-review-place-name></span><button type="button" data-instant-review-place-remove hidden>Remove</button></div><small data-instant-review-location></small></article>
              <article class="instant-review-block"><div><h3>Your words</h3><button type="button" data-instant-edit-step="story">Edit story</button></div><dl><dt>Gift name</dt><dd data-instant-review-title></dd><dt>From / To</dt><dd data-instant-review-names></dd><dt>Note on the gift</dt><dd data-instant-review-dedication></dd><dt>Story</dt><dd data-instant-review-story></dd></dl><div data-instant-review-curiosities hidden></div></article>
              <label class="instant-consent"><input type="checkbox" name="consent" required/><span>I can use these photos and send the approved photos and my place description to Tripo and World Labs to create this gift.</span></label><small class="instant-hint">Intimate images and adult products cannot be used. Every photo is screened before 3D generation.${cloudCreator() ? ' Private photos and generated gifts expire after 7 days. Anyone with the gift link can open it during that time.' : ''}</small>
            </section>
          </fieldset>
          <p class="instant-error" data-instant-error role="alert" hidden></p>
          <div class="instant-wizard-actions"><button class="instant-wizard-back" type="button" data-instant-step-back hidden>← Back</button><button class="instant-primary" type="button" data-instant-continue>Continue <span aria-hidden="true">→</span></button><div class="instant-create-actions" data-instant-actions hidden><button class="instant-primary" type="submit" data-instant-create>${makeGiftLabel}</button><button class="instant-secondary" type="button" data-instant-recover hidden>Check this creation</button><small data-instant-availability>Checking the creator…</small></div></div>
        </form>
        <section class="instant-progress" data-instant-progress hidden aria-labelledby="instant-progress-heading"><span class="instant-eyebrow">YOUR GIFT IS TAKING SHAPE</span><h2 id="instant-progress-heading" tabindex="-1">A little world,<br/>just for them.</h2>
          <div data-instant-transformation></div>
          <section class="instant-model-preview" data-instant-model-preview hidden aria-label="Your completed 3D keepsake"><div><span>${objectIcon}<strong>Your keepsake is ready.</strong></span><button type="button" data-instant-preview-toggle>Reset 3D view ↺</button></div><p class="instant-model-load" data-instant-preview-load role="status" hidden>Opening your 3D keepsake…</p><small data-instant-preview-note>Drag to turn it. Pinch or scroll to bring it closer.</small></section>
          <ol aria-label="Generation progress"><li data-instant-provider="tripo"><span class="instant-provider-dot" aria-hidden="true"></span><div><strong data-instant-tripo-label></strong><small>Tripo · 3D keepsake</small></div></li><li data-instant-provider="worldlabs"><span class="instant-provider-dot" aria-hidden="true"></span><div><strong data-instant-worldlabs-label></strong><small>World Labs · spatial world</small></div></li></ol><p class="instant-progress-status" data-instant-job-status role="status" aria-live="polite"></p><button class="instant-primary" type="button" data-instant-open hidden>${giftIcon}Open your gift <span aria-hidden="true">↗</span></button><button class="instant-secondary" type="button" data-instant-recheck hidden>Check again</button><button class="instant-secondary" type="button" data-instant-edit hidden>${giftIcon}Start a different gift</button><small data-instant-job-note>Creating a world can take a few minutes. Your original photo stays available.</small></section>
        <div class="instant-unavailable" data-instant-unavailable hidden><p>Live creation is taking a pause. You can still choose your photo and write your story.</p><button class="instant-secondary" type="button" data-instant-status-retry>Check the creator again</button>${options.onExploreExample ? `<button class="instant-secondary" type="button" data-instant-explore>${giftIcon}Step into a ready-made gift ↗</button>` : ''}</div>
      </section>
    </main>`;

  const form = host.querySelector<HTMLFormElement>('[data-instant-form]')!;
  const inputs = host.querySelector<HTMLFieldSetElement>('[data-instant-inputs]')!;
  const create = host.querySelector<HTMLButtonElement>('[data-instant-create]')!;
  const error = host.querySelector<HTMLElement>('[data-instant-error]')!;
  const actions = host.querySelector<HTMLElement>('[data-instant-actions]')!;
  const progress = host.querySelector<HTMLElement>('[data-instant-progress]')!;
  const unavailable = host.querySelector<HTMLElement>('[data-instant-unavailable]')!;
  const transformation = mountGiftTransformation(host.querySelector<HTMLElement>('[data-instant-transformation]')!, {
    isCurrent: () => active() && !progress.hidden,
    onOpenKeepsake: () => void openModelPreview(),
  });
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
  let appliedPlaceSentence = '', photoDecision:'allow'|'block'|'review'|undefined;
  let giftCuriosities:GiftCuriositiesHandle|undefined;
  const giftContext = mountGiftContext(host.querySelector<HTMLElement>('[data-instant-context]')!, {
    presentation: 'step',
    cities: CURIOSITY_REGIONS,
    onChange: context => {
      if (submitting || currentJob || pendingReference) return; changeKey();giftCuriosities?.refreshRegion();
      if (!context.includeInStory && appliedPlaceSentence) { const merged = giftPlacePrompt(field('worldPrompt').value, '', appliedPlaceSentence); field('worldPrompt').value = merged.prompt; appliedPlaceSentence = ''; }
    },
    onApply: context => {
      if (submitting || currentJob || pendingReference || !context.includeInStory || !context.placeLabel) return;
      const merged = giftPlacePrompt(field('worldPrompt').value, context.placeLabel, appliedPlaceSentence);
      if (merged.prompt.length > 1600) { showError('Make a little room in the place description before adding this context.'); return; }
      field('worldPrompt').value = merged.prompt; appliedPlaceSentence = merged.sentence; changeKey();
    },
  });
  const text = (selector: string, value: string) => { host.querySelector<HTMLElement>(selector)!.textContent = value; };
  const on = (selector: string, callback: (event: Event) => void) => host.querySelectorAll<HTMLElement>(selector).forEach(element => element.addEventListener('click', callback, { signal: events.signal }));
  function showError(message = '') { error.textContent = message; error.hidden = !message; }
  function releasePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; }
  function changeKey() {
    if (pendingReference) return;
    dedupeKey = ''; requestToken = ''; (field('consent') as HTMLInputElement).checked = false;
    try { sessionStorage.removeItem(pendingStorageKey); } catch { /* Open editing remains available. */ }
    // Optional controllers finish their own selection/context mutation after
    // invoking callbacks. Review reads the final values at the next microtask.
    queueMicrotask(() => { if (active() && step === 'review' && !submitting && !currentJob && !pendingReference) reviewGift(); });
  }
  const wizardBusy = () => submitting || Boolean(currentJob) || confirmingJob || Boolean(pendingReference) || inputs.disabled;
  function reviewGift() {
    const canReview = Boolean(source);
    host.querySelectorAll<HTMLElement>('.instant-review-photo,.instant-review-block,.instant-review .instant-consent,.instant-review > .instant-hint').forEach(element => element.hidden = !canReview);
    text('#instant-review-heading', pendingReference && !source ? 'Checking your last gift.' : 'Ready to make it real?');
    text('.instant-review > .instant-card-copy', pendingReference && !source ? 'Your previous creation may still be running. Check it before starting another gift.' : 'Check what will go into your gift. Nothing is created until you choose below.');
    const chosenPhoto = host.querySelector<HTMLImageElement>('[data-instant-photo]')!;
    host.querySelector<HTMLImageElement>('[data-instant-review-photo]')!.src = chosenPhoto.src;
    text('[data-instant-review-source]', source instanceof File ? source.name || 'Your photo' : source?.title || 'Your photo');
    text('[data-instant-review-intent]', intent === 'place' ? 'A place' : 'An object');
    const miniatureReference = intent === 'place' && source && !(source instanceof File) && source.objectImageRole === 'miniature-reference' ? source.objectImageUrl : undefined;
    text('[data-instant-review-representation]', intent === 'place' ? miniatureReference ? 'The matching miniature reference guides your 3D souvenir.' : 'Your place inspires a small 3D souvenir. The original photo guides its world.' : 'Your photo guides the 3D keepsake.');
    const referencePreview = host.querySelector<HTMLImageElement>('[data-instant-review-miniature]')!;
    referencePreview.hidden = !miniatureReference;
    if (miniatureReference) referencePreview.src = miniatureReference; else referencePreview.removeAttribute('src');
    text('[data-instant-review-world]', field('worldPrompt').value.trim());
    const chosen = source;
    const defaultPlace = intent === 'object' && chosen && !(chosen instanceof File) ? chosen.worldImageUrl || INSTANT_EXAMPLES.find(example => example.id === chosen.id)?.worldImageUrl : undefined;
    const referenceUrl = placePreviewUrl || (intent === 'place' ? chosenPhoto.src : defaultPlace);
    host.querySelector<HTMLElement>('[data-instant-review-reference]')!.hidden = !referenceUrl;
    host.querySelector<HTMLButtonElement>('[data-instant-review-place-remove]')!.hidden = !placePhoto;
    if (referenceUrl) host.querySelector<HTMLImageElement>('[data-instant-review-place-photo]')!.src = referenceUrl;
    text('[data-instant-review-place-name]', placePhoto ? `World reference: ${placePhoto.name || 'Your place photo'}` : intent === 'place' ? 'Your original place photo guides the world.' : defaultPlace ? 'The matching example place photo guides the world.' : 'The place description guides the world.');
    const context = giftContext.getContext();
    text('[data-instant-review-location]', context.includeInStory && appliedPlaceSentence ? 'Your chosen place is included in the description above.' : 'Location is not added to the world description.');
    text('[data-instant-review-title]', field('title').value.trim());
    text('[data-instant-review-names]', `${field('senderName').value.trim() || 'Not added'} / ${field('recipientName').value.trim() || 'Not added'}`);
    text('[data-instant-review-dedication]', field('dedication').value.trim() || 'Not added');
    text('[data-instant-review-story]', field('story').value.trim() || 'Not added');
    const facts = selectedCuriosities(giftCuriosities?.selectedIds() || []), list = host.querySelector<HTMLElement>('[data-instant-review-curiosities]')!;
    list.replaceChildren(); list.hidden = !facts.length;
    for (const fact of facts) {
      const card = document.createElement('article'), label = document.createElement('small'), title = document.createElement('strong'), body = document.createElement('p'), link = document.createElement('a');
      label.textContent = 'Historical context'; title.textContent = fact.title; body.textContent = fact.text;
      link.textContent = `${fact.sourceTitle} ↗`; link.href = fact.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
      card.append(label, title, body, link); list.append(card);
    }
  }
  function renderWizard(focus = false) {
    const index = INSTANT_WIZARD_STEPS.indexOf(step), locked = wizardBusy();
    host.dataset.instantStep = step;
    for (const card of host.querySelectorAll<HTMLElement>('[data-instant-step]')) card.hidden = card.dataset.instantStep !== step;
    for (const marker of host.querySelectorAll<HTMLElement>('[data-instant-step-marker]')) {
      const markerIndex = INSTANT_WIZARD_STEPS.indexOf(marker.dataset.instantStepMarker as InstantWizardStep);
      marker.dataset.state = markerIndex === index ? 'active' : markerIndex < index ? 'done' : 'next';
      if (markerIndex === index) marker.setAttribute('aria-current', 'step'); else marker.removeAttribute('aria-current');
    }
    text('[data-instant-step-status]', `Step ${index + 1} of 4 · ${['Photo', 'Place · optional', 'Story · optional', 'Review'][index]}`);
    const back = host.querySelector<HTMLButtonElement>('[data-instant-step-back]')!, next = host.querySelector<HTMLButtonElement>('[data-instant-continue]')!;
    back.hidden = step === 'photo'; back.disabled = locked;
    next.hidden = step === 'review'; next.disabled = locked || !source;
    next.innerHTML = `${step === 'story' ? `${giftIcon}Review my gift` : 'Continue'} <span aria-hidden="true">→</span>`;
    actions.hidden = step !== 'review';
    const recover = host.querySelector<HTMLButtonElement>('[data-instant-recover]')!;
    recover.hidden = !pendingReference; recover.disabled = confirmingJob || submitting;
    host.querySelectorAll<HTMLButtonElement>('[data-instant-edit-step]').forEach(button => button.disabled = locked);
    if (step === 'review') reviewGift();
    if (focus) {
      const card = host.querySelector<HTMLElement>(`[data-instant-step="${step}"]`)!;
      card.scrollTop = 0; card.querySelector<HTMLElement>('h2')!.focus({ preventScroll: true });
    }
  }
  function goToStep(next: InstantWizardStep) {
    if (!active() || wizardBusy() || next !== 'photo' && !source) return;
    storyAudio?.stop(); cameraAttempt++; cameraDialog?.destroy(); cameraDialog = undefined;
    step = next; showError(); renderWizard(true); availability();
  }
  function continueWizard() {
    if (!source) { showError('Choose a photo to continue.'); return; }
    if (step === 'place') {
      if (!field('worldPrompt').value.trim()) { field('worldPrompt').value = instantDefaultWorldPrompt(intent); appliedPlaceSentence = ''; changeKey(); }
      const issue = validateInstantText(field('title').value, field('worldPrompt').value).worldPrompt;
      field('worldPrompt').setCustomValidity(issue);
      if (issue) { host.querySelector<HTMLDetailsElement>('.instant-place-custom')!.open = true; field('worldPrompt').reportValidity(); return; }
    }
    goToStep(instantWizardDestination(step, 1, Boolean(source)));
  }
  function availability() {
    create.disabled = wizardBusy() || readingSource || step !== 'review' || !source || !status?.available || photoDecision==='block' || photoDecision==='review';
    text('[data-instant-availability]', pendingReference ? 'Confirming the last creation before starting another gift.' : photoDecision==='block'||photoDecision==='review' ? 'Choose another photo before creating your gift.' : status?.safety && !status.safety.available ? 'Photo checking is unavailable. Creation will wait until it is ready.' : status?.available ? 'Photos are screened before Tripo + World Labs. No account needed.' : 'Live creation is currently unavailable.');
    unavailable.hidden = Boolean(status?.available) || Boolean(currentJob);
    renderWizard();
  }
  function updateExamples() {
    const list = host.querySelector<HTMLElement>('[data-instant-examples]')!;
    const category = intent === 'place' ? 'cities' : 'objects', scroll = list.dataset.category === category ? list.scrollLeft : 0;
    list.dataset.category = category;
    list.replaceChildren();
    host.querySelectorAll<HTMLButtonElement>('[data-instant-catalog]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.instantCatalog === (intent === 'place' ? 'cities' : 'objects'))));
    for (const example of examples()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'instant-example';
      button.setAttribute('aria-pressed', String(!(source instanceof File) && source?.id === example.id));
      button.setAttribute('data-instant-example', example.id);
      button.innerHTML = `<img src="${esc(example.imageUrl)}" alt="" loading="lazy"/><span>${esc(example.title)}<small>${esc(example.caption || 'Artistic reference')}</small></span>`;
      button.addEventListener('click', () => selectSource(example), { signal: events.signal }); list.append(button);
    }
    list.scrollLeft = scroll; syncExampleNavigation();
  }
  function syncExampleNavigation() {
    if (!active()) return;
    const rail = host.querySelector<HTMLElement>('[data-instant-examples]')!;
    host.querySelector<HTMLButtonElement>('[data-instant-examples-prev]')!.disabled = rail.scrollLeft <= 2;
    host.querySelector<HTMLButtonElement>('[data-instant-examples-next]')!.disabled = rail.scrollWidth - rail.clientWidth - rail.scrollLeft <= 2;
  }
  function scrollExamples(direction: number) {
    if (!active()) return;
    const rail = host.querySelector<HTMLElement>('[data-instant-examples]')!;
    rail.scrollBy({ left: direction * Math.max(135, rail.clientWidth * .85), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    syncExampleNavigation();
  }
  function updateIntent(next: InstantPhotoIntent) {
    if (!active() || wizardBusy() || next === intent) return;
    intent = next; changeKey(); showError();
    host.dataset.photoIntent = intent;
    host.querySelectorAll<HTMLButtonElement>('[data-instant-intent]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.instantIntent === intent)));
    text('#instant-photo-heading', intent === 'place' ? 'Start with a place you love.' : 'Start with something small.');
    text('[data-instant-photo-hint]', intent === 'place' ? 'A little 3D souvenir, with your place inside.' : 'One clear photo of an object you love.');
    text('[data-instant-source-hint]', intent === 'place' ? 'Your place, made into a small 3D souvenir.' : 'A photo to turn into your 3D keepsake.');
    if (source instanceof File && !editedWords.has('worldPrompt')) { field('worldPrompt').value = instantDefaultWorldPrompt(intent); appliedPlaceSentence = ''; }
    if (source && !(source instanceof File)) {
      const nextExample = examples().find(example => example.id === (source as InstantExample).id);
      if (nextExample) selectSource(nextExample, true);
      else { source = null; sourceEpoch++; releasePreview(); giftCuriosities?.reset(); host.querySelector<HTMLElement>('[data-instant-selected]')!.hidden = true; step = 'photo'; availability(); }
    }
    updateExamples();
  }
  function selectSource(next: File | InstantExample, keepWords = false) {
    if (!active() || wizardBusy()) return;
    if (!(next instanceof File) && next.photoIntent && next.photoIntent !== intent) updateIntent(next.photoIntent);
    sourceEpoch++; releasePreview(); source = next; changeKey(); showError();giftCuriosities?.reset();
    const image = host.querySelector<HTMLImageElement>('[data-instant-photo]')!;
    const readyLink = host.querySelector<HTMLAnchorElement>('[data-instant-ready-example]')!;
    const readyHref = instantReadyGiftHref(next instanceof File ? null : next);
    readyLink.hidden = !readyHref;
    if (readyHref) readyLink.setAttribute('href', readyHref); else readyLink.removeAttribute('href');
    const defaults = next instanceof File ? { worldPrompt: instantDefaultWorldPrompt(intent), title: 'A little world for you', story: '' } : { worldPrompt: next.worldPrompt, title: `${next.title}, for you`, story: next.story || '' };
    if (!keepWords) for (const name of ['worldPrompt', 'title', 'story'] as const) if (!editedWords.has(name)) { field(name).value = defaults[name]; if (name === 'worldPrompt') appliedPlaceSentence = ''; }
    if (next instanceof File) { previewUrl = URL.createObjectURL(next); image.src = previewUrl; text('[data-instant-source-name]', next.name || 'Your photo'); }
    else { image.src = next.imageUrl; text('[data-instant-source-name]', next.title); giftCuriosities?.preset({ objectHint: next.objectHint, regionId: next.regionId, factIds: next.curiosityIds || [], story: next.story || 'A little inspiration, ready for your own story.' }); }
    host.querySelector<HTMLElement>('[data-instant-selected]')!.hidden = false;
    updateExamples(); availability();
  }
  function closeModelPreview() {
    clearTimeout(revealTimer); revealTimer = undefined;
    previewOpen = false; previewAttempt++; previewViewer?.destroy(); previewViewer = undefined;
    transformation.setModelVisible(false); transformation.modelHost.replaceChildren();
    const load = host.querySelector<HTMLElement>('[data-instant-preview-load]'); if (load) load.hidden = true;
  }
  async function openModelPreview() {
    const job = currentJob;
    if (!active() || !job || !instantModelReady(job) || !job.assets.modelUrl) return;
    if (previewOpen) { previewViewer?.reset(); return; }
    const attempt = ++previewAttempt, modelUrl = job.assets.modelUrl;
    const current = () => active() && previewOpen && previewAttempt === attempt && currentJob?.id === job.id && currentJob?.assets.modelUrl === modelUrl;
    const canvas = transformation.modelHost;
    const load = host.querySelector<HTMLElement>('[data-instant-preview-load]')!;
    previewOpen = true; load.hidden = false; load.textContent = 'Opening your 3D keepsake…';
    text('[data-instant-preview-note]', 'Drag to turn it. Pinch or scroll to bring it closer.');
    try {
      const module = await import('./scene'); if (!current()) return;
      let failed = false;
      const handle = module.mountMemoryScene(canvas, {
        modelUrl, theme: 'dusk', backgroundUrl: job.assets.photoUrl,
        photoIntent: job.photoIntent, objectRepresentation: job.objectRepresentation, modelYaw: job.modelYaw, photoUrl: job.assets.photoUrl,
        onReady: () => {
          if (!current()) return;
          transformation.setModelVisible(true); load.hidden = true;
          const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
          previewViewer?.setAutoRotate(!reduced);
          if (!reduced) {
            previewViewer?.setWireframe(true);
            revealTimer = window.setTimeout(() => { if (current()) previewViewer?.setWireframe(false); }, 1400);
          }
        },
        onProgress: value => { if (current()) load.textContent = value.phase === 'decoding' ? 'Unwrapping its shape and color…' : 'Opening your 3D keepsake…'; },
        onError: () => { if (!current()) return; failed = true; closeModelPreview(); text('[data-instant-preview-note]', 'The 3D preview could not open here. Choose Reveal 3D keepsake to try opening it again.'); },
      });
      if (!current() || failed) { handle.destroy(); return; }
      previewViewer = handle;
    } catch { if (current()) { closeModelPreview(); text('[data-instant-preview-note]', 'The 3D preview could not open here. Your photo stays available.'); } }
  }
  function acceptFile(file: File | undefined, place = false) {
    if (!file || !active() || wizardBusy()) return;
    const issue = validateInstantPhoto(file, 20 * 1024 * 1024); if (issue) { showError(issue); return; }
    if (!place) { selectSource(file); return; }
    if (placePreviewUrl) URL.revokeObjectURL(placePreviewUrl);
    placePhoto = file; placePreviewUrl = URL.createObjectURL(file); changeKey(); showError();
    host.querySelector<HTMLImageElement>('[data-instant-place-photo]')!.src = placePreviewUrl;
    text('[data-instant-place-name]', file.name || 'Your place photo'); host.querySelector<HTMLElement>('[data-instant-place-selected]')!.hidden = false;
  }
  function takeFile(input: HTMLInputElement, place = false) {
    const file = input.files?.[0]; input.value = ''; acceptFile(file, place);
  }
  async function openCamera() {
    if (!active() || wizardBusy() || step !== 'photo' || cameraDialog) return;
    const attempt = ++cameraAttempt;
    try {
      const { mountInstantCamera } = await import('./instant-camera');
      if (!active() || wizardBusy() || step !== 'photo' || attempt !== cameraAttempt) return;
      let closedDuringMount = false;
      const handle = mountInstantCamera({
        isCurrent: () => active() && !wizardBusy() && step === 'photo',
        onPhoto: file => acceptFile(file),
        onChoosePhoto: () => host.querySelector<HTMLInputElement>('[data-instant-upload-file]')!.click(),
        onClose: () => { closedDuringMount = true; cameraDialog = undefined; },
      });
      if (!closedDuringMount) cameraDialog = handle;
    } catch { if (active()) showError('The camera could not open here. Choose a photo to continue.'); }
  }
  function remember(job: InstantJob) { try { sessionStorage.setItem(storageKey, JSON.stringify({ id: job.id, token: job.token })); sessionStorage.removeItem(pendingStorageKey); } catch { /* The open session can continue without browser storage. */ } }
  async function confirmPending(originalMessage = '') {
    const reference = pendingReference;
    if (!active() || !reference || confirmingJob) return;
    confirmingJob = true; inputs.disabled = true; storyAudio?.stop(); availability();
    try {
      const job = await service.job(reference, events.signal);
      if (!active() || pendingReference !== reference) return;
      showJob(job); schedulePoll();
    } catch (cause) {
      if (!active() || pendingReference !== reference) return;
      if (instantJobConfirmedMissing(cause)) {
        pendingReference = null; inputs.disabled = false;
        try { sessionStorage.removeItem(storageKey); } catch { /* This session can still continue. */ }
        changeKey(); if (!source) step = 'photo';
        showError(originalMessage || 'No previous creation was found. You can continue with your gift.');
      } else {
        showError('We could not confirm your last creation. Check it again before editing or starting another gift; your recovery details are kept.');
      }
    } finally { if (active()) { confirmingJob = false; inputs.disabled = Boolean(pendingReference); availability(); } }
  }
  function showJob(job: InstantJob) {
    if (!active()) return;
    storyAudio?.stop(); pendingReference = null; confirmingJob = false;
    if (currentJob && (currentJob.id !== job.id || currentJob.assets.modelUrl !== job.assets.modelUrl)) { closeModelPreview(); attemptedModel = ''; }
    currentJob = job; remember(job); form.hidden = true; progress.hidden = false; unavailable.hidden = true;
    const modelReady = instantModelReady(job), visual = giftTransformationState(job);
    progress.dataset.jobState = job.state;
    transformation.update(visual);
    host.querySelector<HTMLElement>('[data-instant-model-preview]')!.hidden = !modelReady;
    if (!modelReady && previewOpen) closeModelPreview();
    for (const provider of ['tripo', 'worldlabs'] as const) {
      host.querySelector<HTMLElement>(`[data-instant-provider="${provider}"]`)!.dataset.state = job[provider].state;
      text(`[data-instant-${provider}-label]`, instantProviderLabel(provider, job[provider].state, provider === 'tripo' ? job.tripoReference?.state : undefined, job[provider].errorCode || (provider === 'tripo' ? job.tripoReference?.errorCode : undefined)));
    }
    const ready = instantGiftReady(job), finished = instantJobFinished(job);
    host.querySelector<HTMLButtonElement>('[data-instant-open]')!.hidden = !ready;
    host.querySelector<HTMLButtonElement>('[data-instant-edit]')!.hidden = !finished;
    host.querySelector<HTMLButtonElement>('[data-instant-recheck]')!.hidden = true;
    const worldStillCreating = job.worldlabs.state === 'pending' || job.worldlabs.state === 'processing';
    text('[data-instant-job-status]', ready ? 'Your photo became a keepsake. Your story has a world to live in.' : visual.phase === 'interrupted' ? worldStillCreating ? 'The keepsake needs attention. Your little world is still being created.' : 'This gift is unfinished. Your photo is safe; one or more parts need attention.' : 'Both parts are being made from your photo and your place.');
    text('[data-instant-job-note]', ready ? 'Open it, turn the keepsake, then step into the place inside.' : finished ? 'No automatic retry is started. You can keep these details and choose a different gift.' : 'Creating a world can take a few minutes. Returning to this creator in this browser restores the job.');
    if (finished) { clearTimeout(pollTimer); pollTimer = undefined; }
    const modelKey = `${job.id}:${job.assets.modelUrl}`;
    if (modelReady && !previewOpen && attemptedModel !== modelKey) { attemptedModel = modelKey; void openModelPreview(); }
  }
  function schedulePoll() { if (active() && currentJob && !instantJobFinished(currentJob)) { clearTimeout(pollTimer); pollTimer = window.setTimeout(() => void poll(), 4_000); } }
  async function poll() {
    if (!active() || !currentJob) return;
    const reference = { id: currentJob.id, token: currentJob.token };
    try { const job = await service.job(reference, events.signal); if (!active() || currentJob?.id !== reference.id) return; showJob(job); schedulePoll(); }
    catch (cause) { if (!active()) return; text('[data-instant-job-status]', cause instanceof Error ? cause.message : 'Could not check this gift. Check again to resume.'); host.querySelector<HTMLButtonElement>('[data-instant-recheck]')!.hidden = false; }
  }
  async function loadStatus() {
    if (!active()) return;
    text('[data-instant-availability]', 'Checking the creator…');
    try { const next = await service.status(events.signal); if (!active()) return; status = next; updateExamples(); availability(); }
    catch { if (!active()) return; status = null; availability(); }
  }
  async function imageData(sourcePhoto: File | InstantExample): Promise<string> {
    if (sourcePhoto instanceof File) return fileDataUrl(await preparedPhoto(sourcePhoto, events.signal), events.signal);
    const response = await fetch(sourcePhoto.imageUrl, { signal: events.signal });
    if (!response.ok) throw new Error('This example photo could not load. Choose your own photo or try another example.');
    const blob = await response.blob(); const file = new File([blob], `${sourcePhoto.id}.png`, { type: blob.type || 'image/png' });
    const issue = validateInstantPhoto(file, status?.maxImageBytes); if (issue) throw new Error(issue);
    return fileDataUrl(file, events.signal);
  }

  giftCuriosities=mountGiftCuriosities(host.querySelector<HTMLElement>('[data-instant-curiosities]')!,{
    isCurrent:()=>active()&&!submitting&&!currentJob&&!pendingReference,getRegion:()=>giftContext.getContext().regionId,
    getImage:async()=>{if(!source)throw new Error('Choose a photo first.');return imageData(source);},
    inspect:service.triage ? (image,signal)=>service.triage!(image,signal) : undefined,
    onDecision:decision=>{photoDecision=decision;changeKey();availability();},onChange:changeKey,
    onStory: seed => {
      if (wizardBusy()) return;
      const current = field('story').value;
      if (current.trim() === seed.trim()) { field('story').focus(); return; }
      const merged = appendInstantTranscript(editedWords.has('story') ? current : '', seed);
      if (merged.error) { showError(merged.error); return; }
      field('story').value = merged.story; editedWords.add('story'); field('story').focus(); changeKey();
    },
  });
  storyAudio = mountStoryAudio(host.querySelector<HTMLElement>('[data-instant-audio]')!, {
    isCurrent: () => active() && step === 'story' && !wizardBusy(),
    onTranscript: (transcript: string) => {
      if (!active() || step !== 'story' || wizardBusy()) return false;
      const merged = appendInstantTranscript(field('story').value, transcript);
      if (merged.error) { showError(merged.error); return false; }
      field('story').value = merged.story; editedWords.add('story'); field('story').setCustomValidity(''); changeKey(); showError(); field('story').focus();
      return true;
    },
  });
  on('[data-instant-continue]', continueWizard);
  on('[data-instant-step-back]', () => goToStep(instantWizardDestination(step, -1, Boolean(source))));
  on('[data-instant-edit-step]', event => {
    const target = (event.currentTarget as HTMLButtonElement).dataset.instantEditStep as InstantWizardStep;
    if (INSTANT_WIZARD_STEPS.includes(target)) goToStep(target);
  });
  on('[data-instant-home]', options.onHome);
  on('[data-instant-intent]', event => { const next = (event.currentTarget as HTMLButtonElement).dataset.instantIntent; if (next === 'object' || next === 'place') updateIntent(next); });
  on('[data-instant-catalog]', event => updateIntent((event.currentTarget as HTMLButtonElement).dataset.instantCatalog === 'cities' ? 'place' : 'object'));
  on('[data-instant-examples-prev]', () => scrollExamples(-1));
  on('[data-instant-examples-next]', () => scrollExamples(1));
  host.querySelector<HTMLElement>('[data-instant-examples]')!.addEventListener('scroll', syncExampleNavigation, { signal: events.signal, passive: true });
  window.addEventListener('resize', syncExampleNavigation, { signal: events.signal });
  on('[data-instant-preview-toggle]', () => void openModelPreview());
  on('[data-instant-camera]', () => void openCamera());
  on('[data-instant-upload],[data-instant-change]', () => host.querySelector<HTMLInputElement>('[data-instant-upload-file]')!.click());
  on('[data-instant-place-upload]', () => host.querySelector<HTMLInputElement>('[data-instant-place-file]')!.click());
  on('[data-instant-place-remove],[data-instant-review-place-remove]', () => { if (wizardBusy()) return; if (placePreviewUrl) URL.revokeObjectURL(placePreviewUrl); placePreviewUrl = null; placePhoto = null; changeKey(); host.querySelector<HTMLElement>('[data-instant-place-selected]')!.hidden = true; if (step === 'review') reviewGift(); });
  on('[data-instant-recover]', () => void confirmPending());
  host.querySelector<HTMLInputElement>('[data-instant-upload-file]')!.addEventListener('change', event => takeFile(event.currentTarget as HTMLInputElement), { signal: events.signal });
  host.querySelector<HTMLInputElement>('[data-instant-place-file]')!.addEventListener('change', event => takeFile(event.currentTarget as HTMLInputElement, true), { signal: events.signal });
  form.addEventListener('input', event => {
    if (wizardBusy()) return;
    const input = event.target;
    if (input instanceof HTMLInputElement && input.name === 'consent') { input.setCustomValidity(''); showError(); return; }
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) { input.setCustomValidity(''); if (['title', 'worldPrompt', 'story'].includes(input.name)) editedWords.add(input.name); }
    changeKey(); showError();
  }, { signal: events.signal });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!active() || wizardBusy()) return;
    if (step !== 'review') { continueWizard(); return; }
    if (!source) return;
    if (!status?.available) { showError('Live creation is unavailable right now. Your photo and story remain here.'); return; }
    if (photoDecision === 'block' || photoDecision === 'review') { showError('Choose another photo before creating your gift.'); return; }
    const textIssues = validateInstantText(field('title').value, field('worldPrompt').value);
    for (const name of ['title', 'worldPrompt'] as const) field(name).setCustomValidity(textIssues[name]);
    if (textIssues.worldPrompt) { goToStep('place'); host.querySelector<HTMLDetailsElement>('.instant-place-custom')!.open = true; field('worldPrompt').reportValidity(); return; }
    if (textIssues.title) { goToStep('story'); host.querySelector<HTMLDetailsElement>('.instant-personal')!.open = true; field('title').reportValidity(); return; }
    for (const name of ['senderName', 'recipientName', 'dedication', 'story']) if (!field(name).checkValidity()) { goToStep('story'); host.querySelector<HTMLDetailsElement>('.instant-personal')!.open = true; field(name).reportValidity(); return; }
    if (!instantWizardCanCreate(step, Boolean(source), (field('consent') as HTMLInputElement).checked)) { showError('Confirm you can use these photos before creating your gift.'); field('consent').reportValidity(); return; }
    if (!form.reportValidity()) return;
    const chosen = source, epoch = sourceEpoch, photoIntent = intent;
    const snapshot = { title: field('title').value.trim(), worldPrompt: field('worldPrompt').value.trim(), senderName: field('senderName').value.trim(), recipientName: field('recipientName').value.trim(), story: field('story').value.trim(), dedication: field('dedication').value.trim(),curiosityIds:giftCuriosities?.selectedIds()||[] };
    if (!dedupeKey) { dedupeKey = `gift-${crypto.randomUUID()}`; requestToken = newRequestToken(); }
    try { sessionStorage.setItem(pendingStorageKey, JSON.stringify({ dedupeKey, requestToken })); } catch { /* In-place retries retain their key in memory. */ }
    submitting = true; readingSource = true; inputs.disabled = true; storyAudio?.stop(); showError(); availability(); create.innerHTML = `${cameraIcon}Preparing your photo…`;
    let sent = false;
    void (async () => {
      try {
        const imageDataUrl = await imageData(chosen);
        const defaultPlace = photoIntent === 'object' && !(chosen instanceof File) ? chosen.worldImageUrl || INSTANT_EXAMPLES.find(example => example.id === chosen.id)?.worldImageUrl : undefined;
        const worldImageDataUrl = placePhoto ? await fileDataUrl(await preparedPhoto(placePhoto, events.signal), events.signal) : defaultPlace ? await imageData({ id: 'rio-place', title: 'Rio at dusk', imageUrl: defaultPlace, worldPrompt: '' }) : undefined;
        const objectReference = photoIntent === 'place' && !(chosen instanceof File) && chosen.objectImageRole === 'miniature-reference' ? chosen.objectImageUrl : undefined;
        const objectImageDataUrl = objectReference ? await imageData({ ...chosen as InstantExample, imageUrl: objectReference }) : undefined;
        const imagePlan = instantImagePlan(photoIntent, imageDataUrl, objectImageDataUrl, worldImageDataUrl);
        if (!active() || epoch !== sourceEpoch) return;
        readingSource = false; create.innerHTML = `${giftIcon}Checking your photos before creating…`;
        sent = true; pendingReference = { dedupeKey, token: requestToken };
        const job = await service.create({ ...snapshot, ...imagePlan, ...(!(chosen instanceof File) ? { exampleId: chosen.id } : {}), dedupeKey, requestToken, consent: true }, events.signal);
        if (!active()) return; showJob(job); host.querySelector<HTMLElement>('[data-instant-progress] h2')!.focus({ preventScroll: true }); progress.scrollIntoView({ block: 'start', behavior: 'instant' }); schedulePoll();
      } catch (cause) {
        if (!active()) return;
        const message = cause instanceof Error ? cause.message : 'Your little world could not start. Your photo remains here.';
        // A lost response may leave a paid job running. A network failure keeps the
        // capability and editing locked; only a confirmed missing job releases it.
        if (sent) await confirmPending(message);
        else { changeKey(); showError(message); }
      }
      finally { if (active()) { submitting = false; readingSource = false; inputs.disabled = Boolean(pendingReference); create.innerHTML = makeGiftLabel; availability(); } }
    })();
  }, { signal: events.signal });
  on('[data-instant-open]', () => { if (currentJob && instantGiftReady(currentJob)) options.onGiftReady(currentJob); });
  on('[data-instant-recheck]', () => { host.querySelector<HTMLButtonElement>('[data-instant-recheck]')!.hidden = true; void poll(); });
  on('[data-instant-edit]', () => {
    if (!currentJob || !instantJobFinished(currentJob)) return;
    storyAudio?.stop(); closeModelPreview(); attemptedModel = '';
    currentJob = null; changeKey(); try { sessionStorage.removeItem(storageKey); } catch { /* Session remains usable. */ }
    inputs.disabled = false; progress.hidden = true; form.hidden = false; step = 'photo'; availability(); renderWizard(true);
  });
  on('[data-instant-status-retry]', () => void loadStatus());
  on('[data-instant-explore]', () => options.onExploreExample?.());
  updateExamples(); create.disabled = true; renderWizard();
  void loadStatus();
  let reference: InstantJobReference | null = null;
  try { reference = readInstantJobReference(sessionStorage.getItem(storageKey)) || readInstantPendingReference(sessionStorage.getItem(pendingStorageKey)); } catch { /* Browser storage may be unavailable. */ }
  if (reference) {
    pendingReference = reference; step = 'review'; inputs.disabled = true; void confirmPending();
  }
  return { destroy() { if (dead) return; dead = true; storyAudio?.stop(); storyAudio?.destroy(); cameraAttempt++; cameraDialog?.destroy(); cameraDialog = undefined; events.abort(); clearTimeout(pollTimer); closeModelPreview(); transformation.destroy(); releasePreview(); if (placePreviewUrl) URL.revokeObjectURL(placePreviewUrl); giftCuriosities?.destroy();giftContext.destroy(); host.replaceChildren(); } };
}
