# GiftPortals 10.2 validation

Date: 2026-10-04. Baseline: `bfe91e4170e3aea89b833e9a9d3f133f51c162df`.

## Completed gifts and collection

Previously the creator registered a completed gift only after the author pressed Open gift, and the collection ignored the in-memory generated-gift map. Ready jobs now register immediately, feed both the desk and My Memories, and restore through read-only snapshots after a reload. A local snapshot never starts or refreshes generation.

The browser stores at most 100 opaque job references, with a seven-day limit matching the instant gift lifetime. Photos, stories and signed asset URLs are not copied to local storage. References are scoped to the account, anonymous creator or demo. Logging out clears that account's device references. This release does not add account-based cross-device synchronization. An older missing gift can be recovered only if its previous reference or gift link still exists.

Created gifts open their keepsake directly. The scene no longer asks the author to reveal an already visible photo. The original-photo fallback and accessible viewer controls remain available. Creation currently offers photos of places; existing gifts made from objects remain readable.

## Places and editable suggestions

The Place step uses visible OpenStreetMap raster tiles with pan, pinch, zoom, keyboard navigation, recenter and contributor attribution. It can switch to Natural Earth and falls back when the tile service is unavailable. No new map account or key is required. The application does not download offline tiles or prefetch an area.

Use my location is an explicit action. A precise lookup point is held in memory for nearby suggestions and cleared on skip, manual selection, replacement or destruction. A saved gift still receives only the existing approximate location, and inclusion in the story remains optional. Nearby OpenStreetMap points are candidates to confirm, rather than an assertion that the user is standing at one of them.

The assistant offers a photo description, title, story and imagined-world prompt, with editable fields and the option to write original words. Responses cannot replace fields the author has edited. Public place details use OpenStreetMap and Wikipedia, retain source links and distinguish a fact about the confirmed place from a nearby attraction. The named Praça Américo Portugal Gouvêa/Gouveia has a reviewed municipal source about the 2020 mosaics; that source is shown only for its confirmed name.

The existing production configuration contained Tripo and World Labs credentials but no general text-generation key. Photo interpretation uses the Vercel runtime's OIDC credential with AI Gateway and Google Gemini 2.5 Flash Lite. The photo is sent only after explicit permission; a location-only lookup never invokes generative AI. Images are limited to 2 MB, responses to 900 output tokens, and requests have bounded time, concurrency and quotas. Only a hash and the short generated response are cached for 20 minutes; the assistant does not retain the uploaded photo. Provider failure or exhausted credit returns an identified template, without asserting that the photo was analyzed or inventing historical facts.

## Verification

The complete automated suite passed: **823 tests, zero failures**, using `node --test --test-concurrency=1 tests/*.test.mjs api/tests/*.test.mjs` (44.4 seconds). Frontend and strict server TypeScript checks and the production Vite build passed. Follow-up regression checks also cover request-scoped Vercel runtime OIDC tokens and replacing or clearing catalog defaults through the author's explicit suggestion controls.

- TypeScript checks for frontend and server, and a production Vite build.
- Automated tests covering completion, restoration, owner isolation, direct opening, place maps, consent, stale requests, edited fields and sourced details.
- Isolated mobile browser flows with synthetic media and mocked generation: save before Open gift, create a second gift, reload, visit desk and My Memories, and inspect the suggestion controls.
- Production smoke uses a synthetic test image and public place names only. It does not send the user's photographs or start Tripo/World Labs generation.

The isolated 390-pixel mobile browser confirmed immediate collection registration before Open gift, a second gift without losing the first, desk and My Memories after reload, zero object selectors and no page errors. The assistant browser checks covered photo permission, explicit POI confirmation without turning location inclusion on, opt-out cleanup of automatic words, preservation of manual words, sourced details added only by the author, rejected source URLs, stale photo replies and a service failure that still permits creation. Generation and GPS in these browser checks used controlled fixtures.

The first production deployment, `28ffe9357e881aba9b0ae24b82399967e54f1d30`, reached READY at `giftportals.vercel.app`. Real public-service lookup returned five OpenStreetMap candidates and a Wikipedia detail for a public Paris test point; the named São Paulo square returned its municipal curiosity. The production browser rendered actual street tiles and the editable sourced curiosity. This lookup used a synthetic location fixture, not the user's GPS. A [production street-map screenshot](evidence/v10_2-street-map.jpg) records the visible result.

The first photo smoke identified that Vercel supplies a function's OIDC credential through the `x-vercel-oidc-token` request header; the environment token is for build/development contexts. The follow-up passes that credential only within the current trusted Vercel request, never through mutable shared state or back to the browser. Live photo availability must be confirmed by a successful photo smoke, rather than the runtime status flag alone.

Physical XR, printing and sponsor-hardware validation retain their prior limits in `V10-SPONSOR-AUDIT.md`.

A second publication (`7ca4e4c9374bf2f1b3b7b94647d9f094e11b63c1`) reached READY. The runtime correctly exposed OIDC availability, but the live image call received a Gateway 403. This is not recorded as successful photo interpretation. The browser can still use place templates and sourced curiosities. The compatibility follow-up (`39f3c5772d0f3a2a1829cffeb59404c0b6c49812`) also reached READY and supplied the official SDK's `ai-gateway-auth-method: oidc` header. Its synthetic photo smoke still received HTTP 403. A bounded private classifier returns only a safe enum and HTTP status; no upstream error text, credential or photo is returned to the browser. Thirteen focused backend tests passed after this follow-up.

The production browser confirmed that Use these words replaces the automatic Paris catalog story with the named São Paulo square suggestion. Add to my story appends the reviewed municipal curiosity with its source link. These checks used public examples and names, did not access real GPS, and did not start 3D generation.

The diagnostic publication (`2adb1d019e761bcae7414b7c5a9348f775f7eead`) reached READY. A synthetic image call returned **HTTP 403 `CUSTOMER_VERIFICATION_REQUIRED`**, `provider: template`, and `photoAnalyzed: false`. This is the confirmed production blocker, not a successful image interpretation. Vercel's [AI Gateway FAQ](https://vercel.com/docs/ai-gateway/faq) says this exact error requires a valid payment method on the team before free credits can be used. No credentials, payment method, credit purchase, billing setting or model allowlist was changed. Further live image calls were stopped after identifying the account gate.

The photo interpretation adapter is implemented and type-checked, but live photo interpretation remains pending account verification and a new successful smoke. Place-only suggestions, nearby candidates, sourced curiosities and manual story editing do not depend on that account gate. A denied account/access/credit response disables only further photo interpretation in the current creator session and shows a clear unavailable message; it does not prevent choosing another photo or completing the gift.

Final verification after the refusal UI patch: **823/823 tests passed**, frontend and strict server TypeScript passed, and the production Vite build passed. Focused wizard/validation tests passed 34/34; Gateway tests passed 13/13. These tests include preserving the selected photo and manual words, refusing repeated account-blocked photo requests after a source change, maintaining place-only refresh and gift creation, and leaving transient failures retryable.
