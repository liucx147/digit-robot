# Local face-position gaze

Start the existing head page from the repository root:

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory web
```

Open `http://127.0.0.1:8765/`. Under **人脸位置注视**, choose a local image/video or select **开启摄像头注视** and allow the browser camera prompt. Only video is requested; the microphone is never requested. Camera preview is mirrored, and the avatar looks toward the face's visible side in that preview. Image/video inputs are not mirrored. Local video is muted and plays once. When it ends, gaze returns to neutral. The file input accepts browser-decodable images and videos; raw camera formats are not implied.

Load and play the existing Chinese audio sample or another local audio file at the same time. **停止注视** releases the camera and returns eyes to neutral while leaving audio running. The existing audio **停止** button stops audio and cancels gaze input immediately. Selecting another face input, stopping or leaving the page invalidates old generations, terminates the detector worker, releases tracks and revokes local object URLs. A late permission grant is immediately released. Camera denial, unavailable device, model load failure, inference timeout, stale video and no face have visible messages. `NotReadableError` or `DEVICE IN USE` explains that another program/browser tab may hold the camera and asks the user to end that use before retrying; the page cannot release an external application's device ownership. No face returns smoothly to neutral. After a failure, choose an input or enable the camera again.

The browser needs WebGL 2, Web Workers, WebAssembly, OffscreenCanvas and createImageBitmap. Camera access additionally requires a secure context (loopback/localhost or HTTPS), device availability, permission and applicable browser policy. An arbitrary HTTP LAN address does not meet that requirement. Through an SSH forward opened at local `127.0.0.1`, detection and camera use happen on the browser host; this is not evidence of inference on the remote host's GPU.

## Detection and mixing

The pinned Apache-2.0 `@mediapipe/tasks-vision@0.10.21` runtime and BlazeFace short-range float16 v1 model are bundled locally. No package installation, CDN or inference service is required at runtime. Both SIMD and non-SIMD WASM files are included for the runtime's local feature selection. See [versioned hashes and original URLs](assets/vision/manifest.json) and [license/source notices](assets/vision/NOTICES.md).

A dedicated classic worker runs the real FaceDetector with `delegate: CPU`, VIDEO mode and confidence 0.5. Input is scaled to at most 640 pixels on its longest side. Video detection is capped at five requests per second, one outstanding inference, without a frame backlog; repeated video timestamps are skipped. Model initialization times out after 15 seconds; video inference times out after two seconds and video progress expires after 1.5 seconds. Still images are detected once. Detection returns rectangles, not identity, face emotion or human eye-gaze estimates. The declared single-user policy follows the largest detected face when multiple faces enter; it does not preserve identity across frames. A warning is shown for multiple detections. Short-range frontal face detection has pose, lighting, occlusion and distance limits described in the bundled model card.

Rectangle center maps to bounded horizontal/vertical gaze with an 0.08 normalized dead zone and 120 ms time-constant smoothing. Output is mixed with the existing mouth, smile and blink contributions in `FaceController.apply`; audio's actual media position remains the mouth clock. A separate callback only requests an idle render when audio is not playing. It cannot write a zero mouth over a playing audio frame. The existing VRM's verified `leftEye`/`rightEye` bones (`J_Adj_L_FaceEye`, `J_Adj_R_FaceEye`) are rotated by at most ten degrees from their original pose, using world axes because their local axes are not canonical. This is actual skinned-eye motion, with the binary avatar unchanged. All final named weights remain in [0,1].

The visible **注视检测记录** shows the latest source, mirror convention, real detector rectangle/confidence/inference duration and smoothed gaze. These are diagnostics, not a separate acceptance measurement. Camera frames and face records stay in the current browser page; the application does not upload or persist them.

## Browser verification and remaining acceptance

Use the existing Playwright installation or set `PLAYWRIGHT_MODULE`, and optionally `CHROME_PATH`, as described in [the head README](README.md). Run serially to avoid making two software-rendering browser suites compete for CPU:

```powershell
node --test --test-concurrency=1 web/tests/public-page.test.cjs web/tests/gaze-public.test.cjs
```

Tests use only the public page, file uploads, camera system boundary, real media playback, downloadable/public frame records and actual canvas screenshots. The real local CPU detector processes a public-domain NASA photograph at left/right/up/down positions, a recorded WebM of those real pixels, and a real canvas MediaStream supplied at the camera device boundary. Detection boxes, the worker and the renderer are never mocked. Permission refusal and a delayed grant are device-boundary fixtures. The camera-stream fixture is explicitly automated input, not a physical camera or a live human session. External network requests are blocked during the fresh-context photograph test; runtime/model/WASM fetches remain local.

Generated evidence is ignored under `artifacts/`: `ticket-08-left.png`, `ticket-08-right.png`, `ticket-08-up.png`, `ticket-08-down.png`, `ticket-08-speaking.png`, `ticket-08-pause.png`, `ticket-08-detection.json` and `ticket-08-fixed-face.webm`. The photographic video translates one still photograph; it is not footage of a person moving in front of a real camera. Sine/silence audio is a diagnostic fixture, separate from the bundled Mandarin speech. Screenshots verify visible eye movement and speaking/pause behavior; they do not establish a measured audiovisual alignment percentage. With the test smile slider at 0.5, the pause has jawOpen=0 and smile=0.5; its rendered smiling rest pose still has slightly parted lips. A zero jaw weight is not proof of geometrically sealed lips.

2026-11-14 update: the user confirmed live-camera left/right/up/down following, concurrent Mandarin mouth/gaze, neutral return with no face, and reopening after Stop. Ticket 08 records this manual functional evidence and is closed. The automated photographic/MediaStream baseline above remains separate from that live-camera confirmation. This work does not claim 95%/200 ms audiovisual synchronization, physical speaker capture, 30 minutes/20 model turns, ASR/LLM/TTS integration or 5090 acceptance. The temporary 4090D deployment is an independent integration check, not a replacement for those conditions.
