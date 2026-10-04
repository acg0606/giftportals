# GiftPortals V7 — executed Rio souvenir validation

Verified September 30, 2026 on `v7-rio-souvenir`. The preserved V6 baseline is `f394a08be57711024a7c918217974ffdf516b4f8` on `v6-memory-portal`.

## Delivered local experience

Home now presents a Rio souvenir and **Open your Rio gift**. The invitation at `#/trail?experience=rio` shows the miniature and **Enter Rio**. Enter opens a full-screen artistic waterfront, a personal message, explicit **Look around / Show message**, direction controls, **Reset view**, and **Back to gift**. Escape returns focus to Enter Rio. The original Studio, library and atlas remain reachable; the Rio ivory/teal theme is cleared on the original Studio route and restored on Home.

The souvenir is a generated raster illustration. The Rio scene is a generated 1774 × 887 image displayed on a bounded 120-degree cylinder window. Initial framing retains Sugarloaf Mountain and the image's left/right orientation. Drag, arrow keys and direction buttons provide bounded viewing; Reset restores the opening view. Rendering is lazy and on demand, with one canvas and disposal on exit. This is an artistic image encounter, not a reconstructed city, a complete 360-degree capture or a new Tripo/World Labs Rio generation.

## Executed checks

- Final full suite: **125 passed, 0 failed, cancelled or skipped**. Six new controller regressions cover delayed imports, Back/Escape, message controls, Retry and stale callbacks, synchronous viewer failure, route disposal and restoration of previous overflow styles. These fixture tests do not establish browser/GPU quality.
- Final frontend TypeScript and Vite production build: **PASS**, approximately 17 seconds. Existing large globe/environment bundle warnings remain.
- Actual desktop and mobile: product → Enter Rio → artistic scene → message → Look around → Reset/direction controls → Back/Escape. The final view used one canvas without horizontal document overflow.
- Controlled image failure retained the souvenir/message and explicit Retry. Failed poster/thumbnail images were hidden. After unblocking and Retry, all three dialog images loaded, one ready canvas was present and focus moved to the world heading.
- Escape restored focus to Enter Rio and restored the document/body overflow settings.
- The local production bundle on port 4324 passed gift → scene → controls → Home → original dark Studio → Home primary CTA → Rio. Captured production console error/warning logs were empty.

## Evidence

The review evidence is saved in `C:/Users/admin/Documents/Codex/2026-09-30/com/outputs/giftportals-v7-rio`:

- `tests-final.log`, `build-final.log`.
- `11-mobile-failure-final.jpg`, `12-mobile-world-final.jpg`, `13-mobile-look-final.jpg`.
- `14-desktop-gift-final.jpg`, `15-desktop-world-final.jpg`, `16-desktop-look-final.jpg`.
- `17-home-final.jpg`, `18-studio-preserved.jpg`.

Local production review URL: `http://127.0.0.1:4324/#/trail?experience=rio`. Development preview: port 4323. These are local processes, not public hosting receipts.

## Limits

The purchase, giver and message are fictional backstory. V7 does not implement checkout, QR/NFC scanning, automatic location detection, physical visit recording, sharing or persistent collections. Opening it makes no provider generation request and spends no provider credits. The older real Tripo and World Labs demo remains separate and identified in the original Studio.

These checks do not establish performance on every device or formal accessibility conformance. Private cloud completion, public deployment, a recorded V7 walkthrough and final hackathon submission remain separate pending outcomes. Local source, tests, screenshots and production preview are not receipts for them.

## October 1 recheck

- Fresh full suite: **125 passed, 0 failed**; evidence: `tests-recheck-2026-10-01.log` in the same review directory.
- Fresh frontend TypeScript and Vite production build: **PASS**, exit 0, 35.15 seconds; evidence: `build-recheck-2026-10-01.log`. Existing large lazy globe/environment bundle warnings remain.
- The freshly compiled local production preview passed invitation → Enter Rio → Look around → direction control → Reset → Escape. Escape restored Enter Rio focus, left zero canvases and restored document/body overflow.
- About copy was corrected and verified in English. It now distinguishes the bounded artistic Rio image from the original Studio's actual provider outputs; session-only demo keepsakes from permanent collections; and the unavailable private creation/upload/invitation flows from the cloud system that still requires hosted two-account verification. Its action opens the Rio gift.
- Recheck captures: `20-about-recheck-2026-10-01.jpg`, `21-world-recheck-2026-10-01.jpg` in the same evidence directory.

Public HTTPS deployment/readback remains unexecuted. This recheck performed no external write and does not establish a recorded V7 walkthrough or final hackathon submission.
