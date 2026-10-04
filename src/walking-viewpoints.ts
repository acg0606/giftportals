import type { createFirstPersonPhysics } from './first-person-physics';

export interface WalkingViewpoint { id: string; name: string; position: readonly [number, number, number]; yaw: number }
type Controller = Awaited<ReturnType<typeof createFirstPersonPhysics>>;

/** Discover a few perspectives by actually walking the provider collider.
 * Paths use the same capsule, slopes and edge protection as the visitor.
 * The controller is restored before the first frame; unsupported space never
 * becomes a named viewpoint. This is a bounded local search, not a map. */
export function deriveWalkingViewpoints(controller: Controller, initialYaw = 0): readonly WalkingViewpoint[] {
  const yaw = Number.isFinite(initialYaw) ? initialYaw : 0;
  const arrival = controller.reset();
  const result: WalkingViewpoint[] = [{ id: 'arrival', name: 'Arrival', position: [...arrival], yaw }];
  const headings = [yaw, yaw - Math.PI / 4, yaw + Math.PI / 4, yaw - Math.PI / 2, yaw + Math.PI / 2];
  try {
    for (const heading of headings) {
      let position = controller.reset(), grounded = true;
      const step: [number, number, number] = [-Math.sin(heading) * .04, 0, -Math.cos(heading) * .04];
      for (let i = 0; i < 100; i++) {
        const next = controller.advance(position, step, 1 / 60);
        if (!next.grounded || !next.position.every(Number.isFinite)) { grounded = false; break; }
        const progressed = Math.hypot(next.position[0] - position[0], next.position[2] - position[2]);
        position = next.position;
        if (progressed < .004) break;
      }
      if (!grounded || result.some(point => Math.hypot(point.position[0] - position[0], point.position[2] - position[2]) < 1.8)) continue;
      result.push({ id: `perspective-${result.length}`, name: result.length === 1 ? 'Along the path' : 'Another perspective', position: [...position], yaw: heading });
      if (result.length === 3) break;
    }
    return result;
  } finally { controller.reset(); }
}
