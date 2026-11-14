"""One GPU turn at a time, with epoch-checked publication and local WAV output."""

from dataclasses import dataclass, field
import json
from pathlib import Path
from threading import Event, Lock, RLock
import time
from typing import Any, Protocol
import uuid
import wave

from .dialogue import DialogueSession


class VoiceError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, **details: Any) -> None:
        super().__init__(message)
        self.status = status
        self.body = {"type": "error", "code": code, "message": message, **details}


class VoiceModels(Protocol):
    def transcribe(self, audio: Path, output_dir: Path, cancel: Event) -> str: ...
    def generate(self, messages: list[dict[str, str]], output_dir: Path, cancel: Event) -> str: ...
    def synthesize(self, text: str, intent: dict[str, Any], output_dir: Path, cancel: Event) -> Path: ...


@dataclass
class Session:
    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    epoch: int = 0
    history: list[dict[str, str]] = field(default_factory=list)
    state: str = "idle"
    utterance_id: str | None = None
    cancel: Event = field(default_factory=Event)
    audio: dict[str, tuple[int, Path]] = field(default_factory=dict)
    error: dict[str, Any] | None = None


def wav_info(path: Path) -> dict[str, Any]:
    try:
        with wave.open(str(path), "rb") as audio:
            frames, rate = audio.getnframes(), audio.getframerate()
            channels, width = audio.getnchannels(), audio.getsampwidth()
            data = audio.readframes(frames)
        if width != 2 or channels not in (1, 2) or not 8000 <= rate <= 48000:
            raise ValueError("需要 16-bit PCM、1/2 声道、8–48kHz WAV")
        if frames == 0 or len(data) != frames * channels * width or not any(data):
            raise ValueError("录音为空、全零或数据不完整")
    except (wave.Error, EOFError, ValueError) as error:
        raise VoiceError("invalid_audio", str(error), 422) from error
    return {"mime_type": "audio/wav", "sample_rate_hz": rate, "channels": channels,
            "duration_ms": round(frames / rate * 1000, 3)}


class _DialogueBackend:
    def __init__(self, models: VoiceModels, output_dir: Path, cancel: Event) -> None:
        self.models, self.output_dir, self.cancel = models, output_dir, cancel

    def generate(self, messages: list[dict[str, str]]) -> str:
        return self.models.generate(messages, self.output_dir, self.cancel)


class VoicePipeline:
    def __init__(self, models: VoiceModels, output_dir: Path) -> None:
        self.models, self.output_dir = models, output_dir.resolve()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.sessions: dict[str, Session] = {}
        self.lock, self.gpu = RLock(), Lock()

    def _session(self, session_id: str) -> Session:
        if session_id not in self.sessions:
            raise VoiceError("session_not_found", "会话不存在", 404)
        return self.sessions[session_id]

    def create_session(self) -> dict[str, Any]:
        with self.lock:
            session = Session()
            self.sessions[session.session_id] = session
            return self.status(session.session_id)

    def status(self, session_id: str) -> dict[str, Any]:
        with self.lock:
            session = self._session(session_id)
            return {"session_id": session_id, "session_epoch": session.epoch,
                    "state": session.state, "utterance_id": session.utterance_id,
                    "error": session.error}

    def invalidate(self, session_id: str, *, reset: bool) -> dict[str, Any]:
        with self.lock:
            session = self._session(session_id)
            session.cancel.set()
            session.epoch += 1
            session.state = "idle" if reset else "stopped"
            session.utterance_id, session.error = None, None
            if reset:
                session.history.clear()
            return self.status(session_id)

    def _phase(self, session: Session, epoch: int, state: str) -> None:
        with self.lock:
            if session.epoch != epoch or session.cancel.is_set():
                raise VoiceError("turn_cancelled", "该轮次已停止或过期", 409)
            session.state = state

    def turn(self, session_id: str, epoch: int, *, text: str | None = None,
             audio: bytes | None = None) -> dict[str, Any]:
        if text is not None and (not text.strip() or len(text) > 2000):
            raise VoiceError("invalid_text", "文本必须为 1–2000 字")
        with self.lock:
            session = self._session(session_id)
            if epoch != session.epoch:
                raise VoiceError("stale_epoch", "请读取最新会话代次", 409, session_epoch=session.epoch)
            if not self.gpu.acquire(blocking=False):
                raise VoiceError("gpu_busy", "单卡正在处理另一轮，请稍后重试", 409)
            session.cancel = Event()
            cancel = session.cancel
            utterance_id = str(uuid.uuid4())
            session.utterance_id, session.error = utterance_id, None
            history = list(session.history)
        started = time.perf_counter()
        folder = self.output_dir / session_id / utterance_id
        timings: dict[str, float] = {}
        try:
            folder.mkdir(parents=True)
            if audio is not None:
                self._phase(session, epoch, "transcribing")
                input_path = folder / "input.wav"
                input_path.write_bytes(audio)
                if wav_info(input_path)["duration_ms"] > 30000:
                    raise VoiceError("invalid_audio", "录音最多 30 秒", 422)
                before = time.perf_counter()
                text = self.models.transcribe(input_path, folder, cancel)
                timings["asr_ms"] = (time.perf_counter() - before) * 1000
            if not isinstance(text, str) or not text.strip() or len(text) > 2000:
                raise VoiceError("empty_transcript", "未得到有效中文文本，未继续生成", 422)
            text = text.strip()
            self._phase(session, epoch, "generating")
            dialogue = DialogueSession(_DialogueBackend(self.models, folder, cancel))
            dialogue.history, dialogue.epoch = history, epoch
            before = time.perf_counter()
            response = dialogue.respond(text)
            timings["llm_ms"] = (time.perf_counter() - before) * 1000
            self._phase(session, epoch, "synthesizing")
            if response["status"] != "ok":
                raise VoiceError("dialogue_failed", "模型输出无效，未交付语音", 502,
                                 attempts=response["attempts"])
            before = time.perf_counter()
            path = self.models.synthesize(response["reply"], response["expression_intent"], folder, cancel)
            timings["tts_ms"] = (time.perf_counter() - before) * 1000
            info = wav_info(path)
            info["url"] = f"/v1/sessions/{session_id}/turns/{utterance_id}/audio"
            result = {**response, "session_id": session_id, "utterance_id": utterance_id,
                      "state": "ready", "transcript": text, "audio": info,
                      "timings_ms": {**timings, "total_ms": (time.perf_counter() - started) * 1000}}
            with self.lock:
                self._phase(session, epoch, "ready")
                session.history = dialogue.history
                session.audio[utterance_id] = (epoch, path)
                (folder / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            return result
        except Exception as error:
            failure = error if isinstance(error, VoiceError) else VoiceError("stage_failed", "模型阶段执行失败，请查看本轮日志", 502)
            with self.lock:
                if session.epoch != epoch or cancel.is_set():
                    failure = VoiceError("turn_cancelled", "该轮次已停止或过期", 409)
                else:
                    session.state, session.error = "error", failure.body
            failure.body.update(session_id=session_id, session_epoch=epoch, utterance_id=utterance_id)
            if folder.exists():
                (folder / "error.json").write_text(json.dumps({**failure.body, "diagnostic": str(error)}, ensure_ascii=False), encoding="utf-8")
            raise failure from error
        finally:
            self.gpu.release()

    def audio_file(self, session_id: str, utterance_id: str) -> Path:
        with self.lock:
            session = self._session(session_id)
            if utterance_id not in session.audio:
                raise VoiceError("audio_not_found", "音频不存在或尚未完成", 404)
            epoch, path = session.audio[utterance_id]
            if epoch != session.epoch:
                raise VoiceError("stale_audio", "音频已随停止或重置失效", 410)
            return path
