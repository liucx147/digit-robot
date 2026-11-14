"""Build the fixed Mandarin cadence ledger before observing any output."""
import array
import io
import math
from pathlib import Path
import sys
import wave
import json
from . import digest, require

SOURCE_SHA256 = "4c874c2b1030cc276aee5003af1ba4439394f2c20cf3849cd4d9398a434c0729"


def freeze(source, output_dir):
    require(digest(source) == SOURCE_SHA256, "freeze requires the bundled CC0 Mandarin nihao recording; review a new fixture separately")
    source_bytes = Path(source).read_bytes()
    with wave.open(io.BytesIO(source_bytes), "rb") as wav:
        require(wav.getsampwidth() == 2 and wav.getnchannels() == 1, "fixture must be mono PCM16")
        rate, frames = wav.getframerate(), wav.readframes(wav.getnframes())
    samples = array.array("h", frames)
    if sys.byteorder != "little":
        samples.byteswap()
    window = rate // 100
    active = [i for i in range(0, len(samples) - window + 1, window) if math.sqrt(sum((v / 32768) ** 2 for v in samples[i:i + window]) / window) >= .01]
    require(bool(active), "source has no speech boundary")
    onset, offset = active[0], active[-1] + window
    leading, gap, repetitions = rate, int(rate * .6), 20
    output = bytearray(leading * 2)
    events = []
    for i in range(repetitions):
        start = len(output) // 2
        events.extend([{"id": f"phrase-{i + 1:02}-open", "type": "open", "source_ms": (start + onset) * 1000 / rate}, {"id": f"phrase-{i + 1:02}-close", "type": "close", "source_ms": (start + offset) * 1000 / rate}])
        output.extend(frames)
        output.extend(bytes(gap * 2))
    output.extend(bytes(rate * 2))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate); wav.writeframes(output)
    fixture = buffer.getvalue()
    import hashlib
    ledger = {"schema": 1, "fixture": {"path": "fixture.wav", "sha256": hashlib.sha256(fixture).hexdigest(), "duration_ms": len(output) / 2 * 1000 / rate}, "source": {"path": "source.wav", "sha256": SOURCE_SHA256, "description": "Luilui6666 Mandarin nihao, CC0; unchanged source repeated 20 times with silence", "license_notice": "../../assets/NOTICES.md"}, "setup": {"avatar_sha256": "12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2", "view": "01 default fixed head camera; freeze viewport/zoom in each capture manifest", "conditions": "plain cadence only; repeat with mixed expression/gaze at final integration"}, "rules": {"tolerance_ms": 200, "required_ratio": .95, "pairing_window_ms": 1000, "audio_rule": "Each phrase outer boundaries: 10ms PCM RMS >=0.01 full scale, first window start / last window end. Review captured audio independently using the same rule; annotate timing intervals and preserve internal transitions as unexpected where applicable.", "visual_rule": "Review actual recorded mouth pixels against a closed reference before each phrase. Bracket first visible opening / return to closed between adjacent presented frames. Do not read controller weights. Any ambiguous/occluded edge is missing or review-error; preserve extra oscillations.", "pairing": "Match frozen phrase ID and open/close type in order, once only, within +/-1000ms of frozen audio edge plus declared single source origin. Whole conservative error interval must lie inside inclusive +/-200ms."}, "events": events}
    files = {"source.wav": source_bytes, "fixture.wav": fixture, "ledger.json": (json.dumps(ledger, ensure_ascii=False, indent=2) + "\n").encode("utf-8")}
    directory = Path(output_dir)
    require(all(not (directory / name).exists() or (directory / name).read_bytes() == data for name, data in files.items()), "frozen output differs; use a new directory to preserve original evidence")
    directory.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (directory / name).write_bytes(data)
    return {"events": len(events), "ledger_sha256": digest(directory / "ledger.json")}
