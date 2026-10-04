# Portal at dusk — executed validation

Date: October 1, 2026. Final local preview: `http://127.0.0.1:4324/#/home`.

## Checks

| Check | Observed result |
|---|---|
| Frontend TypeScript | Exit 0 |
| Server TypeScript, strict | Exit 0 |
| Existing automated suite, concurrency 2 | 135 passed, 0 failed |
| Final production build | Exit 0, 17.39 s |
| Final compiled browser console | 0 warnings/errors |
| Source/implementation visual QA | Passed; see project-root `design-qa.md` |

The build retains the existing warning about large optional globe/environment chunks. Those separate Studio routes were not rewritten in this visual increment. The welcome uses local art/font assets and the Rio renderer loads when the portal is requested.

## Browser journey

Browser QA used the Codex in-app browser. Source matching was performed at 390 × 844; desktop at 1280 × 720; smaller desktop/tablet at 736 × 569. Final handoff reset the temporary viewport and left the compiled welcome open at its default 1280 × 720. Tested widths had no horizontal overflow.

| Functionality | Executed behavior |
|---|---|
| Welcome | Get started opens the composer; Explore a gift opens the fictional Rio gift. |
| Validation | Empty title and whitespace-only dedication block advancing. |
| Personalization | Nina/Clara, a new title, dedication and story update the preview and portal through text content. |
| Themes | Sunset is reflected in the composer, personalized gift and panorama message. Paper/Ocean variants are preserved in code and reviewed. |
| Panorama | Image-backed Rio scene loads; message toggle, direction controls, reset and return work. It offers bounded looking, not walking. |
| Keep | Returns to review and requests an explicit local save. It does not create a cloud claim. |
| Draft save | Explicit save succeeds; the UI states that the draft stays in this browser. |
| Local link | Copy succeeds; the readonly link contains the text in its fragment. Opening it reproduces the Nina gift and Sunset appearance. |
| Resume | Reload begins a fresh unsaved draft; Resume saved draft restores the explicitly saved version. |
| Optional sign-in | The unconfigured preview states that email sign-in is unavailable. Continue without an account opens the composer; Escape restores focus. No code is fabricated and no email is sent. |
| Compiled return regression | After Back to gift, helper height is 0, visible gift cards are 0, there is one visible brand/home link, no dialog remains and focus returns to Step inside. |

The final compiled smoke repeated composition, portal opening/return, optional sign-in and continuation without an account. The broader personalized save/copy/resume journey ran against the same source in the local development preview. Automated tests cover local logic and API fixtures; they are not live cloud verification.

## Evidence

Evidence base: `C:/Users/admin/OneDrive/Documentos/Agent Hackas/outputs/giftportals-v9-dusk/`.

- `typecheck-frontend.log`, `typecheck-server.log`, `tests.log`, `build-final.log`, `console-final.json`.
- `comparison-21.png` and `focus-21.png`: selected source beside the compiled welcome, equal pixel dimensions.
- `14-composer-mobile-final.png` and `16-composer-desktop-final.png`: dark inputs, clear back icon and reachable primary action.
- `10-personal-portal-mobile.png`, `12-personal-gift-mobile.png`, `11-personal-gift-desktop.png`: personalized Sunset example.
- `23-before-return-fix.png` and `24-compiled-return-fixed.png`: duplicate presentation regression before/after.
- `21-delivery-welcome-mobile.png`, `22-compiled-portal-mobile.png`, `25-delivery-default-view.png`: compiled delivery screens.

## Boundaries

This is a local MVP. No real account, OTP email, SMS, public deployment, submission, payment, provider generation, commit or push was performed. Existing configured email/password code remains intact; no live auth claim is made. Cross-account private gifting and actual email delivery remain unverified.

Pre-increment backups and V8 evidence are preserved. Current visual QA includes its findings, fixes and final captures; the earlier V8 report remains below it as historical evidence.
