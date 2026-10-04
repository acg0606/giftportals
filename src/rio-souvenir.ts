export interface RioSouvenirContent {
  title: string; sender: string; recipient: string; dedication: string; story: string;
  theme?: 'paper' | 'sunset' | 'ocean';
}
export interface RioSouvenirOptions { isCurrent(): boolean; onHome(): void; content?: RioSouvenirContent; onKeep?: () => void; onClose?: () => void }
export interface RioSouvenirHandle { open(): void; destroy(): void }
interface PanoramaHandle { destroy(): void; reset(): void; look(horizontal: number, vertical: number): void }
const SOUVENIR = '/assets/portal-dusk/rio-keepsake.png';
const PANORAMA = '/assets/rio/rio-panorama.png';
let encounterSequence = 0;

/** A local invitation preview. Opening it never creates, shares or saves a gift. */
export function mountRioSouvenir(host: HTMLElement, options: RioSouvenirOptions): RioSouvenirHandle {
  const instance = ++encounterSequence;
  // Draft text is untrusted. Keep it out of HTML and attribute interpolation.
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const content = options.content ? {
    title: text(options.content.title), sender: text(options.content.sender), recipient: text(options.content.recipient),
    dedication: text(options.content.dedication), story: text(options.content.story),
    theme: options.content.theme === 'sunset' || options.content.theme === 'ocean' ? options.content.theme : 'paper',
  } : undefined;
  const previewLabel = 'Personalized local preview · artistic recreation';
  let dead = false, version = 0, dialog: HTMLDialogElement | undefined;
  let viewer: PanoramaHandle | undefined;
  let scrollLock: Array<{ style: CSSStyleDeclaration; value: string; priority: string }> | undefined;
  const events = new AbortController();
  let worldEvents = new AbortController();
  const active = () => !dead && options.isCurrent() && host.isConnected;
  host.className = 'rio-gift-page';
  host.innerHTML = `
    <img class="rio-gift-atmosphere" src="/assets/portal-dusk/welcome-bg.webp" alt="" aria-hidden="true"/>
    <div class="rio-gift-topline">
      <button class="rio-back" type="button" data-rio-home><img class="rio-gift-icon" src="/assets/portal-dusk/arrow-left.svg" alt="" aria-hidden="true"/>All stories</button>
      <a class="rio-gift-brand" href="#/" aria-label="GiftPortals home"><img src="/assets/portal-dusk/brand-mark.png" alt=""/>GiftPortals</a>
      <span class="rio-eyebrow" data-rio-sender>A GIFT FROM CLARA</span>
    </div>
    <section class="rio-gift-card" aria-labelledby="rio-gift-title-${instance}">
      <div class="rio-gift-object">
        <img src="${SOUVENIR}" alt="Artistic miniature souvenir of Rio’s Sugarloaf Mountain, cable car and bay" data-rio-product/>
        <span class="rio-product-failure" data-rio-product-failure role="status" hidden>The souvenir image is unavailable. Its Rio memory is still here.</span>
        <span class="rio-object-place">A LITTLE PIECE OF RIO</span>
      </div>
      <div class="rio-gift-copy">
        <span class="rio-eyebrow">SOME PLACES STAY WITH YOU</span>
        <h1 id="rio-gift-title-${instance}">Rio de Janeiro</h1>
        <p class="rio-gift-subtitle" data-rio-gift-subtitle>A place to return to.</p>
        <p class="rio-gift-recipient" data-rio-recipient hidden></p>
        <p class="rio-gift-dedication" data-rio-gift-dedication>“I found this little piece of Rio by the water. It made me think of you.”</p>
        <button class="rio-primary" type="button" data-rio-enter>Enter Rio <img class="rio-gift-icon" src="/assets/portal-dusk/arrow-right.svg" alt="" aria-hidden="true"/></button>
        <p class="rio-gift-note" data-rio-preview-label>A fictional souvenir story · artistic recreation</p>
      </div>
    </section>
    <div class="rio-gift-bottom">
      <span>THE OBJECT IS ONLY THE BEGINNING</span>
      <p>A small souvenir opens a memory of the place it carries.</p>
      <a href="#/gallery?demo=recipient">Explore other memories<img class="rio-gift-icon" src="/assets/portal-dusk/arrow-right.svg" alt="" aria-hidden="true"/></a>
    </div>`;
  if (content) {
    host.setAttribute('data-rio-theme', content.theme);
    host.querySelector<HTMLElement>('[data-rio-sender]')!.textContent = `A GIFT FROM ${content.sender}`;
    host.querySelector<HTMLElement>('[data-rio-gift-subtitle]')!.textContent = content.title;
    const recipient = host.querySelector<HTMLElement>('[data-rio-recipient]')!;
    recipient.textContent = content.recipient ? `For ${content.recipient}` : '';
    recipient.hidden = !content.recipient.trim();
    host.querySelector<HTMLElement>('[data-rio-gift-dedication]')!.textContent = `“${content.dedication}”`;
    host.querySelector<HTMLElement>('[data-rio-preview-label]')!.textContent = previewLabel;
  }
  const enter = host.querySelector<HTMLButtonElement>('[data-rio-enter]')!;
  const product = host.querySelector<HTMLImageElement>('[data-rio-product]')!;
  const productFailure = () => { if (active()) host.querySelector<HTMLElement>('[data-rio-product-failure]')!.hidden = false; };
  product.addEventListener('error', productFailure, { signal: events.signal });
  if (product.complete && product.naturalWidth === 0) productFailure();
  host.querySelector<HTMLButtonElement>('[data-rio-home]')!.addEventListener('click', () => { if (active()) options.onHome(); }, { signal: events.signal });
  enter.addEventListener('click', openWorld, { signal: events.signal });

  function destroyViewer() { version++; viewer?.destroy(); viewer = undefined; }
  function lockScrolling() {
    if (scrollLock) return;
    scrollLock = [document.documentElement.style, document.body.style].map(style => ({
      style, value: style.getPropertyValue('overflow'), priority: style.getPropertyPriority('overflow'),
    }));
    for (const saved of scrollLock) saved.style.setProperty('overflow', 'hidden');
  }
  function restoreScrolling() {
    for (const saved of scrollLock || []) {
      if (saved.value) saved.style.setProperty('overflow', saved.value, saved.priority);
      else saved.style.removeProperty('overflow');
    }
    scrollLock = undefined;
  }
  function closeWorld(restoreFocus = true) {
    destroyViewer(); worldEvents.abort();
    const previous = dialog; dialog = undefined;
    if (previous?.open) previous.close();
    previous?.remove();
    restoreScrolling();
    if (restoreFocus && active()) { enter.focus({ preventScroll: true }); options.onClose?.(); }
  }
  function destroy() {
    if (dead) return;
    dead = true; events.abort(); closeWorld(false); host.replaceChildren();
  }
  function openWorld() {
    if (!active() || dialog) return;
    worldEvents = new AbortController();
    const encounter = document.createElement('dialog'); dialog = encounter;
    encounter.className = 'rio-world';
    encounter.setAttribute('aria-labelledby', `rio-world-title-${instance}`);
    encounter.innerHTML = `<div class="rio-world-shell"><div class="rio-world-backdrop"><img src="${PANORAMA}" data-rio-source="${PANORAMA}" alt="Artistic Rio waterfront at sunset with Sugarloaf Mountain and a cable car" data-rio-poster/><div class="rio-world-canvas" data-rio-canvas aria-label="Rio artistic panorama. Drag to look around, use the arrow keys, or select the direction buttons." tabindex="0"></div></div><header class="rio-world-header"><div><span class="rio-world-brand"><img src="/assets/portal-dusk/brand-mark.png" alt=""/>GiftPortals</span><h1 id="rio-world-title-${instance}" tabindex="-1">Rio de Janeiro</h1></div><button class="rio-world-button" data-rio-close>Back to gift <img class="rio-world-icon" src="/assets/portal-dusk/x.svg" alt="" aria-hidden="true"/></button></header><div class="rio-world-loading" data-rio-loading role="status">Opening your Rio memory…</div><aside class="rio-world-message" data-rio-message hidden><span class="rio-eyebrow" data-rio-world-sender>CLARA’S MESSAGE</span><h2 data-rio-world-title>Wish you were here.</h2><p data-rio-world-story>“I wanted you to feel the light, the breeze, and the moment that made me think of you. Keep this little piece of Rio until we can come back together.”</p><span class="rio-world-signature" data-rio-world-signature>With love, Clara</span><button class="rio-world-button rio-keep" data-rio-keep hidden>Keep this memory</button><div class="rio-memory-photos"><img src="${SOUVENIR}" data-rio-source="${SOUVENIR}" data-rio-photo alt="The Rio souvenir that carries this memory"/><img src="${PANORAMA}" data-rio-source="${PANORAMA}" data-rio-photo alt="The artistic waterfront scene attached to this gift"/><span>A little object.<br/>A whole afternoon.</span></div></aside><footer class="rio-world-footer"><div class="rio-world-controls" aria-label="Panorama controls"><button class="rio-world-button" data-rio-toggle aria-expanded="false" aria-controls="rio-world-message-${instance}" disabled>Show message</button><button class="rio-world-button" data-rio-reset disabled>Reset view</button><div class="rio-world-directions" role="group" aria-label="Look around"><button class="rio-world-button" data-rio-left aria-label="Look left" disabled><img class="rio-world-icon" src="/assets/portal-dusk/arrow-left.svg" alt="" aria-hidden="true"/></button><button class="rio-world-button" data-rio-right aria-label="Look right" disabled><img class="rio-world-icon" src="/assets/portal-dusk/arrow-right.svg" alt="" aria-hidden="true"/></button><button class="rio-world-button" data-rio-up aria-label="Look up" disabled><img class="rio-world-icon rio-world-icon-up" src="/assets/portal-dusk/arrow-left.svg" alt="" aria-hidden="true"/></button><button class="rio-world-button" data-rio-down aria-label="Look down" disabled><img class="rio-world-icon rio-world-icon-down" src="/assets/portal-dusk/arrow-left.svg" alt="" aria-hidden="true"/></button></div><button class="rio-world-button" data-rio-retry hidden>Try again</button></div><div class="rio-world-caption"><span data-rio-hint>Drag to look around · arrow keys</span><span data-rio-world-caption>Artistic recreation · fictional gift</span></div></footer></div>`;
    if (content) {
      encounter.setAttribute('data-rio-theme', content.theme);
      encounter.querySelector<HTMLElement>('[data-rio-world-sender]')!.textContent = `A MESSAGE FROM ${content.sender}`;
      encounter.querySelector<HTMLElement>('[data-rio-world-title]')!.textContent = content.title;
      encounter.querySelector<HTMLElement>('[data-rio-world-story]')!.textContent = `“${content.story}”`;
      encounter.querySelector<HTMLElement>('[data-rio-world-signature]')!.textContent = `With love, ${content.sender}`;
      encounter.querySelector<HTMLElement>('[data-rio-world-caption]')!.textContent = previewLabel;
    }
    const message = encounter.querySelector<HTMLElement>('[data-rio-message]')!;
    message.id = `rio-world-message-${instance}`;
    host.append(encounter);
    const listen = (name: string, callback: () => void) => encounter.querySelector<HTMLElement>(`[data-rio-${name}]`)!.addEventListener('click', callback, { signal: worldEvents.signal });
    if (options.onKeep) {
      encounter.querySelector<HTMLButtonElement>('[data-rio-keep]')!.hidden = false;
      listen('keep', () => { if (active() && dialog === encounter && encounter.open) options.onKeep?.(); });
    }
    const toggle = encounter.querySelector<HTMLButtonElement>('[data-rio-toggle]')!;
    function showMessage(show: boolean) {
      if (!active() || dialog !== encounter || !encounter.open) return;
      message.hidden = !show;
      toggle.textContent = show ? 'Look around' : 'Show message';
      toggle.setAttribute('aria-expanded', String(show));
      encounter.classList.toggle('is-looking', !show);
    }
    listen('close', () => closeWorld());
    listen('toggle', () => showMessage(message.hidden));
    listen('reset', () => viewer?.reset());
    listen('left', () => viewer?.look(0.12, 0));
    listen('right', () => viewer?.look(-0.12, 0));
    listen('up', () => viewer?.look(0, 0.08));
    listen('down', () => viewer?.look(0, -0.08));
    const images = encounter.querySelectorAll<HTMLImageElement>('[data-rio-poster],[data-rio-photo]');
    let imageRetry = 0;
    listen('retry', () => {
      if (!active() || dialog !== encounter) return;
      imageRetry++;
      for (const image of images) image.setAttribute('src', `${image.getAttribute('data-rio-source')}?rio-view=${instance}-${imageRetry}`);
      loadPanorama(encounter, showMessage, true);
    });
    encounter.addEventListener('cancel', event => { event.preventDefault(); closeWorld(); }, { signal: worldEvents.signal });
    encounter.addEventListener('close', () => { if (dialog === encounter) closeWorld(); }, { signal: worldEvents.signal });
    for (const image of images) {
      const failed = () => {
        if (!active() || dialog !== encounter) return;
        image.hidden = true;
        if (image.getAttribute('data-rio-poster') !== null) encounter.classList.add('is-image-unavailable');
      };
      image.addEventListener('error', failed, { signal: worldEvents.signal });
      image.addEventListener('load', () => {
        if (!active() || dialog !== encounter) return;
        image.hidden = false;
        if (image.getAttribute('data-rio-poster') !== null) encounter.classList.remove('is-image-unavailable');
      }, { signal: worldEvents.signal });
      if (image.complete && image.naturalWidth === 0) failed();
    }
    try { encounter.showModal(); }
    catch { closeWorld(); productFailure(); return; }
    lockScrolling();
    encounter.querySelector<HTMLElement>('h1')!.focus({ preventScroll: true });
    loadPanorama(encounter, showMessage, false);
  }
  function loadPanorama(encounter: HTMLDialogElement, showMessage: (show: boolean) => void, retry: boolean) {
    destroyViewer();
    const attempt = version;
    const current = () => active() && dialog === encounter && encounter.open && attempt === version;
    const canvas = encounter.querySelector<HTMLElement>('[data-rio-canvas]')!;
    const status = encounter.querySelector<HTMLElement>('[data-rio-loading]')!;
    const retryButton = encounter.querySelector<HTMLButtonElement>('[data-rio-retry]')!;
    const controls = encounter.querySelectorAll<HTMLButtonElement>('[data-rio-reset],[data-rio-left],[data-rio-right],[data-rio-up],[data-rio-down]');
    const toggle = encounter.querySelector<HTMLButtonElement>('[data-rio-toggle]')!;
    status.textContent = 'Opening your Rio memory…'; status.hidden = false;
    encounter.classList.remove('is-ready', 'is-fallback'); retryButton.hidden = true;
    controls.forEach(control => control.disabled = true); toggle.disabled = true;
    const fallback = () => {
      if (!current()) return;
      destroyViewer(); encounter.classList.add('is-fallback');
      status.textContent = 'The interactive view could not open. Your souvenir and message remain available.';
      status.hidden = false; retryButton.hidden = false; toggle.disabled = false;
      encounter.querySelector<HTMLElement>('[data-rio-hint]')!.textContent = 'Interactive view unavailable';
      showMessage(true);
      if (retry) retryButton.focus({ preventScroll: true });
    };
    void import('./rio-panorama').then(({ mountRioPanorama }) => {
      if (!current()) return;
      const next = mountRioPanorama(canvas, PANORAMA, {
        onReady: () => {
          if (!current()) return;
          encounter.classList.add('is-ready'); status.hidden = true;
          controls.forEach(control => control.disabled = false); toggle.disabled = false;
          encounter.querySelector<HTMLElement>('[data-rio-hint]')!.textContent = 'Drag to look around · arrow keys';
          showMessage(true);
          if (retry) encounter.querySelector<HTMLElement>('h1')!.focus({ preventScroll: true });
        },
        onError: fallback,
      });
      // A renderer can fail synchronously while its handle is being constructed.
      if (!current()) next.destroy(); else viewer = next;
    }).catch(fallback);
  }
  return { open: openWorld, destroy };
}
