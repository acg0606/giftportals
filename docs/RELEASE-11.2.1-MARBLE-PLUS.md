# Release 11.2.1 — Marble Plus for new cloud gifts

New creations through the deployed creator explicitly request
`marble-1.1-plus`. The photographic V12 prompt and Tripo recipes are unchanged.
The current curated Plus worlds remain in place; Paris and older gifts retain
their original worlds. Publishing this configuration creates no provider job.

For the creator's text and single non-panorama image inputs, World Labs lists
Plus at **1,580–3,080 credits**, compared with **1,580** for Marble 1.1.
Plus principally extends world coverage; it cannot verify unseen geometry from
one photograph. Overlapping views or a real panorama provide stronger evidence.
Sources: [models](https://docs.worldlabs.ai/api/models),
[pricing](https://docs.worldlabs.ai/api/pricing),
[Marble model guide](https://docs.worldlabs.ai/marble/models).

Before each new paid submission, the worker checks the provider balance against
the effective accepted model's maximum: **3,080 for Plus**, **1,580 for legacy
models**. This is a per-request affordability check, not a global spending cap.
The database records the same model-specific reservation for new jobs and
explicit retries. Previously stored reservations and committed totals are not
rewritten. Ledger totals are not represented as the provider's available balance.

Lost prepare responses reuse the accepted model and exact recipe across a
release. Plus retries retain Plus; older jobs keep their existing Marble 1.0
recovery policy. A new retry requires explicit creator action and a freshly
confirmed provider failure. Unknown submission outcomes cannot trigger another
paid request. Completed Tripo outputs are retained.

Rollout applies the compatible SQL functions first, preserving legacy status
metadata at 1,580 while the old application is serving. After the Plus application
is ready, status metadata moves to 3,080. During the transition, the prepare RPC
already chooses the correct reservation from each accepted recipe. The new
status reader accepts both known metadata values.

The separate legacy local/studio workflows are unchanged. This release changes
the cloud creator used by the deployed application.

## Validation

The complete Node test suite, focused Plus SQL contracts, frontend TypeScript,
strict server TypeScript and production build passed. Local PostgreSQL/PGlite
checks covered all baseline migrations, legacy reservations and retry receipts,
new Plus accounting, rollback fixtures, migration reapplication and RPC ACLs.
An independent review found no blocking issue. Production read-only checks
confirmed model-specific RPCs, unchanged old reservation/retry digests, unchanged
committed totals and server-only permissions. Existing security advisor findings
are unchanged.

The CLI-created migration filename was aligned with the authoritative version
recorded by the production migration service: `20261005225515`.
