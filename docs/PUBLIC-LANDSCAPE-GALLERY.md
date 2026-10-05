# Public landscape gallery preview

This preview starts from the submitted production commit, `182f09fb474e5a845b744e8bca5cacec6aebb4f0`, on `codex/public-keepsake-gallery`. Production stays on the submitted release until the creator validates this preview.

When the public gallery feature is enabled, visitors can create a landscape without an account. The creator explicitly agrees to publish the generated landscape and its title. Completed, moderated creations become visible in a shared gallery. Gallery visitors do not need the creator's browser, device storage, account or private access token.

The public experience contains landscapes only. It projects the generated world, panorama, collider, title and selected place facts. Original uploaded photos, stories, personal names, dedications, object models, provider identifiers and private capabilities are excluded. Existing private jobs are not imported. Fresh creations will replace the owner's old examples by choice.

The standard generation pipeline is retained in this first stage. It can still generate an object internally, but the public landscape gallery never displays or archives it. Changes to rendering style and walking controls are a separate stage after the owner validates persistence.

## Storage and permissions

The gallery has a separate private storage bucket, `gp-instant-gallery`, and index table, `gp_instant_gallery`. Server-only claim and commit procedures recheck immutable, versioned consent and successful image moderation. They accept only canonical generated asset paths. Every copied asset is checked for its size and SHA-256 hash before the index becomes public.

Public archive objects are independent of the original private job's seven-day retention. Gallery responses issue one-hour signed media URLs; reloading the gallery refreshes them. Archive persistence does not mean that a signed URL remains valid forever.

Anonymous browsers cannot query the database table or storage bucket directly. They use read-only gallery HTTP endpoints. Those endpoints cannot publish a private job, enqueue generation or retry a provider call.

## Isolated deployment

The feature flag and provider relay apply only to the preview branch. The preview uses a dedicated authenticated Supabase Edge relay and the deployment's existing image moderation model. Its callback is restricted to the current Vercel preview. Paid actions require the private creator capability. It cannot advance old private jobs or run the shared queue.

The deployment packager reads protected local provider credentials and emits an ignored server payload outside the checkout. Credentials and temporary test capabilities must never be committed or included in this document.

## Validation

The automated checks cover consent, public projection, private path rejection, archive copies, duplicate lease handling, read-only routes, creator submission and collection recovery. The initial full suite passed 1,058 tests. Frontend and strict server TypeScript checks passed. The Vite build passed using its runner config loader to avoid a local sandbox directory restriction.

The migration was applied to the existing project. Read-only, rolled-back database assertions passed for consent, moderation, expiry, canonical manifests, grants, RLS and private bucket access. All nine pre-existing private jobs remained ineligible for publication. An independent wrapper probe rejected private-job finalize/advance/read actions before storage or provider calls. The deployed Edge function returned successful, enabled gallery and generation status responses.

The final owner-flow suite passed 155 affected frontend tests, and the backend suite passed 111. A later concurrent full-suite run found one existing print-test timing failure that passed independently; its three owner-flow fixture/loader failures were fixed and verified in the affected suite. The landscape-focused copy passed 64 wizard tests. The assistant's exact preview-origin/OIDC gates passed 22 tests and strict server typechecking.

## Live generation proof

On October 5, 2026, the mobile creator generated **Rio at dusk — shared landscape**, public ID `9210c4e8-f240-4321-9f40-a0e4eddb5b24`, from the original Rio catalog reference. Both declared images passed the deployed local vision policy through the protected preview callback. The standard generation completed and the landscape appeared automatically in a separate Chrome browser's public collection, with no app account or creator capability.

Three public API reads confirmed the gallery entry, direct landscape read and refreshed media URLs. The response excluded the deliberately supplied private story, dedication and sender/recipient markers. The separately archived SPZ (7,935,896 bytes), panorama (3,553,855 bytes) and collider (1,056,004 bytes) all downloaded successfully and matched the SHA-256 hashes in their archive filenames. The original nine private jobs were not imported.

The first validated preview deployment is `giftportals-92se12g1p-acg0606s-projects.vercel.app`, commit `3749057c93842321d2860182d253d157539cc9fb`. Its platform protection remains enabled; temporary access links and cookies stay outside this public document. Follow-up copy and assistant-origin changes reuse the same public archive rather than generating a replacement world.
