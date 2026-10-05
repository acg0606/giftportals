import './public-landscapes.css';
import type { CollectionRoomItem } from './collection-types';
import { giftIcon } from './gift-icon';
import { mergeGalleryItems, readPublicGallery, type PublicLandscapePage } from './public-gallery';

const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

/** Public panoramas are the preview, never an original upload or miniature. */
export function publicLandscapeMarkup(items: readonly CollectionRoomItem[], options: { more?: boolean; loading?: boolean; error?: string } = {}): string {
  return `<main class="public-landscapes"><header class="public-landscapes-header"><a class="brand" href="#/home"><img class="brand-image" src="/assets/portal-dusk/brand-mark.png" alt=""/><span>GiftPortals</span></a><a class="button button-small" href="#/make">${giftIcon}Create a landscape</a></header><section class="public-landscapes-intro"><span class="eyebrow">THE PUBLIC LANDSCAPE GALLERY</span><h1>A place to step inside.</h1><p>Explore worlds shared by their creators. Open a landscape and look around, without an account.</p></section><section class="public-landscapes-grid" aria-label="Public generated landscapes">${items.map(item => `<a class="public-landscape-card" href="#/${esc(item.worldPath || item.openPath)}">${item.imageUrl && (!item.mediaExpiresAt || item.mediaExpiresAt > Date.now() / 1000) ? `<img src="${esc(item.imageUrl)}" alt="Generated landscape: ${esc(item.title)}" loading="lazy" referrerpolicy="no-referrer"/>` : '<div class="public-landscape-preview"><span>3D landscape</span></div>'}<div><span class="eyebrow">${esc(item.demo ? 'ORIGINAL LANDSCAPE EXAMPLE' : 'SHARED LANDSCAPE')}</span><h2>${esc(item.title)}</h2><span class="text-link">Explore this world ↗</span></div></a>`).join('') || '<div class="empty-state"><h2>The next world starts with you.</h2><p>Create a landscape to share it in this gallery.</p></div>'}</section>${options.more ? `<div class="public-landscapes-more"><button class="button" type="button" data-public-more ${options.loading ? 'disabled' : ''}>${options.loading ? 'Loading more landscapes…' : options.error ? 'Try loading more again' : 'Load more landscapes'}</button></div>` : ''}${options.error ? `<p class="public-landscapes-note" role="status">${esc(options.error)}</p>` : ''}<p class="public-landscapes-note">The gallery shows generated landscapes and their titles. Original source photos, names and personal stories remain private.</p><footer><a href="#/home">Back home</a><a href="#/about">About GiftPortals</a></footer></main>`;
}

export function mountPublicLandscapeGallery(host: HTMLElement, initial: PublicLandscapePage, examples: readonly CollectionRoomItem[], isCurrent: () => boolean, reader = readPublicGallery): { destroy(): void } {
  const abort = new AbortController(); let dead = false, loading = false, error = '', cursor = initial.nextCursor;
  let published = initial.items;
  const active = () => !dead && !abort.signal.aborted && isCurrent();
  const render = () => {
    if (!active()) return;
    host.innerHTML = publicLandscapeMarkup(mergeGalleryItems(published, examples), { more: Boolean(cursor), loading, error });
    const button = host.querySelector<HTMLButtonElement>('[data-public-more]');
    if (button) button.onclick = async () => {
      if (!active() || loading || !cursor) return;
      loading = true; error = ''; render();
      try {
        const page = await reader(abort.signal, undefined, cursor); if (!active()) return;
        if (!page.enabled) throw new Error('The public gallery is unavailable right now.');
        published = mergeGalleryItems(published, page.items); cursor = page.nextCursor;
      } catch { if (active()) error = 'More landscapes could not be loaded. The worlds already shown remain available.'; }
      finally { if (active()) { loading = false; render(); } }
    };
  };
  render(); return { destroy() { if (dead) return; dead = true; abort.abort(); } };
}

/** Static original examples stay available without uploading any private gift. */
export function publicLandscapeExamples(items: readonly CollectionRoomItem[]): CollectionRoomItem[] {
  const panoramas: Record<string, string> = {
    'rio-example': '/demo/rio-world-pano.png',
    'paris-example': '/demo/v23/paris-approach-panorama.png',
    'antikythera-example': '/demo/v13/antikythera-panorama.png',
  };
  return items.filter(item => Object.hasOwn(panoramas, item.id) && Boolean(item.worldPath)).map(item => ({
    id: item.id, title: item.title, subtitle: 'Original landscape example', story: '', imageUrl: panoramas[item.id],
    openPath: `${item.worldPath}&landscape=1`, worldPath: `${item.worldPath}&landscape=1`, kind: 'generated', demo: true, photoIntent: 'place',
  }));
}
