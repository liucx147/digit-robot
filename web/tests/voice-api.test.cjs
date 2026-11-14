const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { publicBrowser } = require('./browser-fixture.cjs');
let app, wav;
before(async () => {
  app = await publicBrowser(path.resolve(__dirname, '..'));
  wav = await fs.readFile(path.resolve(__dirname, '../assets/nihao-cc0.wav'));
});
after(async () => { await app?.close(); });

async function setup(page, turn) {
  await page.route('**/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/audio') && route.request().method() === 'GET')
      return route.fulfill({ contentType: 'audio/wav', body: wav });
    let body = { session_id: 'test-session', session_epoch: 0, state: 'idle' };
    if (/\/(text|audio)$/.test(url.pathname)) {
      body = await turn(route.request());
      if (body === null) return route.abort();
    } else if (/\/(stop|reset)$/.test(url.pathname)) body.session_epoch = 1;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(app.baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: '三维头部已就绪' }).waitFor();
  await page.getByRole('button', { name: '连接语音服务', exact: true }).click();
  await page.getByRole('status', { name: '语音服务状态' }).filter({ hasText: '已连接' }).waitFor();
}

const result = () => ({ type: 'response', state: 'ready', status: 'ok', session_id: 'test-session',
  session_epoch: 0, utterance_id: 'api-utterance-1', transcript: '今天真开心', user_emotion: 'happiness',
  reply: '听到这个消息，我也为你高兴。', expression_intent: { style: 'cheerful', intensity: 0.65 },
  audio: { url: '/v1/sessions/test-session/turns/api-utterance-1/audio', mime_type: 'audio/wav' } });

function deferred() { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; }

test('the public page sends text, plays actual WAV and exports API identifiers with visible intent', async () => {
  const page = await app.browser.newPage({ acceptDownloads: true });
  let sent;
  await setup(page, async request => { sent = request.postDataJSON(); return result(); });
  await page.getByLabel('对话文本', { exact: true }).fill('今天真开心');
  await page.getByRole('button', { name: '发送文本', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('audio').paused && Number(document.querySelector('#mouth-weight').textContent) > 0);
  assert.equal(sent.text, '今天真开心');
  assert.equal(sent.session_epoch, 0);
  assert.match(await page.locator('#voice-reply').textContent(), /为你高兴/);
  assert.match(await page.locator('#voice-intent').textContent(), /cheerful/);
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByText('播放记录', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载播放记录', exact: true }).click();
  const record = JSON.parse(await fs.readFile(await (await download).path(), 'utf8'));
  assert(record.frames.some(frame => frame.utterance_id === 'api-utterance-1' && frame.session_epoch === 0 && frame.weights.jawOpen > 0));
  assert.equal(record.session_id, 'test-session');
  await page.close();
});

test('uploading WAV uses the audio endpoint and shows the returned transcript', async () => {
  const page = await app.browser.newPage();
  let mediaType, epoch, bytes;
  await setup(page, async request => {
    mediaType = request.headers()['content-type']; epoch = request.headers()['x-session-epoch'];
    bytes = request.postDataBuffer(); return result();
  });
  await page.locator('#voice-wav').setInputFiles(path.resolve(__dirname, '../assets/nihao-cc0.wav'));
  await page.locator('#voice-transcript').filter({ hasText: '今天真开心' }).waitFor();
  assert.equal(mediaType, 'audio/wav'); assert.equal(epoch, '0'); assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  await page.close();
});

test('Stop fences a late model result and does not download or play it', async () => {
  const page = await app.browser.newPage();
  const gate = deferred(), entered = deferred();
  let downloads = 0;
  await setup(page, async () => { entered.resolve(); await gate.promise; return result(); });
  await page.route('**/v1/sessions/test-session/turns/**/audio', route => { downloads++; return route.fulfill({ contentType: 'audio/wav', body: wav }); });
  await page.locator('#voice-text').fill('等一下'); await page.locator('#voice-send').click();
  await entered.promise;
  await page.getByRole('button', { name: '停止', exact: true }).click();
  gate.resolve();
  await page.getByRole('status', { name: '语音服务状态' }).filter({ hasText: '旧回复和音频已失效' }).waitFor();
  await page.waitForTimeout(150);
  assert.equal(downloads, 0);
  assert.equal(await page.locator('audio').evaluate(a => a.paused && !a.getAttribute('src')), true);
  assert.equal(await page.locator('#play').isDisabled(), true);
  await page.close();
});

test('a late audio download cannot replace a newer local file after Stop', async () => {
  const page = await app.browser.newPage();
  const gate = deferred(), entered = deferred();
  await setup(page, async () => result());
  await page.route('**/v1/sessions/test-session/turns/**/audio', async route => { entered.resolve(); await gate.promise; await route.fulfill({ contentType: 'audio/wav', body: wav }); });
  await page.locator('#voice-text').fill('晚到音频'); await page.locator('#voice-send').click();
  await entered.promise;
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.locator('#audio-file').setInputFiles(path.resolve(__dirname, '../assets/nihao-cc0.wav'));
  await page.getByRole('button', { name: '播放音频', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#play').disabled);
  const source = await page.locator('audio').evaluate(a => a.src);
  gate.resolve(); await page.waitForTimeout(200);
  assert.equal(await page.locator('audio').evaluate(a => a.src), source);
  assert.match(await page.locator('#audio-name').textContent(), /nihao-cc0/);
  await page.close();
});

test('an API error and corrupt returned audio stay visible instead of fake success', async () => {
  const page = await app.browser.newPage();
  await setup(page, async () => result());
  await page.route('**/v1/sessions/test-session/turns/**/audio', route => route.fulfill({ contentType: 'audio/wav', body: Buffer.from('bad audio') }));
  await page.locator('#voice-text').fill('错误音频'); await page.locator('#voice-send').click();
  await page.getByRole('status', { name: '语音服务状态' }).filter({ hasText: '本轮失败' }).waitFor();
  assert.equal(await page.locator('#play').isDisabled(), true);
  await page.route('**/v1/sessions/test-session/text', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 'dialogue_failed', message: '模型阶段失败' }) }));
  await page.locator('#voice-send').click();
  await page.getByRole('status', { name: '语音服务状态' }).filter({ hasText: '模型阶段失败' }).waitFor();
  assert.equal(await page.locator('audio').evaluate(a => a.paused), true);
  await page.close();
});

test('microphone permission denial is visible without uploading fake audio', async () => {
  const page = await app.browser.newPage();
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('permission denied', 'NotAllowedError'); }; });
  let requests = 0;
  await setup(page, async () => { requests++; return result(); });
  await page.locator('#voice-record').click();
  await page.getByRole('status', { name: '语音服务状态' }).filter({ hasText: '录音失败' }).waitFor();
  assert.equal(requests, 0);
  assert.equal(await page.locator('#voice-record').isDisabled(), false);
  await page.close();
});

test('new turns wait for Stop acknowledgement and reset clears old results', async () => {
  const page = await app.browser.newPage();
  const gate = deferred(), entered = deferred();
  await setup(page, async () => result());
  await page.locator('#voice-text').fill('完成一轮'); await page.locator('#voice-send').click();
  await page.locator('#voice-reply').filter({ hasText: '为你高兴' }).waitFor();
  await page.route('**/v1/sessions/test-session/stop', async route => {
    entered.resolve(); await gate.promise;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session_id: 'test-session', session_epoch: 1 }) });
  });
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await entered.promise;
  try { assert.equal(await page.locator('#voice-send').isDisabled(), true); }
  finally { gate.resolve(); }
  await page.getByRole('status', { name: '语音服务状态' }).filter({ hasText: '旧回复和音频已失效' }).waitFor();
  await page.locator('#voice-reset').click();
  await page.getByRole('status', { name: '语音服务状态' }).filter({ hasText: '对话已重置' }).waitFor();
  assert.equal(await page.locator('#voice-reply').textContent(), '—');
  assert.equal(await page.locator('#play').isDisabled(), true);
  await page.close();
});

test('reconnecting while an old turn is pending cannot publish old audio', async () => {
  const page = await app.browser.newPage();
  const gate = deferred(), entered = deferred();
  await setup(page, async () => { entered.resolve(); await gate.promise; return result(); });
  await page.locator('#voice-text').fill('旧会话'); await page.locator('#voice-send').click();
  await entered.promise;
  await page.locator('#voice-connect').click();
  await page.getByRole('status', { name: '语音服务状态' }).filter({ hasText: '已连接' }).waitFor();
  gate.resolve(); await page.waitForTimeout(200);
  assert.equal(await page.locator('#voice-reply').textContent(), '—');
  assert.equal(await page.locator('audio').evaluate(a => a.paused && !a.getAttribute('src')), true);
  await page.close();
});

async function microphoneBrowser() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  return chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
}

test('a browser synthetic microphone is encoded as nonempty PCM WAV and submitted through the public UI', async () => {
  const browser = await microphoneBrowser();
  try {
    const page = await browser.newPage();
    let bytes;
    await setup(page, async request => { bytes = request.postDataBuffer(); return result(); });
    await page.locator('#voice-record').click();
    await page.getByRole('status', { name: '语音服务状态' }).filter({ hasText: '正在录音' }).waitFor();
    await page.waitForTimeout(800);
    await page.locator('#voice-record-end').click();
    await page.locator('#voice-transcript').filter({ hasText: '今天真开心' }).waitFor();
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.readUInt16LE(20), 1); assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 16000); assert.equal(bytes.readUInt16LE(34), 16);
    assert(bytes.length > 44 && bytes.subarray(44).some(value => value !== 0));
  } finally { await browser.close(); }
});

test('Stop during microphone permission wait releases the late device without sending a turn', async () => {
  const browser = await microphoneBrowser();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = constraints => new Promise(resolve => {
        window.grantLateMicrophone = async () => {
          window.lateMicrophoneStream = await getUserMedia(constraints);
          resolve(window.lateMicrophoneStream);
        };
      });
    });
    let requests = 0;
    await setup(page, async () => { requests++; return result(); });
    await page.locator('#voice-record').click();
    await page.waitForFunction(() => typeof window.grantLateMicrophone === 'function');
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.evaluate(() => window.grantLateMicrophone());
    await page.waitForFunction(() => window.lateMicrophoneStream?.getTracks().every(track => track.readyState === 'ended'));
    assert.equal(requests, 0);
    assert.match(await page.locator('#voice-status').textContent(), /已停止/);
  } finally { await browser.close(); }
});
