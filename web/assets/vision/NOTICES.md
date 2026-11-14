# Face detection runtime, model and fixture provenance

Recorded 2026-11-14. Original staged bytes, exact URLs, sizes and SHA-256 hashes are in [manifest.json](manifest.json). The runtime's version and its model's version are separate pins. No runtime download is needed.

## MediaPipe Tasks Vision 0.10.21

- Package: `@mediapipe/tasks-vision@0.10.21`; [official registry metadata](https://registry.npmjs.org/@mediapipe%2Ftasks-vision/0.10.21), published 2025-02-06. The package declares Apache-2.0. It is a deliberate version pin, not a claim that it is the latest release.
- Copyright: The MediaPipe Authors; upstream code copyright notices are retained in the unmodified distributed sources. Original [upstream Apache-2.0 license at v0.10.21](https://github.com/google-ai-edge/mediapipe/blob/v0.10.21/LICENSE) is bundled as [LICENSE](../../vendor/mediapipe/0.10.21/LICENSE), including its additional UTF utility notice.
- Bundled files: `vision_bundle.mjs`, and SIMD/non-SIMD `vision_wasm_*internal.js` / `.wasm` pairs. They are copied without editing from the pinned published package. Together they are 19,568,826 bytes. The package inventory has no separate NOTICE file. The published binary package does not provide an exhaustive compiled dependency bill of materials; this record preserves its declared license and original source notices, rather than claiming such an audit was performed.
- [Pinned upstream task README](https://github.com/google-ai-edge/mediapipe/blob/v0.10.21/mediapipe/tasks/web/vision/README.md), [Face Detector task documentation](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector/web_js).
- Apache-2.0 permits commercial use and redistribution under its conditions, including retaining the license and required notices. Keep these files and notices together when redistributing this frontend. This application invokes detection locally without adding analytics or remote model APIs.

## BlazeFace short-range model, float16 v1

- Source: Google MediaPipe model distribution, fixed path `face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`.
- Model file: `blaze_face_short_range.tflite`, 229,746 bytes; SHA-256 `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`.
- The original Google [short-range model card](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf), retained as [MODEL_CARD.pdf](MODEL_CARD.pdf), explicitly lists Apache License 2.0. The Apache-2.0 text is bundled with the runtime above. Copyright: Google / MediaPipe authors as identified by the distribution.
- The short-range detector is designed for prominent nearby faces; it is not an identity, facial-emotion, eye-gaze or full-scene model. Do not turn a detected rectangle or confidence into one of those claims.

## Test photograph

- File: `web/tests/fixtures/astronaut.png`, 791,555 bytes, SHA-256 `88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5`.
- NASA photograph of astronaut Eileen Collins, obtained from the pinned [scikit-image v0.25.2 data file](https://github.com/scikit-image/scikit-image/blob/v0.25.2/skimage/data/astronaut.png). The original bytes are unchanged; browser tests crop and translate it when making explicitly identified diagnostic inputs.
- The [scikit-image dataset documentation](https://scikit-image.org/docs/0.25.x/api/skimage.data.html#skimage.data.astronaut) identifies NASA Great Images as the source and states no known copyright restrictions / public domain. [Original NASA collection entry](https://flic.kr/p/r9qvLn), [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).
- This is a test fixture only, with no NASA endorsement or advertising use implied. NASA's guidelines distinguish public use of imagery from endorsement, logos and identifiable-person commercial publicity rights; retain that distinction for uses outside these software tests.
