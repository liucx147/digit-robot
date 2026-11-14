const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('real Chromium fake microphone produces nonempty mono PCM16 and releases its media track', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'recorder.js'));
  const server = http.createServer((request, response) => {
    if (request.url === '/recorder.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); response.end(source);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<button id="start">开始录音</button><button id="stop">结束录音</button><p id="state">ready</p>
        <script type="module">
        import {createRecorder} from './recorder.js';
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async options => {window.stream = await original(options); return window.stream;};
        const recorder = createRecorder();
        document.querySelector('#start').onclick = async () => {await recorder.start();document.querySelector('#state').textContent='recording';};
        document.querySelector('#stop').onclick = async () => {
          const blob = await recorder.stop(); window.wav = [...new Uint8Array(await blob.arrayBuffer())];
          document.querySelector('#state').textContent='stopped';
        };
        </script>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH,
      args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '开始录音' }).click();
    await page.locator('#state').filter({ hasText: 'recording' }).waitFor();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: '结束录音' }).click();
    await page.locator('#state').filter({ hasText: 'stopped' }).waitFor();
    const wav = Buffer.from(await page.evaluate(() => window.wav));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.ok(wav.length > 44 && wav.subarray(44).some(value => value !== 0));
    assert.equal(await page.evaluate(() => window.stream.getTracks().every(track => track.readyState === 'ended')), true);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
