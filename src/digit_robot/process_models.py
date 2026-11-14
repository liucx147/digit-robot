"""Run verified model environments without mixing their dependencies."""

from dataclasses import dataclass
import json
import os
from pathlib import Path
import subprocess
from threading import Event
import time
from typing import Any

from .voice import VoiceError


@dataclass
class RuntimeConfig:
    project_root: Path
    llm_python: str
    asr_python: str
    tts_python: str
    llm_model: str
    asr_model: str
    tts_model: str
    stage_timeout_seconds: float = 300

    @classmethod
    def from_file(cls, path: Path) -> "RuntimeConfig":
        data = json.loads(path.read_text(encoding="utf-8"))
        root = Path(data.pop("project_root", path.resolve().parent.parent)).resolve()
        config = cls(project_root=root, **data)
        for name in ("llm_python", "asr_python", "tts_python", "llm_model", "asr_model", "tts_model"):
            if not Path(getattr(config, name)).exists():
                raise ValueError(f"配置 {name} 路径不存在")
        if not 0 < config.stage_timeout_seconds <= 3600:
            raise ValueError("stage_timeout_seconds 必须在 0–3600 秒之间")
        return config


class ProcessModels:
    def __init__(self, config: RuntimeConfig) -> None:
        self.config = config

    def _run(self, argv: list[str], folder: Path, label: str, cancel: Event,
             payload: str | None = None) -> str:
        if cancel.is_set():
            raise VoiceError("turn_cancelled", "轮次已取消", 409)
        environment = {**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
                       "HF_DATASETS_OFFLINE": "1", "PYTHONUTF8": "1",
                       "PYTHONPATH": str(self.config.project_root / "src")}
        started = time.monotonic()
        log_prefix = folder / f"{label}-{time.monotonic_ns()}"
        with subprocess.Popen(argv, cwd=self.config.project_root, env=environment,
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, encoding="utf-8") as process:
            pending_input = payload
            failure = None
            while True:
                if cancel.is_set():
                    failure = VoiceError("turn_cancelled", "轮次已取消", 409)
                elif time.monotonic() - started > self.config.stage_timeout_seconds:
                    failure = VoiceError("stage_timeout", f"{label} 阶段超时", 504)
                if failure is not None:
                    process.terminate()
                    try:
                        stdout, stderr = process.communicate(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        stdout, stderr = process.communicate()
                    break
                try:
                    stdout, stderr = process.communicate(input=pending_input, timeout=0.1)
                    break
                except subprocess.TimeoutExpired:
                    pending_input = None
            log_prefix.with_suffix(".stdout.log").write_text(stdout, encoding="utf-8")
            log_prefix.with_suffix(".stderr.log").write_text(stderr, encoding="utf-8")
            if failure is not None:
                raise failure
            if process.returncode != 0:
                raise VoiceError("stage_failed", f"{label} 阶段失败，请查看本轮日志", 502)
            return stdout

    def generate(self, messages: list[dict[str, str]], output_dir: Path, cancel: Event) -> str:
        output = self._run([self.config.llm_python, "-m", "digit_robot.model_worker",
                            "--model-dir", self.config.llm_model], output_dir, "llm", cancel,
                           json.dumps({"messages": messages}, ensure_ascii=False))
        return str(json.loads(output)["raw_output"])

    def _speech(self, task: str, output_dir: Path, cancel: Event, extra: list[str]) -> dict[str, Any]:
        folder = output_dir / task
        model = self.config.asr_model if task == "asr" else self.config.tts_model
        python = self.config.asr_python if task == "asr" else self.config.tts_python
        self._run([python, str(self.config.project_root / "scripts" / "speech_baseline.py"),
                   "--task", task, "--model-dir", model, "--output-dir", str(folder), *extra],
                  output_dir, task, cancel)
        return dict(json.loads((folder / f"speech-{task}-report.json").read_text(encoding="utf-8")))

    def transcribe(self, audio: Path, output_dir: Path, cancel: Event) -> str:
        report = self._speech("asr", output_dir, cancel, ["--audio", str(audio)])
        return str(report["raw_output"][0]["text"])

    def synthesize(self, text: str, intent: dict[str, Any], output_dir: Path, cancel: Event) -> Path:
        instructions = {"gentle": "温柔、关切、平静", "cheerful": "轻快、友善、开心",
                        "calm": "平静、自然、清晰", "serious": "认真、沉稳、清晰"}
        instruction = f"用{instructions[intent['style']]}的语气说话，情绪强度为{intent['intensity']:.0%}。"
        report = self._speech("tts", output_dir, cancel,
                              ["--text", text, "--speaker", "Vivian", "--instruct", instruction,
                               "--max-new-tokens", "2048", "--sample"])
        return Path(report["raw_output"]["audio_path"])
