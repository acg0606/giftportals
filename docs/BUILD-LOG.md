# GiftPortals build log

GiftPortals turns a photograph, a setting and a personal message into a 3D
keepsake and an explorable memory world. The recipient can open the gift in a
browser, inspect the object, read the author's story and explore the surrounding
scene.

- [Live application](https://giftportals.vercel.app)
- [English walkthrough](https://giftportals.vercel.app/media/giftportals-tripothon-english-walkthrough.mp4)
- [Source repository](https://github.com/acg0606/giftportals)
- [Credits and prior-work disclosure](CREDITS.md)

This log records completed development and its practical limits as reviewed on
4 October 2026. The application release is **10.3.3**. Publication and a selected
track do not establish a submitted entry or successful hardware integration.

## Starting point and prior work

One developer directs the product, tests and asset choices with AI-assisted
implementation. The project began in the existing `hackador-template`
repository and reused earlier Present Street rendering patterns. Those patterns
and the earlier prototype predate this GiftPortals increment.

The new work includes the gift creation and recipient flows, Tripo and World Labs
integration, private cloud job recovery, the memory collection, the daylight
desk, object inspection, guided exploration and the English product policy.
Earlier increments remain documented rather than being presented as newly built
from scratch. [Full prior-work and asset credits](CREDITS.md).

## Development milestones

### Actual generated keepsakes and worlds

Tripo supplies completed textured GLB souvenirs. World Labs supplies completed
Marble environments, including SPZ splats, panoramas and colliders. Three.js and
Spark render the assets; Rapier resolves supported walking against the provider's
original collider. Public examples and stories are fictional, and generated
places are artistic interpretations rather than surveyed reconstructions.

TapNow artwork informed the welcome and an earlier room reference. OpenAI
ImageGen produced the selected daylight concept and a cleaned room reference.
The current desk is a real World Labs environment with independent imported
objects; it is not a flat background masquerading as a navigable room.

### 10.2 / 10.2.1 — creation, persistence and recovery

The creator records completed gifts in the same browser's collection. Cloud jobs
use private Supabase media, an owner cookie, scoped gift capabilities and expiry.
Object and world stages can finish independently, preserving a usable souvenir
when world generation fails. Reopening the collection reads saved snapshots.

The release removed application-imposed daily generation, lifetime credit and
storage quotas while retaining provider accounting and explicit creation. The
10.2.1 validation recorded 854 passing tests and production database readback.
[Creation and database evidence](V10_2-VALIDATION.md).

### 10.2.2 — recover the world without recreating the object

Repeatable Marble 1.1 errors motivated controlled provider comparisons. Full
Marble 1.0 succeeded for the affected photo worlds. An explicit creator-only
retry now preserves the original photograph, story and Tripo souvenir, checks
fresh terminal failure proof, and deduplicates requests before reserving another
world generation.

The upload adapter preserves required provider headers and supplies a MIME
fallback. That correction is not claimed as the proven cause of the provider's
500 errors. The final release validation recorded 952 passing tests, strict
server TypeScript and the production build.
[Recovery and live-control evidence](WORLD-RECOVERY-2026-10-04.md).

### 10.3.0 — the daylight memory desk

The selected Daylight atelier became the real collection room. A single full
Marble 1.0 room generation settled at 1,580 credits. Tabletop placement was
measured against its actual collider, and contact shadows use a small subset of
the original collider triangles.

Mobile keepsake derivatives reduce embedded texture payload by about 68% while
retaining byte-identical geometry and unchanged model transforms. The 500k room
is the main asset, with a 100k failure fallback. Portrait controls, safe areas,
object-bound detail zoom and guided chapters were checked in browser viewports.
[Room provenance and measurements](DAYLIGHT-MOBILE-DESK.md),
[release readiness](RELEASE-10.3-READINESS.md).

### 10.3.1 — steadier mobile exploration

A user recording revealed unstable guided headings and limitations in two-touch
movement. Route look-ahead now separates camera direction from small collision
corrections; large turns align the view before translation. A second touch can
look while the first holds the walking pad, and gestures release on focus loss
or disposal.

Regression tests and real-collider replays cover public examples and a recovered
world. The release recorded 997 passing tests, frontend/server TypeScript and
the production build. Software replay metrics do not measure a physical phone's
GPU performance. [Walking correction and evidence](RELEASE-10.3.1-WALKING.md).

### 10.3.2 — a fresh creator on reentry

Returning to **Make a gift** after a delivered gift now opens the photo wizard,
while the completed gift remains in the collection. Unfinished uploads,
generation, uncertain submissions and explicit world retries retain their
recovery flow. Completing a new job keeps its result visible until the author
opens it. The release recorded 1,005 passing tests and browser fixture checks
without a new paid generation.
[Creator reentry evidence](RELEASE-10.3.2-CREATOR-REENTRY.md).

### 10.3.3 — English throughout the product

Application-owned interface text, accessibility labels, validation, examples,
assistant drafts, sourced summaries and default spoken input use English,
including under a Portuguese browser locale. The author's reviewed words and
existing private gifts remain intact.

All 1,014 application tests and four offline-worker tests passed, alongside
frontend/server TypeScript and the production build.
[English policy and validation](RELEASE-10.3.3-ENGLISH.md).

## Walkthrough and public evidence

The [80-second English walkthrough](https://giftportals.vercel.app/media/giftportals-tripothon-english-walkthrough.mp4)
shows actual recorded public UI: the creator preview, completed Rio/Paris
examples, object orbit and zoom, collider-supported guided World Labs chapters,
the journal and the portrait layout. It uses completed examples because a new
generation can take several minutes.

The authored English narration contains 189 words. Offline Whisper word timing
aligned 49 burned caption cues to the final voice recording. Machine checks
decoded every frame and verified complete audio, exact caption wording and the
1.5-second narration offset. Burned frames received visual review; no direct
aural review was possible in the validation runtime.

The clean MP4 is 10.88 MB, H264/AAC, 1920 × 1080 at 30 fps. Its public download
was verified by full hash, MIME type and length, with HTTP 206 byte ranges and
fast-start metadata for seeking. This transport check does not claim a physical
phone playback or headset test.

## Tool evidence and remaining limits

| Area | Completed evidence | Limit |
| --- | --- | --- |
| Tripo | Real textured GLBs used in creation, collection, inspection, XR and export. | Generated souvenirs are artistic interpretations; not every model is manufacturing-ready. |
| World Labs | Real Marble worlds, 500k/100k SPZ exports, panorama fallbacks and original colliders. | Generation can fail; reconstruction quality and physical accuracy are not guaranteed. |
| TapNow / ImageGen | Completed welcome artwork and the selected daylight reference. | No unsupported provider model name or third-track eligibility is asserted. |
| Optional AI assistant | English templates, reviewed draft flow and fallback behavior are tested. | The recorded Gateway probes did not establish a successful live model response. |
| PICO / WebXR | Standard WebXR viewer software, session cleanup and interaction checks. | No physical PICO headset, comfort, real controller mapping or GPU performance was verified. |
| HeyGears / print preparation | Original GLB, scaled STL and ZIP exports with mesh diagnostics; three real source models were exported. | Blueprint import, repair, supports, slicing, resin/printer configuration and physical printing remain unverified. All three audited meshes have open or non-manifold edges. |
| Jupiter SR | Research and requirements documented. | No verified device access or integration. |

**App** is the working Direction Track, with actual **Tripo** and **World Labs**
use. Selecting a third Tool Track is separate from evidence of using that tool.
This project does not claim completed HeyGears Blueprint work or successful
printing merely because export files and a third-track selection exist.

## Run and review the source

Use Node 22+ and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm typecheck:server
pnpm test
pnpm build
```

Cached fictional examples can be reviewed without starting paid generation.
Cloud creation and private gifts require the configured Vercel/Supabase runtime;
environment values, private uploads and operator state are not included in this
repository. [Architecture](ARCHITECTURE.md), [deployment](DEPLOYMENT.md) and
[distributed third-party notices](../public/licenses/third-party-notices.txt).
