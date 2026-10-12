"""serve.py - static server for the flight test (explicit MIME types: the Windows registry can map .js to text/plain,
which browsers refuse for ES modules; no-cache so a rebuilt GLB is always picked up).

    python serve.py [port]      -> http://localhost:8765
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary",
                      ".gltf": "model/gltf+json", ".json": "application/json", ".webp": "image/webp",
                      ".html": "text/html", ".css": "text/css"}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_POST(self):
        """debug frames: POST /shot/<name> with a PNG body -> racer/wip/shots/<name>.png"""
        name = os.path.basename(self.path.split("?")[0])
        if not self.path.startswith("/shot/") or not name.replace("_", "").replace("-", "").isalnum():
            self.send_error(404)
            return
        data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        out = os.path.join(os.path.dirname(ROOT), "wip", "shots")
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, name + ".png"), "wb") as f:
            f.write(data)
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "404" in (fmt % args):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    print(f"serving {ROOT} on http://localhost:{PORT}", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
