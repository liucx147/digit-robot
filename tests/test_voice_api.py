import io
import json
from pathlib import Path
import struct
from threading import Event
from concurrent.futures import ThreadPoolExecutor
import wave

from fastapi.testclient import TestClient

from digit_robot.voice import VoicePipeline
from digit_robot.server import create_app


def wav_bytes() -> bytes:
    data = io.BytesIO()
    with wave.open(data, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(struct.pack("<h", 1000) * 1600)
    return data.getvalue()


class ModelFixture:
    def transcribe(self, audio: Path, output_dir: Path, cancel: Event) -> str:
        return "我今天考试没考好，很难过。"

    def generate(self, messages: list[dict[str, str]], output_dir: Path, cancel: Event) -> str:
        return json.dumps({"user_emotion": "sadness", "reply": "听起来你很失落，我愿意陪你一起想办法。",
                           "expression_intent": {"style": "gentle", "intensity": 0.4}}, ensure_ascii=False)

    def synthesize(self, text: str, intent: dict, output_dir: Path, cancel: Event) -> Path:
        path = output_dir / "reply.wav"
        path.write_bytes(wav_bytes())
        return path


def test_text_turn_returns_playable_audio_and_expression(tmp_path: Path) -> None:
    client = TestClient(create_app(VoicePipeline(ModelFixture(), tmp_path)))
    session = client.post("/v1/sessions").json()
    response = client.post(f"/v1/sessions/{session['session_id']}/text",
                           json={"text": "我考试没考好", "session_epoch": 0})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["user_emotion"] == "sadness"
    assert result["expression_intent"]["style"] == "gentle"
    assert result["session_epoch"] == 0
    assert result["state"] == "ready"
    audio = client.get(result["audio"]["url"])
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/wav"
    assert audio.content == wav_bytes()


def test_wav_turn_provides_transcription_and_original_identifiers(tmp_path: Path) -> None:
    client = TestClient(create_app(VoicePipeline(ModelFixture(), tmp_path)))
    sid = client.post("/v1/sessions").json()["session_id"]
    response = client.post(f"/v1/sessions/{sid}/audio", content=wav_bytes(),
                           headers={"Content-Type": "audio/wav", "X-Session-Epoch": "0"})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["transcript"] == "我今天考试没考好，很难过。"
    assert result["session_id"] == sid
    assert result["utterance_id"] in result["audio"]["url"]
    assert result["timings_ms"]["asr_ms"] >= 0


def test_reset_expires_old_audio_and_stale_requests(tmp_path: Path) -> None:
    client = TestClient(create_app(VoicePipeline(ModelFixture(), tmp_path)))
    sid = client.post("/v1/sessions").json()["session_id"]
    old = client.post(f"/v1/sessions/{sid}/text", json={"text": "难过", "session_epoch": 0}).json()
    assert client.post(f"/v1/sessions/{sid}/reset").json()["session_epoch"] == 1
    assert client.get(old["audio"]["url"]).status_code == 410
    stale = client.post(f"/v1/sessions/{sid}/text", json={"text": "难过", "session_epoch": 0})
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_epoch"


def test_stop_during_generation_does_not_publish_delayed_audio(tmp_path: Path) -> None:
    entered, release = Event(), Event()

    class DelayedModel(ModelFixture):
        def generate(self, messages: list[dict[str, str]], output_dir: Path, cancel: Event) -> str:
            entered.set()
            assert release.wait(5)
            return super().generate(messages, output_dir, cancel)

    client = TestClient(create_app(VoicePipeline(DelayedModel(), tmp_path)))
    sid = client.post("/v1/sessions").json()["session_id"]
    with ThreadPoolExecutor() as executor:
        pending = executor.submit(client.post, f"/v1/sessions/{sid}/text",
                                  json={"text": "难过", "session_epoch": 0})
        assert entered.wait(5)
        try:
            stopped = client.post(f"/v1/sessions/{sid}/stop").json()
            assert stopped["session_epoch"] == 1
            assert stopped["state"] == "stopped"
        finally:
            release.set()
        response = pending.result(timeout=5)
    assert response.status_code == 409
    assert response.json()["code"] == "turn_cancelled"
    assert client.get(f"/v1/sessions/{sid}").json()["state"] == "stopped"


def test_bad_audio_and_empty_transcription_do_not_fake_success(tmp_path: Path) -> None:
    class EmptyAsr(ModelFixture):
        def transcribe(self, audio: Path, output_dir: Path, cancel: Event) -> str:
            return ""

    client = TestClient(create_app(VoicePipeline(EmptyAsr(), tmp_path)))
    sid = client.post("/v1/sessions").json()["session_id"]
    route = f"/v1/sessions/{sid}/audio"
    headers = {"Content-Type": "audio/wav", "X-Session-Epoch": "0"}
    assert client.post(route, content=b"not a wav", headers=headers).status_code == 422
    empty = client.post(route, content=wav_bytes(), headers=headers)
    assert empty.status_code == 422
    assert empty.json()["code"] == "empty_transcript"


def test_invalid_model_output_is_failure_without_audio(tmp_path: Path) -> None:
    class InvalidModel(ModelFixture):
        def generate(self, messages: list[dict[str, str]], output_dir: Path, cancel: Event) -> str:
            return "bad json"

    client = TestClient(create_app(VoicePipeline(InvalidModel(), tmp_path)))
    sid = client.post("/v1/sessions").json()["session_id"]
    failed = client.post(f"/v1/sessions/{sid}/text", json={"text": "难过", "session_epoch": 0})
    assert failed.status_code == 502
    assert failed.json()["code"] == "dialogue_failed"
    assert all(row["error"] for row in failed.json()["attempts"])
    assert "audio" not in failed.json()


def test_input_limits_and_cors_are_visible_to_browser(tmp_path: Path) -> None:
    client = TestClient(create_app(VoicePipeline(ModelFixture(), tmp_path), ["http://localhost:5173"]))
    sid = client.post("/v1/sessions").json()["session_id"]
    route = f"/v1/sessions/{sid}/audio"
    assert client.post(route, content=wav_bytes(), headers={"Content-Type": "audio/webm"}).status_code == 415
    assert client.post(route, content=wav_bytes(), headers={"Content-Type": "audio/wav"}).status_code == 400
    assert client.post(route, content=b"0" * (6 * 1024 * 1024 + 1),
                       headers={"Content-Type": "audio/wav", "X-Session-Epoch": "0"}).status_code == 413
    assert client.post(f"/v1/sessions/{sid}/text", json={"text": "ok", "session_epoch": True}).status_code == 400
    preflight = client.options(route, headers={"Origin": "http://localhost:5173",
                                              "Access-Control-Request-Method": "POST",
                                              "Access-Control-Request-Headers": "X-Session-Epoch,Content-Type"})
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_tts_error_is_visible_and_next_turn_can_recover(tmp_path: Path) -> None:
    class FailingTts(ModelFixture):
        broken = True

        def synthesize(self, text: str, intent: dict, output_dir: Path, cancel: Event) -> Path:
            if self.broken:
                raise RuntimeError("fixture TTS failure")
            return super().synthesize(text, intent, output_dir, cancel)

    model = FailingTts()
    client = TestClient(create_app(VoicePipeline(model, tmp_path)))
    sid = client.post("/v1/sessions").json()["session_id"]
    route = f"/v1/sessions/{sid}/text"
    failed = client.post(route, json={"text": "难过", "session_epoch": 0})
    assert failed.status_code == 502
    assert client.get(f"/v1/sessions/{sid}").json()["state"] == "error"
    model.broken = False
    assert client.post(route, json={"text": "再试试", "session_epoch": 0}).status_code == 200


def test_stop_during_tts_rejects_late_audio_and_single_gpu_is_exclusive(tmp_path: Path) -> None:
    entered, release = Event(), Event()

    class DelayedTts(ModelFixture):
        def synthesize(self, text: str, intent: dict, output_dir: Path, cancel: Event) -> Path:
            entered.set()
            assert release.wait(5)
            return super().synthesize(text, intent, output_dir, cancel)

    client = TestClient(create_app(VoicePipeline(DelayedTts(), tmp_path)))
    sid = client.post("/v1/sessions").json()["session_id"]
    other = client.post("/v1/sessions").json()["session_id"]
    with ThreadPoolExecutor() as executor:
        pending = executor.submit(client.post, f"/v1/sessions/{sid}/text", json={"text": "难过", "session_epoch": 0})
        assert entered.wait(5)
        try:
            uid = client.get(f"/v1/sessions/{sid}").json()["utterance_id"]
            busy = client.post(f"/v1/sessions/{other}/text", json={"text": "你好", "session_epoch": 0})
            assert busy.status_code == 409 and busy.json()["code"] == "gpu_busy"
            client.post(f"/v1/sessions/{sid}/stop")
        finally:
            release.set()
        assert pending.result(timeout=5).status_code == 409
    assert client.get(f"/v1/sessions/{sid}/turns/{uid}/audio").status_code == 404
    assert client.post(f"/v1/sessions/{other}/text", json={"text": "你好", "session_epoch": 0}).status_code == 200


def test_browser_and_api_share_origin_without_exposing_runtime_files(tmp_path: Path) -> None:
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<h1>数字人</h1>", encoding="utf-8")
    (web / "measurement.html").write_text("measurement", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("private", encoding="utf-8")
    client = TestClient(create_app(VoicePipeline(ModelFixture(), tmp_path / "runs"), web_dir=web))
    assert "数字人" in client.get("/").text
    assert client.get("/measurement.html").text == "measurement"
    assert client.get("/v1/health").json()["api_version"] == "0.2.0"
    assert client.post("/v1/sessions").json()["session_epoch"] == 0
    assert client.get("/%2e%2e/secret.txt").status_code == 404
