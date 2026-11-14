import { attachGazeControls } from './gaze.js';
import { attachVoiceControls } from './voice.js';
const $ = selector => document.querySelector(selector);
const status = $('#status'), audio = $('#audio');
let gaze = { x: 0, y: 0 }, gazeControls;
let avatar, manifest, powerSamples, sampleRate, objectURL, audioContext, voiceControls, remotePlayback;
let sessionEpoch = 0, resourceToken = 0, utteranceId = null, frameId = 0, playing = false;
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
  const weights = avatar.face.apply({ mouth, expression: Number($('#expression').value), gaze });
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
function isCurrent(epoch, id) { return playing && epoch === sessionEpoch && id === utteranceId; }
function tick(epoch, id) {
  if (!isCurrent(epoch, id)) return;
  // Read channel energy around the media element's actual playback time, never a wall timer.
  const start = Math.floor(audio.currentTime * sampleRate), end = Math.min(powerSamples.length, start + Math.ceil(sampleRate * .02));
  let energy = 0;
  if (!audio.paused) for (let i = start; i < end; i++) energy += powerSamples[i];
  const rms = end > start ? Math.sqrt(energy / (end - start)) : 0;
  frame(Math.max(0, Math.min(1, (rms - .008) * 6)));
  requestAnimationFrame(() => tick(epoch, id));
}
function beginLoad() {
  if (utteranceId) sessionEpoch++;
  const token = ++resourceToken;
  playing = false;
  audio.pause();
  frame(0);
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
async function loadAudio(file, token, response = null) {
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
    sampleRate = decoded.sampleRate;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = URL.createObjectURL(file);
    audio.src = objectURL;
    audio.load();
    remotePlayback = response;
    if (response) {
      sessionEpoch = response.session_epoch;
      utteranceId = response.utterance_id;
      $('#expression').value = response.expression_intent.style === 'cheerful' ? response.expression_intent.intensity : 0;
    }
    $('#audio-name').textContent = `${file.name} · ${decoded.duration.toFixed(2)} 秒`;
    $('#play').disabled = false;
    $('#stop').disabled = true;
    setStatus('音频已就绪，点击播放。');
    return true;
  } catch (error) { loadFailed(error, token); if (response) throw error; }
}
$('#audio-file').addEventListener('change', () => { const file = $('#audio-file').files[0]; if (file) { voiceControls?.localInput(); loadAudio(file); } });
$('#sample').addEventListener('click', async () => {
  voiceControls?.localInput();
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
  ++resourceToken;
  const epoch = sessionEpoch;
  const id = utteranceId = remotePlayback?.utterance_id || crypto.randomUUID();
  frameId = 0;
  record = { version: 1, session_id: remotePlayback?.session_id, expression_intent: remotePlayback?.expression_intent, avatar: { name: manifest.name, version: manifest.version, sha256: manifest.sha256 }, audio: { name: $('#audio-name').textContent, duration_ms: Math.round(powerSamples.length / sampleRate * 1000) }, frames: [], events: [] };
  audio.currentTime = 0;
  playing = true;
  $('#play').disabled = true;
  $('#stop').disabled = false;
  setStatus('正在启动音频，可随时停止。');
  event('play-request');
  try {
    const acknowledgement = audio.play();
    tick(epoch, id);
    await acknowledgement;
    // A stale acknowledgement must not pause a newer playback on this shared media element.
    if (!isCurrent(epoch, id)) return false;
    setStatus('正在播放，嘴部跟随音频节奏。');
    event('play');
    return true;
  } catch (error) {
    if (!isCurrent(epoch, id)) return;
    playing = false;
    $('#play').disabled = !powerSamples;
    $('#stop').disabled = true;
    frame(0);
    setStatus(`音频播放失败：${error.message}`, true);
    return false;
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
  voiceControls?.ended();
});
audio.addEventListener('error', () => {
  if (!playing) return;
  playing = false;
  frame(0);
  event('audio-error');
  $('#play').disabled = !powerSamples;
  $('#stop').disabled = true;
  setStatus(`音频播放失败：浏览器媒体错误 ${audio.error?.code || '未知'}。`, true);
});
function stopPlayback(clear = false) {
  gazeControls?.stop('已停止注视，旧代次输入已失效。', true);
  sessionEpoch++;
  resourceToken++;
  playing = false;
  audio.pause();
  event('stop');
  audio.currentTime = 0;
  frame(0);
  if (clear || remotePlayback) {
    powerSamples = null;
    remotePlayback = null;
    audio.removeAttribute('src');
    audio.load();
    if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
  }
  $('#play').disabled = !powerSamples;
  $('#stop').disabled = true;
  setStatus('已停止，旧代次动画已失效。');
}
$('#stop').addEventListener('click', () => {
  stopPlayback();
  voiceControls?.stop(true);
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
  voiceControls = attachVoiceControls({
    audio,
    inputLocked: () => $('#sample').disabled && $('#audio-file').disabled,
    stopPlayback,
    allowStop: () => { $('#stop').disabled = false; },
    async prepareReply(response, blob) {
      const token = beginLoad();
      const loaded = await loadAudio(new File([blob], `回复-${response.utterance_id}.wav`, { type: 'audio/wav' }), token, response);
      if (!loaded || token !== resourceToken) return false;
      return playAudio();
    },
  });
  setStatus('三维头部已就绪，可载入中文录音示例或选择本地音频。');
} catch (error) { setStatus(`资源加载失败：${error.message}。请检查本地资源后重新加载。`, true); }
