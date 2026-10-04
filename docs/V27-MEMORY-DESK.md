# Memory desk staged change

The collection is now an original procedural 3D personal desk: wood tabletop and legs, a sunset window with curtains, laptop, books, ceramic mug, globe, reading lamp, and plants. A peach and lilac transparent pyramid surrounds the central approved keepsake. Warm matte materials and locally painted canvas textures give the room a softly brushed appearance. No downloaded art, provider generation, additional renderer, dependency, or hardware API is involved.

Apply only these staged files, retaining their relative paths:

- `files/src/collection-scene.ts`
- `files/src/collection-room.css`
- `files/tests/collection-scene.test.mjs`

Parent owns `collection-room.ts` and the Memory desk title, instructions, and accessible button labels. No canonical source was edited by this subtask. `stage-desk.mjs` and `stage-tests.mjs` are editing records, not files to apply.

## Behavior and limits

- The existing `CollectionSceneHandle` selection, reset, look, zoom, lighting, playback, step, and destroy contract is retained. Manual previous/next still follows collection order. Manual selection and dragging pause playback and preserve the central gift.
- Autoplay changes the one central keepsake every 5.5 seconds using a Fisher–Yates shuffle bag. Normal automatic playback visits every item once per bag and prevents adjacent repeats; manually choosing an item can consume/discard its remaining bag entry to avoid repeating that manual choice immediately. A one-item set stays on that item.
- Presentation transitions scale and float scene groups; the actual GLB asset bytes, textures, and materials are not regenerated or replaced. Existing object and memory model orientation/normalization remain in use. Real model loading replaces the wrapped loading proxy; failed models retain an honest image fallback.
- The existing shared animation gate is capped at 20 fps. No second RAF or timer drives random appearance. Hidden, offscreen, and window-blur states sleep; resumed frames clamp elapsed time rather than skipping souvenirs. Reduced motion uses still transitions and manual stepping without autoplay.
- The six-item maximum, two concurrent decode jobs, GLB resource validation, 25 MiB model limit, vertex/texture limits, private media expiry, late-load disposal, and context-loss fallback are retained. Forty laptop keys share one instanced draw; room materials/geometries and canvas textures are disposed by the scene lifecycle.
- The projector is an original browser visual, not a claim of JupiterSR hardware integration. The photo fallback remains a functional accessible collection when WebGL is unavailable; it does not claim to render this 3D room.
- This lighting/material treatment affects the original room. Current souvenir texture images remain unchanged; an existing photorealistic GLB texture cannot honestly be described as a newly generated oil painting.

## Validation

Executed from `output/giftportals-v27/collection/validation` after copying these staged targets into the isolated validation copy:

```text
node --test tests/collection-scene.test.mjs tests/collection-conveyor.test.mjs tests/collection-room.test.mjs
37 tests passed, 0 failed

node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM --skipLibCheck src/collection-scene.ts src/collection-conveyor.ts src/collection-types.ts src/viewer-runtime.ts
exit 0
```

Tests exercise actual central-model shuffle/selection/pause, fair shuffle bags, 20 fps scheduling, reduced motion, offscreen/hidden/blur suspension without catchup, portrait selected-model framing, loading failures, GLB resource guards, expiry, and late disposal. Existing room and legacy conveyor contract checks also pass. The validation copy uses the existing collection-room controller; parent's text-only room changes still require their normal final checks. GPU screenshots and subjective composition review remain parent browser QA; passing these tests does not establish the rendered room's visual quality.

## SHA-256 receipt

| Target | Canonical baseline | Staged result |
| --- | --- | --- |
| `src/collection-scene.ts` | `D1EC0B3BB8874D7D398E1F2079FC6396AEF7EB4D0515D33A8589EE4AB87A0F5E` | `34F48380EA42AF25291715F7C9870FD90026555AB564B132FA50ABE9A47B8DF9` |
| `src/collection-room.css` | `7EA44182B009484A6664154D7D17A58B9F439832A802C618FD657B947B6454F1` | `C3C7A14A935A2743EF68FF707F8E97BEA50D7534DD74CA9A9EC3A9B346670704` |
| `tests/collection-scene.test.mjs` | `4BE01C9098EED5453FB90DF1A96324E75C42107D45F275B5177CC20F6BD57A43` | `F962057877988774976262AA52197FCC08C20ECE517BA8621CE321859ECE1484` |
