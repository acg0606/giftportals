# GiftPortals v5 — executed validation

Validated September 30, 2026 on branch `v5-tripo-studio`. The previous NEXUS, v3, Aurora and original GiftPortals branches are preserved independently.

## Delivered behavior

The opening now presents the actual Tripo object on a neutral dark stage with source/reference context. Memory Studio has an authorized asset library, a dominant Object/World/Story/Keepsake workspace and a separate exploration inspector. It replaces the illustrated floating trail. Home, personal world, atlas, library, full-memory pages, creation/auth surfaces and the geographic globe share the new original dark/yellow presentation. All product copy remains English.

Original/3D comparison actually disposes and remounts viewers. Wireframe inspects the attached model's geometry while retaining its material/texture flags. Orbit is explicit, disabled under reduced motion, suspended offscreen/hidden and capped at 30 rendered frames per second by implementation. The cap is not a device performance measurement. Provider assets, private permissions and geography remain unchanged.

## Automated checks

- Full test suite: **107 passed; 0 failed, skipped or cancelled**. The original 104 tests remain, plus three meaningful scene-control regressions covering material preservation, disposal and explicit orbit/reduced-motion lifecycle.
- Final `pnpm build`: **PASS**, including strict frontend TypeScript and the production Vite bundle, after the final source/copy/globe color fixes.
- `git diff --check`: **PASS** before staging.
- Independent source review: **no remaining material findings** after fixes for real CSS selectors, grid width, hidden location/date handling, failure controls and world-image provenance.

Scene regressions execute the actual scene/frame-gate source with real Three.js geometry/materials and fixture GPU/DOM/fetch/decoding. They do not replace browser verification. Backend/API code and dependency pins were not changed by v5.

## Actual desktop browser verification

The development preview was exercised at 1440 × 960. The actual home GLB loaded; rotation, reset and visible wireframe worked. Original → 3D switched from zero canvases to one ready canvas. World image → the existing World Labs Gaussian-splat scene also switched from zero to one. Story and Keepsake left no live viewer canvas.

Three explicit reveals enabled Assemble, then Keep. Ride → immediate Skip arrived at Noah's TUCA-focused atlas with one session keepsake and a next authorized Paris memory. The atlas still showed **no physical visit and one received memory**. Paris showed original illustration/story without invented 3D. Switching to Maya cleared the session-keepsake journal and retained her own independent history.

Library Received/search filtering returned the authorized Paris memory. Its full-memory page, the private-creation explanation, onboarding and About page were inspected. The personal-world dashboard and atlas journal were readable. Final modal and globe token fixes were reviewed against actual DOM selectors and the built product.

Blocking only GLB requests with browser developer tooling produced a complete reference image, zero canvases, an honest unavailable caption and disabled Turn/Wireframe/Reset on the home. Network/cache overrides were removed and normal loading restored. No provider request was needed for recovery.

## Actual mobile browser verification

An isolated Edge tab at 390 × 844 exercised source comparison, real wireframe, actual World Labs viewing offsets, the full reveal/keep/train/atlas/next-memory loop, keyboard ArrowRight tab selection/focus, and no-model Paris. No horizontal overflow was observed. The 63-pixel viewer-control row remained stable and the primary action stayed reachable above bottom navigation.

On final source, blocking the specific bird GLB preserved the complete reference, usable Reveal and Retry. Unblocking and activating Retry with Enter restored one ready canvas. Reduced-motion emulation disabled orbit and left it unpressed. The QA tab was closed; viewport, networking/cache and motion overrides were restored. The detailed frontend report and five individually inspected captures are included in the task's v5 deliverables.

## Production bundle check

The final built bundle was served separately at `127.0.0.1:4324`. Home and Memory Studio loaded the actual GLB, World loaded the actual SPZ, and the atlas/globe loaded local Earth imagery. One active viewer canvas and no document overflow were observed. Globe controls and existing attribution were visible. The temporary production tab/server were closed; the user preview remains on port 4323.

The production browser diagnostics showed no captured error and one existing `THREE.Clock` deprecation warning. Build retains large dynamically loaded World Labs and Cesium chunks (about 4.9 MB and 4.0 MB minified); no whole-app performance or accessibility-conformance claim is made. The main JavaScript chunk is about 142 KB minified / 46 KB gzip.

## Evidence and limits

Actual home/studio/keepsake/atlas/world/full-memory/fallback captures were saved and inspected. The public Tripo desktop/mobile reference supports the inspiration; Studio onboarding blocked full workspace inspection. Intermediate globe/modal captures precede final color corrections and are identified separately from final captures in the deliverables.

The original bird reference is AI generated; people and stories are fictional. The Tripo object and World Labs atmosphere are real precomputed artistic interpretations. No new generation or provider-credit spending occurred in this redesign. Session exploration does not create cloud claims, cross-device persistence, physical visits or invitations.

Private cloud setup, production deployment, a new recorded walkthrough and final hackathon submission remain pending external completion. Local builds, screenshots and saved branches are not receipts for those outcomes.
