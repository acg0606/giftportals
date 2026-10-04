# GiftPortals — Aurora independent validation

Status: **LOCAL VALIDATION PASSED; CLOUD RELEASE GATES REMAIN OPEN**. Final review: September 30, 2026, 11:39 UTC. A passing local test is not a deployed cloud result.

## Scope and baseline

The user's 24-section Aurora brief requests an implemented, tested improvement to the existing product. The saved baseline is `giftportals-tripothon@4dee676ababfef33901646488a183fb165432dd1`; the improvement branch is `giftportals-aurora`. The baseline has 39 passing offline regressions. Existing product materials remain English.

The audit covers the first gift, original/object/place exploration, authorized collection and atlas, memory train, creation recovery, keyboard operation, and mobile reflow. Code review and browser observations are recorded separately. No provider generation, coupon redemption, portal mutation, deployment, or new external message is part of this validation.

## Constraints that remain release gates

| Requirement | Validation boundary |
| --- | --- |
| Retain the immersive postcard, discovery atlas and short memory train. | A gift's original media and story remain available independently of optional 3D. Train skip/replay, user-initiated audio and reduced motion remain available. |
| Receiving a gift never establishes a physical visit. | Physical, memory and wish states remain separate. Parent aggregation follows only the visited descendant path and is recalculated. |
| Preserve sourced geography. | Santos remains a separate municipality, Perdizes/Jabaquara are districts and Paulista is a corridor. Schematic nodes are not represented as surveyed administrative borders. |
| Preserve permission scopes. | Anonymous public fixtures are fictional and read-only. Private owners, recipients and gift links retain their existing scope. Read access and explicit claim capability remain separate. Revocation and identity changes fail closed. |
| Preserve originals, consent and finite resources. | AI processing stays opt-in; generation and sharing remain separate actions. Existing storage, credit, deduplication and retry limits remain enforced server-side. |
| Describe actual provider use accurately. | Existing Tripo GLB and World Labs SPZ/panorama are retained with provenance and artistic labels. Original photos are not silently replaced by an interpretation. |
| Preserve access without spatial rendering. | Photo/story and panorama alternatives remain usable if WebGL, motion, audio permission or an asset load is unavailable. |
| Separate local readiness from external success. | Cloud persistence, storage ACLs, scheduler continuation, deployment and submission require their own readbacks. |

## Source findings and revision checks

The baseline source exposed three concrete journey failures: opening the environment removed the object canvas while its controls remained; fixed personal-world pins could name unrelated memories or navigate an empty account to an empty ID; and creation accepted oversized audio before saving a draft, then ignored changed fields on a partial-save retry. The revision resolves these with reversible gift/place modes, collection-derived pins and a validated, explicitly locked saved draft. Recorder completion is awaited; route/account guards discard stale recording results. The bounded upload transport cancels on identity change and times out after 60 seconds.

Actual browser testing also caught two issues that injected tests missed. Native browser animation-frame methods needed their global receiver; the default driver now preserves it and has a regression. In a train without narration, the disabled sound button incorrectly formed the Tab boundary. The trap now excludes disabled/hidden controls and recovers outside focus. Actual forward and reverse Tab stayed inside the dialog after the fix.

Additional checks target bounded scene loading, retry/cancellation, one active rendering context, keyboard controls, reduced motion, authorized source links and truthful cloud-unavailable states. Product comprehension is a design hypothesis until actual users are observed; no conversion, retention or judge-score gain is claimed.

## Current official rule check

The public [Tripothon S1 event page](https://developers.tripo3d.ai/en/events/tripothon-s1) was read again on September 30, 2026. It continues to specify one direction, up to three optional tool tracks and one to three team members. Selected tool tracks require actual use. A usable demo, walkthrough recording and visual board remain required. Creativity, completeness and theme fit account for 75% of direction scoring; inventive use, synergy and contribution account for 80% of tool scoring. These facts support improving the usable gift journey rather than adding a headset requirement.

The existing authenticated submission checkpoint records October 5, 2026, 23:59 AoE, equivalent to October 6, 08:59 BRT. This audit does not reauthenticate the portal. The prior draft is not a submission receipt. The detailed rules/source audit and submission checkpoint remain the authority for release paperwork.

## Results

| Check | Result |
| --- | --- |
| All offline regressions | Root's final execution: **68 passed, 0 failed**: 14 map, 9 session/upload, 6 demo UUID, 13 backend, 14 viewer, 7 original-media preflight and 5 train-focus tests. |
| Independent focused rerun | **26 passed, 0 failed** against final source: 14 viewer, 7 media preflight and 5 train focus. Actual source is transpiled and exercised with deterministic frames, synthetic streams and real server upload rules; no live network. |
| Frontend build/type check | Root's final `pnpm build`: **PASS**, 24 modules. |
| Backend type check | Root's strict server check: **PASS**. Backend source is unchanged in this increment. |
| Actual local object/place flow | **PASS** on desktop and mobile: real GLB, real SPZ, gift → place → gift returns to a ready view with one canvas. |
| Controlled local failure/recovery | Root's browser: blocked model → original/story fallback → unblock/retry → ready, one canvas and no recovery panel. Slow load → home leaves no canvas/recovery and the correct title. Network/cache conditions restored. |
| Keyboard/mobile checks | **PASS for tested flow**: Enter opens the gift; revealed title receives focus; canvas and tab arrow controls work; train Tab/Shift+Tab stays inside and Escape exits; atlas Enter zoom focuses its heading. No document overflow at the tested size. |
| Reduced-motion train | Root's final actual browser: reduced journey label, fragment animation `none`, transition `0s`; replay and skip work. Media conditions restored. |
| Cloud storage/RLS/owner-recipient-outsider integration | **NOT EXECUTED** — cloud setup still requires the user's account steps. |
| Persistent cross-device collection and closed-browser worker | **NOT EXECUTED**. |
| Public HTTPS deployment and final submission | **NOT CONFIRMED**. |

## Remaining judging risks

1. A publicly usable final build with verified private cloud behavior is still a release gap.
2. The first minute must show the meaning of the gift and actual tool contribution with minimal detours.
3. Spatial loading must fail usefully on slower or unsupported devices; broader low-power hardware testing remains outstanding.

This review cannot establish WCAG conformance, cloud security, production reliability or successful submission from screenshots or local tests alone.

## Current browser evidence

The independent mobile run used CSS viewport **390 × 844**; browser-produced JPEGs are **375 × 812**. Document scroll width was 375, with no horizontal document overflow. The breadcrumb strip scrolls intentionally. Gift controls measured 47 × 51 px, place controls 100 × 44 px and bottom navigation height 44.39 px. The four map legend colors measured 5.73:1, 5.36:1, 4.81:1 and 4.95:1 against their computed background. This is a focused contrast check, not a full accessibility certification.

Nine accepted JPEGs were saved and opened locally in the current run, under `outputs/giftportals-aurora/screenshots/mobile/`: home, gift arrival, object, initial place, explored place, train, atlas legend, district states and gifting explanation. A stale image immediately following navigation was rejected and replaced. The train focus-only correction does not change the accepted visual.

The atlas visibly retains Perdizes as visited, Jabaquara unvisited and Paulista as a curated corridor. France/Paris discoveries remain separate from physical visits. World pins use authorized memory titles. The creation explanation truthfully says private creation is unavailable and shows a completed example rather than a disabled sign-in form. Its dialog scrolls within the mobile viewport; no private inputs or uploads were used in this audit.

The SPZ initial view faces a close wall and the explored scene remains soft/painterly. Its artistic label is essential. Broader low-power hardware, assistive-technology and poor-network testing remain outstanding. The lazy Spark module still produces the known approximately 4.93 MB build warning. No new provider generation was performed.

Cloud memory/upload POSTs do not yet provide end-to-end idempotency when their responses are lost. Current quotas and three-hour cleanup bound outstanding upload reservations. The revised UI can retain a known saved draft and recover a known upload; that is narrower than a claim that every offline retry is fully idempotent. Production integration testing must include ambiguous-save and ambiguous-upload outcomes.
