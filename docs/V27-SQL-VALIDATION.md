# V27 executed SQL QA

**Result: repaired migration passed 15/15 executed behavioral checks in isolated PostgreSQL 18.3 WASM (PGlite 0.5.8).** This established local SQL behavior, not deployed Supabase readiness or actual Storage integration.

## Defect found and repaired

The original migration executed successfully, but both lease-expiry recovery tests raised PostgreSQL **42702: column reference "stages" is ambiguous**. `gp_instant_expire_leases` declared a local `stages` variable while assigning `UPDATE ... SET stages=stages`, which collided with the table column. This blocked crash-to-uncertain recovery and polling an independently known task after another submission became ambiguous.

Root repaired the staged migration by renaming that local variable and its references to `v_stages`. Both recovery tests now pass. No production migration or canonical source was changed by this QA agent.

| Snapshot | SHA256 | Result |
| --- | --- | --- |
| 002.original.sql | 01B54CDAA07ECDC2E244B98D354193207F8BD54EBA1BD6A13DBA30CC33E16167 | 13 pass, 2 runtime failures |
| 002.fixed.sql | 26D9AA9C9EA5A19D2AB668EE256B33431771BBB966FA0E0EFE2E13AE2016A10D | 15 pass, 0 failures |

The fixed snapshot matches the repaired staging source `cloud/files/supabase/migrations/002_cloud_instant.sql` tested here.

## What ran

- Executed the complete migration unchanged as database owner. Verified all 12 functions, five RLS-enabled tables, disabled initial spending caps and both private bucket rows.
- Executed browser-role denials against all five tables and a real RPC; inspected effective execution privileges for all 12 functions across anon/authenticated/service_role. Service RPCs are exposed only to service_role; three internal helpers are denied. Tested service read/credit-limit update and denial of reserved-credit, insert and delete mutations.
- Tested the restrictive storage-object policy against a deliberately permissive pre-existing stand-in policy. Dedicated input/generated objects remained hidden, inserts were denied and protected updates affected no rows; unrelated bucket access remained available.
- Executed prepare/finalize/get/lookup/claim/begin_submission/update/retention/purge. Checked atomic disabled-budget rejection; exact budget/storage/quota reservations; idempotent dedupe/finalize; wrong capability, changed inputs, wrong upload paths/hashes/bytes and invalid/null fields.
- Verified owner/global/storage/provider caps reject without leaked job or quota reservations. Tested lease bounds, two global lease slots, explicit job ID isolation and repeated same/other-worker claims leaving the first active lease/revision unchanged.
- Required matching photo moderation before paid intent, then checked durable submission, revision/lease CAS, immutable task/input/asset identities, nondecreasing progress, proper terminal assets and lease release. Both Tripo and World Labs stage contracts completed using local fixture identifiers and validated metadata; no provider request occurred.
- Executed expired-submitting conversion to submission_uncertain; prevented a new paid attempt; recovered a separately known processing task to partial completion without resetting the ambiguous stage.
- Executed derived-reference completion plus matching-image moderation gate before Tripo. Wrong moderation protocol/hash/category did not authorize submission.
- Verified two-hour retention grace, refund only with positive awaiting-upload/no-intent proof, preserved paid reservations, idempotent storage accounting purge and retained dedupe/quotas/history. After purging the input document, repeated prepare is safely denied with DEDUPE_MISMATCH before the expiry check; the generic error is acceptable and no reservation is created.

## Repeatable artifacts

`validate.mjs` creates a fresh in-memory database and local role/schema stand-ins each run. It reads no credentials. SQL snapshots, `results-original.json`, `run-original.log`, `results.json` and `run-fixed.log` retain the before/after evidence. Package manifest and pnpm lock pin the isolated runtime to **@electric-sql/pglite 0.5.8**. Installation disabled package scripts and used the public npm registry; dependencies/store stay within this writable validation folder. Canonical application dependencies were unchanged. [Official PGlite installation and Node usage](https://pglite.dev/docs/).

From this folder:

```powershell
node validate.mjs ./002.original.sql results-original.json | Tee-Object -FilePath ./run-original.log
node validate.mjs ./002.fixed.sql | Tee-Object -FilePath ./run-fixed.log
# Validate the current staged source instead of a sealed snapshot:
node validate.mjs
```

The original run is expected to exit 1 with the two demonstrated failures. The repaired run exits 0. Each JSON log includes the exact SQL SHA256, PostgreSQL version, individual checks and errors.

## Remaining practical limits

PGlite has a single exclusive database connection, so these tests do not establish multi-connection contention, deadlock behavior or SKIP LOCKED/advisory-lock race safety under parallel workers. PostgreSQL 18.3 is the local runtime; the target Supabase database version/configuration was not queried. Supabase roles, bucket rows and storage.objects are minimal local stand-ins, not the full managed storage/auth schema.

No Supabase/PostgREST RPC endpoint, Storage signed upload/read/delete, actual content verification, service deployment, provider submission, account permissions, worker scheduling or target migration application was tested. The migration's metadata checks validate path/hash/byte declarations; only the real server/storage flow can establish that those declarations match stored content. Storage deletion is intentionally outside this SQL harness; purge correctness assumes the caller performs the required deletion first.

Before cloud enablement, repeat the lifecycle and concurrency checks on a disposable real Supabase project and validate signed upload limits, dedicated-bucket policies, asset integrity, PostgREST service-role RPC calls and two-phase deletion. Spending remains disabled until a deliberate finite cap is configured.
