import * as THREE from 'three';
import './gift-unboxing.css';

export type UnboxingStep = 'wrapped' | 'ribbon' | 'lid' | 'revealed';
const steps: readonly UnboxingStep[] = ['wrapped', 'ribbon', 'lid', 'revealed'];
const clamp = THREE.MathUtils.clamp;
export interface UnboxingState { target: number; progress: number; reduced: boolean; dead: boolean }
export function createUnboxingState(reduced = false): UnboxingState { return { target: 0, progress: 0, reduced, dead: false }; }
export function unboxingStep(state: UnboxingState): UnboxingStep { return steps[state.target]; }
export function unboxingAdvance(state: UnboxingState): boolean {
  if (state.dead || state.target >= 3 || Math.abs(state.target - state.progress) > .0001) return false;
  state.target++; if (state.reduced) state.progress = state.target; return true;
}
export function unboxingTick(state: UnboxingState, elapsed: number): boolean {
  if (state.dead) return false;
  if (state.reduced) state.progress = state.target;
  else if (Number.isFinite(elapsed)) state.progress = Math.min(state.target, state.progress + clamp(elapsed, 0, .05) / .78);
  return state.progress < state.target;
}
export function unboxingReduce(state: UnboxingState, reduced: boolean): void { if (state.dead) return; state.reduced = reduced; if (reduced) state.progress = state.target; }

export interface GiftUnboxingOptions {
  host: HTMLElement; parent: THREE.Object3D; model: THREE.Object3D; extra?: readonly THREE.Object3D[];
  bounds: THREE.Box3; reduced: boolean; requestFrame(): void; onReveal?(): void;
}
/** Accessible three-step HTML gift note around an already-decoded sponsor model.
 * No 3D wrapping is authored. Animation uses the viewer's existing frame gate. */
export function mountGiftUnboxing(options: GiftUnboxingOptions) {
  const state = createUnboxingState(options.reduced);
  const objects = [options.model, ...(options.extra || [])], originalVisibility = objects.map(object => object.visible);
  const size = options.bounds.getSize(new THREE.Vector3());
  objects.forEach(object => object.visible = false);

  const ui = document.createElement('section'); ui.className = 'gu-unboxing'; ui.setAttribute('aria-label', 'Open your gift');
  const status = document.createElement('p'); status.className = 'gu-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const action = document.createElement('button'); action.type = 'button'; action.className = 'gu-action';
  const label = document.createElement('span'), hint = document.createElement('small'); hint.className = 'gu-hint'; hint.textContent = 'A little world, waiting for you';
  action.append(label); ui.append(status, action, hint); options.host.append(ui);
  const icons = [
    '<path d="M4 13h16M12 5v15M6 9c-6-5 0-8 6-2 6-6 12-3 6 2H6Z"/><path d="m17 16 3-3-3-3"/>',
    '<path d="M4 10h16v11H4V10ZM3 6h18v4H3V6Z"/><path d="m9 4 3-3 3 3M12 1v5"/>',
    '<path d="M4 12v9h16v-9M12 3v13m-4-4 4 4 4-4M4 5l2 2M20 5l-2 2"/>',
  ];
  const labels = ['Open your gift', 'Discover the memory', 'Reveal your keepsake'], messages = ['A little moment, made for you.', 'Every place carries a story.', 'A place you can keep close.', 'Your gift is ready. Drag to explore.'];
  let announced = -1, revealed = false, pointer: {id: number; y: number} | undefined, suppressClick = false;
  function syncUI() {
    const settled = Math.abs(state.progress - state.target) < .0001;
    action.disabled = !settled || state.target === 3; action.hidden = state.target === 3; hint.hidden = state.target === 3;
    if (settled && announced !== state.target) { announced = state.target; status.textContent = messages[state.target]; }
    if (state.target < 3) { label.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[state.target]}</svg><span>${labels[state.target]}</span>`; action.setAttribute('aria-label', labels[state.target]); }
    if (state.target === 3 && settled && !revealed) { revealed = true; ui.classList.add('is-revealed'); options.onReveal?.(); }
  }
  function apply() {
    // Only the real model becomes visible, after the final deliberate action.
    objects.forEach((object, index) => object.visible = state.progress >= 3 && originalVisibility[index]);
    ui.setAttribute('data-step', unboxingStep(state));
    syncUI();
  }
  function advance() { if (unboxingAdvance(state)) { apply(); options.requestFrame(); } }
  const events = new AbortController();
  action.addEventListener('click', () => { if (suppressClick) { suppressClick = false; return; } advance(); }, {signal: events.signal});
  action.addEventListener('pointerdown', event => { if (event.button !== 0 || action.disabled) return; pointer = {id: event.pointerId, y: event.clientY}; try { action.setPointerCapture(event.pointerId); } catch {} }, {signal: events.signal});
  action.addEventListener('pointerup', event => { if (!pointer || pointer.id !== event.pointerId) return; const pull = pointer.y - event.clientY > 30; pointer = undefined; try { action.releasePointerCapture(event.pointerId); } catch {} if (pull) { suppressClick = true; advance(); } }, {signal: events.signal});
  action.addEventListener('pointercancel', () => { pointer = undefined; }, {signal: events.signal});
  apply();
  return {
    advance, size, get step() { return unboxingStep(state); }, get revealed() { return revealed; },
    update(elapsed: number) { const moving = unboxingTick(state, elapsed); apply(); return moving; },
    setReduced(reduced: boolean) { unboxingReduce(state, reduced); apply(); options.requestFrame(); },
    destroy() { if (state.dead) return; state.dead = true; events.abort(); pointer = undefined; ui.remove(); objects.forEach((object, index) => object.visible = originalVisibility[index]); },
  };
}
