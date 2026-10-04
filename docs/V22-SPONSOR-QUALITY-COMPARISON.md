# Sponsor quality comparison

Paris is the controlled reference for two local visual experiments. Earlier gifts remain available and their assets are unchanged. Open `#/quality-comparison`, choose **Miniature** or **World**, then open A and B in turn. Both versions use the same renderer and controls; only one WebGL viewer is active at a time.

## Miniature: consistent views before geometry

The original v17 volume reference shows a round wooden souvenir with separate buildings, bridge, river, boat, trees and Eiffel Tower. Tripo's image-to-multiview endpoint generated front, left, back and right views. All four passed local screening and were inspected for a consistent object before their aggregate hash was approved for the model task.

The candidate uses H3.1 (`v3.1-20260211`), detailed geometry, detailed PBR textures and the same 30,000 face limit as the existing single-image miniature. This tests the reference strategy rather than merely increasing polygon count. Generated views remain an artistic interpretation, not proof of exact geometric correspondence.

The live views response used `type: image_to_multiview` and nested its four URLs under `output.generate_multiview_image`. The reader now supports that measured envelope as well as the documented flat envelope. Recovery retrieved the same task and restored its full reservation before downloads; it issued no replacement generation POST.

## World: Marble 1.1 Plus and coherent inputs

The candidate uses `marble-1.1-plus` with three overlapping views from the existing Paris panorama, facing 0°, 90° and 270°. They share the same virtual camera position, square 768 px output, 110° field of view and zero pitch. They represent the same environment and provide an artistic continuation of it.

The initial fourth view, facing 180°, was flagged for review by the local CLIP comparison bank despite showing a tree, buildings and pavement. The trained sensitive-image detector scored 0.000130; the CLIP sexual-label aggregate scored 0.204183. One coherent revision with a 10° upward pitch also failed screening. Both attempts stopped before uploads, reservations and the paid world POST. The final input omits the reviewed view and uses the three already approved original views. Safety thresholds and policy are unchanged.

This comparison changes both model and input strategy, as well as the scene prompt. It can establish which resulting experience is preferable, but cannot isolate how much improvement comes from Plus. Neither environment is a factual Paris scan. Movement and artistic plausibility must be assessed in the actual SPZ viewer, not just from panorama thumbnails.

## Execution and credits

Authenticated balance GETs before these trials reported 24,540 Tripo credits and 35,790 World Labs credits at 2026-10-03 10:54:17 UTC. The miniature reserves 100 credits, with measured stages of 10 for views and 60 for its model. The world reserves up to 3,100 credits, with a fresh balance check and an additional 1,000-credit cushion before submission. These reservations share the creator's existing local budget lock and caps.

Known task IDs are persisted before polling. Ambiguous paid submissions retain their reservation and cannot be automatically resubmitted. World outputs remain private at the provider. The offline exporter copies only validated media and a selected gift configuration into the local demo directory; private job records, upload tokens and provider capability URLs are excluded. The comparison page cannot start generation.

The first world operation (`b32e4662-d6bc-4d6d-94b1-7ddfbde5a8f8`) ended with an authenticated terminal error 500 and no result. A second deliberate trial, `paris-plus-v22-retry-20261003`, keeps the same three approved inputs and records a new operation. The failed trial's 3,100-credit hold is preserved because its cost is unknown. The operator-only world cap was explicitly set to 18,000 for this second attempt, covering regular commitments plus both holds. The ordinary creator retains its existing 15,000 cap.

The retry completed with a 500,000-point SPZ, a panorama and a collision mesh. Its provider-confirmed cost is 3,100 credits; Tripo's completed views and model cost 70 credits together. Authenticated balance GETs at 2026-10-03 11:22:53 UTC reported 24,470 Tripo credits and 32,690 World Labs credits. The failed world operation's cost remains unknown, and its local hold is retained.

The provider receipts and independently checked export hashes live under `outputs/v22/`. The protected wrapper restores process environment values after each command and never prints keys. Local demo availability is separate from public deployment and submission.

## Measured miniature and browser checks

The completed candidate is a 13,600,068-byte self-contained GLB with 28,227 triangles, versus 29,186 for the baseline. Both retain the 30,000 face limit. Its measured bounding extents are approximately 0.980 × 0.643 × 0.976 raw asset units; those extents establish a volumetric asset but do not independently prove detailed visual quality. Front, side and back were rendered and inspected in the actual interactive viewer. Buildings have a more complete rear silhouette; bridge, river and boat remain separate visible features. Water still reads as a relatively flat material in both versions.

The A/B cards now show captures of the actual two 3D models, labeled as renders; the generated input views are displayed separately below. The comparison was checked at the normal desktop size and at 390 × 844. Both controls work, the phone layout has one column without horizontal overflow, and the inspected browser error log is empty. Both worlds were opened as actual SPZ assets, with camera movement and a newspaper reader.

The Plus result has a prominent bridge, a riverside promenade, trees, lamps and illuminated buildings. Translating the camera reveals depth around the bridge and foreground objects. It also exposes missing sky coverage and noisy distant geometry. The previous Paris flight corridor did not fit the new bridge layout: the third stop looked steeply down into water and approached the bridge too closely. That failed view is retained in `world-plus-tour.jpg`. A conservative corridor is scoped to the V22 candidate only; the baseline keeps its original route. All four resulting viewpoints were inspected, with captures in `world-plus-viewpoint-1.jpg` through `world-plus-viewpoint-4.jpg`. The third now faces the bridge instead of the ground. The actual cached collider audit found zero crossings on 13 continuous straight checks and 1,024 arrival spline chords; its bounded clearance evidence is in `world-plus-flight-clearance.json`. These authored paths and clearances are in raw artistic scene coordinates, not calibrated meters or verified landmark locations.

Visual decision: the multiview miniature is a useful improvement, especially around the rear building silhouettes, without increasing the polygon limit. Plus is a reviewable alternative, but the sky and geometry defects prevent declaring it the better default world. It remains in the comparison rather than replacing the existing gift. This experiment changes model, input strategy and prompt, so it cannot attribute the differences to Plus alone.

The final complete suite passed **418/418**, with no failures or skips. Frontend and strict API type checks passed, including the three trial helpers. The production build completed with the exported miniature, world and collision assets. Existing large Spark/Cesium bundle warnings remain. Results are summarized in `outputs/v22/validation.json`; the suite and build logs, model angle screenshots, actual world views and desktop/phone captures are in the same folder.

Final review also exposed a preview reliability issue: the short-lived operator CLIs used Vite's browser cache and could invalidate an already running preview's dependencies. All four SSR-only CLIs now use a separate private cache with browser optimization disabled. A real SSR regression in a temporary fixture verifies that the preview-cache sentinel remains unchanged. After restarting the owned preview, both miniature models opened successfully again.

## Repeat the read-only review

```powershell
node tools/export-quality-comparison.mjs
./tools/start-instant-preview.ps1 -UseProtectedVault
# Open http://127.0.0.1:4325/#/quality-comparison
```

The export and browser comparison issue no generation request. The operator generation tools require their explicit spend flag, a unique recorded trial and the existing protected provider credentials.

Official references: [Tripo image-to-multiview](https://developers.tripo3d.ai/en/docs/generation-image-to-multiview), [Tripo multiview-to-model](https://developers.tripo3d.ai/en/docs/generation-multiview-to-model/standard), [World Labs multi-image examples](https://docs.worldlabs.ai/api/world-generation-examples), [World Labs pricing](https://docs.worldlabs.ai/api/pricing).
