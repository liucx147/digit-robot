"""A bounded sentence producer overlaps LLM continuation with sequential TTS."""
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from queue import Empty, Full, Queue
from threading import Thread
import time
from typing import Any

from .reply_stream import STREAM_PROMPT, reply_records
from .voice import VoiceError, VoiceModels, VoicePipeline, wav_info


class SentencePipeline(VoicePipeline):
    def __init__(self, models: VoiceModels, output_dir: Path, tts_workers: int = 1, profiles_db: Path | None = None) -> None:
        super().__init__(models, output_dir, profiles_db)
        if tts_workers not in (1, 2):
            raise ValueError('TTS concurrency must be one or two')
        self.tts_workers = tts_workers

    def stream_turn(self, session_id: str, epoch: int, *, text: str | None = None,
                    audio: bytes | None = None) -> Iterator[dict[str, Any]]:
        acquired = False
        cancel = None
        producer = None
        synthesis = None
        folder = None
        utterance_id = None
        started = time.perf_counter()
        timings: dict[str, Any] = {}
        emitted_audio = False

        def elapsed() -> float:
            return round((time.perf_counter() - started) * 1000, 3)

        def event(kind: str, **fields: Any) -> dict[str, Any]:
            value = {'type': kind, 'session_id': session_id, 'session_epoch': epoch,
                     'utterance_id': utterance_id, 'server_elapsed_ms': elapsed(), **fields}
            if folder is not None:
                with (folder / 'events.jsonl').open('a', encoding='utf-8') as stream:
                    stream.write(json.dumps(value, ensure_ascii=False) + '\n')
            return value

        try:
            # Admission and epoch allocation share the old API's cancellation boundary.
            import uuid
            from threading import Event
            with self.lock:
                session = self._session(session_id)
                if session.epoch != epoch:
                    raise VoiceError('stale_epoch', '会话代次已过期', 409)
                context = self.profile_context(session)
                if not self.gpu.acquire(blocking=False):
                    raise VoiceError('gpu_busy', '单卡正在处理另一轮', 409)
                acquired = True
                session.cancel = cancel = Event()
                utterance_id = session.utterance_id = str(uuid.uuid4())
                history = list(session.history)
                session.error = None
            folder = self.output_dir / session_id / utterance_id
            folder.mkdir(parents=True)
            yield event('start')
            if audio is not None:
                self._phase(session, epoch, 'transcribing')
                path = folder / 'input.wav'
                path.write_bytes(audio)
                if wav_info(path)['duration_ms'] > 30000:
                    raise VoiceError('invalid_audio', '录音最多30秒', 422)
                before = time.perf_counter()
                text = self.models.transcribe(path, folder, cancel)
                timings['asr_ms'] = (time.perf_counter() - before) * 1000
            if not isinstance(text, str) or not text.strip() or len(text) > 2000:
                raise VoiceError('invalid_text', '需要1至2000字的有效文本', 422)
            yield event('transcript', transcript=text)
            self._phase(session, epoch, 'generating')
            messages = [{'role': 'system', 'content': STREAM_PROMPT + context}, *history, {'role': 'user', 'content': text}]
            pending: Queue[Any] = Queue(maxsize=2)

            def put(value: Any) -> bool:
                while not cancel.is_set():
                    try:
                        pending.put(value, timeout=.05)
                        return True
                    except Full:
                        pass
                return False

            def produce() -> None:
                before = time.perf_counter()
                def chunks() -> Iterator[str]:
                    with (folder / 'llm-output.ndjson').open('w', encoding='utf-8') as raw:
                        for chunk in self.models.stream_reply(messages, cancel):  # type: ignore[attr-defined]
                            timings.setdefault('first_token_ms', elapsed())
                            raw.write(chunk)
                            raw.flush()
                            yield chunk
                try:
                    for record in reply_records(chunks()):
                        if record['type'] == 'sentence':
                            timings.setdefault('first_sentence_ms', elapsed())
                        if not put(record):
                            return
                    timings['llm_ms'] = (time.perf_counter() - before) * 1000
                    timings['llm_done_ms'] = elapsed()
                except Exception as error:
                    put(error)
                finally:
                    put(None)

            producer = Thread(target=produce, daemon=True)
            producer.start()
            metadata: dict[str, Any] = {}
            segments: list[dict[str, Any]] = []
            sentences: list[str] = []
            jobs: list[dict[str, Any]] = []
            llm_finished = False
            synthesis = ThreadPoolExecutor(max_workers=self.tts_workers)

            def synthesize(index: int, sentence: str, intent: dict[str, Any]) -> dict[str, Any]:
                began = elapsed()
                segment_dir = folder / f'segment-{index}'
                segment_dir.mkdir()
                path = self.models.synthesize(sentence, intent, segment_dir, cancel)
                ended = elapsed()
                return {'path': path, 'synth_ms': ended - began,
                        'synth_started_ms': began, 'synth_finished_ms': ended}

            while not llm_finished or len(segments) < len(jobs):
                self._phase(session, epoch, 'generating' if not segments else 'synthesizing')
                if not llm_finished:
                    try:
                        record = pending.get(timeout=.02)
                    except Empty:
                        record = 'waiting'
                    if record is None:
                        llm_finished = True
                    elif isinstance(record, Exception):
                        raise record
                    elif isinstance(record, dict):
                        if record['type'] == 'meta':
                            metadata = {key: record[key] for key in ('user_emotion', 'expression_intent')}
                            yield event('meta', **metadata)
                        else:
                            index = len(jobs)
                            sentences.append(record['text'])
                            jobs.append({'text': record['text'], 'announced': False,
                                         'future': synthesis.submit(synthesize, index, record['text'], metadata['expression_intent'])})
                index = len(segments)
                if index == len(jobs):
                    continue
                job = jobs[index]
                if not job['announced']:
                    job['announced'] = True
                    yield event('sentence', segment_index=index, text=job['text'])
                if not job['future'].done():
                    if llm_finished:
                        cancel.wait(.02)
                    continue
                completed = job['future'].result()
                path = completed.pop('path')
                sound = wav_info(path)
                sound['url'] = f'/v2/sessions/{session_id}/turns/{utterance_id}/segments/{index}/audio'
                with self.lock:
                    self._phase(session, epoch, 'synthesizing')
                    session.audio[f'{utterance_id}.{index}'] = (epoch, path)
                timings.setdefault('first_audio_ready_ms', elapsed())
                segment = dict(segment_index=index, text=job['text'], audio=sound, **completed, **metadata)
                segments.append(segment)
                emitted_audio = True
                yield event('audio_ready', **segment)
            if not segments:
                raise VoiceError('dialogue_failed', '未生成有效语音分句', 502)
            with self.lock:
                self._phase(session, epoch, 'ready')
                answer = {'user_emotion': metadata['user_emotion'], 'reply': ''.join(sentences), 'expression_intent': metadata['expression_intent']}
                session.history = [*history, {'role': 'user', 'content': text},
                                   {'role': 'assistant', 'content': json.dumps(answer, ensure_ascii=False)}]
            timings['all_audio_ready_ms'] = timings['total_ms'] = elapsed()
            timings['tts_ms'] = sum(segment['synth_ms'] for segment in segments)
            result = event('done', **answer, status='ok', audio_segments=segments, timings_ms=timings)
            (folder / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            yield result
        except Exception as error:
            failure = error if isinstance(error, VoiceError) else VoiceError('stream_failed', '分句生成或合成失败，请查看本轮日志', 502)
            if cancel is not None and cancel.is_set():
                failure = VoiceError('turn_cancelled', '该轮次已取消', 409)
            if acquired:
                with self.lock:
                    if session.epoch == epoch and cancel is not None and not cancel.is_set():
                        session.state, session.error = 'error', failure.body
                        for key in list(session.audio):
                            if key.startswith(str(utterance_id) + '.'):
                                session.audio.pop(key)
            if folder is not None:
                (folder / 'error.json').write_text(json.dumps({**failure.body, 'diagnostic': str(error)}, ensure_ascii=False), encoding='utf-8')
            yield event('error', code=failure.body['code'], message=failure.body['message'], partial_audio=emitted_audio)
        finally:
            if cancel is not None:
                cancel.set()
            if producer is not None:
                producer.join(timeout=10)
            if synthesis is not None:
                synthesis.shutdown(wait=True, cancel_futures=True)
            if acquired:
                self.gpu.release()
