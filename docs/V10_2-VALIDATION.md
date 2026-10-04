# GiftPortals 10.2 / 10.2.1 validation

Date: 2026-10-04. Baseline: `bfe91e4170e3aea89b833e9a9d3f133f51c162df`.

## Completed gifts and collection

Previously the creator registered a completed gift only after the author pressed Open gift, and the collection ignored the in-memory generated-gift map. Ready jobs now register immediately, feed both the desk and My Memories, and restore through read-only snapshots after a reload. A local snapshot never starts or refreshes generation.

The browser stores opaque job references, with a seven-day limit matching the instant gift lifetime. Release 10.2.1 removes the former 100-reference count cap. Photos, stories and signed asset URLs are not copied to local storage. References are scoped to the account, anonymous creator or demo. Logging out clears that account's device references. This release does not add account-based cross-device synchronization. An older missing gift can be recovered only if its previous reference or gift link still exists.

Created gifts open their keepsake directly. The scene no longer asks the author to reveal an already visible photo. The original-photo fallback and accessible viewer controls remain available. Creation currently offers photos of places; existing gifts made from objects remain readable.

## Places and editable suggestions

The Place step uses visible OpenStreetMap raster tiles with pan, pinch, zoom, keyboard navigation, recenter and contributor attribution. It can switch to Natural Earth and falls back when the tile service is unavailable. No new map account or key is required. The application does not download offline tiles or prefetch an area.

Use my location is an explicit action. A precise lookup point is held in memory for nearby suggestions and cleared on skip, manual selection, replacement or destruction. A saved gift still receives only the existing approximate location, and inclusion in the story remains optional. Nearby OpenStreetMap points are candidates to confirm, rather than an assertion that the user is standing at one of them.

The assistant offers a photo description, title, story and imagined-world prompt, with editable fields and the option to write original words. Responses cannot replace fields the author has edited. Public place details use OpenStreetMap and Wikipedia, retain source links and distinguish a fact about the confirmed place from a nearby attraction. The named Praça Américo Portugal Gouvêa/Gouveia has a reviewed municipal source about the 2020 mosaics; that source is shown only for its confirmed name.

The existing production configuration contained Tripo and World Labs credentials but no general text-generation key. Photo interpretation uses the Vercel runtime's OIDC credential with AI Gateway and Google Gemini 2.5 Flash Lite. The photo is sent only after explicit permission; a location-only lookup never invokes generative AI. Images are limited to 2 MB, responses to 900 output tokens, and requests have bounded execution time. Release 10.2.1 removes application request quotas and the refusal of concurrent assistant requests. Only a hash and the short generated response are cached for 20 minutes; the assistant does not retain the uploaded photo. Provider failure or exhausted credit returns an identified template, without asserting that the photo was analyzed or inventing historical facts.

## Verification

The initial 10.2 automated suite passed: **823 tests, zero failures**, using `node --test --test-concurrency=1 tests/*.test.mjs api/tests/*.test.mjs` (44.4 seconds). Frontend and strict server TypeScript checks and the production Vite build passed. Follow-up regression checks also cover request-scoped Vercel runtime OIDC tokens and replacing or clearing catalog defaults through the author's explicit suggestion controls. The final 10.2.1 suite and production database verification are recorded below.

- TypeScript checks for frontend and server, and a production Vite build.
- Automated tests covering completion, restoration, owner isolation, direct opening, place maps, consent, stale requests, edited fields and sourced details.
- Isolated mobile browser flows with synthetic media and mocked generation: save before Open gift, create a second gift, reload, visit desk and My Memories, and inspect the suggestion controls.
- Initial production place and photo-assistant checks used a synthetic test image and public place names. They did not send the user's photographs or start Tripo/World Labs generation. The subsequent 10.2.1 paid creation smoke is tracked separately below.

The isolated 390-pixel mobile browser confirmed immediate collection registration before Open gift, a second gift without losing the first, desk and My Memories after reload, zero object selectors and no page errors. The assistant browser checks covered photo permission, explicit POI confirmation without turning location inclusion on, opt-out cleanup of automatic words, preservation of manual words, sourced details added only by the author, rejected source URLs, stale photo replies and a service failure that still permits creation. Generation and GPS in these browser checks used controlled fixtures.

The first production deployment, `28ffe9357e881aba9b0ae24b82399967e54f1d30`, reached READY at `giftportals.vercel.app`. Real public-service lookup returned five OpenStreetMap candidates and a Wikipedia detail for a public Paris test point; the named São Paulo square returned its municipal curiosity. The production browser rendered actual street tiles and the editable sourced curiosity. This lookup used a synthetic location fixture, not the user's GPS. A [production street-map screenshot](evidence/v10_2-street-map.jpg) records the visible result.

The first photo smoke identified that Vercel supplies a function's OIDC credential through the `x-vercel-oidc-token` request header; the environment token is for build/development contexts. The follow-up passes that credential only within the current trusted Vercel request, never through mutable shared state or back to the browser. Live photo availability must be confirmed by a successful photo smoke, rather than the runtime status flag alone.

Physical XR, printing and sponsor-hardware validation retain their prior limits in `V10-SPONSOR-AUDIT.md`.

A second publication (`7ca4e4c9374bf2f1b3b7b94647d9f094e11b63c1`) reached READY. The runtime correctly exposed OIDC availability, but the live image call received a Gateway 403. This is not recorded as successful photo interpretation. The browser can still use place templates and sourced curiosities. The compatibility follow-up (`39f3c5772d0f3a2a1829cffeb59404c0b6c49812`) also reached READY and supplied the official SDK's `ai-gateway-auth-method: oidc` header. Its synthetic photo smoke still received HTTP 403. A bounded private classifier returns only a safe enum and HTTP status; no upstream error text, credential or photo is returned to the browser. Thirteen focused backend tests passed after this follow-up.

The production browser confirmed that Use these words replaces the automatic Paris catalog story with the named São Paulo square suggestion. Add to my story appends the reviewed municipal curiosity with its source link. These checks used public examples and names, did not access real GPS, and did not start 3D generation.

The diagnostic publication (`2adb1d019e761bcae7414b7c5a9348f775f7eead`) reached READY. A synthetic image call returned **HTTP 403 `CUSTOMER_VERIFICATION_REQUIRED`**, `provider: template`, and `photoAnalyzed: false`. This is the confirmed production blocker, not a successful image interpretation. Vercel's [AI Gateway FAQ](https://vercel.com/docs/ai-gateway/faq) says this exact error requires a valid payment method on the team before free credits can be used. No credentials, payment method, credit purchase, billing setting or model allowlist was changed. Further live image calls were stopped after identifying the account gate.

The photo interpretation adapter is implemented and type-checked, but live photo interpretation remains pending account verification and a new successful smoke. Place-only suggestions, nearby candidates, sourced curiosities and manual story editing do not depend on that account gate. A denied account/access/credit response disables only further photo interpretation in the current creator session and shows a clear unavailable message; it does not prevent choosing another photo or completing the gift.

Final verification after the refusal UI patch: **823/823 tests passed**, frontend and strict server TypeScript passed, and the production Vite build passed. Focused wizard/validation tests passed 34/34; Gateway tests passed 13/13. These tests include preserving the selected photo and manual words, refusing repeated account-blocked photo requests after a source change, maintaining place-only refresh and gift creation, and leaving transient failures retryable.

## Review creation refusal reported after release

On 2026-10-04 at 14:15 São Paulo time (17:15 UTC), production recorded four `POST /api/instant-cloud` responses with HTTP 429. Each was followed by a read returning 404. The public cloud status still reported creation available and remaining reservations of 800 Tripo credits and 12,640 World Labs credits. This separates the reported Review refusal from the AI Gateway image-analysis account gate.

The creator status checked shared reserved-credit and storage budgets, while transactional prepare also enforced daily global and per-owner quotas. The Review route replaced domain errors with one generic message. Production HTTP logs establish the 429 refusal; the daily quota is the leading diagnosis, rather than an upstream sponsor error proved by those logs.

André explicitly directed removal of application-imposed usage quotas and use of existing sponsor credits on October 4. Release **10.2.1** removes the daily creation, lifetime reserved-credit and global storage gates in migration 004. Migration 005 removes the corresponding legacy Studio memory, media, generation, retry and credit quotas. The API and creator no longer use those audit counters as creation limits. Reservation and usage records remain for accounting; ownership, consent, transaction locking, idempotency and job state checks remain enforced. Historical migrations 001–003 are unchanged.

The provider preflight no longer requires an extra 1,000 World Labs credits. Actual account balance and the provider's response still determine whether a task can run. Assistant request quotas and local creation count/budget caps are also removed. Scheduler concurrency controls accept queued work, rather than rejecting a new creation. MIME, decoder and request-size limits remain technical validation, not daily or lifetime allowances.

Specific safe errors preserve the photo and edited words. Check availability reads status without starting generation. A definitive refusal before prepare returns does not attempt recovery for a nonexistent job. Ambiguous network and finalize outcomes retain conservative recovery to avoid duplicate spending.

Migrations 004 and 005 were applied to production with database-owner access on 2026-10-04. The deployed service role still has no permission to replace database functions or constraints. Existing sponsor credits are authorized; no credit purchase or payment-method change is part of this release. The subsequent paid creation result is recorded below.

Before production application, both migrations executed successfully in a disposable PostgreSQL engine (PGlite 0.5.8 with pgcrypto) after historical migrations 001–003, then each was reapplied successfully. That engine used synthetic Supabase auth/storage schema fixtures. Rollback-only transaction scripts `supabase/tests/instant_existing_credits.sql`, `studio_existing_credits.sql` and `acl_and_budget.sql` passed; those fixtures were not run in production. Instant checks cover 25 prepares by an owner already above the former daily allowance, zero legacy credit caps, more than 3 GiB of reserved storage, exact dedupe without a second reservation, wrong-owner/token/recipe rejection, nonnegative accounting and service-role-only RPC execution. Studio checks cover 201 memories, 36 originals exceeding the old aggregate allowance, four jobs above a zero legacy credit cap, an explicit third retry, ownership/consent, completed-component reuse and ambiguous-submission protection.

The independent mobile harness passed **126 assertions across five scenarios**, with three explicit mocked creations and all three present on the desk and in My Memories after reload. Legacy exhausted quota/budget fields did not block the creator. Readiness, definitive prepare refusal, lost response and finalize/provider failure checks preserved the selected photo, edited story and consent; availability rechecks were GET-only and recovery reused the same reference. There were zero page errors, horizontal overflows, GPS requests or real provider calls. The [sanitized mobile receipt](evidence/v10_2_1-simulated-mobile-no-caps.json) is explicitly labelled **SIMULATED — NOT PRODUCTION**.

The legacy Studio worker no longer requires its old 500-credit reservation to match a newer 1,580-credit World Labs recipe before submission. It checks the pinned task's cost against fresh provider credits and preserves its accounting records. Real insufficient-credit responses are persisted by stage without repeatedly checking or attempting the refused paid task; an independent successful stage may still finish.

**Final 10.2.1 code verification: 854/854 tests passed**, zero failures, in 47.2 seconds using `node --test --test-concurrency=1 tests/*.test.mjs api/tests/*.test.mjs`. Frontend and strict server TypeScript checks and the production Vite build passed. The simulated browser and disposable SQL checks did not start paid provider tasks and do not establish the outcome of a real creation.

## Production 10.2.1 publication and database readback

The reviewed code and migrations at `c1282d6` were merged into `main` as `0d7d2a3e5296037e46ab5788a19bce1bed70d2f3`. Production deployment `dpl_2wW8ukkpLCnhzBTggDGc1FA24ApU` reached **READY** at [giftportals.vercel.app](https://giftportals.vercel.app).

Production migration history records both changes applied on 2026-10-04:

| Migration | Production version | UTC time |
| --- | --- | --- |
| `004_instant_existing_provider_credits.sql` | `20261004175946` | 17:59:46 |
| `005_studio_existing_provider_credits.sql` | `20261004180009` | 18:00:09 |

An independent metadata-only readback completed at **18:03:18 UTC**. All five replaced function bodies matched the reviewed `c1282d6` source exactly and retained their `postgres` owner. The three privileged creation/retry RPCs denied EXECUTE to `anon` and `authenticated` and allowed `service_role`; function and table ACLs matched the pre-application review. Both retired upper-bound CHECKs were absent, and both replacement nonnegative CHECKs were validated. RLS remained enabled on all 15 `gp_*` tables, the three profile/memory/media triggers remained enabled, and `anon`/`authenticated` could not CREATE in the public schema. Existing advisor warnings for the inherited profile trigger and boolean RLS helper were unchanged.

The audit snapshot retained four Instant jobs, eight reservations, two owner/day audit rows, 6,720 reserved credits and 444,596,224 reserved storage bytes. Studio remained at zero memories, media and jobs, with zero reserved credits. The readback queried only catalog metadata and aggregate accounting totals, without reading photos, stories, profiles, tokens or owner identifiers. It invoked no mutating RPC or provider and did not alter billing or balances.

## Production creation smoke and failure follow-up

The published code and production migrations are verified; the [sanitized database readback](evidence/v10_2_1-production-database-readback.json) records the checked metadata. A public Kyoto catalog fixture passed prepare and upload at 18:07:58 UTC, then stopped at photo validation before any provider submission. No paid task was recorded. The original error path discarded the pre-stage cause and incorrectly displayed continued world creation; a targeted follow-up persists safe terminal reasons and renders completed failure honestly, including older jobs. Valid denied moderation reports remain private and cannot authorize signed photo reads or provider work. The subsequent normal photo-flow creation and its provider, collection and viewer outcomes are recorded below. Deployment READY, database readback and simulated checks do not by themselves prove a paid creation completed.

The narrow pre-generation failure hotfix passed **859/859 tests**, zero failures, in 47.7 seconds. Frontend and server type checks and the production build passed. Independent adversarial tests confirmed that contradictory aggregate-allow reports with individual block/review/uncertain results cannot expose signed photos or start provider work. Disposable PostgreSQL checked terminal failure persistence, stale-lease rejection and dedupe without a second reservation. No new database migration is required. The patch was committed as `5005419af146f42089c7b72de873f6cc3bc5456a`; its deployment `dpl_F5fXNWHfbt91WptCqR6wehpmQpc7` reached READY on the production alias, and the browser verified the corrected terminal-state UI. Its normal photo creation result is recorded below.

## Delivered souvenir with an unavailable world

The normal photo-flow QA used the public Kyoto original, with personal location and photo interpretation off. Production approved both the uploaded original and the generated reference. Tripo image-to-image and the model task completed; the verified private GLB is **15,566,644 bytes**. World Labs accepted its task, then returned a generation failure (`PROVIDER_GENERATION_FAILED`). The resulting job is `partial`; this is not recorded as a successful world-generation smoke. The [sanitized creation receipt](evidence/v10_2_1-production-creation.json) excludes task/job IDs, capabilities, signed URLs and owner identifiers.

A delivered Tripo souvenir in a terminal partial job now saves immediately and opens as a keepsake. The creator explains that its world is unavailable. The desk and My Memories use the same readiness rule, and reopening uses read-only snapshots; unavailable world, panorama, collider and semantics are removed from the projection. No replacement task, automatic retry or fabricated world is created. The gift viewer disables its unavailable World view and preserves the real souvenir, story, print and souvenir VR actions.

The cloud test browser reports `GL_VENDOR` and `GL_RENDERER` Disabled; it cannot render WebGL. This is recorded as a browser verification limit, not as an invalid generated model or a successful 3D rendering check. Collection, reload and image/story fallback verification are recorded after publication below.

Final partial-souvenir verification: **867/867 tests passed**, zero failures, in 47.3 seconds; frontend TypeScript and the production build passed. Independent review reran 186 focused tests and confirmed unchanged capability scope, idempotency, ambiguity protection, no-world XR behavior and read-only collection restoration. The patch is `0befe3f6b1e2201704d3c788fe9935ee5d04264e`. No additional paid task, quota reset or database migration was used to recover the completed souvenir.

## Production collection and catalog verification

Deployment `dpl_4FkHLW2YKgcMZoVJm7YN4JXhk9Qg` reached READY for `0befe3f6`. The normal photo-flow souvenir appeared as **Gifts 1** on the memory desk, before Open was pressed. My Memories contained its matching title, retained it after a page reload, and reopened its keepsake directly. Its World action was disabled and the viewer stated that the world is unavailable while the keepsake and story remain. The browser GPU limitation prevented actual WebGL rendering; the generated miniature image and saved gift were visible. A collection screenshot was provided privately to the owner; it is excluded from the public repository. The creation receipt records these checks without private images.

A third explicit creation on the same browser owner passed prepare, demonstrating removal of the old two-per-day gate. Its identical Kyoto catalog pair stopped at moderation with zero paid submission intents. The exact original was allow/ordinary; only the static miniature reference was review/uncertain. Both terminal stage reasons were retained, and the UI no longer claimed continued generation. The [sanitized exact-fixture diagnosis](evidence/v10_2_1-kyoto-catalog-diagnosis.json) contains only public image digests and decisions. Kyoto now uses the existing original-photo path to generate and verify a new miniature, retaining its catalog title, story, place and curiosities. No policy weakening, automatic replay, or mutation of the refused job is used.

Final release verification after the Kyoto catalog correction: **869/869 tests passed**, zero failures, in 48.5 seconds. Frontend and strict server TypeScript checks and the production Vite build passed. Independent review reran 66 catalog, wizard and cloud-service tests and confirmed that only Kyoto's two static-reference fields were removed, while Paris and the other catalog data remain unchanged. The original-photo path generates and screens its new miniature before model submission. These final checks did not start another paid task.
