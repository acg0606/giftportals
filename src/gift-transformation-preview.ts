import { mountGiftTransformation, type GiftTransformationHandle } from './gift-transformation';
import type { GiftTransformationPhase } from './gift-transformation-state';
import { giftIcon } from './gift-icon';
import './gift-transformation-preview.css';

/** Visual rehearsal with cached public assets, isolated from creator storage,
 * paid services, private jobs and progress polling. */
export function mountGiftTransformationPreview(host: HTMLElement, options: { isCurrent(): boolean; onCreate(): void }) {
  let dead = false, playing = false, interruptedPreview = false, phaseIndex = 0, timer: number | undefined, revealTimer: number | undefined, loadEpoch = 0;
  let model: ReturnType<typeof import('./scene')['mountMemoryScene']> | undefined;
  const events = new AbortController(), motion = matchMedia('(prefers-reduced-motion: reduce)');
  const phases: GiftTransformationPhase[] = ['awakening', 'shaping', 'world', 'ready'];
  const active = () => !dead && host.isConnected && options.isCurrent();
  const originalClassName = host.className;
  host.className = 'gt-preview';
  host.innerHTML = `<header><a href="#/home" aria-label="GiftPortals home">${giftIcon}<span>GiftPortals</span></a><button type="button" data-gtp-create>Create a gift →</button></header><main><div class="gtp-intro"><span>ANIMATION PREVIEW</span><h1>A little transformation.</h1><p>A photo becomes a little world. Watch the light give it shape.</p></div><div class="gtp-card"><div data-gtp-stage></div><p class="gtp-model-note" data-gtp-model-note hidden role="status">Opening the existing 3D keepsake…</p><div class="gtp-controls" aria-label="Preview stages"><button type="button" data-gtp-phase="0">1 · Awaken</button><button type="button" data-gtp-phase="1">2 · Shape</button><button type="button" data-gtp-phase="2">3 · World</button><button type="button" data-gtp-phase="3">4 · Reveal</button></div><div class="gtp-play"><button type="button" data-gtp-play>Play transformation</button><button type="button" data-gtp-interrupt>Preview interruption</button></div><p class="gtp-disclosure">Visual rehearsal using an existing Rio keepsake. No new gift is being created.</p></div></main>`;
  const find = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const stage: GiftTransformationHandle = mountGiftTransformation(find('[data-gtp-stage]'), { isCurrent: active, onOpenKeepsake: () => void openModel() });
  function stopModel() { loadEpoch++; clearTimeout(revealTimer); model?.destroy(); model = undefined; stage.setModelVisible(false); stage.modelHost.replaceChildren(); find('[data-gtp-model-note]').hidden = true; }
  async function openModel() {
    if (!active() || phaseIndex < 2) return;
    if (model) { model.reset(); return; }
    const epoch = ++loadEpoch;
    const current = () => active() && epoch === loadEpoch && phaseIndex >= 2;
    find('[data-gtp-model-note]').hidden = false;
    find('[data-gtp-model-note]').textContent = 'Opening the existing 3D keepsake…';
    try {
      const { mountMemoryScene } = await import('./scene'); if (!current()) return;
      let failed = false;
      const handle = mountMemoryScene(stage.modelHost, {
        modelUrl: '/demo/rio-keepsake.glb', photoIntent: 'object', theme: 'dusk',
        onReady: () => {
          if (!current()) return;
          stage.setModelVisible(true); find('[data-gtp-model-note]').hidden = true;
          model?.setAutoRotate(!motion.matches);
          if (!motion.matches) { model?.setWireframe(true); revealTimer = window.setTimeout(() => { if (current()) model?.setWireframe(false); }, 1400); }
        },
        onError: () => { if (!current()) return; failed = true; stopModel(); find('[data-gtp-model-note]').hidden = false; find('[data-gtp-model-note]').textContent = 'The 3D preview could not open. Choose Reveal 3D keepsake to try again.'; },
      });
      if (!current() || failed) { handle.destroy(); return; } model = handle;
    } catch { if (current()) { stopModel(); find('[data-gtp-model-note]').hidden = false; find('[data-gtp-model-note]').textContent = 'The 3D preview could not open here.'; } }
  }
  function schedule() {
    clearTimeout(timer);
    if (!playing || document.hidden || !active()) return;
    timer = window.setTimeout(() => { if (!active() || !playing) return; if (phaseIndex >= 3) { playing = false; sync(); return; } show(phaseIndex + 1); }, phaseIndex === 2 ? 8000 : 6500);
  }
  function sync() { find('[data-gtp-play]').textContent = playing ? 'Pause sequence' : phaseIndex >= 3 ? 'Replay transformation' : 'Play transformation'; find('[data-gtp-play]').setAttribute('aria-pressed', String(playing)); }
  function show(index: number, interrupted = false) {
    phaseIndex = index; interruptedPreview = interrupted;
    if (index < 2 || interrupted) stopModel();
    stage.update({ jobId: 'public-animation-preview', phase: interrupted ? 'interrupted' : phases[index], photoUrl: '/assets/examples/v13/rio.jpg', ...(index >= 1 && !interrupted ? { referenceUrl: '/assets/portal-dusk/rio-keepsake.png' } : {}), modelReady: index >= 2 && !interrupted, ...(index >= 2 && !interrupted ? { modelUrl: '/demo/rio-keepsake.glb' } : {}) });
    host.querySelectorAll<HTMLButtonElement>('[data-gtp-phase]').forEach(button => button.setAttribute('aria-pressed', String(!interrupted && Number(button.dataset.gtpPhase) === index)));
    if (index >= 2 && !interrupted) void openModel();
    if (interrupted) { find('[data-gtp-model-note]').hidden = false; find('[data-gtp-model-note]').textContent = 'This preview is paused. Choose a stage or play the transformation again.'; }
    sync(); schedule();
  }
  find('[data-gtp-create]').addEventListener('click', () => { if (active()) options.onCreate(); }, { signal: events.signal });
  host.querySelectorAll<HTMLButtonElement>('[data-gtp-phase]').forEach(button => button.addEventListener('click', () => { playing = false; show(Number(button.dataset.gtpPhase)); }, { signal: events.signal }));
  find('[data-gtp-play]').addEventListener('click', () => { if (!active()) return; playing = !playing; if (playing && (phaseIndex >= 3 || interruptedPreview)) show(0); else { sync(); schedule(); } }, { signal: events.signal });
  find('[data-gtp-interrupt]').addEventListener('click', () => { playing = false; show(0, true); }, { signal: events.signal });
  document.addEventListener('visibilitychange', schedule, { signal: events.signal });
  motion.addEventListener('change', () => { if (motion.matches) { playing = false; clearTimeout(timer); clearTimeout(revealTimer); model?.setWireframe(false); model?.setAutoRotate(false); sync(); } }, { signal: events.signal });
  show(0); playing = !motion.matches; sync(); schedule();
  return { destroy() { if (dead) return; dead = true; events.abort(); clearTimeout(timer); stopModel(); stage.destroy(); host.replaceChildren(); host.className = originalClassName; } };
}
