"""Run with PYTHONPATH=src python -m digital_human.measurement_cli."""
import argparse
import json
from pathlib import Path
import sys
from .measurement import score
from .measurement.freeze import freeze


def main():
    parser = argparse.ArgumentParser(description="Independent mouth/audio measurement")
    commands = parser.add_subparsers(dest="command", required=True)
    frozen = commands.add_parser("freeze", help="Freeze the bundled Mandarin recording into a 40-event cadence")
    frozen.add_argument("--source", type=Path, required=True)
    frozen.add_argument("--output-dir", type=Path, required=True)
    report = commands.add_parser("score", help="Validate evidence and score every frozen expected event")
    report.add_argument("--ledger", type=Path, required=True)
    report.add_argument("--annotations", type=Path, required=True)
    report.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "freeze":
            result = freeze(args.source, args.output_dir)
            print(f'{result["events"]} frozen events; ledger SHA256 {result["ledger_sha256"]}')
        else:
            protected = {args.ledger.resolve(), args.annotations.resolve()}
            if args.output.resolve() in protected:
                raise ValueError("report output cannot overwrite ledger or annotations")
            result = score(args.ledger, args.annotations)
            if args.output.exists():
                raise ValueError("report already exists; choose a new output to preserve evidence")
            args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
            print(f'{result["passed"]}/{result["total"]}; {result["acceptance_status"]}')
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"measurement error: {error}", file=sys.stderr)
        return 2
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
