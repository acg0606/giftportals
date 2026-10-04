# Painted future generations

The staged local and cloud recipes use the same required luminous oil painting style, impressionistic brushwork, softly blended edges, cheerful pastel colors, warm low backlight, painted rim glow, luminous haze, suspended dust and refined detail. Source photos supply object identity and physical arrangement; they cannot override the rendering direction.

Souvenir reference images retain full volumetric collectible geometry, complete front/side/roof/back forms, real air gaps and a coherent three-quarter view against empty white space. World prompts retain human scale, continuous connected ground, readable paths and depth behind and beside the viewpoint. These prompts do not certify generated colliders; normal real-collider walking calibration still applies.

Prompt versions are `giftportals-world-painterly-v1` and `giftportals-souvenir-painterly-v1`; the shared style version is `giftportals-painterly-v1`. Existing generated gifts and persisted job prompts are not regenerated.

## Integration

- Apply the six paths listed in `manifest.json` to the app root after checking the two canonical baseline hashes.
- In the parent-owned cloud service, import `WORLD_ART_PROMPT_VERSION` and `SOUVENIR_ART_PROMPT_VERSION` from `cloud-instant-recipes.js` and replace the old literal prompt-version metadata with those constants.
- The existing manual data-URL loaders in `api/tests/instant.test.mjs` and `api/tests/story-audio.test.mjs` need to map `../../shared/gift-art-style.js` to the loaded `shared/gift-art-style.ts` module when they load `instant.ts`.
- Replace the old hardcoded world version assertion in `api/tests/instant.test.mjs` with `i.WORLD_COMPOSITION_VERSION`.

## Verified limits

All six focused tests pass. Strict server TypeScript checks the three staged source files without errors. Tests cover local/cloud prompt equality, input preservation, geometry requirements, conflicting source-style instructions, versions and actual mocked creation payloads.

The existing place-photo reference stage uses the same `chat_image_2` medium 1536×1024 PNG request. Model reconstruction still uses `v3.1-20260211`, 30,000 faces, texture/PBR and the existing detailed settings. World models, credit reservations, provider request schemas and paid-call counts are unchanged. No external requests, migrations, deployment or provider generations were performed.

Direct object-photo image-to-model reconstruction has no evidenced prompt/style field in the existing supported request. Its resulting GLB texture cannot honestly be guaranteed to have painted brushwork. Enforcing that appearance needs an explicitly painted input or a separately approved reference-generation/retexturing stage; adding such a stage would change the workflow and budget and is deliberately not included here. All new world prompts and the already existing automatic place-souvenir reference stage use the required painted direction.
