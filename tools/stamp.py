"""Version stamp: every module and the stylesheet get their content's hash in the URL index.html loads them by.

GitHub Pages lets a browser keep any file for 10 minutes (max-age=600) and a reload only re-checks the page itself,
so a phone kept running the old code - or half old, half new - after an update ("still doesn't want to work in
mobile mode"). index.html's import map now names each module with ?v=<hash of its content>: a reload gets the page,
and with it the new URL of every file that changed (the rest stay cached). The build id - a hash of them all - shows
at the bottom of Settings.

It also lists every module the game loads as a modulepreload (the local ones by their stamped URL, three.js's from
the CDN): a browser only finds a module's imports once it has it, so the first visit fetched them in four or five
waves - seconds on a slow connection before anything ran ("everything appears to freeze for 5-10 seconds"). Listed,
they all start at once. (profile.js is a dev tool, loaded on demand: not listed.) The page's first script counts them
in for the loading bar.

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

# three.js's files the game loads: its own imports of three/addons (scanned) and what those import in turn
NESTED = {
    'postprocessing/EffectComposer.js': ['shaders/CopyShader.js', 'postprocessing/ShaderPass.js', 'postprocessing/MaskPass.js', 'postprocessing/Pass.js'],
    'postprocessing/OutputPass.js': ['shaders/OutputShader.js', 'postprocessing/Pass.js'],
    'postprocessing/SMAAPass.js': ['shaders/SMAAShader.js', 'postprocessing/Pass.js'],
    'postprocessing/GTAOPass.js': ['shaders/GTAOShader.js', 'shaders/PoissonDenoiseShader.js', 'math/SimplexNoise.js', 'shaders/CopyShader.js', 'postprocessing/Pass.js'],
    'loaders/GLTFLoader.js': ['utils/BufferGeometryUtils.js'],
}
DEV_ONLY = {'profile.js'}


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
    # the preloads, right after the import map (one placed after a module load has started is ignored)
    srcs = '\n'.join(p.read_text(encoding='utf-8') for p in mods)
    addons = sorted(set(re.findall(r"from 'three/addons/([^']+)'", srcs)))
    cdn = [REMOTE['three']]
    for a in addons:
        for f in [a] + NESTED.get(a, []):
            u = REMOTE['three/addons/'] + f
            if u not in cdn: cdn.append(u)
    cdn += [REMOTE['meshoptimizer/'] + f for f in sorted(set(re.findall(r"from 'meshoptimizer/([^']+)'", srcs)))]
    local = [f'./src/{name}?v={v}' for name, v in hashes.items() if name not in DEV_ONLY]
    pre = '<!-- preload:start -->\n' + '\n'.join(f'<link rel="modulepreload" href="{u}">' for u in local + cdn) + '\n<!-- preload:end -->'
    if '<!-- preload:start -->' in s2:
        s2 = re.sub(r'<!-- preload:start -->.*?<!-- preload:end -->', lambda m: pre, s2, count=1, flags=re.S)
    else:
        s2 = s2.replace('</script>\n</head>', '</script>\n' + pre + '\n</head>', 1)
    if pre not in s2:
        sys.exit('stamp: could not place the preloads (the import map must close right before </head>)')
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
