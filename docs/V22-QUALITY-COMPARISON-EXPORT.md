# Offline quality comparison export

The comparison at `#/quality-comparison` opens the completed current and trial assets in the same viewer, one renderer at a time. `kind=world` selects the world comparison; `kind=object` selects the miniature. When captured 3D renders are available, miniature cards use them with the label “3D render · open to rotate”. Other previews are clearly labeled as generation references or world panoramas.

Run from `projects/giftportals` with Node 22 or later:

```powershell
node tools/export-quality-comparison.mjs
node --test tests/quality-comparison.test.mjs tests/quality-comparison-export.test.mjs
```

The default trial IDs are `paris-multiview-v22-20261003` and `paris-plus-v22-retry-20261003`. The first world trial ended in a confirmed provider error 500; its receipt remains preserved. Override the IDs with `--tripo-trial <id>` and `--world-trial <id>` when reviewing another deliberate experiment. Export does not upload, poll, generate, or spend credits.

The exporter reads local trial ledgers and validates source assets before copying them to `public/demo/v22`. It verifies the existing v17/v13 baseline by its cached asset hashes, image safety receipts and bytes, the approved multiview hash before exporting a completed model, self-contained GLB geometry, and gzip SPZ headers and point counts. It writes only selected reference images, screened views, completed models, worlds, panoramas and available collision meshes. Private job files, upload tokens and provider capability URLs stay outside the public export.

The miniature and world candidates become available independently. An absent or processing result has no candidate path in the manifest. Checked reference inputs can appear while generation continues. The world supports two to four checked cardinal views; the manifest records the exact input count, and an omitted direction is not displayed as a submitted input.

The exporter writes `/demo/v22/quality-comparison.json` last. Its sanitized integrity report is `outputs/v22/quality-comparison-export.json`. Rerunning against unchanged completed inputs produces the same public files. Baseline files are never overwritten. Source asset tampering fails before replacing a previously valid comparison manifest.

Optional browser captures at `outputs/v22/miniature-baseline-render.jpg` and `outputs/v22/miniature-candidate-render.jpg` are checked for JPEG magic, bounded size and SHA-256 before export. Each thumbnail is published only when its corresponding model is completed. The generating-input image strip remains separate. Missing thumbnails fall back to the original generation references.

Both actual render captures come from the same gift viewer at the same 1280 × 720 frame. The comparison card crops their presentation to the object panel at x=0, y=69, width=746, height=549. This CSS crop removes the surrounding header and story copy while retaining the actual rendered model; it does not synthesize or retouch either model image.

The world candidate uses the baseline miniature, while the miniature candidate uses the baseline world. This keeps each comparison focused on its own output. The exact local V22 world path selects a conservative `river-plus` camera corridor and the Paris newspaper reader. The baseline retains its original river corridor. Model and reference/input strategy change together across the world experiment; this is a visual comparison of the complete pipeline, not an isolated model benchmark or a factual reconstruction.

`#/quality-reference-capture` derives 768 × 768 perspective images from the existing Paris panorama at a fixed virtual-camera position. Front/right/back/left are yaw 0°/90°/180°/270°, pitch 0°, with 110° field of view and 20° overlap. The tool uses geometric rendering and performs no AI generation. Its manual download button exports only the chosen canvas as PNG.
