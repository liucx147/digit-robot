from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
from pathlib import Path
import socket
from threading import Event, Thread
import time
import httpx
import uvicorn

from digit_robot.server import create_app
from digit_robot.sentence_pipeline import SentencePipeline
from test_voice_api import ModelFixture, wav_bytes


class StreamingFixture(ModelFixture):
    def __init__(self):
        self.release = Event()
        self.completed = Event()

    def stream_reply(self, messages, cancel):
        yield '{"type":"meta","user_emotion":"sadness","expression_intent":{"style":"gentle","intensity":0.5}}\n'
        yield '{"type":"sentence","text":"听起来你很难过。"}\n'
        while not self.release.wait(.01):
            if cancel.is_set():
                return
        yield '{"type":"sentence","text":"我们可以一起想办法。"}\n'
        self.completed.set()


@contextmanager
def serve(app):
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    base = f'http://127.0.0.1:{sock.getsockname()[1]}'
    server = uvicorn.Server(uvicorn.Config(app, log_level='error'))
    thread = Thread(target=server.run, kwargs={'sockets': [sock]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 5
        while not server.started:
            assert time.monotonic() < deadline
            time.sleep(.01)
        yield base
    finally:
        server.should_exit = True
        thread.join(5)
        sock.close()


def test_first_segment_crosses_real_http_before_llm_finishes_and_stop_expires_it(tmp_path: Path):
    models = StreamingFixture()
    with serve(create_app(SentencePipeline(models, tmp_path))) as base, httpx.Client(base_url=base, timeout=5) as client:
        assert client.get('/v1/health').json()['sentence_streaming'] is True
        session = client.post('/v1/sessions').json()
        assert session['sentence_streaming'] is True
        sid = session['session_id']
        try:
            with client.stream('POST', f'/v2/sessions/{sid}/audio', content=wav_bytes(),
                    headers={'Content-Type': 'audio/wav', 'X-Session-Epoch': '0'}) as response:
                assert response.status_code == 200
                events = (json.loads(line) for line in response.iter_lines() if line)
                for event in events:
                    if event['type'] == 'audio_ready':
                        break
                else:
                    raise AssertionError('No segment was delivered')
                assert event['segment_index'] == 0
                assert not models.completed.is_set(), 'first audio cannot wait for full generation'
                assert client.get(event['audio']['url']).content == wav_bytes()
                other = client.post('/v1/sessions').json()['session_id']
                busy = client.post(f'/v2/sessions/{other}/text', json={'text':'另一个用户', 'session_epoch':0})
                assert json.loads(busy.text)['code'] == 'gpu_busy'
                stopped = client.post(f'/v1/sessions/{sid}/stop').json()
                assert stopped['session_epoch'] == 1
                assert client.get(event['audio']['url']).status_code == 410
                remaining = list(events)
                assert remaining[-1]['type'] == 'error' and remaining[-1]['code'] == 'turn_cancelled'
        finally:
            models.release.set()


def test_complete_reply_contains_ordered_segments_and_separate_first_and_total_timing(tmp_path: Path):
    models = StreamingFixture()
    models.release.set()
    with serve(create_app(SentencePipeline(models, tmp_path))) as base, httpx.Client(base_url=base, timeout=5) as client:
        sid = client.post('/v1/sessions').json()['session_id']
        response = client.post(f'/v2/sessions/{sid}/text', json={'text':'今天难过', 'session_epoch':0})
        events = [json.loads(line) for line in response.text.splitlines()]
        assert events[-1]['type'] == 'done'
        assert [event['segment_index'] for event in events if event['type']=='audio_ready'] == [0,1]
        assert events[-1]['reply'] == '听起来你很难过。我们可以一起想办法。'
        timing = events[-1]['timings_ms']
        assert 0 <= timing['first_audio_ready_ms'] <= timing['all_audio_ready_ms']
        assert timing['first_token_ms'] <= timing['first_sentence_ms']
        assert len(list(tmp_path.rglob('result.json'))) == 1


def test_disconnect_cancels_only_its_own_turn_and_releases_admission(tmp_path: Path):
    models = StreamingFixture()
    with serve(create_app(SentencePipeline(models, tmp_path))) as base, httpx.Client(base_url=base, timeout=5) as client:
        sid = client.post('/v1/sessions').json()['session_id']
        try:
            with client.stream('POST', f'/v2/sessions/{sid}/text', json={'text':'难过', 'session_epoch':0}) as response:
                for line in response.iter_lines():
                    if json.loads(line)['type'] == 'audio_ready':
                        break
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                status = client.get(f'/v1/sessions/{sid}').json()
                if status['state'] == 'stopped':
                    break
                time.sleep(.02)
            assert status['state'] == 'stopped'
            assert status['session_epoch'] == 1
        finally:
            models.release.set()
