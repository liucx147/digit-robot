from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from threading import Event

from fastapi.testclient import TestClient
import pytest

from digit_robot.server import create_app
from digit_robot.sentence_pipeline import SentencePipeline
from digit_robot.voice import VoiceError, VoicePipeline
from test_voice_api import ModelFixture, wav_bytes


class ControlledModels(ModelFixture):
    def __init__(self, stage):
        self.stage = stage
        self.entered, self.release = Event(), Event()
        self.fail = False

    def gate(self, stage):
        if stage == self.stage:
            self.entered.set()
            assert self.release.wait(5)
            if self.fail:
                raise VoiceError('stage_timeout', '测试阶段超时', 504)

    def transcribe(self, audio, output_dir, cancel):
        self.gate('asr')
        return super().transcribe(audio, output_dir, cancel)

    def generate(self, messages, output_dir, cancel):
        self.gate('llm')
        return super().generate(messages, output_dir, cancel)

    def stream_reply(self, messages, cancel):
        self.gate('llm')
        yield '{"type":"meta","user_emotion":"sadness","expression_intent":{"style":"gentle","intensity":0.5}}\n'
        yield '{"type":"sentence","text":"我愿意陪你一起面对。"}\n'

    def synthesize(self, text, intent, output_dir, cancel):
        self.gate('tts')
        return super().synthesize(text, intent, output_dir, cancel)


@pytest.mark.parametrize('version', ['v1', 'v2'])
@pytest.mark.parametrize('stage', ['asr', 'llm', 'tts'])
def test_stop_at_each_model_stage_expires_late_results_and_next_turn_succeeds(tmp_path: Path, version, stage):
    models = ControlledModels(stage)
    pipeline = SentencePipeline(models, tmp_path) if version == 'v2' else VoicePipeline(models, tmp_path)
    client = TestClient(create_app(pipeline))
    sid = client.post('/v1/sessions').json()['session_id']
    def send(epoch):
        return client.post(f'/{version}/sessions/{sid}/audio', content=wav_bytes(), headers={'Content-Type': 'audio/wav', 'X-Session-Epoch': str(epoch)})
    with ThreadPoolExecutor() as executor:
        pending = executor.submit(send, 0)
        assert models.entered.wait(3)
        try:
            stopped = client.post(f'/v1/sessions/{sid}/stop').json()
            assert stopped['session_epoch'] == 1
        finally:
            models.release.set()
        response = pending.result()
    if version == 'v1':
        assert response.status_code == 409
    else:
        events = [json.loads(line) for line in response.text.splitlines()]
        assert events[-1]['code'] == 'turn_cancelled'
        assert not any(e['type'] in ('audio_ready', 'done') for e in events)
    assert not pipeline.sessions[sid].history and not pipeline.sessions[sid].audio
    assert not pipeline.gpu.locked()
    fresh = send(1)
    assert fresh.status_code == 200
    if version == 'v2':
        assert json.loads(fresh.text.splitlines()[-1])['type'] == 'done'


@pytest.mark.parametrize('version', ['v1', 'v2'])
@pytest.mark.parametrize('stage', ['asr', 'llm', 'tts'])
def test_stage_failure_is_visible_then_recovers_without_old_history(tmp_path: Path, version, stage):
    models = ControlledModels(stage)
    models.fail = True
    models.release.set()
    pipeline = SentencePipeline(models, tmp_path) if version == 'v2' else VoicePipeline(models, tmp_path)
    client = TestClient(create_app(pipeline))
    sid = client.post('/v1/sessions').json()['session_id']
    def send():
        return client.post(f'/{version}/sessions/{sid}/audio', content=wav_bytes(), headers={'Content-Type': 'audio/wav', 'X-Session-Epoch': '0'})
    failed = send()
    if version == 'v1':
        assert failed.status_code >= 500
    else:
        assert json.loads(failed.text.splitlines()[-1])['type'] == 'error'
    assert client.get(f'/v1/sessions/{sid}').json()['state'] == 'error'
    assert not pipeline.sessions[sid].history and not pipeline.gpu.locked()
    assert list(tmp_path.rglob('error.json'))
    models.fail = False
    fresh = send()
    assert fresh.status_code == 200
    assert client.get(f'/v1/sessions/{sid}').json()['state'] == 'ready'
