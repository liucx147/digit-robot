const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { publicBrowser } = require('./browser-fixture.cjs');
const webRoot = path.resolve(__dirname, '..');
let browser, baseURL, close;
before(async () => {
  ({browser,baseURL,close}=await publicBrowser(webRoot));
});
after(async () => {await close?.();});

test('a missing avatar resource is explained on the public page and playback stays unavailable', async () => {
  const page = await browser.newPage();
  await page.route('**/assets/avatar-manifest.json', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto(baseURL);
  await page.getByRole('heading', { name: '本地三维说话头' }).waitFor();
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /资源加载失败/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: '播放音频', exact: true }).isDisabled(), true);
  await page.close();
});

test('the offline page loads its licensed 3D avatar into a visible WebGL canvas', async () => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const remoteRequests = [];
  page.on('request', request => { if (!request.url().startsWith(baseURL) && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) remoteRequests.push(request.url()); });
  await page.goto(baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /三维头部已就绪/ }).waitFor();
  const pixels = await page.getByLabel('三维数字人头部').screenshot();
  assert.ok(pixels.length > 20000, 'rendered avatar has visible detail beyond the flat background');
  assert.deepEqual(remoteRequests, [], 'no CDN or cloud resource request');
  await fs.mkdir(path.join(webRoot, '..', 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(webRoot, '..', 'artifacts', 'ticket-01-head.png'), pixels);
  await page.close();
});

function cadenceFixture() {
  const rate = 16000, length = rate * 2.3, wav = Buffer.alloc(44 + length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) { const t = i / rate; wav.writeInt16LE((t < .6 || (t >= 1.4 && t < 2)) ? Math.round(9000 * Math.sin(2 * Math.PI * 220 * t)) : 0, 44 + i * 2); }
  return wav;
}

test('local audio actually plays, changes the visible mouth around a fixed pause, closes at end, and exports linked frames', async () => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, acceptDownloads: true });
  await page.goto(baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /三维头部已就绪/ }).waitFor();
  await page.getByLabel('选择本地音频', { exact: true }).setInputFiles({ name: 'cadence-fixture.wav', mimeType: 'audio/wav', buffer: cadenceFixture() });
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /音频已就绪/ }).waitFor();
  await page.getByRole('button', { name: '播放音频', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime >= .2);
  assert.equal(await page.locator('audio').evaluate(audio => audio.paused), false, 'real HTML audio is playing');
  const openMouth = await page.getByLabel('三维数字人头部').screenshot();
  await page.waitForFunction(() => document.querySelector('audio').currentTime >= .85);
  const silentMouth = await page.getByLabel('三维数字人头部').screenshot();
  await fs.mkdir(path.join(webRoot, '..', 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(webRoot, '..', 'artifacts', 'ticket-01-mouth-open.png'), openMouth);
  await fs.writeFile(path.join(webRoot, '..', 'artifacts', 'ticket-01-mouth-silent.png'), silentMouth);
  assert.notDeepEqual(openMouth, silentMouth, 'actual rendered pixels change between speech and silence');
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /播放完成/ }).waitFor();
  assert.equal(await page.getByLabel('嘴部开合').textContent(), '0.00');
  await page.getByText('播放记录', { exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载播放记录' }).click();
  const download = await downloadEvent;
  const record = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  await fs.writeFile(path.join(webRoot, '..', 'artifacts', 'ticket-01-playback.json'), JSON.stringify(record, null, 2));
  assert.ok(record.frames.length > 20);
  assert.equal(new Set(record.frames.map(frame => frame.utterance_id)).size, 1);
  assert.ok(record.frames.every((frame, index) => index === 0 || frame.frame_id > record.frames[index - 1].frame_id));
  for (const frame of record.frames) {
    assert.equal(typeof frame.utterance_id, 'string');
    assert.equal(frame.session_epoch, 0);
    assert.ok(Number.isInteger(frame.frame_id));
    assert.ok(frame.audio_time_ms >= 0);
    assert.ok(Object.values(frame.weights).every(weight => weight >= 0 && weight <= 1));
  }
  assert.ok(record.frames.some(frame => frame.audio_time_ms > 200 && frame.audio_time_ms < 500 && frame.weights.jawOpen > .4));
  assert.ok(record.frames.filter(frame => frame.audio_time_ms > 800 && frame.audio_time_ms < 1200).every(frame => frame.weights.jawOpen === 0));
  assert.equal(record.frames.at(-1).weights.jawOpen, 0);
  await page.close();
});



test('the Stop button pauses real audio and invalidates the current animation epoch within 500 ms', async () => {
  const page = await browser.newPage();
  await page.goto(baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /三维头部已就绪/ }).waitFor();
  await page.getByLabel('选择本地音频', { exact: true }).setInputFiles({ name: 'cadence-fixture.wav', mimeType: 'audio/wav', buffer: cadenceFixture() });
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /音频已就绪/ }).waitFor();
  await page.getByRole('button', { name: '播放音频', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime >= .2);
  const start = Date.now();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').paused && document.querySelector('#mouth-weight').textContent === '0.00', null, { timeout: 500 });
  assert.ok(Date.now() - start < 500, 'audio and visible face stop within the specified limit');
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /已停止/ }).waitFor();
  await page.getByText('播放记录', { exact: true }).click();
  const frame = JSON.parse(await page.locator('#frame').textContent());
  assert.equal(frame.session_epoch, 1);
  const stoppedTime = await page.locator('audio').evaluate(audio => audio.currentTime);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('audio').evaluate(audio => audio.currentTime), stoppedTime);
  assert.equal(await page.getByLabel('嘴部开合').textContent(), '0.00');
  await page.close();
});


test('audible opposite-polarity stereo still opens the mouth rather than cancelling the envelope', async () => {
  const mono = cadenceFixture(), stereo = Buffer.alloc(44 + (mono.length - 44) * 2);
  mono.copy(stereo, 0, 0, 44);
  stereo.writeUInt32LE(stereo.length - 8, 4); stereo.writeUInt16LE(2, 22); stereo.writeUInt32LE(64000, 28); stereo.writeUInt16LE(4, 32); stereo.writeUInt32LE(stereo.length - 44, 40);
  for (let i = 44; i < mono.length; i += 2) { const sample = mono.readInt16LE(i), offset = 44 + (i - 44) * 2; stereo.writeInt16LE(sample, offset); stereo.writeInt16LE(-sample, offset + 2); }
  const page = await browser.newPage();
  await page.goto(baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /三维头部已就绪/ }).waitFor();
  await page.getByLabel('选择本地音频', { exact: true }).setInputFiles({ name: 'stereo-fixture.wav', mimeType: 'audio/wav', buffer: stereo });
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /音频已就绪/ }).waitFor();
  await page.getByRole('button', { name: '播放音频', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime >= .2);
  assert.ok(Number(await page.getByLabel('嘴部开合').textContent()) > .4);
  await page.close();
});

test('corrupt avatar bytes produce a visible resource failure without enabling playback', async () => {
  const page = await browser.newPage();
  await page.route('**/assets/avatar.vrm', route => route.fulfill({ status: 200, body: 'not a valid glTF asset' }));
  await page.goto(baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /资源加载失败/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: '播放音频', exact: true }).isDisabled(), true);
  await page.close();
});

test('invalid audio is explained and the bundled Mandarin recording can recover and play to completion', async () => {
  const page = await browser.newPage();
  await page.goto(baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /三维头部已就绪/ }).waitFor();
  await page.getByLabel('选择本地音频', { exact: true }).setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio') });
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /音频加载失败/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: '播放音频', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '载入中文录音示例' }).click();
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /音频已就绪/ }).waitFor();
  await page.getByRole('button', { name: '播放音频', exact: true }).click();
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /播放完成/ }).waitFor();
  assert.equal(await page.getByLabel('嘴部开合').textContent(), '0.00');
  assert.ok(await page.locator('audio').evaluate(audio => audio.duration > 1 && audio.ended));
  await page.close();
});

test('Stop is available while the real audio device play acknowledgement is pending and late acknowledgement cannot resume it', async () => {
  const page = await browser.newPage();
  // Delay only the browser media-device acknowledgement, while still invoking real audio playback.
  await page.addInitScript(() => {
    const realPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { return realPlay.call(this).then(() => new Promise(resolve => setTimeout(resolve, 800))); };
  });
  await page.goto(baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /三维头部已就绪/ }).waitFor();
  await page.getByLabel('选择本地音频', { exact: true }).setInputFiles({ name: 'pending-device.wav', mimeType: 'audio/wav', buffer: cadenceFixture() });
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /音频已就绪/ }).waitFor();
  await page.getByRole('button', { name: '播放音频', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '停止', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('audio').evaluate(audio => audio.paused), true);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /已停止/ }).waitFor();
  assert.equal(await page.getByLabel('嘴部开合').textContent(), '0.00');
  await page.close();
});

for (const responseStatus of [200, 404]) {
  test(`a late sample HTTP ${responseStatus} cannot replace or fail a newer local audio selection`, async () => {
    const page = await browser.newPage();
    let release, requested;
    const gate = new Promise(resolve => { release = resolve; });
    const requestStarted = new Promise(resolve => { requested = resolve; });
    await page.route('**/assets/nihao-cc0.wav', async route => {
      requested();
      await gate;
      if (responseStatus === 200) await route.continue();
      else await route.fulfill({ status: 404, body: 'missing' });
    });
    await page.goto(baseURL);
    await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /三维头部已就绪/ }).waitFor();
    await page.getByRole('button', { name: '载入中文录音示例' }).click();
    await requestStarted;
    await page.getByLabel('选择本地音频', { exact: true }).setInputFiles({ name: 'newer-selection.wav', mimeType: 'audio/wav', buffer: cadenceFixture() });
    await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /音频已就绪/ }).waitFor();
    const received = page.waitForResponse('**/assets/nihao-cc0.wav');
    release();
    await received;
    await page.waitForTimeout(100);
    assert.match(await page.locator('#audio-name').textContent(), /newer-selection.wav/);
    assert.match(await page.getByRole('status', { name: '播放状态' }).textContent(), /音频已就绪/);
    await page.close();
  });
}

test('a late acknowledgement from a stopped utterance does not pause a newer playback', async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const realPlay = HTMLMediaElement.prototype.play;
    let first = true;
    HTMLMediaElement.prototype.play = function () {
      const result = realPlay.call(this);
      if (!first) return result;
      first = false;
      return result.then(() => new Promise(resolve => setTimeout(resolve, 1000)));
    };
  });
  await page.goto(baseURL);
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /三维头部已就绪/ }).waitFor();
  await page.getByLabel('选择本地音频', { exact: true }).setInputFiles({ name: 'replay.wav', mimeType: 'audio/wav', buffer: cadenceFixture() });
  await page.getByRole('status', { name: '播放状态' }).filter({ hasText: /音频已就绪/ }).waitFor();
  await page.getByRole('button', { name: '播放音频', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime >= .1);
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByRole('button', { name: '播放音频', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime >= 1.1);
  assert.equal(await page.locator('audio').evaluate(audio => audio.paused), false);
  assert.match(await page.getByRole('status', { name: '播放状态' }).textContent(), /正在播放/);
  await page.close();
});
