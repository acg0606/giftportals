# Local story audio

The optional Story card accepts an uploaded voice note or an explicitly started microphone recording. **Transcribe voice note** produces editable text. **Use transcript** adds only reviewed words to the story; recording and transcription do not create a gift. The parent story enforces its 1,200-character limit without silently truncating an append. A rejected append retains the transcript. Leaving the card cancels active work and releases microphone tracks, timers, playback and audio URLs while retaining the reviewed text. An unchanged accepted transcript cannot be added twice.

## Setup and readiness

Run from the GiftPortals project directory with the bundled Node/Python runtimes available:

```powershell
node tools/setup-local-audio.mjs
node tools/probe-local-audio.mjs
```

An explicit Python executable can be supplied as the first setup argument. This local profile reuses NumPy from the bundled Python runtime and ONNX Runtime 1.20.1 / tokenizers 0.22.2 from the existing `.local-giftportals/vision-runtime` profile. Complete the existing local vision setup first. No API credentials are required.

Setup downloads public registry wheels and four pinned files from [Systran's multilingual Whisper tiny conversion](https://huggingface.co/Systran/faster-whisper-tiny/tree/d90ca5fe260221311c53c58e660288d3deb8d356). The revision is `d90ca5fe260221311c53c58e660288d3deb8d356`; model files total 78,203,619 bytes. Setup and inference verify their SHA-256 digests. The measured additional audio runtime is approximately 157 MB, including Python package files, plus 78 MB of model files. Existing vision dependencies are reused. Everything stays in ignored `.local-giftportals/` directories.

The tested CPU pins are faster-whisper 1.2.1, CTranslate2 **4.6.0**, PyAV 19.0.0 and setuptools 80.9.0. CTranslate2 4.8.2 imported but crashed during native model initialization on this notebook; it is not the selected runtime. Readiness probes initialize the pinned native model, check actual imports and validate all model files. A manifest or successful import alone does not enable voice input.

[faster-whisper's official implementation](https://github.com/SYSTRAN/faster-whisper) supports CPU int8 inference, local converted model directories and Silero voice activity detection. PyAV supplies the media decoder. Runtime explicitly loads a local directory with `local_files_only=True`, offline environment flags and one CPU thread. It performs no package installation, model download or remote inference.

## Local API

The development server serves `/api/story-audio`. Host, peer and browser Origin validation use the existing localhost-only boundary; external or cross-site requests are rejected. Every response disables caching. The feature is unavailable on a deployment without a provisioned local runtime; there is no silent cloud fallback.

`GET /api/story-audio?action=status` returns `{ok:true,data:{available,localOnly:true,maxAudioBytes,maxDurationSeconds,languages,modelVersion?,reason?}}`. Languages are `pt`, `en` and `auto`. A native readiness probe is bounded to 10 seconds and cached for 30 seconds.

`POST /api/story-audio?action=transcribe` accepts JSON `{audioDataUrl,language}`. Portuguese is the default. Accepted containers are WAV, MP3, M4A/MP4 audio, WebM, Ogg and AAC. MIME and binary magic must agree. Canonical base64 and a 6 MB decoded byte limit apply; the transport body limit is 9 MB. No client duration claim is accepted.

Success returns `{ok:true,data:{text,language,duration,modelVersion,localOnly:true}}`, where `duration` comes from locally decoded samples. A Python worker decodes one audio stream into mono 16 kHz samples, limits the decoded duration to 60 seconds and refuses video streams. Silence/low-energy input is rejected before speech decoding; Silero VAD and no-speech/log-probability filtering also apply. Empty or excessive transcripts return guidance instead of fabricated text or truncation.

Only one transcription runs at a time across Vite reloads. Duplicate active requests return `AUDIO_BUSY`. Request abort or an abandoned response kills the transient worker; a 120-second bound limits other failures. The slot releases after the process closes, and late callbacks cannot replace the text. A normal request-body `close` does not cancel transcription. Worker environments exclude provider credentials; decoder diagnostics and audio content are not logged.

Raw audio remains in bounded memory and is never written by the service, uploaded to sponsors or included in the gift. The reviewed text becomes ordinary story content and follows the existing explicit final-generation consent. No Tripo/World Labs credits are consumed by transcription.

## Validation and limits

Thirteen focused API/UI tests cover input boundaries, local readiness, decoded result validation, one active slot, request/response cancellation, explicit reviewed emission, duplicate prevention, parent append refusal, draft preservation, permission denial, unsupported recording, late permission completion and track/blob-URL cleanup. These tests use local synthetic protocol/media fixtures, not a physical microphone.

Real CPU inference used clearly labelled Windows SAPI synthetic speech. Portuguese: 13.97 seconds of audio in approximately 3.17 seconds; English: 11.44 seconds in approximately 4.55 seconds. The Portuguese tiny model made a spelling/word-boundary error around “Paris”, demonstrating why review stays editable. A two-second silent WAV returned `AUDIO_NO_SPEECH`; an actual decoded 61-second WAV returned `AUDIO_DURATION_LIMIT`. Receipts are under `outputs/v14/local-audio-*-smoke.json` and contain synthetic test text only.

The same Portuguese fixture encoded as WebM/Opus also decoded and transcribed successfully in approximately 2.95 seconds. A real local API request aborted after 500 ms; the following silence request reached the decoder and returned `AUDIO_NO_SPEECH`, confirming that cancellation released the active slot. That cancellation/recovery sequence took 2.36 seconds, and a subsequent process check found zero remaining audio workers. Its receipt is `outputs/v14/local-audio-cancellation-smoke.json`. These fixtures establish the container and cancellation paths without recording a physical microphone.

These checks establish a working local upload/transcription path and lifecycle guards. They do not establish physical notebook microphone capture, accent/noise accuracy, a speech benchmark, deployment or submission. A tiny model may make transcription mistakes; the user reviews the result before it is used.
