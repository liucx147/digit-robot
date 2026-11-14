# Ticket 01 local browser baseline

Recorded 2026-11-13; this is a functional development baseline, with engineering acceptance still open.

- Browser: Chrome 157.0.8103.51 on Windows; Node v24.18.0; Three.js 0.181.2.
- Rendering: actual WebGL 2 canvas using Chrome headless SwiftShader flags, with the bundled VRM v1.0.1 face geometry, embedded textures and named mouth morph. This measures the local test browser, not the remote GPU or whole-system inference.
- Static resources: browser requests remained on the loopback test origin; no CDN/model/cloud request was observed.
- Audio: real browser media playback of uploaded PCM WAV and the bundled CC0 Mandarin recording. The fixed test fixture is 16 kHz PCM16: 220 Hz sound at 0–0.6 s, silence at 0.6–1.4 s, sound at 1.4–2.0 s, silence until completion at 2.3 s. It is synthetic test audio, separate from the Mandarin recording.
- Public test result: `node --test web/tests/public-page.test.cjs` → 11 tests, 11 pass, 0 fail, 25.33 s. The successful run included actual canvas-pixel changes across the fixed pause, zero final jaw weight, a 500 ms Stop assertion, corrupt/missing resources, opposite-polarity stereo, and late success/failure acknowledgements.
- One saved fixture-playback record contained 88 frames over the 2,300 ms media duration, maximum adjacent recorded audio-time gap 112 ms, jaw range 0–1, final frame id 87 at 2,300 ms with jawOpen 0. These are internal diagnostics from that individual run; screenshot work and software-rendering load affect cadence, and this is not a measured visible/audio synchronization score.
- The saved `artifacts/ticket-01-head.png`, `ticket-01-mouth-open.png`, `ticket-01-mouth-silent.png` were visually inspected: a textured 3D head is visible, with a clearly open mouth during the sound and a closed mouth during the fixed silence. `artifacts/ticket-01-playback.json` is the exported public playback record. These generated files are ignored and may be replaced on a later run.
- Avatar, recording and bundled VRM license hashes match [the asset notices](assets/NOTICES.md). No physical-robot assets, hardware adapters or protocols were added.

The browser test's media-clock and screenshot evidence does not capture the sound emitted by a physical speaker. No shared audio/video acceptance recording, 95%/200 ms event score, 30-minute/20-turn full-system run, ASR/LLM/TTS integration, or 5090 measurement is claimed. The remote host can serve these static bytes through Python with the browser rendering on the client; remote deployment and the final usable URL are verified by integration separately.
