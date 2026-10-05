# Version 11 preview — October 5, 2026

The preview is isolated on `codex/version-11`, based on the submitted 10.3.3
commit `182f09fb474e5a845b744e8bca5cacec6aebb4f0`. It has not been merged or
promoted to `giftportals.vercel.app`.

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

World recipes preserve photographic structure, materials, daylight and
visible spatial relationships using Marble 1.1. Tripo recipes and approved
Paris/Rio miniature assets remain unchanged. The newly generated Paris world
was manually framed on a 390 × 844 phone viewport, facing the Eiffel Tower.
Its landmark is distant and small; centering does not add generated detail.
See [world generation receipts and source licenses](V11-WORLD-GENERATION.md).

## Executed verification

- Full code suite: 1,086 tests passed; frontend/server TypeScript and Vite build passed.
- Applied database migration: read-only assertions passed for RLS, grants,
  current consent, archive paths and exclusion of older private jobs.
- Supabase preview function: active, using encrypted Secrets through `Deno.env`.
  An authenticated server GET returned the real, empty archive without making
  provider requests. No provider credential is embedded in deployed source.
- Real mobile browser: unchanged Paris Tripo model rendered; the new world
  started automatically; the newspaper appeared at tour completion; closing
  it enabled exploration controls. Original photo and source attribution were
  visibly present in the newspaper.
- Paris camera calibration: actual 500k SPZ/collider and Rapier/BVH approved
  the 30-second route at yaw 0.339 and pitch 0.104. Camera height moves from
  3.53 to 1.11 scene units, finishing at the safe spawn. 66 focused viewer
  tests passed. Eight relay tests passed after removing an unused anonymous
  Supabase header; the separate relay authentication remains required.

## Remaining before the complete preview is ready

The branch-scoped Vercel server connection is awaiting explicit authorization
to store two newly generated internal keys. Automatic approval review rejected
the earlier environment write because the existing authorization named Supabase,
not Vercel. No rejected environment write was completed.

The configured live creator must generate Rio once, then demonstrate committed
public archival and independent anonymous reading from another browser. That
world will also replace the static Rio example while preserving its original
Tripo model. Final phone/desktop verification and the final preview link follow
those checks. The feature is not yet claimed as end-to-end verified.
