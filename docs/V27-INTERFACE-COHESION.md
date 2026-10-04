# Painterly interface cohesion — V27

Staged only. The sole implementation file is `files/src/theme-painterly.css`; no canonical CSS, JavaScript, images, assets, accounts or deployment settings were changed.

## Integration

Copy the stylesheet to `src/theme-painterly.css` and add `import './theme-painterly.css';` after the current shared stylesheet imports in `src/main.ts`. The root agent owns that integration. Route/component prefixes give the overrides sufficient specificity when component styles load later. Remove that import to restore the prior styles.

The `--painterly-*` tokens are independent of the existing global `--ink`, `--paper`, `--dusk-*` and generated-gift/collection tokens. Native light form controls and root background are enabled only when an existing general page is present through `:has()`. Existing legacy Studio tokens are overridden only inside the matching legacy route main element.

## Scope

- Home: warm paper alongside the existing desktop illustration, coral primary action and cream navigation pill. Mobile keeps cream lettering over the actual darker illustration. No new artwork or image filter.
- Creator: photo/place/story/review, selected example cards, inputs, progress and error states, native dictation and curiosity panel. Camera chrome changes; camera pixels and letterboxing stay intact.
- Quality/references: paper/lilac/peach cards and buttons. Comparison images, crops, render pixels and reference canvas stay intact.
- About, missing/loading states, common header/footer and auth/account dialogs. All authentication availability and privacy wording remains controlled by the original code.
- Legacy Studio list/atlas/create/memory panels: paper surfaces around their existing 3D/map content. Their canvas, geographic scene and raw source media are not changed.
- First-person UI: cream controls/invitation and a warm light tablet journal. Book/newspaper retain their distinct physical styles. The scene canvas, sky, shade, reticle, camera/physics bounds and raw assets are not styled by this file. Small-screen action buttons use a compact grid beside the movement pad; all movement/action targets are at least 44px.

Excluded: `.collection-room`, `.generated-gift` and their artwork/layout are owned by other agents. This stylesheet declares no selectors for those components. No full-screen white veil, image color filter, new animation, private-state change or claim that an unconfigured service is available.

## Verification and limits

The actual Vite dependency's PostCSS parser accepted the stylesheet. Solid token text/background pairs were checked using the WCAG sRGB relative-luminance formula: ink at least 5.99:1, muted at least 4.66:1, accent at least 4.62:1 and focus at least 4.82:1 across cream/paper/peach/coral/mint/lilac. Input border versus cream is 3.79:1. These are calculated solid-color checks; they are not a certification of composited artwork, transparency or every existing state.

No CSS-mirroring tests were added. Real integrated browser QA belongs to the root agent: 390px portrait plus desktop, home, every wizard step, camera unavailable/permission/error, native dictation, comparison miniature/world, About, unavailable auth/account, original/partial/expired gift fallback, and all three walking scenes with each journal mode. Check `scrollWidth <= clientWidth` for the page, preserve the intentionally scrollable examples rail, inspect focus/disabled/selected/error states, and confirm movement pad/action buttons do not intersect at 390px. Check reduced-motion mode and a short landscape viewport.

## Copy/UX audit (read-only)

No new critical false availability/privacy claim was found in the inspected current code. The cloud creator's review already discloses seven-day retention and access for anyone holding the gift link; unavailable auth provides a truthful continue-without-account path; About distinguishes cloud features requiring separate deployment verification; complete-gift copy is gated on both usable provider assets. CSS preserves those gates and labels.

One minor follow-up for the root owner: `src/main.ts` still sets the browser `theme-color` meta value to dark teal/black for these routes. CSS cannot update that meta tag; a warm route-aware value would align mobile browser chrome with the new general screens while allowing immersive views to keep their own color.

## Audited baseline SHA-256

These are read-only original snapshots, not files edited by this task. Canonical project: `C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals`.

| Source | SHA-256 |
|---|---|
| `src/style.css` | `FE335E5CBFD08E9BBC4031A1FA975F41375DEFCF5525C9748B98D1605BD92AF1` |
| `src/studio.css` | `9632A262DDEE1DF051BCEAAD4E0B747E720EF7CA3C34098491AA3855E537E4FE` |
| `src/portal-dusk.css` | `C8068CE18FE7D235F7A51197601F8C914FBA07A20761BF21B17681D17FB21312` |
| `src/instant-creator.css` | `218C4830CB8C25031EA89F6212BE0AB7DED7FDC4A9B49799629F1974C19514D1` |
| `src/instant-camera.css` | `50753205974647C1CE2B0CA789EB9127D8DA6613D523DC839BA6F7EBA0A19B5E` |
| `src/story-audio.css` | `32815F355FD419B1123B94592036D2588A631EE56457164C51C279F5BC6DDD67` |
| `src/gift-curiosities.css` | `7D1B55D6E8C9A74307F278634F79F7F61B316D626976608B8CD1AE81C5030CCC` |
| `src/first-person-place.css` | `8F5D044990FCED438DBF8EADDAC17734F08F5842B8D8F8519E98BB8FD1942193` |
| `src/story-reader.css` | `34BD686AE75965078041EB40721CB98C1B0F2F01222F38447771999A9FF80828` |
| `src/quality-comparison.css` | `B0945E7278BC7BEA184AC04A09D291DA2F58A30A79FAEEE51C83C35F8CAF15AD` |
| `src/quality-reference-capture.css` | `9A16526F2E77DDDA989230DFB57C7D5AC21FDA9561E11CE73DC7E41DFE6B1030` |
| `src/instant-shell.css` | `3716977583619315B74C17A53388A637CC08EE5B7567DE230B806F47E3B31D3E` |
| `src/gift-transformation.css` | `B9E382CFBBF0A768608FE3BB44C609337506A6A33202F269EA3B5E38DB16B2B9` |
| `src/gift-transformation-preview.css` | `02416F572673F116BB9BEC6CA3CDE460D029C87BC6C71219E2AEFAAB6EA8F450` |
