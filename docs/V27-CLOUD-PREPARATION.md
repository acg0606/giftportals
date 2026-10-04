# GiftPortals V27 cloud preparation

The no-login creator now has a durable server adapter for the approved Tripo and World Labs recipes. It stores jobs, quotas, immutable input hashes, task IDs and leases in isolated Supabase tables and assets in two private buckets. Generation is off by default, provider budget caps are zero, and publication remains gated on the user's review. The migration was executed only in isolated local PostgreSQL WASM with test roles and schema stand-ins. No target-cloud migration, storage write, paid provider request or deployment was performed.

## Browser contract

All endpoints return `{ok:true,data}` or `{ok:false,error:{code,message}}`. Browser API requests contain small JSON declarations; image bytes never travel through a Vercel request body. The body limit is16KiB, each input is at most6MiB, and declared inputs together at most12MiB. The browser must hash the exact bytes it will upload. On Create it generates a stable43-character random capability and a stable dedupe key, retains them for recovery, and supplies explicit consent.

| Endpoint | Authority | Behavior |
| --- | --- | --- |
| `GET /api/instant-cloud?action=status` | Public | Availability, signed-direct upload mode and examples; no provider work |
| `POST ...?action=prepare` | Exact approved origin, consent and request capability | Reserve durable job/budgets/storage; return exact signed immutable input upload URLs |
| Direct `PUT` to returned URLs | Exact signed upload capability | Raw image bytes into private quarantine; no additional Supabase login |
| `POST ...?action=finalize` with `{id}` | Approved origin and `X-Instant-Token` | Check actual length, SHA256 and MIME magic for every declared input, then queue |
| `GET ...?action=job&id=...` or `&dedupeKey=...` | Approved host and `X-Instant-Token` | Read compatible InstantJob DTO and fresh signed URLs; no task creation or provider polling |
| `POST ...?action=advance` with `{id}` | Approved origin and `X-Instant-Token` | Lease only that capability's gift, advance one durable step, return current DTO |
| `GET/POST /api/instant-cloud-tick` | Exact `Bearer CRON_SECRET` | Lease and advance one eligible global job |
| `GET/POST /api/instant-cloud-retention` | Exact `Bearer CRON_SECRET` | Clean at most4 expired gifts and release verified storage reservations |

`shared/cloud-instant.ts` is the complete browser contract. Status and job DTOs identify `storage:'cloud'`. The original photograph and generated URLs are withheld until all input hashes have an allow proof. The generated miniature has its own moderation pass before its bytes can reach the model provider. Job DTOs expose only finite, bounded `metricScaleFactor` and `groundPlaneOffset` walking metadata; private database documents, leases, asset paths and raw provider output are omitted.

Cloud mode intentionally has no preview triage or local audio endpoint. Photos leave the browser only after the Create consent. The local Python path remains available in local mode. In cloud mode any browser speech recognition is an explicit microphone action and must disclose the browser's speech service; no cloud audio recording is persisted by these APIs.

## Moderation integration

Configure a trusted HTTPS vision service with `GIFTPORTALS_CLOUD_MODERATION_URL` and its server-only key. It must accept protocol `giftportals-cloud-vision-v1` and an images array containing `{id,sha256,imageDataUrl}`. It must actually inspect every image and reply with a named model version and results tied to every exact image hash. No fabricated allow response or fallback heuristic is supplied here.

```json
{
  "protocol": "giftportals-cloud-vision-v1",
  "modelVersion": "your-actual-vision-model-version",
  "checkedAt": "ISO-8601 timestamp",
  "decision": "allow",
  "results": [
    {"id":"original","sha256":"64 lowercase hex characters","modelVersion":"your-actual-vision-model-version","decision":"allow","category":"ordinary"}
  ]
}
```

The service rejects missing/extra results, mismatched hashes or versions, unknown protocol, block and review. It has no allow fallback when the endpoint is unavailable. The exact approved originals and derivatives are rehashed before provider upload; derived-reference approval is rechecked before model submission.

## Durable execution and limits

The prepared recipes retain Tripo `v3.1-20260211`,30000 faces, detailed texture and geometry, PBR and image alignment, generated souvenir reference `chat_image_2` medium1536x1024 PNG, and private World Labs `marble-1.1` worlds with500k SPZ where available and actual collider extraction. Budget reservations are100 Tripo credits and1580 World Labs credits per gift. Keep recipe and reservation changes together. This baseline does not silently switch to a cheaper legacy demo recipe.

A transaction records `submitting` before each paid provider POST. A response with a task ID is durably recorded before another step. A timeout, process death or uncertain POST response never causes a second automatic paid attempt; it becomes `submission_uncertain`, preserving its reservation and audit history. Known task IDs can still be polled. Operator reconciliation with the provider is required for unknown submissions, and no retry endpoint bypasses that rule.

Browser advancement and background execution have a165-second shared deadline inside a180-second Vercel function. Provider requests and downloads leave20 seconds for persistence and signed responses; the reference POST is bounded by120 seconds. Each invocation performs one moderation, submission or known-task poll/completion step. There is no unawaited background launch and no reliance on process memory or a writable filesystem. Client requests should allow190 seconds. Closing the page does not prove a request was cancelled: an accepted provider submission remains reserved and the lease recovery protects against duplicates.

The SQL layer limits active leases to2, anonymous cookie owners to2 jobs/day, the whole project to24 jobs/day, and reserved storage to1GiB. The cookie is server-signed, Secure, HttpOnly and SameSite Strict. Clearing cookies can evade the owner limit; the global durable budget/job/storage caps remain the no-login backstop. Public deployments should set their actual spend caps and appropriate platform abuse controls before enabling creation. Signed input uploads have a6MiB bucket file limit and cannot overwrite an existing object; generated storage is a separate100MiB private bucket. Reservation covers the worst-case6MiB for each declared image plus100MiB output. Output files are independently validated and bounded.

Prepared but unfinalized jobs expire after2 hours. Finalized gifts expire7 days after finalization. Retention waits an additional2 hours to let late signed upload capabilities expire. It refunds provider reservations only for positively unsubmitted `awaiting_upload` jobs with no stages. Other commitments, including uncertainty, remain conservative. It deletes only exact gift input/generated paths and verifies both bucket prefixes are empty before releasing storage. Dedupe, quotas, task history and reservation tombstones remain. These retention periods must be disclosed in the creator's privacy copy; this implementation does not promise permanent gift links.

## Vercel preparation

The staged `vercel.json` keeps the existing build, headers and authenticated API limits, adds180/180/60-second cloud handlers, and adds two daily cron entries. It does not schedule the old `api/tick` recipe. Daily cron is a plan-compatible fallback, and open-page advancement provides interactive progress. Daily cron alone can take several days to complete all stages; background completion within minutes requires a plan supporting minute schedules or a trusted scheduler. For Pro/Enterprise, change only the tick schedule to `* * * * *` after choosing that plan; retention can remain daily.

The official Vercel limits are4.5MB for a function request or response and, with Fluid compute,300 seconds maximum on Hobby. This implementation uses signed storage URLs and bounded metadata responses. Waiting for network I/O still consumes provisioned memory time even where it does not count as active CPU. Check Fluid compute, actual target plan and function duration before deployment. [Vercel Functions limits](https://vercel.com/docs/functions/limitations)

Hobby cron is once per day with hour-level timing precision; more frequent schedules fail deployment. Pro/Enterprise support minute intervals. A cron invokes a billable function within the plan's limits. [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)

Supabase signed upload URLs last2 hours and upload without further authentication. The server creates them for one immutable path in a private bucket. The service role key bypasses RLS and must remain server-only. [Signed uploads](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

`docs/cloud-environment.example` lists only names/placeholders. Set values separately for the chosen Preview/Production target. Keep `ENABLE_GENERATION=false` for the old localhost pipeline and `ENABLE_CLOUD_GENERATION=false` during review. Do not expose service role/provider/moderation/cron/dedupe secrets through Vite public variables or copy any local job directories. The existing `.vercelignore` excludes `.local-giftportals`, evidence outputs, `.env` files and tests. The deployed examples remain readable with cloud creation disabled.

## Validation and remaining activation work

Offline validation completed:45 cloud service/HTTP/SQL/retention tests passed, and strict server TypeScript checked10 new cloud files without errors. Tests use injected repositories, actual byte signatures and mocked fetch only; no paid requests or external writes occur. Core walking tests separately passed23/23. In addition, 15 behavioral checks executed the exact repaired migration in isolated PostgreSQL 18.3 WASM (PGlite 0.5.8), including effective grants/RLS, quotas, durable transitions, duplicate leases, uncertain submission recovery and retention. The test exposed and repaired a PL/pgSQL variable/column ambiguity in lease recovery. Single-connection local tests do not establish real Supabase Storage, PostgREST or multi-connection contention behavior. The complete application suite passed 671 tests, client/server TypeScript and production build. See V27-SQL-VALIDATION.md.

After the user validates the local result and authorizes the target setup, apply `supabase/migrations/002_cloud_instant.sql` to an isolated target and execute its live ACL/concurrency/fault tests. Configure and independently validate the actual moderation model using ordinary, blocked, ambiguous and derivative inputs. Choose retention/privacy terms, the scheduler and explicit spend/storage caps. Confirm actual private bucket settings and signed PUT/read behavior with harmless fixtures before any generation. Keep generation off until that validation passes.

Then verify the preview anonymously: all three real examples, Paris approved walking assets, every jury-facing image/video/download and the gift route. Confirm wrong capabilities, cross-origin writes and unauthenticated worker/retention calls are denied; status and job GETs must never submit tasks. Inspect deployment artifacts for local/private files and credentials without printing secret values. Only after those checks should cloud generation be deliberately enabled with the chosen caps. Publication remains a separate user approval.

```sh
node --test api/tests/cloud-instant-service.test.mjs api/tests/cloud-instant-http.test.mjs api/tests/cloud-instant-retention.test.mjs api/tests/cloud-instant-sql.test.mjs
node api/tests/cloud-instant-typecheck.mjs
node tools/cloud-preflight.mjs
```
