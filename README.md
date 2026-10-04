# GiftPortals

Some gifts fit in your hand. Others take you to an entire world.

Release 10.0.0 of the memory gift app for Tripothon S1. Start with a photo, place and story to create a Tripo 3D keepsake and a World Labs world. Revisit completed keepsakes in an actual World Labs travel studio, open their memories and discover the sender's words. The new welcome uses TapNow artwork. Earlier postcard, map and memory-train experiences remain preserved. Demo people, journeys and stories are fictional.

## Build status

**Release 10.0.0** is prepared in the isolated release snapshot. The collection renders actual generated room assets and retains the completed Tripo keepsakes. Optional standard WebXR and print preparation are implemented; physical PICO, HeyGears and Jupiter validation remain pending. Live creation and private cloud features depend on configured server services.

Production URL: **pending deployment receipt**. A local preview or build is not a public deployment or hackathon submission receipt. Current evidence and exact limits are recorded in the [sponsor audit](docs/V10-SPONSOR-AUDIT.md).

## Development

Node 22+, pnpm. Run `pnpm install`, `pnpm dev`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Frontend-only local previews use clearly marked precomputed demo content and report unavailable cloud actions honestly. Use a configured Vercel development/production runtime for server routes.

## Documentation

- [Release 10.0.0 sponsor and publication audit](docs/V10-SPONSOR-AUDIT.md): actual Tripo, World Labs and TapNow assets, XR/print boundaries, environment availability and payload inspection.
- [Release 10.0.0 art direction](docs/ART-DIRECTION-V10.md): current welcome and memory collection.
- [Credits and prior-work disclosure](docs/CREDITS.md), [architecture](docs/ARCHITECTURE.md) and [deployment](docs/DEPLOYMENT.md).
- [Historical documentation](docs/archives/README.md): preserved earlier increments, receipts, research and validation.

## Security

The anonymous Rio composer stores only an explicitly saved text draft in the current browser. Anyone using that browser profile can resume it. Its loopback preview link contains that text in the URL fragment and opens on the same device while the preview server runs. This local draft is separate from the private cloud controls below.

Original private cloud media is stored in a private bucket. Every cloud write and private read needs an authenticated owner/recipient check. Cloud gift links are unpredictable, limited to one gift and revocable. Receiving a memory never records a physical visit. Privileged API keys stay server-side. The separately enabled loopback-only V10 creator supports bounded live generation without an account and stores its protected jobs in the ignored local directory; it does not enable public anonymous spending.

## Hackathon entry

App Direction Track, with Tripo and World Labs supported by actual generated assets. TapNow has a completed homepage image; any third Tool Track must match the event's eligibility rules and submitted evidence. PICO hardware, HeyGears Blueprint/printing and Jupiter device use remain unverified. Confirm current requirements on the [official Tripothon page](https://developers.tripo3d.ai/en/events/tripothon-s1), and disclose the prior scaffold and new GiftPortals work.
