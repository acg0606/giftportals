# GiftPortals v3 validation

September 30, 2026. Branch `v3` begins at the preserved Aurora commit `078840312233ee14b9f9f7908ad273ec90e03cd0`.

## Implemented

The optional Geographic globe uses Cesium and selected navigation source from God's Eye View. Seven sourced public landmarks connect to the current authorized collection. Place cards retain coordinate provenance. Physical visits, memories and wishes remain independent. The Story atlas remains the default and recovery path.

The coordinate parser is copied from the pinned MIT upstream; camera bounds are adapted. Attribution, full license text and excluded third-party data are recorded in [GODS_EYE_INTEGRATION.md](GODS_EYE_INTEGRATION.md). This is a partial source integration, not the upstream OSINT console.

## Verified

- Full unit/API suite: **88/88 passed**, including 11 geographic permission tests, 8 navigation tests and an installed Cesium engine-identity regression.
- Frontend TypeScript and production build passed; strict backend TypeScript passed.
- Actual development and built-production previews rendered local Earth imagery, published pins and optional OpenStreetMap street tiles.
- Default globe reload observed 45 requests: the only three external requests were existing Google Fonts requests. No external map, geocoder or generation request was observed in that scoped sample. This does not claim the whole application is offline.
- Noah's recipient preview shows the shared bird at TUCA without marking a physical visit. Santos has no authorized sender memory; Paris remains unlocated. Multiple memories at one place retain distinct cards.
- Mobile 390px and desktop 1440px checks passed without horizontal overflow. Coordinate errors are readable; valid input only navigates. Original gift, real Tripo object and cached World Labs place remain usable.
- Blocking local Earth assets produced readable recovery and zero remaining canvases. Restoring assets and retrying produced one healthy canvas. Leaving the atlas for Home removed its canvas.
- Blocking the renderer module produced a usable Story atlas fallback. Fresh-page retry recovered after the block was removed and preserved focus/persona. Browser network/cache/viewport overrides were restored.

## Practical limits

Cesium is loaded only for the optional globe; its lazy module is about 4.03 MB before compression (1.10 MB gzip). The existing World Labs viewer is about 4.93 MB before compression. Build size warnings remain. Broad local Natural Earth imagery is coarse at city scale; optional online street tiles provide detail, subject to provider availability and terms.

Pins are published catalog anchors, not private GPS tracks or surveyed boundaries. WebGL failures retain an accessible list and the Story atlas. These checks used fictional public data, not live private cloud accounts. Cloud deployment, ACL/storage testing and hackathon submission remain pending their existing access prerequisites; no submission receipt or new provider generation is claimed.

Detailed browser screenshots, logs and review records are saved in the local `outputs/giftportals-v3` delivery folder. Previous Aurora delivery materials remain preserved separately.
