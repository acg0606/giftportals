# God's Eye View integration in GiftPortals v3

## Purpose and actual reuse

The geographic atlas adds a real navigable earth surface and sourced place markers while retaining the Story atlas hierarchy. It helps a recipient understand where a gifted memory belongs. Camera exploration does not create a memory, mark a physical visit or color territory.

GiftPortals incorporates selected source from [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view), copyright © 2026 Bilawal Sidhu, MIT, pinned to [`e7707d9a0f34d9fbffc300023c319f95caa5be30`](https://github.com/bilawalsidhu/gods-eye-view/commit/e7707d9a0f34d9fbffc300023c319f95caa5be30). The commit is dated September 29, 2026 at 00:33:34 UTC.

Actual included source:

- `src/vendor/gods-eye/coordinateParser.js`: unmodified upstream `src/search/coordinateParser.js`. The geographic coordinate input imports this parser for decimal degrees, hemisphere order, strict syntax and range validation.
- `src/globe-navigation.ts`: camera framing adapted from upstream `src/search/coordinateGeocoder.js`'s bounded-box function. The adaptation adds exported validation, accepts a bounded span, returns west/south/east/north and omits the geocoder wrapper.
- `src/vendor/gods-eye/LICENSE`: complete, unmodified upstream MIT license and third-party data exclusions. [The vendor provenance record](../src/vendor/gods-eye/README.md) lists file hashes and modifications.

The renderer, privacy projection and GiftPortals product flow are local integration code. This is a partial source integration; the complete Gods Eye application, OSINT console, server and data services are not embedded.

## Independent licenses and excluded data

MIT permits source copying and adaptation with its copyright and permission notice. It does not cover the upstream project's bundled data, live feeds or models. [The pinned upstream license](https://github.com/bilawalsidhu/gods-eye-view/blob/e7707d9a0f34d9fbffc300023c319f95caa5be30/LICENSE) and [data inventory](https://github.com/bilawalsidhu/gods-eye-view/blob/e7707d9a0f34d9fbffc300023c319f95caa5be30/DATA_SOURCES.md) explicitly separate them.

GiftPortals does not import TeleGeography CC BY-NC-SA data, Bhote Koshi CC BY-NC imagery/coordinates, OSM infrastructure extracts, CCTV, aircraft/ships, voice providers, foreign city presets, models or credential storage. Its existing Tripo and World Labs asset provenance remains separate; no new generation is needed for the globe.

CesiumJS is pinned to **1.138.0**, matching the inspected upstream lockfile's actual Cesium version. Workspace overrides additionally pin **@cesium/engine 22.3.0** and **@cesium/widgets 14.3.0**, also matching upstream's resolved versions. They prevent transitive version drift and ensure widgets and the application share the same Cesium engine class identities. Commit the lockfile and use a frozen-lockfile install; the top-level Cesium version alone does not freeze those dependency ranges.

Cesium's [Apache-2.0 license and third-party notices](https://github.com/CesiumGS/cesium/blob/1.138/LICENSE.md) are independent of Gods Eye's MIT notice. Cesium's manifest requires Node `>=20.19.0`; the validation runtime is Node 24.19.0. The initial 1.124.0 attempt encountered the upstream-documented [zip.js exported-path break](https://github.com/CesiumGS/cesium/issues/12883). A subsequent real browser failure exposed mismatched engine versions under an unpinned widgets dependency. The final dependency selection uses upstream's resolved Cesium/engine/widgets versions rather than an older zip override.

The default imagery is the **local NaturalEarthII** tile set supplied with Cesium. [Natural Earth's terms](https://www.naturalearthdata.com/about/terms-of-use/) place its raster/vector data in the public domain. The [bundled metadata](https://github.com/CesiumGS/cesium/blob/1.138/packages/engine/Source/Assets/Textures/NaturalEarthII/tilemapresource.xml) identifies EPSG:4326 and levels 0–2, so it provides broad earth context rather than street detail or precise borders. Courtesy credit remains visible.

Optional street imagery uses OpenStreetMap. Its data is [ODbL](https://www.openstreetmap.org/copyright), and its public [tile service policy](https://operations.osmfoundation.org/policies/tiles/) requires visible contributor attribution, HTTPS, a valid browser Referer, normal HTTP caching and no bulk/prefetch downloads. These are separate service terms, not rights granted by MIT. OSM availability is not guaranteed.

## Privacy and map semantics

`src/globe-data.ts` projects a current authorized world onto the sourced public POI catalog. It does not use private DTO coordinates, stories, people names, signed media URLs or gift capabilities. The seven plotted anchors have explicit public coordinate provenance. Paris, Japan House and unknown locations remain in an unlocated list when a verified point coordinate is absent.

An authenticated owner scope must match the current non-demo world user. Public fictional scope must contain explicitly fictional, shared-location memories. A received memory needs an active membership for that recipient and explicit location sharing before it can supply an overlay. An owner may see their own unshared memory at its public catalog anchor; that permission does not extend to recipients. Revoked, archived, orphan or stale memory discoveries cannot create pins. Physical visits and wishlist records remain independent of memory archive, and do not color sibling points.

Symbols distinguish physical visit `●`, memory discovery `◇` and wishlist `☆`. The Story atlas continues to represent world → country → state → municipality → district/corridor/curated region → point. Geography grouping is semantic unless an authoritative surveyed polygon is supplied; Paulista remains a corridor. Receiving Paris is not evidence of physical travel.

Coordinate input is browser-local and camera-only. It does not call a geocoder, browser geolocation, generation provider or persistence endpoint. It does not save searched coordinates into a share URL. No ion, Google Maps key, world terrain or external imagery service is needed for the default globe design.

The street-map toggle explicitly enables network tile requests and displays a provider notice and OSM credit. Tile requests expose the selected map area and normal connection information to the provider, even though private memory payloads are not sent. Production `Referrer-Policy: strict-origin` sends the site origin only on secure requests, omitting route and query; it avoids the previous `no-referrer` conflict with OSM's browser policy. [Referrer-Policy documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy) describes those semantics. Gift capabilities remain in fragments and authorization headers, separate from tile requests.

## Runtime and deployment

The renderer uses [Cesium 1.138's Viewer API](https://cesium.com/downloads/cesiumjs/releases/1.138/Build/Documentation/Viewer.html), disabled default imagery/geocoder/widgets, a local imagery provider and explicit rendering. It cancels previous camera flights before a new target. It pauses its default loop while hidden or outside the viewport and disposes viewer, observer, input and imagery-error listeners on route cleanup. Post-constructor initialization has an error cleanup boundary; late local-imagery completion checks that its own root remains attached before initializing WebGL. Zoom controls are clamped rather than relying on mouse-controller limits. Reduced motion uses an immediate camera target. The existing Story atlas remains available when WebGL or local imagery fails.

The [official Cesium Vite setup](https://cesium.com/blog/2024/02/13/configuring-vite-or-webpack-for-cesiumjs/) requires `Assets`, `Workers`, `ThirdParty` and `Widgets` from `node_modules/cesium/Build/Cesium` to be served as static content, and `CESIUM_BASE_URL` set before imports. GiftPortals' Vite plugin serves them at `/cesium/` in development and emits that layout into the production build. Widget CSS is bundled. This configuration assumes deployment at the site root; a subpath deployment requires matching Vite base and Cesium base paths.

The source retains the full MIT notice; the deployed copy is `/licenses/gods-eye-view.txt`. The Vite asset plugin emits Cesium's full Apache/third-party notice as `/cesium/LICENSE.md`. Both local license URLs passed read-only HTTP smoke checks with 200 responses and license content rather than HTML fallbacks; source/vendored Gods Eye license hashes match. Preserve these notices in source packages and deployed artifacts. Keep map/provider attribution visible in screenshots and recordings, including when imagery is switched. Local imagery hosting does not prove the entire app makes no network requests; browser network evidence must be scoped to the default map path.

## Confirmed validation

The full local suite passes **88/88**, with no failures, skips or cancellations. Strict backend typechecking and the frontend production build pass. The eight independent `tests/globe-navigation.test.mjs` cases cover signed São Paulo axis order; reversed hemisphere axes; junk/contradiction rejection; geographic limits; real-point framing; short antimeridian extent; pole clipping; invalid center/span rejection. The independent navigation and globe-data run passed 19/19. Vendored parser and license SHA-256 match pinned upstream bytes.

The data projection suite covers owner/recipient scope, hidden locations, revocation, multiple memories, unlocated places, input immutability and independent visit/wishlist records. The final renderer also disposes its local imagery-error listener and converts repeated local tile failures into the recovery surface instead of leaving a falsely healthy globe.

Actual in-app-browser checks on the local development app rendered both the default Natural Earth globe and explicitly enabled OSM street imagery. In a capture of **45 requests** for the default local-map path, the only three external requests were Google Fonts resources; no external imagery, map-provider or API requests were observed. This is a scoped network observation, not a claim that the whole application is offline or makes no external requests.

Blocking local imagery produced the truthful recovery state with **zero canvases**. Restoring imagery and pressing Retry returned a healthy view with **one canvas**. Edge mobile at a 390-pixel viewport rendered the globe, exposed coordinate provenance, and showed no authorized Santos memory in Noah's recipient scope. Invalid coordinate input was refused; valid coordinates moved only the camera. The preserved Tripo gift and World Labs place viewers also passed the mobile journey check. A controlled module-load failure continued to the Story atlas; fresh-page Retry returned a healthy single canvas while preserving focus and persona. Browser test overrides were restored and temporary mobile tabs closed. These UI checks were performed by the browser owners; the source reviewer inspected their saved earth, street-map and Noah/Santos screenshots.

The final production **build passes**, including the retry and local-tile-listener fixes. A separate actual **production-preview browser check on port 4324 passes**: local Earth rendered with one Cesium canvas and the recovery surface hidden; Earth, OSM selection and TUCA navigation remained healthy at a 1440-pixel desktop viewport without horizontal overflow. This is localhost production-preview evidence, not a public deployment. Cloud ACL/session/recipient integration remains unexecuted pending configuration. No deployment, new provider generation or hackathon submission result is claimed.

The build emits a roughly 4.03 MB minified geographic-globe module (about 1.10 MB gzip) and the existing roughly 4.93 MB World Labs/Spark module (about 1.75 MB gzip), with expected large-chunk warnings. Lazy loading and fallback keep them outside the initial story path; broad low-powered-device performance is not established by this run.
