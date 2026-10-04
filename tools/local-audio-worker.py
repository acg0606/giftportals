"""One bounded, offline audio request. No audio files, remote inference, or logs."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import sys

PROTOCOL = "giftportals-local-audio-v1"
VERSION = "giftportals-local-whisper-tiny-v1:ct2-int8"
MAX_BYTES = 6 * 1024 * 1024
RATE = 16000
MAX_SECONDS = 60
PINNED = {
    "config.json": "a73a28cdfe1c43ccc7202fa333d1f89c202477271407ae9a7f19afa52039cac8",
    "model.bin": "dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1",
    "tokenizer.json": "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab",
    "vocabulary.txt": "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913",
}
APP = Path(__file__).resolve().parent.parent
PRIVATE = APP / ".local-giftportals"
MODEL = PRIVATE / "audio-model"
sys.path[:0] = [str(PRIVATE / "audio-runtime"), str(PRIVATE / "vision-runtime")]
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"


class AudioError(Exception):
    pass


def verify_runtime():
    manifest = json.loads((MODEL / "manifest.json").read_text("utf-8"))
    if manifest.get("modelVersion") != VERSION or manifest.get("revision") != "d90ca5fe260221311c53c58e660288d3deb8d356":
        raise AudioError("AUDIO_UNAVAILABLE")
    expected = {"config.json", "model.bin", "tokenizer.json", "vocabulary.txt"}
    files = manifest.get("files", [])
    if {entry.get("name") for entry in files} != expected or len(files) != 4:
        raise AudioError("AUDIO_UNAVAILABLE")
    for entry in files:
        path = MODEL / entry["name"]
        if path.stat().st_size != entry["bytes"] or entry["bytes"] <= 0 or entry["bytes"] > 100 * 1024 * 1024:
            raise AudioError("AUDIO_UNAVAILABLE")
        digest = hashlib.sha256()
        with path.open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != entry["sha256"] or entry["sha256"] != PINNED[entry["name"]]:
            raise AudioError("AUDIO_UNAVAILABLE")
    # Import actual native DLLs. A manifest alone is not readiness proof.
    import av
    import ctranslate2
    import faster_whisper
    import onnxruntime
    import tokenizers
    import numpy
    if av.__version__ != "19.0.0" or ctranslate2.__version__ != "4.6.0" or faster_whisper.__version__ != "1.2.1":
        raise AudioError("AUDIO_UNAVAILABLE")
    # Check native model initialization too: an import can succeed with an incompatible CPU wheel.
    ctranslate2.models.Whisper(str(MODEL), device="cpu", compute_type="int8", intra_threads=1, inter_threads=1)


def decode_audio(raw):
    import av
    import numpy as np
    chunks = []
    samples = 0
    try:
        with av.open(io.BytesIO(raw), mode="r") as container:
            if len(container.streams.audio) != 1 or len(container.streams.video) != 0:
                raise AudioError("AUDIO_CONTENT_INVALID")
            stream = container.streams.audio[0]
            resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=RATE)
            def append(frame):
                nonlocal samples
                samples += frame.samples
                if samples > MAX_SECONDS * RATE:
                    raise AudioError("AUDIO_DURATION_LIMIT")
                chunks.append(frame.to_ndarray().reshape(-1).copy())
            for frame in container.decode(stream):
                if frame.samples > 2 * RATE or frame.sample_rate < 8000 or frame.sample_rate > 192000:
                    raise AudioError("AUDIO_CONTENT_INVALID")
                for converted in resampler.resample(frame):
                    append(converted)
            for converted in resampler.resample(None):
                append(converted)
    except AudioError:
        raise
    except Exception:
        raise AudioError("AUDIO_CONTENT_INVALID") from None
    if samples < RATE // 5:
        raise AudioError("AUDIO_NO_SPEECH")
    audio = np.concatenate(chunks).astype(np.float32) / 32768.0
    # Silence must not reach a generative decoder that can invent a transcript.
    if not np.isfinite(audio).all() or float(np.max(np.abs(audio))) < 0.001 or float(np.sqrt(np.mean(audio * audio))) < 0.0001:
        raise AudioError("AUDIO_NO_SPEECH")
    return audio, samples / RATE


def transcribe(request):
    from faster_whisper import WhisperModel
    language = request.get("language", "pt")
    if language not in ("pt", "en", "auto"):
        raise AudioError("AUDIO_LANGUAGE_INVALID")
    url = request.get("audioDataUrl", "")
    if not isinstance(url, str) or len(url) > 9 * 1024 * 1024 or ";base64," not in url:
        raise AudioError("AUDIO_CONTENT_INVALID")
    try:
        raw = base64.b64decode(url.split(";base64,", 1)[1], validate=True)
    except Exception:
        raise AudioError("AUDIO_CONTENT_INVALID") from None
    if not raw or len(raw) > MAX_BYTES:
        raise AudioError("AUDIO_SIZE_LIMIT")
    audio, duration = decode_audio(raw)
    del raw
    model = WhisperModel(str(MODEL), device="cpu", compute_type="int8", cpu_threads=1, num_workers=1, local_files_only=True)
    segments, info = model.transcribe(
        audio, language=None if language == "auto" else language,
        beam_size=1, best_of=1, temperature=0.0, condition_on_previous_text=False,
        vad_filter=True, vad_parameters={"min_speech_duration_ms": 250, "min_silence_duration_ms": 500},
        no_speech_threshold=0.6, log_prob_threshold=-1.0,
    )
    text = " ".join(segment.text.strip() for segment in segments if segment.no_speech_prob <= 0.6 and segment.avg_logprob >= -1.0)
    text = " ".join(text.split())
    if not text:
        raise AudioError("AUDIO_NO_SPEECH")
    if len(text) > 1200:
        raise AudioError("AUDIO_TRANSCRIPT_LIMIT")
    return {"text": text, "language": info.language, "duration": round(duration, 4), "modelVersion": VERSION, "localOnly": True}


if __name__ == "__main__":
    request_id = None
    try:
        verify_runtime()
        if "--probe" in sys.argv:
            print(json.dumps({"ready": True, "protocol": PROTOCOL, "modelVersion": VERSION}))
        else:
            line = sys.stdin.buffer.readline(9 * 1024 * 1024 + 1)
            if len(line) > 9 * 1024 * 1024:
                raise AudioError("AUDIO_SIZE_LIMIT")
            request = json.loads(line)
            request_id = request.get("id")
            print(json.dumps({"id": request_id, "result": transcribe(request)}, ensure_ascii=True))
    except AudioError as error:
        print(json.dumps({"id": request_id, "error": str(error)}))
    except Exception:
        # Do not echo private content, decoder diagnostics, or environment values.
        print(json.dumps({"id": request_id, "error": "AUDIO_UNAVAILABLE"}))
