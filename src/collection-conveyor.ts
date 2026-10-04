/** Display motion only. Each slot retains its original authorized gift. The
 * quiet return rail is decorative; items wrap along the front display lane. */
export const CONVEYOR_SPEED = .38;
export const CONVEYOR_LENGTH = 19.5;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
export const conveyorWrap = (value: number, length = CONVEYOR_LENGTH) => Number.isFinite(value) && Number.isFinite(length) && length > 0 ? ((value % length) + length) % length : 0;
const shortest = (from: number, to: number, length: number) => {
 const forward = conveyorWrap(to - from, length);
 return forward > length / 2 ? forward - length : forward;
};
export interface CollectionConveyorState { count: number; offset: number; target: number; length: number; halfSpan: number; playing: boolean; reduced: boolean; cursor: number }
export function createCollectionConveyor(count: number, reduced = false): CollectionConveyorState {
 count = Number.isFinite(count) ? clamp(Math.floor(count), 0, 6) : 0;
 const halfSpan = 4.875, length = halfSpan * 2 * Math.max(1, count / 3);
 return { count, offset: 0, target: 0, length, halfSpan, playing: count > 0 && !reduced, reduced, cursor: Math.min(1, Math.max(0, count - 1)) };
}
/** A narrow viewport uses a shorter lane for one or two souvenirs. Their front
 * remains visible rather than spending most of a lap on a hidden rear rail. */
export function conveyorSetLaneHalf(state: CollectionConveyorState, halfSpan: number): void {
 if (!Number.isFinite(halfSpan) || state.count > 2) return;
 halfSpan = clamp(halfSpan, state.count === 1 ? 1.7 : 3, 4.875);
 const oldLength = state.length;
 state.halfSpan = halfSpan; state.length = halfSpan * 2;
 state.offset = conveyorWrap(state.offset / oldLength * state.length, state.length);
 state.target = conveyorWrap(state.target / oldLength * state.length, state.length);
}
function initialX(state: CollectionConveyorState, index: number): number {
 if (state.count < 2) return 0;
 return (state.count === 2 ? .5 - index : 1 - index) * state.length / state.count;
}
export function conveyorPoint(state: CollectionConveyorState, index: number): { x: number; z: number; front: true } {
 const x = conveyorWrap(initialX(state, index) - state.offset + state.length / 2, state.length) - state.length / 2;
 return { x, z: .9, front: true };
}
export function conveyorSetPlaying(state: CollectionConveyorState, playing: boolean): boolean {
 state.playing = Boolean(playing) && !state.reduced && state.count > 0;
 state.target = state.offset;
 return state.playing;
}
export function conveyorSetReduced(state: CollectionConveyorState, reduced: boolean): void {
 state.reduced = reduced;
 if (reduced) conveyorSetPlaying(state, false);
}
export function conveyorNearest(state: CollectionConveyorState): number {
 let nearest = 0, distance = Infinity;
 for (let i = 0; i < state.count; i++) { const value = Math.abs(conveyorPoint(state, i).x); if (value < distance) { distance = value; nearest = i; } }
 return nearest;
}
/** Next brings the incoming right-hand souvenir into the center, matching the
 * right-to-left belt. Reduced motion applies only this explicit user action. */
export function conveyorStep(state: CollectionConveyorState, direction: -1 | 1): void {
 conveyorSetPlaying(state, false);
 if (!state.count || direction !== -1 && direction !== 1) return;
 state.cursor = (state.cursor - direction + state.count) % state.count;
 state.target = conveyorWrap(initialX(state, state.cursor), state.length);
 if (state.reduced) state.offset = state.target;
}
/** Direct, finite drag displacement; there is no continuing momentum. */
export function conveyorScrub(state: CollectionConveyorState, delta: number): void {
 conveyorSetPlaying(state, false);
 if (!Number.isFinite(delta) || !state.count) return;
 state.offset = state.target = conveyorWrap(state.offset + clamp(delta, -3.25, 3.25), state.length);
 state.cursor = conveyorNearest(state);
}
export function conveyorAdvance(state: CollectionConveyorState, elapsed: number): boolean {
 const dt = Number.isFinite(elapsed) ? clamp(elapsed, 0, .05) : 0;
 if (state.playing && !state.reduced) { state.offset = state.target = conveyorWrap(state.offset + CONVEYOR_SPEED * dt, state.length); state.cursor = conveyorNearest(state); }
 else {
  const delta = shortest(state.offset, state.target, state.length);
  state.offset = conveyorWrap(state.offset + (state.reduced ? delta : delta * (1 - Math.exp(-dt * 9))), state.length);
  if (Math.abs(delta) < .0001) state.offset = state.target;
 }
 return state.playing || Math.abs(shortest(state.offset, state.target, state.length)) > .0001;
}
