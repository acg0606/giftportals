# V8 Rio creator: executed local validation

Verified October 1, 2026, in the existing GiftPortals checkout. This increment implements anonymous local composition inspired by the editing sequence in the user-provided Partiful recording, while preserving the approved Rio visual identity.

## Results

| Check | Observed result |
| --- | --- |
| Frontend TypeScript | Passed, exit 0 |
| Server TypeScript | Passed, exit 0 |
| Application and API tests | 135 passed; 0 failed, skipped, or cancelled |
| Final Vite production build | Passed, exit 0; 27.54 seconds |
| Compiled preview HTTP | 200 at `http://127.0.0.1:4324/`; Referrer-Policy `strict-origin` |
| Desktop and mobile browser | Executed at 1280 × 720 and 390 × 844 |
| Production browser console | No warning or error entries |

The existing geographic-globe and environment chunks still produce Vite's large-chunk advisory. Those optional modules were not reworked in this increment. Passing these checks establishes local behavior, not deployed cloud readiness.

Actual commands used the bundled Node runtime at `C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`:

```text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types node api/giftportals.ts api/tick.ts
node --test --test-concurrency=2 tests/*.test.mjs api/tests/*.test.mjs
node node_modules/vite/bin/vite.js build
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4324 --strictPort
```

## Browser journeys actually exercised

1. **Start without an account.** Home's Make a Rio gift reaches the composer. Enter a title and choose Sunset or Ocean. The visible postcard updates immediately. Clearing the required title blocks progression and focuses that field.
2. **Write and revise.** Set recipient, sender, dedication and story. Move between Gift, Story and Preview without losing edits. Step changes now scroll the heading into view. The desktop preview stays beside the editor; mobile uses a compact preview above the editor, with the primary action fixed below.
3. **Enter the personalized portal.** The panorama shows the custom title, story and sender, with the selected message theme. Look around, direction and reset controls work. Escape returns focus to Preview portal, leaves zero canvases or open dialogs, and restores background scrolling. Keep this memory returns to review; it does not save automatically.
4. **Explicitly save and resume.** Save in this browser shows a local confirmation. Reload starts the editor with its new-draft defaults; Resume saved draft restores the explicitly saved title, message, recipient and theme. Navigating home and returning preserves the in-memory draft during the current app session.
5. **Copy and receive the local link.** Copy reports success and exposes the same-device preview URL. A separate development tab and the compiled production route both read that link, show the custom invitation, enter the same personal story, and return its draft to the editor through Keep this memory.
6. **Resume across tabs.** Tab A saved and copied version A. Tab B saved version B. Resuming and saving in A correctly showed B, with the old link hidden and empty until a fresh copy. This regression was caught by independent code review and verified after the fix.
7. **Recovery and limits.** An unreadable draft token shows the unavailable-world page without a thrown application error. Tested a maximum-length unbroken title (80 characters), dedication (280) and story (900) on mobile. The message wraps and scrolls within a 559-pixel panel beginning at y=100; the exit and panorama controls remain outside it. Keep remains reachable. Mobile document width stayed inside the viewport: 375 content pixels with a document scrollbar, or 390 pixels in the full-screen dialog.

The state module's nine new tests exercise Unicode/reserved-character round trips, malformed and oversized tokens, hostile input structures, corruption, denied storage, and explicit-only persistence. Seven souvenir-controller tests cover lifecycle, delayed viewer imports, fallback, personalized inert text, Keep callbacks and disposal. Actual image/WebGL appearance is established by browser captures, not those fixture tests.

## Evidence and visual review

Logs and original captures are in `C:/Users/admin/OneDrive/Documentos/Agent Hackas/outputs/giftportals-v8-creator/`:

- `typecheck.log`, `typecheck-server.log`, `tests.log`, `build.log`.
- `09-production-desktop-story.jpg`: the editable story and sticky personalized preview.
- `10-production-mobile-portal.jpg`: the custom story inside the compiled Rio portal.
- `11-production-mobile-editor.jpg`: compact preview and fixed next action.
- `12-production-desktop-editor.jpg`: full-document capture of the compiled editor.
- `05-mobile-story.jpg`, `06-mobile-saved.jpg`, `08-mobile-long-message.jpg`: editing, local confirmation and boundary behavior.

These selected files were opened and inspected. [The comparison board](references/v8-creator-comparison.jpg) combines the supplied Partiful theme frame, approved Rio concept and actual final desktop/mobile captures. It was inspected after creation. [Design QA](../design-qa.md) records the deliberate visual differences and resolved findings. [The journey map](V8_CREATOR_JOURNEY.md) documents the actual sequence.

## External limits

The account/private-Studio continuation is conditional on the existing configured service. Its text-seed handoff and password-length requirements were reviewed in code; no account was created and no authenticated cloud journey was exercised in this run. It still requires an original photo, a supported place and media-rights review before private creation. SMS/WhatsApp OTP was not added.

There is one saved browser draft. It is readable by other users of that browser profile. Its local preview link carries the text in its fragment and works on the same device while the preview is running; it is not a public, revocable invitation. No upload, provider generation, purchase, QR binding, external message, deployment, commit, push or submission was performed. English UI and documentation are preserved.
