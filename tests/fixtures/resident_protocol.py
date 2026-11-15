"""CPU-only external process fixture, never GPU inference evidence."""
import json
import os
import sys

print(json.dumps({'event': 'ready', 'pid': os.getpid(), 'load_count': 1}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    if request['op'] == 'shutdown':
        break
    if request['op'] == 'cancel':
        continue
    print(json.dumps({'id': request['id'], 'event': 'result', 'pid': os.getpid(), 'value': request['payload']['value']}), flush=True)
    print(json.dumps({'id': request['id'], 'event': 'done'}), flush=True)
