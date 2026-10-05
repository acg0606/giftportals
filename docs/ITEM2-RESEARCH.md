# Item 2: realistic worlds and mobile walking research

Reviewed October 5, 2026. **Research only. Implementation and generation trials wait until the user validates Item 1.** No worlds, generation settings, rendering code, billing settings or production deployment were changed for this research.

The strongest first experiment is to improve how completed worlds are displayed and navigated. A newer generation model is a separate experiment: this project already recorded terminal provider errors for both Marble 1.1 and 1.1 Plus, while full Marble 1.0 completed the affected photo worlds. Those results remain relevant even though World Labs now recommends 1.1 and describes Plus as its largest-world model. See [the project recovery evidence](WORLD-RECOVERY-2026-10-04.md) and [current model guidance](https://docs.worldlabs.ai/marble/models).

## Observed implementation

- [World recipes](../api/_lib/cloud-instant-service.ts) explicitly pin `marble-1.0`, using a regular scene image with `isPano:false` and `disableRecaption:true`. Existing accepted recipes remain immutable.
- [Shared art direction](../shared/gift-art-style.ts) already excludes oil painting and illustration. However, [catalog settings](../shared/instant-examples.ts) still contain “artistic” and “illustrated” directions, and use artistic reference images. The world prompt also shares the souvenir's collectible language and navy/cream palette. Their contribution to painterly results is a plausible input conflict, not a proven sole cause.
- [Completion storage](../api/_lib/cloud-instant-provider-http.ts) retains the 500k SPZ, falling back to 100k, plus panorama and collider. It does not retain the documented `full_res` export. Server validation limits each asset to 25 MiB, SPZ decoding to 64 MiB, and the selected world to 600,000 splats.
- [The viewer](../src/generated-world.ts) uses Spark 2.1.0 without `lod` or `paged`. Its `maxSplats` argument reserves capacity; it is not a quality upgrade or reliable hard cap. Spark expands that allocation when needed. [PackedSplats documentation](https://sparkjs.dev/docs/packed-splats/).
- Portrait world rendering caps pixel ratio at 1.0. Walking uses live Rapier capsule collision, supported-floor checks, continuous held movement, slow turns and reduced-motion handling. The 20 fps cinematic-flight throttle does **not** apply to first-person walking. [Viewer policy](../src/viewer-runtime.ts), [physics](../src/first-person-physics.ts), [tour](../src/walking-tour.ts).
- Guided discovery searches five bearings, retains at most two straight corridors, and stops each within approximately six metres. Four to six chapters revisit these corridors; longer pauses cannot expose additional connected space.

## Proposed experiments after Item 1 validation

1. **Compare the same completed world before paying for another.** Obtain its existing full-resolution export, build a quality LoD tree offline, and compare streamed RAD with the current 500k SPZ at identical poses. Spark supports quality LoD generation, paged RAD loading and platform-aware detail budgets. Keep `onDirty` driving the existing frame gate. LoD can allocate original detail around the camera; it cannot invent missing geometry. [Spark LoD](https://sparkjs.dev/docs/lod-getting-started/).

2. **Separate world realism from souvenir styling.** For a future world-only trial, preserve location, architecture and reviewed personal meaning while removing conflicting illustration and collectible styling from the environment recipe. Prefer a sharp, well-lit scene image with visible ground and depth. A genuine full 360-degree equirectangular panorama or multiple consistent scene views can constrain unseen directions better than one illustration. A phone's partial panorama or a wide banner must not be labelled a full panorama. [Image guidance](https://docs.worldlabs.ai/marble/create/prompt-guides/image-prompt), [API input examples](https://docs.worldlabs.ai/api/world-generation-examples).

3. **Test portrait sharpness adaptively.** Compare resolution scales 1.0, 1.25 and 1.5 on actual phones, lowering detail during movement and refining when stationary. At 1.5, pixel workload is approximately 2.25 times the current scale. Keep splat antialiasing disabled and the existing sRGB output/panorama colour handling; extra bloom or sharpening cannot repair absent detail. [Spark performance](https://sparkjs.dev/docs/performance/), [Three.js responsive rendering](https://threejs.org/manual/pages/responsive.html), [colour management](https://threejs.org/manual/pages/color-management.html).

4. **Explore connected paths rather than longer repetitions.** Build a bounded floor-connectivity graph from the original collider, then replay every proposed segment with the existing capsule in both directions. Select distinct, visually clear destinations; extend the route only where both visible world detail and supported geometry continue. Preserve pauses before sharp turns, edge refusal and reduced-motion still chapters. A collider debug view can expose mismatches before public testing. World Labs' interactive examples use this rendering/physics combination; Rapier requires movement corrections to be applied to the actual capsule. [World Labs examples](https://docs.worldlabs.ai/api/interactive-world-examples), [Rapier controller](https://rapier.rs/docs/user_guides/javascript/character_controller/).

5. **Try newer models only in an isolated comparison.** If provider health is established, compare one new 1.1 world and optionally Plus using the same approved reference and revised world prompt. Keep successful current worlds and Tripo keepsakes as controls. Do not replace stored assets or silently retry an ambiguous paid submission.

## Credits and practical constraints

| Future action | World API credits |
| --- | ---: |
| Re-render/repackage already completed splats | No new generation request |
| One standard 1.0/1.1 world from a regular image or text | 1,580 |
| One 1.1 Plus world from a regular image or text | 1,580–3,080 |
| Standard world from a validated full panorama | 1,500 |
| HQ mesh export | 3,500; not required for the existing collider workflow |
| PLY splat export | Free |

One 1.1 trial plus one Plus trial requires up to **4,660 credits**, approximately **$3.73** at the documented rate. These estimates exclude new Tripo work, source-image generation, hosting and storage. Recheck the current balance immediately before an approved trial; Item 1 can consume the previously observed balance. Plus needs a conservative 3,080-credit single-image reservation instead of the current hardcoded 1,580 check. [Current API pricing](https://docs.worldlabs.ai/api/pricing).

Full-resolution/RAD assets require a separately reviewed storage and delivery format: current private/public manifests, byte limits, SPZ validation and archive signing do not accept arbitrary large files or RAD chunks. Preserve source hashes, original colliders, access rules and retention; do not simply remove existing limits. Paged delivery also needs signed chunk URLs that remain valid throughout a session.

The current transform is consistent with the documented ordering: metric scaling and ground alignment, then the 180-degree X-axis conversion. Its Three.js `position.y=groundOffset` after that rotation is equivalent to `y=-scale*rawY+groundOffset`. Do not negate the offset again or apply it to Gaussian sizes. Verify the collider alignment alongside the rendered world before changing coordinates. [World Labs coordinate contract](https://docs.worldlabs.ai/api/rendering-spz).

Acceptance should use matched screenshots and a 60–90 second portrait walk on Android and iPhone, including simultaneous movement/look, turns, near-detail views, unsupported edges, app switching and reduced motion. Record frame pacing, loading time, path coverage, visual holes and drift. A reasonable proposed target is sustained 30 fps on the selected phone with improved close-up detail and no unsupported movement; this research has not established those results or guaranteed photorealistic reconstruction.
