import type { MemoryDTO } from '../shared/contracts';
import { miniArt } from './art';

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
let stopActive: (() => void) | null = null;

export function cancelTrain() { stopActive?.(); }

/** Disabled/hidden controls cannot form a keyboard boundary, including absent narration. */
export function trainFocusBoundary<T extends { disabled?: boolean; hidden?: boolean }>(buttons: readonly T[], active: unknown, backwards: boolean): T | null {
  const available = buttons.filter(button => !button.disabled && !button.hidden);
  const first = available[0], last = available[available.length - 1];
  if (!first) return null;
  if (!available.includes(active as T)) return backwards ? last : first;
  return backwards ? active === first ? last : null : active === last ? first : null;
}

export function takeMemoryTrain(destination: string, authorizedMemories: readonly MemoryDTO[]): Promise<string[]> {
  cancelTrain();
  const host = document.querySelector<HTMLElement>('#journey')!;
  const fragments = authorizedMemories.slice(0, 3);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const previousFocus = document.activeElement as HTMLElement | null;
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    let audio: HTMLAudioElement | null = null;
    host.innerHTML = `<div class="train-overlay ${reduced ? 'reduced-journey' : ''}" role="dialog" aria-modal="true" aria-labelledby="train-title"><div class="train-top"><span class="eyebrow">THE MEMORY LINE</span><button class="quiet-button" data-train-skip>Skip journey <span aria-hidden="true">↗</span></button></div><h2 id="train-title">Next stop: ${escape(destination)}</h2><p>A little of the journey comes with us.</p><div class="train-window"><div class="train-sky"></div><div class="train-mountains"></div><div class="train-cloud cloud-one"></div><div class="train-cloud cloud-two"></div><div class="train-rail"></div>${fragments.map((memory, i) => `<div class="train-fragment fragment-${i}"><span class="fragment-stamp">${escape(memory.location.label)}</span><div class="fragment-art">${memory.media.find((item) => item.kind === 'gift-photo') ? `<img src="${escape(memory.media.find((item) => item.kind === 'gift-photo')!.url)}" alt="A fragment from ${escape(memory.title)}" />` : miniArt(i === 0 ? 'cup' : i === 1 ? 'shell' : 'bird')}</div><p>${escape(memory.title)}</p></div>`).join('')}<div class="window-frame"></div><div class="train-seat"></div></div><div class="train-bottom"><span>${reduced ? 'Reduced motion · a quiet arrival' : 'A ten-second passage through shared memories'}</span><div><button class="quiet-button" data-train-replay>Replay</button><button class="quiet-button" data-train-sound aria-pressed="false">Sound off</button></div></div><div class="journey-progress" aria-hidden="true"><span></span></div></div>`;
    const end = () => {
      if (done) return;
      done = true; clearTimeout(timer); audio?.pause();
      document.removeEventListener('keydown', key); host.innerHTML = ''; stopActive = null;
      previousFocus?.focus(); resolve(fragments.map((memory) => memory.id));
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') end(); if (event.key === 'Tab') { const next = trainFocusBoundary([...host.querySelectorAll<HTMLButtonElement>('button')], document.activeElement, event.shiftKey); if (next) { event.preventDefault(); next.focus(); } } };
    document.addEventListener('keydown', key);
    stopActive = end;
    const start = () => { clearTimeout(timer); const overlay = host.firstElementChild!; overlay.classList.remove('journey-running'); void (overlay as HTMLElement).offsetWidth; overlay.classList.add('journey-running'); timer = setTimeout(end, reduced ? 1500 : 10000); };
    host.querySelector<HTMLButtonElement>('[data-train-skip]')!.onclick = end;
    host.querySelector<HTMLButtonElement>('[data-train-replay]')!.onclick = start;
    const sound = host.querySelector<HTMLButtonElement>('[data-train-sound]')!;
    const audioMedia = fragments.flatMap((item) => item.media).find((item) => item.kind === 'audio');
    sound.disabled = !audioMedia;
    if (!audioMedia) sound.textContent = 'No narration on this route';
    sound.onclick = async () => {
      if (!audioMedia) return;
      if (!audio) { audio = new Audio(audioMedia.url); audio.volume = 0.35; }
      if (audio.paused) { try { await audio.play(); sound.textContent = 'Sound on'; sound.setAttribute('aria-pressed', 'true'); } catch { sound.textContent = 'Audio unavailable'; } }
      else { audio.pause(); sound.textContent = 'Sound off'; sound.setAttribute('aria-pressed', 'false'); }
    };
    start(); host.querySelector<HTMLButtonElement>('[data-train-skip]')!.focus();
  });
}
