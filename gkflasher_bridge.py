import json
import queue
import re
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

try:
    import serial.tools.list_ports
except Exception:
    serial = None

ROOT = Path(__file__).resolve().parent
GKFLASHER_DIR = ROOT / "GKFlasher"
GKBUS_DIR = ROOT / "gkbus-main"

if str(GKBUS_DIR) not in sys.path:
    sys.path.insert(0, str(GKBUS_DIR))
if str(GKFLASHER_DIR) not in sys.path:
    sys.path.insert(0, str(GKFLASHER_DIR))

from gkbus.hardware.kline_hardware import KLineHardware
from gkbus.transport import Kwp2000OverKLineTransport
from gkbus.protocol import kwp2000
from gkbus.protocol.kwp2000 import commands, enums
from ecu_definitions import ECU_IDENTIFICATION_TABLE


DATA_SOURCES = [
    {
        "id": 0x01,
        "parameters": [
            {"name": "Oxygen Sensor-Bank1/Sensor1", "unit": "mV", "position": 38, "size": 2, "conv": lambda a: a * 4.883, "precision": 1},
            {"name": "Air Flow Rate from Mass Air Flow Sensor", "unit": "kg/h", "position": 15, "size": 2, "conv": lambda a: a * 0.03125, "precision": 2},
            {"name": "Engine Coolant Temperature Sensor", "unit": "C", "position": 4, "size": 1, "conv": lambda a: a * 0.75, "precision": 2},
            {"name": "Oil Temperature Sensor", "unit": "C", "position": 6, "size": 1, "conv": lambda a: (a * 1) - 40, "precision": 2},
            {"name": "Intake Air Temperature Sensor", "unit": "C", "position": 9, "size": 1, "conv": lambda a: (a * 0.75) - 48, "precision": 2},
            {"name": "Throttle Position", "unit": "'", "position": 11, "size": 1, "conv": lambda a: a * 0.468627, "precision": 2},
            {"name": "Battery voltage", "unit": "V", "position": 1, "size": 1, "conv": lambda a: a * 0.10159, "precision": 2},
            {"name": "Vehicle Speed", "unit": "km/h", "position": 30, "size": 1, "conv": lambda a: a, "precision": 1},
            {"name": "Engine Speed", "unit": "RPM", "position": 31, "size": 2, "conv": lambda a: a, "precision": 1},
            {"name": "Oxygen Sensor-Bank1/Sensor2", "unit": "mV", "position": 40, "size": 2, "conv": lambda a: a * 4.883, "precision": 2},
            {"name": "Ignition Timing Advance for 1 Cylinder", "unit": "'", "position": 58, "size": 1, "conv": lambda a: (a * -0.325) - 72, "precision": 2},
            {"name": "Cylinder Injection Time-Bank1", "unit": "ms", "position": 76, "size": 2, "conv": lambda a: a * 0.004, "precision": 2},
            {"name": "Long Term Fuel Trim-Idle Load", "unit": "ms", "position": 89, "size": 2, "conv": lambda a: a * 0.004, "precision": 2},
            {"name": "Long Term Fuel Trim-Part Load", "unit": "%", "position": 91, "size": 2, "conv": lambda a: a * 0.001529, "precision": 2},
            {"name": "Camshaft Actual Position", "unit": "'", "position": 142, "size": 1, "conv": lambda a: (a * 0.375) - 60, "precision": 2},
            {"name": "Camshaft position target", "unit": "'", "position": 143, "size": 1, "conv": lambda a: (a * 0.375) - 60, "precision": 2},
            {"name": "Ignition dwell time", "unit": "ms", "position": 106, "size": 2, "conv": lambda a: a * 0.004, "precision": 2},
            {"name": "EVAP Purge valve", "unit": "%", "position": 101, "size": 2, "conv": lambda a: a * 0.003052, "precision": 2},
            {"name": "Idle speed control actuator", "unit": "%", "position": 99, "size": 2, "conv": lambda a: a * 0.001529, "precision": 2},
            {"name": "CVVT Valve Duty", "unit": "%", "position": 156, "size": 2, "conv": lambda a: a * 0.001526, "precision": 2},
            {"name": "Oxygen Sensor Heater Duty-Bank1/Sensor1", "unit": "%", "position": 93, "size": 1, "conv": lambda a: a * 0.390625, "precision": 2},
            {"name": "Oxygen Sensor Heater Duty-Bank1/Sensor2", "unit": "%", "position": 94, "size": 1, "conv": lambda a: a * 0.390625, "precision": 2},
            {"name": "CVVT Status", "unit": "", "position": 145, "size": 1, "conv": lambda a: a, "precision": 1},
            {"name": "CVVT Actuation Status", "unit": "", "position": 146, "size": 1, "conv": lambda a: a, "precision": 1},
            {"name": "CVVT Duty Control Status", "unit": "", "position": 160, "size": 1, "conv": lambda a: a, "precision": 1},
        ],
    }
]


def sanitize_key(name):
    s = re.sub(r"[^a-zA-Z0-9]+", "_", name.strip().lower())
    return re.sub(r"^_+|_+$", "", s)


def build_hello():
    fields = []
    for source in DATA_SOURCES:
        for p in source["parameters"]:
            fields.append({"key": sanitize_key(p["name"]), "label": p["name"], "unit": p.get("unit", "")})
    return "HELLO " + json.dumps({"device": "GKBus", "schema": 1, "fields": fields}, ensure_ascii=False)


def calculate_key(seed):
    key = 0x9360
    for _ in range(0x24):
        key = (key * 2) ^ seed
    return key & 0xFFFF


def enable_security_access(bus):
    resp = bus.execute(commands.SecurityAccess(enums.AccessType.PROGRAMMING_REQUEST_SEED)).get_data()
    seed = list(resp)[1:]
    if len(seed) < 2:
        return
    if seed[0] == 0x00 and seed[1] == 0x00:
        return
    seed_concat = ((seed[0] << 8) | seed[1]) & 0xFFFF
    key = calculate_key(seed_concat)
    bus.execute(commands.SecurityAccess(enums.AccessType.PROGRAMMING_SEND_KEY, key))


def read_memory_by_address(bus, offset, size):
    return list(bus.execute(commands.ReadMemoryByAddress(offset=offset, size=size)).get_data())


def identify_ecu(bus):
    for entry in ECU_IDENTIFICATION_TABLE:
        expected_list = entry["expected"]
        size = len(expected_list[0])
        try:
            result = read_memory_by_address(bus, entry["offset"], size)
        except Exception:
            continue
        for expected in expected_list:
            if result == expected:
                return entry["ecu"]
    return None


def grab(payload, param):
    start = param["position"]
    size = param["size"]
    chunk = payload[start:start + size]
    if len(chunk) != size:
        return float("nan")
    raw = int.from_bytes(bytes(chunk), "little")
    return round(param["conv"](raw), param["precision"])


class GKBusBridge:
    def __init__(self):
        self.thread = None
        self.stop_event = threading.Event()
        self.clients = []
        self.clients_lock = threading.Lock()
        self.hello_line = build_hello()
        self.bus = None

    def list_ports(self):
        if not hasattr(serial, "tools"):
            return []
        ports = []
        for p in serial.tools.list_ports.comports():
            ports.append({"port": p.device, "description": p.description, "vid": p.vid, "pid": p.pid})
        return ports

    def select_port_by_vid_pid(self, vid, pid):
        if not hasattr(serial, "tools"):
            return None
        for p in serial.tools.list_ports.comports():
            if p.vid == vid and p.pid == pid:
                return p.device
        return None

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
        if self.thread:
            self.thread.join(timeout=2)
        self.thread = None
        if self.bus:
            try:
                self.bus.close()
            except Exception:
                pass
        self.bus = None

    def start(self, port):
        self.stop()
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run, args=(port,), daemon=True)
        self.thread.start()

    def _run(self, port):
        try:
            self.broadcast({"type": "log", "text": "Serveur: demarrage GKBus sur " + port})
            hardware = KLineHardware(port, baudrate=120000, timeout=2)
            transport = Kwp2000OverKLineTransport(hardware, tx_id=0x11, rx_id=0xF1)
            bus = kwp2000.Kwp2000Protocol(transport)
            self.bus = bus

            try:
                bus.execute(commands.StopDiagnosticSession())
                bus.execute(commands.StopCommunication())
            except Exception:
                pass

            bus.init(commands.StartCommunication(), commands.TesterPresent(enums.ResponseType.REQUIRED), keepalive_delay=1.5)

            self.broadcast({"type": "log", "text": "Trying to start diagnostic session"})
            bus.execute(commands.StartDiagnosticSession(enums.DiagnosticSession.FLASH_REPROGRAMMING))
            transport.hardware.set_timeout(12)

            self.broadcast({"type": "log", "text": "Set timing parameters to maximum"})
            try:
                available = bus.execute(commands.AccessTimingParameters().read_limits_of_possible_timing_parameters()).get_data()
                bus.execute(commands.AccessTimingParameters().set_timing_parameters_to_given_values(*available[1:]))
            except Exception:
                self.broadcast({"type": "log", "text": "Timing params not supported"})

            self.broadcast({"type": "log", "text": "Security Access"})
            try:
                enable_security_access(bus)
            except Exception:
                self.broadcast({"type": "log", "text": "Security access failed"})

            self.broadcast({"type": "log", "text": "Trying to identify ECU automatically.."})
            ecu = identify_ecu(bus)
            if ecu:
                self.broadcast({"type": "log", "text": "Found! " + ecu["name"]})
                try:
                    calib = read_memory_by_address(bus, 0x090000 + ecu["memory_offset"], 8)
                    desc = read_memory_by_address(bus, 0x090040 + ecu["memory_offset"], 8)
                    calib_s = "".join(chr(x) for x in calib)
                    desc_s = "".join(chr(x) for x in desc)
                    self.broadcast({"type": "log", "text": "Found! Description: " + desc_s + ", calibration: " + calib_s})
                except Exception:
                    self.broadcast({"type": "log", "text": "Calibration read failed"})
            else:
                self.broadcast({"type": "log", "text": "ECU identification failed"})

            self.broadcast({"type": "log", "text": "Building parameter header"})
            self.broadcast({"type": "line", "text": self.hello_line})

            self.broadcast({"type": "log", "text": "Logging.."})
            bus.execute(commands.StartDiagnosticSession(enums.DiagnosticSession.DEFAULT))

            while not self.stop_event.is_set():
                values = []
                for source in DATA_SOURCES:
                    resp = bus.execute(commands.ReadDataByLocalIdentifier(source["id"])).get_data()
                    raw = list(resp)
                    for param in source["parameters"]:
                        values.append(grab(raw, param))
                ts = int(time.time() * 1000)
                csv = "DATA " + ",".join([str(ts)] + [str(v) for v in values])
                self.broadcast({"type": "line", "text": csv})
                time.sleep(0.1)

        except Exception as e:
            self.broadcast({"type": "log", "text": "Serveur: erreur " + str(e)})
        finally:
            self.broadcast({"type": "log", "text": "Serveur: GKBus termine"})
            try:
                if self.bus:
                    self.bus.close()
            except Exception:
                pass


BRIDGE = GKBusBridge()


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
                vid = params.get("vid", [""])[0]
                pid = params.get("pid", [""])[0]
                if vid and pid:
                    try:
                        port = BRIDGE.select_port_by_vid_pid(int(vid), int(pid))
                    except ValueError:
                        port = None
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
    print(f"Serveur GKBus bridge: http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
