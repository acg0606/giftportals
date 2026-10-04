# Tripo research for GiftPortals sponsor improvements

Verified against official public documentation on **2026-10-04**. Read-only research: no authenticated query, paid generation, wallet lookup, credential read, publishing or canonical edit. Existing collection/unboxing staging was preserved.

## Decision

GiftPortals already selects the current documented **H3.1** high-detail family. The most useful next sponsor work is **better approved inputs, actual part interaction, and a carefully selected animated surprise**, with measurable evidence. Changing a model-version label alone would add little. New provider features below are documented availability, not proof that our current API account or v3 adapter can execute them.

## Current implementation evidence

| Existing code | Observed behavior |
| --- | --- |
| [instant.ts:367](C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals/api/_lib/instant.ts:367) | Local generation uses H3.1, 30k faces, PBR, detailed texture/geometry, image alignment. Place inputs can use a separately derived miniature reference while preserving the original. |
| [tick.ts:35](C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals/api/tick.ts:35) | Cloud worker uses H3.1, 10k faces, standard textured PBR. |
| [quality-trial-tripo.ts:11](C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals/api/_lib/quality-trial-tripo.ts:11) | Existing approved-view trial creates four views, hashes and reviews them, then feeds their task into detailed H3.1 generation. This is a usable foundation, not a new proposed API integration. |
| [quality-comparison.json](C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals/public/demo/v22/quality-comparison.json) | Public V22 manifest already compares single-image and matching-view Paris miniatures, with front/left/back/right reference images and cached output. |
| [providers.ts:6](C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals/api/_lib/providers.ts:6) | Current adapter uses `https://openapi.tripo3d.ai/v3` routes and `model`/`input` request fields. Official task docs also describe a different task-oriented contract. New feature schemas must be adapted and fixture-tested rather than copied blindly. |
| [providers.ts:54](C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals/api/_lib/providers.ts:54) | Completed Tripo output currently downloads one GLB and reads v3 `credits_consumed`; there is no part manifest or animation pipeline. |
| [scene.ts](C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals/src/scene.ts) / [collection-scene.ts](C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals/src/collection-scene.ts) | Real GLBs are normalized and rendered. Existing object rotation/wireframe/zoom are available. Neither viewer currently consumes GLTF animation clips with an AnimationMixer. Collection caps total model vertices at 500k, image resources and required extensions. |

The v27 staged unboxing already makes original local ribbons, lid and box panels interactive around the actual GLB. This is honest packaging interaction; it does not claim that a monolithic generated object has provider-created detachable parts.

## Official current capability map

| Capability | Verified availability and limits | Gap / recommendation |
| --- | --- | --- |
| Model families | H3 supports `v3.1-20260211` and `v3.0-20250812`. The separate P1 model is `P1-20260311`, targeting cleaner structured low-poly output; its face range is 48–20,000. H3 is the documented choice when photoreal detail matters more than low-poly structure. [H3](https://docs.tripo3d.ai/model-generation/image-to-model-v3-0-v3-1.html), [P1](https://docs.tripo3d.ai/model-generation/image-to-model-p1-20260311.html) | Keep H3.1 for hero keepsakes. Trial P1 as an optional lightweight mobile/collection variant; our existing 30k-face detailed preset cannot be transferred unchanged to P1. |
| Matching views | H3 multiview takes four directional slots in front/left/back/right order, at least two populated images including front. It can instead chain a generated/edited multiview task ID. [Multiview model](https://docs.tripo3d.ai/model-generation/multiview-to-model-v3-0-v3-1.html) | Promote the existing reviewed V22 workflow into optional creator preparation, with subject consistency checks. |
| View editing | Generated multiview references and per-view edit prompts are available. Their default concurrency is one per respective task group. [Multiview images](https://docs.tripo3d.ai/image-generation/multiview-image.html) | Fix one bad back/side view rather than regenerate a whole set. Preserve original-versus-derived provenance. |
| Parts | Post-generation segmentation splits a supported previous model into editable parts. Completion follows segmentation and can select part names. Mesh edits do not preserve rig data. [Segmentation](https://docs.tripo3d.ai/mesh-editing/mesh-segmentation-v1-0-20250506.html), [Completion](https://docs.tripo3d.ai/mesh-editing/mesh-completion-v1-0-20250506.html) | Add a real part manifest and reviewed rest transforms before enabling object assembly/reordering. Exact part output schema, material retention and useful segmentation for our cached miniatures remain unverified. |
| Generation in parts | H3 `generate_parts` exists, but cannot be combined with texturing/PBR or quad output. [H3 parameters](https://docs.tripo3d.ai/model-generation/image-to-model-v3-0-v3-1.html) | Do not add this flag to the current textured recipe. Prefer a separate segmentation trial of one completed model. |
| Textures | Standard/detailed/extreme tiers are documented; extreme was added June 3, 2026. A texture task accepts part names and text/image style guidance. [Changelog](https://docs.tripo3d.ai/get-started/changelog.html), [Texture task](https://docs.tripo3d.ai/texture/texture-model-v3-0-20250812.html) | A distinctive material finish can make a keepsake personal, but higher texture resolution alone does not improve geometry or interaction. Collection resizes model textures to 1024; benchmark actual visible benefit before paying for extreme. |
| Rigging | Current rig version is `v2.5-20260210`; the older v2.0 rig is offline. GLB is supported; Tripo rig specification is required for retarget. Pre-check reports whether the subject is riggable. [Rig](https://docs.tripo3d.ai/animation/rig-v2-5-20260210.html), [Pre-check](https://docs.tripo3d.ai/animation/pre-rig-check-v2-0-20250506.html) | Use only for an approved suitable toy/character, not every object photo or architectural miniature. |
| Animation | Current rig2.5 retarget has a fixed 27-identifier whitelist, including biped idle/walk/jump. Up to five clips can be requested; baked GLB and in-place motion are supported. [Retarget](https://docs.tripo3d.ai/animation/retarget.html) | Do not request older rig1-only waving/greeting names on rig2.5. Add a bounded mixer to the existing frame gate, with explicit play and lifecycle pause. |

## Three concrete product improvements

### 1. Make the keepsake coherent from every side

After a creator selects a photo, offer **Review the little world**: show four derived views, permit a targeted correction, then generate the approved miniature. After unboxing, let the recipient inspect the same matching directions, so the sponsor result can be compared with its input. Start with the already cached V22 Paris baseline/candidate to improve the jury-facing demonstration without creating another task.

For an eventual paid trial, hold H3.1 model version, seeds, face count and texture settings fixed while changing the input strategy. Record visible rear-surface errors, silhouette consistency, file bytes, triangle count and device render time. Label generated views as imagined references, never as recovered photographic evidence. A P1 variant can be a separate performance experiment, not mixed into that input comparison.

**Why useful:** the reveal becomes a tangible miniature with understandable sides; the existing unboxing and conveyor gain better actual geometry rather than decorative complexity. **Success condition:** a reviewed rotating comparison showing fewer obvious mismatches and no loss of recognizable source details. This expected improvement is an inference to test, not a guaranteed provider result.

### 2. Let recipients inspect and reassemble genuine generated parts

Choose one suitable mechanical keepsake or sculpted toy. Run a reviewed segmentation trial, optionally complete missing cut surfaces, and cache actual part assets plus stable names/rest transforms. After unboxing, offer **Look inside** and **Put it together**. Parts separate gently; selecting a part shows a small author-written clue; a button or direct manipulation restores the exact recorded transform. Keep the original monolithic GLB as a comparison and fallback.

The API supports a post-generation route with supported upstream tasks. [Segmentation](https://docs.tripo3d.ai/mesh-editing/mesh-segmentation-v1-0-20250506.html) Completion selects segmentation-derived names. [Completion](https://docs.tripo3d.ai/mesh-editing/mesh-completion-v1-0-20250506.html) Texture generation can target named parts. [Texture task](https://docs.tripo3d.ai/texture/texture-model-v3-0-20250812.html)

**Implementation needed:** versioned part manifests, output validation, per-part triangle/texture limits, aggregate performance bounds, parent/rest-matrix preservation and accessible equivalent controls. Perform mesh editing before any rigging. **Success condition:** all manipulated pieces are real downloaded sponsor output, return precisely to their reviewed arrangement, and retain a credible textured appearance. Naming quality and visual continuity are presently unknown; this experiment must pass review before being generalized to arbitrary photos.

### 3. Reveal one living toy, with actual rigged motion

Add an optional **A little hello** keepsake for a clearly articulated humanoid toy. Run the free pre-rig check first; if suitable, rig with current v2.5 and request in-place idle plus a small jump. After the third unboxing action, offer a recipient-controlled animation button. The character can later appear as a small keepsake in the imagined World Labs gallery, while walking/collision remains owned by the world viewer.

Pre-check documentation lists multiple rig types but favors clear limbs and cautions against unsuitable forms. [Pre-check](https://docs.tripo3d.ai/animation/pre-rig-check-v2-0-20250506.html) The new rig2.5 whitelist supports idle/jump; it does not document every older expressive gesture. [Retarget](https://docs.tripo3d.ai/animation/retarget.html)

**Implementation needed:** cache clips, use Three AnimationMixer within the existing gate, clamp delta, stop on hidden/offscreen/blur, preserve reduced motion and dispose skeleton bone textures as well as model resources. Do not call a rotating whole model a rigged animation. Keep universal three-step unboxing for ineligible objects. **Success condition:** visibly articulated joints from a real cached animated GLB, with explicit motion control and unchanged fallback. Avoid trying bird flight as the first current-rig demo: the documented rig2.5 preset list does not expose an avian flight preset.

## Verified credit prices and budget implications

The public API conversion is **100 credits = US$1**. Verified components: H3 image/multiview base with texture 30; P1 equivalent 50; texture tier additions standard 10, detailed 20, extreme 30; generated view set 10; edit 5 per view; segmentation 40; completion 50; rig check free; rig 25; retarget 10 per animation. H3 detailed geometry adds 20. These are public list components, excluding taxes/contracts and account-specific grants. [Live API pricing](https://docs.tripo3d.ai/get-started/pricing.html), [Platform billing](https://platform.tripo3d.ai/docs/billing)

Derived estimate for the existing detailed H3 recipe: 30 + 20 texture + 20 geometry = **70 credits**. With a generated view set: **80 credits (US$0.80)**. A segmented/completed cached model adds **90 credits (US$0.90)** before any retexturing. Rig plus two requested clips adds **45 credits (US$0.45)** to a suitable cached model. Final charge must be recorded from the actual returned field; do not conflate provider-contract schemas or treat estimates as receipts.

The existing trial reserves 100 total but checks only 60 just before creating its model stage at [quality-trial-tripo.ts:187](C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals/api/_lib/quality-trial-tripo.ts:187). Review that balance check against current pricing before another paid run. No balance was queried in this research.

Public task docs report `consumed_credit`; current v3 adapter reads `credits_consumed`. They also state downloadable result URLs normally expire after five minutes. [Task results](https://docs.tripo3d.ai/task-query/get-your-task-result.html) Normalize only documented/observed contract variants and cache validated outputs promptly, retaining SHA256, settings, consent/provenance and exact consumption.

## Limits, uncertainty and order

P1 generation defaults to five concurrent tasks; other generation to ten; multiview generation/editing to one each. Image upload has a separate 10-QPS limit. [Rate limits](https://docs.tripo3d.ai/get-started/rate-limits.html) Keep our application budget and concurrency ceilings tighter; public provider ceilings do not imply that this laptop should load more assets at once.

P1 parameters are restricted; unsupported ones error. The latest observed official changelog entry is 1.9.8 dated 2026-08-17. [Changelog](https://docs.tripo3d.ai/get-started/changelog.html) No undocumented newer model, v3 feature endpoint, account entitlement, actual latency, output part schema, segmentation material fidelity or animation quality has been verified here.

Recommended order: **reuse reviewed V22 evidence and improve its product presentation → one bounded real-parts trial → one suitable rigged toy trial**. Keep any P1/mobile and extreme-texture comparison separate. Judge-facing claims should name exactly which assets and interactions come from Tripo versus original local packaging; feature breadth is not evidence that an award will be won. Anonymous access verification and English product screenshots remain required before submission delivery.