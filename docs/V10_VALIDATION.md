# V10 executed validation

Verified on October 1, 2026. The live local creator is available at `http://127.0.0.1:4325/#/make`. The completed fictional Rio example is at `#/generated/rio-example` and reuses cached provider assets without another generation request.

## Automated checks

- Full frontend and server test suite: **167 passed, 0 failed, 0 skipped**.
- Frontend TypeScript: `tsc --noEmit` passed.
- Strict server TypeScript for `api/giftportals.ts`, `api/tick.ts` and `api/instant.ts` passed.
- Vite production build passed in 18.86 seconds. Spark and the optional Cesium globe retain large lazy chunks; the build reports size warnings.
- Tests cover capability protection, image validation, duplicate paid-start prevention, lost-response recovery, submission uncertainty, budget limits, provider error sanitization, asset bounds, 500k selection/fallback, free completed-world upgrade, stale viewer teardown and narrative projection. Rendering tests use mocked GPU/decoder boundaries; real asset rendering was also checked in the browser.

## Actual provider evidence

One local job, `f141908a-0779-4323-ad0d-72351eab0334`, created the fictional Clara-to-Alex Rio gift. Both providers completed; the downloaded Tripo GLB and World Labs SPZ were inspected and rendered. This is completed output evidence, not just accepted task IDs.

Settled consumption was **60 Tripo credits** and **1,500 World Labs credits**. Fresh authenticated account reads returned **24,905 Tripo credits, zero frozen**, and **45,270 World Labs credits**. The deltas from the same-day pre-generation baseline match those settled costs. Provider IDs, timestamps, settings and file hashes are in [V10_GENERATION_RECEIPT.json](V10_GENERATION_RECEIPT.json).

The first world output contained 98,304 splats and appeared coarse during visual QA. The final view uses the existing 500,000-splat output from the same completed operation. That upgrade used GET/download only and incurred no additional generation credits. The original file and its hash remain preserved. The final SPZ is 8,138,477 bytes and the Tripo GLB is 17,545,328 bytes.

## Browser checks

- Home starts creation without an account or SMS. The approved Portal at dusk artwork remains the welcome presentation.
- Actual file chooser selection displayed the object photo and a separate optional place photo. Physical phone-camera capture was not available on this desktop; the mobile `capture="environment"` input is implemented.
- The Rio sample supplied separate object and panorama references. Personal title, recipient, dedication and story were sent with one explicit, consented create action.
- Actual provider states advanced to completed assets. Reload and server restart recovered the same completed job without a second paid start.
- The real object loaded with textured materials and the front of its Rio plaque visible. Rotation, zoom and reset controls worked.
- The 500k world rendered at 390×844 and 1280×800. Look controls and bounded forward movement changed the view. Narrative buttons revealed the dedication and story; Look around dismissed the story; Back to the object returned to the GLB.
- Copy gift link produced the explicit local-link confirmation. Close returned to the creator. The cached Rio example opened separately without a job capability or provider generation.
- A short place description was rejected before image preparation or submission. A blank title in closed optional details reopened that panel and focused the invalid title, without starting a job.
- Raw access to the ignored local photo returned HTTP 403. Job access without its capability returned HTTP 404. Provider keys were not exposed to the browser.
- No browser console errors were observed on the final cached example. Spark emitted nonfatal shader and deprecated-clock warnings during the earlier live run.
- The compiled production bundle was served separately on temporary localhost port 4326. Its cached Rio GLB, 500k world and narrative story rendered without browser console errors. This static preview does not enable live API generation.

The new binary demo assets were added while Vite was running with that directory excluded from hot reload. An example request initially hit the SPA fallback; restarting the local server registered the new assets, and the example then rendered normally.

## Captures

- [Photo entry, desktop](../outputs/v10/photo-entry-desktop.jpg)
- [Actual Rio Tripo object, desktop](../outputs/v10/rio-object-desktop.jpg)
- [Actual Rio World Labs world, desktop](../outputs/v10/rio-world-desktop.jpg)
- [Actual Rio object, mobile](../outputs/v10/rio-object-mobile.jpg)
- [Actual Rio world with story, mobile](../outputs/v10/rio-world-mobile.jpg)
- [World and story in the production bundle](../outputs/v10/rio-world-build.jpg)

## Delivery scope

The recorded [V10 walkthrough](../outputs/v10/GiftPortals-v10-demo.mp4) is 68.58 seconds with English captions. It shows actual browser interaction with photo selection, the previously completed Tripo object, the World Labs scene, narrative points and return to the object. The [video receipt](../outputs/v10/recording/VIDEO_RECEIPT.json) records H.264 encoding, full decode verification and provenance. This recording does not submit a new paid generation. A local player is at `/outputs/v10/demo-player.html`.

During recording, a shared input rule was found to override the visually hidden file-input dimensions, causing horizontal overflow. The scoped `.instant-creator .instant-sr-only` rule restores 1px file controls. Browser readback confirmed a 1120px document width at a 1120px viewport; typecheck and a fresh production build passed after the CSS correction.

This is a working local MVP with real generation and a cached completed example. Local links require this machine and its running preview. Public hosting, permanent cross-device sharing, configured email authentication and a new hackathon submission remain pending. No deployment, submission, purchase or credit redemption was performed. Worlds are artistic interpretations with small viewing offsets; they do not provide collision-aware walking or surveyed reconstruction. Narrative points are authored, not detected landmarks.
