# Version 11 photographic worlds

Paris completed on October 5, 2026 with the explicitly selected `marble-1.1`
model. One original scene photograph was moderated, uploaded, and submitted once.
The operation completed without a fallback or repeat submission and reported
1,580 credits. The protected balance checker observed 2,680 World Labs credits
and 23,860 Tripo credits at 11:20:38 UTC after this generation. Rio is reserved
for the separately verified creator flow; this operator did not submit Rio.

The new world recipe preserves visible photo elements, proportions, structure,
materials, natural colors, daylight and spatial relationships. It has its own
photographic direction, independent of the souvenir's collectible styling. Local
and cloud world composition share the same function. Assistant world suggestions
use the same photographic goal. Existing accepted jobs keep their stored recipe.
The Tripo reference function is unchanged; its output was compared with the
submitted baseline for ordinary Paris/Rio contexts and a maximum-length context.
Existing Tripo GLBs and miniature reference images remain unchanged.

## Paris result

- Operation: `c8484689-0817-4243-b72c-0eba363bfb35`.
- World: `43974685-e7a3-4fa6-8c2b-1eda719039ef`.
- Standard export: 500,000 points, 8,143,297 bytes.
- Secondary export: 98,304 points, 1,434,204 bytes.
- Panorama: 12,649,989 bytes.
- Original collider: 991,028 bytes.
- Full resolution: 1,920,000 points, 31,288,033 bytes; retained as a local
  operator artifact instead of loading it by default on phones.
- Metric scale factor: `1.0070722`; ground plane offset: `0.8069917`.

The static gift is `/demo/v11/paris-generated-gift.json`. It loads the 500k
world and original same-world collider, retains the submitted Paris Tripo model,
and includes the real source photograph, attribution and metric semantics.
`public/demo/v11/paris-world.provenance.json` records exact hashes, sizes,
provider IDs, prompt hash, classifier receipt and cost. World parsing, download
ceilings and billing invariants were preserved. The full-resolution download is
separately bounded to 50 MiB compressed, 256 MiB decompressed and 2.5 million
points; ordinary runtime/provider assets retain their existing smaller bounds.

The generated panorama was visually reviewed: photographic daytime surfaces,
river, boats, buildings, railings and an Eiffel Tower silhouette replace the
illustrated treatment. The original photograph remains the visual reference;
unseen parts are inferred by the generator, so this is not a measured city scan.
Collider availability does not by itself verify every walkable viewpoint. Mobile
frame rate, detail and route support require the separate viewer/browser checks.

## Original scene references

Paris uses [Overview Seine River to Eiffel Tower](https://commons.wikimedia.org/wiki/File:Overview_Seine_River_to_Eiffel_Tower_(37578867564).jpg)
by Alex Liivet, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
The original 3840 × 2160 photograph is stored without an artistic conversion.

Rio uses [Botafogo Beach and the Sugarloaf Mountain](https://commons.wikimedia.org/wiki/File:Botafogo_Beach_and_the_Sugarloaf_Mountain.jpg)
by Donatas Dabravolskas, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The Wikimedia 3840 × 2563 resized photograph is the actual scene reference.
Published Rio derivatives must retain attribution, the license link and the
notice that the three-dimensional surroundings were generated. The original
miniature reference remains separate and unchanged.

Both reference hashes and source credits are public in
`public/assets/examples/v11/*-scene.provenance.json`. Catalog attribution comes
from the curated source records, rather than client-supplied metadata.

## Validation and operation

The focused operator suite passed 33 tests, including exact model-specific
reservation, insufficient credit refusal, moderation, deduplication, persisted
ambiguous submission and terminal failure without automatic model fallback.
Local/cloud world composition, source routing, catalog behavior and unchanged
Tripo recipes passed 59 tests. Assistant defaults passed 17 tests, including
English behavior with a Portuguese request. TypeScript checking passed.

`tools/export-v11-world-example.mjs <paris|rio> <completed-receipt>` exports
already downloaded, hash-verified assets from the local operator directories.
It makes no network request, changes no provider permission and generates
nothing. The exported gift uses 500k by default. Full resolution stays in ignored
`outputs/v11` for a later controlled rendering comparison.

Model names, exported resolutions and credit costs were checked against the
official [World Labs models](https://docs.worldlabs.ai/api/models),
[pricing](https://docs.worldlabs.ai/api/pricing), and
[SPZ rendering](https://docs.worldlabs.ai/api/rendering-spz) documentation.
No production deployment, main-branch change or production environment change
was performed by this generation/export work.
