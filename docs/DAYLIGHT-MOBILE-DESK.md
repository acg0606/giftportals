# Daylight atelier — 10.3.0 preview

The user selected displayed concept 1 on 4 October 2026. This increment implements that direction in the existing interactive collection: pale oak, ivory walls, a vertical daylight window, a large central keepsake and cream/navy touch controls.

## Assets and accounting

The selected 853 × 1844 concept and its cleaned reference were generated with the built-in OpenAI ImageGen tool. The room reference removed the interface, souvenir, journal and photograph frame so imported models remain independent interactive objects. One full `marble-1.0` World Labs request completed, consuming 1,580 credits. No paid Tripo generation or HQ mesh export was needed.

| Asset | Bytes | Purpose |
| --- | ---: | --- |
| 500k SPZ | 7,923,781 | Primary real room on mobile and desktop |
| 100k SPZ | 1,347,156 | Lower-resolution failure fallback on mobile |
| Original panorama PNG | 2,704,860 | Preserved provider export, 2304 × 1152 |
| Collider GLB | 6,112,284 | Preserved source used to measure tabletop support |
| Shadow receiver GLB | 8,448 | 340 original collider triangles, 211 vertices |
| Rio mobile GLB | 5,150,296 | Original geometry; smaller embedded textures |
| Paris mobile GLB | 5,027,708 | Original geometry; smaller embedded textures |
| Antikythera mobile GLB | 5,148,396 | Original geometry; smaller embedded textures |

The 1024 × 512 `lighting.webp` derivative is used only for PBR environment lighting. It never replaces the visible room with a flat photograph. The full collider and panorama are retained for provenance; runtime shadows load only the small receiver.

The public keepsake derivatives total 15,326,400 bytes, compared with 48,346,752 bytes for their originals, a reduction of about 68%. Color textures retain up to 2048 px; data maps retain up to 1024 px. Every non-image buffer view is byte-identical, and nodes, transforms, meshes, accessors and material structure remain unchanged. Original GLBs continue to serve other views and print preparation. Private creator gifts continue to use their authorized original media.

See [world provenance](../public/assets/daylight-desk/provenance.json), [texture audit](../public/assets/daylight-desk/keepsakes/mobile-keepsakes-audit.json), [collider measurements](../public/assets/daylight-desk/collider-calibration.json) and [receiver provenance](../public/assets/daylight-desk/shadow-receiver-provenance.json). These records contain no private provider URLs or credentials.

## Composition and interaction

Tabletop positions were measured with raycasts against the actual provider collider, transformed once into Three Y-up with `rotation.x = Math.PI`. The source room is an artistic reconstruction and its collider has local surface variation. Final contact is therefore also checked in the rendered scene.

- Gift support: `[-0.10, -0.271, -1.12]`.
- Photograph frame: `[0.10, -0.282, -1.08]`.
- Journal: `[-0.20, -0.3163, -0.80]`.
- Mobile eye: `[-0.05, -0.05, 0.03]`, with gift-centered framing.
- Mobile model bounds: `[0.48, 0.40, 0.43]`, preserving each model's proportions.
- Portrait safe area: 190 px top / 165 px bottom; hero bounding width up to 78%.

The footer shows the currently displayed gift and opens that gift. Previous/next controls are 48 px; the primary action is 50–54 px high. Optional camera, lighting and playback controls remain accessible in Desk controls. The current gift is announced politely for assistive technology. Expiration, capability checks, reduced motion, keyboard browsing, pagination and resource cleanup remain supported.

Collection rendering uses a local DPR limit of 2 and an approximately 1.1 million pixel budget. A browser emulating 390 × 844 at device DPR 3 produced a 712 × 1542 canvas (effective DPR 1.83), with 500k room points and all three models loaded successfully. This is browser evidence, not a physical phone frame-rate measurement.

## Verification and publication

Final browser comparisons, responsive checks, primary interactions, console review and iteration history are recorded in [design QA](../design-qa.md), which passed. Final validation passed **973/973 tests**, frontend TypeScript/production build and strict server TypeScript. Desktop framing uses a 30° preferred vertical FOV, calibrated target `[-0.20,-0.30,-2.8]` and a 52° horizontal limit, preserving the clear main desk region on wider screens. The branch is prepared for a Vercel preview so the selected mobile direction can be checked on the user's phone. Existing headset and physical print limitations remain in the sponsor audit; this desk increment establishes neither hardware compatibility nor a hackathon submission receipt.
