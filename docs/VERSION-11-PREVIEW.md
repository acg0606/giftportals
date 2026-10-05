# Version 11 pre-publication validation — October 5, 2026

Version 11 was prepared on `codex/version-11`, based on the submitted 10.3.3
commit `182f09fb474e5a845b744e8bca5cacec6aebb4f0`. This document records the
checks before publication at `giftportals.vercel.app`.

## Implemented behavior

New creations require a separate, unchecked public-publication consent.
The public archive preserves the original photograph, words, names, dedication
and delivered Tripo/World Labs assets. It copies and verifies asset hashes into
its own private storage bucket before committing public membership. Public
responses expose only the souvenir fields and newly signed media URLs, without
creator capabilities or private job metadata. The original private jobs and
their retention policy do not determine the archive's lifetime.

The shared memory desk reads the public archive, including subsequent pages.
No new account screen, private-gift import, artificial generation quota or
mock public gallery has been added. A completed or partial job can be public
when at least one real provider result and its original photograph have been
archived successfully. A failed archive remains pending rather than claiming
publication.

Entering a delivered world starts a 30-second arrival through the actual SPZ
and collider coverage. The camera descends and arcs toward the safe walking
position. It opens the memory newspaper automatically, with the source photo,
story, dedication and Tripo reference when available. Closing the newspaper
enables supported manual movement. Reduced-motion or unsupported geometry
opens the newspaper from a still world view. The normal entry contains no
chapters or required walking interaction.

Collider preparation has its own 45-second deadline. A timeout keeps the real
world visible, opens the newspaper and disables walking. Renewing the signed
address of the same immutable Tripo file keeps the creator's 3D preview open;
changing the actual model still replaces it.

World recipes preserve photographic structure, materials, daylight and
visible spatial relationships using Marble 1.1. Tripo recipes and approved
Paris/Rio miniature assets remain unchanged. The newly generated Paris world
was manually framed on a 390 × 844 phone viewport, facing the Eiffel Tower.
Its landmark is distant and small; centering does not add generated detail.
See [world generation receipts and source licenses](V11-WORLD-GENERATION.md).

## Executed verification

- Final suite: 1,106 tests passed; frontend/server TypeScript passed and the
  production Vite build passed. This includes signature renewal, bounded
  collider preparation and the low-clearance arrival route.
- Applied database migration: read-only assertions passed for RLS, grants,
  current consent, archive paths and exclusion of older private jobs.
- Supabase preview function: active, using encrypted Secrets through `Deno.env`.
  The real creator produced and publicly archived Rio with an approved source
  photo and immutable publication consent. Public reads require no creator
  token and return only the public contract. No provider credential is embedded
  in deployed source.
- Real mobile browser: unchanged Paris Tripo model rendered; the new world
  started automatically; the newspaper appeared at tour completion; closing
  it enabled exploration controls. Original photo and source attribution were
  visibly present in the newspaper. The calibrated deployment was also checked
  at the normal 1280 × 720 desktop viewport. Temporary phone overrides were reset.
- Paris camera calibration: actual 500k SPZ/collider and Rapier/BVH approved
  the 30-second route at yaw 0.339 and pitch 0.104. Camera height moves from
  3.53 to 1.11 scene units, finishing at the safe spawn. 66 focused viewer
  tests passed. Eight relay tests passed after removing an unused anonymous
  Supabase header; the separate relay authentication remains required.
- Creator/viewer tests preserve a completed world when Tripo fails, open it
  directly, and hide unavailable model/printing/VR actions. The world-only exit
  returns to the collection instead of repeating the arrival. Public gift copy
  distinguishes renewable media signatures from the durable public link.
- Rio's actual collider has a low foreground roof. A lower lateral arc keeps
  the same collision/bounds checks and completes 6.788 scene units in 30 seconds.
  All 1,800 additional trajectory samples were clear. Paris retains its exact
  previous route; a scene without any clear route still uses a still arrival.
- The World Labs panorama is aligned with the SPZ forward direction using a
  quarter turn in Three.js. A real-camera numerical test verifies the center
  image bearing, including custom yaw. The previous background sampled a side
  of the panorama behind the forward geometry; SPZ, collider and scene scale
  are unchanged by this correction.

The real Rio job `cbb27b09-92ea-41d9-a54a-e93b4438bd7a` completed and was
archived at 13:13 UTC. Both providers delivered actual results. The creator's
Open your gift action used `?public=1` without its private creator capability.
The public newspaper showed the original photograph, source/license, real Tripo
reference and the full reviewed story on a 390 × 844 phone viewport.

The GET-only `tools/download-v11-public-world.mjs` downloaded this actual public
world using a fresh gift response and its matching database receipt. Archive
paths, sizes, hashes and file formats passed. Its local export replaces the Rio
world while preserving the submitted Tripo assets. No further generation was
performed. The provider inferred a covered foreground interior absent from the
photo; this is documented in the generation receipt instead of claiming an exact
reconstruction.

Authenticated balance GETs at 13:16:28 UTC reported 23,800 Tripo credits and
1,100 World Labs credits. The Rio test consumed 60 and 1,580 respectively. The
remaining World Labs balance is below the 1,580-credit Marble 1.1 reservation;
existing public gifts remain available independently of new generation credits.

## Deployment configuration and final verification

The user explicitly authorized the branch-scoped Vercel internal keys and
production public-gallery flag on October 5, 2026. Both settings were saved:
the preview received two protected internal keys, and production received only
`ENABLE_PUBLIC_GALLERY=true`, using its existing protected credentials. Provider
keys remain in Supabase Secrets for the preview; no new provider credential was
sent to Vercel. Earlier rejected writes made no changes. The configured creator
was then exercised through its complete upload, moderation, generation and
archive workflow.

Production is built from main with its existing protected provider credentials;
the branch-only preview relay is not promoted as the production runtime. The
GET-only independent visitor verifier checks status, gallery membership, public
fields, actual archived bytes, hashes and renewed media signatures without app
cookies or creator capabilities. Final deployment state and mobile verification
are recorded with the published release result.
