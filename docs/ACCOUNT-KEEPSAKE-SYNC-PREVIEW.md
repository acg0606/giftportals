# Account keepsake sync experiment

Branch: `codex/account-keepsake-sync`. This experiment is disabled in production.

Sign in on the preview, open **Sync collection**, and paste a complete unexpired GiftPortals gift link. Open the same preview on another device and sign in to the same account: the saved gift appears on the memory desk. Links copied from the actual viewer may include `view=world`, `view=object` or `from=room`.

Saving an existing link is explicit. The device import action also requires an explicit click. A new creator delivery can save automatically under its captured signed-in identity when generation is available. Opening a recipient link or hydrating the desk does not silently import anything or start generation.

The existing seven-day file lifetime stays unchanged. Sync saves references; it does not create a permanent archive, transfer creator ownership, or grant generation/retry permissions. The preview uses a new private bucket, `gp-keepsake-sync-preview-20261005`, and a new Edge Function, `gp-keepsake-sync-preview-20261005`. Existing production buckets, job rows, provider credentials, budgets and deployment remain unchanged. Auth uses the existing project and verified personal sessions; two clearly fictional accounts are used for testing.

Each saved reference is encrypted with AES-256-GCM, with account and job identity bound to the ciphertext. Only the server accesses the private bucket. Every personal request verifies the Supabase session. The Vercel relay requires an exact preview origin, fixed endpoint, explicit methods/actions and private server authentication. The Edge wrapper denies provider work and memory mutations. Secret substitutions are prepared only in ignored local output; credentials are never committed.

The preview cannot read production browser storage because browser storage is scoped by origin. Copy a full private gift link from the production gift on the phone and paste it into the preview. After a future approved production rollout, the explicit device import can adopt the existing references from that same production origin.

Account references are bounded at 100. Expired references are hidden; their encrypted records remain until removed. Failed cloud saves leave device references available. Sign-out clears the local account cache while preserving the cloud collection. A blocked browser store still permits the account response to hydrate the desk in memory.

The preview deliberately disables paid generation. Use existing gift links to test the storage correction; the submitted production creator keeps its existing behavior. A labeled fictional fixture uses existing public Rio artwork for actual Auth/Storage tests without adding a production job or buying new assets. Its capability is kept outside Git and expires after one day.

Validation includes account switching and logout races, explicit imports, token/expiry verification, encrypted-record tampering, two-account isolation, offline fallback, blocked browser storage and read-only hydration. Production promotion requires a separate review and the owner's test approval.
