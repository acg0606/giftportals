# GiftPortals 10.3.1 — mobile walking correction

The mobile recording exposed a gap in the 10.3 validation: public Rio/Paris
examples had been checked, but the recovered personal park world and simultaneous
walking/looking gestures had not received the same visual check.

## Changes

- Derive the guided camera heading from a longer section of the audited route,
  rather than each 40 mm physics correction. The original collider still resolves
  all translated steps.
- Align the view before a large change of direction. Return turns have a
  deterministic direction; the camera does not move through the turn.
- Spend a bounded frame's movement budget across small collision steps, so a
  single waypoint does not slow walking on devices rendering fewer frames.
- Allow looking with a second touch while the first holds the movement pad.
  Release captured gestures on loss of focus, visibility, or viewer disposal.
- Pause the guided walk only after an actual drag; a stationary touch does not
  interrupt it. Give the movement hint enough space above the mobile toolbar.

## Verification

Regression coverage exercises real Three.js camera rotations, simultaneous touch
input, pointer cleanup, paused/resumed navigation, deterministic return turns,
and paths resolved by the actual Rio/Paris Rapier colliders. Local validation also
uses the recovered park world's original SPZ, panorama, collider, and provider
scale/ground offset, without creating another provider generation. In a fixed
60 fps software replay of that collider, chapter 2's 99th percentile camera yaw
change fell from 0.764 to 0.068 degrees per frame. Reversals above 0.1 degree fell
from 197 to zero. All 790 alignment frames had zero horizontal translation, and
the six chapters completed in about 136 seconds with the body returning within
0.021 scene units of arrival. This replay does not measure a phone's GPU frame
rate or the fidelity of the generated reconstruction.

All 997 tests passed, along with frontend/server TypeScript checks and the
production build. Browser mobile validation covers simultaneous pad/look input
and the recovered park scene with the current first-person shell.

Private media and access links remain outside Git. Production publication and
test receipts are recorded separately after validation.
