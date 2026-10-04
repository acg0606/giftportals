# V24 first-person walking — executed local validation

Validated on 2026-10-03. Open `http://127.0.0.1:4325/#/paris-walk` while the local preview is running. This is a tested local increment, not a cloud deployment, submission receipt or claim of parity with the three user-selected demos.

## Result and controls

The tower gardens now support a human-height walk through the actual cached World Labs SPZ. Hold WASD, arrow keys or the illustrated direction pad; drag the scene to turn; hold Shift to walk faster. **Stroll** walks a short grounded path and stops automatically. **Journal** opens a book and pauses walking; returning closes the book and resumes manual exploration. Pause, reset and the gift return link are explicit controls.

Held inputs advance each rendered frame using elapsed time, acceleration and damping. A Rapier kinematic capsule slides and snaps against the actual World Labs triangle collider. There is no invented plane or uncollided camera animation. Splats and collider receive the same provider metric scale `2.9049978`, ground offset `1.6893421` and axis conversion; eye height is `1.65` in those calibrated units. Provider metric semantics are not geographical survey accuracy. First-person mode has no 20-fps animation cap; reduced motion removes head sway while preserving requested locomotion. Hidden/offscreen/blurred viewers clear motion inputs, and exit disposes the physics world and rendering resources.

The Paris gift's **Walk through Paris** action leads here. The former V23 cinematic journey remains available at `#/paris-flight`. The reviewed waterfront variant was excluded from this new walking selector after a poor visual review; collider validity alone is not visual acceptance.

## Executed checks

| Check | Observed result | Evidence |
| --- | --- | --- |
| Full frontend/API regression suite | 491 passed, zero failures/skips; concurrency 2 | `outputs/v24/test-suite.txt` |
| Final sky palette/background lifecycle revision | 34 viewer tests passed after the palette adjustment | `tests/generated-world.test.mjs`; full suite above includes these 34 tests |
| TypeScript and production build | Passed; first-person physics is a separate lazy chunk. Existing large-chunk warning remains. | `outputs/v24/build.txt` |
| Actual browser walk | `0 → 10.244` calibrated meters of travel, grounded true; real camera translated from `[0,1.3478,0]` to `[-0.0006,1.3298,-10.2444]` | `outputs/v24/walk-recording.json`, `browser-validation.json` |
| Rendering sample | 34.5 fps reported by the actual render loop during final capture; a sample at 750×572, not a device-wide guarantee | `outputs/v24/walk-recording.json` |
| Native direction pad and keyboard | A held pad interaction walked 1.097 m while grounded; a native W press advanced the camera | `outputs/v24/browser-validation.json` |
| Pause | Distance stopped changing; final pose remained stable after the next-render telemetry update | `outputs/v24/browser-validation.json` |
| Mouse look | This browser did not acquire pointer lock; the visible drag-look fallback worked. Successful lock/release is covered by the synthetic lifecycle fixture, not claimed as a real browser result | `outputs/v24/browser-validation.json`, viewer tests |
| Responsive layout | 390×844, no horizontal overflow; visible movement/action buttons are 44×44; journal opened and returned to walking | `outputs/v24/walk-mobile-layout.png`, `walk-mobile-journal.png` |
| Media | Actual 165 CDP JPEG frames encoded with their timestamps into a silent 13.711-second MP4; entire output decoded successfully | `outputs/v24/paris-walk-demo.mp4`, `paris-walk-demo-receipt.json` |

The recording has roughly 12 captured frames per second; capture frequency differs from render frequency. It contains no generated/interpolated motion and retains genuine capture gaps. ffprobe was unavailable; the encoder read the MP4's sample tables and performed a complete FFmpeg decode. The earlier panorama-backed capture and original frames remain available under the `with-panorama` output names and `frame-0000.jpg` sequence; its receipt preserves the historical output paths.

The 11 motion tests check time-step independence, diagonal normalization, bounded stalls, stops, reduced motion and collision correction. The nine actual Rapier tests include real asset traversal and the composed motion/controller path at 30/40/60 Hz. That composed check caught and corrected a real bug: tiny collider contact corrections were rejected by the motion guard, so individual modules passed while the rendered character barely moved. Horizontal correction tolerance is opt-in, capped at 2.5 cm and configured at 2 cm for this controller; the default guard stays strict.

## Background comparison and remaining scene limitations

The reviewed browser screenshot `outputs/v24/walk-after-turn.png` shows the main Eiffel-like landmark on the left and another partial tower-like structure on the right. That duplication is visible after actual walking and turning; the successful grounded controller does not establish that the rendered environment is visually coherent. Nearby paving, plants, and railings provide positional parallax, while distant architecture and tree detail remain soft. The landmark and surroundings are generated artistic interpretations, not a surveyed reconstruction of Paris.

The cached V23 approach panorama contains one central tower. The earlier first-person viewer rendered the complete landmark-bearing panorama as `scene.background` in addition to the SPZ. A controlled browser comparison now confirms that removing that background removes the extra tower. Before/after use the same orientation, viewport and spawn, with at most 0.1 mm of ground-contact numerical difference in the final palette review: camera near `[0,1.3478,0]`, target near `[1.5678,1.8849,-2.5007]`, viewport 750×572. The screenshots and pose records are `outputs/v24/background-ab-before.png/json` and `background-ab-after.png/json`. This establishes a background duplication problem in our viewer, not a duplicated tower in the provider's geometry.

First-person mode now uses a small original sky-only procedural gradient and skips panorama fetch/decode. It preserves translation, collision and free look. Gaps and irregular coverage of the generated sky remain visible; sky colors reduce the contrast but do not reconstruct missing geometry. The existing 20-meter local walking boundary protects traversal within the finite collider; it is not evidence that the scenery is geographically continuous. V22 has a visually rich waterfront panorama but its collider tests alone do not justify restoring it as a reviewed visual alternative.

This scene review used only cached assets and screenshots. It made no provider requests and does not establish parity with the user's three reference demos.

## Scope and provenance

No new Tripo or World Labs jobs were created, no new balance was queried, and this increment does not claim additional credit consumption. It improves control, calibration and compositing of previously generated sponsor assets. Animated characters, spatial audio, rigid-body props and a fully continuous multi-location world are not implemented in this increment. The three references inform the architecture; no application source or demo media was copied. See [pinned reference and license review](V24-FIRST-PERSON-REFERENCES.md) and [credits](CREDITS.md).
