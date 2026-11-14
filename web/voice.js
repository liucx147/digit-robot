import { createVoiceClient } from './voice-client.js';

const $ = selector => document.querySelector(selector);
const phaseNames = { idle: '已连接，可以发言。', transcribing: '正在转写录音…', generating: '正在生成回复…', synthesizing: '正在合成语音…', ready: '语音已生成。', stopped: '已停止。', error: '本轮执行失败。' };

export function attachVoiceControls(hooks) {
  let client, session, base, generation = 0, busy = false, recording = false, recorder, polling;
  const status = (text, failed = false) => {
    $('#voice-status').textContent = text;
    $('#voice-status').classList.toggle('error', failed);
  };
  function update() {
    const locked = hooks.inputLocked();
    $('#voice-panel').disabled = locked;
    $('#voice-send').disabled = !session || busy || recording;
    $('#voice-wav').disabled = !session || busy || recording;
    $('#voice-record').disabled = !session || busy || recording;
    $('#voice-record-end').disabled = !recording || busy;
    $('#voice-reset').disabled = !session;
    $('#voice-stop').disabled = !session;
  }
  function invalidateLocal() {
    generation++;
    clearInterval(polling);
    recorder?.cancel();
    recording = false;
    busy = false;
    update();
    return generation;
  }
  async function stop(playbackStopped = false) {
    const stamp = invalidateLocal();
    if (!playbackStopped) hooks.stopPlayback(true);
    if (!session) return;
    busy = true;
    update();
    status('已停止，正在取消服务端轮次…');
    try {
      const next = await client.stop();
      if (stamp !== generation || !next) return;
      session = next;
      status('已停止，旧回复和音频已失效。');
    } catch (error) {
      if (stamp === generation) { session = null; status(`取消失败：${error.message}。请重新连接，音频保持停止。`, true); }
    } finally { if (stamp === generation) { busy = false; update(); } }
  }
  async function connect() {
    if (hooks.inputLocked()) return;
    const previous = client, hadSession = session;
    const stamp = invalidateLocal();
    hooks.stopPlayback(true);
    if (hadSession) previous.stop().catch(() => {});
    session = null;
    busy = true;
    update();
    status('正在连接语音服务…');
    try {
      const url = new URL($('#voice-base').value.trim() || location.origin);
      if (!['http:', 'https:'].includes(url.protocol)) throw Error('需要 HTTP 或 HTTPS 服务地址');
      base = url.href.replace(/\/$/, '');
      const next = createVoiceClient(base, hooks.audio);
      client = next;
      const opened = await next.open();
      if (stamp !== generation || !opened) return;
      session = opened;
      status('已连接，可以发送文本或录音。');
    } catch (error) { if (stamp === generation) status(`连接失败：${error.message}`, true); }
    finally { if (stamp === generation) { busy = false; update(); } }
  }
  async function submit(kind, value) {
    if (!session || busy || hooks.inputLocked()) return;
    if (kind === 'text' && !value.trim()) { status('请先输入对话文本。', true); return; }
    const stamp = invalidateLocal();
    hooks.stopPlayback(true);
    busy = true;
    update();
    status(kind === 'text' ? '正在生成回复…' : '正在转写录音…');
    hooks.allowStop();
    let pollingActive = true;
    polling = setInterval(async () => {
      try {
        const state = await client.status();
        if (stamp === generation && pollingActive) status(phaseNames[state.state] || '正在处理…', state.state === 'error');
      } catch { /* The turn request carries the final visible network error. */ }
    }, 700);
    try {
      const result = await (kind === 'text' ? client.text(value) : client.wav(value));
      pollingActive = false;
      if (stamp !== generation || !result) return;
      clearInterval(polling);
      const response = await fetch(base + result.audio.url);
      if (!response.ok) throw Error(`语音下载失败（${response.status}）`);
      const blob = await response.blob();
      if (stamp !== generation) return;
      $('#voice-transcript').textContent = result.transcript;
      $('#voice-reply').textContent = result.reply;
      $('#voice-emotion').textContent = result.user_emotion;
      $('#voice-intent').textContent = `${result.expression_intent.style} · ${result.expression_intent.intensity}`;
      const played = await hooks.prepareReply(result, blob);
      if (stamp !== generation) return;
      status(played ? '正在播放服务回复。' : '语音已就绪，请点击播放音频。');
    } catch (error) {
      pollingActive = false;
      if (stamp === generation) {
        hooks.stopPlayback(true);
        status(`本轮失败：${error.message}`, true);
      }
    } finally {
      pollingActive = false;
      if (stamp === generation) { clearInterval(polling); busy = false; update(); }
    }
  }
  async function reset() {
    if (!session || hooks.inputLocked()) return;
    const stamp = invalidateLocal();
    hooks.stopPlayback(true);
    busy = true;
    update();
    try {
      const next = await client.reset();
      if (stamp !== generation || !next) return;
      session = next;
      for (const field of ['transcript', 'reply', 'emotion', 'intent']) $(`#voice-${field}`).textContent = '—';
      status('对话已重置，旧上下文和音频已失效。');
    } catch (error) {
      if (stamp === generation) { session = null; status(`重置失败：${error.message}。请重新连接。`, true); }
    } finally { if (stamp === generation) { busy = false; update(); } }
  }
  async function startRecording() {
    if (!session || busy || hooks.inputLocked()) return;
    const stamp = invalidateLocal();
    hooks.stopPlayback(true);
    busy = true;
    update();
    hooks.allowStop();
    status('正在请求麦克风权限…');
    try {
      const { createRecorder } = await import('./recorder.js');
      if (stamp !== generation) return;
      recorder = createRecorder({ onLimit: () => finishRecording() });
      await recorder.start();
      if (stamp !== generation) { recorder.cancel(); return; }
      recording = true;
      status('正在录音，点击结束并发送。');
    } catch (error) { if (stamp === generation) status(`录音失败：${error.message}`, true); }
    finally { if (stamp === generation) { busy = false; update(); } }
  }
  async function finishRecording() {
    if (!recording || busy) return;
    const stamp = generation;
    recording = false;
    busy = true;
    update();
    try {
      const blob = await recorder.stop();
      if (stamp !== generation) return;
      busy = false;
      await submit('wav', blob);
    } catch (error) { if (stamp === generation) status(`录音失败：${error.message}`, true); }
    finally { if (stamp === generation) { busy = false; update(); } }
  }
  $('#voice-connect').addEventListener('click', connect);
  $('#voice-send').addEventListener('click', () => submit('text', $('#voice-text').value));
  $('#voice-wav').addEventListener('change', () => {
    const file = $('#voice-wav').files[0];
    if (file) submit('wav', file);
    $('#voice-wav').value = '';
  });
  $('#voice-reset').addEventListener('click', reset);
  $('#voice-stop').addEventListener('click', () => stop());
  $('#voice-record').addEventListener('click', startRecording);
  $('#voice-record-end').addEventListener('click', finishRecording);
  for (const selector of ['#sample', '#audio-file']) new MutationObserver(update).observe($(selector), { attributes: true, attributeFilter: ['disabled'] });
  update();
  return {
    stop,
    localInput() {
      const stamp = invalidateLocal();
      if (session) {
        busy = true;
        update();
        client.stop().then(next => {
          if (stamp === generation && next) { session = next; update(); status('已切换为本地音频，旧服务回复已取消。'); }
        }).catch(error => { if (stamp === generation) { session = null; status(`取消失败：${error.message}。请重新连接。`, true); } })
          .finally(() => { if (stamp === generation) { busy = false; update(); } });
      }
    },
    ended() { if (session && !busy) status('播放完成，可以继续发言。'); },
  };
}
