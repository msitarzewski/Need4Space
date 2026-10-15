"""The ship at lighter texture sizes: assets/racer_web_4k.glb and racer_web_2k.glb from assets/racer_web.glb.

The full ship carries three 8192 x 8192 maps (albedo, normal, ORM): ~7 MB of WebP to download, but each one decodes
to 256 MB and takes ~340 MB on the GPU with its mips - over 1 GB for the ship. A phone's browser lost its WebGL context
loading it ("Failed to start: Argument 1 ('shader') to WebGL2RenderingContext.shaderSource must be an instance of
WebGLShader" - every shader after the loss). main.js loads the 2K ship on phones and tablets, the 4K one on
integrated GPUs and in Laptop mode, the 8K one elsewhere. Same meshes, same materials; only the images are resized.

Run after every new export of racer_web.glb:  python tools/glb_variants.py
Another ship's model: python tools/glb_variants.py assets/rocket_web.glb  (writes rocket_web_4k.glb, rocket_web_2k.glb)
"""
import io, json, pathlib, struct, sys
from PIL import Image

ASSETS = pathlib.Path(__file__).resolve().parent.parent / 'assets'
SRC = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ASSETS / 'racer_web.glb'
QUALITY = {'albedo': 90, 'normal': 94, 'orm': 92}   # by the map's kind (its name's last part; WebP; normals keep the most)


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
            if img.size[0] > size:
                img = img.resize((size, size), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, 'WEBP', quality=QUALITY.get(str(im.get('name', '')).rsplit('_', 1)[-1], 90), method=6)
            data = buf.getvalue()
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


if not SRC.exists():
    sys.exit(f'{SRC} missing')
for s in (4096, 2048):
    variant(s)
