# GiftPortals v5 — Memory Studio design reference

The v5 redesign turns GiftPortals into a focused memory studio: an object is the visual entry point, its atmosphere and author’s words give it meaning, and the recipient assembles a session keepsake before continuing to the atlas. The public interface and project materials remain in English.

## Observed reference

The current Tripo public website was captured on September 30, 2026 at desktop and mobile sizes. Its visible public presentation uses a dark neutral background, large bold sans-serif headings, model-centered composition, restrained borders and a bright yellow primary action. These are the reference principles used for v5.

The Tripo Studio entry and workspace were also opened. A personalization onboarding overlay obstructed the workspace. We did not complete onboarding, alter the account, inspect a full editing session or generate an asset. Consequently, this redesign does not claim a complete reproduction of Tripo Studio’s workflows or private design system.

The captured references are retained in the task’s `work/giftportals-v5/reference/` directory:

- `01-tripo-public-desktop.jpg`: the observed public desktop presentation.
- `04-tripo-public-mobile.jpg`: the observed public mobile presentation.
- `02-tripo-studio-desktop.jpg` and `03-tripo-workspace-desktop.jpg`: entry/onboarding evidence, with the workspace inspection limit stated above.
- `00-nexus-before-full.jpg`: the inspected previous GiftPortals presentation. The initial clipped `00-nexus-before.jpg` was rejected as comparison evidence.

## Original product direction

GiftPortals keeps its own name, GP mark, content, authorship and interaction model. Tripo’s logos, illustrations, example models and proprietary UI assets are not imported into the product. The reference changes the presentation hierarchy: a real inspectable object receives the main stage, controls sit next to the stage, and reference media remains visible alongside the interpretation.

The new shell uses charcoal panels, neutral typography, yellow primary actions and a compact studio navigation: Studio, My world, Atlas and Library. The object display uses neutral lighting and a grid/plinth setting. Wireframe makes the actual attached model’s geometry inspectable. Optional orbit is explicitly controlled, respects reduced motion and is capped at 30 rendered frames per second by the scene implementation. This is a cap, not a measured performance guarantee.

## Core behavior retained

The exploration loop remains object → place → story → assembled keepsake → same actor’s atlas → next authorized memory. Three explicit reveals are required. Keeping a memory records session exploration in RAM and resets on reload or a change of person/account. It does not claim a gift in the cloud, request generation or record a physical visit.

The completed Perdizes demo uses the existing Tripo GLB and World Labs SPZ. Its input image and people/story are fictional, and the input image was AI generated. The 3D object and atmosphere are artistic interpretations. The Paris and Santos fixtures have illustrations and stories rather than invented 3D assets. Their roles, location-sharing permissions and map history remain independent.

Provider generation remains a separate creator action behind the existing account, consent and allowance checks. The redesigned preview and viewer recovery load existing assets. No provider job is required to demonstrate this increment.

## Verification boundary

The source review checks session isolation, explicit progress, geography, permission boundaries and viewer lifecycle. Actual desktop/mobile interaction captures, build results and the full test count are recorded in the v5 validation deliverables after verification. Public reference captures alone do not establish implementation quality, accessibility conformance, cloud deployment or hackathon submission.
