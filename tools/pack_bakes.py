"""Pack GPU exports: python tools/pack_bakes.py EXPORT_DIR --source-commit COMMIT

Requires Pillow only when regenerating assets. Normal game startup needs no build.
"""
import argparse
import base64
import gzip
import hashlib
import io
import json
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('exports', type=Path)
parser.add_argument('--source-commit', required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
assets = repo / 'assets' / 'bakes'
assets.mkdir(exist_ok=True)
manifest = {'sourceCommit': args.source_commit, 'textures': {}}
for source in sorted(args.exports.glob('*-bakes.json')):
    for entry in json.loads(source.read_text(encoding='utf8')):
        raw = gzip.decompress(base64.b64decode(entry['gzipBase64']))
        assert len(raw) == entry['width'] * entry['height'] * 4
        assert hashlib.sha256(raw).hexdigest() == entry['rawSHA256']
        image = Image.frombytes('RGBA', (entry['width'], entry['height']), raw)
        output = io.BytesIO()
        image.save(output, format='PNG', compress_level=6)
        png = output.getvalue()
        digest = hashlib.sha256(png).hexdigest()
        name = f"{entry['id']}-{digest[:12]}.png"
        (assets / name).write_bytes(png)
        record = {k: entry[k] for k in ['width', 'height', 'colorSpace', 'rawSHA256']}
        record.update(file=name, bytes=len(png), pngSHA256=digest)
        if entry['id'] in manifest['textures']:
            assert manifest['textures'][entry['id']] == record
        manifest['textures'][entry['id']] = record
expected = {f'{tier}-{name}' for tier in ['high', 'low'] for name in
            ['rock-normal', 'island-normal', 'ice-mask', 'ice-normal', 'sand-normal']}
assert set(manifest['textures']) == expected, 'Export all four circuits at high and low tiers first'
(assets / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
data = {key: {k: v for k, v in entry.items() if k in ['file', 'width', 'height', 'colorSpace']}
        for key, entry in manifest['textures'].items()}
(repo / 'src' / 'bake-data.js').write_text(
    '// Generated from assets/bakes/manifest.json; filenames contain the PNG content hash.\n'
    + 'export const BAKED_TEXTURES = ' + json.dumps(data, indent=2) + ';\n', encoding='utf8')
print('Packed', len(data), 'textures. Run python tools/stamp.py next.')
