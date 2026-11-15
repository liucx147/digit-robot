from pathlib import Path
import sys
from threading import Event

from digit_robot.resident import ResidentWorker


def test_two_calls_share_one_loaded_external_process(tmp_path: Path) -> None:
    fixture = Path(__file__).parent / 'fixtures/resident_protocol.py'
    with ResidentWorker([sys.executable, str(fixture)], Path.cwd(), tmp_path, 5) as worker:
        first = list(worker.stream({'value': 'first'}, Event()))
        second = list(worker.stream({'value': 'second'}, Event()))
        assert first[0]['value'] == 'first' and second[0]['value'] == 'second'
        assert first[0]['pid'] == second[0]['pid'] == worker.ready['pid']
        assert worker.ready['load_count'] == 1
    assert worker.process.poll() is not None
