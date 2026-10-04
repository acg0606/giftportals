# V23 Paris chapter operator

This controlled experiment generates three independent artistic Paris environments: an Eiffel approach, an elevated observation gallery, and a Seine farewell. They share original art direction. They are not a surveyed, geometrically connected city. Camera animation and chapter transitions are authored by GiftPortals; static World Labs splats do not make boats, water, or characters move by themselves.

## Text manifest

Use one distinct trial ID per intentionally requested generation. V22 image manifests remain compatible, including their existing deduplication fingerprints.

```json
{
  "inputMode": "text",
  "trialId": "paris-summit-v23-simple-20261003",
  "title": "Paris | Eiffel summit",
  "textPrompt": "Original English description of the local elevated scene and visible foreground geometry...",
  "baseline": {
    "worldId": "EXISTING_BASELINE_WORLD_ID",
    "label": "Previous Paris scene"
  },
  "provenance": "Original artistic text direction for a separately generated elevated Paris chapter."
}
```

`textPrompt` must contain 40–2,000 characters. Omit `images`; nonempty image inputs are forbidden in text mode. The text prompt stays in private operator storage; public receipts contain its SHA-256 hash, not the prompt. No image moderation is falsely claimed for a text-only request. Original image mode still locally checks every image before reservation or upload.

## Spend and recovery

Marble 1.1 Plus text generation costs 1,580–3,080 credits according to the [official pricing](https://docs.worldlabs.ai/api/pricing). Each request reserves the full 3,080 maximum and checks a fresh account balance of at least 4,080 before the generation POST. The three intended chapters initially had a 9,240 maximum. The original summit operation and its first deliberate retry both returned terminal provider errors. Both failed records and their 3,080 reservations remain preserved because billing is unknown: 6,160 held credits altogether. A final simplified summit prompt has a third distinct summit trial ID. Five attempts therefore require a 15,400 maximum reservation; this is not a statement of actual billed cost. The original direction is preserved in `outputs/v23/paris-direction-initial.json`, together with both original manifests. The generation POST uses `world_prompt.type: "text"`, the Plus model, and private provider permission, following the [official generation example](https://docs.worldlabs.ai/api/world-generation-examples).

The protected wrapper temporarily supplies keys through the existing vault mechanism and restores the process environment afterward. Its ordinary default remains 15,000; the explicit 33,000 operator cap covers existing commitments plus the five attempts, including both failed holds. The conservative maximum total is 32,580 credits: 17,180 prior commitments plus 15,400 new reservations. Wrapper/operator caps up to 35,000 are supported. This does not raise the ordinary creator's cap.

```powershell
& ./tools/run-quality-trial.ps1 -Kind world -Action create `
  -ConfirmProviderSpend -UseProtectedVault -WorldLabsCreditCap 33000 `
  -ToolArguments @('--manifest','outputs/v23/summit-manifest.json','--output-version','v23')

& ./tools/run-quality-trial.ps1 -Kind world -Action poll `
  -TrialId 'paris-summit-v23-simple-20261003' -UseProtectedVault -WorldLabsCreditCap 33000 `
  -ToolArguments @('--output-version','v23','--include-100k','--include-full-res')
```

Only `create` can make a generation POST. `poll` performs known-operation GETs and asset downloads. An ambiguous POST is preserved and never retried. A terminal provider failure remains recorded; a deliberately authorized new attempt needs a new trial ID. Unknown billing retains the maximum reservation and is never reported as zero.

## Resolution downloads

The 500k spatial model and panorama are required; the collision mesh is downloaded when available. `--include-100k` obtains the same completed world's lighter splat representation for mobile. `--include-full-res` obtains its optional `full_res` representation through GET only, without a new paid generation or mesh export.

Full-resolution download is isolated from ordinary provider limits: allowlisted World Labs HTTPS origin, no redirects, a 60-second timeout, 50 MiB compressed limit, 256 MiB decompression limit, and 2.5 million maximum splats. A failed optional download leaves the completed 500k world available, with a sanitized failure code. Ordinary downloads retain their 25 MiB limit and existing splat ceilings. The viewer selects the appropriate asset; full detail is optional.

The approach world's full-resolution download exceeded the 50 MiB limit and was stopped with `GENERATED_ASSET_SIZE_LIMIT`. Its 500k scene and 100k mobile version remain available. Detailed is hidden for this chapter; the failure code is preserved and GPU/file limits are unchanged.

## Offline export

```powershell
& 'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' `
  tools/export-paris-flight.mjs
```

The exporter checks source file containment, byte sizes, SHA-256 hashes, GLB and image magic, SPZ headers and splat counts. It requires the exact original prompt in `outputs/v23/paris-direction.json` and a completed text job for each available chapter. Pending and failed chapters remain unavailable. The public manifest is written last, after the entire export is validated.

Outputs:

- `public/demo/v23/paris-flight.json`: public viewer configuration and actual local asset paths.
- `public/demo/v23/paris-{chapter}-*`: completed 500k, optional 100k/full-resolution, panorama, and optional collider.
- `outputs/v23/paris-flight-export.json`: sanitized hashes, sizes, resolution counts, and reported/unknown cost status.

Provider capability URLs, credentials, operation IDs, private job records, and private prompts are not published. Existing V13/V17/V22 assets are not modified by this exporter. It makes zero provider calls and does not deploy or submit anything.

An optional camera overlay lives in `outputs/v23/paris-flight-layout.json`:

```json
{
  "version": 1,
  "chapters": {
    "summit": {
      "initialPitch": -0.2,
      "route": {
        "arrival": [{"position": [-0.2, 0.1, 0.7], "target": [0, 0, -2], "fov": 72}, {"position": [0, 0, 0.4], "target": [0, 0, -2], "fov": 70}],
        "viewpoints": [{"pointId": "summit-story", "pose": {"position": [0.3, 0, 0], "target": [0, -0.2, -2], "fov": 66}}]
      }
    }
  }
}
```

These are bounded renderer coordinates, not GPS coordinates or calibrated meters. The exporter accepts a conservative subset of the viewer contract: two to six arrival poses, one to six unique viewpoints, FOV 56–76, bounded coordinates, and at least 0.3 separation between camera and target. Final routes need visual inspection of the actual generated geometry; a prompt alone does not prove a clear flight corridor.

## Focused verification

```powershell
& 'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' `
  --test api/tests/quality-trial-world.test.mjs api/tests/quality-trial-budget.test.mjs tests/paris-flight-export.test.mjs
```

The 36 focused tests cover V22 image regressions, text contract and pricing, no ambiguous retries, GET-only same-world extra resolutions, independent full-resolution limits, exact prompt provenance, hash/path rejection, unavailable chapters, bounded viewer-compatible camera overlays, preserved failed trial records, hidden failed full-resolution options, and unknown billing. All test provider traffic is stubbed or disabled; they are not live generation evidence.
