import { mountRioSouvenir, type RioSouvenirHandle } from './rio-souvenir';
import { encodeRioCreatorDraft, loadRioCreatorDraft, newRioCreatorDraft, normalizeRioCreatorDraft, saveRioCreatorDraft, type RioCreatorDraft } from './rio-creator-state';

export interface RioCreatorOptions {
  isCurrent(): boolean;
  onHome(): void;
  initialDraft?: RioCreatorDraft;
  initialStep?: 0 | 1 | 2;
  onChange(draft: RioCreatorDraft): void;
  onPrivateStudio?: (draft: RioCreatorDraft) => void;
}
export interface RioCreatorHandle { destroy(): void }

const esc = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const textFields = ['title', 'sender', 'recipient', 'dedication', 'story'] as const;

/** Anonymous, local editing. Cloud saving and public invitations remain separate. */
export function mountRioCreator(host: HTMLElement, options: RioCreatorOptions): RioCreatorHandle {
  let draft = normalizeRioCreatorDraft(options.initialDraft) || newRioCreatorDraft();
  let step = options.initialStep ?? 0;
  let dead = false, saved = false, portal: RioSouvenirHandle | undefined;
  const events = new AbortController();
  const active = () => !dead && host.isConnected && options.isCurrent();
  const localPreview = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
  host.className = 'rio-creator-page';
  host.innerHTML = `<header class="rio-create-topline"><a class="rio-create-brand" href="#/home" aria-label="GiftPortals home"><img src="/assets/portal-dusk/brand-mark.png" alt=""/><span>GiftPortals</span></a><button class="rio-back rio-create-home" type="button" data-creator-home><img src="/assets/portal-dusk/arrow-left.svg" alt=""/><span>Back</span></button></header>
    <div class="rio-create-layout">
      <aside class="rio-create-preview" aria-label="Your gift preview"><div class="rio-create-postcard" data-creator-postcard><div class="rio-create-preview-copy"><span class="rio-create-preview-kicker" data-creator-kicker></span><h2 class="rio-create-preview-title" data-creator-preview-title></h2></div><div class="rio-create-stage-art"><img class="rio-create-scene" src="/assets/portal-dusk/welcome-bg.webp" alt=""/><img class="rio-create-object" src="/assets/portal-dusk/rio-keepsake.png" alt="Artistic Rio keepsake with Sugarloaf Mountain, cable car and bay"/></div><div class="rio-create-preview-message"><p class="rio-create-preview-dedication" data-creator-preview-dedication></p><p class="rio-create-preview-story" data-creator-preview-story hidden></p><span class="rio-create-preview-signature" data-creator-preview-signature></span><button class="rio-primary rio-create-preview-open" type="button" data-creator-open>Step inside</button></div></div><p class="rio-create-note">An artistic little piece of Rio.</p></aside>
      <form class="rio-create-editor" novalidate>
        <header class="rio-create-heading"><span class="rio-eyebrow">A GIFT FROM YOU</span><h1>Make it yours.</h1><p>A little Rio. A few words from you.</p></header>
        <nav class="rio-create-steps" aria-label="Create your gift"><button type="button" data-creator-step="0"><span>01</span> Gift</button><button type="button" data-creator-step="1"><span>02</span> Story</button><button type="button" data-creator-step="2"><span>03</span> Preview</button></nav>
        <section class="rio-create-panel" data-creator-panel="0" aria-labelledby="creator-gift-heading"><h2 id="creator-gift-heading" tabindex="-1">Start with a little Rio.</h2><p>Name the moment you want to keep.</p><button class="rio-create-choice" type="button" data-selected="true" aria-pressed="true" data-creator-keepsake><img src="/assets/portal-dusk/rio-keepsake.png" alt=""/><span><strong>Rio de Janeiro</strong><small>A little mountain. A whole afternoon.</small></span></button><div class="rio-create-field"><label for="rio-create-title">Give it a name</label><input id="rio-create-title" name="title" maxlength="80" required value="${esc(draft.title)}" autocomplete="off"/></div><fieldset><legend>Choose the feeling</legend><div class="rio-create-themes"><button class="theme-paper" type="button" data-creator-theme="paper">Warm paper</button><button class="theme-sunset" type="button" data-creator-theme="sunset">Sunset</button><button class="theme-ocean" type="button" data-creator-theme="ocean">Ocean</button></div></fieldset></section>
        <section class="rio-create-panel" data-creator-panel="1" aria-labelledby="creator-story-heading" hidden><h2 id="creator-story-heading" tabindex="-1">What would you tell them?</h2><div class="rio-create-names"><div class="rio-create-field"><label for="rio-create-recipient">To <small>(optional)</small></label><input id="rio-create-recipient" name="recipient" maxlength="60" value="${esc(draft.recipient)}" autocomplete="off"/></div><div class="rio-create-field"><label for="rio-create-sender">From</label><input id="rio-create-sender" name="sender" maxlength="60" required value="${esc(draft.sender)}" autocomplete="off"/></div></div><div class="rio-create-field"><label for="rio-create-dedication">A note on the gift</label><textarea id="rio-create-dedication" name="dedication" maxlength="280" rows="2" required>${esc(draft.dedication)}</textarea></div><div class="rio-create-field"><label for="rio-create-story">The story inside</label><textarea id="rio-create-story" name="story" maxlength="900" rows="4" required>${esc(draft.story)}</textarea><small>They’ll read this when they step into Rio.</small></div></section>
        <section class="rio-create-panel" data-creator-panel="2" aria-labelledby="creator-preview-heading" hidden><h2 id="creator-preview-heading" tabindex="-1">Ready to step inside?</h2><p>Open the portal. See it through their eyes.</p><div class="rio-create-summary"><span class="rio-eyebrow">YOUR LITTLE WORLD</span><p data-creator-summary></p></div><p class="rio-create-availability">Save this version on this browser to return to it later.</p><p class="rio-create-note">Anyone using this browser can resume it. No public gift or private cloud memory is created here.</p>${options.onPrivateStudio ? '<button class="rio-back" type="button" data-creator-private>Continue in the private Studio</button>' : ''}</section>
        <section class="rio-create-saved" data-creator-saved aria-labelledby="creator-saved-heading" hidden><span class="rio-eyebrow">A PLACE TO RETURN TO</span><h2 id="creator-saved-heading" tabindex="-1">Kept right here.</h2><p>Your draft is saved in this browser. Return with Resume saved draft; clearing browser data removes it.</p><button type="button" data-creator-copy hidden ${localPreview ? '' : 'disabled'}>Copy local preview link</button><div class="rio-create-field" data-creator-link-box hidden><label for="rio-local-link">Local preview link</label><input id="rio-local-link" data-creator-link readonly/><small>This link contains your message. It opens on this device while the preview is running.</small></div><p class="rio-create-note">${localPreview ? 'Copy a link to preview it on this device. Nothing has been published or sent.' : 'Public gift invitations are not enabled in this preview.'}</p><button class="rio-back" type="button" data-creator-edit>Change your words</button>${options.onPrivateStudio ? '<button class="rio-back" type="button" data-creator-private>Continue in the private Studio</button>' : ''}</section>
        <p class="rio-create-error" role="alert" data-creator-error></p><p class="rio-create-status" role="status" data-creator-status></p>
        <div class="rio-create-actions"><button class="rio-back" type="button" data-creator-back>Back</button><button class="rio-primary" type="submit" data-creator-next>Next: your story</button></div>
        <button class="rio-back" type="button" data-creator-resume>Resume saved draft</button>
      </form>
    </div><div data-creator-portal-host></div>`;

  const form = host.querySelector<HTMLFormElement>('form')!;
  const error = host.querySelector<HTMLElement>('[data-creator-error]')!;
  const status = host.querySelector<HTMLElement>('[data-creator-status]')!;
  const next = host.querySelector<HTMLButtonElement>('[data-creator-next]')!;
  const back = host.querySelector<HTMLButtonElement>('[data-creator-back]')!;
  const open = host.querySelector<HTMLButtonElement>('[data-creator-open]')!;
  const savedPanel = host.querySelector<HTMLElement>('[data-creator-saved]')!;
  const portalHost = host.querySelector<HTMLElement>('[data-creator-portal-host]')!;
  const on = (selector: string, callback: (event: Event) => void) => host.querySelectorAll<HTMLElement>(selector).forEach(element => element.addEventListener('click', callback, { signal: events.signal }));
  const text = (selector: string, value: string) => { host.querySelector<HTMLElement>(selector)!.textContent = value; };
  const changed = () => { options.onChange({ ...draft }); error.textContent = ''; status.textContent = ''; host.querySelector<HTMLElement>('[data-creator-link-box]')!.hidden = true; updatePreview(); };

  function updatePreview() {
    host.dataset.creatorTheme = draft.theme;
    host.querySelector<HTMLElement>('[data-creator-postcard]')!.dataset.theme = draft.theme;
    text('[data-creator-kicker]', draft.recipient.trim() ? `FOR ${draft.recipient.trim()}` : 'A LITTLE PIECE OF RIO');
    text('[data-creator-preview-title]', draft.title.trim() || 'Your Rio memory');
    text('[data-creator-preview-dedication]', draft.dedication.trim() || 'A little note for someone you love.');
    text('[data-creator-preview-story]', draft.story.trim() || 'Your story waits inside.');
    text('[data-creator-preview-signature]', `With love, ${draft.sender.trim() || 'you'}`);
    text('[data-creator-summary]', `${draft.title.trim() || 'Your Rio memory'} · ${draft.recipient.trim() ? `for ${draft.recipient.trim()}` : 'for someone you love'} · from ${draft.sender.trim() || 'you'}`);
    host.querySelectorAll<HTMLButtonElement>('[data-creator-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.creatorTheme === draft.theme)));
  }
  function setStep(value: number, focus = true) {
    host.querySelector<HTMLElement>('[data-creator-link-box]')!.hidden = true;
    host.querySelector<HTMLInputElement>('[data-creator-link]')!.value = '';
    status.textContent = '';
    saved = false; savedPanel.hidden = true; step = Math.max(0, Math.min(2, value)) as 0 | 1 | 2;
    host.dataset.currentStep = String(step);
    host.querySelectorAll<HTMLElement>('[data-creator-panel]').forEach(panel => panel.hidden = Number(panel.dataset.creatorPanel) !== step);
    host.querySelectorAll<HTMLButtonElement>('[data-creator-step]').forEach(button => { if (Number(button.dataset.creatorStep) === step) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current'); });
    host.querySelector<HTMLElement>('[data-creator-preview-story]')!.hidden = step !== 2;
    next.hidden = false; back.hidden = step === 0; next.textContent = ['Add your story', 'Review your gift', 'Save in this browser'][step];
    back.textContent = 'Back';
    updatePreview();
    if (focus) {
      const heading = host.querySelector<HTMLElement>(`[data-creator-panel="${step}"] h2`)!;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
  function validThrough(last: number): boolean {
    for (let panel = 0; panel <= last; panel++) {
      const fields = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`[data-creator-panel="${panel}"] input,[data-creator-panel="${panel}"] textarea`);
      for (const field of fields) {
        field.setCustomValidity(field.required && !field.value.trim() ? 'Add this part of your memory before continuing.' : '');
        if (!field.checkValidity()) { setStep(panel, false); error.textContent = 'Add the missing detail before continuing.'; field.reportValidity(); return false; }
      }
    }
    if (!normalizeRioCreatorDraft(draft)) { error.textContent = 'Some text is too long or could not be read. Please shorten it and try again.'; return false; }
    return true;
  }
  function openPortal() {
    if (!active() || !validThrough(1)) return;
    portal?.destroy();
    portal = mountRioSouvenir(portalHost, {
      isCurrent: active, content: { ...draft }, onHome: () => portal?.destroy(),
      onClose: () => { if (active()) open.focus({ preventScroll: true }); },
      onKeep: () => { portal?.destroy(); portal = undefined; if (active()) { setStep(2); status.textContent = 'Keep this version with Save in this browser.'; next.focus({ preventScroll: true }); } },
    });
    portalHost.classList.add('rio-create-portal-host');
    portal.open();
  }

  form.addEventListener('input', event => {
    const field = event.target as HTMLInputElement | HTMLTextAreaElement;
    const name = field.name as typeof textFields[number];
    if (!textFields.includes(name)) return;
    field.setCustomValidity(''); draft = { ...draft, [name]: field.value }; changed();
  }, { signal: events.signal });
  form.addEventListener('submit', event => {
    event.preventDefault(); if (!active()) return;
    if (saved) { if (localPreview) host.querySelector<HTMLButtonElement>('[data-creator-copy]')!.click(); else openPortal(); return; }
    if (step < 2) { if (validThrough(step)) setStep(step + 1); return; }
    if (!validThrough(1)) return;
    let stored = false;
    try { stored = saveRioCreatorDraft(draft, localStorage); } catch { /* Browser storage may be unavailable. */ }
    if (!stored) { error.textContent = 'Browser storage is unavailable. Your draft is still open here; it has not been saved.'; return; }
    saved = true; host.querySelectorAll<HTMLElement>('[data-creator-panel]').forEach(panel => panel.hidden = true);
    savedPanel.hidden = false; next.hidden = false; back.hidden = false;
    next.textContent = localPreview ? 'Copy local preview link' : 'Preview portal'; back.textContent = 'Edit gift';
    status.textContent = 'Draft saved in this browser. No invitation has been sent.';
    const savedHeading = savedPanel.querySelector<HTMLElement>('h2')!;
    savedHeading.focus({ preventScroll: true }); savedHeading.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, { signal: events.signal });
  on('[data-creator-step]', event => { const target = Number((event.currentTarget as HTMLButtonElement).dataset.creatorStep); if (target <= step || validThrough(target - 1)) setStep(target); });
  on('[data-creator-back]', () => setStep(saved ? 1 : step - 1));
  on('[data-creator-edit]', () => { status.textContent = ''; setStep(1); });
  on('[data-creator-open]', openPortal);
  on('[data-creator-home]', options.onHome);
  on('[data-creator-keepsake]', () => { status.textContent = 'Rio is selected. Choose the feeling or add your story.'; });
  on('[data-creator-theme]', event => { const theme = (event.currentTarget as HTMLButtonElement).dataset.creatorTheme; if (theme === 'paper' || theme === 'sunset' || theme === 'ocean') { draft = { ...draft, theme }; changed(); } });
  on('[data-creator-resume]', () => {
    let stored: RioCreatorDraft | null = null;
    try { stored = loadRioCreatorDraft(localStorage); } catch { /* Browser storage may be unavailable. */ }
    if (!stored) { status.textContent = 'There is no readable saved Rio draft in this browser yet.'; return; }
    draft = stored; for (const name of textFields) (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value = draft[name];
    options.onChange({ ...draft }); error.textContent = ''; setStep(2); status.textContent = 'Your saved draft is open. Preview or edit it before saving again.';
  });
  on('[data-creator-private]', () => { if (validThrough(1)) options.onPrivateStudio?.({ ...draft }); });
  on('[data-creator-copy]', () => {
    if (!active() || !saved || !localPreview || !validThrough(1)) return;
    const url = new URL(location.href); url.search = ''; url.hash = '/trail?' + new URLSearchParams({ experience: 'rio', draft: encodeRioCreatorDraft(draft) }).toString();
    const link = host.querySelector<HTMLInputElement>('[data-creator-link]')!;
    link.value = url.href; host.querySelector<HTMLElement>('[data-creator-link-box]')!.hidden = false;
    const snapshot = url.href;
    void navigator.clipboard?.writeText(snapshot).then(() => { if (active() && saved && link.value === snapshot) status.textContent = 'Local preview link copied. Open it on this device; it has not been published.'; }).catch(() => { if (active()) { link.focus(); link.select(); status.textContent = 'Select and copy the local preview link above.'; } });
    if (!navigator.clipboard) { link.focus(); link.select(); status.textContent = 'Select and copy the local preview link above.'; }
  });
  host.querySelector<HTMLImageElement>('.rio-create-object')!.addEventListener('error', event => {
    (event.currentTarget as HTMLImageElement).hidden = true; error.textContent = 'The keepsake image could not load. Your message remains available.';
  }, { signal: events.signal });
  setStep(step, false);
  return { destroy() { if (dead) return; dead = true; events.abort(); portal?.destroy(); portal = undefined; host.replaceChildren(); } };
}
