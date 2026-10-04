# Deployment and operations

Target: Vercel HTTPS frontend/serverless API with Supabase hosted PostgreSQL, Auth and private Storage. Windows provides development only. The production app and job scheduler must function when the developer's browser and computer are disconnected.

## Setup order

1. Use the existing Vercel and Supabase accounts. Provision a dedicated GiftPortals project within an available free plan; do not upgrade or reuse unrelated private application data.
2. Apply the checked-in Supabase migrations and configure a private media bucket. Verify RLS and ownership policies.
3. Configure server secrets using the deployment platform's encrypted settings. Never place privileged secrets in Vite-prefixed variables or commit `.env`.
4. Seed two fictional users and three clearly labeled demo memories, including the actual completed Tripo asset and World Labs environment. Original demo media may be public; personal media remains private.
5. Deploy this folder, configure the production URL, then schedule the protected job tick in Supabase using pg_cron/pg_net and Vault. Verify a job completes after its initiating browser closes.
6. Validate public anonymous access, two-user persistence, revoked link denial, private collection denial, quotas, mobile layout and fallback behavior. Save deployment IDs, URLs, build logs and readback receipts.

## Required configuration

Server: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`; bounded-generation secrets `TRIPO_API_KEY`, `WORLD_LABS_API_KEY`. Fictional demo accounts use dedicated server-side demo credentials. Enable generation only after reserve/quotas and scheduler are verified. `.env.example` documents non-secret placeholders.

The Supabase public key is intended for client use, but the frontend primarily uses same-origin APIs. The service role bypasses RLS; every server action must independently authenticate and authorize its memory/gift/media scope before using it.

## Limits and recovery

Record actual hosting plan limits, project inactivity pauses, storage/file sizes and generation budgets in the deployment receipt. Free plans may pause or change limits. No permanent-free claim is made.

Provider requests are short asynchronous starts. Persistent jobs contain owner, provider, status, task ID, attempts, timestamps, result and sanitized error. Cloud polling does not depend on browser intervals. Expiring provider URLs are cached to authorized persistent storage. Object and environment failures are independent; original photo/story remain readable.

Never delete a provider task merely because a polling request fails. Use the existing task ID; manual reconciliation is required after an unknown start. Rotate exposed credentials and revoke leaked gift links through normal platform controls.

## Current checkpoint

The local review preview includes actual completed Tripo and World Labs assets. Vercel CLI authentication and Supabase sign-in still require the user's account step. A portal draft exists, but no production URL, cloud migration receipt, end-to-end persistence receipt or successful hackathon submission exists at this checkpoint. The review package records the checks actually executed; cloud-only acceptance checks remain pending.

Source: [Supabase hosted cron](https://supabase.com/docs/guides/cron), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net).
