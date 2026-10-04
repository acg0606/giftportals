# V23 Paris execution and validation

Executed locally on 2026-10-03. Open `http://127.0.0.1:4325/#/paris-flight`, or choose **Fly through Paris** from the Paris gift. The World comparison preserves both existing candidates and adds the completed journey.

Three actual Marble 1.1 Plus worlds were generated and exported: Eiffel arrival, an imagined elevated observation gallery, and the Seine quay. Their independent geometry shares original art direction, not measured coordinates. All 12 public model/panorama/collider assets have validated source hashes and local paths. The final public manifest plus assets match the production bundle after a final camera-only manifest refresh. Earlier Paris assets remain preserved.

## Camera and visual review

The actual SPZ and collision mesh both use the provider's 180-degree X correction. The arrivals translate 7.962, 5.749 and 7.828 raw artistic units. The summit's second stop turns toward the Seine for a distinct elevated view. Positions are not calibrated metres. A 512-chord audit of the application's exact interpolation, transfers and scenic drift found zero collider surface intersections; conservative minimum surface clearances are 0.629, 1.306 and 0.280 raw units. This geometric check does not guarantee complete rendered coverage or geographic accuracy.

Actual desktop browser review confirmed each completed SPZ rendered, manual chapter switches disposed the previous scene, and camera motion changes perspective around close structures. Manual ascent changed the real camera Y coordinate by 0.32. Pause, optional story readers and returning to the gift are separate controls. The readers use an original newspaper, tablet and book for the three settings. The same world's panorama fills distant environment gaps behind decoded splats; it is never a replacement for an unavailable model.

The generated geometry still contains soft distant detail, fragments and imperfect architectural shapes. These are visible limitations, not a factual city reconstruction. Static splats do not animate boats, water or people. GiftPortals authors camera movement, scenic drift and explicit luminous transitions between worlds.

The first mobile viewport review revealed that 100k splats were excessively blurred. Verified scenes at most 10 MiB now use 500k even on small screens; larger or unmeasured scenes use their available 100k variant. Testing a 390 by 844 browser viewport does not establish physical-phone GPU performance.

## Provider receipts and credits

The approach, riverside and final simplified summit attempts each completed at 3,080 reported credits: 9,240 confirmed successful generation credits. Authenticated balance GETs changed from 32,690 to 23,450 during this experiment; Tripo stayed at 24,470 available, with no new Tripo generation. Two earlier summit operations returned terminal provider errors and remain in separate receipts. Their individual billing is unavailable; the local ledger retains both maximum reservations rather than asserting zero cost.

Five attempts reserve at most 15,400 credits. The explicitly bounded operator cap is 33,000; the ordinary creator default is unchanged. No credits were purchased. The simplified final summit prompt, initial original direction, failed manifests and receipts are preserved under `outputs/v23`.

Same-world full-resolution GET downloads exceeded the isolated 50 MiB limit for all three scenes. No full-res file is published and no Detailed control is exposed for these chapters. Desktop/mobile use the actual 500k spatial model. The API's full output has not been GPU-reviewed here.

## Checks and recording

- 461 tests passed; no skips or failures. Provider unit traffic uses fixtures, separate from the recorded real generation.
- Frontend TypeScript, strict API TypeScript and production Vite build passed. Existing large lazy bundle warnings remain.
- Final export contains 13 public files including the manifest; build hashes match, with no private job records or capability URLs exported.
- `outputs/v23/paris-flight-demo.mp4` is an actual local browser screencast. Chapter buttons were selected manually to show the arrivals; it is not a recording of the full automatic itinerary. No generated or interpolated animation frames are used. Its timestamp and decoder checks are in the encoder receipt.

This is a local product increment. It does not establish a public deployment or a hackathon submission receipt.
