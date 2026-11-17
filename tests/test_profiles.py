import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

from fastapi.testclient import TestClient

from digit_robot.server import create_app
from digit_robot.voice import VoicePipeline
from test_voice_api import ModelFixture


class RecordingModels(ModelFixture):
    def __init__(self):
        self.prompts = []

    def generate(self, messages, output_dir, cancel):
        self.prompts.append(messages)
        return super().generate(messages, output_dir, cancel)


def setup(tmp_path, models=None):
    models = models or RecordingModels()
    pipeline = VoicePipeline(models, tmp_path)
    return TestClient(create_app(pipeline)), pipeline, models


def profile(client, name='甲'):
    response = client.post('/v1/profiles', json={'display_name': name})
    assert response.status_code == 201, response.text
    return response.json()['profile_id']


def test_profile_crud_persists_and_validates_input(tmp_path: Path):
    client, _, _ = setup(tmp_path)
    pid = profile(client)
    assert client.post('/v1/profiles', json={'display_name': '甲'}).status_code == 409
    for body in [{}, {'display_name': ' '}, {'display_name': 2}, {'display_name': '乙', 'extra': True}]:
        assert client.post('/v1/profiles', json=body).status_code == 422
    assert client.patch(f'/v1/profiles/{pid}', json={'display_name': '新甲'}).json()['profile']['display_name'] == '新甲'
    prefs = {'preferred_name': '小青', 'communication_style': '简短温和'}
    assert client.patch(f'/v1/profiles/{pid}/preferences', json=prefs).status_code == 200
    restarted, _, _ = setup(tmp_path)
    assert restarted.get(f'/v1/profiles/{pid}/preferences').json() == prefs
    assert len(restarted.get('/v1/profiles').json()['profiles']) == 1
    assert restarted.get(f'/v1/profiles/{pid}').headers.get('cache-control') == 'no-store'
    assert restarted.delete(f'/v1/profiles/{pid}').json()['deleted']
    assert restarted.get(f'/v1/profiles/{pid}').status_code == 404
    assert restarted.get('/v1/profiles').json() == {'profiles': []}


def test_mutations_clear_old_history_and_expire_audio_for_all_bound_sessions(tmp_path: Path):
    client, pipeline, models = setup(tmp_path)
    pid = profile(client)
    client.patch(f'/v1/profiles/{pid}/preferences', json={'preferred_name': '旧称呼'})
    sessions = [client.post('/v1/sessions', json={'profile_id': pid}).json() for _ in range(2)]
    sid = sessions[0]['session_id']
    old = client.post(f'/v1/sessions/{sid}/text', json={'text': '你好', 'session_epoch': 0}).json()
    assert '旧称呼' in models.prompts[-1][0]['content']
    mutation = client.patch(f'/v1/profiles/{pid}/preferences', json={'preferred_name': '新称呼'}).json()
    assert len(mutation['affected_sessions']) == 2
    assert all(s['session_epoch'] == 1 for s in mutation['affected_sessions'])
    assert client.get(old['audio']['url']).status_code == 410
    assert not pipeline.sessions[sid].history
    client.post(f'/v1/sessions/{sid}/text', json={'text': '继续', 'session_epoch': 1})
    prompt = json.dumps(models.prompts[-1], ensure_ascii=False)
    assert '新称呼' in prompt and '旧称呼' not in prompt
    client.delete(f'/v1/profiles/{pid}/preferences')
    client.post(f'/v1/sessions/{sid}/text', json={'text': '继续', 'session_epoch': 2})
    assert '新称呼' not in json.dumps(models.prompts[-1], ensure_ascii=False)


def test_profile_switch_reset_delete_and_anonymous_compatibility(tmp_path: Path):
    client, pipeline, models = setup(tmp_path)
    first, second = profile(client), profile(client, '乙')
    client.patch(f'/v1/profiles/{first}/preferences', json={'preferred_name': '甲专属称呼'})
    session = client.post('/v1/sessions').json()
    assert session['profile_id'] is None
    sid = session['session_id']
    assert client.post(f'/v1/sessions/{sid}/profile', json={'profile_id': first, 'session_epoch': 0}).json()['session_epoch'] == 1
    client.post(f'/v1/sessions/{sid}/text', json={'text': '你好', 'session_epoch': 1})
    assert client.post(f'/v1/sessions/{sid}/reset').json()['profile_id'] == first
    switched = client.post(f'/v1/sessions/{sid}/profile', json={'profile_id': second, 'session_epoch': 2}).json()
    assert switched['session_epoch'] == 3 and not pipeline.sessions[sid].history
    client.post(f'/v1/sessions/{sid}/text', json={'text': '你好', 'session_epoch': 3})
    assert '甲专属称呼' not in json.dumps(models.prompts[-1], ensure_ascii=False)
    assert client.post(f'/v1/sessions/{sid}/profile', json={'profile_id': first, 'session_epoch': 1}).status_code == 409
    deleted = client.delete(f'/v1/profiles/{second}').json()['affected_sessions'][0]
    assert deleted['profile_id'] is None and deleted['session_epoch'] == 4


def test_preference_update_cancels_inflight_answer_and_new_turn_recovers(tmp_path: Path):
    entered, release = Event(), Event()

    class Delayed(RecordingModels):
        def generate(self, messages, output_dir, cancel):
            entered.set()
            assert release.wait(5)
            return super().generate(messages, output_dir, cancel)

    client, _, _ = setup(tmp_path, Delayed())
    pid = profile(client)
    sid = client.post('/v1/sessions', json={'profile_id': pid}).json()['session_id']
    with ThreadPoolExecutor() as executor:
        future = executor.submit(client.post, f'/v1/sessions/{sid}/text', json={'text': '你好', 'session_epoch': 0})
        assert entered.wait(5)
        try:
            changed = client.patch(f'/v1/profiles/{pid}/preferences', json={'preferred_name': '新称呼'})
            assert changed.status_code == 200
        finally:
            release.set()
        assert future.result().status_code == 409
    assert client.post(f'/v1/sessions/{sid}/text', json={'text': '你好', 'session_epoch': 1}).status_code == 200


def test_database_write_failure_does_not_invalidate_session_or_expose_details(tmp_path: Path):
    import sqlite3
    client, _, _ = setup(tmp_path)
    pid = profile(client)
    sid = client.post('/v1/sessions', json={'profile_id': pid}).json()['session_id']
    with sqlite3.connect(tmp_path/'profiles.sqlite3') as blocker:
        blocker.execute('BEGIN EXCLUSIVE')
        failure = client.patch(f'/v1/profiles/{pid}/preferences', json={'preferred_name': '秘密测试值'})
        assert failure.status_code == 503
        assert '秘密测试值' not in failure.text and 'locked' not in failure.text
        assert client.get(f'/v1/sessions/{sid}').json()['session_epoch'] == 0
    assert client.get(f'/v1/profiles/{pid}/preferences').json()['preferred_name'] is None


def test_v2_profile_context_and_clear_use_current_snapshot(tmp_path: Path):
    from digit_robot.sentence_pipeline import SentencePipeline
    from test_sentence_api import StreamingFixture

    class Capturing(StreamingFixture):
        def __init__(self):
            super().__init__()
            self.release.set()
            self.prompts = []

        def stream_reply(self, messages, cancel):
            self.prompts.append(messages)
            yield from super().stream_reply(messages, cancel)

    models = Capturing()
    client = TestClient(create_app(SentencePipeline(models, tmp_path, tts_workers=2)))
    pid = profile(client)
    client.patch(f'/v1/profiles/{pid}/preferences', json={'preferred_name': '青禾'})
    sid = client.post('/v1/sessions', json={'profile_id': pid}).json()['session_id']
    first = client.post(f'/v2/sessions/{sid}/text', json={'text': '你好', 'session_epoch': 0})
    events = [json.loads(line) for line in first.text.splitlines()]
    assert events[-1]['type'] == 'done'
    assert '青禾' in models.prompts[-1][0]['content']
    client.delete(f'/v1/profiles/{pid}/preferences')
    assert client.get(next(e['audio']['url'] for e in events if e['type'] == 'audio_ready')).status_code == 410
    client.post(f'/v2/sessions/{sid}/text', json={'text': '继续', 'session_epoch': 1})
    assert '青禾' not in json.dumps(models.prompts[-1], ensure_ascii=False)


def test_profile_protocol_validation_and_cors(tmp_path: Path):
    client, pipeline, _ = setup(tmp_path)
    pid = profile(client)
    sid = client.post('/v1/sessions').json()['session_id']
    for body in [{}, {'preferred_name': True}, {'communication_style': '长'*501}, {'unknown': 'x'}]:
        assert client.patch(f'/v1/profiles/{pid}/preferences', json=body).status_code == 422
    assert client.patch(f'/v1/profiles/{pid}/preferences', json={'preferred_name': ' '}).json()['profile']['preferences']['preferred_name'] is None
    assert client.post('/v1/sessions', json={'profile_id': 1}).status_code == 422
    assert client.post('/v1/sessions', json={'profile_id': 'missing'}).status_code == 404
    assert client.post(f'/v1/sessions/{sid}/profile', json={'profile_id': None, 'session_epoch': True}).status_code == 422
    cors = TestClient(create_app(pipeline, ['http://localhost:8765']))
    response = cors.options(f'/v1/profiles/{pid}/preferences', headers={'Origin': 'http://localhost:8765', 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'Content-Type'})
    assert response.status_code == 200
    for method, path, status in [('PUT', '/v1/profiles', 405), ('GET', '/v1/profiles/missing/unknown', 404)]:
        error = client.request(method, path)
        assert error.status_code == status
        assert error.headers.get('cache-control') == 'no-store'
