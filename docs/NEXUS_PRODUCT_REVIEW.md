# GiftPortals — NEXUS v4 product direction

NEXUS develops one complete Memory Trail from the preserved v3 baseline `1dcd56b`. It keeps GiftPortals' explorable gift, discovery atlas and contemplative memory train together. This document records the approved product/state contract; final implementation and browser results belong in the validation report.

## Ten-second explanation

**GiftPortals turns a souvenir photo and a personal story into a little world someone you love can open.**

A traveler keeps the physical souvenir. A recipient explores its digital interpretation and the personal moment behind it. The first reveal should make that connection clear before showing a large world or a list of features.

## Audit: three highest-impact changes

1. **Give discovery a purpose.** The existing atlas has sourced places, but a marker and a working globe alone do not explain what to do next. Lead from a place to a currently authorized gift, then back to the same person's atlas and another available story.
2. **Make the transformation tangible.** Keep the reference image, actual Tripo object and personal dedication connected. One obvious interaction reveals why this object mattered. The World Labs place adds atmosphere to that same gift; it does not replace the object or imply documentary reconstruction.
3. **Close the loop with an honest keepsake.** A digital journal marks exploration of three memory fragments during the current session. It gives the recipient visible progress without creating a physical visit, claiming a gift or pretending to save a cloud collection.

## Core loop and state meaning

**Discover → explore → interact → keep a digital trace → travel → return to the atlas → next authorized story.**

The Memory Trail has three fragments: **object**, **place** and **story**. Each is revealed through an explicit user action. The approved engine events are `reveal-object`, `reveal-place` and `reveal-story`; `keep` is allowed only after all three. Completion describes a digital interaction, not proof that someone read everything, traveled or owns an object. Photo/text fallback must preserve a meaningful way to explore when WebGL is unavailable.

The reward is a **session digital keepsake**: this memory was digitally explored in this session. It does not create `DiscoveryDTO`, a physical visit, claimed-gift membership, an email delivery or a server save. Both public-demo and owner trails are session-only. Copy must say so where the keepsake is offered.

The atlas remains semantically separate: physical visits `●`, memories `◇`, wishes `☆`. A received Paris memory never marks physical travel; opening a catalog point or moving a camera never changes that history. A small session progress surface can make the world feel responsive without fictional live users, fabricated activity counts or invented territory coverage.

After keeping a trace, the 8–12 second memory train continues through authorized fragments and returns to their sources. It retains skip, replay, mute and reduced motion. The next trail story comes only from currently authorized, unkept memories. Published POI proximity can help choose it; no private coordinate, browser GPS or inferred location is needed. If another story is unavailable, offer replay or public geographic context rather than invent a permission or story.

## Priorities

| Priority | Deliverable | Purpose |
|---|---|---|
| Essential | One connected trail with object/place/story actions and a truthful session keepsake. | Makes discover → interaction → reward → progress complete. |
| Essential | Clear source image/object relationship and one real Tripo/World Labs encounter. | Gives the gift a tangible photo-to-digital payoff. |
| Essential | Current permission, identity and persona scope; accessible fallback and reduced motion. | Protects the existing private product and keeps the core path usable. |
| Essential | English walkthrough of the actual build, three real visuals and prior-work/provider attribution. | Provides a reviewable App entry. |
| Important | Visible next step, return to the same atlas and an available authorized story. | Makes the reward lead somewhere useful. |
| Important | Small responsive feedback, one spatial viewer, lazy loading and bounded scene cost. | Makes the world feel alive on modest hardware. |
| Nice | Optional QR/AR, elaborate badges, additional maps or more generated encounters. | Only consider after the verified core; these are outside this vertical. |

No leaderboard, forced GPS, headset requirement or new Game/XR track claim is needed to deliver this loop.

## Privacy and scope contract

Public-demo scope includes the fictional persona and identity epoch; owner scope includes the actor ID and epoch. Account, persona or scope changes reset all progress. The engine receives only current authorized owner memories or active recipient memberships. Public-demo content is limited to known fictional fixtures with their required sharing permissions.

Reconciliation discards progress when a source is revoked, archived, unavailable or its relevant content, location, consent or media identity changes. A signed URL expiring alone does not change content identity. The visible journal's progress is limited to object/place/story/kept booleans for authorized memory IDs. The engine additionally holds authorized story and location values in RAM-only semantic fingerprints to detect changes; these snapshots are never persisted or logged. Signed media URLs, their expiry and gift tokens are excluded from those fingerprints. Published place IDs come from the sourced globe catalog. Trail state cannot broaden the permission of a memory card or train fragment.

These are approved requirements while implementation proceeds. Source regressions and actual UI checks must verify them; this document alone does not establish enforcement or cloud operation.

## Actual providers, fiction and original IP

The existing completed demo uses **Tripo** for its fictional reference image and image-to-model result, and **World Labs** for its artistic place. These are the actual named Tool Track contributions. The source image was produced through Tripo text-to-image; it was not a photograph captured from a real physical souvenir. Demonstrate "fictional reference → actual Tripo 3D interpretation" and label completed precomputed assets. Do not say generation is happening live during a reveal or that generated scenery is a faithful reconstruction.

The product's physical-to-digital connection is the souvenir-photo-to-explorable-gift experience. Literal physical scanning would need an authorized real input and its own completed receipt. A new upload must never reuse the existing bird while implying it was generated from that upload. Provider failure always leaves the original photo/story available.

TapNow's connected MCP is not an asset contribution by itself. Do not claim another sponsor integration without an actual output. The original fictional people, stories and visual system stay distinct from third-party IP. Preserve God's Eye MIT source attribution, Cesium's independent notices, Natural Earth credit and visible OSM attribution. Do not import the upstream OSINT feeds or datasets.

## Feasibility and evidence

Keep the existing single object/place spatial viewer, dispose it on a switch and retain pixel-density/visibility limits. Keep the lightweight Story atlas as the first path and Cesium optional. The actual demo GLB is 2,246,912 bytes and its SPZ is 1,173,405 bytes; these are asset sizes, not measurements of browser/GPU memory. The 8 GB target still needs actual final route/retry testing and one-canvas cleanup checks. No frame-rate or broad device-performance result is claimed here.

The [official Tripothon S1 page](https://developers.tripo3d.ai/en/events/tripothon-s1), rechecked September 30, retains App, requires actual named-tool use and judges direction creativity, completeness and theme fit prominently. The new trail therefore deepens the gift rather than adding an unrelated feature list. [Current credits and prior-work declaration](CREDITS.md) remain required. Only the declared competition increment is presented for judging.

The existing audited App requirements remain a usable demo, a 1–2 minute walkthrough and three or more high-resolution screenshots/GIFs. The account portal previously confirmed October 5, 2026, 23:59 AoE / October 6, 08:59 BRT. NEXUS has not re-entered the portal, deployed a build or submitted an entry. Cloud ACL/session/recipient tests remain unexecuted pending configuration. Local source, tests and a recording must not be presented as those external receipts.

See [the NEXUS recording outline](NEXUS_DEMO_SCRIPT.md). The earlier Aurora script and validation history remain preserved.
