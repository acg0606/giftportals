# V13 sponsor environment composition

GiftPortals now composes a spatial environment around the gift's setting and meaning. Its World Labs request describes a visible floor, foreground detail, grounded middle-distance focal elements, a complete background and consistent light. This is creative direction: the generated result still needs visual review, and requested ground continuity does not prove that a collider provides a usable floor.

## Input routing

| Gift input | Tripo receives | World Labs receives |
| --- | --- | --- |
| A place photo | A separate framed JPEG keepsake | The preserved original scene, plus the composed text |
| An object photo | The preserved object photo, or an explicitly supplied derivative | A composed text environment related to the object's setting or craft |
| An object with a separate scene reference | The object input | The separate scene image, plus the composed text |

The shared ten-example catalog supplies five city scenes and five object interpretations. `exampleId` is validated against that catalog and included in the request hash. It identifies selected creative context; it does not authenticate a photo, museum artifact, location or historic interior. All images receive the same local safety checks. Original photos remain preserved separately from Tripo derivatives.

World Labs supports image-plus-text generation through its image prompt schema. GiftPortals uses uploaded media assets, explicit `is_pano:false` for ordinary photos and `disable_recaption:true` to retain the composed text. These fields are supported in the official [generation reference](https://docs.worldlabs.ai/api/reference/worlds/generate) and [OpenAPI schema](https://docs.worldlabs.ai/api/reference/openapi). The [generation examples](https://docs.worldlabs.ai/api/world-generation-examples) describe the image and text workflow.

## Composition and receipts

The prompt builder requests one cohesive, human-scale environment with:

- A clear, level, visually legible initial viewing area and tactile foreground surfaces.
- A readable path or open floor, a few grounded focal elements, varying heights and overlapping forms.
- Surrounding detail behind and beside the viewpoint, atmospheric depth and a stable distant horizon.
- Consistent light, believable material detail and recognizable foliage outside the clear viewing area.

These choices follow the official [image prompting guidance](https://docs.worldlabs.ai/marble/create/prompt-guides/image-prompt). They aim to improve depth and scene coherence; they do not promise an exact reconstruction or prevent every visual artifact.

Each new local job records `generation.worldlabs.promptVersion` (`giftportals-world-layout-v13`), the exact outgoing `textPrompt`, selected context source, reference mode and image flags. Its existing receipt also records original/derived/reference hashes, provider task IDs, settled costs, output hashes, splat quality and optional collider status. Request tokens and provider credentials are excluded from public documentation.

Tripo H3.1 receives the image and documented quality controls: PBR textures, detailed texture and geometry, 30,000 faces, and image-aligned orientation. Its image-to-model endpoint has no documented text-prompt field; scene instructions are therefore sent to World Labs rather than invented Tripo parameters. See [Tripo image-to-model](https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard) and [H3.1 model settings](https://developers.tripo3d.ai/en/models/v3-1).

## Quality and resource limits

The default is explicitly pinned to `marble-1.1`. Standard photo or text generation uses a 1,580-credit accounting reservation: 1,500 for the world and 80 for panorama generation. In release **10.2.1**, local lifetime credit caps and `LOCAL_WORLDLABS_CREDIT_CAP` / `LOCAL_TRIPO_CREDIT_CAP` enforcement are retired. Status reports reserved and settled commitments without an app allowance gate. Fresh account-balance checks use task cost and omit the former extra 1,000-credit cushion. Explicit creation consent, request deduplication and uncertain-submission guards remain in place. There is no automatic credit refill or purchase. Actual task costs settle from provider results. [World Labs pricing](https://docs.worldlabs.ai/api/pricing)

For completed worlds, the backend chooses an existing 500k SPZ output when available, with a 100k fallback. Downloads remain limited to 25 MB and a validated SPZ point bound. It also obtains the existing coarse collider GLB when supplied. A collider is an optional navigation input; the viewer must validate a floor before allowing grounded movement. Raw scene units are not labeled as meters. [Export specifications](https://docs.worldlabs.ai/marble/export/specs), [SPZ rendering and semantics](https://docs.worldlabs.ai/api/rendering-spz)

The API also offers `marble-1.1-plus`, video and multi-image inputs. They are not silently enabled here. Plus has a variable cost, while multi-image generation expects coherent views of the same scene. Unrelated city or object images should not be presented as a multi-view reconstruction. A future multi-image feature needs per-image safety checks, upload and hash receipts, and an explicit budget choice. [Models](https://docs.worldlabs.ai/api/models), [multi-image guidance](https://docs.worldlabs.ai/marble/create/prompt-guides/multi-image-prompt)

High-quality textured mesh export is a separate operation with separate pricing; the ordinary collider download is not a high-quality visual mesh export. This change does not request that operation. [Export specifications](https://docs.worldlabs.ai/marble/export/specs), [pricing](https://docs.worldlabs.ai/api/pricing)

## Safety and validation

The local safety adapter still screens the original photo, Tripo derivative and any scene reference in memory before persistence, provider uploads or paid submissions. Missing models, classifier failures, blocked images and uncertain results fail closed. Approval receipts bind exact hashes; a resumed pending job cannot replace an approved image. Capability checks remain required for each private asset. Tripo `banned` and `expired` responses now terminate the task rather than polling indefinitely. [Tripo task lifecycle](https://developers.tripo3d.ai/en/docs/task-lifecycle)

Validation at backend freeze: 45 focused API/safety tests passed, and strict server TypeScript compilation passed. Tests use injected providers and synthetic safety decisions; they perform no sponsored API generation. Coverage includes city/object routing, original preservation, exact outgoing prompt receipts, catalog cloning, invalid example IDs, unchanged moderation, deduplication, budgets, protected asset access and terminal provider failures.

```text
node --test --test-reporter=spec api/tests/image-safety.test.mjs api/tests/instant.test.mjs api/tests/backend.test.mjs
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types node api/giftportals.ts api/tick.ts api/instant.ts
```

No paid generation was performed to validate this backend change. A representative provider run and rendered review are separate evidence and must be recorded after the controlled generation completes.

## Local screening policy 2

The initial 20-label CLIP taxonomy put a scenery-only Paris artwork into review: the trained five-class detector reported neutral `0.999821`, but the broad CLIP label set produced a sexual signal of `0.220629`. Similar missing ordinary categories affected spacecraft and record references. This was a CLIP context failure, not a detected nude scene.

Policy 2 adds ten broad ordinary scene, framed-art and scientific-object prototypes. It also encodes each text prototype independently, once at worker startup. Diagnostic inference found that adding labels to a single quantized text batch changed existing normalized embeddings by up to `0.03518` per component; independent encoding removes that source of batch-dependent change. Image embeddings, trained NSFW inference, sensitive labels and all allow/review/block thresholds are retained. CLIP similarities remain comparative screening signals rather than calibrated probabilities. [MobileCLIP ONNX model and inference guidance](https://huggingface.co/Xenova/mobileclip_s0)

The policy is identified as `giftportals-local-vision-v1:clip-text-q8+clip-vision-fp32+vit-nsfw-q8:policy-2`. Existing weight hashes and pinned revisions remain unchanged, and no weights were downloaded for this correction. Existing approved jobs retain their original policy 1 receipts.

Focused validation expanded to 51 API/policy/context tests. Real local-worker smoke receipts are stored in `outputs/v13/local-vision-policy-2-smoke.json`. Ten original catalog images must allow and the existing adult-product negative must block before the correction is considered ready. Approximate framed-scene diagnostics also passed, while actual browser-created derivatives remain subject to a fresh creation-time screen. This small smoke set is not a safety benchmark or proof of comprehensive nudity detection. No photo was sent to a sponsored provider for these checks.
