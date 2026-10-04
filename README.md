# GiftPortals

Some gifts fit in your hand. Others take you to an entire world.

Release 10.2.0 of the memory gift app for Tripothon S1. Start with a photo, place and story to create a Tripo 3D keepsake and a World Labs world. Revisit completed keepsakes in an actual World Labs travel studio, open their memories and discover the sender's words. The new welcome uses TapNow artwork. Earlier postcard, map and memory-train experiences remain preserved. Demo people, journeys and stories are fictional.

## Build status

**Release 10.2.0** includes the reference-conditioned World Labs studio, completed Tripo keepsakes, TapNow visual direction, standard WebXR and print preparation. Physical PICO, HeyGears and Jupiter validation remain pending. Live creation uses private Supabase storage and the server's pinned image moderation models.

Production: [giftportals.vercel.app](https://giftportals.vercel.app). Source: [acg0606/giftportals](https://github.com/acg0606/giftportals). Current evidence and exact limits are recorded in the [sponsor audit](docs/V10-SPONSOR-AUDIT.md); publication does not constitute a hackathon submission receipt.

Release 10.2 automatically saves completed creator gifts to the desk and My Memories on the same browser device, opens the keepsake directly, focuses creation on photos of places, and adds a detailed OpenStreetMap place view with a local fallback. Editable photo and story suggestions use optional Vercel AI Gateway interpretation; nearby places and sourced details help the author confirm the setting. Device references expire with the private gift and remain separate for each account. See [10.2 validation](docs/V10_2-VALIDATION.md) for evidence and limits.

## Development

Node 22+, pnpm. Run `pnpm install`, `pnpm dev`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Frontend-only local previews use clearly marked precomputed demo content and report unavailable cloud actions honestly. Use a configured Vercel development/production runtime for server routes.

## Documentation

- [Release 10.0.0 sponsor and publication audit](docs/V10-SPONSOR-AUDIT.md): actual Tripo, World Labs and TapNow assets, XR/print boundaries, environment availability and payload inspection.
- [Release 10.0.0 art direction](docs/ART-DIRECTION-V10.md): current welcome and memory collection.
- [Credits and prior-work disclosure](docs/CREDITS.md), [architecture](docs/ARCHITECTURE.md) and [deployment](docs/DEPLOYMENT.md).
- [Historical documentation](docs/archives/README.md): preserved earlier increments, receipts, research and validation.

## Security

The anonymous Rio composer stores only an explicitly saved text draft in the current browser. Anyone using that browser profile can resume it. Its loopback preview link contains that text in the URL fragment and opens on the same device while the preview server runs. This local draft is separate from the private cloud controls below.

Original private cloud media is stored in a private bucket. Cloud writes and private reads require the route's authorized owner/recipient or scoped capability checks. Gift links are unpredictable and limited to one gift; account invitations and anonymous instant links use their respective revocation or expiry rules. Receiving a memory never records a physical visit. Privileged API keys stay server-side. The separately enabled loopback-only creator supports bounded live generation without an account and stores protected jobs in the ignored local directory; it does not enable public anonymous spending.

## Hackathon entry

App Direction Track, with Tripo and World Labs supported by actual generated assets. TapNow has a completed homepage image; any third Tool Track must match the event's eligibility rules and submitted evidence. PICO hardware, HeyGears Blueprint/printing and Jupiter device use remain unverified. Confirm current requirements on the [official Tripothon page](https://developers.tripo3d.ai/en/events/tripothon-s1), and disclose the prior scaffold and new GiftPortals work.
