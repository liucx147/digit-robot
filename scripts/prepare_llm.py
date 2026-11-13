"""Download the pinned upstream student, then record an auditable local manifest."""

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    from modelscope import snapshot_download

    revision = "ed182e32090db791077e12e0f58d22f3daafa173"
    model_dir = Path(snapshot_download(
        "Qwen/Qwen3.5-4B", revision=revision, local_dir=str(args.model_dir)
    ))
    files = []
    for path in sorted(model_dir.rglob("*")):
        if not path.is_file() or any(part.startswith(".") for part in path.relative_to(model_dir).parts):
            continue
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                digest.update(block)
        files.append({"path": str(path.relative_to(model_dir)), "bytes": path.stat().st_size,
                      "sha256": digest.hexdigest()})
    manifest = {
        "model_id": "Qwen/Qwen3.5-4B", "revision": revision,
        "source": "https://modelscope.cn/models/Qwen/Qwen3.5-4B",
        "upstream_card": "https://huggingface.co/Qwen/Qwen3.5-4B",
        "upstream_declared_license": "Apache-2.0",
        "project_adaptation": "none", "local_dir": str(model_dir),
        "modelscope_version": importlib.metadata.version("modelscope"), "files": files,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(args.output), "file_count": len(files)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
