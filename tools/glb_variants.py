"""The ship at lighter texture sizes: assets/racer_web_4k.glb and racer_web_2k.glb from assets/racer_web.glb.

The full ship carries three 8192 x 8192 maps (albedo, normal, ORM): each one decodes to 256 MB and takes ~340 MB on
the GPU with its mips - over 1 GB for the ship. A phone's browser lost its WebGL context
loading it ("Failed to start: Argument 1 ('shader') to WebGL2RenderingContext.shaderSource must be an instance of
WebGLShader" - every shader after the loss). main.js loads the 2K ship on phones and tablets, the 4K one on
integrated GPUs and in Laptop mode, the 8K one elsewhere. Same meshes, same materials; only the images are resized.

Every map is WebP LOSSLESS, like the exporters' own: lossy WebP pushes an ORM's packed channels (occlusion / roughness /
metal) and a normal map's XY through YUV and quantises them in blocks - squares over the hull up close. Colour is
resized with Lanczos, the data maps by area (a box filter: what a mip level holds), and every resized map is checked to
decode exactly.

Run after every new export of racer_web.glb:  python tools/glb_variants.py
Another ship's model: python tools/glb_variants.py assets/rocket_web.glb  (writes rocket_web_4k.glb, rocket_web_2k.glb)
A ship's livery maps (the exporter's <livery>_{albedo,orm}.png) at the sizes the game lists (ships.js LIVERIES):
    python tools/glb_variants.py --liveries <dir with the PNGs> <ship> 2048 [4096 ...]
    -> assets/liveries/<ship>/<livery>_{albedo,orm}_<n>k.webp
"""
import io, json, pathlib, struct, sys
from PIL import Image

ASSETS = pathlib.Path(__file__).resolve().parent.parent / 'assets'
SRC = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ASSETS / 'racer_web.glb'


def kind(name):
    return str(name or '').rsplit('_', 1)[-1]          # albedo / orm / normal: a map's name's last part


def lossless(img, size, k):
    """the map at size x size (Lanczos for colour, area for data), as lossless WebP bytes - checked to decode exactly"""
    img = img.convert('RGB')
    if img.size[0] != size:
        img = img.resize((size, size), Image.LANCZOS if k == 'albedo' else Image.BOX)
    buf = io.BytesIO()
    img.save(buf, 'WEBP', lossless=True, quality=100, method=4)
    back = Image.open(io.BytesIO(buf.getvalue())).convert('RGB')
    assert back.tobytes() == img.tobytes(), f'{k}: the WebP does not decode to the map'
    return buf.getvalue()


def read_glb(path):
    b = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', b, 0)
    assert magic == 0x46546C67 and version == 2, 'not a glTF 2 binary'
    jl, jt = struct.unpack_from('<II', b, 12)
    assert jt == 0x4E4F534A
    J = json.loads(b[20:20 + jl])
    bl, bt = struct.unpack_from('<II', b, 20 + jl)
    assert bt == 0x004E4942
    return J, b[28 + jl:28 + jl + bl]


def write_glb(path, J, binary):
    js = json.dumps(J, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    binary += b'\0' * (-len(binary) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binary), 0x004E4942) + binary
    path.write_bytes(out)


def variant(size):
    J, B = read_glb(SRC)
    views = J['bufferViews']
    images = {im['bufferView']: im for im in J['images']}
    # the binary rebuilt view by view (each aligned to 4 bytes), the images' views replaced by their resized WebP
    out = bytearray()
    for i, v in enumerate(views):
        data = B[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        if i in images:
            im = images[i]
            img = Image.open(io.BytesIO(data))
            data = lossless(img, min(size, img.size[0]), kind(im.get('name')))
        out += b'\0' * (-len(out) % 4)
        v['byteOffset'] = len(out)
        v['byteLength'] = len(data)
        out += data
    J['buffers'][0]['byteLength'] = len(out)
    dst = SRC.with_name(f'{SRC.stem}_{size // 1024}k.glb')
    write_glb(dst, J, bytes(out))
    # check: it reads back, every view inside the buffer, every image the size asked
    J2, B2 = read_glb(dst)
    for v in J2['bufferViews']:
        assert v['byteOffset'] + v['byteLength'] <= len(B2)
    for im in J2['images']:
        v = J2['bufferViews'][im['bufferView']]
        w = Image.open(io.BytesIO(B2[v['byteOffset']:v['byteOffset'] + v['byteLength']])).size
        assert w == (size, size), (im.get('name'), w)
    print(f'{dst.name}: {dst.stat().st_size / 1e6:.1f} MB, maps {size} px')


def liveries(src, ship, sizes):
    out = ASSETS / 'liveries' / ship
    out.mkdir(parents=True, exist_ok=True)
    for p in sorted(pathlib.Path(src).glob('*_*.png')):
        liv, k = p.stem.rsplit('_', 1)
        if k not in ('albedo', 'orm') or liv in ('default', 'racer', 'rocket', 'heavy'):
            continue
        img = Image.open(p)
        for n in sizes:
            if n > img.size[0]:
                continue
            dst = out / f'{liv}_{k}_{n // 1024}k.webp'
            dst.write_bytes(lossless(img, n, k))
            print(f'{dst.relative_to(ASSETS)}: {dst.stat().st_size / 1e6:.2f} MB')


if len(sys.argv) > 1 and sys.argv[1] == '--liveries':
    liveries(sys.argv[2], sys.argv[3], [int(x) for x in sys.argv[4:]] or [2048])
    sys.exit(0)
if not SRC.exists():
    sys.exit(f'{SRC} missing')
for s in (4096, 2048):
    variant(s)
