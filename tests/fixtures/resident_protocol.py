"""CPU-only external process fixture, never GPU inference evidence."""
import json
import os
import sys
import time
from threading import Thread

print(json.dumps({'event': 'ready', 'pid': os.getpid(), 'load_count': 1}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    if request['op'] == 'shutdown':
        break
    if request['op'] == 'cancel':
        continue
    if request['payload'].get('stream'):
        print(json.dumps({'id': request['id'], 'event': 'text', 'text': request['payload']['messages'][-1]['content']}), flush=True)
        print(json.dumps({'id': request['id'], 'event': 'done'}), flush=True)
        continue
    if request['payload'].get('late'):
        def late(request=request):
            time.sleep(.25)
            print(json.dumps({'id':request['id'],'event':'result','value':'old'}),flush=True)
            print(json.dumps({'id':request['id'],'event':'done'}),flush=True)
        print(json.dumps({'id':request['id'],'event':'started'}),flush=True)
        Thread(target=late).start()
        continue
    print(json.dumps({'id': request['id'], 'event': 'result', 'pid': os.getpid(), 'value': request['payload']['value']}), flush=True)
    print(json.dumps({'id': request['id'], 'event': 'done'}), flush=True)
