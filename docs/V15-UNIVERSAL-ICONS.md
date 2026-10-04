# Recognizable icons for gift creation

The gift now uses a wrapped box with a bow. The same symbol appears on the home actions, creator headline, review and create actions, completed gift link, keepsake tab, and the gift thumbnail inside a world. The globe identifies the world; the cube identifies opening the actual 3D object.

Photo, Place, Story, and Review each have an illustrated step marker. Camera, location, map, microphone, audio upload, stop, transcription, use, clear, and cancel controls have recognizable SVG symbols. Short English labels remain visible and supply accessible names. Decorative SVGs are hidden from screen readers. Dynamic recording and creation labels preserve their icons.

This change does not alter capture, transcription, location, generation, or recipient behavior. No sponsored generations were started.

## Validation

- Full existing test suite: 273 passed, zero failures.
- Viewer tests after the final gift tab and copy-label adjustment: 17 passed.
- Frontend TypeScript check passed.
- Final production build passed; the existing large scene-library chunk warning remains.
- Rendered creator checked at 1280 x 720 and 390 x 844: one active themed card, navigation within the viewport, and no horizontal overflow.
- Rendered gift checked at both widths: wrapped gift icons remain 18–20 pixels, and the share action retains the accessible name `Copy gift link`.
- Home, story, review, and world screenshots plus browser measurements are saved in `outputs/v15/`. Narrow-screen validation uses rendered DOM measurements.
- Fresh creator and gift tabs reported no console errors.

The local preview is available at `http://127.0.0.1:4325/#/make`.
