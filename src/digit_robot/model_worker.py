"""One original-student generation in the isolated LLM environment."""

import argparse
import json
from pathlib import Path
import sys

from .transformers_backend import TransformersBackend


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    args = parser.parse_args()
    request = json.load(sys.stdin)
    backend = TransformersBackend(args.model_dir)
    raw = backend.generate(request["messages"])
    print(json.dumps({"raw_output": raw}, ensure_ascii=False))


if __name__ == "__main__":
    main()
