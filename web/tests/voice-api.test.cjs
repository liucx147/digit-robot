const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { publicBrowser } = require('./browser-fixture.cjs');
let app, wav, duration;
before(async () => {
  app = await publicBrowser(path.resolve(__dirname, '..'));
  wav = await fs.readFile(path.resolve(__dirname, '../assets/nihao-cc0.wav'));
  duration = (wav.length - 44) / wav.readUInt32LE(28) * 1000;
});
after(async () => { await app?.close(); });

function deferred() { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; }

// Keep A's late-status regression on B's production UI; the broader text and
// microphone behavior is exercised by voice-public and microphone-public.
for (const failed of [false, true]) {
  test(`a late status poll cannot replace the final ${failed ? 'failure' : 'playing'} state`, async () => {
    const page = await app.browser.newPage();
    page.setDefaultTimeout(6000);
    const turn = deferred(), poll = deferred(), entered = deferred();
    const session = { session_id: 'test-session', session_epoch: 0, state: 'idle' };
    await page.route('**/v1/**', async route => {
      const request = route.request(), url = new URL(request.url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.endsWith('/audio')) return route.fulfill({ contentType: 'audio/wav', body: wav });
      if (url.pathname.endsWith('/text')) {
        await turn.promise;
        if (failed) return json({ code: 'dialogue_failed', message: '最终模型失败' }, 502);
        return json({ ...session, type: 'response', state: 'ready', status: 'ok', utterance_id: 'api-utterance-1',
          user_emotion: 'happiness', reply: '听到这个消息，我也为你高兴。', expression_intent: { style: 'cheerful', intensity: .65 },
          audio: { url: '/v1/sessions/test-session/turns/api-utterance-1/audio', mime_type: 'audio/wav',
            sample_rate_hz: wav.readUInt32LE(24), channels: wav.readUInt16LE(22), duration_ms: duration } });
      }
      if (request.method() === 'GET') {
        entered.resolve();
        await poll.promise;
        return json({ ...session, state: 'generating' });
      }
      return json(session);
    });
    try {
      await page.goto(app.baseURL);
      await page.getByRole('status', { name: '播放状态' }).filter({ hasText: '三维头部已就绪' }).waitFor();
      await page.getByRole('button', { name: '连接本地服务', exact: true }).click();
      await page.getByRole('status', { name: '对话状态' }).filter({ hasText: '已连接' }).waitFor();
      await page.getByLabel('输入中文').fill('延迟状态');
      await page.locator('#voice-send').click();
      await entered.promise;
      turn.resolve();
      const finalState = failed ? '最终模型失败' : '正在播放数字人的回复';
      await page.locator('#voice-status').filter({ hasText: finalState }).waitFor();
      const delivered = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/sessions/test-session');
      poll.resolve();
      await (await delivered).finished();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.match(await page.locator('#voice-status').textContent(), new RegExp(finalState));
    } finally { turn.resolve(); poll.resolve(); await page.close(); }
  });
}
