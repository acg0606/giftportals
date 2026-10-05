# GiftPortals 10.3.3 — English product language

English is the product language regardless of browser or device locale. The
interface, navigation, accessible labels, validation, errors, public examples,
walk controls, XR and print preparation use English.

Automatic photo descriptions, titles, story drafts, world prompts, and sourced
place summaries now use English. The creator always requests English. The API
normalizes older Portuguese language hints to English, uses English templates,
queries English Wikipedia, and instructs the image provider to write in English.
Its normalized cache shares equivalent language requests.

Browser dictation, local transcription, the transcription API, and the offline
audio worker default to English. Choosing another spoken-input language is an
explicit action with English labels. The user's reviewed words remain intact.
Print-preparation counts use English number formatting.

The static-copy audit reviewed 111 files and 6,939 literal fragments across the
remaining frontend modules, shared catalogs, eight public demo JSON files, and
CSS. These already used English; remaining foreign words were official names,
addresses, and source attributions. The main router and account/create/share
screens were reviewed separately. Existing private gifts were not rewritten.

[Project instructions](../AGENTS.md) record this requirement for future changes.
Regression checks exercise Portuguese browser settings, legacy assistant hints,
provider prompts, English source selection, both voice-input modes, English
number formatting, and preservation of user-authored text. The offline worker
has four additional mocked tests that do not load a speech model.

All 1,014 application tests and four offline-worker tests passed, together with
frontend/server TypeScript checks and the production build. Browser review of
the photo, place, and story steps confirmed English copy and an English selected
spoken-input language. Verification did not start a provider generation.
