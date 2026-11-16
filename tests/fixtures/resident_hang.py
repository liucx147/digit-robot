"""Non-cooperative CPU process fixture; never model/GPU acceptance evidence."""
import json
import os
import sys
import time

print(json.dumps({'event': 'ready', 'pid': os.getpid(), 'load_count': 1}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    if request['op'] == 'shutdown':
        break
    if request['op'] != 'call':
        continue
    if request['payload'].get('close_rpc'):
        print('invalid-rpc-record', flush=True)
        os.close(0)
        while True:
            time.sleep(.1)
    if request['payload'].get('hang'):
        while True:
            time.sleep(.1)
    print(json.dumps({'id': request['id'], 'event': 'result', 'value': request['payload']['value']}), flush=True)
    print(json.dumps({'id': request['id'], 'event': 'done'}), flush=True)
