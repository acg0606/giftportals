# Hackathon resources and production budget

Verified on September 30, 2026 before this build: Tripo API had 25,000 available credits and zero frozen; World Labs API had 47,000 credits. Existing keys named `tripothon-codex` are protected outside the source checkout. TapNow's official OAuth MCP responds successfully; its Tapies balance is unverified. Jupiter SR is an invitation subject to organizer approval and hardware delivery, not a provisioned device.

## Actual use ledger

The earlier Memory Studio demonstration used a fictional bird and neighborhood, with its preserved receipt in [`GENERATION_RECEIPT.json`](GENERATION_RECEIPT.json). The V10 main journey now uses both providers for one coherent Rio gift: detailed Tripo image-to-model generation and a World Labs Marble 1.1 spatial world based on the approved place image and description. These are real generated assets from fictional artwork, not a personal travel record.

The completed V10 job `f141908a-0779-4323-ad0d-72351eab0334` settled **60 Tripo credits** and **1,500 World Labs credits**. Its reservations were 100 and 1,580 respectively; reservations are not settled consumption. Tripo uses H3.1 with detailed geometry, detailed PBR textures and a 30,000-face limit. World Labs uses the standard `marble-1.1` model with an image reference. Provider IDs, settings and independently verified file hashes are in [`V10_GENERATION_RECEIPT.json`](V10_GENERATION_RECEIPT.json).

The Rio world now uses the existing **500,000-splat SPZ output**. Improving from the initial 100k output reused the same completed World Labs operation through GET and download, with **zero additional generation requests or generation credits**. The original 98,304-splat file and its hash are preserved for comparison. The 500k file is 8,138,477 bytes; the application's 25 MiB asset limit remains in force.

Fresh authenticated balance GETs on October 1, 2026 at approximately 15:35 UTC returned **24,905 Tripo credits available, zero frozen**, and **45,270 World Labs credits remaining**. Compared with the fresh 15:13 UTC baseline of 24,965 and 46,770, the decreases match the V10 settled costs exactly. These are account balances; they do not establish the source or redemption status of a particular hackathon grant.

## Cloud budgets

The anonymous localhost MVP can start generation through an explicit create action, with existing provider credentials kept server-side. The route checks localhost host, peer and browser origin, persists a capability and duplicate guard, and records submission intention before any paid generation POST. It mirrors completed assets behind capability-protected routes. No login is required for this local creation flow.

The default local build caps are **1,500 Tripo credits** and **10,000 World Labs credits**. The protected preview launcher now sets **15,000 World Labs credits** to leave room for further explicit user tests after the controlled demo runs; Tripo remains at **1,500**. `LOCAL_WORLDLABS_CREDIT_CAP` and `LOCAL_TRIPO_CREDIT_CAP` accept positive integers up to hard maxima of **20,000** and **3,000**, respectively. Invalid configured values disable readiness with an error. Status reports committed credits, remaining local credits and the next reservation, and does not advertise generation readiness when the local budget or queue is exhausted. No more than two gifts can be active, and a **1,000-credit World Labs cushion** is checked against fresh account credits before submission. Unknown or ambiguous submissions retain their reservation and are never automatically replaced by a new paid task. Polling and asset-quality upgrades reuse known task or operation IDs. Changing a cap never starts a generation, purchases credits or changes an external account limit.

Public cloud generation remains dependent on properly configured cloud secrets, persistent transactional quotas and a scheduler. Shared fictional cloud-demo accounts remain read-only. This local success does not establish a deployed public generation service. No purchase, paid-plan change, auto-refill change or additional-credit redemption was performed by V10.

## Sources

- [Tripo current API](https://developers.tripo3d.ai/en/docs), [pricing](https://developers.tripo3d.ai/en/pricing).
- [World Labs generation](https://docs.worldlabs.ai/api/reference/worlds/generate), [pricing and overage](https://docs.worldlabs.ai/api/pricing).
- [TapNow official MCP](https://docs.tapnow.ai/en/docs/mcp/add-a-custom-connector).
- [Tripothon](https://developers.tripo3d.ai/en/events/tripothon-s1).

These credits are account resources, not a promise of permanent free hosting. Free cloud plan limits and inactivity pauses must be recorded in the deployment receipt.
