const $ = selector => document.querySelector(selector);

// Only this controller owns the input device. The callback contributes gaze to
// the existing face mixer; it never applies a mouth/expression frame itself.
export function attachGazeControls(onChange) {
  const video = $('#face-video'), image = $('#face-image');
  let worker, ready, rejectReady, initTimer, timer, stream, sourceURL;
  let token = 0, active = false, pending = false, pendingAt = 0, lastCapture = 0, lastVideoTime = -1, lastProgress = 0;
  let current = { x: 0, y: 0 }, target = { x: 0, y: 0 }, lastTime = performance.now(), animation;
  let record = { runtime: '@mediapipe/tasks-vision@0.10.21', delegate: 'CPU', source: 'none', mirrored: false, face: null, gaze: current };
  const status = (text, failed = false) => { $('#gaze-status').textContent = text; $('#gaze-status').classList.toggle('error', failed); };
  const output = () => { $('#gaze-record').textContent = JSON.stringify({ ...record, gaze: current }, null, 2); };
  function animate(time) {
    const alpha = 1 - Math.exp(-Math.min(100, time - lastTime) / 120); lastTime = time;
    const next = { x: current.x + (target.x - current.x) * alpha, y: current.y + (target.y - current.y) * alpha };
    if (Math.abs(next.x - current.x) + Math.abs(next.y - current.y) > .00001) { current = next; onChange(current); output(); }
    animation = requestAnimationFrame(animate);
  }
  animation = requestAnimationFrame(animate);
  function stop(message = '已停止注视，注视回到中性。', immediate = false) {
    ++token; active = false; pending = false;
    clearTimeout(timer); clearTimeout(initTimer);
    worker?.terminate(); worker = null;
    rejectReady?.(new Error('输入已取消')); rejectReady = null; ready = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    video.pause(); video.srcObject = null; video.removeAttribute('src'); video.load(); video.hidden = true;
    image.hidden = true; image.removeAttribute('src');
    if (sourceURL) URL.revokeObjectURL(sourceURL); sourceURL = null;
    target = { x: 0, y: 0 };
    if (immediate) { current = { ...target }; onChange(current); }
    record = { ...record, source: 'none', mirrored: false, face: null, face_count: 0 };
    $('#gaze-stop').disabled = true; status(message); output();
  }
  function fail(message) { stop(message); $('#gaze-status').classList.add('error'); }
  function begin(message, source, mirrored = false) {
    stop(message); active = true; $('#gaze-stop').disabled = false;
    record = { ...record, source, mirrored }; output(); return token;
  }
  function initialize() {
    if (ready) return ready;
    status('加载本地 CPU 人脸检测模型中…');
    ready = new Promise((resolve, reject) => {
      rejectReady = reject;
      worker = new Worker(new URL('./gaze-worker.js', import.meta.url));
      const created = worker;
      initTimer = setTimeout(() => { if (worker === created) fail('人脸模型加载超时，请检查本地资源后重试。'); }, 15000);
      worker.onerror = event => { if (worker === created) fail(`人脸检测工作线程失败：${event.message || '不可用'}`); };
      worker.onmessage = ({ data }) => {
        if (created !== worker) return;
        if (data.type === 'ready') { clearTimeout(initTimer); rejectReady = null; resolve(); }
        else if (data.type === 'error') fail(`人脸检测失败：${data.message}`);
        else if (data.type === 'result' && data.token === token && active) {
          pending = false;
          record = { ...record, face: data.face, face_count: data.face_count, inference_ms: data.inference_ms };
          const bounded = value => Math.max(-1, Math.min(1, Math.abs(value) < .08 ? 0 : value));
          const x = data.face ? (data.face.center_x - .5) * 2 * (record.mirrored ? -1 : 1) : 0;
          target = data.face ? { x: bounded(x), y: bounded((.5 - data.face.center_y) * 2) } : { x: 0, y: 0 };
          status(data.face ? `检测到人脸 · CPU · ${data.inference_ms.toFixed(1)} 毫秒${data.face_count > 1 ? ' · 多人画面，仅跟随最大人脸' : ''}` : '未检测到人脸，注视回到中性。'); output();
        }
      };
      worker.postMessage({ type: 'init' });
    });
    return ready;
  }
  async function detect(source, mine) {
    pending = true; pendingAt = performance.now();
    const width = source.videoWidth || source.naturalWidth, height = source.videoHeight || source.naturalHeight;
    const scale = Math.min(1, 640 / Math.max(width, height));
    const bitmap = await createImageBitmap(source, { resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)) });
    if (mine !== token) { bitmap.close(); return; }
    worker.postMessage({ type: 'detect', token: mine, bitmap, timestamp: performance.now() }, [bitmap]);
  }
  function pump(mine) {
    if (mine !== token || !active) return;
    const now = performance.now();
    if (pending && now - pendingAt > 2000) { fail('人脸检测超时，已停止注视。'); return; }
    if (now - lastProgress > 1500) { fail('人脸视频画面已过期，已停止注视。'); return; }
    if (!pending && now - lastCapture >= 200 && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastCapture = lastProgress = now; lastVideoTime = video.currentTime;
      detect(video, mine).catch(error => { if (mine === token) fail(`人脸输入失败：${error.message}`); });
    }
    timer = setTimeout(() => pump(mine), 50);
  }
  async function startVideo(mine) {
    await video.play(); if (mine !== token) return;
    await initialize(); if (mine !== token) return;
    lastCapture = 0; lastVideoTime = -1; lastProgress = performance.now(); pump(mine);
  }
  $('#gaze-stop').addEventListener('click', () => stop());
  $('#camera-start').disabled = false;
  $('#camera-start').addEventListener('click', async () => {
    const mine = begin('请求摄像头权限中…', 'camera', true);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('摄像头需要 localhost 或 HTTPS 和受支持的浏览器');
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 } }, audio: false });
      if (mine !== token) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => { if (mine === token) fail('摄像头已断开，已停止注视。'); }));
      video.classList.add('camera'); video.hidden = false; video.srcObject = stream;
      await startVideo(mine);
    } catch (error) {
      if (mine !== token) return;
      const busy=error.name==='NotReadableError'||/device\s+in\s+use/i.test(error.message);
      fail(error.name === 'NotAllowedError' ? '摄像头权限被拒绝，请在浏览器设置中允许后重试。' : busy ? '摄像头暂不可读，可能被其他程序或浏览器标签页占用。请结束占用后点击“开启摄像头注视”重试；若仍失败，请检查设备或浏览器设置。' : `摄像头不可用：${error.message}`);
    }
  });
  video.addEventListener('ended', () => { if (active && !stream && video.ended) stop('固定视频已结束，注视回到中性。'); });
  video.addEventListener('error', () => { if (active && video.error) fail('人脸视频读取失败，请选择浏览器支持的视频。'); });
  $('#face-file').disabled = false;
  $('#face-file').addEventListener('change', async () => {
    const file = $('#face-file').files[0]; if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const mine = begin('读取本地人脸输入中…', `${isVideo ? '固定视频' : '固定图片'}：${file.name}`);
    try {
      await initialize(); if (mine !== token) return;
      sourceURL = URL.createObjectURL(file);
      if (isVideo) {
        video.classList.remove('camera'); video.hidden = false; video.src = sourceURL;
        await startVideo(mine); return;
      }
      image.src = sourceURL; await image.decode();
      if (mine !== token) return;
      image.hidden = false; await detect(image, mine);
    } catch (error) { if (mine === token) fail(`人脸输入失败：${error.message}`); }
  });
  window.addEventListener('pagehide', () => { stop(); cancelAnimationFrame(animation); });
  output(); return { stop };
}
