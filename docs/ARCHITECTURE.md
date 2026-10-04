# GiftPortals cloud architecture

The Vite/TypeScript/Three.js browser app calls two Vercel Node functions. Supabase Cloud owns authentication, PostgreSQL records, and private object storage. The browser is a viewer and controller; personal memories, authorized gifts, atlas records, and provider jobs survive browser closure and machine shutdown.

**Verification checkpoint, 2026-09-30:** backend TypeScript checks and 13 local security/contract tests pass. Those tests use synthetic credentials, intercepted fetches, and the verified local GLB/SPZ assets. They do not contact Supabase or providers. The migration, SQL ACL/budget integration checks, demo seeding, deployed routes, and cloud scheduler remain **UNEXECUTED** until the operator configures the dedicated cloud project. Local tests and generated assets do not establish a working cloud deployment or a hackathon submission.

## Components and contracts

`shared/contracts.ts` is the browser/server DTO contract. `/api/giftportals?action=...` provides signup, login, session refresh, owner worlds, memory creation/edit/archive/restore, upload tickets, upload completion, gift sharing/claim/revocation, separate atlas records, generation requests, and job reads/retries. `/api/tick` is a server-authenticated scheduler endpoint. All UI errors and API messages are English. Responses use `{ok,data}` or `{ok:false,error:{code,message}}`, contain no upstream diagnostic body, and have `Cache-Control: no-store`.

Authentication uses Supabase email/password sessions. Signup is explicitly gated by `ENABLE_SIGNUP=true` and honors the project's email-confirmation policy. The server validates each supplied access token with Supabase Auth. Browser roles have SELECT permissions with RLS; they cannot mutate GiftPortals tables, call service mutation RPCs, or access either private storage bucket directly. The service-role key stays in Vercel server environment variables.

## Memories and permission boundaries

Each memory has one owner and independent media. Owners can edit the title, narrative, location, and consents. Every changed date must be a valid `YYYY-MM-DD`; a GPS or photo-metadata source requires the explicit source choice provided by the creation form. These source labels are user assertions, not proof of a physical visit.

When location sharing is off, the recipient-readable row contains only `world`, `Location not shared`, zero coordinates, and no experience date. The exact owner location lives in `gp_private_locations` with owner-only RLS. Owner DTOs merge that location only after authenticating the owner. A recipient's claim does not create a location discovery for an unshared place. World generation uses the consciously shared location label and the consented narrative, never private GPS coordinates.

Archiving is reversible. The archive RPC hides the memory from active RLS, public fixtures, gift views, and recipient worlds; revokes its gifts; stops local job processing; and removes source-linked memory discoveries. Independent physical visit/wishlist records remain. Restore makes the owner's memory active again and does not reactivate revoked gift links. Already accepted provider work may still consume credits; an archive cannot recall external computation or downloaded copies. Media is retained privately so restore works.

Original photos/audio require both content-sharing consent and explicit consent to embedded metadata. A photo original can contain EXIF location or device metadata even when the separate location field is hidden. The application shares the original only after that explicit warning/consent; it does not claim to strip EXIF. If originals should be anonymized, the owner must upload a cleaned copy. Original media and the author's words remain available alongside AI interpretations.

## Gift links

A read capability is 32 cryptographically random bytes. Its SHA-256 hash is stored in PostgreSQL; the raw token is returned only during creation. It grants one active memory view and never a sender world, a recipient list, or a claim right. Read links use a URL fragment, `/#gift=...`; the browser sends `X-Gift-Token` to the API. The legacy query fallback exists for compatibility and should not be used by the UI because URLs can be logged.

An owner must separately enable the transferable claim invitation. It creates another independent 32-byte token/hash and a `claimUrl` containing both fragment capabilities. The browser sends `X-Gift-Claim` when loading the invitation, and POST claim requires both `token` and `claimToken`. The read token alone cannot claim. The recipient display name is descriptive; it is not verified email binding. The first authenticated holder of the explicit invitation can claim. SQL locks that gift while claiming, so a second user cannot win a simultaneous claim.

Revocation denies new application reads immediately and removes claimed access from RLS. Previously issued storage read URLs remain valid for at most 60 seconds; downloaded copies cannot be recalled. Storage signatures are not presented as instantly revocable. Owners can issue a fresh gift after revoking an old one.

## Atlas semantics

`gp_discoveries.kind` keeps `physical`, `memory`, and `wish` separate. A gift claim adds memory discovery only. It never increments physical exploration or colors a place as visited. Current received discoveries are derived from every authorized, active received memory, so two gifts at the same place stay independent if one is revoked, archived, or edited. Source-linked memory discoveries follow location edits; manually recorded physical visits do not move automatically.

The place tree includes the sourced São Paulo/Santos pilot and an explicit Paris outside-pilot example. Undefined landmark coordinates are not invented. Municipal/district/region IDs used by SQL match the browser map. The map's coverage and aggregation tests are maintained with the frontend.

## Private uploads and storage limits

The original bucket `giftportals-private` is private and enforces an 8 MiB object limit. Each signed original upload reserves 8 MiB in `gp_media.quota_bytes` regardless of the client-declared byte count. Image inputs allow JPEG/PNG/WebP up to 8 MiB; audio allows WebM/Ogg/MP3 up to 4 MiB. Completion checks actual length and magic bytes before making the row readable. A rejected original is removed but keeps its reservation until the upload token has expired. Protected cloud ticks remove pending original uploads older than three hours; Supabase signed upload tokens expire after two hours.

The generated bucket `giftportals-generated` is separately private and allows server-validated GLB, SPZ, and panorama objects up to 25 MiB each. Public clients cannot obtain upload tokens for that bucket. Asset downloads accept only HTTPS on the official provider domains, do not follow redirects, and never forward provider credentials to asset CDNs. GLB headers/version/length, panorama magic bytes, and bounded decompressed SPZ headers/point counts are checked. An oversize/invalid output fails with a safe error while retaining the original memory.

Limits are 30 memories per personal account, 8 originals plus 3 generated assets per memory, 100 MiB reserved/verified storage per owner, 200 memories and 200 MiB reserved/verified storage for the event. Archived items still count because their media is retained. These are application caps; configure the cloud project without paid storage overage. Original reservations deliberately remain conservative after completion. The server reserves up to 25 MiB for a Tripo output and 50 MiB for a World Labs SPZ plus panorama **before** creating a paid job. A SQL RPC converts that reservation into verified media bytes atomically; completion releases unused capacity. This prevents provider spending followed by an avoidable quota failure.

## Durable generation

The enqueue RPC is atomic and checks owner/AI consent, personal account, dedupe key, storage capacity, per-user rate, and global provider budget before inserting a job. Shared demos cannot generate. A user can enqueue at most two jobs in 24 hours. Each memory component reuses its first successful job; editing a narrative does not silently regenerate or spend again. There are at most two globally active provider jobs. Queued/processing records live in PostgreSQL, with provider IDs, submitted-at intention, immutable narrative snapshot, attempts, poll count, credits, due time, and a 90-second worker lease.

The protected worker executes one due job per cloud tick. Before a paid request it checks the current official provider credit balance. Tripo uses available `balance - frozen`; World Labs requires its reservation plus a 1000-credit floor. Runtime reservations are 150 credits for Tripo and 500 for World Labs, with total event caps of 1200 and 2000 respectively. Demo seeding records the verified earlier 35 Tripo/230 World Labs credits against those same caps exactly once. Reservations are not automatically refunded; extra settled cost is recorded conservatively. No automatic refill is requested by this app.

Tripo requests use v3 `POST /generation/image-to-model`, pinned `model: v3.1-20260211`, 10,000 faces, standard texture, and PBR. A one-hour private input signature is supplied only to Tripo after consent. Polling uses `GET /tasks/{id}`. Completed GLB outputs are downloaded immediately and cached privately because provider asset URLs are temporary.

World Labs requests use `POST /marble/v1/worlds:generate`, `model: marble-1.0-draft`, a text prompt, and `permission: {public:false}`. Polling uses the operation ID; a completed world ID is used for GET world if the operation lacks full assets. Both `assets.splats.spz_urls['100k']` and `assets.imagery.pano_url` are cached privately. The browser renders the verified 100k SPZ and uses the panorama as an explicit environment fallback; it does not label an original photo or a procedural shape as a generated world.

Before the paid POST the worker persists its submission intention. If a timeout/crash loses the provider ID, the job becomes `SUBMISSION_AMBIGUOUS`; neither a later tick nor user retry automatically sends another paid POST. Poll/download/storage failures can retry GET/cache work with the existing provider ID. Jobs stop after 40 polls or 45 minutes. A user can retry twice within the original deadline; paused generation, missing provider credentials, revoked AI consent, demo accounts, archived memories, and ambiguous submissions block retry. Credentials and provider raw errors are never included in API output or logs.

## Fictional demonstrations

`supabase/seed-demo.mjs` is an explicit operator-only, repeatable seed command. It accepts supplied demo account credentials through environment variables, requires `.invalid` demo email domains and passwords of at least 16 characters, verifies every local generated file against `docs/GENERATION_RECEIPT.json`, and copies only verified assets to private cloud storage. It creates Maya and Noah as two real fictional Supabase accounts with `is_demo=true`, three labeled fictional memories, preclaimed fictional gifts, and separate physical/memory/wishlist records. It never prints credentials or gift links.

Public demo login returns the shared fictional account session for reads only. Every mutation, including uploads, creation, sharing, claim, discoveries, and paid generation, returns `DEMO_READ_ONLY`. Published fixtures are immutable through ordinary owner routes as another boundary. Real creation, storage and gift lifecycle tests require separate personal/test accounts with private sessions. The public seeded demo is not evidence that those private cloud write flows have passed.

## Operator setup and cloud scheduler

1. Provision a dedicated Supabase Cloud project. Apply `supabase/migrations/001_giftportals.sql` once as database owner, through the migration history or SQL editor. The script is a transaction: a failed migration rolls back rather than leaving half a schema. It explicitly hardens existing bucket public flags, MIME limits, and byte limits. A restrictive storage policy prevents older broad browser policies from granting access to these two buckets.
2. Configure server-only Vercel variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `PUBLIC_APP_URL`, `ENABLE_SIGNUP`, `ENABLE_GENERATION`, `TRIPO_API_KEY`, `WORLD_LABS_API_KEY`, `DEMO_SENDER_EMAIL`, `DEMO_SENDER_PASSWORD`, `DEMO_RECIPIENT_EMAIL`, `DEMO_RECIPIENT_PASSWORD`. Default feature flags to false during provisioning. Never prefix service/provider secrets with `VITE_`, print them, or put them in versioned files. Optional public `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` support the direct signed upload client.
3. Deploy the Vite app and the actual `api/giftportals.ts` and `api/tick.ts` functions. Configure the canonical app origin before creating links. Verify GET status and a cloud API readback; a page that loads does not prove API persistence.
4. Run `node supabase/seed-demo.mjs` in a process supplied with the operator credentials. Read back exactly two fictional profiles, three public fixtures, verified private cached assets, and budget reservations. The command's success output is limited to counts and `sharedDemoReadOnly:true`.
5. Run the rollback-only SQL integration checks in `supabase/tests/acl_and_budget.sql` before accepting private write flows. They test owner/outsider RLS, private location projection, read-versus-claim rights, physical-versus-memory discovery, archive/revoke/restore, atomic budget/dedupe, ambiguous retry, immutable fixtures, upload reservations, and service-only RPC privileges. A prepared test file is not a passing test receipt.
6. Put named secrets `giftportals_app_url` and `giftportals_cron_secret` in Supabase Vault through its dashboard. Use the exact canonical HTTPS origin and the same server-only cron secret as Vercel. Apply `supabase/scheduler.sql`. It installs `pg_cron` plus `pg_net` and idempotently schedules the named `giftportals-cloud-tick` every minute. Read back the active schedule and a protected tick response. Do not use Vercel Hobby daily cron for minute polling.
7. With generation paused, run the prepared `node supabase/verify-cloud.mjs` only after setting `RUN_CLOUD_INTEGRATION=true`, the canonical `PUBLIC_APP_URL`, public Supabase values, and two private fictional QA accounts through `QA_OWNER_EMAIL`/`QA_OWNER_PASSWORD` and `QA_RECIPIENT_EMAIL`/`QA_RECIPIENT_PASSWORD`. Those accounts must have `is_demo=false`; the script does not create credentials. It checks actual login, original consent/upload/completion, persistent route readback, direct browser write denial, read-only claim denial, explicit invitation claim, recipient owner-action denial, hidden location, edit/discovery recalculation, revocation, archive/restore, independent physical history, and paused generation/retry gates. It archives its one fictional fixture afterward, retaining the private test asset. It prints only safe stage names/counts. **This script has been syntax checked, not executed against cloud.** Separately verify signup/email confirmation and browser-close/reopen persistence, inspect stored bucket/RLS policies with actual anon/auth/object requests, and record those readbacks. Then enable bounded generation only after provider balances and event limits are reviewed. Record one authorized provider job to completion, provider ID/cost/hash, and cloud polling after all local apps are closed.

Cloud deployment, scheduler health, account verification, external team registration, and hackathon submission are separate checkpoints. None is claimed by this document.

## Local verification commands

From `projects/giftportals`, with the already installed pinned dependencies:

```sh
node --test api/tests/backend.test.mjs
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --module ESNext --moduleResolution Bundler --target ES2022 --types node --lib ES2022,DOM --allowImportingTsExtensions api/giftportals.ts api/tick.ts api/_lib/cloud.ts api/_lib/rules.ts api/_lib/providers.ts shared/contracts.ts
node --check supabase/seed-demo.mjs
node --check supabase/verify-cloud.mjs
```

The test suite disables real network access, removes inherited cloud configuration in its own process, uses only synthetic provider credentials, and exercises actual request/error helpers and actual generated GLB/SPZ fixture validation. It does not create cloud accounts or spend credits.

## Official references

- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [signed upload client](https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl), [signed downloads and expiry](https://supabase.com/docs/guides/storage/serving/downloads).
- [Supabase cloud scheduling with Vault, pg_cron and pg_net](https://supabase.com/docs/guides/functions/schedule-functions), [Cron module](https://supabase.com/docs/guides/cron).
- [Tripo v3 image-to-model H series](https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard), [task query](https://developers.tripo3d.ai/en/docs/task-query), [account balance](https://developers.tripo3d.ai/en/docs/account).
- [World Labs generate](https://docs.worldlabs.ai/api/reference/worlds/generate), [operation polling](https://docs.worldlabs.ai/api/reference/operations/get), [world assets](https://docs.worldlabs.ai/api/reference/worlds/get), [current API credits](https://docs.worldlabs.ai/api/reference/credits/get).
