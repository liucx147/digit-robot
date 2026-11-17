"""Frozen-denominator reports. Renderer weights and planned timestamps are never observations."""
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def evidence(item, root):
    relative = Path(item["path"])
    require(not relative.is_absolute() and ".." not in relative.parts, "evidence path must stay inside its bundle")
    path = (Path(root) / relative).resolve()
    require(path.is_relative_to(Path(root).resolve()), "evidence path leaves bundle")
    require(path.is_file() and digest(path) == item["sha256"], f"missing or changed evidence: {relative}")
    return {"path": relative.as_posix(), "sha256": digest(path), "bytes": path.stat().st_size}


def validate(ledger, annotations, ledger_path, annotations_path):
    require(isinstance(ledger, dict) and isinstance(annotations, dict), "ledger and annotations must be JSON objects")
    require(ledger["schema"] == annotations["schema"] == 1, "unsupported schema")
    require(digest(ledger_path) == annotations["ledger_sha256"], "frozen ledger hash mismatch")
    rules = ledger["rules"]
    require(isinstance(rules, dict), "rules must be an object")
    require(rules["tolerance_ms"] == 200 and rules["required_ratio"] == .95, "acceptance rules must remain inclusive 200ms and 95%")
    require(number(rules["pairing_window_ms"]) and 200 <= rules["pairing_window_ms"] <= 1000, "invalid pairing window")
    require(bool(rules["audio_rule"]) and bool(rules["visual_rule"]), "freeze independent observation rules")
    events = ledger["events"]
    require(isinstance(events, list) and bool(events), "empty expected denominator")
    require(all(isinstance(e, dict) for e in events), "expected events must be objects")
    identifiers = [e["id"] for e in events]
    require(all(isinstance(i, str) and i for i in identifiers) and len(set(identifiers)) == len(events), "duplicate or empty expected ID")
    times = [e["source_ms"] for e in events]
    require(all(number(t) and t >= 0 for t in times) and all(a < b for a,b in zip(times,times[1:])), "expected source times must increase")
    require(all(e["type"] in ("open", "close") for e in events), "unknown expected transition")
    fixture = evidence(ledger["fixture"], Path(ledger_path).parent)
    media = annotations["media"]
    require(isinstance(media, dict), "media must be an object")
    require(media["scope"] in ("browser-graph", "browser-output", "physical-av"), "unknown capture scope")
    require(media["timebase"] == "single-media-timeline", "audio and video must share one unreset timeline")
    require(number(media["duration_ms"]) and media["duration_ms"] > 0, "invalid capture duration")
    capture = evidence(media, Path(annotations_path).parent)
    manifest_evidence, capture_failure = None, None
    capture_context = None
    require(isinstance(annotations.get("capture_manifest"), dict), "captures require the original capture manifest")
    manifest_evidence = evidence(annotations["capture_manifest"], Path(annotations_path).parent)
    manifest = read(Path(annotations_path).parent / manifest_evidence["path"])
    require(isinstance(manifest, dict), "manifest must be an object")
    require(manifest["schema"] == 1 and manifest["scope"] == media["scope"] and manifest["media"]["sha256"] == media["sha256"] and manifest["ledger_sha256"] == annotations["ledger_sha256"], "capture manifest does not match this ledger/media/scope")
    if manifest["complete_playback"] is not True:
        capture_failure = "incomplete-capture"
    elif manifest["audio_non_silent"] is not True:
        capture_failure = "missing-captured-audio"
    avatar, renderer = manifest.get("avatar"), manifest.get("renderer")
    capture_context = {"avatar": avatar, "renderer": renderer, "revision_and_conditions": manifest.get("revision_and_conditions"), "product_url": manifest.get("product_url"), "physical_review": manifest.get("physical_review")}
    if not capture_failure:
        if not isinstance(avatar, dict) or not all(isinstance(avatar.get(key), str) and avatar[key].strip() for key in ("sha256", "type", "version")) or len(avatar["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in avatar["sha256"]):
            capture_failure = "missing-avatar-identity"
        elif ledger.get("setup", {}).get("avatar_sha256") and avatar["sha256"] != ledger["setup"]["avatar_sha256"]:
            capture_failure = "avatar-mismatch"
        elif not isinstance(renderer, dict) or not all(isinstance(renderer.get(key), str) and renderer[key].strip() for key in ("renderer", "vendor", "webgl_version")):
            capture_failure = "missing-renderer-identity"
    if not capture_failure and media["scope"] == "physical-av":
        declaration = manifest.get("physical_review")
        if not isinstance(declaration, dict) or declaration.get("basis") != "operator-declared" or declaration.get("conditions_match") is not True or not isinstance(declaration.get("operator"), str) or not declaration["operator"].strip() or not isinstance(manifest.get("revision_and_conditions"), str) or not manifest["revision_and_conditions"].strip():
            capture_failure = "missing-physical-declaration"
    review = annotations["review"]
    require(isinstance(review, dict), "review must be an object")
    require(bool(review["annotator"]) and review["method"] == "independent-media-review" and review["audio_basis"] == "captured-audio" and review["visual_basis"] == "recorded-pixels", "review must observe recorded pixels and captured audio independently")
    require(number(annotations["source_origin_ms"]) and annotations["source_origin_ms"] >= 0, "invalid source origin")
    calibration = annotations["calibration"]
    require(isinstance(calibration, dict), "calibration must be an object")
    require(calibration["status"] in ("pending", "calibrated"), "invalid calibration status")
    calibration_evidence = None
    if calibration["status"] == "calibrated":
        require(calibration["method"] == "independent-av-calibration" and bool(calibration["description"]), "independent calibration required")
        require(number(calibration["offset_ms"]) and number(calibration["uncertainty_ms"]) and calibration["uncertainty_ms"] >= 0, "invalid calibration values")
        calibration_evidence = evidence(calibration["evidence"], Path(annotations_path).parent)
        require(calibration_evidence["sha256"] != capture["sha256"], "calibrate with an independent known A/V stimulus, not product edges")
    require(isinstance(annotations["events"], list), "invalid observations")
    for row in annotations["events"]:
        require(isinstance(row, dict), "observations must be objects")
        require(row["expected_id"] in identifiers, "unknown expected event")
        require(row["type"] in ("open", "close"), "unknown observed transition")
        for channel in ("audio", "visual"):
            interval = row.get(channel + "_ms")
            if interval is not None:
                require(isinstance(interval, list) and len(interval) == 2 and all(number(v) for v in interval) and 0 <= interval[0] <= interval[1] <= media["duration_ms"], "invalid or out-of-media observation interval")
                require(isinstance(row.get(channel + "_observation_id"), str) and bool(row[channel + "_observation_id"]) and bool(row.get(channel + "_evidence")), "observed edges need unique IDs and evidence notes")
    require(isinstance(annotations.get("unexpected", []), list), "unexpected transitions must be preserved as a list")
    return {"fixture": fixture, "capture": capture, "calibration": calibration_evidence, "ledger_sha256": digest(ledger_path), "annotations_sha256": digest(annotations_path), "capture_manifest": manifest_evidence, "capture_failure": capture_failure, "capture_context": capture_context}


def score(ledger_path, annotations_path):
    ledger, annotations = read(ledger_path), read(annotations_path)
    provenance = validate(ledger, annotations, ledger_path, annotations_path)
    by_id = defaultdict(list)
    for observed in annotations["events"]:
        by_id[observed["expected_id"]].append(observed)
    used = {key: Counter(row.get(key) for row in annotations["events"] if row.get(key)) for key in ("audio_observation_id", "visual_observation_id")}
    calibration = annotations["calibration"]
    offset = calibration.get("offset_ms", 0) if calibration["status"] == "calibrated" else 0
    uncertainty = calibration.get("uncertainty_ms", 0) if calibration["status"] == "calibrated" else 0
    window = ledger["rules"]["pairing_window_ms"]
    rows = []
    for expected in ledger["events"]:
        candidates = by_id[expected["id"]]
        row = {"expected_id": expected["id"], "type": expected["type"], "pass": False, "reason": "missing-observation", "delta_ms": None, "error_interval_ms": None, "candidates": candidates}
        if provenance["capture_failure"]:
            row["reason"] = provenance["capture_failure"]
        elif len(candidates) > 1:
            row["reason"] = "ambiguous"
        elif candidates:
            observed = candidates[0]
            audio, visual = observed.get("audio_ms"), observed.get("visual_ms")
            if observed.get("error"):
                row["reason"] = "review-error"
            elif observed["type"] != expected["type"]:
                row["reason"] = "type-mismatch"
            elif audio is None:
                row["reason"] = "missing-audio"
            elif visual is None:
                row["reason"] = "missing-visual"
            elif any(used[key][observed.get(key)] > 1 for key in used):
                row["reason"] = "reused-observation"
            elif max(abs(v - expected["source_ms"] - annotations["source_origin_ms"]) for v in audio) > window:
                row["reason"] = "unpairable-audio"
            elif max(abs(visual[0] - audio[1]), abs(visual[1] - audio[0])) > window:
                row["reason"] = "unpairable-visual"
            else:
                raw_lower, raw_upper = visual[0] - audio[1], visual[1] - audio[0]
                lower, upper = raw_lower - offset - uncertainty, raw_upper - offset + uncertainty
                row.update(raw_error_interval_ms=[raw_lower, raw_upper], delta_ms=(lower + upper) / 2, error_interval_ms=[lower, upper])
                row["pass"] = lower >= -200 and upper <= 200
                row["reason"] = "within-tolerance" if row["pass"] else "outside-tolerance-or-uncertain"
        rows.append(row)
    passed = sum(row["pass"] for row in rows)
    scope = annotations["media"]["scope"]
    if scope != "physical-av":
        status = "pending-independent-physical-av"
    elif provenance["capture_failure"]:
        status = "invalid-capture-evidence"
    elif not ledger.get("setup", {}).get("avatar_sha256"):
        status = "pending-frozen-avatar-identity"
    else:
        status = "eligible-for-human-evidence-review" if calibration["status"] == "calibrated" else "pending-calibration"
    return {"schema": 1, "passed": passed, "total": len(rows), "required_passed": (95 * len(rows) + 99) // 100, "success_rate": passed / len(rows), "threshold_pass": passed * 100 >= len(rows) * 95, "events": rows, "unexpected": annotations.get("unexpected", []), "rules": ledger["rules"], "calibration": calibration, "evidence_scope": scope, "provenance": provenance, "review": annotations["review"], "acceptance_status": status, "limitations": ["Scores depend on independent human annotations; hashes preserve bytes, not truth of review.", "Avatar/renderer metadata and physical conditions are declarations, not automatic identification from recorded pixels.", "Legacy ledgers without a frozen avatar identity support diagnostics only, never physical eligibility.", "Pending calibration scores are raw diagnostic values; no device timing correction is assumed.", "Browser graph/tab capture does not measure physical speaker/DAC/display latency.", "Re-run on final integration; this report alone does not close ticket 09 or prove full-system/5090 acceptance."]}
