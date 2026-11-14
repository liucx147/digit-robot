const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { publicBrowser } = require('./browser-fixture.cjs');
const root = path.resolve(__dirname, '..');
let browser, baseURL, close;
before(async () => {
  ({browser,baseURL,close}=await publicBrowser(root));
  await fs.mkdir(path.join(root, '..', 'artifacts'), { recursive: true });
});
after(async () => {await close?.();});

async function readyPage() {
  const page = await browser.newPage({ viewport: { width: 1180, height: 1100 }, acceptDownloads: true });
  await page.goto(baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /三维头部已就绪/ }).waitFor();
  return page;
}
// Real NASA photograph, translated on a plain background. The detector receives pixels, never a supplied box.
async function photo(page, position) {
  const encoded = await page.evaluate(async position => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b9c2ca'; ctx.fillRect(0, 0, 640, 480);
    if (position !== 'empty') {
      const image = new Image(); image.src = './tests/fixtures/astronaut.png'; await image.decode();
      const positions = { left: [20, 120], right: [450, 120], up: [240, 5], down: [240, 265], center: [240, 135] };
      ctx.drawImage(image, 145, 35, 180, 210, ...positions[position], 170, 198);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, position);
  await page.getByLabel('选择固定人脸图片或视频', { exact: true }).setInputFiles({ name: `${position}.png`, mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
}
async function gaze(page) { return JSON.parse(await page.getByLabel('注视检测记录', { exact: true }).textContent()); }

test('real CPU face inference on fixed photographs visibly moves the actual eyes left and right with local resources only', async () => {
  const page = await readyPage();
  const detectorConsole = []; page.on('console', message => detectorConsole.push(message.text()));
  const remote = []; page.context().on('request', r => { if (!r.url().startsWith(baseURL) && !/^(blob:|data:)/.test(r.url())) remote.push(r.url()); });
  await page.context().route('**/*', route => { if (route.request().url().startsWith(baseURL) || /^(blob:|data:)/.test(route.request().url())) return route.continue(); return route.abort(); });
  await page.getByLabel('选择固定人脸图片或视频', { exact: true }).waitFor({ timeout: 3000 });
  await photo(page, 'left');
  await page.getByRole('status', { name: '注视状态' }).filter({ hasText: /检测到人脸/ }).waitFor();
  await page.waitForTimeout(500);
  const left = await gaze(page); const leftPixels = await page.getByLabel('三维数字人头部').screenshot();
  assert.equal(left.runtime, '@mediapipe/tasks-vision@0.10.21'); assert.equal(left.delegate, 'CPU');
  assert.ok(left.face.center_x < .3); assert.ok(left.gaze.x < -.3); assert.ok(left.inference_ms > 0);
  await photo(page, 'right');
  await page.waitForFunction(() => JSON.parse(document.querySelector('#gaze-record').textContent).gaze.x > .3);
  const right = await gaze(page); const rightPixels = await page.getByLabel('三维数字人头部').screenshot();
  assert.ok(right.face.center_x > .7); assert.notDeepEqual(leftPixels, rightPixels, 'actual skinned eye pixels change');
  await fs.writeFile(path.join(root, '..', 'artifacts', 'ticket-08-left.png'), leftPixels);
  await fs.writeFile(path.join(root, '..', 'artifacts', 'ticket-08-right.png'), rightPixels);
  await fs.writeFile(path.join(root, '..', 'artifacts', 'ticket-08-detection.json'), JSON.stringify({ browser: browser.version(), detectorConsole, left, right }, null, 2));
  assert.deepEqual(remote, []); await page.close();
});

test('fixed up/down faces and empty input have explicit visible behavior, and Stop releases gaze while preserving audio', async () => {
  const page = await readyPage();
  await photo(page, 'up');
  await page.waitForFunction(() => (JSON.parse(document.querySelector('#gaze-record').textContent).gaze?.y || 0) > .3);
  const up = await page.getByLabel('三维数字人头部').screenshot();
  await photo(page, 'down');
  await page.waitForFunction(() => JSON.parse(document.querySelector('#gaze-record').textContent).gaze.y < -.3);
  const down = await page.getByLabel('三维数字人头部').screenshot();
  assert.notDeepEqual(up, down);
  await fs.writeFile(path.join(root, '..', 'artifacts', 'ticket-08-up.png'), up);
  await fs.writeFile(path.join(root, '..', 'artifacts', 'ticket-08-down.png'), down);
  await photo(page, 'empty');
  await page.getByRole('status', { name: '注视状态' }).filter({ hasText: /未检测到人脸/ }).waitFor();
  await page.waitForFunction(() => { const g = JSON.parse(document.querySelector('#gaze-record').textContent).gaze; return Math.abs(g.x) < .02 && Math.abs(g.y) < .02; });
  await photo(page, 'left');
  await page.waitForFunction(() => JSON.parse(document.querySelector('#gaze-record').textContent).gaze.x < -.3);
  assert.equal(await page.getByRole('button', { name: '停止注视', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '停止注视', exact: true }).click();
  await page.getByRole('status', { name: '注视状态' }).filter({ hasText: /已停止注视/ }).waitFor();
  await page.waitForFunction(() => { const g = JSON.parse(document.querySelector('#gaze-record').textContent).gaze; return Math.abs(g.x) < .02 && Math.abs(g.y) < .02; });
  assert.equal((await gaze(page)).face, null);
  await page.close();
});

// The camera is an external device seam: return a real pixel MediaStream made
// from the real photograph. Inference, worker, renderer and mixer remain real.
async function cameraFixture(page, mode = 'face') {
  await page.addInitScript(mode => {
    let attempts=0;
    navigator.mediaDevices.getUserMedia = async constraints => {
      if((mode==='busy'||mode==='device-in-use')&&attempts++===0)throw new DOMException(mode==='busy'?'Could not start video source':'DEVICE IN USE',mode==='busy'?'NotReadableError':'Error');
      if (mode === 'denied') throw new DOMException('test permission refusal', 'NotAllowedError');
      if (constraints.audio !== false) throw Error('camera must not request microphone');
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b9c2ca'; ctx.fillRect(0, 0, 640, 480);
      const image = new Image(); image.src = '/tests/fixtures/astronaut.png'; await image.decode();
      ctx.drawImage(image, 145, 35, 180, 210, 20, 120, 170, 198);
      const stream = canvas.captureStream(10);
      setInterval(() => ctx.drawImage(image, 145, 35, 180, 210, 20, 120, 170, 198), 100);
      if (mode === 'late') await new Promise(resolve => setTimeout(resolve, 900));
      return stream;
    };
  }, mode);
}
test('camera permission denial is explained and remains neutral without affecting audio controls', async () => {
  const page = await browser.newPage(); await cameraFixture(page, 'denied'); await page.goto(baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /三维头部已就绪/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: '开启摄像头注视', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '开启摄像头注视', exact: true }).click();
  await page.getByRole('status', { name: '注视状态' }).filter({ hasText: /权限被拒绝/ }).waitFor();
  assert.equal((await gaze(page)).face, null);
  assert.deepEqual((await gaze(page)).gaze, { x: 0, y: 0 });
  assert.equal(await page.getByRole('button', { name: '载入中文录音示例', exact: true }).isEnabled(), true);
  await page.close();
});

function speakingFixture() {
  const rate = 16000, length = rate * 7, wav = Buffer.alloc(44 + length * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) { const t = i / rate; wav.writeInt16LE(t < 1 || t > 3.5 ? Math.round(9000 * Math.sin(2 * Math.PI * 220 * t)) : 0, 44 + i * 2); }
  return wav;
}
test('camera pixels drive mirrored gaze through the shared mixer while real audio keeps its mouth/pause/expression, and both Stops release input', async () => {
  const page = await browser.newPage({ viewport: { width: 1180, height: 1100 }, acceptDownloads: true });
  await cameraFixture(page); await page.goto(baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /三维头部已就绪/ }).waitFor();
  await page.getByRole('button', { name: '开启摄像头注视', exact: true }).click();
  await page.getByRole('status', { name: '注视状态' }).filter({ hasText: /检测到人脸/ }).waitFor({ timeout: 20000 });
  await page.waitForFunction(() => JSON.parse(document.querySelector('#gaze-record').textContent).gaze.x > .3);
  assert.equal((await gaze(page)).source, 'camera'); assert.equal((await gaze(page)).mirrored, true);
  await page.getByLabel('选择本地音频', { exact: true }).setInputFiles({ name: 'gaze-speaking.wav', mimeType: 'audio/wav', buffer: speakingFixture() });
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /音频已就绪/ }).waitFor();
  await page.getByLabel('微笑强度').fill('0.5');
  await page.getByRole('button', { name: '播放音频', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime >= .3);
  const speaking = await page.getByLabel('三维数字人头部').screenshot();
  let frame = JSON.parse(await page.locator('#frame').textContent());
  assert.ok(frame.weights.jawOpen > .4); assert.ok(Object.values(frame.weights).every(weight => weight >= 0 && weight <= 1)); assert.ok(frame.weights.gazeRight > .3);
  await page.waitForFunction(() => document.querySelector('audio').currentTime >= 1.15);
  const pause = await page.getByLabel('三维数字人头部').screenshot();
  frame = JSON.parse(await page.locator('#frame').textContent()); assert.equal(frame.weights.jawOpen, 0); assert.equal(frame.weights.smile, .5); assert.ok(frame.weights.gazeRight > .3);
  assert.notDeepEqual(speaking, pause);
  await page.getByRole('button', { name: '停止注视', exact: true }).click();
  assert.equal(await page.locator('audio').evaluate(a => a.paused), false, 'gaze stop preserves audio playback');
  assert.equal(await page.locator('#face-video').evaluate(v => v.srcObject), null);
  await page.getByRole('button', { name: '开启摄像头注视', exact: true }).click();
  await page.getByRole('status', { name: '注视状态' }).filter({ hasText: /检测到人脸/ }).waitFor({ timeout: 20000 });
  // Audio may have ended while the CPU model warms; replay before global Stop.
  if (await page.locator('audio').evaluate(a => a.paused)) await page.getByRole('button', { name: '播放音频', exact: true }).click();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  assert.equal(await page.locator('audio').evaluate(a => a.paused), true);
  assert.equal(await page.locator('#face-video').evaluate(v => v.srcObject), null);
  await fs.writeFile(path.join(root, '..', 'artifacts', 'ticket-08-speaking.png'), speaking);
  await fs.writeFile(path.join(root, '..', 'artifacts', 'ticket-08-pause.png'), pause);
  await page.close();
});

async function fixedVideo(page) {
  return Buffer.from(await page.evaluate(async () => {
    const image = new Image(); image.src = '/tests/fixtures/astronaut.png'; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d'); const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }); const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const done = new Promise(resolve => { recorder.onstop = resolve; });
    const start = performance.now();
    const timer = setInterval(() => {
      ctx.fillStyle = '#b9c2ca'; ctx.fillRect(0, 0, 640, 480);
      ctx.drawImage(image, 145, 35, 180, 210, performance.now() - start < 1800 ? 20 : 450, 120, 170, 198);
    }, 80);
    recorder.start(); await new Promise(resolve => setTimeout(resolve, 3800)); recorder.stop(); await done;
    clearInterval(timer); stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  }));
}
test('a fixed local video of real face pixels follows both sides then returns neutral on completion', async () => {
  const page = await readyPage(); const video = await fixedVideo(page);
  await page.getByLabel('选择固定人脸图片或视频', { exact: true }).setInputFiles({ name: 'translated-face-fixture.webm', mimeType: 'video/webm', buffer: video });
  await page.waitForFunction(() => (JSON.parse(document.querySelector('#gaze-record').textContent).gaze?.x || 0) < -.3, null, { timeout: 6000 });
  await page.waitForFunction(() => JSON.parse(document.querySelector('#gaze-record').textContent).gaze.x > .3, null, { timeout: 6000 });
  assert.match((await gaze(page)).source, /固定视频/);
  await page.getByRole('status', { name: '注视状态' }).filter({ hasText: /视频已结束/ }).waitFor();
  await page.waitForFunction(() => { const g = JSON.parse(document.querySelector('#gaze-record').textContent).gaze; return Math.abs(g.x) < .02 && Math.abs(g.y) < .02; });
  await fs.writeFile(path.join(root, '..', 'artifacts', 'ticket-08-fixed-face.webm'), video); await page.close();
});

test('a local model load failure is visible, closes input, and can be retried from the same page', async () => {
  const page = await readyPage();
  const pattern = '**/assets/vision/blaze_face_short_range.tflite';
  await page.context().route(pattern, route => route.fulfill({ status: 404, body: 'fixture missing model' }));
  await photo(page, 'left');
  await page.getByRole('status', { name: '注视状态' }).filter({ hasText: /人脸检测失败/ }).waitFor({ timeout: 8000 });
  assert.equal((await gaze(page)).face, null); assert.equal(await page.getByRole('button', { name: '停止注视', exact: true }).isDisabled(), true);
  await page.context().unroute(pattern);
  await photo(page, 'right');
  await page.waitForFunction(() => (JSON.parse(document.querySelector('#gaze-record').textContent).gaze?.x || 0) > .3);
  await page.close();
});
test('Stop cancels a late camera grant and prevents old input from restoring gaze', async () => {
  const page = await browser.newPage(); await cameraFixture(page, 'late'); await page.goto(baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /三维头部已就绪/ }).waitFor();
  await page.getByRole('button', { name: '开启摄像头注视', exact: true }).click();
  await page.getByRole('button', { name: '停止注视', exact: true }).click();
  await page.waitForTimeout(1500);
  assert.equal((await gaze(page)).source, 'none'); assert.equal((await gaze(page)).face, null);
  assert.equal(await page.locator('#face-video').evaluate(v => v.srcObject), null);
  assert.match(await page.getByRole('status', { name: '注视状态' }).textContent(), /已停止注视/);
  await page.close();
});


test('a busy camera explains competing use and can be retried after the device becomes available', {timeout:40000}, async()=>{
  for(const mode of ['busy','device-in-use']) {
    const page=await browser.newPage();
    try {
      await cameraFixture(page,mode);await page.goto(baseURL);
      await page.getByRole('status',{name:'播放状态'}).filter({hasText:/三维头部已就绪/}).waitFor();
      const start=page.getByRole('button',{name:'开启摄像头注视',exact:true});
      await start.click();
      await page.getByRole('status',{name:'注视状态'}).filter({hasText:/其他程序或浏览器标签页占用/}).waitFor({timeout:3000});
      assert.equal(await start.isEnabled(),true);
      assert.equal((await gaze(page)).face,null);
      assert.equal(await page.locator('#face-video').evaluate(video=>video.srcObject),null);
      assert.equal(await page.getByRole('button',{name:'载入中文录音示例',exact:true}).isEnabled(),true);
      await start.click();
      await page.getByRole('status',{name:'注视状态'}).filter({hasText:/检测到人脸/}).waitFor({timeout:20000});
      await page.getByRole('button',{name:'停止注视',exact:true}).click();
      assert.equal(await page.locator('#face-video').evaluate(video=>video.srcObject),null);
    }finally{await page.close();}
  }
});
