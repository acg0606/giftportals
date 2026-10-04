# V25 living garden and dusk sky

Open `#/paris-walk`, choose **Start walking**, and use held WASD or the directional pad. **Stroll** walks forward; **Journal** opens the existing travel book and pauses the visitors. Return to the walk to continue. Drag to look around. The Paris gift retains its walking entry, and the earlier cinematic route remains at `#/paris-flight`.

## Changes

Two original stylized visitors walk along short, separate promenades beside the arrival path. They move, slow down, turn and return. Their heights are 1.68 m and 1.73 m in the calibrated scene; the complete pair uses 26 mesh draws with shared geometries and materials.

The already transformed World Labs collider provides every route's ground heights. Routes are sampled at intervals of at most 15 cm, with an eight-point footprint check and continuous swept-capsule clearance between samples. Unsupported edges, steep slopes, obstacles and overlapping visitor corridors reject the pair. No replacement floor is added. The player keeps its separate Rapier controller.

The walking background is an original opaque 512 × 256 sRGB sky texture, with periodic cloud shading and no fixed photographic landmark. It is generated once per viewer, requires no animation loop, and is disposed on exit. This fills the distant background; it cannot reconstruct missing provider geometry or remove artifacts already embedded in the SPZ.

The visitors advance inside the existing viewer frame gate. They continue while the person stands still in an active walk, and freeze during pause, journal reading, reduced motion, page hiding, viewport exit and window blur. Resume starts with a fresh timestamp, without background catch-up. Early exit and late asset initialization are handled by the existing lifecycle guards.

## Executed validation

On October 3, 2026, the final implementation passed all **508 tests**, TypeScript checking and the production build. [Test log](../outputs/v25/test-suite.txt), [build log](../outputs/v25/build.txt). Existing bundle-size notices remain; the build reports no error.

The garden tests validate unsupported edges, slopes, thin obstacles, overlapping routes, shared-resource disposal and timing across 30, 60 and 120 fps. The actual transformed V23 collider supports both default routes for a 30-second test. Their audited endpoints are `[4.1, -0.342806, -6.65]` → `[6.55, -0.344036, -6.5]` and `[5.15, -0.345212, -8]` → `[7.5, -0.344187, -7.9]`. Viewer tests check idle animation, pause/resume, reduced motion, blur, hidden/offscreen gating and late initialization.

Actual browser observations confirmed two rendered visitors moving while the camera stood still, a supported walk with `grounded=true`, drag-based viewpoint changes, journal pause and continuation, manual pause and reduced-motion freezing. The final observed walk covered 4.832 m; another observed run covered 6.281 m. The renderer reported roughly 29–33 fps during active desktop samples at the default 1280 × 720 viewport. These are observations on this notebook, not a general benchmark. At 390 × 844 there was no horizontal overflow and all four movement-pad buttons measured 44 × 44 CSS pixels. The viewport and temporary media override were restored. [DOM observations](../outputs/v25/browser-validation.json).

The saved [26.155-second MP4](../outputs/v25/paris-living-garden-demo.mp4) contains 64 actual CDP JPEG frames at 750 × 422, with their real capture gaps preserved. Three buffered preparation frames predating the observed preparation-complete time were omitted without changing surviving timestamps. Capture is substantially less frequent than rendering; this recording is not evidence of a 30-fps video. An unchanged terminal frame marks the captured end. FFmpeg decoded all 65 encoded frames successfully, and the final file was read back and hashed. [Video verification receipt](../outputs/v25/paris-living-garden-demo-receipt.json).

The final sky adds visible blue-gray shading to the previously uniform rose filling, but the SPZ's remaining gap outlines are visible. Opaque local visitor geometry and its fading feet against the splatted ground were inspected in the real view; that visual inspection is not a complete depth-occlusion correctness claim.

![Final walking scene with original visitors](../outputs/v25/garden-final.png)

![A closer garden viewpoint](../outputs/v25/visitors-close.png)

![Mobile movement controls](../outputs/v25/mobile-walk.png)

## Scope

This is a local visual increment using the completed V23 approach SPZ and collider. It creates no new Tripo or World Labs generation job. The visitors are a local original 3D layer, separate from sponsor-generated media. Their supported paths are bounded; they do not represent crowds, conversational characters or physical obstacles for the player.

The cached SPZ contains 500,000 splats. The sky and original scene remain static; translational walking and the visitor animation provide movement. Remaining scene gaps and texture artifacts require better generated assets or a separately verified reconstruction. No public deployment, sponsor-demo parity or submission completion is claimed by this validation.
