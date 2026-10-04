"""Read original pinned bytes, including the losslessly packed tokenizer."""
import gzip
import hashlib


def read_pinned_model(root, item):
    path = root / item['model'] / item['file']
    compressed = item['model'] == 'Xenova/mobileclip_s0' and item['file'] == 'tokenizer.json' and not path.exists()
    if compressed:
        with gzip.open(str(path) + '.gz', 'rb') as archive:
            binary = archive.read(item['bytes'] + 1)
    else:
        binary = path.read_bytes()
    if len(binary) != item['bytes'] or hashlib.sha256(binary).hexdigest() != item['sha256']:
        raise RuntimeError('MODEL_INTEGRITY')
    return binary, compressed
