# GiftPortals V11 — a clearer, livelier gift experience

Historical local prototype evidence from October 2, 2026. The current October 5
version 11 preview has a different scope and replaces the normal chapter
experience; see [current preview evidence](VERSION-11-PREVIEW.md).

The local journey still starts with a photo or an example, before account creation. V11 addresses the five visual and interaction issues observed in the recorded demo.

| Feedback | Implemented experience |
| --- | --- |
| Story balloons overlap. | Small numbered story pins replace permanent wide labels. Deterministic screen packing keeps pins apart and reserves space for the keepsake dock and open story card. Hover or keyboard focus reveals a title only when it fits. All chapters remain accessible through **Stories**. |
| Movement buttons take too long to understand. | A compact **Keepsake / World / Stories** toolbar uses cube, globe and book icons. Rotation, looking, zooming and movement have distinct SVG controls, accessible names and tooltips. The selected view and enabled walking mode use an amber highlight. |
| Generation feels slow. | The waiting screen keeps the original photo in a constellation and lets the user tap **Send a spark** to add little lights. Once Tripo finishes, the actual keepsake can be rotated while World Labs continues. Both real provider stages report their own state; the playful lights do not imply generation progress. |
| The object view is uniformly blue, and the bamboo object looks distorted. | The keepsake gallery uses a warm background derived from the source photo, a separate atmospheric copy panel and a clearer initial viewing angle. Photo intent now separates an **object** from a **place**. A place photo becomes a framed keepsake for Tripo while its original image goes to World Labs. |
| The world needs a stronger connection to the gift, movement and activity. | A source-photo keepsake dock returns to the actual 3D gift. The real World Labs spatial scene includes readable story points, subtle moving lights and optional bounded walking over its collision mesh. One GPU viewer runs at a time. |

## Bamboo diagnosis and corrected run

The earlier bamboo photograph showed an entire environment but was routed to Tripo as if it were a single isolated object. The returned GLB treated trees and ground as one sculpted object. This was an input-purpose mismatch, not evidence that the environment was faithfully reconstructed.

The corrected place run, `646fa5cb-f492-46a3-9411-2d0e78172ef4`, completed both provider outputs and consumed **60 Tripo credits and 1,580 World Labs credits**. The framed Tripo result still distorted some bamboo shapes and colors. The final app composition therefore uses that actual Tripo GLB as shallow frame geometry, with depth capped at `0.14` scene units, and places the preserved original photograph on its front plane. This composition keeps the photograph legible; it does not claim that Tripo recreated the original image exactly.

The world remains the provider's actual **500k SPZ** output. Walking becomes available only after its real collision mesh yields a valid floor, and stays near the reconstructed starting area. A per-mesh BVH accelerates floor queries without modifying global Three.js prototypes. Story points are authored narrative positions. The moving lights are code-generated ambient effects, with reduced-motion support; they are not animated characters returned by World Labs.

## Executed validation

- **190 tests passed**, covering existing flows plus marker packing, photo routing, viewer lifecycle, walking and collision navigation.
- Frontend and server TypeScript checks passed. The production build completed in **25.91 seconds**.
- Browser checks at **1120 × 740** and **390 × 844** exercised the Rio gift, story navigation, the corrected bamboo keepsake and world, and walking. The observed view had one active canvas and no horizontal overflow.
- The corrected paid job remains in protected local storage. Its capability and provider credentials are not included here. This evidence concerns the local preview; it does not establish public deployment or hackathon submission.

## Visual evidence

[Waiting experience](../outputs/v11/waiting-desktop.png) · [Bamboo keepsake](../outputs/v11/bamboo-keepsake-desktop.png) · [Bamboo world](../outputs/v11/bamboo-world-desktop.png) · [Bamboo walking](../outputs/v11/bamboo-walk-desktop.png) · [Rio on mobile](../outputs/v11/rio-world-mobile.png)

![Corrected bamboo keepsake](../outputs/v11/bamboo-keepsake-desktop.png)

![Bamboo spatial world and walking controls](../outputs/v11/bamboo-walk-desktop.png)
