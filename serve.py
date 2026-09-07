"""Dev server. Same as `python -m http.server`, except it forces the JavaScript
MIME type: on Windows the registry maps .js to text/plain, and Chrome refuses
an ES module served that way. Run: python serve.py [port]"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        # Demo data changes fast; never let the browser hold a stale module.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"HARP prototype on http://127.0.0.1:{port}/  (ctrl+c to stop)")
    ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=".")).serve_forever()
