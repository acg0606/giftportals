# V24 first-person reference review

Reviewed on 2026-10-03. This is a source inspection of the three repositories selected by the user and the existing V23 GiftPortals viewer. It is not a visual parity claim, a performance benchmark, or proof that V24 controls are already integrated.

## Pinned primary sources

The following `main` revisions were resolved through the unauthenticated GitHub commit/tree API during this review. Links are pinned so a subsequent upstream change does not silently change the evidence.

| Reference | Revision | Sources inspected | License notice |
| --- | --- | --- | --- |
| Image Blaster | `4acb43ba126a12358f71838d1b1a05e856b10eaf` | [CharacterController](https://github.com/neilsonnn/image-blaster/blob/4acb43ba126a12358f71838d1b1a05e856b10eaf/app/src/modules/character/CharacterController.tsx), [FlyController](https://github.com/neilsonnn/image-blaster/blob/4acb43ba126a12358f71838d1b1a05e856b10eaf/app/src/modules/character/FlyController.tsx), [WorldCollider](https://github.com/neilsonnn/image-blaster/blob/4acb43ba126a12358f71838d1b1a05e856b10eaf/app/src/modules/collider/WorldCollider.tsx), [SplatRenderer](https://github.com/neilsonnn/image-blaster/blob/4acb43ba126a12358f71838d1b1a05e856b10eaf/app/src/modules/splat/SplatRenderer.tsx), [WorldViewer](https://github.com/neilsonnn/image-blaster/blob/4acb43ba126a12358f71838d1b1a05e856b10eaf/app/src/components/WorldViewer.tsx) | [MIT](https://github.com/neilsonnn/image-blaster/blob/4acb43ba126a12358f71838d1b1a05e856b10eaf/LICENSE.md), copyright 2026 Neilson Koerner-Safrata |
| Spark Physics | `308fbf8d0d9a336112c57697a0b0499d16b31504` | [main.js](https://github.com/bmild/spark-physics/blob/308fbf8d0d9a336112c57697a0b0499d16b31504/src/main.js), [package.json](https://github.com/bmild/spark-physics/blob/308fbf8d0d9a336112c57697a0b0499d16b31504/package.json) | [MIT](https://github.com/bmild/spark-physics/blob/308fbf8d0d9a336112c57697a0b0499d16b31504/LICENSE), copyright 2025 bmild |
| Gaussian Splat Character Controller | `4e67a73407a48826a7813f59c6f540e4ad510aec` | [main.js](https://github.com/icurtis1/gaussian-splat-character-controller/blob/4e67a73407a48826a7813f59c6f540e4ad510aec/src/main.js), [package.json](https://github.com/icurtis1/gaussian-splat-character-controller/blob/4e67a73407a48826a7813f59c6f540e4ad510aec/package.json) | [MIT](https://github.com/icurtis1/gaussian-splat-character-controller/blob/4e67a73407a48826a7813f59c6f540e4ad510aec/LICENSE), copyright 2026 Ian Curtis |

World Labs lists these repositories as interactive examples, confirming that controllers, meshes, physics, and audio belong in the application layer. A static Marble asset does not preclude walking through it. [Official interactive examples](https://docs.worldlabs.ai/api/interactive-world-examples).

## What creates the stronger experience

**Image Blaster:** the walking controller uses a dynamic capsule, gravity, grounded jump checks, held-key state, and a camera attached to the body. Its movement is updated every frame; mouse smoothing depends on elapsed time. Walking speed and a consistent eye height are explicit. The splat and collider share world transforms, including a metric scale. The wider workflow separates scenery from dynamic objects and audio rather than expecting a single static splat to animate. Its viewer enables Spark LoD, but its renderer shader patches are specific to its installed version and should not be copied into our Spark 2.1.0 without verification.

**Spark Physics:** a dynamic player capsule collides with the environment; held keys set velocity rather than advancing once per keyboard repeat. Physics advances at a fixed 1/60-second step with at most five substeps. Pointer lock provides unbounded mouse look. Animated character meshes and spatial sound add activity, independently of the static scenery. This reference deliberately uses pixel ratio 1; its appeal is not explained by a higher retina resolution alone. [Controller and loop](https://github.com/bmild/spark-physics/blob/308fbf8d0d9a336112c57697a0b0499d16b31504/src/main.js#L418-L438).

**Ian Curtis controller:** a kinematic capsule uses Rapier's corrected movement, sliding, autostep, ground snapping, and slope limits. Walk/run/jump and gamepad input make navigation an active experience. Post-processing changes the presentation but does not create missing depth. Its code is useful architectural evidence, not a numerical template: the inspected horizontal displacement passed to `computeColliderMovement` is not multiplied by the measured frame delta. Reimplement movement in units per second and verify consistent travel at different frame rates. [Character correction](https://github.com/icurtis1/gaussian-splat-character-controller/blob/4e67a73407a48826a7813f59c6f540e4ad510aec/src/main.js#L1125-L1209).

## Local V23 causes and limits

These observations describe the source inspected before V24 integration. Subsequent changes must be checked independently.

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Movement is event based | `src/generated-world.ts`, `move`, `elevate`, and `keydown`: each event advances 0.12 walking units or the configured 0.32 flight units. No held-key update loop or keyup exists. | Initial keyboard delay, then platform-dependent repeats, produces pulses instead of a continuous walk. |
| Exploration has short artificial bounds | `src/world-navigation.ts`: ground movement stops 2.5 raw units from the initial origin. Paris flight supplies a manual radius of 4 raw units. | The person can reach an invisible limit even when a path appears open. |
| Ground checks are thin rays | `src/world-navigation.ts`: one downward ray and two forward ray heights; no capsule sweep, wall sliding, or gravity body. | Collision has no human body volume and cannot provide reference-quality step/slide behavior. Floor filtering also accepts `abs(normal.y)`, which can treat downward-facing undersides as floor. |
| Walking starts from the decoder origin | `createGroundNavigation(collider, origin)`; origin begins at `(0, 0, 0.03)`, not a reviewed ground spawn per chapter. | Scene-dependent eye height or unavailable walking; an aerial arrival is not a valid human spawn automatically. |
| Active motion is capped at 20 fps | Explicit `1000 / 20` guard in `src/generated-world.ts` when ambient light, tour, or focus flight is active. | Camera motion cannot be responsive at display refresh rate even on a capable GPU. Actual achieved fps still requires measurement. |
| Rendering favors low power | WebGL `powerPreference: 'low-power'`; place DPR cap 1 mobile / 1.25 desktop in `src/viewer-runtime.ts`. | Conservative device behavior is intentional; blindly increasing pixels could make motion worse on the 8 GB notebook. |
| The panorama has no positional parallax | V23 sets a same-world equirectangular texture as `scene.background`. | **Inference:** distant image detail can conceal splat holes while reinforcing the impression of a photograph when little nearby geometry moves. Compare identical camera travel with and without the backdrop. |
| The actual Paris assets contain 500k splats | Public V23 manifest; approximately 7.95–8.14 MB per normal SPZ. | More splats may improve detail, but they cannot fix event-based controls, absent collision, or a poor spawn. The full-resolution files are not present in this public manifest. |
| Metric semantics are omitted | Viewer/exporter contain no `semantics_metadata`, `metric_scale_factor`, or `ground_plane_offset`; the asset and collider receive an X-axis half turn only. | Human speed, capsule size, eye height, and walking radius cannot be described as meters. Use returned metadata when available, or a reviewed artistic scale clearly labeled as such. |

World Labs now documents conversion from raw generated coordinates into a metric ground-aligned frame, followed by renderer axis conversion. Apply matching transforms to splats, collider, camera poses, and interaction anchors; transforming only one breaks alignment. Use each world's values rather than the documentation's example numbers. Existing reviewed V23 camera paths would need conversion too. [Official SPZ scale guidance](https://docs.worldlabs.ai/api/rendering-spz).

For V24 first-person mode only, cached sanitized provider receipts supply scale/ground-offset pairs of `2.578505 / 1.5054234` for the V22 promenade and `2.9049978 / 1.6893421` for the V23 approach. With the existing X-axis half turn, metric positions are `[rawX * scale, rotatedRawY * scale + groundOffset, rotatedRawZ * scale]`; the splat and collider receive the same transform. The reviewed metric eye spawns are approximately `[-1.28925, -0.31256, -1.28925]` and `[0, 1.32969, 0]`, respectively. Rapier then locates the actual collider floor and applies its small collision offset. The body uses a 1.65 m eye height and a 0.20 m capsule radius. The provider's estimated plane does not put every local paving surface at `y = 0`; use the actual floor rather than moving the camera to an invented ground plane. Existing cinematic routes retain their reviewed raw coordinates and transforms. Seven actual Rapier WASM integration tests passed, including more than 16.5 m of continuous forward movement on both cached transformed colliders; this establishes local controller behavior, not geographic survey accuracy, browser performance, or visual parity.

## Minimal useful V24 for this notebook

1. Make a reviewed ground spawn and walkable area the default entry. Keep aerial views as a separate action; do not begin an ordinary walk halfway through an automatic flight.
2. Track held keys and touch directions, then integrate speed using bounded elapsed time. Normalize diagonal input. Clear input on blur, lost pointer lock, hidden tab, chapter switch, and disposal. Ignore editable fields. Provide press-and-hold direction controls on touch.
3. Use a capsule-shaped character and genuine collider correction. A bounded capsule/BVH implementation can reuse the installed `three-mesh-bvh`; a lightweight Rapier integration is another option. Either must demonstrate walls, slopes, steps, and edge behavior on the actual exported collider. Do not equate two thin rays with a capsule controller.
4. Support pointer lock when the browser permits it, with a visible entry action and Escape exit. Keep drag look available when lock is unsupported. A sandbox refusal should lead to an immediately usable fallback.
5. Aim for 30–60 fps during active input, then stop rendering when idle/offscreen. Measure actual frame time before raising quality. Keep one active world/context, no full-resolution preload, and the existing 500k assets first.
6. Demonstrate parallax past nearby trees, railings, stonework, or the boat. Use the collider to review that route and its spawn. Gate higher-resolution assets on a measured budget rather than downloading every world at once.
7. Compare the backdrop on/off with identical movement. Add restrained environmental activity only after walking works: a few separate lightweight meshes and optional spatial sound. Blur, film grain, bloom, particles, or camera bob cannot repair missing navigation. Respect reduced-motion preference.

New sponsor generation calls are not required to validate these changes. The generated SPZ/collider pairs already available locally are sufficient for a first-person control experiment.

## Acceptance evidence still required

- Record continuous walking past nearby geometry, including turns and release of movement; compare the same route before/after.
- Check equal distance after the same duration at 30 and 60 fps, normalized diagonal speed, maximum resume delta, and no movement after input loss.
- Exercise a wall at frontal and oblique angles, a step, a slope, an open edge, and a spawn with no floor. Avoid placing an invisible plane over the entire scenery merely to make walking appear successful.
- Measure actual frame timing and memory on the notebook. A requested fps cap is not an achieved frame rate, and browser screenshot capture fps is not renderer fps.
- Test desktop pointer-lock success/refusal, keyboard, touch hold, story opening/closing, chapter return, and disposal. Verify the receiver can explore without typing control names.
- Document separate scenes as separate scenes. The three generated Paris chapters are not one continuous surveyed map. This review does not establish visual parity with any linked demo.

## Attribution suggestion

No upstream code or demo media was copied during this source review. If implementation copies or adapts substantial source, add an attribution entry naming the project, author, pinned revision, adapted files, and the full corresponding MIT copyright/permission notice. Preserve each upstream license as its own notice rather than collapsing the authors into one. The repositories' software licenses do not by themselves establish redistribution rights for every generated or third-party character, music track, world, or example asset. Prefer the existing GiftPortals-generated assets for this experiment.
