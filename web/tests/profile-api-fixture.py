"""CPU-only browser fixture: real A API/SQLite, explicit synthetic model/audio.

Use PYTHONPATH pointing at a staged, verified A source commit. This file never
loads model weights or accesses a GPU. Its replies cannot verify model quality.
"""
import argparse
import json
from pathlib import Path
import math
import struct
import wave

import uvicorn
from digit_robot.server import create_app
from digit_robot.voice import VoicePipeline


class SyntheticModels:
    def transcribe(self, audio, output_dir, cancel):
        return '这是合成输入，不是真人录音。'

    def generate(self, messages, output_dir, cancel):
        return json.dumps({'user_emotion':'neutral','reply':'这是档案接口的软件联调。',
                           'expression_intent':{'style':'calm','intensity':0}},ensure_ascii=False)

    def synthesize(self, text, intent, output_dir, cancel):
        path=output_dir/'synthetic-tone.wav'
        with wave.open(str(path),'wb') as stream:
            stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(16000)
            stream.writeframes(b''.join(struct.pack('<h',int(6000*math.sin(i*2*math.pi*220/16000))) for i in range(16000)))
        return path


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--web-root',type=Path,required=True)
    parser.add_argument('--state-dir',type=Path,required=True)
    parser.add_argument('--port',type=int,default=18707)
    args=parser.parse_args()
    pipeline=VoicePipeline(SyntheticModels(),args.state_dir,profiles_db=args.state_dir/'synthetic-profiles.sqlite3')
    uvicorn.run(create_app(pipeline,web_dir=args.web_root),host='127.0.0.1',port=args.port)
