# A room for the collection

The collection now opens as a full-screen Three.js room: a walnut cabinet, framed photos, actual keepsakes, a window, books, a lamp, and a plant. Choose an object on the shelf to move closer and reveal its story. Open the gift to turn it, or step directly into its World Labs scene. Close the gift to return to the room.

Use drag, view controls, and the lamp button to explore the room and switch lighting. The gift drawer gives keyboard and touch users another way to select every item. Collections larger than six items have shelf pages; the drawer includes the entire collection.

## Routes and data

- `#/collection` opens the room. `#/gallery` also defaults to the room.
- The home screen and generated gift viewer have room entry points.
- The example room contains three completed cached Tripo / World Labs gifts: Rio, Paris, and Antikythera. These are labeled examples and never imply ownership.
- Only a completed gift from the current creator flow enters the new local in-memory collection. Opening an arbitrary gift link does not add it. Local creations last for the current page session; no browser storage or new cloud persistence was introduced.
- Authenticated collections use the existing authorized world snapshot, including gifts shared with the viewer. Archived items and expired media are omitted. Unshared location is not shown. Identity changes clear the local collection.
- `#/gallery?view=list` retains the existing private collection management, search, filters, and restore flow.
- Direct `?view=world&from=room` routes enter the world without first mounting the object viewer. A room return disposes that viewer.

## Rendering and resource behavior

The scene loads at most two media jobs at once. GLBs must be embedded and pass byte, geometry, and texture budgets. Photos remain recognizable in physical frame previews when a model cannot be loaded. Paris keeps its original photo on an upright frame; curated model orientation makes Rio and Antikythera face the room.

Rendering pauses when hidden or offscreen; reduced motion uses still camera transitions. Expiry and destruction abort work and release GPU objects, textures, bitmaps, listeners, observers, and timers. Stale imports and page callbacks cannot revive a retired room. If WebGL fails, an explicitly labeled photo shelf remains selectable.

This update starts no sponsored generation, account, sharing, claim, geographic visit, or publication operation.

## Validation

- 298 existing and new tests passed, zero failures.
- Frontend TypeScript and production build passed. The existing large scene-library bundle warning remains.
- Browser at 1280 x 720 confirmed one room canvas, three attached real GLBs, three photos, and zero model failures.
- Clicking the actual Antikythera mesh selects its story and moves closer. Native drag changes projected item positions. Escape returns to the room; lamp control changes the lighting.
- Room → world → Close → room, and room → gift → Room both passed.
- At 390 x 844, all three hotspots, the drawer, the selected gift's 44-pixel actions, and the room controls fit without horizontal overflow. The generated gift and its room return also fit. This is rendered responsive verification, not a physical phone test.
- Screenshots, DOM measurements, console checks, typecheck, tests and build evidence are in `outputs/v16/`.

Local preview: `http://127.0.0.1:4325/#/collection`.
