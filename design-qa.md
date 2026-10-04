# Daylight atelier — final design QA

**Findings**

No actionable P0/P1/P2 findings remain in the verified primary views. The selected light-oak/ivory direction, large real souvenir, serif heading, caption and cream/navy touch controls are implemented in the existing interactive collection.

**Comparison target and evidence**

- Source visual truth: [displayed concept 1](docs/daylight-desk/selected-concept.png), explicitly selected by the user. Original pixels: 853 × 1844.
- Implementation: anonymous `#/collection`, Rio first, details and controls collapsed. [Browser capture](docs/daylight-desk/mobile-390x844.png): 390 × 844.
- CSS viewport: 390 × 844. Source normalized in full without cropping. [Combined comparison](docs/daylight-desk/comparison.png): 780 × 844, source left / implementation right. This combined input was opened and inspected.
- Density test: emulated device DPR 3; backing canvas 712 × 1542 (effective DPR 1.83), CSS canvas 390 × 844. Browser screenshot output is normalized to CSS pixels. The source and implementation were therefore compared at the same 390 × 844 density.
- Focused combined comparisons were opened: [header](docs/daylight-desk/header-comparison.png), [souvenir and contact](docs/daylight-desk/hero-comparison.png). Matching crops use the same normalized full frames.
- Responsive evidence: [320 × 568](docs/daylight-desk/mobile-320x568.png), [360 × 640](docs/daylight-desk/mobile-360x640.png), [1024 × 800](docs/daylight-desk/desktop-1024.png), [1440 × 900](docs/daylight-desk/desktop-1440.png). These are separate responsive checks rather than identical source states.

**Required fidelity surfaces**

- Fonts/typography: Georgia display and Inter UI preserve the serif/sans hierarchy. Light heading/brand and the short line remain legible over the header contrast treatment. Public mobile heading remains one line. Caption and CTA do not truncate.
- Spacing/layout: header, heading, hero, lower caption and navigation follow the selected structure. Visible Rio base grew from approximately 155 to 200 CSS px against approximately 215 in the illustrated concept. Measured arrows are 48 × 48; primary action is 50–54 px high. All controls remain in view at 320 × 568.
- Colors/tokens: cream/navy controls, pale oak, ivory, greenery and daylight follow the reference. Removing the cream scrim restored wood texture. The small upper contrast treatment leaves the tabletop unobscured.
- Image quality/assets: actual World Labs SPZ supplies the room. Existing Tripo meshes retain geometry, materials and proportions. At phone density, plaque, boats, buildings and cable car are readable. Final GPU rendering has no triangular shadow gap. The reconstructed furniture and existing photograph differ from the concept illustration; these are expected asset constraints, not placeholders or flat substitutes.
- Copy/content: title, introductory line, gift caption and Open gift follow the reference. Secondary Desk controls preserves existing functionality. Current gift is announced politely; the accessible CTA name includes its title. No prompt instructions appear in product copy.

**Interactions, accessibility and runtime**

- Manual Next displayed Paris and updated caption; CTA was disabled during focus transition. Opening navigated to `#/generated/paris-example?from=room`; closing returned to collection.
- Gifts opened its list; selecting Rio focused it and exposed expandable Gift details. Intermediate-width details now sit above navigation.
- Keyboard ArrowRight displayed Paris. Zoom/reset and night/warm-light controls responded; secondary controls collapse. Automated checks cover playback, fast steps, repeated focus, expiration, late callbacks, pagination, reduced motion and Escape/focus behavior.
- Diagnostics: WorldLabs, 500000 points, ready, 3 models / 0 failures, 2 props / 0 failures, shadows ready. No horizontal overflow at 320 or 1440 px.
- Console reviewed: only an unrelated wallet extension attempted to redefine `ethereum`; no application or shader error observed.
- Mobile derivatives preserve non-image buffers and node/material structure byte for byte. All three loaded; originals remain for other views and print preparation.

**Comparison history and resolved findings**

1. [P1] Previous orange studio and [P2] small hero: iteration 1 combined comparison showed the old room and 155 px base. Replaced the room with full generated daylight assets, measured support and enlarged/calibrated mobile framing. Final full/focused comparisons show the selected palette and approximately 200 px base.
2. [P2] Cream scrim hid materials. Removing it exposed low-contrast navy text. Intermediate Paris capture was used for contrast diagnosis, not a matched Rio comparison. Light text and restrained upper contrast resolved this; final header comparison verifies it.
3. [P2] Zoom alone cropped the window. Larger physical bounds and mobile eye `[-0.05,-0.05,0.03]` restored the daylight view while preserving the hero. Final mobile and smaller-phone captures verify this.
4. [P2] Initial shadow had a triangular gap. Two omitted original collider faces were restored; local coverage became 504/504. Soft shadow near actual footprints removed the artifact. Final focused evidence shows no hole.
5. [P1] Initial 1024 px view exposed an unwanted generated object at right. Desktop FOV 30°, calibrated target and horizontal FOV limit 52° removed it from the primary wide framing. Final 1024/1440 captures verify the clear tabletop.
6. [P2] Detail panel overlapped navigation at intermediate widths; it now sits above the footer. [P2] Focused gift lacked an announcement and accessible CTA title; these now change only with the gift. Browser review and interaction tests verify both fixes.

**Follow-up polish and remaining limits**

- [P3] Explanatory line could grow from 12 to 13 px later; currently readable in checked views.
- The concept is more photographic than preserved sponsor meshes and reconstructed room. Exact mesh and photo proportions intentionally follow actual assets.
- Physical phone frame rate remains for user device validation. Desktop emulation is not hardware evidence. Existing headset and physical print limits remain.

**Implementation checklist**

- [x] Real room, sanitized provenance and measured support.
- [x] Mobile and desktop camera verified.
- [x] Actionable P0/P1/P2 findings fixed and recaptured.
- [x] Full and focused combined comparisons inspected.
- [x] Main interactions and console verified in browser.
- [x] Responsive layouts and phone-density canvas checked.

final result: passed
