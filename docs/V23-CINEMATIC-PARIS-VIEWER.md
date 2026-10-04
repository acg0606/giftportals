# A cinematic Paris journey

The V23 journey opens at `#/paris-flight`. Three separately generated, completed World Labs worlds form an artistic itinerary: arrival beside the Eiffel Tower, a view from its high observation gallery, and a return to the Seine. The same art direction joins them; they do not share a measured physical map or guarantee matching geometry. A luminous lift is the explicit chapter transition.

The comparison's World tab and the Paris gift expose the journey only after all three exported chapter records and their real SPZ files are available. Unavailable files, HTML fallbacks and private capability URLs cannot become substitute scenes. The viewer itself performs read-only GET and HEAD requests and never starts a generation.

Each world has a fourteen-second XYZ arrival, a six-second scenic stop, an 8.5-second spatial move, and a second six-second stop. The camera continues a small bounded drift at scenic stops. Dragging, flight controls or WASD movement pauses the guided camera. Q and E descend and rise. The reader opens only on request: newspaper at arrival, tablet above the city, and a book beside the river. Story readers freeze the camera so reading remains comfortable.

Only one WebGL context is active. Changing a chapter disposes the old scene, aborts its asset download, and invalidates stale decoder and transition callbacks. The next chapter receives a HEAD metadata request, rather than initializing a second renderer or loading an unbounded background panorama. Visibility changes pause the journey. Reduced motion selects static viewpoints and disables autonomous transitions and luminous pulses.

Balanced mode uses the completed 500k SPZ on desktop. Phones also keep the 500k architecture when its verified byte length is at most 10 MiB; larger or unmeasured regular assets use the completed 100k SPZ when available. Detailed is opt-in on desktop only when the actual exported full-resolution asset, byte length and integer point count have been verified. Spark receives that exact count up to 2.5 million splats. Detailed's byte ceiling is 50 MiB; all existing viewers retain their 25 MiB default.

The new journey optionally uses the **same completed world's** equirectangular panorama as distant environment backing behind the real splats. It never renders without a decoded SPZ and does not substitute for a failed world. The bitmap is bounded to 6144 by 3072 pixels and disposed on exit. Visual QA must check `panoramaYaw` alignment against the actual scene before declaring it coherent. Old gifts keep their existing renderer defaults.

## Reviewed camera configuration

The exported `public/demo/v23/paris-flight.json` may include `route.arrival` poses and `route.viewpoints` with unique `pointId` values. Positions and targets use the renderer's artistic Y-up scene units; the SPZ and collider both rotate by pi around X. They are not GPS coordinates or metres. Pose bounds, finite values, look direction and FOV are checked before use. A conservative local corridor is used until the owning operator has inspected the actual generated world and supplied a reviewed route.

The viewer writes its real camera position and target, throttled to twice a second during automatic flight, to `[data-pf-world]` DOM data attributes for local QA. A manual command forces one report on the next rendered frame, so a paused scene cannot leave stale coordinates. The Paris manual flight step is 0.32 artistic units, bounded by its exploration radius; existing gifts and grounded walking retain their 0.12 step. These coordinates are not exposed as product controls or claimed as geographic measurements.

## Validation

Run `node --test tests/paris-flight.test.mjs tests/world-flight.test.mjs tests/generated-world.test.mjs tests/viewer-runtime.test.mjs tests/quality-comparison.test.mjs`, `node node_modules/typescript/bin/tsc --noEmit`, then `npm run build` using the bundled Node runtime if Node is absent from PATH.

The tests execute actual Three camera math and stream/lifecycle validation with synthetic GPU and network fixtures. They validate translation, scenic drift, pause and reduced-motion behavior, point-count handling, hard byte ceilings and stale callback suppression. They do not prove visual quality, collider clearance, panorama alignment or GPU performance. Those require the completed assets in the actual browser, with the final reviewed camera routes.
