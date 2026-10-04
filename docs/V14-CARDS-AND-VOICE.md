# GiftPortals V14 — cards and voice

The creator presents one themed card at a time: **Photo → Place → Story → Review**. Navigation preserves the selected image, setting, story and optional reference. GPS, personal text and audio are optional. Selecting a ready inspiration keeps its free preview link available; providers only start after the final review and explicit consent.

Place choices are directly visible in their own card. The original standalone location panel retains its collapsible presentation. The creator does not request location on mount; approximate local map and context behavior remain unchanged. Optional world customization, personal details and curiosities are collapsed. Voice input appears before the story textbox. Card navigation stays outside the scrolling card body; the main page fits both tested viewport sizes.

The Story card supports recording a short voice note or selecting an audio file. Transcription is a separate explicit action. The user can review/edit the result and choose **Use transcript** before it is added to the editable story. Leaving Story stops microphone capture and cancels in-flight work. Audio is not part of the delivered gift.

## Local transcription

The local MVP uses a multilingual Whisper tiny model with CPU int8 inference. It does not require an API key or use sponsor generation credits. Runtime dependencies and model files live under the ignored `.local-giftportals/` directory. Runtime transcription must not download packages or model weights.

The local service accepts Portuguese, English or automatic language detection, with a 60-second / 6 MB limit and one active transcription. Uploaded bytes are decoded locally; the service validates actual duration and rejects unsupported or silent input. Raw recordings and uploaded audio are not persisted. Approved, edited text becomes part of the user's gift story under the normal final-generation consent.

Implementation references: [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) and [faster-whisper](https://github.com/SYSTRAN/faster-whisper).

## Validation evidence

Evidence is recorded under `outputs/v14/`. The short Portuguese and English WAV fixtures are clearly labelled synthetic speech, produced with installed Windows voices; they contain fictional gift stories. They are used to check actual local transcription and browser upload without recording the user's microphone.

The full suite passed **273/273 tests**. Frontend and strict server TypeScript checks passed. Production build passed with the existing large Spark/Cesium chunk warning.

Actual offline recognition passed Portuguese and English WAV fixtures and a Portuguese WebM/Opus fixture. In the Portuguese WAV sample, 13.97 seconds of synthetic speech took 3.17 seconds to transcribe. A word spelling needed correction; transcription is deliberately editable. Actual silence and a decoded 61-second clip were rejected, and real request cancellation freed the slot with no worker left running.

The browser check covered selecting a preset, continuing with GPS off, uploading the Portuguese WAV, actual transcription, editing its text, preserving the unused draft across Back/Continue, adding approved words once and displaying them on final Review with unchecked consent. No generation was submitted. DOM measurements confirmed one active section, no horizontal overflow and visible navigation at 1280×720 and 390×844. Screenshots are desktop evidence; mobile checks used rendered DOM dimensions.

See `outputs/v14/browser-checks.json`, `tests.tap`, typecheck/build logs and the local audio smoke receipts. Detailed setup and runtime contract: [LOCAL_STORY_AUDIO.md](LOCAL_STORY_AUDIO.md).

Physical notebook microphone capture is separate from these synthetic file checks and remains unverified. The local preview is not a deployment or submission.
