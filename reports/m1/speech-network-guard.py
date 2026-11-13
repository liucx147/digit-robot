"""Verification harness: deny Python Internet sockets, then run a public CLI."""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import socket
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--network-report", type=Path, required=True)
parser.add_argument("script", type=Path)
parser.add_argument("script_args", nargs=argparse.REMAINDER)
args = parser.parse_args()
attempts = []
original_connect = socket.socket.connect
original_connect_ex = socket.socket.connect_ex


def connect(sock, address):
    if sock.family in (socket.AF_INET, socket.AF_INET6):
        attempts.append(str(address))
        raise RuntimeError("Offline verification denied Internet socket.connect")
    return original_connect(sock, address)


def connect_ex(sock, address):
    if sock.family in (socket.AF_INET, socket.AF_INET6):
        attempts.append(str(address))
        raise RuntimeError("Offline verification denied Internet socket.connect_ex")
    return original_connect_ex(sock, address)


socket.socket.connect = connect
socket.socket.connect_ex = connect_ex
script = args.script.resolve()
sys.argv = [str(script), *args.script_args]
sys.path.insert(0, str(script.parent))
exit_code = 1
try:
    runpy.run_path(str(script), run_name="__main__")
    exit_code = 0
except SystemExit as error:
    exit_code = error.code if isinstance(error.code, int) else (0 if error.code is None else 1)
    raise
finally:
    args.network_report.parent.mkdir(parents=True, exist_ok=True)
    args.network_report.write_text(json.dumps({
        "method": "Python AF_INET/AF_INET6 connect and connect_ex denied before package import",
        "blocked_connection_attempts": attempts,
        "kernel_network_namespace_isolation": False,
        "script": str(script),
        "script_sha256": hashlib.sha256(script.read_bytes()).hexdigest(),
        "exit_code": exit_code,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
