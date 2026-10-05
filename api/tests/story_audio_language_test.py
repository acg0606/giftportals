"""Exercise audio-worker language selection without loading a speech model."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch


WORKER = Path(__file__).resolve().parents[2] / "tools" / "local-audio-worker.py"
SPEC = importlib.util.spec_from_file_location("giftportals_audio_language", WORKER)
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class AudioLanguageTests(unittest.TestCase):
    def transcribe(self, request, expected, words="A memory in my own words."):
        languages = []

        class Model:
            def __init__(self, *_args, **kwargs):
                self.offline = kwargs["local_files_only"]

            def transcribe(self, _audio, **kwargs):
                languages.append((kwargs["language"], self.offline))
                segment = SimpleNamespace(text=words, no_speech_prob=0, avg_logprob=0)
                return [segment], SimpleNamespace(language=kwargs["language"] or "en")

        with patch.dict("sys.modules", {"faster_whisper": SimpleNamespace(WhisperModel=Model)}):
            with patch.object(worker, "decode_audio", return_value=(object(), 2)):
                result = worker.transcribe({"audioDataUrl": "data:audio/wav;base64,WA==", **request})
        self.assertEqual(languages, [(expected, True)])
        self.assertEqual(result["text"], words)

    def test_omitted_language_defaults_to_english(self):
        self.transcribe({}, "en")

    def test_explicit_english(self):
        self.transcribe({"language": "en"}, "en")

    def test_explicit_spoken_language_preserves_user_words(self):
        self.transcribe({"language": "pt"}, "pt", "Minha memória.")

    def test_auto_detect_is_only_an_explicit_choice(self):
        self.transcribe({"language": "auto"}, None)


if __name__ == "__main__":
    unittest.main()
