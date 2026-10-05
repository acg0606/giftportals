import './public-landscapes.css';
import { mountGeneratedWorld } from './generated-world';
import type { GeneratedGiftData } from './generated-gift';

/** The existing world renderer supplies look/flight controls for landscapes
 * without a walking collider. It never mounts a keepsake or personal story. */
export function mountPublicLandscape(host: HTMLElement, gift: GeneratedGiftData, isCurrent: () => boolean): { destroy(): void } {
  const events = new AbortController(); let dead = false;
  host.innerHTML = '<main class="public-landscape-viewer"><div class="public-landscape-world" data-public-world></div><header><h1 data-public-title></h1><a href="#/collection" aria-label="Return to the public gallery">×</a></header><p class="public-landscape-status" data-public-status role="status">Opening the landscape…</p><nav class="public-landscape-controls" aria-label="Landscape controls"><button type="button" data-public-back>Back</button><button type="button" data-public-forward>Forward</button><button type="button" data-public-reset>Reset</button></nav></main>';
  host.querySelector<HTMLElement>('[data-public-title]')!.textContent = gift.title;
  const active = () => !dead && isCurrent(), status = host.querySelector<HTMLElement>('[data-public-status]')!;
  const viewer = mountGeneratedWorld(host.querySelector<HTMLElement>('[data-public-world]')!, gift.worldUrl!, {
    panoramaUrl: gift.panoramaUrl, collisionUrl: gift.collisionUrl,
    points: [], freeFlight: true,
    onReady() { if (active()) status.textContent = 'Drag to look around · use Forward and Back to explore'; },
    onError(message) { if (active()) status.textContent = message; },
  });
  host.querySelector('[data-public-forward]')!.addEventListener('click', () => { if (active()) viewer.forward(); }, { signal: events.signal });
  host.querySelector('[data-public-back]')!.addEventListener('click', () => { if (active()) viewer.backward(); }, { signal: events.signal });
  host.querySelector('[data-public-reset]')!.addEventListener('click', () => { if (active()) viewer.reset(); }, { signal: events.signal });
  return { destroy() { if (dead) return; dead = true; events.abort(); viewer.destroy(); host.replaceChildren(); } };
}
