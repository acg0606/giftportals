# A photograph becomes a miniature

The Paris example previously generated a picture frame because the creator deliberately wrapped a place photograph in a frame before sending it to Tripo. Both viewers also fitted the original photograph onto the model and compressed its depth. The Rio example used a freestanding miniature reference instead, which produced the intended keepsake.

## Visual direction

A place photo should inspire a small tangible diorama. Read the prominent subjects, foreground/middle/background overlaps, colors, light, and materials. Recompose a few recognizable elements on one compact base, with distinct heights, depth, and plausible hidden sides. Keep the miniature legible from several directions. Buildings, water, foliage, and landmarks should be physical forms rather than scenery printed on a vertical plane.

For Paris, the reference identifies the Seine, arched stone bridge, Eiffel Tower, Haussmann buildings, trees, boat, and lamps. The resulting collectible uses sculpted water, bronze and stone forms, miniature buildings, and a walnut base. This is an artistic keepsake inspired by the scene, not a measured reconstruction.

## Data and generation contract

Keep `photoIntent: place` so the original scene remains the reference for World Labs. Track `objectRepresentation: souvenir-miniature` independently to describe the Tripo keepsake. A miniature reference and the source photo have different roles; neither should overwrite the other. Only explicit legacy `framed-postcard` jobs use the earlier photo fitting behavior.

The automatic place pipeline prepares a miniature reference with Tripo image-to-image before image-to-model. A separately approved miniature reference can skip that preparation. Preserve task IDs before advancing, screen the intermediate, and retain the local credit reservation after an uncertain paid submission. A model failure must never silently substitute a framed photograph and call it a completed souvenir.

The replacement Paris souvenir reuses the existing World Labs world, panorama, and collider. Historical V13 assets and receipts remain intact. Record new reference/model hashes and actual generation credits in the V17 evidence.

## Observed provider attempts

The first automatic miniature reference (`c2728458-2497-4028-8d49-a4f0cb086e06`) still included a flat scenery panel. It was declined before any 3D task was submitted; Tripo reported 5 image credits. The stronger image preparation attempt (`36a5f1e9-2832-4f45-8482-e85b734d9e4c`) returned no task ID before its request timed out. Its 100-credit local reservation remains held; its actual provider cost is unknown and it has not been resubmitted. The documented batch lookup requires known IDs.

Automatic generation from an arbitrary place photo is therefore not yet visually verified. The Paris replacement uses a separately inspected miniature PNG with physical landmark silhouettes, as Rio did. Its new model task is `36450d8e-e1fe-4539-b93e-99448f7986c1`, linked to job `19a54c2b-ae7f-43e9-813f-ccc83e67f864`. Other city references are prepared inputs; they are not completed 3D models.

The initial image-to-image POST now allows up to 120 seconds for its acknowledgment. Other requests retain their 15-second timeout. A timeout remains ambiguous and never authorizes an automatic paid retry. Restart the local preview after this change so its retained service uses the new configuration.

## Local owner operation

`tools/remake-keepsake.ps1` supports a controlled replacement from an existing owned job, independently reviewed miniature input, read-only polling, and hash-bound approval or rejection of automatic references. New paid submissions require the explicit launcher flag. The tool loads the existing protected provider configuration without printing credentials and writes a separate receipt. Polling an existing task does not submit another task.

`tools/cache-souvenir-example.mjs <completed-job-id>` exports only a completed souvenir and verifies the source world hashes, miniature reference, embedded GLB dependencies, and geometry bounds. It copies only the new reference and model; visual inspection from multiple directions remains required.

## Primary API references

- [Tripo image-to-image](https://developers.tripo3d.ai/en/docs/generation-image-to-image)
- [Tripo image-to-model](https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard)
- [Tripo pricing](https://developers.tripo3d.ai/en/pricing)

## Validation

Validation evidence is recorded in `outputs/v17/`:

- The completed Paris GLB is 15,151,704 bytes with 29,186 triangles and bounds of approximately 0.980 × 0.624 × 0.979 model units. It contains its own textures and buffers. Front, side, and back screenshots show physical landmark forms, an independent tower silhouette, and a circular wooden base, without a photograph fitted onto a vertical plane.
- Both the public gift route and collection room use the new mesh. Rotation, zoom, reset, room selection, world entry, guided tour, and return to the souvenir were exercised in the browser. The original World Labs assets were independently hash checked and reused.
- At a 390 × 844 viewport, the page and canvas remain 390 pixels wide with no horizontal overflow. Browser console checks returned no errors. `visual-validation.json` records the screenshots, limitations, and matching source/build model hashes.
- `tests-final.tap`: 316 tests passed. Both frontend and strict API TypeScript checks passed. `build-final.txt` records the completed production build; existing large world/globe bundles still produce a size warning.
- Tripo reported 60 credits for the completed GLB, plus 5 for the earlier declined reference. The ambiguous reference cost remains unknown with its 100-credit local reservation held. No new World Labs generation was requested.

The inspected result verifies this prepared Paris example. It does not establish automatic visual quality for every newly uploaded photograph. The other three newly prepared city PNGs are references for future generation; Rio retains its existing completed miniature.
