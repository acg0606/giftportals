# V14 creator QA

Target journey: **Photo → optional Place → Story or audio → Review → Create**. Keep each card short, use English copy, and allow a location-free and audio-free gift. This is a read-only baseline review plus acceptance checklist; the new wizard and audio integration still require verification.

## Baseline findings to resolve or explicitly handle

- **Pending generation recovery:** if a create response and its recovery GET both fail, the current creator releases editing. Any input then clears the pending capability. The original paid job may still exist. Preserve that capability and resolve the request before allowing a fresh paid submission; distinguish a confirmed missing job from a network failure.
- **Source and words:** choosing a File preserves the previous catalog world, title and story; choosing another catalog example overwrites customized words. Track untouched defaults separately from user edits, or make retained/replaced content explicit on Review.
- **World reference precedence:** an uploaded optional place photo survives source and intent changes and overrides both a catalog setting and a place original. Show the actual selected world reference on Review with a clear Remove action.
- **Repeated story idea:** catalog selection already fills its story. “Start with this idea” currently appends the same preset story again. Applying an unchanged suggestion should be idempotent.
- **Hidden required inputs:** native `reportValidity()` cannot focus a required field inside a hidden wizard card. Reveal and focus the relevant card before reporting errors. Final consent must remain an explicit unchecked action on Review.

## Acceptance cases

| Area | Action | Required result |
| --- | --- | --- |
| Short path | Pick a city or object preset; skip Place; keep the suggested story; review | No mandatory typing, GPS, microphone or account step. Review shows editable words and the intended source. |
| Photo intent | Pick Paris, then Antikythera; replace either with a File; change object/place intent | Catalog id clears for a File. City originals become framed Tripo keepsakes; isolated objects remain object references. Review matches the current intent and references. |
| Example preview | Open a ready gift from the selected source | Exact allowlisted public example route; no create POST, new credit use or private capability URL. Replacing the source hides its ready link. |
| Place opt-out | Open Place, Skip; decline GPS; receive a late GPS success after Skip | Continue remains usable, no automatic GPS request, no location silently reappears. Coordinates never enter browser storage or the create payload. |
| Place selection | Use explicit GPS, edit the label, apply; then change or remove it | Map uses rounded coordinates and local assets. Confirmed label and actually submitted description agree; no duplicate appended sentence. |
| Optional reference | Add a place photo, switch source, review, Remove | Review identifies the retained image and routing precedence. Removing it restores the appropriate catalog/original/text reference. |
| Curiosities | Inspect a File; select facts; replace photo; inspect slowly and switch preset | Facts remain source-backed, unchecked by default, at most two. Stale results cannot approve a new source or replace its preset facts. Artistic context never implies authenticated provenance. |
| Story | Apply the same idea twice; change preset after editing; test 1,200-character limit | No duplicated default story, silent truncation or unannounced loss of custom text. Review displays the submitted story. |
| Audio | Start, stop, leave Story, re-enter; deny or lack speech support; navigate away during startup | Explicit mic action, editable transcript, text fallback, bounded final text. Tracks and recognition stop; late events cannot alter another card or a submitted snapshot. |
| Audio privacy | Record/play a note and review | Clearly distinguish local recording, browser speech transcription and any persisted output. Do not imply a recorded note is included in the delivered gift unless it actually is. |
| Navigation | Continue, Back, category buttons, manual-place Enter and ordinary text Enter | Navigation never starts providers. Card change focuses its heading; keyboard cannot enter hidden cards. Enter before Review cannot create a gift. |
| Final validation | Blank/oversized title or short place description on Review; unchecked consent | Reveal the offending card and provide actionable feedback. No image preparation or create POST before all checks and explicit consent pass. |
| Safety | Original or optional reference is blocked, uncertain or checker unavailable | Generation remains blocked by the server. Manual category, catalog id, story changes and step navigation never bypass checking. |
| Dedupe | Double submit; lost response; failed recovery; refresh with a pending reference | One paid job per request. Retry/resume preserves capability; uncertain recovery cannot be converted into a fresh paid request by editing. |
| Lifecycle | Leave during camera, GPS, classification, audio, preparation, polling or GLB load | No stale DOM writes, retained device tracks, duplicate polling or leaked canvas. Existing job can be resumed with its protected capability. |
| Responsive UI | Desktop 1120×740 and mobile 390×844, reduced motion, keyboard | One primary action per card, visible Back/Skip where applicable, readable captions, accessible controls, no horizontal page overflow. |

## Verified baseline and remaining evidence

Before wizard implementation, **52 focused tests passed** across creator state/validation, GPS helpers, curated facts/preset controller and mocked instant backend. They cover reference routing, readiness, URL allowlisting, consent rejection, safety variants, backend dedupe, coarse GPS opt-out and stale preset inspection. They make no live provider calls.

These baseline tests **do not mount the creator** or prove card transitions, implicit Enter, hidden-field focus, the uncertain-network editing case, actual microphone capture, final browser speech behavior or responsive rendering. Controller-level wizard/audio tests and browser QA with a mocked creator service are required for those boundaries. Real generation, deployment and submission are separate evidence.

## Read-only wizard follow-up

The new source resolves the baseline issues: one card is visible at a time; untouched suggestions and personalized words are tracked separately; Review shows the effective world image; identical story suggestions are idempotent; final validation reveals the relevant card. Optional names and curiosities are collapsed. Voice remains secondary to the editable story text.

Two additional issues found during review were corrected: the request wrapper now retains structured API error codes, and a deferred Review refresh runs after optional controllers finish changing context or selected facts. These changes preserve the final consent boundary and avoid displaying facts that differ from the create payload. The backend now waits for accepted queued creates before declaring a recovery request missing.

An independent run after the creator freeze passed **44/44**: nine wizard tests, eight creator-state tests and 27 mocked instant-backend tests. The wizard tests mount actual creator event handlers with mocked media and optional controllers; they include structured service errors, late fact selection, direct removal of the world override and pending recovery. No open creator/backend findings remain in that reviewed scope.

The audio source follow-up also resolves its review findings: the creator explicitly accepts or rejects the transcript append; an overlong combined story retains the editable draft; resource cleanup preserves reviewed words during navigation; explicit discard, a new take or destruction clears them. Successful use prevents an unchanged transcript from being inserted twice. Audio lifecycle tests and final browser evidence remain pending at this checkpoint; no physical microphone or live provider generation was verified in this review.
