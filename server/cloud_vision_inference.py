"""Pinned one-thread ONNX inference; same preprocessing and metrics as the local worker."""
import base64
import hashlib
import io
import json
import os
import re
import tempfile
import warnings
from pathlib import Path
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer
from PIL import Image, ImageOps
from cloud_vision_assets import read_pinned_model
if ort.__version__ != '1.20.1':
    raise RuntimeError('RUNTIME_VERSION_INVALID')
Image.MAX_IMAGE_PIXELS = 20_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)
root = Path(os.environ.get("GIFTPORTALS_CLOUD_VISION_MODEL_DIR", str(Path(__file__).resolve().parent.parent / 'api' / "_vision_models"))).resolve()
# Verify every pinned model byte before creating any ONNX session.
pins = json.loads((Path(__file__).resolve().parent.parent / 'api' / '_lib' / 'cloud-vision-weights.json').read_text(encoding='utf-8'))
if len(pins.get('files', [])) != 9:
    raise RuntimeError('MODEL_MANIFEST_INVALID')
_tokenizer_directory = None
_tokenizer_path = root / 'Xenova/mobileclip_s0/tokenizer.json'
for item in pins['files']:
    binary, compressed = read_pinned_model(root, item)
    if compressed:
        # The tokenizer consumes the exact pinned original bytes via from_file.
        _tokenizer_directory = tempfile.TemporaryDirectory(prefix='giftportals-vision-')
        _tokenizer_path = Path(_tokenizer_directory.name) / 'tokenizer.json'
        _tokenizer_path.write_bytes(binary)
    del binary
clip = root / 'Xenova/mobileclip_s0'
nsfw = root / 'onnx-community/nsfw-image-detector-ONNX'
clip_config = json.loads((clip / 'preprocessor_config.json').read_text(encoding='utf-8'))
nsfw_config = json.loads((nsfw / 'preprocessor_config.json').read_text(encoding='utf-8'))
labels = json.loads((nsfw / 'config.json').read_text(encoding='utf-8'))['id2label']
if set(labels.values()) != {'drawings', 'hentai', 'neutral', 'porn', 'sexy'}:
    raise RuntimeError('CLASSIFIER_LABEL_INVALID')
sessions = None
text_vectors = None
text_labels = None

def session(path):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.log_severity_level = 3
    return ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])

def normalize(values):
    values = np.asarray(values, dtype=np.float32)
    norms = np.linalg.norm(values, axis=-1, keepdims=True)
    if not np.isfinite(values).all() or not np.isfinite(norms).all() or (norms <= 0).any():
        raise ValueError('CLASSIFIER_VECTOR_INVALID')
    return values / norms

def softmax(logits):
    logits = np.asarray(logits, dtype=np.float64)
    if not np.isfinite(logits).all():
        raise ValueError('CLASSIFIER_SCORE_INVALID')
    values = np.exp(logits - np.max(logits))
    return values / np.sum(values)

def load(prompts):
    global sessions, text_vectors, text_labels
    if text_labels is not None and prompts != text_labels:
        raise ValueError('CLASSIFIER_LABEL_CHANGED')
    if sessions is not None:
        return sessions
    if not isinstance(prompts, list) or not 1 <= len(prompts) <= 64 or any(not isinstance(p, str) or not 1 <= len(p) <= 240 for p in prompts):
        raise ValueError('CLASSIFIER_LABEL_INVALID')
    tokenizer = Tokenizer.from_file(str(_tokenizer_path))
    tokenizer.enable_truncation(max_length=77)
    tokenizer.enable_padding(length=77, pad_id=0, pad_token='!')
    text = session(clip / 'onnx/text_model_quantized.onnx')
    if [item.name for item in text.get_inputs()] != ['input_ids'] or [item.name for item in text.get_outputs()] != ['text_embeds']:
        raise ValueError('CLASSIFIER_MODEL_INVALID')
    # Dynamic q8 activation scales depend on the complete batch. Encode each
    # prototype independently so adding an ordinary category does not change
    # existing text embeddings. This is done once per resident worker.
    vectors = []
    for prompt in prompts:
        ids = np.asarray([tokenizer.encode(prompt).ids], dtype=np.int64)
        vectors.append(normalize(text.run(['text_embeds'], {'input_ids': ids})[0]))
    text_vectors = np.concatenate(vectors, axis=0)
    del text
    # The pinned model config selects fp32 vision. Its q8 CNN branch is unsuitable
    # for this screening task; q8 text and q8 trained NSFW stay quantized.
    sessions = (session(clip / 'onnx/vision_model.onnx'), session(nsfw / 'onnx/model_quantized.onnx'))
    for item, output in zip(sessions, ['image_embeds', 'logits']):
        if [value.name for value in item.get_inputs()] != ['pixel_values'] or [value.name for value in item.get_outputs()] != [output]:
            raise ValueError('CLASSIFIER_MODEL_INVALID')
    text_labels = prompts
    return sessions

def pixels(image, config):
    image = image.convert('RGB')
    size = config['size']
    if 'shortest_edge' in size:
        shortest = size['shortest_edge']
        width, height = image.size
        scale = shortest / min(width, height)
        image = image.resize((int(width * scale), int(height * scale)), resample=Image.Resampling.BILINEAR)
    else:
        image = image.resize((size['width'], size['height']), resample=Image.Resampling.BILINEAR)
    if config.get('do_center_crop'):
        crop = config['crop_size']
        left = (image.width - crop['width']) // 2
        top = (image.height - crop['height']) // 2
        image = image.crop((left, top, left + crop['width'], top + crop['height']))
    values = np.asarray(image, dtype=np.float32)
    if config.get('do_rescale'):
        values *= config['rescale_factor']
    if config.get('do_normalize'):
        values = (values - np.asarray(config['image_mean'], dtype=np.float32)) / np.asarray(config['image_std'], dtype=np.float32)
    return np.ascontiguousarray(values.transpose(2, 0, 1)[None, ...], dtype=np.float32)

def inspect(request):
    value = request.get('imageDataUrl')
    if not isinstance(value, str) or len(value) > 9 * 1024 * 1024:
        raise ValueError('IMAGE_INVALID')
    match = re.fullmatch(r'data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})', value)
    if not match:
        raise ValueError('IMAGE_INVALID')
    binary = base64.b64decode(match.group(2), validate=True)
    if not 0 < len(binary) <= 6 * 1024 * 1024:
        raise ValueError('IMAGE_INVALID')
    # Pillow parses header dimensions first. Reject before allocating decoded pixels.
    with Image.open(io.BytesIO(binary)) as original:
        width, height = original.size
        if original.format not in ['JPEG', 'PNG', 'WEBP'] or min(width, height) < 24 or max(width, height) > 16384 or width * height > 20_000_000 or getattr(original, 'n_frames', 1) != 1:
            raise ValueError('IMAGE_INVALID')
        image = ImageOps.exif_transpose(original).convert('RGB')
    vision, detector = load(request.get('labels'))
    logits = detector.run(['logits'], {'pixel_values': pixels(image, nsfw_config)})[0][0]
    probabilities = softmax(logits)
    if len(probabilities) != len(labels):
        raise ValueError('CLASSIFIER_SCORE_INVALID')
    sexual = float(sum(probabilities[int(key)] for key, label in labels.items() if label in {'hentai', 'porn', 'sexy'}))
    vector = normalize(vision.run(['image_embeds'], {'pixel_values': pixels(image, clip_config)})[0])[0]
    clip_scores = softmax(100.0 * (text_vectors @ vector)).tolist()
    return {'sexual': sexual, 'clipScores': clip_scores}

