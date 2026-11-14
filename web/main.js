import { attachGazeControls } from './gaze.js';
import { createVoiceClient } from './voice-client.js';
const $ = selector => document.querySelector(selector);
const status = $('#status'), audio = $('#audio');
let gaze = { x: 0, y: 0 }, gazeControls;
let avatar, manifest, powerSamples, sampleRate, objectURL, audioContext;
let sessionEpoch = 0, resourceToken = 0, utteranceId = null, frameId = 0, playing = false;
let voiceClient, voiceGeneration = 0, voiceBusy = false, loadedTurn = null;
const styleLabels = { gentle: '温和关切', cheerful: '轻快友善', calm: '平静清晰', serious: '认真沉稳' };
const emotionLabels = { happiness: '高兴', sadness: '悲伤', anger: '愤怒', fear: '恐惧', surprise: '惊讶', disgust: '厌恶', neutral: '中性' };
// The licensed asset has Joy, jaw and blink morphs; calm/serious use the neutral rest pose.
const smiles = { gentle: .25, cheerful: .85, calm: 0, serious: 0 };
function voiceStatus(message, failed = false) {
  $('#voice-status').textContent = message;
  $('#voice-status').classList.toggle('error', failed);
  $('#voice-send').disabled = !avatar || !voiceClient?.connected || voiceBusy;
  $('#voice-connect').disabled = !avatar || voiceBusy;
}
function abandonVoice() {
  voiceGeneration++; voiceClient?.invalidate(); voiceBusy = false;
  if (loadedTurn && avatar) { playing = false; audio.pause(); frame(0); utteranceId = null; }
  loadedTurn = null;
  voiceStatus('已切换到本地音频，可继续发送新的中文。');
}
let record = { version: 1, frames: [], events: [] };
const MAX_FRAMES = 120000;
function setStatus(message, failed = false) {
  status.textContent = message;
  status.classList.toggle('error', failed);
}
function event(type) {
  record.events.push({ type, utterance_id: utteranceId, session_epoch: sessionEpoch, audio_time_ms: Math.round(audio.currentTime * 1000), observed_at_ms: performance.now() });
}
function frame(mouth = 0) {
  const weights = avatar.face.apply({ mouth, expression: loadedTurn ? smiles[loadedTurn.expression_intent.style] * loadedTurn.expression_intent.intensity : Number($('#expression').value), gaze });
  avatar.render();
  const value = { utterance_id: utteranceId, session_epoch: sessionEpoch, frame_id: frameId++, audio_time_ms: Math.max(0, Math.round(audio.currentTime * 1000)), weights };
  if (utteranceId) {
    if (record.frames.length < MAX_FRAMES) record.frames.push(value);
    else record.truncated = true;
    $('#frame').textContent = JSON.stringify(value, null, 2);
    $('#download').disabled = false;
    document.dispatchEvent(new CustomEvent('digitalhuman:frame', { detail: value }));
  }
  $('#mouth-weight').textContent = weights.jawOpen.toFixed(2);
  $('#audio-time').textContent = audio.currentTime.toFixed(2);
}
function isCurrent(epoch, id, token) { return playing && token === resourceToken && epoch === sessionEpoch && id === utteranceId; }
function tick(epoch, id, token) {
  if (!isCurrent(epoch, id, token)) return;
  // Read channel energy around the media element's actual playback time, never a wall timer.
  const start = Math.floor(audio.currentTime * sampleRate), end = Math.min(powerSamples.length, start + Math.ceil(sampleRate * .02));
  let energy = 0;
  if (!audio.paused) for (let i = start; i < end; i++) energy += powerSamples[i];
  const rms = end > start ? Math.sqrt(energy / (end - start)) : 0;
  frame(Math.max(0, Math.min(1, (rms - .008) * 6)));
  requestAnimationFrame(() => tick(epoch, id, token));
}
function beginLoad() {
  if (utteranceId && !loadedTurn) sessionEpoch++;
  const token = ++resourceToken;
  playing = false;
  audio.pause();
  frame(0);
  utteranceId = null;
  $('#play').disabled = true;
  $('#stop').disabled = false;
  powerSamples = null;
  setStatus('加载和分析音频中…');
  return token;
}
function loadFailed(error, token) {
  if (token !== resourceToken) return;
  $('#stop').disabled = true;
  setStatus(`音频加载失败：${error.message}。请选择有效音频。`, true);
}
async function loadAudio(file, token, turn = null) {
  if (!avatar) return;
  token ??= beginLoad();
  try {
    audioContext ||= new AudioContext();
    const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
    if (token !== resourceToken) return;
    if (!decoded.length || !Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error('音频为空');
    powerSamples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const values = decoded.getChannelData(channel);
      for (let i = 0; i < powerSamples.length; i++) powerSamples[i] += values[i] * values[i] / decoded.numberOfChannels;
    }
    if (turn) {
      if (!powerSamples.some(value => value > 1e-10)) throw new Error('服务返回了全静音语音');
      if (Math.abs(decoded.duration * 1000 - turn.audio.duration_ms) > 50) throw new Error('实际语音时长与服务元数据不一致');
    }
    sampleRate = decoded.sampleRate;
    loadedTurn = turn;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = URL.createObjectURL(file);
    audio.src = objectURL;
    audio.load();
    $('#audio-name').textContent = `${file.name} · ${decoded.duration.toFixed(2)} 秒`;
    $('#play').disabled = false;
    $('#stop').disabled = true;
    setStatus('音频已就绪，点击播放。');
    return true;
  } catch (error) { if (token === resourceToken) powerSamples = null; loadFailed(error, token); }
}
$('#audio-file').addEventListener('change', () => { const file = $('#audio-file').files[0]; if (file) { abandonVoice(); loadAudio(file); } });
$('#sample').addEventListener('click', async () => {
  abandonVoice();
  const token = beginLoad();
  try {
    const response = await fetch('./assets/nihao-cc0.wav');
    if (!response.ok) throw new Error('找不到中文录音示例');
    const blob = await response.blob();
    if (token !== resourceToken) return;
    await loadAudio(new File([blob], '你好 · CC0 录音.wav', { type: 'audio/wav' }), token);
  } catch (error) { loadFailed(error, token); }
});
async function playAudio() {
  if (!powerSamples || playing) return;
  const token = ++resourceToken;
  const epoch = loadedTurn ? (sessionEpoch = loadedTurn.session_epoch) : sessionEpoch;
  const id = utteranceId = loadedTurn?.utterance_id || crypto.randomUUID();
  frameId = 0;
  record = { version: 1, avatar: { name: manifest.name, version: manifest.version, sha256: manifest.sha256 }, audio: { name: $('#audio-name').textContent, duration_ms: Math.round(powerSamples.length / sampleRate * 1000) }, frames: [], events: [], ...(loadedTurn ? { session_id: loadedTurn.session_id, response: loadedTurn } : {}) };
  audio.currentTime = 0;
  playing = true;
  $('#play').disabled = true;
  $('#stop').disabled = false;
  setStatus('正在启动音频，可随时停止。');
  event('play-request');
  try {
    const acknowledgement = audio.play();
    tick(epoch, id, token);
    await acknowledgement;
    // A stale acknowledgement must not pause a newer playback on this shared media element.
    if (!isCurrent(epoch, id, token)) return;
    setStatus('正在播放，嘴部跟随音频节奏。');
    event('play');
    if (loadedTurn) { voiceBusy = true; voiceStatus('正在播放数字人的回复。'); }
  } catch (error) {
    if (!isCurrent(epoch, id, token)) return;
    playing = false;
    $('#play').disabled = !powerSamples;
    $('#stop').disabled = true;
    frame(0);
    setStatus(`音频播放失败：${error.message}`, true);
    if (loadedTurn) { voiceBusy = false; voiceStatus(`音频播放失败：${error.message}。可点击播放音频重试。`, true); }
  }
}
$('#play').addEventListener('click', playAudio);
audio.addEventListener('ended', () => {
  if (!playing) return;
  playing = false;
  frame(0);
  event('ended');
  $('#play').disabled = !powerSamples;
  $('#stop').disabled = true;
  setStatus('播放完成，嘴部已闭合。');
  if (loadedTurn) { voiceBusy = false; voiceStatus('回复播放完成，可以输入下一轮中文。'); }
});
audio.addEventListener('error', () => {
  if (!playing) return;
  playing = false;
  frame(0);
  event('audio-error');
  $('#play').disabled = !powerSamples;
  $('#stop').disabled = true;
  setStatus(`音频播放失败：浏览器媒体错误 ${audio.error?.code || '未知'}。`, true);
  if (loadedTurn) { voiceBusy = false; voiceStatus('回复播放失败：浏览器无法播放语音。', true); }
});
function stopLocal() {
  gazeControls?.stop('已停止注视，旧代次输入已失效。', true);
  if (!loadedTurn) sessionEpoch++;
  resourceToken++;
  playing = false;
  audio.pause();
  event('stop');
  audio.currentTime = 0;
  frame(0);
  $('#play').disabled = !powerSamples;
  $('#stop').disabled = true;
  setStatus('已停止，旧代次动画已失效。');
}
$('#stop').addEventListener('click', async () => {
  const wasVoice = voiceBusy || !!loadedTurn;
  const stamp = ++voiceGeneration;
  stopLocal();
  if (!wasVoice) return;
  powerSamples = null; loadedTurn = null; utteranceId = null; $('#play').disabled = true;
  voiceBusy = true; voiceStatus('已停止本机播放，正在取消服务端回复…');
  try {
    await voiceClient.stop();
    if (stamp !== voiceGeneration) return;
    voiceBusy = false; voiceStatus('已停止回复，旧结果已失效。');
  } catch (error) {
    if (stamp !== voiceGeneration) return;
    voiceBusy = false; voiceStatus(`本机播放已停止；服务端停止失败：${error.message}。请重新连接。`, true);
  }
});
$('#voice-connect').addEventListener('click', async () => {
  const stamp = ++voiceGeneration;
  voiceClient?.invalidate(); stopLocal(); loadedTurn = null; utteranceId = null; powerSamples = null; $('#play').disabled = true;
  voiceBusy = true; voiceStatus('正在连接本地模型服务…');
  try {
    voiceClient = createVoiceClient($('#api-base').value);
    await voiceClient.open();
    if (stamp !== voiceGeneration) return;
    voiceBusy = false; voiceStatus('已连接本地服务，可以输入中文。重新连接会开启新会话。');
  } catch (error) {
    if (stamp !== voiceGeneration) return;
    voiceBusy = false; voiceStatus(`连接失败：${error.message}`, true);
  }
});
$('#voice-send').addEventListener('click', async () => {
  const text = $('#text-input').value.trim();
  if (!text || text.length > 2000) { voiceStatus('请输入 1 至 2000 字中文。', true); return; }
  const stamp = ++voiceGeneration;
  const token = beginLoad();
  loadedTurn = null; voiceBusy = true; voiceStatus('正在生成回复与语音，可随时停止…');
  $('#voice-reply').textContent = '等待数字人回复…';
  try {
    const answer = await voiceClient.text(text);
    if (!answer || stamp !== voiceGeneration || token !== resourceToken) return;
    const { result, blob } = answer;
    const ready = await loadAudio(new File([blob], '数字人回复.wav', { type: 'audio/wav' }), token, result);
    if (stamp !== voiceGeneration || token !== resourceToken) return;
    if (!ready) throw new Error('返回的语音无法解码');
    $('#voice-reply').textContent = result.reply;
    $('#user-emotion').textContent = emotionLabels[result.user_emotion];
    $('#voice-expression').textContent = styleLabels[result.expression_intent.style];
    await playAudio();
  } catch (error) {
    if (stamp !== voiceGeneration || token !== resourceToken) return;
    voiceBusy = false; $('#stop').disabled = true;
    setStatus(`回复失败：${error.message}`, true); voiceStatus(`回复失败：${error.message}`, true);
  }
});
$('#expression').addEventListener('input', () => { if (avatar && !playing) frame(0); });
$('#download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `playback-${utteranceId}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
try {
  const manifestURL = new URL('./assets/avatar-manifest.json', import.meta.url);
  const response = await fetch(manifestURL);
  if (!response.ok) throw new Error('找不到数字人资源清单');
  manifest = await response.json();
  const { loadAvatar } = await import('./avatar.js');
  avatar = await loadAvatar($('#avatar'), manifest, manifestURL);
  $('#avatar-name').textContent = `${manifest.name} · ${manifest.version}`;
  gazeControls = attachGazeControls(value => { gaze = value; if (!playing) frame(0); });
  $('#sample').disabled = false;
  $('#voice-connect').disabled = false;
  setStatus('三维头部已就绪，可载入中文录音示例或选择本地音频。');
} catch (error) { setStatus(`资源加载失败：${error.message}。请检查本地资源后重新加载。`, true); }
