# Parallel desk change: read-only audit

Compared the staged contrast refinement with the subsequently changed canonical scene and tests. No canonical file, staged implementation, test, or bundled asset was modified. The parallel state is preserved.

| File | Earlier staged SHA-256 | Audited canonical SHA-256 |
| --- | --- | --- |
| `src/collection-scene.ts` | `893F227E6D32F8FE8076F025E67063F4EF785B024E98E38CFD688D03D2495E09` | `85D788D3569BCE12A4A18627D56C860D3BFCD0820F894AFECF22D226060DD977` |
| `tests/collection-scene.test.mjs` | `31AAD380BCB7729ED85D4AE1E10C654B570ED4D65C3897943681F4B4483473B9` | `97F28B56F306A24D62B2DCEDC181F29C66625B9AD0A4A2957BC0DE881742CF0D` |

No blocking privacy, late-callback, disposal, or public-controller regression was found in the inspected diff. This is a source audit; parent owns the final executed suite and GPU QA for this canonical state.

## Concrete resource caveat

`loadDeskWood` checks its 0.6 MiB per-map cap **after** `fetchViewerBytes` has downloaded and buffered the response. That helper permits 25 MiB by default and clamps an explicitly supplied limit to at least 25 MiB. Therefore these three new concurrent requests can transiently buffer substantially more than their advertised wood-map cap. Passing 0.6 MiB as the helper's fourth argument would not fix that behavior.

This does not invalidate the actual bundled assets: diffuse is 215,573 bytes, normal 51,927 bytes, roughness 237,261 bytes; total **504,761 bytes**. Dimensions are checked before bitmap decode, and a map exceeding 1024 pixels on either axis is rejected. A future hardening change could give the byte reader an explicitly supported smaller cap and test rejection during streaming; it is not necessary to replace or revert these current files.

The three PBR image jobs run independently of the existing two GLB/photo queue workers. Documentation should say **two concurrent model decode jobs**, not two total asset jobs. The small fixed 1k textures make this bounded additional work; no new model generation is involved.

## Verified safeguards in the diff

- **Privacy:** all three PBR paths are fixed `/assets/desk-pbr/…` paths resolved against `location.origin`. The shared fetch helper uses `credentials: 'omit'`, `redirect: 'error'`, and `referrerPolicy: 'no-referrer'`. There is no runtime Poly Haven API call, provider task, new recipient, private gift URL in telemetry, or credential read.
- **Atomic install:** the diffuse/normal/roughness trio uses `Promise.allSettled` and attaches only if all three succeeded, the viewer remains active/current/connected, and the shared controller has not aborted. Diffuse uses sRGB; normal and roughness use no color space. Partial successes are explicitly closed and disposed, leaving the untextured fallback intact.
- **Late completion:** destruction aborts downloads and clears deadlines. A bitmap returned after exit is closed before creating its texture. Textures produced earlier in a partly pending batch are disposed when that batch settles. The final guard prevents attachment, diagnostics changes, or frame resurrection after exit. Non-cancellable `createImageBitmap` work may finish later; it is still limited to three validated 1k images and is then released.
- **Cleanup:** installed PBR textures enter `extraTextures`; destruction closes each owned image once and disposes the texture. The PMREM source environment and generator are disposed in `finally`; the retained render target is disposed at viewer destruction after clearing `scene.environment`. The new source environment uses the same renderer, not a second context or RAF.
- **Lifecycle and contract:** fair shuffle, manual pin/pause/step, reduced-motion handling, hidden/offscreen/blur frame gating, existing model expiry, GLB validation/loading, and the returned `CollectionSceneHandle` API are unchanged. A late successful local texture install only invalidates the existing frame gate, which remains asleep when hidden or blurred.
- **Performance scope:** antialiasing is now enabled and PMREM adds a one-time environment prefilter plus a retained render target. These do increase GPU work relative to the procedural fallback. Mobile frame-time and memory conclusions require browser/device QA; source inspection and mocked PMREM tests cannot establish them.

The changed tests add atomic PBR installation, partial-map failure, late bitmap completion, image/texture/render-target disposal, and renderer settings. They mock PMREM and bitmap decode rather than exercising a real GPU. The parent rerun of the current-state suite should remain the reported execution evidence; this subtask did not claim the earlier 38-test run applies to the new canonical implementation.

## Visual scope, recorded without reverting

The parallel version also replaces the painted sunset with a neutral reflective window, removes the desk globe, removes the abstract laptop screen graphics, and switches the pastel matte props to neutral/charcoal and more reflective PBR finishes. These are actual visual changes beyond loading and cleanup. Whether they match the latest artistic direction is an owner/browser-review decision, not an API or privacy finding. The local asset credit file records Poly Haven's Wood Table 001 and CC0 attribution; that file was read, not independently re-verified on the web in this offline audit.
