"""Run one real, local Qwen speech model and retain M1 baseline evidence."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time
from datetime import datetime, timezone


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", choices=("tts", "asr"), required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--text", help="Chinese text for TTS")
    parser.add_argument("--audio", type=Path, help="Local audio file for ASR")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--speaker", default="Vivian")
    parser.add_argument("--instruct", default="用温柔、关切、平静的语气说话。")
    parser.add_argument("--max-new-tokens", type=int, default=512)
    parser.add_argument("--sample", action="store_true", help="Use the upstream TTS sampling defaults with seed 42")
    args = parser.parse_args()
    if not args.model_dir.is_dir():
        parser.error("--model-dir must be an existing local directory, not a model ID or URL")
    if args.task == "tts" and not (args.text and args.text.strip()):
        parser.error("--task tts requires nonempty --text")
    if args.task == "asr" and not (args.audio and args.audio.is_file()):
        parser.error("--task asr requires an existing local --audio file")
    if args.max_new_tokens <= 0:
        parser.error("--max-new-tokens must be positive")
    return args


def run(args: argparse.Namespace) -> int:
    # Set these before importing Transformers or either Qwen package.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_DATASETS_OFFLINE"] = "1"
    args.model_dir = args.model_dir.resolve()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.output_dir / f"speech-{args.task}-report.json"
    started = time.perf_counter()
    report: dict = {
        "task": args.task,
        "status": "error",
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "script_sha256": sha256(Path(__file__)),
        "model_dir": str(args.model_dir),
        "offline_loading": True,
        "training_performed": False,
        "evaluation_scope": "single-sample inference smoke; not accuracy or engineering acceptance",
        "request": {"text": args.text, "audio": str(args.audio) if args.audio else None},
    }
    torch = None
    try:
        source_path = args.model_dir / "speech-source.json"
        source = json.loads(source_path.read_text(encoding="utf-8"))
        license_path = args.model_dir / source["license_document"]
        if not source.get("revision") or not license_path.is_file():
            raise ValueError("speech-source.json needs a resolved revision and an existing license document")
        report["model_source"] = source
        report["source_manifest_path"] = str(source_path)
        report["source_manifest_sha256"] = sha256(source_path)
        report["license_source_path"] = str(license_path)
        report["license_source_sha256"] = sha256(license_path)

        import torch
        import soundfile as sf

        if not torch.cuda.is_available():
            raise RuntimeError("This GPU baseline requires a working CUDA device")
        torch.cuda.synchronize()
        torch.cuda.reset_peak_memory_stats()
        device = torch.cuda.get_device_properties(0)
        package = "qwen-tts" if args.task == "tts" else "qwen-asr"
        report["environment"] = {
            "python": sys.version,
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "transformers": importlib.metadata.version("transformers"),
            package: importlib.metadata.version(package),
            "gpu": device.name,
            "gpu_total_memory_bytes": device.total_memory,
            "dtype": "bfloat16",
            "attention": "sdpa",
        }
        load_started = time.perf_counter()
        load_kwargs = {
            "device_map": "cuda:0",
            "dtype": torch.bfloat16,
            "attn_implementation": "sdpa",
            "local_files_only": True,
        }
        if args.task == "tts":
            from qwen_tts import Qwen3TTSModel

            model = Qwen3TTSModel.from_pretrained(str(args.model_dir), **load_kwargs)
        else:
            from qwen_asr import Qwen3ASRModel

            model = Qwen3ASRModel.from_pretrained(
                str(args.model_dir), max_inference_batch_size=1,
                max_new_tokens=args.max_new_tokens, **load_kwargs,
            )
        torch.cuda.synchronize()
        report["model_load_wall_time_seconds"] = time.perf_counter() - load_started
        inference_started = time.perf_counter()
        with torch.inference_mode():
            if args.task == "tts":
                report["request"].update(speaker=args.speaker, instruct=args.instruct, language="Chinese")
                if args.sample:
                    torch.manual_seed(42)
                report["generation"] = {"do_sample": args.sample, "subtalker_dosample": args.sample,
                                        "seed": 42 if args.sample else None}
                wavs, sample_rate = model.generate_custom_voice(
                    text=args.text, language="Chinese", speaker=args.speaker,
                    instruct=args.instruct, max_new_tokens=args.max_new_tokens,
                    do_sample=args.sample, subtalker_dosample=args.sample,
                )
                torch.cuda.synchronize()
                if len(wavs) != 1 or len(wavs[0]) == 0:
                    raise RuntimeError("TTS returned no single-sample waveform")
                audio_path = args.output_dir / "speech-tts.wav"
                sf.write(str(audio_path), wavs[0], sample_rate, subtype="PCM_16")
                report["raw_output"] = {
                    "audio_path": str(audio_path.resolve()),
                    "audio_sha256": sha256(audio_path),
                    "sample_rate_hz": sample_rate,
                    "samples": len(wavs[0]),
                    "duration_seconds": len(wavs[0]) / sample_rate,
                }
            else:
                audio_info = sf.info(str(args.audio))
                report["input_audio"] = {
                    "path": str(args.audio.resolve()), "sha256": sha256(args.audio),
                    "sample_rate_hz": audio_info.samplerate,
                    "duration_seconds": audio_info.duration,
                    "channels": audio_info.channels,
                }
                results = model.transcribe(audio=str(args.audio.resolve()), language="Chinese")
                torch.cuda.synchronize()
                report["raw_output"] = [
                    {"language": result.language, "text": result.text,
                     "time_stamps": result.time_stamps}
                    for result in results
                ]
                if len(results) != 1 or not results[0].text.strip():
                    raise RuntimeError("ASR returned no single-sample transcription")
        report["inference_wall_time_seconds"] = time.perf_counter() - inference_started
        report["max_new_tokens"] = args.max_new_tokens
        report["status"] = "succeeded"
    except Exception as error:
        report["error"] = {"type": type(error).__name__, "message": str(error)}
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
    finally:
        if torch is not None and torch.cuda.is_available():
            report["cuda_peak_allocated_bytes"] = torch.cuda.max_memory_allocated()
            report["cuda_peak_reserved_bytes"] = torch.cuda.max_memory_reserved()
        report["wall_time_seconds"] = time.perf_counter() - started
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(str(report_path))
    return 0 if report["status"] == "succeeded" else 1


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
