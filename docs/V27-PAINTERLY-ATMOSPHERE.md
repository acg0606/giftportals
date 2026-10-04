# V27 warm painterly keepsake atmosphere

Staging only. Generated gifts opt in through existing `MemorySceneOptions.unboxing`; ordinary Studio/default themes retain their original scene, lighting, static rendering and controls. The latest staged elevated package camera `(.9, .75, 1.1)` is preserved.

## Apply these four files

| Staged file | Destination | SHA256 |
| --- | --- | --- |
| poetic/files/src/keepsake-atmosphere.ts | src/keepsake-atmosphere.ts | D821B8B973EB9FB42B6E9AF81CC9D2332E2A0A2C71C88BCC9E3B15EF8C7BF6FC |
| poetic/files/tests/keepsake-atmosphere.test.mjs | tests/keepsake-atmosphere.test.mjs | 3D6F0924D1F02D101A189973C41AE9DE4C9EA57467B0C3F15371B1E2D41F2B82 |
| unboxing/files/src/scene.ts | src/scene.ts | 56F7EA1F5FE1B4C56A7FFA65C28AE375D7C4C26E85D2D45BFE932D66FF01DECB |
| unboxing/files/tests/scene-studio.test.mjs | tests/scene-studio.test.mjs | 2A3D20E66DA34447D9C1758C5FACE3E15A04F10A2441288CECB7557C13EB7C03 |

Read-only canonical scene baseline at start: `400CB1F76499D91BE07A930D091F38A9D2C545930214306B3C471654DDB5A005`. Root's newer staged scene baseline, including elevated box fit: `1CA75EEA9635BB4F8F738DBDB6DC7076F50BC52F90239BEC49FCE7EB06D206C4`. Existing staged scene-test baseline: `667C5C73F4B7D83FCF482154A8A0CB33AD12A182CA3EF7038A3AE47BEE0C7C95`. Module and standalone test are new. No canonical source, provider, external asset or dependency changed by this subtask.

## Visual result and contract

`mountKeepsakeAtmosphere(scene, {focus, cameraPosition, reduced})` returns `update(delta): boolean`, `setReduced`, `setComposition`, `destroy`, an `animated` getter, and owned `group`/`dust` objects. It creates scenery inside the caller's existing Three scene; no additional renderer, canvas, RAF, clock, image, provider call or postprocessing pipeline.

Original procedural GLSL gives the large cream/celadon/lilac sky restrained pigment grain and brushed bands. A real spherical low sun has warm brushed color variation, diffuse glow and two soft light wisps. An ivory floor, faint contact shadow and celadon plinth keep the actual keepsake grounded. A warm backlight is stronger than the gentle front key, with a subtle lilac rim and modest ambient fill. One 512px soft shadow map gives the actual model/wrapping depth. Original model materials and texture parameters remain unchanged; only mesh cast/receive-shadow flags are enabled for this view.

Composition places the sun behind the object relative to its initial camera and updates when reset/reveal changes that framing. The elevated wrap camera still shows the lid, bow and two sides. The atmosphere installs after renderer/controls creation and before model loading; disposal removes its own resources before the scene's general cleanup. Its opaque painted sky supersedes the blurred source-image backdrop in the generated 3D view; the original photo/story remain available in their existing product views.

Forty-eight small pastel motes drift using the existing frame gate's supplied delta. Visible motion is capped at 30 rendered FPS; reduced motion leaves the scenery and particles static and renders only on demand. Hidden/offscreen/blur states cancel pending frames; resuming advances by at most the already bounded delta, never elapsed wall time. No geometry/material/texture from the real GLB is owned or disposed by the atmosphere.

## Validation

**15/15 tests passed; strict TypeScript passed.** Actual Three geometry/materials are exercised with fixture GPU/DOM/network/model decode in the isolated existing unboxing validation directory. Checks cover ordinary Studio compatibility, original model/photo textures and transforms, three-action wrapping, portrait fit, shared 30 FPS cap, bounded dust count/movement, visibility/blur/reduced-motion sleep, no private RAF, retained original model resources, and one-time disposal of every unique atmosphere geometry/material plus its light shadows. Dependencies were reused through the existing read-only junction, with no install.

Parent still owns real browser shader compilation, screenshots and visual QA. Current cached GLBs retain their existing texture appearance: this change paints the surrounding scenery and lighting, not a claim that sponsor model textures have been regenerated. Root's separate generation-prompt work establishes the warm impressionistic oil-painted standard for future provider output.
