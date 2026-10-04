# V20 — A little transformation

Local implementation and validation: 2026-10-02. Product copy remains in English.

The creator waiting card now stages the original photo as a levitating image. Six clipped pieces separate and converge around a faceted light sculpture, with gold, lilac and cyan ribbons. The matching souvenir reference replaces the original when delivered. Once the existing viewer has loaded and rendered the real GLB, its wireframe briefly appears before the textured keepsake. The real keepsake can rotate and accepts the existing drag, zoom and keyboard controls.

## Production behavior

- Presentation phases come from provider states and delivered assets, through `giftTransformationState`. No timer, spark count or decorative effect advances a production job.
- A completed Tripo model can be previewed while World Labs is still processing. A completed gift still requires both actual outputs.
- Failed, partial, cancelled or inconsistent jobs stop the decorative animation and hide the spark interaction. A usable completed GLB remains available when another stage needs attention.
- `SUBMISSION_AMBIGUOUS` says that creation could not be confirmed. It does not assert a definitive provider failure or submit another paid request.
- The model slot stays measurable but transparent, inert and hidden from assistive technology until the viewer reports its first successful render. This prevents a cycle in which a hidden slot can never render or become ready.
- Hidden pages and offscreen scenes pause decorative motion. Reduced motion removes the decorative animation; route teardown disposes the viewer, observers, image references and timers.

## Visual rehearsal

[Open the local animation preview](http://127.0.0.1:4325/#/transformation-preview).

This route explicitly says **ANIMATION PREVIEW** and uses the existing public Rio photo, souvenir reference and generated GLB. Its timed sequence is a visual rehearsal, isolated from creator storage, provider APIs and generation polling. It creates no new gift or provider task. Stage buttons, replay and an interruption preview make each presentation state reviewable.

The creator itself uses the same scene component at `#/make`. Navigating from the rehearsal to the creator restores the host styling and destroys the rehearsal renderer.

## Validation

- Full suite: **351 passed, 0 failed, 0 skipped** (`outputs/v20/tests.log`).
- Frontend typecheck and strict API typecheck: passed.
- Production Vite build: passed. Existing large Cesium/Spark bundle warnings remain.
- Desktop browser: photo fragments changed transform while the production-style phase remained `shaping`; the delivered GLB rendered at 644×330 and changed the visible-model gate only after viewer readiness.
- Mobile browser emulation: 390×844; document and scroll widths both 390, with no horizontal overflow.
- Reduced-motion browser emulation: photo and fragment animation names were `none`; the rehearsal sequence stopped.
- Interruption: no canvas, no visible model, spark hidden and disabled, neutral interruption copy.
- Route exit: creator showed its first card, with no rehearsal class or leftover canvas.
- Browser console inspection returned no errors or warnings for the rehearsal before responsive checks.

The existing user creation had an unconfirmed Tripo acknowledgement and a processing World Labs stage in the read-only snapshot at the start of this work. The UI change does not resolve that provider acknowledgement. No paid generation retry was initiated. Restored ambiguous-job behavior is covered through the actual creator handlers with an isolated presentation fixture; reading the pre-existing browser tab timed out, so that tab is not claimed as live visual proof.

## Captures

![Photo fragments and light around the souvenir reference](../outputs/v20/transformation-shaping.png)

![Actual generated Rio keepsake while the world is represented as processing in the rehearsal](../outputs/v20/transformation-3d-world.png)

![Transformation preview on a 390-pixel mobile viewport](../outputs/v20/transformation-mobile.png)

![Interrupted rehearsal pauses the transformation and removes the spark control](../outputs/v20/transformation-interruption.png)

These are local preview captures. They are not evidence of a new provider generation, public deployment or hackathon submission.
