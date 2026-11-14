# Local audio talking head

Start the offline static page from the repository root (Python 3.12 or later):

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory web
```

Open http://127.0.0.1:8765/ in a WebGL 2 browser. Select **载入中文录音示例** for the bundled Mandarin “你好” recording, or choose a local WAV/MP3/other browser-decodable audio file. Click **播放音频**; **停止** pauses playback, closes the mouth and advances the animation epoch. The smile slider mixes a separate face contribution through the same controller. Loading failures leave playback disabled and show the failing stage. This page needs no model service, Node server, CDN, network audio or robot connection.

The standard glTF loader renders the original VRM's core materials and skeletal geometry. It uses the actual named face morphs rather than a substitute head. The camera frames the head and shoulders of a full-body asset. MToon styling, spring bones, VRM constraints, camera gaze and phoneme lip-sync are outside this demo.

The audio is played by an HTML audio element. A local decoded energy envelope uses the mean squared energy of all channels (so opposite-polarity stereo does not cancel). Every animation frame reads `audio.currentTime` and samples the corresponding 20 ms window. Silence maps to zero jaw weight. End/Stop explicitly apply a closed mouth. A `requestAnimationFrame` loop is fenced by the session epoch. The mouth envelope is a simple amplitude gate and may react to music/noise; it is not a speech or phoneme recognizer.

**播放记录 → 下载播放记录** saves JSON for the latest playback, including source avatar/version/hash, local audio description, events and frames with `utterance_id`, `session_epoch`, `frame_id`, `audio_time_ms`, normalized `weights`. Records live in this page only; they are not uploaded or silently persisted. At 120,000 frames the file marks `truncated: true` instead of growing without limit. `digitalhuman:frame` is also a documented DOM event for subsequent integration; playback currently enters through the visible page controls.

## Browser verification

Tests operate only through the public page, real file upload/audio playback, rendered canvas pixels and the page's downloadable records. Missing/corrupt/delayed files are controlled at the HTTP-resource boundary. Cancellation tests delay the browser media-device play acknowledgement while still invoking real media playback; they do not fake the audio element or face renderer. No private controller helper is tested or mocked.

Install Playwright in a development dependency directory, or set `PLAYWRIGHT_MODULE` to an existing Playwright package. Set `CHROME_PATH` to a local Chrome/Chromium executable, or omit it when the normal Playwright Chromium install is available. Then run from the repository root:

```powershell
node --test web/tests/public-page.test.cjs
```

The test runner serves its own temporary loopback HTTP port. Chrome uses software WebGL to make headless rendering independent of a particular GPU. Tests generate a clearly identified sine-wave/silence fixture; the bundled speech test uses the CC0 recording. The rendered head, open-mouth and silent-mouth screenshots plus the downloaded playback JSON are saved in ignored `artifacts/`. These are test evidence for inspection, not an audiovisual acceptance recording.

These tests check the browser media clock, rendered pixel change across a known pause, a zero mouth at completion, correlated frame records, local resources, invalid input recovery and the 500 ms Stop path. They do not collect speaker-loopback audio/video, prove the 95% visible/audio synchronization criterion, run 30 minutes/20 model turns, exercise the full ASR/LLM/TTS pipeline, or measure GPU inference. Ticket 01 remains subject to integration review and actual audiovisual acceptance.

Source and redistribution terms: [asset notices](assets/NOTICES.md).
