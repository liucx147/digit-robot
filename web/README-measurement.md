# Mouth / sound measurement

This is ticket 09's repeatable capture and scoring tool. It uses the actual ticket 01 page, canvas and audio element. No controller weights or playback JSON are used as measurement truth. The implementation and synthetic scorer checks do **not** establish the 95% audiovisual acceptance result. Physical screen/speaker calibration, independent event review, mixed gaze/expression runs and final integration measurement remain pending.

## Start and capture

From the repository root with Python 3.12 or later:

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory web
```

Open `http://127.0.0.1:8765/measurement.html` in a WebGL 2 Chromium browser. Click **准备固定40事件**. The page checks the frozen WAV hash and uploads it through the real speaking-head file input. Record the commit, browser/OS, viewport/zoom, audio output device, expression/gaze condition and any timing changes in the conditions field. Do not change conditions mid-run.

**录制画布与声音** explicitly captures the actual rendered canvas plus the real audio element's Web Audio output, connected to the audible destination and recorder. It writes a single WebM with video and audio, checks for non-silent audio graph samples and stops when actual playback ends. This is a software graph/surface diagnostic: it does not measure panel scanout, OS volume, DAC, speaker, Bluetooth delay or sound at the listener. No desktop or camera is recorded by this button.

**选择窗口并录制** requests native browser permission with video and audio. Choose the speaking-head tab/window and explicitly share its audio. Browser/OS support varies; missing audio, denied permission and ended tracks are visible failures. No silent fallback to the source WAV occurs. The actual selected surface may include surrounding UI; inspect it and avoid selecting unrelated content. Its `browser-output` scope also remains separate from physical screen/speaker acceptance.

Download **原始音视频**, **采集清单** and the frozen ledger before closing the page. The manifest preserves scope, raw-media/fixture/ledger hashes, track settings, viewport, user agent, conditions, non-silent check and whether playback completed. Recorder wall time is telemetry, not media PTS, source origin or measured synchronization. Early Stop saves original evidence with `complete_playback: false`; every expected event fails when this manifest is scored. Silent capture likewise fails all events. Never overwrite a prior run: use a separate evidence directory for each revision/condition/attempt, including failed and compensation-before/after runs.

Every recording start reloads the verified fixture into the actual product audio element, checks its bytes and duration, and starts it at zero. During capture, audio upload/sample/replay/Stop controls in the embedded page are locked; use **停止录制** to interrupt. Expression and gaze controls remain available. A source replacement, seek, replay, pause or playback-rate change detected at the media boundary invalidates the run. Its original media and manifest remain downloadable with `complete_playback: false` and a `playback_integrity` reason; an invalid run is never a complete fixed-input experiment.

## Frozen input and rules

`measurement-fixtures/mandarin40/` contains unchanged CC0 Mandarin source audio, a deterministic WAV with 20 repetitions separated by 600 ms silence and 1 s leading/trailing silence, and 40 fixed outer phrase open/close events. The original recording and license are documented in `assets/NOTICES.md`. Repeated “你好” is a narrow cadence fixture; it does not stand in for varied model replies or the full-system evaluation.

The source phrase boundaries use 10 ms PCM windows with RMS >= 0.01 full scale: first active window start and last active window end. Captured audio edges must be reviewed independently using the same declared rule, retaining their actual presentation time and uncertainty. Freeze the visible-mouth rule before observing results: bracket the first visible opening and the return to a closed-mouth reference between adjacent presented frames. Occlusion, ambiguous mouth state or unmeasurable edges fail. Preserve extra oscillations and internal transitions separately, rather than using them to replace missing outer events.

To reproduce the exact committed input (existing identical output is allowed; differing output is refused):

```powershell
$env:PYTHONPATH='src'
python -m digital_human.measurement_cli freeze --source web/assets/nihao-cc0.wav --output-dir web/measurement-fixtures/mandarin40
```

The ledger freezes the denominator, source hash, asset hash, rules, conditions and ordered event IDs before capture. The 2026-11-14 license-link-only metadata correction is recorded in [METADATA-CHANGE.md](measurement-fixtures/mandarin40/METADATA-CHANGE.md); older captures must keep their original ledger bytes/hash. A new speech corpus, boundary rule, asset or render condition needs a separately frozen/versioned run. Do not omit difficult or missing events after seeing output.

## Review original media and annotate

Load the original WebM in **载入原始音视频**. If reopening the page, prepare the frozen fixture and load its original capture manifest too. An independently recorded screen/speaker video may also be loaded, with scope `physical-av`. Inspect the actual mouth pixels and the captured sound. The player displays decoded frame `mediaTime` from `requestVideoFrameCallback`, supports seeking and saves original decoded evidence frames labeled by that PTS. Preserve the original container; do not infer timestamps from nominal FPS, reset audio/video separately to zero, or use download/callback arrival time. Browser decoding/seek is a manual review aid, not an independently calibrated measurement instrument.

Generate an empty annotation template after entering reviewer, actual media duration and the single source-fixture origin in the recording. WebM duration can be unavailable in browser metadata; determine it with a suitable media reviewer and fill it explicitly. Templates deliberately contain **null** observations. Populate each event's `audio_ms: [lower, upper]` and `visual_ms: [lower, upper]`, unique audio/visual observation IDs and evidence notes (frame names, PCM/waveform location or review method). Values are milliseconds on the original media timeline. Listening and clicking gives a broad uncertainty bracket; it must not be presented as a sample-accurate audio edge. A separately available media editor may be used for exact waveform annotation only if it preserves original stream offsets/PTS. No FFmpeg, PyAV, OpenCV or custom container parser is required by this tool or installed by it.

For example, an independently observed audio transition in `[1230,1240]` and visible transition in `[1260,1280]` gives raw error `[20,50]` ms. These numbers illustrate the format, not a recorded result. Null observations, duplicate candidates for the same expected ID, reused observation IDs, type mismatches, explicit `error` notes and events outside the one-to-one pairing window fail. Extra transitions go in `unexpected`. The scorer preserves all frozen events and candidate details.

For browser recordings, `capture_manifest` must name/hash the original manifest and match the same media, ledger and scope. Keep all files inside the annotation bundle; paths cannot traverse outside it. Raw media integrity checks preserve bytes, not the truth of human observations. Review is an explicit independent responsibility. Physical A/V annotation requires the same media/hash/timebase fields and independent apparatus description; a browser graph result must never be relabeled as physical evidence.

Calibration defaults to `pending`. To quantify a physical capture chain's offset and uncertainty, use an independently known audiovisual calibration source and retain its separate raw file. Do not force the product's mouth/audio errors to zero. A calibrated annotation has:

```json
"calibration": {
  "status": "calibrated",
  "method": "independent-av-calibration",
  "offset_ms": 0,
  "uncertainty_ms": 10,
  "description": "Replace with actual apparatus, known stimulus offset, distance, analysis and residual uncertainty",
  "evidence": {"path": "independent-calibration.webm", "sha256": "REPLACE_WITH_ACTUAL_HASH"}
}
```

The numbers above are schema examples, not supplied calibration values. Subtract offset from `visual - audio` and expand by calibration uncertainty. The calibration recording must differ from the product recording. A phone's own A/V processing offset also needs calibration. Keep raw and corrected intervals in reports. Without calibration, numerical rates are raw diagnostics with unknown capture-chain offset.

## Score and interpret

Copy the original capture, manifest, completed annotations, frozen `ledger.json` and its `fixture.wav` into a run directory. Preserve ledger bytes exactly, and keep any calibration evidence there. Then:

```powershell
$env:PYTHONPATH='src'
python -m digital_human.measurement_cli score --ledger artifacts/run-001/ledger.json --annotations artifacts/run-001/annotations.json --output artifacts/run-001/report.json
```

The CLI validates evidence paths/hashes, rules, ordered unique frozen IDs, independent pixel/audio review basis, finite intervals inside media duration and calibration provenance. Invalid documents/evidence exit 2 without writing a report. A valid report exits 0 even when the measurement fails; inspect `threshold_pass`, `passed`, `total`, per-event reasons and `acceptance_status`. Existing reports are never overwritten.

Pair expected type/ID once only within the frozen +/-1000 ms window of the captured audio origin. Signed error is visible time minus captured audio time. A pass requires the entire conservative error interval to be inside inclusive +/-200 ms. Every frozen event remains in the denominator; no paired-only denominator, average error or rounding up is allowed. The threshold is `passed * 100 >= total * 95`: 38/40 passes the numerical threshold; 37/40 fails. Calibration, missing media or renderer evidence cannot be replaced by this arithmetic.

`browser-graph` and `browser-output` reports always retain `pending-independent-physical-av`. Calibrated physical evidence is only `eligible-for-human-evidence-review`; the tool does not automatically approve a ticket. Repeat after final integration, including actual expression/gaze conditions and independent audiovisual calibration, alongside the separate stop/offline/30-minute/20-turn requirements. Temporary 4090D hosting and browser software rendering do not establish final 5090 or model-pipeline acceptance. No unmeasured scheduling compensation is applied by this change.

## Public-boundary verification

```powershell
python -m unittest discover -s tests/measurement -v
node --test web/tests/measurement-page.test.cjs
```

For browser tests set `PLAYWRIGHT_MODULE` to an existing Playwright package and `CHROME_PATH` to local Chrome when needed, as for the original public-page tests. Tests exercise real upload/playback, actual canvas/audio graph WebM recording, reloaded media pixels/audio, original downloads and public report CLI. Permission/capture-source failures are controlled only at browser media acquisition boundaries. Synthetic CLI timestamps verify signed 199/200/201 ms, 38/40 vs37/40, omissions, ambiguity, reused events, bad evidence, rules and calibration uncertainty; those are not acceptance recordings. Browser evidence is saved under ignored `artifacts/measurement/` for inspection, and remains software diagnostic evidence.
