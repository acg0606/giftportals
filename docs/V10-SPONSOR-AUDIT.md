# GiftPortals Release 10.0.0 — sponsor and publication audit

Reviewed on 2026-10-04 in the isolated release snapshot. Earlier V3–V27 increment notes are historical evidence; their visual directions and version labels do not describe this release.

## Final substitutions and claim boundaries

| Tool | Actual release use | Pending or excluded claims |
| --- | --- | --- |
| Tripo | Collection, gift, XR and print viewers reuse actual completed textured Tripo GLBs. The collection preserves original materials, with a 2048-pixel desktop texture budget and 1024-pixel mobile budget. | No fresh Tripo generation or new Tripo credit spend is claimed for this release. These artistic souvenirs are not factual reconstructions or animated models. Live creation needs the server provider environment. |
| World Labs | A newly generated room replaces the procedural desk, laptop, globe, plants and other primitive props. Three.js and Spark render actual 500k/100k SPZ assets; the generated panorama is an honest image fallback. Existing memory worlds remain actual cached outputs. The first room settled at 1580 provider credits, receipt prefix `ee95db90`. | This text-generated room has imperfect composition and is an artistic interpretation. A second image-input room is pending and is not completed evidence here. Static splats do not establish exact geography, supported walking, seamless rooms or animated objects. |
| TapNow | The homepage uses an actual downloaded TapNow raster hero, `public/assets/v10/hero.jpg`, with an original output of 3072 × 1728. Recorded balance moved from 200 to 140 credits, a 60-credit difference. | Model naming in the provider UI was inconsistent, so attribution is to TapNow only. A second crop operation is pending; the latest observed balance is 68, without a completed result or final settled-cost claim. A raster hero is not a Tripo GLB or World Labs world. |
| PICO / WebXR | **Enter Portal in VR** explicitly requests a standard immersive WebXR session. The viewer loads the real keepsake and optional World Labs room/memory, supports trigger turns, grip grab/release and studio/memory switching, and returns to the ordinary viewer on exit. | No physical PICO headset was tested. The 17 XR tests mock headset/GPU/Spark interfaces, using a real GLB parser and actual local SPZ bytes at the transport boundary. Stereo comfort, headset performance, real controller mapping, passthrough and PICO-specific features remain pending. Standard WebXR alone does not certify the PICO Tool Track. |
| HeyGears | The print panel exports the unchanged color GLB and scaled STL/ZIP package with mesh diagnostics for review in Blueprint. | No Blueprint import, supports, slicing, resin profile, printer connection or successful physical print is evidenced. File preparation does not certify manufacturability or named-device integration. |
| Jupiter SR | Research and access requirements remain documented. | No verified device access, SDK/API, calibration, playback or device integration exists. A decorative projector or compatible model is not Jupiter SR evidence. |

The collection no longer uses the Moebius/illustrated room treatment or procedural room fallback. The cached full-resolution 2.5m room is optional, not the default collection/XR budget. If SPZ loading fails, diagnostics identify the panorama fallback honestly.

## Environment and public operation

Production URL: **pending deployment receipt**.

Cached assets work without paid provider calls. New generation, private cloud storage, expiry/retention jobs and accounts require the appropriate server environment, storage/database setup and actual deployment verification. Local protected credentials stay outside browser/public assets. An unavailable environment must keep creation unavailable; a local build does not prove public generation.

The strongest established tool evidence is Tripo plus World Labs. TapNow now has completed visual output; event eligibility and any third Tool Track selection still need the actual rules and submitted evidence. PICO, HeyGears and Jupiter validation remain pending until real device/software use is recorded.

## Publication payload inspection

The bounded scan inspected 104 public files, 532 production-output files, 98 source files and 79 documentation files. It checked text assets and embedded GLB JSON for credential literals, private keys, sensitive signed/private URLs, external GLB dependencies and obvious local paths/contact metadata. Only filenames and counts were printed.

- No credential/private-key, sensitive signed/private URL, external GLB resource or sensitive-filename candidate was found in `public/` or `dist/`.
- Four email candidates occur in `dist/cesium/LICENSE.md`: third-party license notices that retain their attribution.
- Seventeen local-path references occur in seven historical docs: `V23-WORLD-OPERATOR.md`, `V27-INTERFACE-COHESION.md`, `V27-SQL-VALIDATION.json`, `V27-TRIPO-RESEARCH.md`, `V7_RIO_VALIDATION.md`, `V8_CREATOR_VALIDATION.md` and `V9_VALIDATION.md`. They are development evidence, not public app assets.
- `.vercelignore` excludes environment files except the example, protected local state, output evidence, Git, dependencies, tests, historical docs, operator tools and design QA. Vite does not copy repository documentation to `dist/`.

This is a static scan, not proof that every arbitrary binary metadata field is free of personal data. Demo people, stories and travel artwork remain fictional. Private user uploads and original provider credentials do not belong in public assets.

## Executed validation

The full suite ran with concurrency 2: 700 tests, 698 initially passed, and two ESM-loader failures were isolated outside collection/XR. Their fixes passed four focused checks. All 17 XR tests passed, including two studio/memory round trips, grip grab/move/release, world failure preserving the studio, late decode disposal, late fetch after session end and a second independent session lifecycle. These are software checks; physical hardware validation remains pending.

See [asset credits](../public/assets/v10/ASSET-CREDITS.md), [current art direction](ART-DIRECTION-V10.md), [prior-work disclosure](CREDITS.md) and [historical documentation](archives/README.md).
