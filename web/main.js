import { attachAcceptanceJournal } from './acceptance-journal.js';
import { attachProfileControls } from './profile-controls.js';
import { attachGazeControls } from './gaze.js';
import { createVoiceClient } from './voice-client.js';
import { createMicrophoneRecorder } from './microphone.js';
const $ = selector => document.querySelector(selector);
const status = $('#status'), audio = $('#audio');
const acceptanceJournal = attachAcceptanceJournal();
let gaze = { x: 0, y: 0 }, gazeControls;
let avatar, manifest, powerSamples, sampleRate, objectURL, audioContext;
let replyActivityOffsetMs = null, playbackAcknowledgedToken = null;
const REPLY_ACTIVITY_RMS = .008;
let sessionEpoch = 0, resourceToken = 0, utteranceId = null, frameId = 0, playing = false;
let voiceClient, voiceGeneration = 0, voiceBusy = false, loadedTurn = null, microphonePhase = null, turnObservation = null;
let sentencePlayback = null, profileControls;
let journalAttempt = null, journalSessionId;
function journalEvent(type, stage) {
  if (!journalAttempt || journalAttempt.terminal) return;
  acceptanceJournal.observe(type, {
    client_turn_id:journalAttempt.client_turn_id,source:journalAttempt.source,stage,
    session_id:journalAttempt.session_id,utterance_id:journalAttempt.utterance_id,epoch:journalAttempt.epoch,
    audio_time_ms:Math.max(0,Math.round(audio.currentTime * 1000)),
    input_end_monotonic_ms:journalAttempt.input_end_monotonic_ms,
    reply_activity_monotonic_ms:journalAttempt.reply_activity_monotonic_ms,
  });
  if (['turn-complete','cancelled','failed'].includes(type)) journalAttempt.terminal = true;
}
function journalInputEnd(endedAt = performance.now()) {
  if (!journalAttempt || journalAttempt.terminal) return;
  journalAttempt.input_end_monotonic_ms = endedAt;
  journalEvent('input-end');
}
function journalResponse(value) {
  if (!journalAttempt || journalAttempt.terminal) return;
  journalAttempt.session_id = value.session_id;
  journalAttempt.utterance_id = value.utterance_id;
  journalAttempt.epoch = value.session_epoch;
}
const styleLabels = { gentle: '温和关切', cheerful: '轻快友善', calm: '平静清晰', serious: '认真沉稳' };
const emotionLabels = { happiness: '高兴', sadness: '悲伤', anger: '愤怒', fear: '恐惧', surprise: '惊讶', disgust: '厌恶', neutral: '中性' };
// The licensed asset has Joy, jaw and blink morphs; calm/serious use the neutral rest pose.
const smiles = { gentle: .25, cheerful: .85, calm: 0, serious: 0 };
function voiceStatus(message, failed = false) {
  $('#voice-status').textContent = message;
  $('#voice-status').classList.toggle('error', failed);
  refreshVoiceControls();
}
function refreshVoiceControls() {
  $('#voice-send').disabled = !avatar || !voiceClient?.connected || voiceBusy || playing || profileControls?.blocked;
  $('#voice-connect').disabled = !avatar || voiceBusy;
  $('#microphone-start').disabled = !avatar || !voiceClient?.connected || voiceBusy || playing || profileControls?.blocked;
  $('#microphone-end').disabled = microphonePhase !== 'recording';
}
function abandonVoice() {
  cancelSentencePlayback();
  voiceGeneration++; microphone.cancel(); microphonePhase = null; voiceClient?.invalidate(); voiceBusy = false;
  if (loadedTurn && avatar) { playing = false; audio.pause(); frame(0); utteranceId = null; }
  journalEvent('cancelled','local-audio');
  loadedTurn = null;
  voiceStatus(voiceClient?.connected ? '已切换到本地音频，可继续发送新的中文。' : '已切换到本地音频；请重新连接本地服务后发送中文。');
}
let record = { version: 1, frames: [], events: [] };
const MAX_FRAMES = 120000;
function setStatus(message, failed = false) {
  status.textContent = message;
  status.classList.toggle('error', failed);
  refreshVoiceControls();
}
function event(type) {
  record.events.push({ type, utterance_id: utteranceId, session_epoch: sessionEpoch, segment_index: loadedTurn?.segment_index, audio_time_ms: Math.round(audio.currentTime * 1000), observed_at_ms: performance.now() });
}
function frame(mouth = 0) {
  const weights = avatar.face.apply({ mouth, expression: loadedTurn ? smiles[loadedTurn.expression_intent.style] * loadedTurn.expression_intent.intensity : Number($('#expression').value), gaze });
  avatar.render();
  const value = { utterance_id: utteranceId, session_epoch: sessionEpoch, segment_index: loadedTurn?.segment_index, frame_id: frameId++, audio_time_ms: Math.max(0, Math.round(audio.currentTime * 1000)), weights };
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
  if (!audio.paused && !audio.ended && playbackAcknowledgedToken === token && loadedTurn && turnObservation && turnObservation.reply_activity_started_at_ms === null && replyActivityOffsetMs !== null && audio.currentTime * 1000 >= replyActivityOffsetMs) {
    turnObservation.reply_activity_started_at_ms = performance.now();
    turnObservation.reply_activity_audio_time_ms = Math.round(audio.currentTime * 1000);
    turnObservation.speech_end_to_reply_activity_ms = Math.round(turnObservation.reply_activity_started_at_ms - turnObservation.speech_ended_at_ms);
    $('#voice-latency').textContent = '发言结束至回复语音活动：软件观测 ' + turnObservation.speech_end_to_reply_activity_ms + ' 毫秒；文件起播 ' + turnObservation.speech_end_to_audio_start_ms + ' 毫秒（能量活动检测，回复意义仍需人工核对；不是物理出声测量）。';
    event('reply-activity-start');
  }
  // Journal timing is independent of the existing microphone/playback timing UI.
  if (!audio.paused && !audio.ended && playbackAcknowledgedToken === token && loadedTurn && journalAttempt && !journalAttempt.terminal && journalAttempt.input_end_monotonic_ms !== null && journalAttempt.reply_activity_monotonic_ms === null && replyActivityOffsetMs !== null && audio.currentTime * 1000 >= replyActivityOffsetMs) {
    journalAttempt.reply_activity_monotonic_ms = performance.now();
    journalEvent('reply-activity');
  }
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
  powerSamples = null; replyActivityOffsetMs = null;
  setStatus('加载和分析音频中…');
  return token;
}
function loadFailed(error, token) {
  if (token !== resourceToken) return;
  $('#stop').disabled = true;
  setStatus(`音频加载失败：${error.message}。请选择有效音频。`, true);
}
async function loadAudio(file, token, turn = null, decodedAudio = null) {
  if (!avatar) return;
  token ??= beginLoad();
  try {
    audioContext ||= new AudioContext();
    const decoded = decodedAudio || await audioContext.decodeAudioData(await file.arrayBuffer());
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
    replyActivityOffsetMs = null;
    if (turn) {
      // A trailing 20 ms RMS window cannot label leading silence as already active.
      // This detects signal energy, not semantic speech or physical speaker output.
      const windowSamples = Math.ceil(sampleRate * .02);
      let power = 0;
      for (let i = 0; i < powerSamples.length; i++) {
        power += powerSamples[i];
        if (i >= windowSamples) power -= powerSamples[i - windowSamples];
        if (power / windowSamples > REPLY_ACTIVITY_RMS ** 2) { replyActivityOffsetMs = (i + 1) / sampleRate * 1000; break; }
      }
      if (turnObservation) turnObservation.reply_activity_offset_ms = replyActivityOffsetMs;
    }
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
  playbackAcknowledgedToken = null;
  const epoch = loadedTurn ? (sessionEpoch = loadedTurn.session_epoch) : sessionEpoch;
  const id = utteranceId = loadedTurn?.utterance_id || crypto.randomUUID();
  frameId = 0;
  if (!sentencePlayback?.recordStarted) {
    record = { version: 1, avatar: { name: manifest.name, version: manifest.version, sha256: manifest.sha256 }, audio: { name: $('#audio-name').textContent, duration_ms: Math.round(powerSamples.length / sampleRate * 1000) }, frames: [], events: [], ...(turnObservation && loadedTurn ? { input: turnObservation } : {}), ...(loadedTurn ? { session_id: loadedTurn.session_id, response: loadedTurn } : {}) };
    if (sentencePlayback) { sentencePlayback.recordStarted = true; record.segments = []; }
  }
  if (sentencePlayback) record.segments.push({segment_index:loadedTurn.segment_index,text:loadedTurn.text,audio:loadedTurn.audio,synth_ms:loadedTurn.synth_ms});
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
    playbackAcknowledgedToken = token;
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
    journalEvent('failed','playback');
    sentencePlayback?.rejectSegment?.(error);
  }
}
$('#play').addEventListener('click', playAudio);
audio.addEventListener('playing', () => {
  if (sentencePlayback && playing && !audio.paused && sentencePlayback.startedSegment !== loadedTurn?.segment_index) {
    const now = performance.now();
    if (sentencePlayback.lastEnded !== undefined) sentencePlayback.gaps.push(now - sentencePlayback.lastEnded);
    sentencePlayback.startedSegment = loadedTurn?.segment_index;
  }
  if (!playing || audio.paused || audio.ended || !loadedTurn || !turnObservation || turnObservation.audio_started_at_ms !== null) return;
  turnObservation.audio_started_at_ms = performance.now();
  turnObservation.speech_end_to_audio_start_ms = Math.round(turnObservation.audio_started_at_ms - turnObservation.speech_ended_at_ms);
  $('#voice-latency').textContent = '回复文件已起播（软件观测 ' + turnObservation.speech_end_to_audio_start_ms + ' 毫秒）；等待回复语音活动开始。';
  event('audio-start');
});
audio.addEventListener('ended', () => {
  if (!playing) return;
  playing = false;
  frame(0);
  event('ended');
  if (sentencePlayback) {
    sentencePlayback.lastEnded = performance.now();
    $('#play').disabled = true; $('#stop').disabled = false;
    voiceStatus('本句播放完成，等待后续分句…');
    sentencePlayback.resolveSegment?.(true);
    return;
  }
  if (loadedTurn && turnObservation && turnObservation.reply_activity_started_at_ms === null) $('#voice-latency').textContent = '播放已结束，未观测到达到能量阈值的回复语音活动；响应活动计时未完成。';
  $('#play').disabled = !powerSamples;
  $('#stop').disabled = true;
  setStatus('播放完成，嘴部已闭合。');
  if (loadedTurn) { journalEvent('turn-complete'); voiceBusy = false; voiceStatus('回复播放完成，可以输入下一轮中文。'); }
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
  journalEvent('failed','playback');
  sentencePlayback?.rejectSegment?.(new Error('浏览器无法播放分句语音'));
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
  cancelSentencePlayback();
  microphone.cancel(); microphonePhase = null;
  stopLocal();
  journalEvent('cancelled','stop');
  if (!wasVoice) return;
  powerSamples = null; loadedTurn = null; utteranceId = null; $('#play').disabled = true;
  voiceBusy = true; voiceStatus('已停止本机播放，正在取消服务端回复…');
  try {
    await voiceClient.stop();
    if (stamp !== voiceGeneration) return;
    voiceBusy = false; voiceStatus('已停止回复，旧结果已失效。');
  } catch (error) {
    if (stamp !== voiceGeneration) return;
    acceptanceJournal.observe('failed',{stage:'stop',session_id:journalSessionId});
    voiceBusy = false; voiceStatus(`本机播放已停止；服务端停止失败：${error.message}。请重新连接。`, true);
  }
});
$('#voice-connect').addEventListener('click', async () => {
  profileControls?.beginConnect();
  const stamp = ++voiceGeneration;
  cancelSentencePlayback();
  microphone.cancel(); microphonePhase = null;
  voiceClient?.invalidate(); voiceClient = undefined; stopLocal(); journalEvent('cancelled','reconnect'); loadedTurn = null; utteranceId = null; powerSamples = null; $('#play').disabled = true;
  voiceBusy = true; voiceStatus('正在连接本地模型服务…');
  try {
    voiceClient = createVoiceClient($('#api-base').value);
    const connecting = voiceClient;
    journalSessionId = undefined;
    const connectedSession = await connecting.open();
    if (stamp !== voiceGeneration) return;
    await profileControls.connect(connecting);
    if (stamp !== voiceGeneration) return;
    journalSessionId = connectedSession?.session_id;
    acceptanceJournal.observe('connected',{session_id:journalSessionId,epoch:connectedSession?.session_epoch});
    voiceBusy = false; voiceStatus('已连接本地服务，可以输入中文。重新连接会开启新会话。');
  } catch (error) {
    if (stamp !== voiceGeneration) return;
    acceptanceJournal.observe('failed',{stage:'connect'});
    voiceBusy = false; voiceStatus(`连接失败：${error.message}`, true);
  }
});
function watchVoiceStages(stamp, token) {
  const labels = { transcribing: '正在转写中文发言', generating: '正在生成回复', synthesizing: '正在合成语音' };
  const current = () => stamp === voiceGeneration && token === resourceToken && voiceBusy;
  async function poll() {
    if (!current()) return;
    try {
      const value = await voiceClient.status();
      if (!current()) return;
      if (value && labels[value.state]) voiceStatus(labels[value.state] + '，可随时停止…');
    } catch { /* The pending turn reports its own failure; a status read cannot cancel it. */ }
    if (current()) setTimeout(poll, 300);
  }
  setTimeout(poll, 150);
}
function turnFailed(error, stamp, token) {
  if (stamp !== voiceGeneration || token !== resourceToken) return;
  microphone.cancel(); microphonePhase = null;
  journalEvent('failed','turn');
  voiceBusy = false; $('#stop').disabled = true;
  setStatus(`回复失败：${error.message}`, true); voiceStatus(`回复失败：${error.message}`, true);
}

function cancelSentencePlayback() {
  const previous = sentencePlayback;
  sentencePlayback = null;
  if (previous) { previous.cancelled = true; previous.resolveSegment?.(false); }
}

function failSentencePlayback(error, turn) {
  if (turn !== sentencePlayback || turn.stamp !== voiceGeneration) return;
  cancelSentencePlayback();
  stopLocal(); powerSamples = null; loadedTurn = null; $('#play').disabled = true;
  turnFailed(error, turn.stamp, resourceToken);
  voiceBusy = true; refreshVoiceControls();
  voiceClient.stop().catch(() => {}).finally(() => {
    if (turn.stamp === voiceGeneration) { voiceBusy = false; refreshVoiceControls(); }
  });
}

async function pumpSentences(turn) {
  if (turn.pumping || turn !== sentencePlayback) return;
  turn.pumping = true;
  try {
    while (turn.queue.length && turn === sentencePlayback && !turn.cancelled) {
      const segment = turn.queue.shift(), prepared = await segment.prepared;
      if (turn !== sentencePlayback || turn.cancelled) return;
      const response = {...segment, blob:undefined, prepared:undefined, reply:turn.reply};
      const ready = await loadAudio(prepared.file, resourceToken, response, prepared.decoded);
      if (turn !== sentencePlayback || turn.cancelled) return;
      if (!ready) throw new Error('分句语音无法解码');
      const ended = new Promise((resolve,reject) => { turn.resolveSegment = resolve; turn.rejectSegment = reject; });
      await playAudio();
      if (!await ended || turn !== sentencePlayback) return;
    }
    if (turn.done && turn === sentencePlayback) {
      const origin = turnObservation.speech_ended_at_ms;
      record.response = turn.done;
      record.audio.duration_ms = record.segments.reduce((sum,segment)=>sum+segment.audio.duration_ms,0);
      record.server_timings_ms = turn.done.timings_ms;
      record.client_timings_ms = {first_audio_start_ms:turnObservation.speech_end_to_audio_start_ms,
        first_reply_activity_ms:turnObservation.speech_end_to_reply_activity_ms,
        generation_done_observed_ms:turn.doneObserved-origin,total_playback_ms:turn.lastEnded-origin,
        segment_gaps_ms:turn.gaps};
      event('turn-ended');
      journalEvent('turn-complete');
      sentencePlayback = null; voiceBusy = false;
      $('#play').disabled = true; $('#stop').disabled = true;
      setStatus('分句播放完成，嘴部已闭合。');
      const first = record.client_timings_ms.first_reply_activity_ms;
      $('#voice-latency').textContent = `首句语音活动 ${first === null ? '未观测到' : Math.round(first) + ' 毫秒'}；整轮播放结束 ${Math.round(record.client_timings_ms.total_playback_ms)} 毫秒（软件观测）。`;
      voiceStatus('回复播放完成，可以输入下一轮中文。');
    }
  } catch (error) { failSentencePlayback(error, turn); }
  finally { turn.pumping = false; }
}

async function receiveSentenceTurn(kind, input, stamp) {
  const turn = sentencePlayback = {stamp,queue:[],reply:'',gaps:[],pumping:false,recordStarted:false,done:null,cancelled:false};
  if (!turnObservation) turnObservation = {source:'text',speech_ended_at_ms:performance.now(),audio_started_at_ms:null,speech_end_to_audio_start_ms:null,reply_activity_started_at_ms:null,speech_end_to_reply_activity_ms:null};
  const onEvent = value => {
    if (turn !== sentencePlayback || stamp !== voiceGeneration) return;
    journalResponse(value);
    if (value.type === 'transcript') $('#voice-transcript').textContent = value.transcript;
    if (value.type === 'meta') {
      $('#user-emotion').textContent = emotionLabels[value.user_emotion];
      $('#voice-expression').textContent = styleLabels[value.expression_intent.style];
    }
    if (value.type === 'sentence') {
      turn.reply += value.text; $('#voice-reply').textContent = turn.reply;
      if (!playing) voiceStatus('首句已生成，正在合成语音，可随时停止…');
    }
    if (value.type === 'audio_ready') {
      audioContext ||= new AudioContext();
      value.prepared = value.blob.then(async blob => {
        if (!blob) throw new Error('分句音频已经失效');
        const file = new File([blob], `数字人回复-${value.segment_index + 1}.wav`, {type:'audio/wav'});
        return {file, decoded:await audioContext.decodeAudioData(await file.arrayBuffer())};
      });
      value.prepared.catch(() => {});
      turn.queue.push(value); pumpSentences(turn);
    }
    if (value.type === 'done') { turn.done = value; turn.doneObserved = performance.now(); pumpSentences(turn); }
  };
  try {
    await (kind === 'text' ? voiceClient.streamText(input,onEvent) : voiceClient.streamWav(input,onEvent));
  } catch (error) { failSentencePlayback(error,turn); }
}
async function receiveAnswer(answer, stamp, token) {
  if (!answer || stamp !== voiceGeneration || token !== resourceToken) return;
  const { result, blob } = answer;
  journalResponse(result);
  const ready = await loadAudio(new File([blob], '数字人回复.wav', { type: 'audio/wav' }), token, result);
  if (stamp !== voiceGeneration || token !== resourceToken) return;
  if (!ready) throw new Error('返回的语音无法解码');
  $('#voice-reply').textContent = result.reply;
  $('#user-emotion').textContent = emotionLabels[result.user_emotion];
  $('#voice-expression').textContent = styleLabels[result.expression_intent.style];
  if (result.transcript) $('#voice-transcript').textContent = result.transcript;
  await playAudio();
}
function beginVoiceTurn(source) {
  const stamp = ++voiceGeneration, token = beginLoad();
  loadedTurn = null; turnObservation = null; voiceBusy = true;
  journalAttempt = {client_turn_id:crypto.randomUUID(),source,session_id:journalSessionId,input_end_monotonic_ms:null,reply_activity_monotonic_ms:null,terminal:false};
  journalEvent('attempt-start');
  $('#voice-latency').textContent = '发言响应计时：等待本轮发言。';
  $('#voice-reply').textContent = '等待数字人回复…';
  $('#voice-transcript').textContent = '语音转写将在这里显示。';
  return { stamp, token };
}
const microphone = createMicrophoneRecorder(error => turnFailed(error, voiceGeneration, resourceToken));
$('#microphone-start').addEventListener('click', async () => {
  if (voiceBusy || !voiceClient?.connected || playing || profileControls?.blocked) return;
  const { stamp, token } = beginVoiceTurn('microphone');
  microphonePhase = 'permission'; voiceStatus('请求麦克风权限中，可随时停止…');
  try {
    if (!await microphone.start() || stamp !== voiceGeneration || token !== resourceToken) return;
    microphonePhase = 'recording'; voiceStatus('正在录音，请说中文；说完点击“结束发言”（最多30秒）。');
  } catch (error) {
    if (error.name === 'NotAllowedError') error = new Error('麦克风权限被拒绝，请在浏览器设置中允许后重试');
    if (error.name === 'NotReadableError') error = new Error('麦克风被占用或无法读取，请关闭占用麦克风的程序或重复页面，检查设备后重试');
    turnFailed(error, stamp, token);
  }
});
$('#microphone-end').addEventListener('click', async () => {
  if (microphonePhase !== 'recording') return;
  const stamp = voiceGeneration, token = resourceToken;
  turnObservation = { source: 'microphone', timing_basis: 'browser-performance-and-media-current-time-energy', speech_ended_at_ms: performance.now(), audio_started_at_ms: null, speech_end_to_audio_start_ms: null, reply_activity_offset_ms: null, reply_activity_started_at_ms: null, reply_activity_audio_time_ms: null, speech_end_to_reply_activity_ms: null };
  journalInputEnd(turnObservation.speech_ended_at_ms);
  microphonePhase = 'converting'; voiceStatus('录音结束，正在转换 PCM WAV，可随时停止…');
  try {
    const wav = await microphone.finish();
    if (!wav || stamp !== voiceGeneration || token !== resourceToken) return;
    microphonePhase = null; voiceStatus('正在转写中文发言，可随时停止…');
    if (voiceClient.sentenceStreaming) { await receiveSentenceTurn('audio',wav,stamp); return; }
    const pending = voiceClient.wav(wav);
    watchVoiceStages(stamp, token);
    await receiveAnswer(await pending, stamp, token);
  } catch (error) { turnFailed(error, stamp, token); }
});
$('#voice-send').addEventListener('click', async () => {
  if (voiceBusy || !voiceClient?.connected || profileControls?.blocked) return;
  const text = $('#text-input').value.trim();
  if (!text || text.length > 2000) { voiceStatus('请输入 1 至 2000 字中文。', true); return; }
  const { stamp, token } = beginVoiceTurn('text');
  journalInputEnd();
  voiceStatus('正在生成回复与语音，可随时停止…');
  if (voiceClient.sentenceStreaming) { await receiveSentenceTurn('text',text,stamp); return; }
  try { const pending = voiceClient.text(text); watchVoiceStages(stamp, token); await receiveAnswer(await pending, stamp, token); }
  catch (error) { turnFailed(error, stamp, token); }
});
profileControls = attachProfileControls({
  onChange: refreshVoiceControls,
  stop() {
    voiceGeneration++; cancelSentencePlayback(); microphone.cancel(); microphonePhase = null;
    voiceClient?.invalidate(); stopLocal(); journalEvent('cancelled','profile-change'); voiceBusy = false; loadedTurn = null; utteranceId = null; powerSamples = null; turnObservation = null;
    record = {version:1,frames:[],events:[]}; $('#frame').textContent = '尚无播放记录'; $('#download').disabled = true;
    $('#play').disabled = true; $('#voice-reply').textContent = '回复将在这里显示。';
    $('#voice-transcript').textContent = '语音转写将在这里显示。';
    $('#user-emotion').textContent = '尚无'; $('#voice-expression').textContent = '尚无';
    voiceStatus('当前回复已停止，正在更新档案…');
  },
  settled(failed) { voiceStatus(failed ? '档案操作未完成，请重新读取档案或重新连接后继续。' : '档案已就绪，可以输入中文。', failed); }
});
window.addEventListener('pagehide', () => { cancelSentencePlayback(); microphone.cancel(); voiceGeneration++; voiceClient?.invalidate(); journalEvent('cancelled','pagehide'); });
$('#expression').addEventListener('input', () => { if (avatar && !playing) frame(0); });
$('#download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `playback-${utteranceId}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
try {
  const manifestURL = new URL(new URLSearchParams(location.search).get('measurementFixture') === 'vrm1' ? './assets/avatar-measurement-manifest.json' : './assets/avatar-manifest.json', import.meta.url);
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
