"""Record real HTTP speech turns; the input fixture is synthetic, not an ASR gold set."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--input-wav", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    def call(path: str, data: bytes | dict | None = None, headers: dict | None = None) -> tuple[int, bytes]:
        headers = dict(headers or {})
        if isinstance(data, dict):
            headers["Content-Type"] = "application/json"
            data = json.dumps(data, ensure_ascii=False).encode("utf-8")
        request = Request(args.base_url + path, data=data, headers=headers)
        try:
            with urlopen(request, timeout=600) as response:
                return response.status, response.read()
        except HTTPError as error:
            return error.code, error.read()

    def post(path: str, body: dict) -> dict:
        status, payload = call(path, body)
        if status != 200:
            raise RuntimeError(f"HTTP {status}: {payload.decode('utf-8')}")
        return json.loads(payload)

    session = post("/v1/sessions", {})
    sid = session["session_id"]
    root = f"/v1/sessions/{sid}"
    input_data = args.input_wav.read_bytes()
    code, data = call(root + "/audio", input_data,
                      {"Content-Type": "audio/wav", "X-Session-Epoch": "0"})
    (args.output_dir / "audio-turn.json").write_bytes(data)
    if code != 200:
        raise RuntimeError(f"Audio chain HTTP {code}: {data.decode('utf-8')}")
    audio_turn = json.loads(data)
    # Frozen fixture regression: 133 Chinese reply characters previously ran to 164s.
    # This guards that observed runaway; it is not a general speech quality metric.
    if audio_turn["audio"]["duration_ms"] > 90000:
        raise RuntimeError("Fixed fixture speech exceeded 90s; reject the runaway TTS sample")
    print(json.dumps({"audio_turn": audio_turn}, ensure_ascii=False), flush=True)
    text_turn = post(root + "/text", {"text": "你还记得我叫什么吗？请用一句话回答。", "session_epoch": 0})
    (args.output_dir / "text-turn.json").write_text(json.dumps(text_turn, ensure_ascii=False, indent=2), encoding="utf-8")
    audio_hashes = []
    for name, turn in (("audio-reply", audio_turn), ("text-reply", text_turn)):
        status, wav = call(turn["audio"]["url"])
        assert status == 200 and wav[:4] == b"RIFF"
        (args.output_dir / f"{name}.wav").write_bytes(wav)
        audio_hashes.append(hashlib.sha256(wav).hexdigest())
    reset = post(root + "/reset", {})
    assert reset["session_epoch"] == 1
    assert call(audio_turn["audio"]["url"])[0] == 410
    assert call(root + "/text", {"text": "旧请求", "session_epoch": 0})[0] == 409
    fresh = post(root + "/text", {"text": "我还没告诉你名字，你知道我叫什么吗？简短回答。", "session_epoch": 1})
    (args.output_dir / "reset-turn.json").write_text(json.dumps(fresh, ensure_ascii=False, indent=2), encoding="utf-8")
    with ThreadPoolExecutor() as executor:
        pending = executor.submit(call, root + "/text", {"text": "请简短安慰我", "session_epoch": 1})
        for _ in range(100):
            state = json.loads(call(root)[1])
            if state["state"] == "generating":
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("Did not observe in-flight generation")
        time.sleep(1)
        before = time.perf_counter()
        stopped = post(root + "/stop", {})
        stop_ms = (time.perf_counter() - before) * 1000
        cancel_code, cancel_body = pending.result(timeout=15)
    assert cancel_code == 409 and json.loads(cancel_body)["code"] == "turn_cancelled"
    assert stopped["session_epoch"] == 2
    report = {
        "input_source": "Qwen TTS synthetic Chinese fixture; not microphone accuracy evaluation",
        "input_sha256": hashlib.sha256(input_data).hexdigest(),
        "transcript": audio_turn["transcript"], "user_emotion": audio_turn["user_emotion"],
        "audio_turn_timings_ms": audio_turn["timings_ms"],
        "reply_audio_sha256": audio_hashes,
        "checks": {"audio_chain": audio_turn["status"] == "ok", "text_chain": text_turn["status"] == "ok",
                   "recalls_name": "小林" in text_turn["reply"], "reset_isolates_name": "小林" not in fresh["reply"],
                   "old_audio_expired": True, "stale_request_rejected": True, "inflight_cancelled": True},
        "server_stop_ack_ms": stop_ms,
        "not_evaluated": ["browser playback stop latency", "3D synchronization", "natural microphone ASR accuracy", "full engineering acceptance"],
    }
    (args.output_dir / "chain-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output_dir / "openapi.json").write_bytes(call("/openapi.json")[1])
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not all(report["checks"].values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
