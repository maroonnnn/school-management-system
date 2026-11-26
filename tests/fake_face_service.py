"""Stand-in for the face service, used ONLY by tests/test_offline_sync.py (a test has no camera).
frames[0] decides the answer: "EMP:<seed>" -> deterministic embedding, "NOFACE", "WRONGDIR". Listens on 127.0.0.1:8001."""
import hashlib, json, random
from http.server import BaseHTTPRequestHandler, HTTPServer
def emb(seed):
    r = random.Random(hashlib.sha256(seed.encode()).hexdigest()); v = [r.gauss(0, 1) for _ in range(128)]
    n = sum(x*x for x in v) ** .5; return [x/n for x in v]
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        f0 = body["frames"][0]
        if f0 == "NOFACE": out = {"ok": False, "reason": "NO_FACE", "message": "no face"}
        elif f0 == "WRONGDIR": out = {"ok": False, "reason": "WRONG_DIRECTION", "message": "wrong direction"}
        else: out = {"ok": True, "embedding": emb(f0.split(":", 1)[1]), "quality": {"detection": 0.99}, "model": "fake"}
        data = json.dumps(out).encode(); self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", 8001), H).serve_forever()
