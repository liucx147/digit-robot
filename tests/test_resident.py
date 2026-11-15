from pathlib import Path
import sys
import time
from threading import Event
import pytest

from digit_robot.resident import ResidentWorker
from digit_robot.voice import VoiceError


def test_two_calls_share_one_loaded_external_process(tmp_path: Path) -> None:
    fixture = Path(__file__).parent / 'fixtures/resident_protocol.py'
    with ResidentWorker([sys.executable, str(fixture)], Path.cwd(), tmp_path, 5) as worker:
        first = list(worker.stream({'value': 'first'}, Event()))
        second = list(worker.stream({'value': 'second'}, Event()))
        assert first[0]['value'] == 'first' and second[0]['value'] == 'second'
        assert first[0]['pid'] == second[0]['pid'] == worker.ready['pid']
        assert worker.ready['load_count'] == 1
    assert worker.process.poll() is not None


def test_cancelled_call_cannot_poison_next_reply_or_reload_the_worker(tmp_path: Path) -> None:
    fixture = Path(__file__).parent / 'fixtures/resident_protocol.py'
    with ResidentWorker([sys.executable, str(fixture)], Path.cwd(), tmp_path, 5) as worker:
        cancel = Event()
        old = worker.stream({'late':True}, cancel)
        assert next(old)['event'] == 'started'
        cancel.set()
        with pytest.raises(VoiceError, match='轮次已取消'):
            next(old)
        time.sleep(.3)
        new = list(worker.stream({'value':'new'}, Event()))
        assert new[0]['value'] == 'new' and new[0]['pid'] == worker.ready['pid']
