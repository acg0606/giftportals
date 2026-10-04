# Photo to a little world

The primary creator journey starts with a gift photo. An account is not required to try the local MVP. A user can take a photo on a supported mobile device, select a file, or choose an original example image. After adding a place description and an optional place photo, one explicit action creates a Tripo keepsake and its World Labs environment.

## Journey

1. Home → Make your gift.
2. Take or choose a gift photo, or choose Rio at dusk / the neighborhood bird.
3. Describe the place inside. Optionally add a place reference and personal note.
4. Confirm the images can be used with Tripo and World Labs, then select Make my little world.
5. Watch the actual object and world job states. Completed assets are downloaded and checked before the gift can open.
6. Open the actual Tripo GLB, rotate or zoom, then step into its World Labs SPZ scene.
7. Look around, make small bounded viewing movements, and reveal narrative points. Return to the keepsake or create another gift.

The world is an artistic interpretation. Small viewing movements do not imply collision-aware walking or a surveyed reconstruction. Story points are authored narrative positions; they are not detected landmarks or geographic coordinates.

## Local live preview

Run `./tools/start-instant-preview.ps1 -UseProtectedVault` to start the authorized local preview on port 4325 with the existing protected provider keys. The launcher decrypts those existing entries into the child process only, does not print them, and restores its process environment when the server ends. An ordinary unconfigured preview exposes the examples and explains that live creation is unavailable.

`api/instant` is a local MVP endpoint. Host, socket and Origin checks restrict it to loopback. This is separate from the existing authenticated cloud backend. Public anonymous generation will require deployed persistent quotas and abuse controls; this change does not deploy or enable public provider spending.

Each creation has a separate random capability token. Photos and provider results persist in the ignored `.local-giftportals/` directory. Browser storage keeps a job capability for resuming; it does not store the original photos. Local links work on this machine while its preview runs. The bundled Rio example uses fictional content and cached completed outputs so reopening it does not create another provider job.

## Generation behavior

- Tripo H3.1 converts the selected object image into textured GLB with PBR materials, detailed geometry/textures and a bounded face count.
- World Labs Marble 1.1 creates a standard spatial world using the place image when provided, or the place description otherwise. The viewer selects the completed 500k SPZ output when available, with the 100k output as a fallback; selecting higher detail reuses the completed operation.
- Every new job checks current provider balance before submission. Local reservations and a World Labs balance cushion bound this build's credit use.
- A durable submission intention and idempotent request capability prevent duplicate paid starts. Uncertain submissions are retained for inspection; provider tasks are polled by their existing IDs.
- Each viewer has bounded asset size, loading timeout, error recovery, reduced-motion support and teardown when its route closes.

## Evidence

The live Rio run completed both assets. Its [provider receipt](V10_GENERATION_RECEIPT.json) and [executed validation](V10_VALIDATION.md) record settled credits, settings, hashes and real browser checks. A job ticket alone is not a completed asset, a local preview is not a public deployment, and this change does not create a hackathon submission receipt.

## Official API references

- [Tripo image to model](https://developers.tripo3d.ai/en/docs/generation-image-to-model), [H3.1 settings and pricing](https://developers.tripo3d.ai/en/models/v3-1).
- [World Labs world generation](https://docs.worldlabs.ai/api/reference/worlds/generate), [pricing](https://docs.worldlabs.ai/api/pricing).
