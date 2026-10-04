# V21 — Arrive, explore, and read

Local implementation: 2026-10-02. Interface and documentation are in English.

The generated gift tour now arrives from a distant viewpoint, flies through its attached World Labs scene, and stops at a different camera position for each story. Reading happens on an object that belongs to the setting: a travel journal, a newspaper, or a tablet. During the flight, the reading object stays closed so the scene remains visible.

## Camera journey

The viewer translates the perspective camera through the actual cached SPZ in three dimensions. Position, direction, and field of view change along a smooth authored route, giving nearby and distant elements different apparent motion. The route has three stages:

1. **Arrival:** approach the first story viewpoint from an elevated position.
2. **Travel:** move between distinct viewpoints, including differences in height and lateral position.
3. **Reading:** hold the camera still while the relevant story opens. Automatic dwell is based on the chapter's text length and bounded to 12–35 seconds. **Pause** lets the reader stay longer.

Selecting a numbered light or story chapter stops the guided tour and flies to that chapter's viewpoint. Its reading object opens after the current flight reports arrival. Dragging, movement controls, reset, a hidden tab, or an offscreen scene can cancel a manual flight. A cancelled or obsolete arrival cannot later reopen the story.

The cached examples have authored profiles:

| Example | Flight profile | Reading object |
| --- | --- | --- |
| Rio | Coastal approach and elevated views | Illuminated field-notes tablet |
| Paris | Riverside approach and changing lateral views | Folded **The Gift Gazette** newspaper |
| Antikythera | Terrace approach, overhead and side views | Open travel journal with a compass ornament |

Other completed gifts receive a bounded general route and a journal. These routes reuse the delivered world; the tour does not create additional environments or submit provider generation requests.

## Reading and context

The journal has a cover, page edges, spine shadow and a two-page layout. The newspaper has an editorial masthead, fold, rules and paper edges. The tablet has a bezel, camera detail and a recessed illuminated screen. Each object includes the selected chapter, position in the story, and a close action. Manual readers also offer previous and next chapters. Long text scrolls inside the page; navigation stays accessible.

Personal stories keep the sender's words. Reviewed discoveries remain explicitly labelled **Historical context** and retain links to their primary sources. The gift controller resolves approved curiosity IDs to reviewed content and validates source domains. The reader additionally rejects insecure, executable, credentialed and malformed URLs. Story titles, bodies and source labels are set as literal text rather than inserted as HTML.

The cached example people and travels remain fictional. Decorative compass artwork adds no historical or geographic claim.

## Controls and accessibility

- **Guided tour**, **Pause**, **Resume**, **Next viewpoint**, **Exit tour**, and **Replay tour** control the journey.
- Numbered lights and chapter choices select individual viewpoints. **Stories** opens the selected chapter directly, stopping movement.
- Numbered lights keep a responsive 32–72 px gap between their hit areas. The layout separates nearby lights while retaining an 8 px clearance from the dock and reading objects; camera destinations remain attached to their original scene points.
- Drag the scene to look around. The existing look, move, reset and keyboard controls pause automatic travel. Walking remains available only when a usable collision asset supplies ground navigation.
- With reduced motion, the camera changes directly to distinct still viewpoints. No animated approach or automatic chapter progression occurs; **Next viewpoint** advances explicitly. Page-entry animation is also removed.
- Reading controls have accessible names; the chapter text is keyboard focusable and scrollable. Escape inside the reader closes that reading object.
- Hidden tabs and offscreen views pause work. Exiting or switching views disposes the renderer, readers, listeners, downloads and visibility observers. Stale callbacks cannot revive a retired gift view.

## Test the local experience

Start the existing local preview with `./tools/start-instant-preview.ps1 -UseProtectedVault`, or use its already-running loopback server. These links open completed cached worlds without starting a new gift:

- [Rio world](http://127.0.0.1:4325/#/generated/rio-example?view=world)
- [Paris world](http://127.0.0.1:4325/#/generated/paris-example?view=world)
- [Antikythera world](http://127.0.0.1:4325/#/generated/antikythera-example?view=world)

Wait for the actual world to open, then choose **Guided tour**. Observe the approach with the reader closed, the settled first viewpoint, and the reading object. Choose **Next viewpoint** to compare depth and viewpoint changes. Select a numbered light independently, then interrupt its flight by dragging. Repeat with reduced motion and a narrow mobile viewport; check text scrolling, controls and view teardown.

Focused automated checks:

```sh
node --test tests/generated-gift.test.mjs tests/story-reader.test.mjs
node --test tests/generated-world.test.mjs tests/world-flight.test.mjs
```

## Validation

- Marker spacing refinement: **26 marker-layout and gift-controller tests passed**, with frontend TypeScript passing. In the rendered 750×570 Antikythera preview, all four lights remained visible and their minimum center distance increased from approximately 83 to 100 px (`outputs/v21/markers-spaced.png`).
- Full suite: **369 passed, 0 failed, 0 skipped** (`outputs/v21-tests.log`). It includes the actual gift controller and physical reader, flight interpolation, slow-GPU timing, cancellation, reduced motion, approved sources, fallback paths and renderer cleanup.
- After the final visual route and layout adjustments, all **24 camera/flight tests** and **28 gift/reader tests** passed again (`outputs/v21-final-camera-tests.log`, `outputs/v21-final-reader-tests.log`).
- Frontend TypeScript, strict API TypeScript and production Vite build: passed. Existing large Cesium/Spark bundle warnings remain (`outputs/v21-build.log`).
- Rendered browser: actual cached 500,000-point SPZ worlds opened for Rio, Paris and Antikythera. The approach and individual chapter flights changed the rendered viewpoint; manual reading opened only after arrival. Paris showed the newspaper with its reviewed historical source, Rio the tablet, and Antikythera the journal.
- The final Antikythera guided tour also reached `At the viewpoint · 1 / 4` and opened its journal automatically after arrival. Its path was tightened around the source view to limit exposed tree and shoreline artifacts. Some sparse sky and seaside surfaces remain visible during the approach.
- Mobile emulation at 390×844: scene and document widths were 390; the reader's right edge was 376 and toolbar's right edge 378. Reading controls remained reachable. The initial footer minimum-width issue found in browser QA was corrected.
- A 750×570 browser window exposed a clipped journal control row. The object/page grid and wrapper height were corrected: controls ended at y=361.35 and the journal at y=384.52, within the scene's y=400 boundary; overflowing chapter text scrolls inside the page (`outputs/v21/short-window-book.png`).
- Reduced motion: the tour held at still chapter 1, **Next viewpoint** explicitly changed to chapter 2, and page animation was `none`. No automatic chapter progression was enabled.
- Console inspection found no application errors. The existing Spark/Three integration emitted a `THREE.Clock` deprecation warning.
- Real collider audit sampled the authored arrival splines at 101 positions each and tested triangle crossings between samples. Revised Rio, Paris and Antikythera arrivals had zero crossings, with minimum clearances 1.2458, .6783 and 1.3544 artistic scene units. These measurements describe geometry clearance and do not certify visual reconstruction quality.
  The measurements, assets and method are recorded in `outputs/v21/collider-audit.json`.

## Captures

![Rio's arrival through the actual cached world](../outputs/v21/rio-arrival.png)

![A tablet holding the personal Rio story](../outputs/v21/rio-tablet.png)

![Paris historical context on a folded newspaper](../outputs/v21/paris-newspaper.png)

![Antikythera's personal chapter at the lower central viewpoint](../outputs/v21/antikythera-book-view2.png)

![Responsive newspaper reader](../outputs/v21/mobile-newspaper.png)

## Scope and rendering limits

Camera positions use authored artistic scene units. They are not GPS coordinates, surveyed distances or a real-world tourism route. Flying does not prove collision-safe walking, a factual reconstruction or a physical visit.

Moving far beyond a generated SPZ's well-covered region can expose thin splats, holes or incomplete surfaces. The authored route is bounded, but the source world's missing geometry remains a rendering limitation. This increment adds camera movement and reading presentation; it does not claim to reconstruct unseen geometry.

The tour reuses existing completed Tripo/World Labs assets. It adds no paid provider requests, new generated assets, deployment or hackathon submission. Loopback links are local preview links while the server is running.
