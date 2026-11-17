"""CPU subprocess boundaries reproduce stale admission without model downloads."""
import gc
from pathlib import Path
from queue import Queue
import sys
from threading import Event, Thread

import pytest

from digit_robot.resident import ResidentWorker
from digit_robot.sentence_pipeline import SentencePipeline
from digit_robot.voice import VoiceError
from test_voice_api import ModelFixture


@pytest.mark.parametrize('invalid', ['not-json\n', '{"type":"sentence","text":"缺少表达意图。"}\n'])
def test_invalid_llm_stream_does_not_keep_next_turn_waiting_for_garbage_collection(tmp_path: Path, invalid):
    fixture = Path(__file__).parent / 'fixtures/resident_protocol.py'
    worker = ResidentWorker([sys.executable, str(fixture)], Path.cwd(), tmp_path / 'worker', 5)
    reply_pids = []

    class Models(ModelFixture):
        def stream_reply(self, messages, cancel):
            reply = invalid if messages[-1]['content'] == '触发错误' else (
                '{"type":"meta","user_emotion":"neutral","expression_intent":{"style":"calm","intensity":0.5}}\n'
                '{"type":"sentence","text":"新的轮次可以继续。"}\n')
            for packet in worker.stream({'value': reply}, cancel):
                reply_pids.append(packet['pid'])
                yield packet['value']

    enabled = gc.isenabled()
    gc.disable()  # Quiet servers must recover without waiting for cyclic GC.
    pipeline = SentencePipeline(Models(), tmp_path / 'turns')
    sid = pipeline.create_session()['session_id']
    result = Queue()
    finished = Event()

    def send_next():
        try:
            result.put(list(pipeline.stream_turn(sid, 0, text='新的一轮')))
        finally:
            finished.set()

    try:
        first = list(pipeline.stream_turn(sid, 0, text='触发错误'))
        assert first[-1]['type'] == 'error'
        assert not any(event['type'] in ('audio_ready', 'done') for event in first)
        Thread(target=send_next, daemon=True).start()
        recovered_without_gc = finished.wait(1.5)
        # Clean up the original defect too, so a failing test leaves no locked thread.
        gc.collect()
        assert finished.wait(3), 'next turn did not leave its external worker wait'
        assert recovered_without_gc, 'invalid LLM output kept the worker stream locked until cyclic GC'
        assert result.get_nowait()[-1]['type'] == 'done'
        assert reply_pids == [worker.ready['pid']] * 2, 'validation failure must not reload a healthy model'
    finally:
        gc.collect()
        if enabled:
            gc.enable()
        worker.close()


@pytest.mark.parametrize('cancel_waiter', [False, True])
def test_worker_serial_wait_observes_timeout_and_cancellation(tmp_path: Path, cancel_waiter):
    fixture = Path(__file__).parent / 'fixtures/resident_protocol.py'
    worker = ResidentWorker([sys.executable, str(fixture)], Path.cwd(), tmp_path, 5)
    owner = worker.stream({'value': 'owner paused between RPC events'}, Event())
    assert next(owner)['value'] == 'owner paused between RPC events'
    worker.timeout = .15
    cancel, entered, finished = Event(), Event(), Event()
    failures = Queue()

    def waiter():
        entered.set()
        try:
            list(worker.stream({'value': 'next'}, cancel))
        except VoiceError as error:
            failures.put(error.body['code'])
        finally:
            finished.set()

    Thread(target=waiter, daemon=True).start()
    assert entered.wait(1)
    if cancel_waiter:
        cancel.set()
    bounded = finished.wait(.7)
    owner.close()
    assert finished.wait(2)
    try:
        assert bounded, 'waiting for the worker serial slot bypassed cancellation and the stage deadline'
        assert failures.get_nowait() == ('turn_cancelled' if cancel_waiter else 'stage_timeout')
    finally:
        worker.close()
