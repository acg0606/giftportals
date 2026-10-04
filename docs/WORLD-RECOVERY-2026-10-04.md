# World generation recovery — 2026-10-04

This note records the implemented recovery controls and the evidence available for release **10.2.2**. Both affected gifts have completed their backend world recovery and rendered their actual recovered media in the product viewer through local inspection pages. Production publication of the release remains pending at this checkpoint.

## Implemented behavior

The World Labs media upload now sends the verified image MIME as `Content-Type` when the provider does not require that header. Header-name comparison is case-insensitive. A provider-required header keeps its exact spelling and value, so an upload signature is not replaced or duplicated. This repairs a concrete transport gap; the subsequent failures do not establish missing MIME as their cause.

New cloud jobs now pin the full `marble-1.0` model, and an explicit public world retry selects that full model through a separate override. This choice follows successful controls with the retained scene photographs and full prompts. Image, prompt, panorama and recaption settings are preserved; the draft model is not the default. Previously accepted job recipes remain immutable, and their ordinary submission still follows the stored recipe. An interrupted prepare that crosses the new-model release can recover the existing 1.1 job only after the database rechecks the exact original declarations, input hash and creator identity. That compatibility path cannot create a replacement gift for changed inputs.

An explicit **Try world again** action requests only the failed world. The server requires both the gift capability and the signed creator cookie, the approved origin, and the gift's existing unexpired access. A recipient who only has a gift link cannot authorize this spending. Public requests cannot supply a new image, prompt, model or provider setting.

Before a new attempt, the server reads the recorded operation and requires positive evidence of a terminal failure: `done:true`, a nonempty error object and no successful response. The sanitized proof identifies that same recorded task. The database compares it to the current failed stage under a transaction lock. This also protects older jobs that could have been marked failed when an unfinished operation returned an empty error placeholder. A pending `done:false` response with `error:{}` now remains pending.

One stable retry key identifies one explicit attempt. A repeated key recovers the current job without resetting its stage, reserving credits again or submitting another paid task. A different key is denied while work or an uncertain submission remains active. Paid POSTs with an unknown outcome are still preserved for reconciliation; they are not automatically replayed. Opening a collection or reading a gift remains separate from advancing generation.

The retry preserves the accepted input declarations and their hashes, the original recipe, photo, story, completed Tripo reference/model, existing assets and original expiry. Previous World Labs stages remain in the private audit history. That history stores sanitized diagnostics, selected recipe controls and a recipe hash, without retaining a copy of the personal prompt. Worker updates cannot modify the accepted retry controls.

Each new explicit world attempt adds a 1,580-credit reservation to both the job reservation and aggregate accounting. Previous reservations remain recorded; unknown costs are not reported as zero or refunded without evidence. Fresh provider affordability checks still precede submission. These records are accounting and duplicate-spending protection, not an application daily or lifetime spending quota. No artificial creation quota was reintroduced, and no payment method, credit purchase or billing setting was changed.

## Verification at this checkpoint

| Check | Recorded result | Scope |
| --- | --- | --- |
| Earlier complete application suite | 947/947 passed | Complete suite recorded before the final recovery refinements; it is not a receipt for an untested later revision. |
| Focused HTTP, upload, service, retry-route and diagnostics suite | 95/95 passed | Offline fixtures before the final default-model refinement; no provider generation from these tests. |
| Strict server TypeScript | Passed | Includes the six-argument retry RPC binding and stored model controls. |
| Earlier production Vite build | Passed | Build evidence only; no deployment or rendering claim. |
| Final complete suite for release 10.2.2 | 952/952 passed | Zero failures, cancellations or skips; includes the model-default and compatibility refinements. |
| Final strict server TypeScript and production build | Passed | The final Vite build completed in 54.19 seconds; existing large-chunk advisories remain. |
| Production recovery migration | Applied | Execution was confirmed by the task's database validation; no private database identifiers are included here. |
| Executed transactional SQL checks | Passed | Covers recovery behavior with rollback fixtures, ownership, dedupe, accounting and state protection. |
| Patch whitespace check | Passed | `git diff --check`. |

HTTP and adapter tests cover PNG/JPEG MIME fallback, preservation of signed headers, stored recipe selection, provider response envelopes, pending empty errors, refusal routing and the forwarding of both authorities and terminal proof. Errors expose only bounded provider codes, recognized request identifiers and fixed metadata. Private provider messages, images, prompts, capability URLs and credentials are not written to application logs.

## Real provider controls

These controls started real provider work under the user's authorization. They are distinct from offline tests. Exact private inputs, operation identifiers, provider URLs and account identifiers are excluded.

| Control | Outcome at this checkpoint | Interpretation |
| --- | --- | --- |
| Simple text, `marble-1.1` | Terminal provider error 500 | A small text request can fail without an image upload. |
| Retained Kyoto scene image, full stored prompt, explicit MIME, `marble-1.1` | Terminal provider error 500 | Explicit MIME alone did not resolve this control. |
| Kyoto scene image, recaption or shorter-prompt controls, `marble-1.1` | Terminal provider error 500 | These changes did not establish a working 1.1 recipe. |
| Same simple text, `marble-1.1-plus` | Terminal provider error 500 | Plus did not resolve that text control. |
| Simple text, full `marble-1.0` | Completed; provider-reported cost 1,580 credits | Demonstrates a completed full-model text generation. It does not establish photo-world success or visual quality. |
| Draft text control | Completed; provider-reported cost 230 credits | Diagnostic evidence only. The draft model is not the recovery default. |
| Retained Kyoto scene image, full prompt, explicit MIME, full `marble-1.0` | Completed; provider-reported cost 1,580 credits | The existing gift completed through its normal worker and private storage flow. Visual QA remains separate. |
| Retained São Paulo scene image, full prompt, explicit MIME, full `marble-1.0` | Completed; provider-reported cost 1,580 credits | The existing gift completed through its normal worker and private storage flow. Visual QA remains separate. |

Both photo recoveries reached `completed` on their existing gifts. The normal worker downloaded, validated and stored an actual 500k SPZ of approximately 8 MB, a PNG panorama and a GLB collision mesh for each. Independent readback matched the retained original input, generated reference and Tripo model hashes, and confirmed that the original expiry was unchanged. No new Tripo generation or replacement original photograph was required.

The controls establish a working full-model alternative for these two inputs and support investigating a provider/model-specific failure. They do not prove the underlying provider defect, establish an outage across all users, show equal quality between model versions, or certify the generated geometry for walking. Backend completion and verified stored outputs are distinct from seeing the recovered worlds render in the product.

## Outstanding evidence and support

The two full-model photo controls and their backend gift recovery are complete. The final complete suite, strict server TypeScript and production build passed. Both worlds rendered their actual recovered 500k media in the product viewer using loopback-only inspection pages and read-only signed assets. Their preserved Tripo keepsakes loaded. Kyoto Walk mode initialized with its stored collision mesh; São Paulo exposed Walk availability after loading. This inspection is separate from publication of the full application and does not assert physical VR or general walking quality. Production deployment is tracked by the task's final publication receipt. The completed souvenirs, original inputs, story and original expiry remain preserved.

A sanitized support report has been prepared. **No support message has been sent.** Any eventual contact should use the necessary private tracing evidence through the approved support channel; this public note contains none of those identifiers or personal inputs.

Official contract references: [signed media upload](https://docs.worldlabs.ai/api/reference/media-assets/prepare-upload), [generation examples](https://docs.worldlabs.ai/api/world-generation-examples), [operation polling](https://docs.worldlabs.ai/api/reference/operations/get), [pricing](https://docs.worldlabs.ai/api/pricing), and [errors and troubleshooting](https://docs.worldlabs.ai/api/errors).
