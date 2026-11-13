import argparse
import json
from pathlib import Path
import sys
from typing import TextIO

from .dialogue import DialogueSession, ModelBackend, load_json


def run(input_stream: TextIO, output_stream: TextIO, backend: ModelBackend) -> None:
    session = DialogueSession(backend)
    for line in input_stream:
        try:
            event = load_json(line)
            if not isinstance(event, dict):
                raise ValueError("输入必须是 JSON 对象")
            if event.get("type") == "reset":
                result = session.reset()
            elif event.get("type") == "message":
                text = event.get("text")
                if not isinstance(text, str) or not text.strip() or len(text) > 2000:
                    raise ValueError("text 必须是 1 至 2000 字的非空文本")
                result = session.respond(text.strip())
            else:
                raise ValueError("type 必须为 message 或 reset")
        except ValueError as error:
            result = {"type": "error", "code": "invalid_input", "message": str(error),
                      "session_epoch": session.epoch}
        output_stream.write(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n")
        output_stream.flush()


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="本地中文情感对话 JSONL 入口")
    parser.add_argument("--model-dir", required=True, type=Path, help="已下载的 Qwen3.5 模型目录")
    parser.add_argument("--max-new-tokens", type=int, default=512, choices=(256, 512))
    args = parser.parse_args(argv)
    try:
        from .transformers_backend import TransformersBackend

        backend = TransformersBackend(args.model_dir, max_new_tokens=args.max_new_tokens)
    except Exception as error:
        diagnostic = f"{type(error).__name__}: {error}"
        print(diagnostic, file=sys.stderr)
        print(json.dumps({"type": "error", "code": "model_load_failed", "message": diagnostic},
                         ensure_ascii=False, allow_nan=False))
        return 1
    print("本地学生模型已就绪；每行输入 message 或 reset JSON。", file=sys.stderr)
    run(sys.stdin, sys.stdout, backend)
    return 0
