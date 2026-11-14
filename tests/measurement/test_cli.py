"""Public report CLI tests. Synthetic timestamps verify arithmetic, never A/V acceptance."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

class MeasurementCLI(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "fixture.wav").write_bytes(b"synthetic frozen speech test")
        (self.root / "capture.webm").write_bytes(b"synthetic recording evidence, not acceptance")
        self.ledger = {"schema": 1, "fixture": {"path": "fixture.wav", "sha256": self.digest("fixture.wav")}, "rules": {"tolerance_ms": 200, "required_ratio": 0.95, "pairing_window_ms": 1000, "audio_rule": "fixed independent review", "visual_rule": "first visible pixel change"}, "events": [{"id": f"e{i}", "type": "open" if i % 2 == 0 else "close", "source_ms": 1000 + i * 2000} for i in range(40)]}
        self.write("ledger.json", self.ledger)
        self.annotations = {"schema": 1, "ledger_sha256": self.digest("ledger.json"), "media": {"path": "capture.webm", "sha256": self.digest("capture.webm"), "scope": "browser-graph", "duration_ms": 85000, "timebase": "single-media-timeline"}, "review": {"annotator": "synthetic CLI test", "method": "independent-media-review", "audio_basis": "captured-audio", "visual_basis": "recorded-pixels"}, "source_origin_ms": 0, "calibration": {"status": "pending"}, "events": [{"expected_id": e["id"], "type": e["type"], "audio_ms": [e["source_ms"], e["source_ms"]], "visual_ms": [e["source_ms"], e["source_ms"]], "audio_observation_id": f"a{i}", "visual_observation_id": f"v{i}", "audio_evidence": "synthetic test audio edge", "visual_evidence": "synthetic test pixel edge"} for i,e in enumerate(self.ledger["events"])], "unexpected": []}
        self.write("capture-manifest.json", {"schema": 1, "scope": "browser-graph", "media": {"sha256": self.digest("capture.webm")}, "ledger_sha256": self.digest("ledger.json"), "complete_playback": True, "audio_non_silent": True})
        self.annotations["capture_manifest"] = {"path": "capture-manifest.json", "sha256": self.digest("capture-manifest.json")}
    def tearDown(self):
        self.temp.cleanup()
    def digest(self, name):
        return hashlib.sha256((self.root / name).read_bytes()).hexdigest()
    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value), encoding="utf-8")
    def score(self):
        self.write("annotations.json", self.annotations)
        result = subprocess.run([sys.executable, "-m", "digital_human.measurement_cli", "score", "--ledger", str(self.root / "ledger.json"), "--annotations", str(self.root / "annotations.json"), "--output", str(self.root / "report.json")], cwd=ROOT, env={**os.environ, "PYTHONPATH": str(ROOT / "src")}, capture_output=True, text=True)
        report = json.loads((self.root / "report.json").read_text()) if (self.root / "report.json").exists() else None
        return result, report
    def test_inclusive_signed_boundaries_and_fixed_denominator(self):
        for i, delta in enumerate([199, 200, 201, -199, -200, -201]):
            source = self.ledger["events"][i]["source_ms"]
            self.annotations["events"][i]["visual_ms"] = [source + delta, source + delta]
        result, report = self.score()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(report["passed"], 38)
        self.assertEqual(report["total"], 40)
        self.assertTrue(report["threshold_pass"])
        self.assertEqual([e["pass"] for e in report["events"][:6]], [True, True, False, True, True, False])
        self.assertEqual(report["acceptance_status"], "pending-independent-physical-av")

    def test_missing_ambiguous_reused_and_uncertain_edges_stay_failures(self):
        rows = self.annotations["events"]
        rows[0]["audio_ms"] = None
        rows[1]["visual_ms"] = None
        rows.append(dict(rows[2]))
        rows[3]["visual_observation_id"] = rows[4]["visual_observation_id"]
        source = self.ledger["events"][5]["source_ms"]
        rows[5]["visual_ms"] = [source + 199, source + 201]
        result, report = self.score()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((report["passed"], report["total"], report["threshold_pass"]), (34, 40, False))
        self.assertEqual([e["reason"] for e in report["events"][:6]], ["missing-audio", "missing-visual", "ambiguous", "reused-observation", "reused-observation", "outside-tolerance-or-uncertain"])
    def test_37_of_40_fails_without_rounding_up(self):
        del self.annotations["events"][:3]
        result, report = self.score()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((report["passed"], report["success_rate"], report["threshold_pass"]), (37, .925, False))


    def test_invalid_or_tampered_inputs_are_rejected(self):
        import copy
        cases = [
            ("empty denominator", lambda l,a: l.update(events=[])),
            ("duplicate frozen id", lambda l,a: l["events"].append(dict(l["events"][0]))),
            ("invalid ledger rule", lambda l,a: l["rules"].update(tolerance_ms=201)),
            ("stale ledger hash", lambda l,a: a.update(ledger_sha256="0" * 64)),
            ("stale media hash", lambda l,a: a["media"].update(sha256="0" * 64)),
            ("wrong basis", lambda l,a: a["review"].update(visual_basis="controller-weights")),
            ("unknown event", lambda l,a: a["events"][0].update(expected_id="unknown")),
            ("invalid interval", lambda l,a: a["events"][0].update(visual_ms=[1001, 1000])),
            ("nonfinite time", lambda l,a: a["events"][0].update(audio_ms=[float("nan"), 1000])),
            ("outside media", lambda l,a: a["events"][0].update(audio_ms=[90000, 90000])),
            ("path traversal", lambda l,a: a["media"].update(path="../capture.webm")),
        ]
        original_l, original_a = copy.deepcopy(self.ledger), copy.deepcopy(self.annotations)
        for name, mutate in cases:
            with self.subTest(name=name):
                self.ledger, self.annotations = copy.deepcopy(original_l), copy.deepcopy(original_a)
                mutate(self.ledger, self.annotations)
                self.write("ledger.json", self.ledger)
                if name != "stale ledger hash":
                    self.annotations["ledger_sha256"] = self.digest("ledger.json")
                (self.root / "report.json").unlink(missing_ok=True)
                result, report = self.score()
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertIsNone(report)
    def test_wrong_type_unpairable_edges_and_review_errors_count_as_failures(self):
        self.annotations["events"][0]["type"] = "close"
        self.annotations["events"][1]["audio_ms"] = [200, 200]
        self.annotations["events"][2]["error"] = "mouth obscured by capture overlay"
        self.annotations["unexpected"] = [{"type": "open", "at_ms": 82000, "note": "extra oscillation"}]
        result, report = self.score()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(report["passed"], 37)
        self.assertEqual([e["reason"] for e in report["events"][:3]], ["type-mismatch", "unpairable-audio", "review-error"])
        self.assertEqual(len(report["unexpected"]), 1)
    def test_calibration_uncertainty_is_conservative_and_browser_scope_stays_pending(self):
        (self.root / "calibration.webm").write_bytes(b"independently known calibration, synthetic test")
        self.annotations["calibration"] = {"status": "calibrated", "method": "independent-av-calibration", "offset_ms": 20, "uncertainty_ms": 2, "description": "synthetic calibration test, not product edges", "evidence": {"path": "calibration.webm", "sha256": self.digest("calibration.webm")}}
        self.annotations["events"][0]["visual_ms"] = [1219, 1219]
        result, report = self.score()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(report["events"][0]["error_interval_ms"], [197, 201])
        self.assertFalse(report["events"][0]["pass"])
        self.assertEqual(report["acceptance_status"], "pending-independent-physical-av")
    def test_freeze_creates_reproducible_mandarin_fixture_and_40_expected_edges(self):
        args = [sys.executable, "-m", "digital_human.measurement_cli", "freeze", "--source", str(ROOT / "web/assets/nihao-cc0.wav"), "--output-dir", str(self.root / "frozen")]
        env = {**os.environ, "PYTHONPATH": str(ROOT / "src")}
        first = subprocess.run(args, cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        ledger = json.loads((self.root / "frozen/ledger.json").read_text())
        self.assertEqual(ledger["source"]["license_notice"], "../../assets/NOTICES.md")
        bundled = ROOT / "web/measurement-fixtures/mandarin40"
        self.assertTrue((bundled / ledger["source"]["license_notice"]).is_file(), "bundled source notice resolves to the actual license file")
        self.assertEqual((self.root / "frozen/ledger.json").read_bytes(), (bundled / "ledger.json").read_bytes(), "generator and committed metadata remain reproducible")
        self.assertEqual(len(ledger["events"]), 40)
        self.assertEqual([r["type"] for r in ledger["events"][:4]], ["open", "close", "open", "close"])
        original = (self.root / "frozen/ledger.json").read_bytes()
        second = subprocess.run(args, cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual((self.root / "frozen/ledger.json").read_bytes(), original)
        self.assertEqual(ledger["fixture"]["sha256"], hashlib.sha256((self.root / "frozen/fixture.wav").read_bytes()).hexdigest())
    def test_browser_manifest_is_required_and_incomplete_or_silent_capture_fails_every_event(self):
        (self.root / "capture-manifest.json").write_text(json.dumps({"schema":1,"scope":"browser-graph","media":{"sha256":self.digest("capture.webm")},"ledger_sha256":self.digest("ledger.json"),"complete_playback":False,"audio_non_silent":True}), encoding="utf-8")
        self.annotations["capture_manifest"] = {"path":"capture-manifest.json","sha256":self.digest("capture-manifest.json")}
        result, report = self.score()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((report["passed"], report["total"]), (0,40))
        self.assertTrue(all(row["reason"] == "incomplete-capture" for row in report["events"]))

    def test_silent_capture_fails_all_events_and_missing_manifest_is_rejected(self):
        manifest = json.loads((self.root / "capture-manifest.json").read_text())
        manifest["audio_non_silent"] = False
        self.write("capture-manifest.json", manifest)
        self.annotations["capture_manifest"]["sha256"] = self.digest("capture-manifest.json")
        result, report = self.score()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((report["passed"], report["total"]), (0,40))
        self.assertTrue(all(row["reason"] == "missing-captured-audio" for row in report["events"]))
        (self.root / "report.json").unlink()
        self.annotations.pop("capture_manifest")
        result, report = self.score()
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIsNone(report)
