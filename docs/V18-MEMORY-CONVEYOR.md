# The memory conveyor

The collection becomes a circulating display inspired by the way a keepsake arrives on a tray. Real generated souvenirs travel from right to left on a futuristic rail. A deliberate selection stops the circulation and brings that souvenir to the center, where its gift and world can be opened.

## Interaction

Play and pause control circulation. Previous and next move through one gift at a time. Horizontal drag or swipe scrubs the conveyor. Selecting a gift pauses movement; clearing selection keeps it paused until Play is chosen. Keyboard controls and an accessible list provide equivalent access. Reduced-motion preferences disable initial autoplay, and hidden or offscreen viewers suspend their work.

The environment uses graphite surfaces, champagne lighting and a restrained illuminated rail. The gift itself remains the focus. Source thumbnails provide an explicitly labelled fallback when a real model cannot load. A thumbnail is never presented as a finished mesh.

## Existing data and assets

This change uses the completed Rio, Paris V17 and Antikythera examples and the caller's already authorized collection. It requests no new Tripo or World Labs generation. Gift routes, world routes, photo provenance, media expiration, session boundaries and private collection access remain governed by their existing owners. More than six gifts remain available through successive sets and the full collection list. The renderer holds at most six model slots per set.

The source keeps its `collection-room` module and route names for compatibility. Product-facing labels describe the conveyor and collection.

## Verification

Evidence for this revision belongs in `outputs/v18/`. Required checks are visible right-to-left movement, stable pause, deliberate selection and centering, manual navigation, opening the exact gift/world, responsive layout, media expiration and lifecycle cleanup, TypeScript checks and production build. A screenshot alone cannot establish that circulation works.

```powershell
node --test tests/*.test.mjs api/tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types node api/giftportals.ts api/tick.ts api/instant.ts api/story-audio.ts
node node_modules/vite/bin/vite.js build
```

Local preview: `http://127.0.0.1:4325/#/collection`. Public deployment and hackathon submission are separate from this local experience.

### Verified locally on October 2, 2026

The complete suite passed **334/334 tests**. Frontend and strict API TypeScript checks passed, and the production build completed. Regression coverage includes bounded right-to-left motion, wrapping, paused stepping, reduced motion, private and expired media, stale callbacks, disposal and mobile model framing.

The browser rendered all three actual souvenir GLBs with zero failed models and no console errors. Measured Rio positions moved left between observations; after Pause, both visible gifts had exactly zero displacement. The observation interval includes browser/tool turnaround and is not a velocity or frame-rate measurement.

At 390 × 844, the selected Paris miniature is isolated, fully visible above the action panel, and the document has no horizontal overflow. Desktop selection keeps its detail panel beside the centered souvenir. The accessible gift list, arrow-key stepping and Space play/pause were exercised in the browser. Opening Paris reached its exact gift route, its existing World Labs 3D scene rendered, and Open collection returned to the conveyor. Touch swipe has pointer-interaction test coverage; a physical touchscreen was not used.

Screenshots, recorded UI measurements and check results are saved in `outputs/v18/visual-validation.json`, alongside `tests.tap`, both typecheck logs and `build.txt`. No new provider generation was requested for this revision.
