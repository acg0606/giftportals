"""Authenticated private-image moderation. No provider keys or model downloads."""
import base64
import hashlib
import hmac
import importlib
import json
import math
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path

MAX_BODY = 16_384
MAX_IMAGE = 6 * 1024 * 1024
PROTOCOL = 'giftportals-cloud-vision-v1'
POLICY_PATH = Path(__file__).resolve().parent / '_lib' / 'cloud-vision-policy.json'
_lock = threading.Lock()
_engine = None

class VisionError(Exception):
    def __init__(self, code='PHOTO_SAFETY_UNAVAILABLE', status=503):
        self.code, self.status = code, status

def authenticated(value):
    key = os.environ.get('GIFTPORTALS_CLOUD_MODERATION_KEY', '')
    return len(key) >= 32 and isinstance(value, str) and hmac.compare_digest(value, 'Bearer ' + key)

def validate_image(item):
    if not isinstance(item, dict) or item.get('id') not in ['original', 'object', 'world'] or item.get('mime') not in ['image/png', 'image/jpeg', 'image/webp'] or not isinstance(item.get('sha256'), str) or not re.fullmatch('[a-f0-9]{64}', item['sha256']) or type(item.get('bytes')) is not int or not 0 < item['bytes'] <= MAX_IMAGE:
        raise VisionError('IMAGE_CONTENT_INVALID', 422)
    expected = urllib.parse.urlsplit(os.environ.get('SUPABASE_URL', ''))
    source = urllib.parse.urlsplit(item.get('imageUrl', ''))
    if expected.scheme != 'https' or not re.fullmatch(r'[a-z0-9-]+\.supabase\.co', expected.netloc) or source.scheme != 'https' or source.netloc != expected.netloc or source.username or source.password or source.fragment:
        raise VisionError('IMAGE_ORIGIN_DENIED', 422)
    if not re.fullmatch(r'/storage/v1/object/sign/gp-instant-private/[a-f0-9-]{36}/(?:input|moderation)/[a-z0-9-]+\.(?:png|jpg|webp)', source.path):
        raise VisionError('IMAGE_ORIGIN_DENIED', 422)
    query = urllib.parse.parse_qs(source.query, strict_parsing=True)
    if set(query) != {'token'} or len(query['token']) != 1 or not 1 <= len(query['token'][0]) <= 4096:
        raise VisionError('IMAGE_ORIGIN_DENIED', 422)
    return item

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise VisionError('IMAGE_ORIGIN_DENIED', 422)

def download_image(item):
    opener = urllib.request.build_opener(NoRedirect())
    started = time.monotonic()
    with opener.open(urllib.request.Request(item['imageUrl'], headers={'Accept': item['mime']}), timeout=15) as response:
        length = response.headers.get('Content-Length')
        if length and (not length.isdecimal() or int(length) != item['bytes']):
            raise VisionError('IMAGE_CONTENT_INVALID', 422)
        chunks, size = [], 0
        while True:
            chunk = response.read(min(65536, MAX_IMAGE + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_IMAGE or time.monotonic() - started > 30:
                raise VisionError('IMAGE_CONTENT_INVALID', 422)
            chunks.append(chunk)
        return b''.join(chunks)

def decision(metrics, policy):
    sexual, scores = metrics.get('sexual'), metrics.get('clipScores')
    labels = policy['labels']
    if type(sexual) not in [int, float] or not math.isfinite(sexual) or not 0 <= sexual <= 1 or not isinstance(scores, list) or len(scores) != len(labels) or any(type(score) not in [int, float] or not math.isfinite(score) or not 0 <= score <= 1 for score in scores):
        raise VisionError()
    product = min(1, sum(score for label, score in zip(labels, scores) if label[0] == 'adult-product'))
    sexual = max(sexual, min(1, sum(score for label, score in zip(labels, scores) if label[0] == 'sexual')))
    top = max(range(len(scores)), key=lambda index: scores[index])
    thresholds = policy['thresholds']
    verdict, category = 'allow', 'ordinary'
    if sexual >= thresholds['sexualBlock']:
        verdict, category = 'block', 'sexual'
    elif product >= thresholds['productBlock'] or labels[top][0] == 'adult-product' and scores[top] >= thresholds['productTopBlock']:
        verdict, category = 'block', 'adult-product'
    elif sexual >= thresholds['sexualReview'] or product >= thresholds['productReview'] or labels[top][0] == 'sexual':
        verdict, category = 'review', 'uncertain'
    return {'decision': verdict, 'category': category, 'modelVersion': policy['modelVersion'], 'scores': {'sexual': sexual, 'adultProduct': product}}

def infer_image(binary, mime, policy):
    global _engine
    if _engine is None:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'server'))
        _engine = importlib.import_module('cloud_vision_inference')
    return _engine.inspect({'imageDataUrl': 'data:' + mime + ';base64,' + base64.b64encode(binary).decode('ascii'), 'labels': [label[1] for label in policy['labels']]})

def process_payload(payload, downloader=download_image, infer=infer_image):
    if not isinstance(payload, dict) or payload.get('protocol') != PROTOCOL or not isinstance(payload.get('images'), list) or not 1 <= len(payload['images']) <= 3:
        raise VisionError('IMAGE_CONTENT_INVALID', 422)
    images = [validate_image(item) for item in payload['images']]
    if len({image['id'] for image in images}) != len(images) or sum(image['bytes'] for image in images) > 12 * 1024 * 1024:
        raise VisionError('IMAGE_CONTENT_INVALID', 422)
    if not _lock.acquire(blocking=False):
        raise VisionError()
    try:
        policy = json.loads(POLICY_PATH.read_text(encoding='utf-8'))
        results, cache = [], {}
        for image in images:
            binary = downloader(image)
            if len(binary) != image['bytes'] or hashlib.sha256(binary).hexdigest() != image['sha256']:
                raise VisionError('IMAGE_CONTENT_INVALID', 422)
            magic = binary.startswith(b'\x89PNG\r\n\x1a\n') if image['mime'] == 'image/png' else binary.startswith(b'\xff\xd8\xff') if image['mime'] == 'image/jpeg' else len(binary) >= 12 and binary[:4] == b'RIFF' and binary[8:12] == b'WEBP'
            if not magic:
                raise VisionError('IMAGE_CONTENT_INVALID', 422)
            if image['sha256'] not in cache:
                cache[image['sha256']] = decision(infer(binary, image['mime'], policy), policy)
            results.append({'id': image['id'], 'sha256': image['sha256'], **cache[image['sha256']]})
        verdict = 'block' if any(result['decision'] == 'block' for result in results) else 'review' if any(result['decision'] == 'review' for result in results) else 'allow'
        return {'protocol': PROTOCOL, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'modelVersion': policy['modelVersion'], 'decision': verdict, 'results': results}
    finally:
        _lock.release()

class handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Never log signed URLs, input bytes, request bodies or credentials.

    def reply(self, status, body):
        encoded = json.dumps(body, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        self.reply(405, {'error': 'METHOD_NOT_ALLOWED'})

    def do_POST(self):
        try:
            if not authenticated(self.headers.get('Authorization')):
                raise VisionError('MODERATION_FORBIDDEN', 403)
            length = self.headers.get('Content-Length', '')
            if not length.isdecimal() or not 0 < int(length) <= MAX_BODY or self.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
                raise VisionError('INVALID_BODY', 413)
            body = self.rfile.read(int(length))
            if len(body) != int(length):
                raise VisionError('INVALID_BODY', 422)
            self.reply(200, process_payload(json.loads(body)))
        except VisionError as error:
            self.reply(error.status, {'error': error.code})
        except Exception:
            self.reply(503, {'error': 'PHOTO_SAFETY_UNAVAILABLE'})
