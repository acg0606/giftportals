# Ordinary pier photo screening

The reported lake-and-pier photo incorrectly received an uncertain decision under policy 2. Actual offline inference reproduced it: the trained sensitive-image detector scored 0.000129, while the closed-set CLIP adult-product comparisons summed to 0.105245, above the independent review threshold of 0.08. Its available ordinary comparisons lacked a matching wooden pier or open-water setting.

Policy 3 adds three generic comparisons for piers and jetties, calm water and sunset skies, and weathered wooden bridges or boardwalks. They apply to any matching photo, with no image-hash or example exemption. All sensitive decision thresholds and the independent trained detector remain unchanged. Block and uncertain results still prevent saving or sponsor generation. Object-category selection cannot approve an image.

Model-weight identity is now separate from the current policy identity. Existing manifests for the same pinned weights remain usable offline, with the same byte-size checks and full SHA-256 verification on worker startup. Every new screening report carries policy 3. No model download or dependency installation was needed. The local preview and resident worker were restarted after confirming there were no processing jobs; existing completed gifts and partial jobs were preserved.

## Evidence

Actual offline smoke covers the original reported photo, four in-memory resize/reencode/mirror/crop variants, the ten catalog inspirations, four product-photo negative cases and one product-on-landscape stress case. All ordinary cases were allowed. The four product-photo cases were blocked. The conspicuous product photo placed against a landscape remained uncertain, so creation stays closed. The original stress expectation was strict block; its measured review outcome is preserved in `local-vision-smoke-initial.json`. The final check treats both block and review as a closed gate, with the review result explicitly retained rather than called a confident product detection.

The running local API approved the exact reported file with policy 3 and blocked the actual product fixture. Two triage requests created no new data directory and no paid task. In the browser, the reported file was selected as a place, local analysis identified a landscape, and Review opened with `image_2.jpg`, an empty error message and the create action enabled. Consent remained unchecked and Make my little world was never clicked. The user's original browser form was left untouched.

Evidence is in `outputs/v19/`: before/proposed scores, 20-case real-model smoke, local API reports, browser screenshots, test/typecheck logs and build output. The original supplied image is not copied into public assets or modified. QA variants existed only in memory.

The complete suite passed **335/335 tests**. Frontend and strict API TypeScript checks passed, and the production build completed. No browser console errors were recorded during the positive flow.

## Repeating the checks

From the app directory with its existing local runtime and models:

```powershell
node tools/local-vision-worker.mjs --probe
node outputs/v19/local-vision-smoke.mjs
node outputs/v19/verify-local-api.mjs
node --test tests/*.test.mjs api/tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types node api/giftportals.ts api/tick.ts api/instant.ts api/story-audio.ts
node node_modules/vite/bin/vite.js build
```

This is a local regression check, not a moderation benchmark. CLIP scores depend on the comparison bank; arbitrary category additions need new negative checks. Small adult products near the edge of a wide image and other unseen inputs are not established as covered by this change. A future fixed safety comparison bank and bounded additional views need separate measurement. No deploy, submission or paid generation is part of this revision.
