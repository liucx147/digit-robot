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


def test_dead_model_worker_is_reloaded_once_on_next_turn(tmp_path: Path, monkeypatch) -> None:
    import digit_robot.resident as resident
    from digit_robot.process_models import RuntimeConfig
    fixture = Path(__file__).parent / 'fixtures/resident_protocol.py'
    worker_type = ResidentWorker
    def cpu_worker(command, root, logs, timeout):
        return worker_type([sys.executable, str(fixture)], root, logs, timeout)
    monkeypatch.setattr(resident, 'ResidentWorker', cpu_worker)
    config = RuntimeConfig(Path.cwd(), sys.executable, sys.executable, sys.executable, 'llm', 'asr', 'tts', 5)
    models = resident.ResidentModels(config, tmp_path)
    try:
        old = models.workers['asr']
        other = models.workers['llm'].ready['pid']
        old.process.kill()
        old.process.wait()
        restarted = models._active_worker('asr')
        result = list(restarted.stream({'value': 'new'}, Event()))
        assert result[0]['value'] == 'new' and restarted.ready['pid'] != old.ready['pid']
        assert models._active_worker('asr') is restarted
        assert models.workers['llm'].ready['pid'] == other
        import json
        assert json.loads((tmp_path/'ready.json').read_text())['asr']['restart_count'] == 1
    finally:
        models.close()


def test_startup_metadata_failure_closes_every_owned_worker(tmp_path: Path, monkeypatch) -> None:
    import digit_robot.resident as resident
    from digit_robot.process_models import RuntimeConfig
    fixture = Path(__file__).parent / 'fixtures/resident_protocol.py'
    workers = []
    def cpu_worker(command, root, logs, timeout):
        worker = ResidentWorker([sys.executable, str(fixture)], root, logs, timeout)
        workers.append(worker)
        return worker
    def fail_ready(self):
        raise OSError('test ready metadata failure')
    monkeypatch.setattr(resident, 'ResidentWorker', cpu_worker)
    monkeypatch.setattr(resident.ResidentModels, '_save_ready', fail_ready)
    config = RuntimeConfig(Path.cwd(), sys.executable, sys.executable, sys.executable, 'llm', 'asr', 'tts', 5)
    try:
        with pytest.raises(OSError):
            resident.ResidentModels(config, tmp_path)
        assert all(worker.process.poll() is not None for worker in workers)
    finally:
        for worker in workers:
            worker.close()


def test_live_but_hung_worker_is_replaced_after_timeout(tmp_path: Path, monkeypatch) -> None:
    import digit_robot.resident as resident
    from digit_robot.process_models import RuntimeConfig
    fixture = Path(__file__).parent / 'fixtures/resident_hang.py'
    def cpu_worker(command, root, logs, timeout):
        return ResidentWorker([sys.executable, str(fixture)], root, logs, timeout)
    monkeypatch.setattr(resident, 'ResidentWorker', cpu_worker)
    config = RuntimeConfig(Path.cwd(), sys.executable, sys.executable, sys.executable, 'llm', 'asr', 'tts', 5)
    models = resident.ResidentModels(config, tmp_path)
    try:
        old = models.workers['asr']
        old.timeout = .1
        with pytest.raises(VoiceError) as failure:
            list(old.stream({'hang': True}, Event()))
        assert failure.value.body['code'] == 'stage_timeout'
        assert old.process.poll() is None
        fresh = models._active_worker('asr')
        assert fresh is not old, 'a live process can still be unhealthy after a non-cooperative timeout'
        assert old.process.poll() is not None
        assert list(fresh.stream({'value': 'recovered'}, Event()))[0]['value'] == 'recovered'
    finally:
        # Force the fixture down even when testing the old implementation.
        for worker in models.workers.values():
            if worker.process.poll() is None:
                worker.process.kill()
                worker.process.wait()
        models.close()


def test_broken_rpc_is_recovered_even_while_process_is_alive(tmp_path: Path, monkeypatch) -> None:
    import digit_robot.resident as resident
    from digit_robot.process_models import RuntimeConfig
    fixture = Path(__file__).parent / 'fixtures/resident_hang.py'
    def cpu_worker(command, root, logs, timeout):
        return ResidentWorker([sys.executable, str(fixture)], root, logs, timeout)
    monkeypatch.setattr(resident, 'ResidentWorker', cpu_worker)
    config = RuntimeConfig(Path.cwd(), sys.executable, sys.executable, sys.executable, 'llm', 'asr', 'tts', 5)
    models = resident.ResidentModels(config, tmp_path)
    try:
        old = models.workers['asr']
        with pytest.raises(VoiceError) as failure:
            list(old.stream({'close_rpc': True}, Event()))
        assert failure.value.body['code'] == 'worker_failed'
        assert old.process.poll() is None
        fresh = models._active_worker('asr')
        assert fresh is not old
        assert list(fresh.stream({'value': 'after-broken-pipe'}, Event()))[0]['value'] == 'after-broken-pipe'
    finally:
        for worker in models.workers.values():
            if worker.process.poll() is None:
                worker.process.kill()
                worker.process.wait()
        models.close()
