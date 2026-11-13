"""Exercise the public JSONL entry with a real local checkpoint and save evidence."""

import argparse
from datetime import datetime, timezone
import importlib.metadata
import io
import json
import os
from pathlib import Path
import platform
import subprocess
import time


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import torch
    from digit_robot.cli import run
    from digit_robot.transformers_backend import TransformersBackend

    events = [
        {"type": "message", "text": "我叫小林，今天考试没考好，我很难过。"},
        {"type": "message", "text": "你还记得我叫什么吗？请叫出我的名字，再安慰我。"},
        {"type": "reset"},
        {"type": "message", "text": "我还没有告诉你名字，你知道我叫什么吗？"},
    ]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    torch.cuda.reset_peak_memory_stats()
    started = time.perf_counter()
    backend = TransformersBackend(args.model_dir, max_new_tokens=512)
    torch.cuda.synchronize()
    load_seconds = time.perf_counter() - started
    rows = []
    durations = []
    # A single run keeps exactly the same session and reset semantics as the CLI.
    input_text = "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events)
    output = io.StringIO()
    generated = time.perf_counter()
    run(io.StringIO(input_text), output, backend)
    torch.cuda.synchronize()
    durations.append(time.perf_counter() - generated)
    rows = [json.loads(line) for line in output.getvalue().splitlines()]
    (args.output_dir / "llm-input.jsonl").write_text(input_text, encoding="utf-8")
    (args.output_dir / "llm-output.jsonl").write_text(output.getvalue(), encoding="utf-8")
    responses = [row for row in rows if row.get("type") == "response"]
    report = {
        "recorded_at_utc": datetime.now(timezone.utc).isoformat(),
        "model_dir": str(args.model_dir), "project_adaptation": "none",
        "python": platform.python_version(), "torch": torch.__version__,
        "transformers": importlib.metadata.version("transformers"),
        "cuda_runtime": torch.version.cuda, "gpu": torch.cuda.get_device_name(),
        "driver": subprocess.check_output(["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"], text=True).strip(),
        "precision": "bfloat16", "attention": "sdpa", "max_new_tokens": 512,
        "do_sample": False, "enable_thinking": False,
        "offline_evidence": "HF_HUB_OFFLINE=1, TRANSFORMERS_OFFLINE=1, local_files_only=True; host network not disconnected",
        "load_seconds": load_seconds, "generation_total_seconds": durations[0],
        "peak_allocated_bytes": torch.cuda.max_memory_allocated(),
        "peak_reserved_bytes": torch.cuda.max_memory_reserved(),
        "response_statuses": [row["status"] for row in responses],
        "parse_failure_count": sum(attempt["error"] is not None for row in responses for attempt in row["attempts"]),
        "contract_ok": len(rows) == 4 and len(responses) == 3 and all(row["status"] == "ok" for row in responses),
        "requires_human_review": ["回复共情是否适当", "第二轮承接姓名", "reset 后不再引用姓名"],
        "not_evaluated": ["分类准确率", "蒸馏收益", "完整数字人验收", "整机断网验收"],
    }
    (args.output_dir / "llm-baseline.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not report["contract_ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
