# Release 11.2 — example world refresh

The Rio showroom restores the original sailboats and sunset composition using
an AI photographic reinterpretation of GiftPortals' V7 artwork. It is an
artistic scene reference, not a geographic photograph or a surveyed location.
The new world uses `marble-1.1-plus`; the newspaper labels its source accurately.
The existing Tripo model, demo names and dedication are preserved.

The two already published Praça examples receive static world-only overlays.
The allowlist pins each public UUID, original photo SHA-256 and asset directory.
Missing or invalid overlays retain the original archived gift. Original photos,
Tripo models, story, dedication, sender and recipient remain in the renewable
cloud archive. No expired storage signatures are published in static files.

| Example | Public ID | Original reference SHA-256 |
| --- | --- | --- |
| Court and path | c864acd7-88d0-4b02-bff7-67ae186243dc | 2364ff368b4c479088b0d33ee01129a26ad2aaef00e3db5a63b214b9119f2dda |
| Playground | cc997d6d-faf2-4b5a-8bfa-9196716bec71 | 7ec67ecc34a519689e69a6aa972849385907382ac77a7d91a8fb9c9814b3db82 |

Paris' photographic Seine world and the fictional Antikythera observatory are
preserved after visual review. The duplicated Rio archive card is suppressed
only when the updated Rio showroom example exists; other gifts and the old
Rio's direct public link remain available.

## Model and credits

World Labs lists `marble-1.1-plus` as its highest available public API model.
Atlas remains selective early access and has no documented public API model.
Plus principally expands spatial coverage; it does not guarantee fidelity in
unseen regions. New live creator tests retain `marble-1.1`, the same model used
for Paris, with the improved `giftportals-world-photographic-v12` recipe.
Outdoor sources preserve open sky; real interiors preserve their enclosure.
Previously accepted jobs retain their accepted prompt/model/recipe on recovery.
The Tripo recipe remains byte-identical.

Sources: [public API models](https://docs.worldlabs.ai/api/models),
[Marble models](https://docs.worldlabs.ai/marble/models),
[API pricing](https://docs.worldlabs.ai/api/pricing).

The starting protected balance was **31,100 World Labs credits** and **23,800
Tripo credits**, observed October 5, 2026. Paid creation is limited to three
single-image Plus operations, at most **9,240 credits** combined. Each operator
submission checks a fresh provider balance and preserves a **21,860-credit**
minimum after its maximum reservation. No paid HQ mesh export or Tripo
generation is part of this refresh. Polling and local exports reuse each
accepted operation and do not create another world.

## Assets and validation

Each offline exporter requires a completed provider receipt, the original
reference and prompt hashes, genuine 500k SPZ, panorama and included collider.
Public provenance accompanies versioned assets. 100k exports are retained as
available derivatives; the world visitor currently uses 500k. Full-resolution
downloads are operator-only, and an oversized full-resolution result does not
invalidate the 500k output. No claim of automatic 100k mobile selection is made.

All three operations completed at **3,080 credits each**, for **9,240 total**:

| Example | Operation | Completed world |
| --- | --- | --- |
| Rio sailboats | 9a441786-4924-43b7-a15d-1f339c41ded9 | 2c923e65-5129-4edf-a963-c797a5dd70b7 |
| Court and path | b9759215-20ac-4f00-9e89-ee5b3068d144 | 3c779945-762c-4d74-be6a-ea0f8e97e2b9 |
| Playground | a5b0f854-de85-4d26-98a0-eddb9d04e2e9 | 07768969-fb66-451b-9868-585f775025ba |

Fresh authenticated balance GETs at **2026-10-05T22:17:02.836Z** confirmed
**21,860 World Labs credits** and **23,800 Tripo credits**, with no Tripo holds.
No additional generation is scheduled by this release.

The reviewed Praça examples are presented entirely in English on cards,
public and private reopen routes, and newspapers. The court gift is titled
“A quiet square”, from Andrew to You, with the reviewed English dedication and
tree-planting memory. The empty playground memory stays empty with an English
fallback. This explicit UUID allowlist does not translate later testers' gifts
or modify original cloud job/archive records.

The newspaper renders the actual delivered GLB as the souvenir. A card's source
photo fallback no longer becomes a semantic keepsake preview. If 3D rendering
fails, the model link remains and any distinct input reference is clearly
labelled. The miniature viewer is destroyed when the newspaper closes or the
route is retired.

Rio's preferred arrival position is `[0, 2.13686443, 2]` in the transformed
world, with a 2.2-metre view height to match the generated reference framing.
The actual collider and Rapier probe confirm ground and body clearance;
the visitor recalibrates against that mesh rather than trusting the position
alone. Visual review determines its final framing. Full collision geometry is
an inferred provider output and does not verify every visible splat surface.

Local WebGL review confirmed the updated court world preserves its visible
path, benches, turquoise court and wooded slope. The Rio arrival and final view
show the bay, sailboats and Sugarloaf, with a supported camera position. The
English court newspaper shows one source photo and the actual miniature GLB;
the model becomes ready when scrolled into view and is disposed on close.

Validation passed: **1,169/1,169** full-suite tests, followed by **67/67** tests
covering the final eye-height/export/calibration change. Frontend TypeScript,
strict server TypeScript and the final production build passed. Existing large
bundle warnings remain. Production verification is recorded with the release
pull request and deployment receipt.

The arrival flight runs at **1.5×** its previous speed: the same spline, camera
targets, field of view and collision-checked corridor take **20 seconds** instead
of 30. Hidden-tab pauses still freeze elapsed time. Walking, guided walking
tours and souvenir unboxing keep their existing timing.
