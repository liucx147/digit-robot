"""Bounded JSONL RPC to long-lived, separately installed model processes."""
import json
import os
from pathlib import Path
from queue import Empty, Queue
import subprocess
from threading import Event, Lock, Thread
import time
from typing import Any, Iterator
import uuid

from .process_models import RuntimeConfig
from .voice import VoiceError
from .dialogue import validate_answer


class ResidentWorker:
    def __init__(self, command: list[str], root: Path, logs: Path, timeout: float) -> None:
        logs.mkdir(parents=True, exist_ok=True)
        self.timeout = timeout
        self.unhealthy = False
        self.calls: dict[str, Queue[dict[str, Any]]] = {}
        self.guard, self.writer, self.serial = Lock(), Lock(), Lock()
        self.startup: Queue[dict[str, Any]] = Queue()
        self.stderr = (logs / 'worker.stderr.log').open('a', encoding='utf-8')
        env = {**os.environ, 'PYTHONPATH': str(root / 'src'), 'PYTHONUTF8': '1',
               'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1', 'HF_DATASETS_OFFLINE': '1'}
        self.process = subprocess.Popen(command, cwd=root, env=env, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=self.stderr, text=True, encoding='utf-8', bufsize=1)
        Thread(target=self._read, daemon=True).start()
        try:
            self.ready = self.startup.get(timeout=timeout)
            if self.ready.get('event') != 'ready':
                raise VoiceError('worker_failed', '模型常驻进程启动失败，请查看worker日志', 502)
        except Exception:
            self.close()
            raise

    def _read(self) -> None:
        assert self.process.stdout
        try:
            for line in self.process.stdout:
                value = json.loads(line)
                if value.get('event') == 'ready':
                    self.startup.put(value)
                else:
                    with self.guard:
                        target = self.calls.get(value.get('id'))
                    if target is not None:
                        target.put(value)
        except (OSError, ValueError, AttributeError, TypeError):
            # The failure is delivered to all callers below; raw RPC is not logged.
            pass
        finally:
            self.unhealthy = True
            error = {'event': 'error', 'message': '模型常驻进程已退出'}
            self.startup.put(error)
            with self.guard:
                for target in self.calls.values():
                    target.put(error)

    def _send(self, value: dict[str, Any]) -> None:
        with self.writer:
            if self.process.poll() is not None:
                raise VoiceError('worker_failed', '模型常驻进程不可用', 502)
            assert self.process.stdin
            try:
                self.process.stdin.write(json.dumps(value, ensure_ascii=False) + '\n')
                self.process.stdin.flush()
            except (OSError, ValueError) as error:
                self.unhealthy = True
                raise VoiceError('worker_failed', '模型RPC通道不可用', 502) from error

    def stream(self, payload: dict[str, Any], cancel: Event) -> Iterator[dict[str, Any]]:
        with self.serial:
            request_id = str(uuid.uuid4())
            inbox: Queue[dict[str, Any]] = Queue()
            with self.guard:
                self.calls[request_id] = inbox
            started = time.monotonic()
            finished = False
            try:
                self._send({'op': 'call', 'id': request_id, 'payload': payload})
                while True:
                    if cancel.is_set() or time.monotonic() - started > self.timeout:
                        if not cancel.is_set():
                            self.unhealthy = True
                        self._send({'op': 'cancel', 'id': request_id})
                        raise VoiceError('turn_cancelled' if cancel.is_set() else 'stage_timeout',
                                         '轮次已取消' if cancel.is_set() else '常驻模型阶段超时', 409 if cancel.is_set() else 504)
                    try:
                        value = inbox.get(timeout=.05)
                    except Empty:
                        continue
                    if value['event'] == 'done':
                        finished = True
                        return
                    if value['event'] == 'error':
                        raise VoiceError('worker_failed', value.get('message', '模型执行失败'), 502)
                    yield value
            finally:
                if not finished:
                    try:
                        self._send({'op': 'cancel', 'id': request_id})
                    except (OSError, VoiceError):
                        pass
                with self.guard:
                    self.calls.pop(request_id, None)

    def close(self, *, force: bool = False) -> None:
        if self.process.poll() is None:
            try:
                if force:
                    self.process.kill()
                else:
                    self._send({'op': 'shutdown'})
                self.process.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired, VoiceError):
                self.process.kill()
                self.process.wait()
        self.stderr.close()

    def __enter__(self) -> 'ResidentWorker':
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


class ResidentModels:
    def __init__(self, config: RuntimeConfig, logs: Path, tts_workers: int = 1) -> None:
        if tts_workers not in (1, 2):
            raise ValueError('TTS worker count must be one or two')
        self.config = config
        self.logs = logs
        self.recovery_lock = Lock()
        self.worker_commands: dict[str, list[str]] = {}
        self.restart_counts: dict[str, int] = {}
        self.workers: dict[str, ResidentWorker] = {}
        self.tts_pool: Queue[str] = Queue(maxsize=tts_workers)
        try:
            roles = [('asr', 'asr'), ('llm', 'llm'), ('tts', 'tts')]
            if tts_workers == 2:
                roles.append(('tts-next', 'tts'))
            for name, role in roles:
                self.worker_commands[name] = [getattr(config, f'{role}_python'), '-m',
                    'digit_robot.resident_worker', '--role', role, '--model-dir', getattr(config, f'{role}_model')]
                self.restart_counts[name] = 0
                self.workers[name] = ResidentWorker(self.worker_commands[name],
                    config.project_root, logs / name, config.stage_timeout_seconds)
                if role == 'tts':
                    self.tts_pool.put(name)
            self._save_ready()
        except Exception:
            self.close()
            raise

    def _save_ready(self) -> None:
        value = {name: {**worker.ready, 'restart_count': self.restart_counts[name]} for name, worker in self.workers.items()}
        temporary = self.logs / 'ready.json.tmp'
        temporary.write_text(json.dumps(value, indent=2), encoding='utf-8')
        temporary.replace(self.logs / 'ready.json')

    def _active_worker(self, name: str) -> ResidentWorker:
        with self.recovery_lock:
            worker = self.workers[name]
            if worker.process.poll() is not None or worker.unhealthy:
                worker.close(force=worker.unhealthy)
                replacement = ResidentWorker(self.worker_commands[name], self.config.project_root,
                                             self.logs / name, self.config.stage_timeout_seconds)
                self.workers[name] = replacement
                self.restart_counts[name] += 1
                self._save_ready()
                return replacement
            return worker

    def _result(self, role: str, payload: dict[str, Any], cancel: Event) -> dict[str, Any]:
        result = None
        for value in self._active_worker(role).stream(payload, cancel):
            if value['event'] == 'result':
                result = value
        if result is None:
            raise VoiceError('worker_failed', '模型未返回结果', 502)
        return result

    def transcribe(self, audio: Path, output_dir: Path, cancel: Event) -> str:
        result = self._result('asr', {'audio': str(audio)}, cancel)
        (output_dir / 'resident-asr.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        return str(result['text'])

    def generate(self, messages: list[dict[str, str]], output_dir: Path, cancel: Event) -> str:
        short = messages[0]['content'] + '\n回复最多80字、1至3句，首句12至20字，禁止冗长重复。'
        result = self._result('llm', {'messages': [{'role': 'system', 'content': short}, *messages[1:]]}, cancel)
        text = str(result['text'])
        if len(validate_answer(text)['reply']) > 80:
            raise VoiceError('dialogue_failed', '短回复超出80字限制', 502)
        return text

    def stream_reply(self, messages: list[dict[str, str]], cancel: Event) -> Iterator[str]:
        for value in self._active_worker('llm').stream({'messages': messages, 'stream': True}, cancel):
            if value['event'] == 'text':
                yield str(value['text'])

    def synthesize(self, text: str, intent: dict[str, Any], output_dir: Path, cancel: Event) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        while True:
            if cancel.is_set():
                raise VoiceError('turn_cancelled', '轮次已取消', 409)
            try:
                worker = self.tts_pool.get(timeout=.05)
                break
            except Empty:
                continue
        try:
            result = self._result(worker, {'text': text, 'intent': intent, 'output_dir': str(output_dir)}, cancel)
            result.update(worker=worker, worker_pid=self.workers[worker].ready['pid'])
        finally:
            self.tts_pool.put(worker)
        (output_dir / 'resident-tts.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        return Path(result['audio_path'])

    def close(self) -> None:
        for worker in self.workers.values():
            worker.close()
