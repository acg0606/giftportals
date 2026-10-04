import './quality-comparison.css';
import { giftIcon } from './gift-icon';
import { mountGeneratedGift, type GeneratedGiftData, type GeneratedGiftHandle } from './generated-gift';

export type QualityComparisonKind = 'miniature' | 'world';
type Version = 'baseline' | 'candidate';
interface ReferenceView { label: string; url: string }
interface TrialManifest {
  baseline?: string;
  candidate?: string;
  baselinePreview?: string;
  candidatePreview?: string;
  referenceImage?: string;
  views?: ReferenceView[];
  referenceImages?: (string | ReferenceView)[];
  baselineLabel?: string;
  candidateLabel?: string;
  baselineDetails?: string[];
  candidateDetails?: string[];
}
interface ComparisonManifest { miniature?: TrialManifest; world?: TrialManifest }
interface CompletedVersion { gift: GeneratedGiftData; preview: string; previewLabel: string; renderedPreview: boolean }
export interface QualityComparisonOptions {
  initialKind?: QualityComparisonKind;
  isCurrent(): boolean;
  onExit(): void;
}
export interface QualityComparisonHandle { destroy(): void }

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const globeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z"/></svg>';
const arrowIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>';

/** This local comparison accepts published demo assets, never private job URLs. */
export function comparisonAssetPath(value: unknown): string {
  if (typeof value !== 'string' || !/^\/demo\/[A-Za-z0-9_./-]+$/.test(value)) return '';
  const segments = value.slice(1).split('/');
  return segments.every(segment => !!segment && segment !== '.' && segment !== '..') ? value : '';
}

export function comparisonGiftData(value: unknown, kind: QualityComparisonKind): GeneratedGiftData | undefined {
  if (!value || typeof value !== 'object') return;
  const data = value as Record<string, unknown>;
  if (typeof data.title !== 'string' || typeof data.senderName !== 'string' || typeof data.story !== 'string') return;
  const modelUrl = comparisonAssetPath(data.modelUrl), worldUrl = comparisonAssetPath(data.worldUrl);
  if (kind === 'miniature' ? !modelUrl.endsWith('.glb') : !worldUrl.endsWith('.spz')) return;
  const number = (field: string) => typeof data[field] === 'number' && Number.isFinite(data[field]) ? data[field] as number : undefined;
  const text = (field: string) => typeof data[field] === 'string' ? data[field] as string : undefined;
  return {
    title: data.title, senderName: data.senderName, story: data.story,
    recipientName: text('recipientName'), dedication: text('dedication'),
    originalUrl: comparisonAssetPath(data.originalUrl) || undefined,
    keepsakeImageUrl: comparisonAssetPath(data.keepsakeImageUrl) || undefined,
    panoramaUrl: comparisonAssetPath(data.panoramaUrl) || undefined,
    collisionUrl: comparisonAssetPath(data.collisionUrl) || undefined,
    colliderUrl: comparisonAssetPath(data.colliderUrl) || undefined,
    modelUrl: modelUrl.endsWith('.glb') ? modelUrl : undefined,
    worldUrl: worldUrl.endsWith('.spz') ? worldUrl : undefined,
    photoIntent: data.photoIntent === 'place' ? 'place' : 'object',
    objectRepresentation: data.objectRepresentation === 'souvenir-miniature' ? 'souvenir-miniature' : undefined,
    modelYaw: number('modelYaw'), initialYaw: number('initialYaw'), initialPitch: number('initialPitch'),
    // These fields are validated again by the shared gift controller.
    curiosities: Array.isArray(data.curiosities) ? data.curiosities as GeneratedGiftData['curiosities'] : undefined,
    touchpoints: Array.isArray(data.touchpoints) ? data.touchpoints as GeneratedGiftData['touchpoints'] : undefined,
  };
}

/** Read-only A/B review. Opening another version disposes the previous renderer. */
export function mountQualityComparison(host: HTMLElement, options: QualityComparisonOptions): QualityComparisonHandle {
  const events = new AbortController(), requests = new AbortController();
  let dead = false, kind = options.initialKind || 'miniature', manifest: ComparisonManifest = {};
  let loading = true, error = '', viewer: GeneratedGiftHandle | undefined;
  let cinematicReady = false;
  let viewerEpoch = 0, lastOpened: Version | undefined;
  const completed = new Map<string, CompletedVersion>();
  const current = () => !dead && !requests.signal.aborted && options.isCurrent();
  const trial = () => manifest[kind] || {};
  const title = () => kind === 'miniature' ? 'A memory you can hold.' : 'A place you can step into.';
  const versionLabel = (version: Version) => version === 'baseline' ? trial().baselineLabel || 'Current version' : trial().candidateLabel || (kind === 'miniature' ? 'Multiview test' : 'Marble Plus test');
  const stopViewer = () => { viewerEpoch++; viewer?.destroy(); viewer = undefined; };
  const image = (url: string, alt: string, className = '') => `<img class="${className}" src="${escape(url)}" alt="${escape(alt)}" loading="lazy" decoding="async"/>`;

  function references(): ReferenceView[] {
    const selected = trial();
    const supplied = kind === 'miniature'
      ? selected.views?.length ? selected.views : selected.referenceImage ? [{ label: 'Volume reference', url: selected.referenceImage }] : []
      : (selected.referenceImages || []).map((item, index) => typeof item === 'string' ? { label: `Environment view ${index + 1}`, url: item } : item);
    return (supplied || []).filter(item => item && typeof item.label === 'string' && comparisonAssetPath(item.url)).slice(0, 8);
  }

  function card(version: Version): string {
    const entry = completed.get(`${kind}:${version}`), label = versionLabel(version);
    const details = version === 'baseline' ? trial().baselineDetails : trial().candidateDetails;
    const preview = entry?.preview ? image(entry.preview, `${label}: ${entry.previewLabel}`) : `<div class="qc-preview-empty">${kind === 'miniature' ? giftIcon : globeIcon}<span>${loading ? 'Preparing the comparison…' : 'No completed asset yet'}</span></div>`;
    return `<article class="qc-version ${version === 'candidate' ? 'qc-version-candidate' : ''}">
      <div class="qc-version-heading"><span class="qc-version-letter">${version === 'baseline' ? 'A' : 'B'}</span><div><span class="qc-eyebrow">${version === 'baseline' ? 'YOUR CURRENT GIFT' : 'NEW GENERATION TEST'}</span><h2>${escape(label)}</h2></div><span class="qc-state">${entry ? 'Ready to explore' : loading ? 'Loading' : 'Unavailable'}</span></div>
      <div class="qc-preview ${entry?.renderedPreview ? 'qc-preview-render' : ''}">${preview}${entry?.preview ? `<span class="qc-preview-caption">${escape(entry.previewLabel)}</span>` : ''}</div>
      ${details?.length ? `<ul class="qc-details">${details.filter(item => typeof item === 'string').map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : ''}
      <button class="qc-open" data-qc-open="${version}" type="button" ${entry ? '' : 'disabled'}>${kind === 'miniature' ? giftIcon : globeIcon}<span>${kind === 'miniature' ? 'Rotate this miniature' : 'Explore this world'}</span>${arrowIcon}</button>
    </article>`;
  }

  function render() {
    if (!current()) return;
    const views = references();
    host.innerHTML = `<main class="quality-comparison">
      <header class="qc-header"><a class="qc-brand" href="#/home"><img src="/assets/portal-dusk/brand-mark.png" alt=""/>GiftPortals</a><button class="qc-home" type="button" data-qc-home>Back to my gifts ${arrowIcon}</button></header>
      <section class="qc-intro"><span class="qc-eyebrow">THE SAME MEMORY, A NEW DIMENSION</span><h1>${title()}</h1><p>${kind === 'miniature' ? 'Compare the current keepsake with a miniature made from matching front, side and back views.' : 'Compare the current environment with a new generation guided by consistent views of the same place.'}</p>
        <div class="qc-kind" aria-label="Choose a comparison"><button type="button" data-qc-kind="miniature" aria-pressed="${kind === 'miniature'}">${giftIcon}Miniature</button><button type="button" data-qc-kind="world" aria-pressed="${kind === 'world'}">${globeIcon}World</button></div>
      </section>
      ${kind === 'world' && cinematicReady ? `<a class="qc-flight-invite" href="#/paris-walk?from=comparison"><span class="qc-flight-symbol">${globeIcon}</span><div><span class="qc-eyebrow">WALK INSIDE YOUR MEMORY</span><h2>Paris, around you.</h2><p>Explore the tower gardens at your own pace, with the city around you.</p></div><span class="qc-flight-action">Walk through Paris ${arrowIcon}</span></a>` : ''}
      <div class="qc-pair">${card('baseline')}${card('candidate')}</div>
      <p class="qc-instruction" role="status">${error ? escape(error) : lastOpened ? `${escape(versionLabel(lastOpened))} was opened. Choose the other version to compare.` : 'Open one version at a time. Both use the same viewer and controls.'}</p>
      <section class="qc-look-for"><span class="qc-eyebrow">WHAT TO LOOK FOR</span><div>${(kind === 'miniature' ? ['A complete shape from every side', 'Separate layers and real depth', 'A small keepsake, with no photo board'] : ['Depth as you move through the scene', 'Coherent buildings, objects and paths', 'A welcoming atmosphere around the gift']).map((text, index) => `<p><span>${index + 1}</span>${text}</p>`).join('')}</div></section>
      ${views.length ? `<section class="qc-references"><div><span class="qc-eyebrow">THE GENERATION INPUTS</span><h2>${kind === 'miniature' ? 'One object. Several matching angles.' : 'Several views. One coherent place.'}</h2><p>These are reference images used for generation. The buttons above open the completed 3D assets.</p></div><div class="qc-reference-strip">${views.map(view => `<figure>${image(view.url, view.label)}<figcaption>${escape(view.label)}</figcaption></figure>`).join('')}</div></section>` : ''}
      <footer class="qc-footer">Local visual comparison · opens completed assets without generating another gift</footer>
      <div data-qc-viewer></div>
    </main>`;
  }

  function openVersion(version: Version) {
    const entry = completed.get(`${kind}:${version}`); if (!entry || !current()) return;
    stopViewer(); lastOpened = version;
    const epoch = viewerEpoch;
    const status = host.querySelector<HTMLElement>('.qc-instruction');
    if (status) status.textContent = `${versionLabel(version)} is open. Close it to compare the other version.`;
    viewer = mountGeneratedGift(host.querySelector<HTMLElement>('[data-qc-viewer]')!, {
      gift: entry.gift, initialView: kind === 'miniature' ? 'object' : 'world',
      isCurrent: () => current() && epoch === viewerEpoch,
      onExit: () => { stopViewer(); render(); host.querySelector<HTMLButtonElement>(`[data-qc-open="${version}"]`)?.focus({ preventScroll: true }); },
    });
  }

  host.addEventListener('click', event => {
    if (!current()) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!target || !host.contains(target)) return;
    if (target.hasAttribute('data-qc-home')) { stopViewer(); options.onExit(); }
    const next = target.getAttribute('data-qc-kind');
    if (next === 'miniature' || next === 'world') { stopViewer(); kind = next; lastOpened = undefined; render(); }
    const version = target.getAttribute('data-qc-open');
    if (version === 'baseline' || version === 'candidate') openVersion(version);
  }, { signal: events.signal });

  async function loadVersion(trialKind: QualityComparisonKind, version: Version) {
    const path = comparisonAssetPath(manifest[trialKind]?.[version]); if (!path.endsWith('.json')) return;
    try {
      const response = await fetch(path, { signal: requests.signal }); if (!response.ok) return;
      const gift = comparisonGiftData(await response.json(), trialKind); if (!gift) return;
      const media = trialKind === 'miniature' ? gift.modelUrl : gift.worldUrl;
      const asset = await fetch(media!, { method: 'HEAD', signal: requests.signal });
      if (!asset.ok || /text\/html/i.test(asset.headers.get('content-type') || '')) return;
      let preview = trialKind === 'miniature' ? gift.keepsakeImageUrl || gift.originalUrl || '' : gift.panoramaUrl || gift.originalUrl || '';
      let previewLabel = trialKind === 'miniature' ? 'Generation reference · open to see 3D' : 'World panorama · open to move in 3D';
      let renderedPreview = false;
      const renderPreview = trialKind === 'miniature' ? comparisonAssetPath(manifest[trialKind]?.[version === 'baseline' ? 'baselinePreview' : 'candidatePreview']) : '';
      if (renderPreview) {
        try {
          const rendered = await fetch(renderPreview, { method: 'HEAD', signal: requests.signal });
          if (rendered.ok && /^image\/(?:jpeg|png|webp)(?:;|$)/i.test(rendered.headers.get('content-type') || '')) { preview = renderPreview; previewLabel = '3D render · open to rotate'; renderedPreview = true; }
        } catch { /* An optional thumbnail failure keeps the generation reference. */ }
      }
      if (current()) completed.set(`${trialKind}:${version}`, { gift, preview, previewLabel, renderedPreview });
    } catch { /* An incomplete trial stays unavailable; it never substitutes a fake result. */ }
  }

  async function loadCinematicAvailability() {
    try {
      const response = await fetch('/demo/v23/paris-flight.json', { signal: requests.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
      if (!response.ok || /text\/html/i.test(response.headers.get('content-type') || '')) return;
      const { readParisFlightManifest } = await import('./paris-flight-state');
      const journey = readParisFlightManifest(await response.json());
      if (!journey || journey.chapters.length !== 3 || journey.chapters.some(chapter => chapter.status !== 'complete' || !chapter.worldUrl)) return;
      const checks = await Promise.allSettled(journey.chapters.map(chapter => fetch(chapter.worldUrl!, { method: 'HEAD', signal: requests.signal, credentials: 'omit', redirect: 'error' })));
      if (current() && checks.every(result => result.status === 'fulfilled' && result.value.ok && !/text\/html/i.test(result.value.headers.get('content-type') || ''))) cinematicReady = true;
    } catch { /* The existing A/B experience remains available during generation. */ }
  }

  render();
  void (async () => {
    try {
      const response = await fetch('/demo/v22/quality-comparison.json', { signal: requests.signal });
      if (!response.ok) throw new Error();
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object') throw new Error();
      manifest = value as ComparisonManifest;
      await Promise.allSettled([...(['miniature', 'world'] as const).flatMap(trialKind => (['baseline', 'candidate'] as const).map(version => loadVersion(trialKind, version))), loadCinematicAvailability()]);
    } catch { if (current()) error = 'The comparison assets are not available yet. Your current gifts are still in the collection.'; }
    if (current()) { loading = false; render(); }
  })();
  return { destroy() { if (dead) return; dead = true; stopViewer(); events.abort(); requests.abort(); host.replaceChildren(); } };
}
