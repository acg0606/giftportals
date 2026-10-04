# Optional real keepsake WebXR

Four new staged files provide a separate opt-in headset mode for the authorized existing GLB. They make no provider calls and require no new packages or PICO account/SDK.

## Parent integration

Lazy-load `mountKeepsakeXR` only after the user chooses the headset panel. Mount its panel inside the current gift modal:

```ts
const { mountKeepsakeXR } = await import('./keepsake-xr');
const xr = mountKeepsakeXR(panelHost, {
  modelUrl: authorizedCurrentModelUrl,
  title: currentGift.title,
  modelYaw: currentGift.modelYaw,
  isCurrent: () => currentGiftEpoch === epoch && giftModal.open,
  onSessionStarting: () => ordinaryGiftViewer?.destroy(),
  onExit: () => { if (currentGiftEpoch === epoch && giftModal.open) remountOrdinaryGiftViewer(); },
});
// On gift change, panel close or modal destruction:
xr.destroy();
```

Keep the ordinary viewer until `onSessionStarting`: this fires only after the browser accepts the explicit Enter headset button's `requestSession`, before XR renderer creation. No permission request occurs on import or mount. `onExit` fires once after an accepted session ends or fails, including destroy; the parent should guard its remount with the current gift epoch/modal state. A rejected/cancelled request before acceptance does not switch viewers or fire `onExit`.

## Behavior and limits

- Requires a secure context and `navigator.xr.isSessionSupported('immersive-vr')`; unsupported browsers allocate no WebGL context, import no Three runtime, fetch no GLB and leave the ordinary gift available.
- Uses standard immersive VR, with optional local-floor reference space and a local-space fallback. No AR/passthrough or PICO hardware-specific capability is asserted.
- Reuses `viewerAssetUrl`, `fetchViewerBytes` (25 MiB, omitted credentials, no redirects, no referrer), the existing `validateCollectionGLB` validator and a 45-second loading deadline. Only embedded resources are decoded; no external textures or geometry URLs are permitted.
- Shows the actual GLB at a 0.42 m longest side on a small plinth, 1.25 m ahead. Geometry and original node transforms remain unchanged. The controller ray must hit the actual gift before a trigger rotates it by 15 degrees. No locomotion, simulated hand grasp, generation or download action is added.
- Session end, explicit exit, page exit, stale gift epochs and late async completions clean up the loop, geometries, materials, textures, image bitmaps and WebGL context. A hidden XR session skips rendering until visible. Browser permission requests can be cancelled locally; a subsequently granted stale session is ended without rendering.

## Validation

Eleven focused tests pass, using the real Three GLTFLoader with a binary GLB and mocked browser/XR/session/renderer interfaces. Coverage includes unsupported and insecure browsers, no automatic permissions or second GPU, acceptance order, actual GLB display, ray hit/miss rotation, declined permissions, cancellation, stale sessions/runtimes/models, floor fallback, 45-second timeout, native session end, hidden rendering, malformed/over-budget GLBs, original geometry preservation and one-time cleanup. Strict browser TypeScript passes.

No physical headset is available in this environment. PICO Browser/device rendering, controller mapping, reference-space behavior, comfort and frame rate remain a device-validation step. Tests do not certify hardware compatibility. The UI states that PICO device validation is pending.

Official PICO platform resources: [WebXR developer resources](https://github.com/Pico-Developer/awesome-webxr-development), [PICO Web documentation](https://developer-cn.picoxr.com/en/document/web/). The developer resources repository was verified during implementation; the documentation page timed out during this check. This implementation uses its documented standard WebXR/Three building blocks and checks browser support at runtime.

Run the focused tests and strict check from the installed app with `node --test tests/keepsake-xr.test.mjs` and `node tests/keepsake-xr-typecheck.mjs`. The staging helpers fall back to canonical dependencies only when installed dependencies or copied shared sources are absent.
