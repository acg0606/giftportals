# God's Eye View source provenance

GiftPortals includes a small, explicitly attributed part of [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view), copyright © 2026 Bilawal Sidhu, licensed under MIT. The inspected and copied revision is [`e7707d9a0f34d9fbffc300023c319f95caa5be30`](https://github.com/bilawalsidhu/gods-eye-view/commit/e7707d9a0f34d9fbffc300023c319f95caa5be30), committed September 29, 2026 at 00:33:34 UTC.

| Local file | Upstream source | Changes |
| --- | --- | --- |
| `coordinateParser.js` | `src/search/coordinateParser.js` | None; byte-for-byte copy, independently SHA-256 verified. |
| `LICENSE` | `LICENSE` | None; full upstream license and data exclusions, independently SHA-256 verified. |
| `coordinateParser.d.ts` | Local declaration | TypeScript declarations for the copied parser; no upstream runtime modification. |
| `../../globe-navigation.ts` | `src/search/coordinateGeocoder.js` function `boundedBox` | Exports camera bounds, validates coordinates and span, returns Cesium-compatible west/south/east/north fields, and removes the geocoder/provider wrapper. |

Verified SHA-256:

- `coordinateParser.js`: `e666a7b905d8f4dd89985f4da1ccacbb70eb4f79f68f2f52a685de55553b8457`
- `LICENSE`: `b231bb38e2d4eab741643126087cbe9df2b58e2f2e5abf27ad613d05f52b01ca`

The real geographic coordinate form imports the copied parser and uses the adapted frame helper to move the camera. This is actual source reuse, not a claim that the complete upstream application or its integrations are present.

No upstream OSINT layers, server providers, voice services, credentials, city datasets, models, submarine cables, CCTV, aircraft/ship tracking or restricted event imagery are included. MIT applies to upstream code, not to its third-party data or assets. GiftPortals' CesiumJS dependency, Natural Earth context imagery, optional OSM street tiles, sourced POI catalog and generated assets retain their own licensing and attribution.

Keep `LICENSE` with any redistribution of this code and identify modifications. See [`docs/GODS_EYE_INTEGRATION.md`](../../../docs/GODS_EYE_INTEGRATION.md) for scope, deployment and validation boundaries.
