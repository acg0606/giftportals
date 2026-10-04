# GiftPortals — Aurora product direction

This increment applies the user's Aurora brief to the existing GiftPortals app. It preserves the saved review baseline on `giftportals-tripothon` at `4dee676ababfef33901646488a183fb165432dd1` and develops targeted improvements on `giftportals-aurora`.

## Product in one sentence

A traveler keeps a physical souvenir and sends someone its photo, story and explorable 3D memory as a gift.

The first useful moment is opening the gift and understanding who shared it, what the physical keepsake means, and how to explore its object and artistic place. The map and train continue that same story; they should be discoverable from the gift rather than feel like separate demonstrations.

## Constraints preserved

| Classification | Constraint |
| --- | --- |
| Hard — user brief | All interface and project-facing materials stay in English. |
| Hard — product brief | Preserve the explorable gift, hierarchical discovery atlas and 8–12 second memory train with skip, replay, reduced motion and appropriate audio controls. |
| Hard — selected tool awards | Preserve actual Tripo image/model and World Labs environment contributions, with provenance and clear artistic interpretation labels. |
| Hard — trust | Anonymous fixtures are fictional and precomputed. Personal data requires its original permission scope. Read and claim are separate; revocation, hidden location and session changes retain their protections. |
| Hard — geography | Receiving a gift is not a physical visit. Parent color never makes every child visited. São Paulo, Santos, Perdizes, Jabaquara and the Paulista corridor retain their correct categories. |
| Hard — acceptance | Cloud persistence, private storage and background jobs need actual deployment and integration receipts. Source and local tests do not establish cloud operation or successful submission. |
| Hard — delivery | A usable demo, 1–2 minute recording, three or more real high-resolution images and prior-work disclosure remain release gates. |
| Soft | The placement of controls, poetic wording, illustration arrangement and separate object/place panels can change to improve clarity. |
| Hypothesis | A clearer first gift, coherent continuation and reliable viewer should improve comprehension. No conversion, retention or judge-score improvement is claimed without measurement. |

## Observed priorities and decisions

1. **High impact — connect the core journey.** The landing offers an anonymous gift, but the next actions are scattered across the homepage, persona buttons and atlas. Use an explicit sender/recipient context, a clear primary action and contextual continuation from gift to place, atlas and train. Explain creation honestly when private cloud accounts are unavailable.
2. **Critical — recover the 3D gift when changing scenes.** Opening the environment disposes the object renderer and leaves its original panel blank. Use one viewer with gift/place modes, remount the selected scene and dispose the previous scene. Preserve photo/panorama fallbacks, loading feedback, cancellation and retry.
3. **High impact — prevent wasted or lost input.** The creation review lacks a complete story/media/location summary. MediaRecorder completion is asynchronous; submission must wait for its final data. Validate audio's actual 4 MiB bound before saving, retain partial work and keep private save, generation and explicit sharing distinct.
4. **High impact — remove phantom personal content.** Fixed world pins can mislabel actual memories or navigate an empty account to an empty ID. Derive pins from the authorized collection and provide a useful empty state.
5. **High impact — improve reliability and comfort.** Avoid duplicate route rendering and catch lazy-module failures. Pause rendering when a scene is hidden, cap pixel density, track the active pointer and retain safe reset/look controls. Spatial navigation must not imply verified geometry, collision detection or metric scale.

These decisions improve comprehension and the usable core loop. The branch does not introduce a headset requirement, forced XR, additional generation providers or a large architectural rewrite.

## Verification plan and remaining release risks

Keep the 39 baseline regressions passing. Add meaningful regressions for the new state/media/navigation helpers where needed. Exercise the actual GLB and SPZ, switch modes repeatedly, test fallback/retry and return navigation, and inspect mobile overflow, keyboard controls and reduced motion. Record source/build/browser results separately from cloud-only checks.

Three remaining risks can still undermine judging: unavailable public cloud delivery, an unclear first-minute demonstration, and slow or fragile spatial loading. This increment addresses the latter two locally. Deployment, hosted ACL/storage/scheduler execution, the user's account steps, team full name and final submission receipt remain outstanding release work.
