# Desk contrast refinement

Inspected the actual `evidence/desk-initial.png` screenshot. The room's large ambient fill washed out the props, while one-pixel pyramid lines disappeared against the window.

This staged refinement uses the applied canonical desk scene as its baseline. Apply only `files/src/collection-scene.ts` and `files/tests/collection-scene.test.mjs`; CSS is unchanged. No canonical source has been edited by this subtask.

The room now uses richer honey wood and visible grain, fuller mint/coral/lilac pigments, reduced hemisphere/environment fill, warm window highlights, darker shadow fill, and slightly lower exposure. Laptop contours, the coffee surface/mug lip, and lamp rim give small objects clearer depth. The existing shadow map resolutions are unchanged; their coverage is tightened around the desk. The projector has eight thin lilac geometry edges with low-opacity coral glows. Its four clear faces remain only 4.5% opaque and do not write depth, preserving the view of the actual gift. Original GLB materials and asset bytes are unchanged.

No public API, transport logic, shuffle, scheduling, loading/security limits, lifecycle, or CSS was changed. No new provider or asset request, renderer, or animation loop was introduced. The new geometry is bounded and tracked by the existing disposal sets.

The isolated scene/conveyor/room suite passes **38 tests, 0 failures**; strict TypeScript passes. The additional test checks clear projector faces, independent resource disposal exactly once, one renderer, and still rendering after a lighting change under reduced motion. GPU visual confirmation remains parent browser QA.

Canonical scene baseline SHA-256: `34F48380EA42AF25291715F7C9870FD90026555AB564B132FA50ABE9A47B8DF9`.

Canonical scene test baseline SHA-256: `F962057877988774976262AA52197FCC08C20ECE517BA8621CE321859ECE1484`.

Staged scene SHA-256: `893F227E6D32F8FE8076F025E67063F4EF785B024E98E38CFD688D03D2495E09`.

Staged scene test SHA-256: `31AAD380BCB7729ED85D4AE1E10C654B570ED4D65C3897943681F4B4483473B9`.

Validation commands are recorded in `REPORT.md`; the current test count supersedes that first-pass receipt.
