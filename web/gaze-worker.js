// A classic worker permits the pinned Emscripten loader's importScripts call.
let detector;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const { FaceDetector, FilesetResolver } = await import('./vendor/mediapipe/0.10.21/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/0.10.21/wasm', self.location.href).href);
      detector = await FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL('./assets/vision/blaze_face_short_range.tflite', self.location.href).href, delegate: 'CPU' },
        runningMode: 'VIDEO', minDetectionConfidence: 0.5, canvas: new OffscreenCanvas(1, 1)
      });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'detect') {
      const start = performance.now();
      try {
        const result = detector.detectForVideo(data.bitmap, data.timestamp);
        const faces = result.detections.filter(face => face.boundingBox).sort((a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height);
        const box = faces[0]?.boundingBox;
        const face = box ? { center_x: (box.originX + box.width / 2) / data.bitmap.width, center_y: (box.originY + box.height / 2) / data.bitmap.height, confidence: faces[0].categories[0].score, box } : null;
        self.postMessage({ type: 'result', token: data.token, face, face_count: faces.length, inference_ms: performance.now() - start });
      } finally { data.bitmap.close(); }
    }
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
