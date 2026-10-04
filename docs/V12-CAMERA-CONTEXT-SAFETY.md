# Camera, optional place context and image screening

The creator now opens a real browser camera session, offers optional location context, and screens every image locally before sending anything to Tripo or World Labs.

## Experience

1. Choose **Take a photo** for a live, video-only camera preview, or **Choose a photo** for an explicit upload. Capture, review, retake, then use the selected still. Live video is never uploaded. Camera tracks stop during review and on close, navigation, hidden tabs or late permission resolution.
2. **Connect it to a place** is optional and starts off. **Use my location** requests browser geolocation only after a click. Coordinates are rounded to two decimals before retention, matching or display. A local Natural Earth map offers zoom, an approximate marker, editable place name and manual city selection. Skip invalidates late GPS callbacks and removes the previously added place sentence. No coordinates enter the generation API, saved gift or session storage; only a confirmed place name can enter the user's description.
3. **Discover its story** checks and analyzes the image locally. A possible category is editable; it does not authenticate the object's maker, age, value or provenance. Reviewed facts link to primary museum, municipal or heritage sources. Creative story ideas are labelled separately. Up to two chosen curiosities are saved with the gift and appear as **Historical context**, alongside the personal story.
4. Confirm rights and sending approved images and the place description to Tripo and World Labs. Creation screens the original image, derived keepsake reference and any separate place image again before saving, uploading, checking credits or creating paid tasks.

Curated regional facts currently cover Rio de Janeiro, São Paulo and Kyoto, with local nearest-city matching bounded to 35 km. Other places still support the map, manual label and the user's own story. This is a regional map, not street navigation. Declining location still supports image analysis and object-category curiosities.

## Safety behavior

The local checker runs isolated Python CPU inference, one thread per ONNX session. It combines a trained five-class image detector's sensitive categories (`hentai`, `porn`, `sexy`) with MobileCLIP comparisons for adult products and broad object categories. The policy distinguishes allow, block and uncertain review. Block, uncertainty, missing models, invalid responses and timeouts all close the creation gate. Approved receipts bind every input's SHA-256 digest and model version; altered inputs or legacy pending jobs without an approval cannot resume paid work.

No image is sent to an additional AI provider. Model downloads and package installation happen only in the explicit setup commands; inference uses local files. The worker receives a scrubbed environment without sponsor keys. Models/runtime are excluded from Git and blocked by Vite's private-file serving rules.

This is MVP screening, not a measured moderation benchmark or a guarantee of detecting every intimate image or adult product. The tested negative example is a product-only, public-domain photo; no intimate personal photos or explicit people were collected for testing. Uncertain images require another photo, rather than a client-side bypass.

## Setup and validation

Run from the GiftPortals directory with Node and a Python runtime containing Pillow and NumPy:

```powershell
node tools/setup-local-vision-runtime.mjs "C:/path/to/python.exe"
node tools/setup-local-vision.mjs
node tools/local-vision-worker.mjs --probe
./tools/start-instant-preview.ps1 -UseProtectedVault
```

The isolated CPU runtime pins `onnxruntime==1.20.1` and `tokenizers==0.22.2`. Newer native runtimes failed to initialize on this Windows notebook; the pinned runtime was verified by actual inference. The selected model files total 177,917,995 bytes, pinned to the revisions in the setup script. MobileCLIP uses quantized text and the model's configured full-precision vision branch; forcing the vision branch to q8 produced false positives on ordinary examples and was corrected without reducing policy thresholds.

Validation completed:

- **223 tests passed**, frontend and server TypeScript passed, production build passed.
- Actual local inference approved the Rio keepsake, bamboo landscape and bird; the bird was suggested as a bird and the Rio object as a keepsake. Cold inference was roughly 3–4 seconds; warm inference was roughly 0.7–1.6 seconds in these samples, not a performance guarantee.
- A [public-domain product-only fixture](https://commons.wikimedia.org/wiki/File:Vibrator.jpg), authored by Mekitin, was blocked as an adult product. Actual creation returned `422 PHOTO_SAFETY_BLOCKED`, added no job directory, and the browser disabled the creation button. No sponsor generation was performed during this change.
- Browser checks covered local analysis, category, source links, story idea, manual map selection, zoom and Skip; the place sentence was removed on Skip. Desktop and phone layouts were inspected. Unit tests cover GPS opt-out, rounding, late callbacks, camera track release, denied/error flows and malformed classifier responses.
- The integrated browser opened the camera modal and requested camera access instead of opening a file picker. Physical webcam capture remained awaiting the browser permission prompt; successful hardware capture is **not claimed**. The real GPS hardware/service was also not used; location lifecycle tests use mocks, and rendered map checks used manual city centres.

Evidence: `outputs/v12/tests.tap`, TypeScript logs, `build.txt`, `benign-triage.json`, `adult-product-triage.json`, `adult-product-create-block.json`, and the screenshots below. Existing gifts, private photographs and submission receipts were preserved. No deploy, commit, push or submission was made.

![Optional local map](../outputs/v12/map-desktop.png)
![Object and regional curiosities](../outputs/v12/curiosities-desktop.png)
![Phone layout](../outputs/v12/curiosities-mobile.png)

Map data: [Natural Earth, public domain](https://www.naturalearthdata.com/about/terms-of-use/). Fact source links are defined in `shared/gift-curiosities.ts` and rendered with each approved fact. Model references: [MobileCLIP conversion](https://huggingface.co/Xenova/mobileclip_s0) and [ONNX image detector](https://huggingface.co/onnx-community/nsfw-image-detector-ONNX).
