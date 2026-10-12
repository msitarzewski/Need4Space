"""Version stamp: every module and the stylesheet get their content's hash in the URL index.html loads them by.

GitHub Pages lets a browser keep any file for 10 minutes (max-age=600) and a reload only re-checks the page itself,
so a phone kept running the old code - or half old, half new - after an update ("still doesn't want to work in
mobile mode"). index.html's import map now names each module with ?v=<hash of its content>: a reload gets the page,
and with it the new URL of every file that changed (the rest stay cached). The build id - a hash of them all - shows
at the bottom of Settings.

Run before each commit (the repo's pre-commit hook does): python tools/stamp.py
"""
import hashlib, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
HTML = ROOT / 'index.html'
REMOTE = {   # the libraries (from the CDN, their versions in the URL already)
    'three': 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
    'three/addons/': 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/',
    'meshoptimizer/': 'https://cdn.jsdelivr.net/npm/meshoptimizer@0.21.0/',
}

def h(p):
    return hashlib.sha1(p.read_bytes()).hexdigest()[:8]

def main():
    mods = sorted(SRC.glob('*.js'))
    hashes = {p.name: h(p) for p in mods}
    css = h(SRC / 'ui.css')
    build = hashlib.sha1(json.dumps([hashes, css], sort_keys=True).encode()).hexdigest()[:7]
    imports = dict(REMOTE)
    for name, v in hashes.items():
        imports[f'./src/{name}'] = f'./src/{name}?v={v}'
    lines = ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v)}' for k, v in imports.items())
    s = HTML.read_text(encoding='utf-8')
    s2 = re.sub(r'<script type="importmap">.*?</script>', '<script type="importmap">\n{ "imports": {\n' + lines + '\n} }\n</script>', s, count=1, flags=re.S)
    s2 = re.sub(r'<script type="module" src="src/main\.js[^"]*"></script>', f'<script type="module" src="src/main.js?v={hashes["main.js"]}"></script>', s2)
    s2 = re.sub(r'<link rel="stylesheet" href="src/ui\.css[^"]*">', f'<link rel="stylesheet" href="src/ui.css?v={css}">', s2)
    if '<meta name="build"' in s2:
        s2 = re.sub(r'<meta name="build" content="[^"]*">', f'<meta name="build" content="{build}">', s2)
    else:
        s2 = s2.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n<meta name="build" content="{build}">', 1)
    for need in ('<script type="importmap">', f'src/main.js?v={hashes["main.js"]}', f'src/ui.css?v={css}', f'content="{build}"'):
        if need not in s2:
            sys.exit(f'stamp: index.html not as expected ({need} missing)')
    if s2 != s:
        HTML.write_text(s2, encoding='utf-8')
    print(f'stamp: build {build}, {len(hashes)} modules' + (' (index.html updated)' if s2 != s else ''))

main()
