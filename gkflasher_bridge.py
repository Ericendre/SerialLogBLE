import json
import queue
import re
import subprocess
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

try:
    import serial.tools.list_ports
except Exception:  # pragma: no cover
    serial = None


ROOT = Path(__file__).resolve().parent
GKFLASHER = ROOT / "GKFlasher" / "gkflasher.py"
LOGGING_PY = ROOT / "GKFlasher" / "flasher" / "logging.py"


def load_data_sources():
    import importlib.util
    spec = importlib.util.spec_from_file_location("gk_logging", LOGGING_PY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.data_sources


def build_hello(data_sources):
    fields = []
    for source in data_sources:
        for p in source["parameters"]:
            fields.append({"key": sanitize_key(p["name"]), "label": p["name"], "unit": p.get("unit", "")})
    return "HELLO " + json.dumps({"device": "GKFlasher", "schema": 1, "fields": fields}, ensure_ascii=False)


def sanitize_key(name):
    s = re.sub(r"[^a-zA-Z0-9]+", "_", name.strip().lower())
    return re.sub(r"^_+|_+$", "", s)


class GKFlasherBridge:
    def __init__(self):
        self.proc = None
        self.reader_thread = None
        self.stop_event = threading.Event()
        self.clients = []
        self.clients_lock = threading.Lock()
        self.data_sources = load_data_sources()
        self.param_list = []
        for src in self.data_sources:
            for p in src["parameters"]:
                self.param_list.append(p)
        self.hello_line = build_hello(self.data_sources)
        self.current_values = []

    def list_ports(self):
        if not hasattr(serial, "tools"):
            return []
        ports = []
        for p in serial.tools.list_ports.comports():
            ports.append({"port": p.device, "description": p.description})
        return ports

    def broadcast(self, payload):
        data = json.dumps(payload, ensure_ascii=False)
        with self.clients_lock:
            dead = []
            for q in self.clients:
                try:
                    q.put_nowait(data)
                except Exception:
                    dead.append(q)
            for q in dead:
                self.clients.remove(q)

    def add_client(self, q):
        with self.clients_lock:
            self.clients.append(q)
        self.broadcast({"type": "line", "text": self.hello_line})

    def stop(self):
        self.stop_event.set()
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
            except Exception:
                pass
        if self.reader_thread:
            self.reader_thread.join(timeout=2)
        self.proc = None
        self.reader_thread = None

    def start(self, port):
        self.stop()
        self.stop_event.clear()
        cmd = [
            sys.executable,
            str(GKFLASHER),
            "--protocol",
            "kline",
            "--interface",
            port,
            "-b",
            "120000",
            "-l",
        ]
        self.proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        self.broadcast({"type": "log", "text": "Serveur: lancement GKFlasher sur " + port})
        self.reader_thread = threading.Thread(target=self._reader_loop, daemon=True)
        self.reader_thread.start()

    def _reader_loop(self):
        self.current_values = []
        param_index = 0
        try:
            for line in self.proc.stdout:
                if self.stop_event.is_set():
                    break
                line = line.strip()
                if not line:
                    continue
                self.broadcast({"type": "log", "text": line})
                if param_index >= len(self.param_list):
                    param_index = 0
                    self.current_values = []
                expected = self.param_list[param_index]
                name = expected["name"]
                unit = expected.get("unit", "")
                if line.startswith(name + ":"):
                    raw = line[len(name) + 1 :].strip()
                    if unit and raw.endswith(unit):
                        raw = raw[: -len(unit)]
                    raw = raw.strip()
                    try:
                        value = float(raw)
                    except ValueError:
                        value = float("nan")
                    self.current_values.append(value)
                    param_index += 1
                    if param_index >= len(self.param_list):
                        ts = int(time.time() * 1000)
                        csv = "DATA " + ",".join([str(ts)] + [str(v) for v in self.current_values])
                        self.broadcast({"type": "line", "text": csv})
                        param_index = 0
                        self.current_values = []
        finally:
            self.broadcast({"type": "log", "text": "Serveur: GKFlasher termine"})


BRIDGE = GKFlasherBridge()


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, payload, status=HTTPStatus.OK):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/ports":
            return self._send_json(BRIDGE.list_ports())
        if parsed.path == "/api/stream":
            return self._handle_stream()
        return self._serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/start":
            params = parse_qs(parsed.query)
            port = params.get("port", [""])[0]
            if not port:
                return self._send_json({"error": "missing port"}, status=HTTPStatus.BAD_REQUEST)
            BRIDGE.start(port)
            return self._send_json({"ok": True})
        if parsed.path == "/api/stop":
            BRIDGE.stop()
            return self._send_json({"ok": True})
        return self._send_json({"error": "not found"}, status=HTTPStatus.NOT_FOUND)

    def _handle_stream(self):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        q = queue.Queue()
        BRIDGE.add_client(q)
        try:
            while True:
                data = q.get()
                payload = f"data: {data}\n\n".encode("utf-8")
                self.wfile.write(payload)
                self.wfile.flush()
        except Exception:
            return

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        file_path = ROOT / path.lstrip("/")
        if not file_path.exists() or not file_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        content = file_path.read_bytes()
        if file_path.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        elif file_path.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"
        elif file_path.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        else:
            content_type = "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main():
    host = "127.0.0.1"
    port = 8765
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Serveur GKFlasher bridge: http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
