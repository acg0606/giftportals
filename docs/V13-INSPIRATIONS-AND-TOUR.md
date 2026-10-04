# GiftPortals V13 — inspiration collection and guided worlds

The creator now offers five cities and five objects of human ingenuity. All ten have local original artwork, an editable setting/story, a matching object/place input route, and a reviewed primary-source curiosity. The bird example is removed. The Cities and Human ingenuity rails have visible counts and previous/next controls.

City presets: Rio de Janeiro, Paris, Kyoto, New York and Cairo/Giza. Object presets: an Antikythera-inspired mechanism, an astrolabe, Voyager Golden Record, Apollo return capsule and an early movable-type press. These are artistic references, not verified photographs or authentic artifact replicas.

The source and prompt directions are recorded in [V13-ASSET-REFERENCES.md](V13-ASSET-REFERENCES.md). The built-in image generation tool created the selected artwork; final files are in `public/assets/examples/v13/`. Rio preserves the previously approved panorama. Antikythera additionally uses a separate observatory reference for World Labs.

## Explore without generating again

- Local creator: `http://127.0.0.1:4325/#/make`
- Paris: `http://127.0.0.1:4325/#/generated/paris-example`
- Antikythera: `http://127.0.0.1:4325/#/generated/antikythera-example`
- Existing Rio: `http://127.0.0.1:4325/#/generated/rio-example`

The selected ready reference exposes **Explore this gift**. These three links load completed cached real provider output and make no generation request. The other seven references can start an editable new gift; they do not yet have completed cached worlds.

Run `tools/start-instant-preview.ps1 -UseProtectedVault` for live local creation. If new showcase files are copied under the ignored `public/demo` folder while Vite is running, restart after active jobs have completed so Vite refreshes its static-file inventory.

The protected local launcher caps accumulated generation reservations at 15,000 World Labs credits and 1,500 Tripo credits. The final status readback reported creation available, with 5,600 World Labs and 1,140 Tripo credits remaining inside those local caps. These are local reservations, not provider account balances; they allow three further gifts at the current reservation sizes. Invalid cap configuration fails closed.

## Actual sponsored runs

| Purpose | Job | Tripo credits | World Labs credits | Result |
| --- | --- | ---: | ---: | --- |
| First Antikythera text-world comparison | `a9d1addf-9a62-47bd-ae83-cc2da1e61e07` | 60 | 1,580 | Completed; kept privately as the simpler comparison. |
| Paris scene + framed keepsake | `6a642467-ab0f-4a83-a415-03c5e5f8e4e2` | 60 | 1,580 | Completed real GLB, 500k SPZ, panorama and collider. |
| Antikythera + visual observatory reference | `ccc15706-9cb2-48a7-8a0e-be14ca7ec2e2` | 60 | 1,580 | Completed real GLB, 500k SPZ, panorama and collider. |

This iteration spent 180 Tripo credits and 4,740 World Labs credits. Authenticated balance reads at 2026-10-02 01:40 UTC reported 24,605 Tripo and 37,370 World Labs remaining. No credit purchase, refill or public deployment occurred.

`tools/cache-instant-example.mjs <job-id> <paris|antikythera>` exports only matching completed showcases, verifies every asset SHA256 and size, and excludes capabilities, credentials and private job state. Readbacks are in `outputs/v13/paris-generation-receipt.json` and `antikythera-generation-receipt.json`.

## Guided experience

After the actual World Labs scene renders, **Guided tour** starts a gentle local camera journey through personal chapters and selected historical context. It includes the gift thumbnail, captions, cited source links, Pause, Resume, Next chapter, Replay and Exit. Manual controls interrupt it. Reduced motion uses still chapters. Walking is available only when the actual collider has a usable floor.

This is a short tour of an artistic environment. Authored story anchors are not detected landmarks. It does not provide a flight over a surveyed whole city, animated NPCs, or navigation through unreconstructed regions. The camera remains within the documented local bounds. Runtime details: `outputs/v13/tour-notes.md`; sponsor prompt settings: [V13-SPONSOR-ENVIRONMENTS.md](V13-SPONSOR-ENVIRONMENTS.md).

## Safety and validation

Every supplied original, framed derivative and world reference is screened before saving, uploading or spending. Policy 2 fixes batch-dependent quantized text embeddings and adds broad ordinary scientific/scene categories. Thresholds, explicit sensitive categories and fail-closed behavior are preserved. All ten originals passed the actual CPU classifier; the adult-product negative remained blocked. Actual Paris and Antikythera creation receipts prove their actual submitted variants passed.

The full suite passed 249 tests, and both frontend and strict API TypeScript checks passed. Production build passed. Browser checks covered the ten-reference catalog, opening cached Paris from its creator link, real GLB and SPZ rendering, tour pause/chapters/replay, manual interruption and collider-limited walking. Browser screenshots and receipts live under `outputs/v13/`. Browser validation is separate from the mocked renderer tests. Physical notebook camera capture and GPS hardware success were not retested in this iteration. Responsive DOM checks passed, but mobile screenshot capture was unreliable; the saved visual evidence is desktop only.

The local preview is reviewable; this is not a public deployment or hackathon submission.
