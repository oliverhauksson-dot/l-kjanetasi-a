"""Preview the site on your computer: run `python3 serve.py`, then open http://localhost:8000

The pages tell the browser to load everything over https (upgrade-insecure-requests).
Safari applies that to localhost too, so the games can't load. This server removes
that rule from the pages it sends, only here on your computer. The live site keeps it.
"""
import http.server
import os
import webbrowser

PORT = 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            if not self.path.split("?", 1)[0].endswith("/"):
                return super().send_head()  # Sends the browser to the same address with a / at the end.
            path = os.path.join(path, "index.html")
        if not path.endswith(".html") or not os.path.isfile(path):
            return super().send_head()
        with open(path, "rb") as f:
            body = f.read().replace(b"; upgrade-insecure-requests", b"")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return None


os.chdir(os.path.dirname(os.path.abspath(__file__)))
server = http.server.ThreadingHTTPServer(("localhost", PORT), Handler)
print(f"Pocket Arcade is running at http://localhost:{PORT}  (press Ctrl+C to stop)")
webbrowser.open(f"http://localhost:{PORT}")
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
