"""Preview the site on your computer: run `python3 serve.py`, then open http://localhost:8000

The shared top of every page lives in _includes/. GitHub Pages fills it in when it publishes
the site; this server does the same here, so the pages look the same on your computer.

The pages tell the browser to load everything over https (upgrade-insecure-requests).
Safari applies that to localhost too, so the games can't load. This server removes
that rule from the pages it sends, only here on your computer. The live site keeps it.
"""
import http.server
import os
import re
import webbrowser

PORT = 8000


INCLUDE = re.compile(r"\{%\s*include\s+(\S+)((?:\s+\w+=\"[^\"]*\")*)\s*%\}")


def build(text):
    """Do what GitHub Pages does: drop the --- lines at the top and fill in {% include ... %}."""
    if text.startswith("---\n"):
        text = text.split("---\n", 2)[2]

    def include(m):
        with open(os.path.join("_includes", m.group(1)), encoding="utf-8") as f:
            part = f.read()
        for key, value in re.findall(r'(\w+)="([^"]*)"', m.group(2)):
            part = part.replace("{{ include." + key + " }}", value)
        return re.sub(r"\{\{ include\.\w+ \}\}", "", part).rstrip("\n")

    return INCLUDE.sub(include, text)


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
        with open(path, encoding="utf-8") as f:
            body = build(f.read()).replace("; upgrade-insecure-requests", "").encode("utf-8")
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
