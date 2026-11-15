// Browser-only API adapter. Playback always goes through main.js's decoded-audio path.
export function createVoiceClient(baseUrl) {
  const base = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || !['http:', 'https:'].includes(base.protocol)) throw new Error('请填写本机服务地址（localhost 或 127.0.0.1）');
  let session, generation = 0, pendingStop, sentenceStreaming = false, streamAbort;
  const validSession = value => value && typeof value.session_id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.session_id) && Number.isInteger(value.session_epoch) && value.session_epoch >= 0;
  function validateResult(value) {
    const intent = value?.expression_intent, sound = value?.audio;
    const expected = `/v1/sessions/${encodeURIComponent(value?.session_id)}/turns/${encodeURIComponent(value?.utterance_id)}/audio`;
    if (!validSession(value) || value.type !== 'response' || value.state !== 'ready' || value.status !== 'ok' ||
        typeof value.utterance_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.utterance_id) ||
        !['happiness','sadness','anger','fear','surprise','disgust','neutral'].includes(value.user_emotion) ||
        typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 500 ||
        !['gentle','cheerful','calm','serious'].includes(intent?.style) || typeof intent.intensity !== 'number' || !Number.isFinite(intent.intensity) || intent.intensity < 0 || intent.intensity > 1 ||
        sound?.url !== expected || sound.mime_type !== 'audio/wav' || !Number.isFinite(sound.duration_ms) || sound.duration_ms <= 0 ||
        !Number.isInteger(sound.sample_rate_hz) || sound.sample_rate_hz <= 0 || ![1,2].includes(sound.channels)) {
      throw new Error('服务返回的回复、表达意图或音频信息无效');
    }
  }
  const current = (stamp, sid, epoch) => stamp === generation && session?.session_id === sid && session.session_epoch === epoch;
  async function request(path, options) {
    const response = await fetch(new URL(path, base), { cache: 'no-store', ...options });
    let body;
    try { body = await response.json(); } catch { throw new Error('本地服务未返回有效 JSON'); }
    if (!response.ok) throw new Error(body.code === 'gpu_busy' ? '模型服务正在处理其他轮次，请稍后重试。' : `${body.message || '服务请求失败'}${body.code ? `（${body.code}）` : ''}`);
    return body;
  }
  function route(suffix = '') {
    if (!session) throw new Error('请先连接本地服务');
    return `/v1/sessions/${encodeURIComponent(session.session_id)}${suffix}`;
  }
  async function send(suffix, options, requireTranscript = false) {
    const stamp = ++generation, sid = session?.session_id, epoch = session?.session_epoch;
    try {
      const result = await request(route(suffix), options);
      if (!current(stamp, sid, epoch)) return null;
      if (result.session_id !== sid || result.session_epoch !== epoch) throw new Error('服务返回了不匹配的会话或代次');
      validateResult(result);
      if (requireTranscript && (typeof result.transcript !== 'string' || !result.transcript.trim() || result.transcript.length > 2000)) throw new Error('未得到有效语音转写，未播放回复');
      const response = await fetch(new URL(result.audio.url, base), { cache: 'no-store' });
      if (!current(stamp, sid, epoch)) return null;
      if (!response.ok) throw new Error(`语音获取失败（HTTP ${response.status}）`);
      const blob = await response.blob();
      return current(stamp, sid, epoch) ? { result, blob } : null;
    } catch (error) { if (!current(stamp, sid, epoch)) return null; throw error; }
  }
  async function streamSend(suffix, options, onEvent) {
    const stamp = ++generation, sid = session?.session_id, epoch = session?.session_epoch;
    streamAbort?.abort();
    const controller = streamAbort = new AbortController();
    let reader, uid, metadata, nextSegment = 0, done = false, awaitingAudio = null, spoken = '';
    try {
      const response = await fetch(new URL(route(suffix).replace('/v1/', '/v2/'), base), { ...options, signal: controller.signal, cache: 'no-store' });
      if (!current(stamp, sid, epoch)) return null;
      if (!response.ok) { const error = await response.json(); throw new Error(error.message || '分句请求失败'); }
      if (!response.body) throw new Error('浏览器不支持流式回复');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let pending = '';
      const deliver = async line => {
        if (!current(stamp, sid, epoch)) return;
        const value = JSON.parse(line);
        if (value.type === 'error' && value.session_id === sid && value.session_epoch === epoch) throw new Error(value.message || '分句请求失败');
        if (done || value.session_id !== sid || value.session_epoch !== epoch || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.utterance_id || '')) throw new Error('分句会话或代次无效');
        if (value.type === 'start') { if (uid) throw new Error('重复的分句轮次'); uid = value.utterance_id; }
        else if (!uid || uid !== value.utterance_id) throw new Error('分句发言标识不匹配');
        if (value.type === 'meta') {
          const intent = value.expression_intent;
          if (metadata || !['happiness','sadness','anger','fear','surprise','disgust','neutral'].includes(value.user_emotion) || !['gentle','cheerful','calm','serious'].includes(intent?.style) || typeof intent.intensity !== 'number' || !Number.isFinite(intent.intensity) || intent.intensity < 0 || intent.intensity > 1) throw new Error('分句表达意图无效');
          metadata = value;
        } else if (value.type === 'sentence') {
          if (!metadata || awaitingAudio !== null || nextSegment >= 3 || value.segment_index !== nextSegment || typeof value.text !== 'string' || !value.text.trim() || value.text.length > (nextSegment === 0 ? 24 : 36) || spoken.length + value.text.length > 80) throw new Error('回复分句无效');
          awaitingAudio = value.text; spoken += value.text;
        } else if (value.type === 'audio_ready') {
          const audio = value.audio, expected = `/v2/sessions/${sid}/turns/${uid}/segments/${nextSegment}/audio`;
          if (!metadata || awaitingAudio === null || value.text !== awaitingAudio || nextSegment >= 3 || value.segment_index !== nextSegment || audio?.url !== expected || audio.mime_type !== 'audio/wav' || !Number.isFinite(audio.duration_ms) || audio.duration_ms <= 0 || !Number.isInteger(audio.sample_rate_hz) || audio.sample_rate_hz <= 0 || ![1,2].includes(audio.channels)) throw new Error('分句音频信息无效');
          awaitingAudio = null;
          nextSegment++;
          // Start prefetch now; playback consumes these promises in segment order.
          value.blob = fetch(new URL(audio.url, base), {signal:controller.signal,cache:'no-store'}).then(async response => {
            if (!response.ok) throw new Error(`分句音频获取失败（HTTP ${response.status}）`);
            const blob = await response.blob();
            return current(stamp, sid, epoch) ? blob : null;
          });
          value.blob.catch(() => {}); // Queue consumption owns the visible error.
          Object.assign(value, {user_emotion:metadata.user_emotion,expression_intent:metadata.expression_intent});
        } else if (value.type === 'done') {
          if (!nextSegment || awaitingAudio !== null || value.status !== 'ok' || value.reply !== spoken) throw new Error('分句回复未完整结束');
          done = true;
        } else if (value.type === 'error') throw new Error(value.message || '分句回复失败');
        else if (!['start','transcript','meta'].includes(value.type)) throw new Error('未知的分句事件');
        await onEvent(value);
      };
      while (current(stamp, sid, epoch)) {
        const {value, done:ended} = await reader.read();
        pending += decoder.decode(value, {stream:!ended});
        if (pending.length > 65536) throw new Error('分句事件过长');
        let end;
        while ((end = pending.indexOf('\n')) >= 0) { const line = pending.slice(0,end); pending = pending.slice(end+1); if (line.trim()) await deliver(line); }
        if (ended) { if (pending.trim()) await deliver(pending); break; }
      }
      if (!current(stamp, sid, epoch)) return null;
      if (!done) throw new Error('分句回复连接提前结束');
      return true;
    } catch (error) { if (!current(stamp, sid, epoch)) return null; throw error; }
    finally { reader?.releaseLock(); }
  }
  return {
    get sentenceStreaming() { return sentenceStreaming; },
    get connected() { return !!session; },
    invalidate() {
      generation++;
      streamAbort?.abort();
      // Discarding a Stop acknowledgement also discards our only confirmed server epoch.
      if (pendingStop !== undefined) session = undefined;
    },
    async open() {
      streamAbort?.abort();
      const stamp = ++generation; session = undefined;
      const next = await request('/v1/sessions', { method: 'POST' });
      if (stamp !== generation) return null;
      if (!validSession(next)) throw new Error('本地服务返回的会话信息无效');
      sentenceStreaming = next.sentence_streaming === true;
      session = next; return next;
    },
    async status() {
      // A read never advances the send generation or replaces our confirmed epoch.
      const stamp = generation, sid = session?.session_id, epoch = session?.session_epoch;
      const value = await request(route());
      if (!current(stamp, sid, epoch)) return null;
      if (value.session_id !== sid || value.session_epoch !== epoch) return null;
      return value;
    },
    text(text) {
      return send('/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, session_epoch: session?.session_epoch }) });
    },
    wav(blob) {
      return send('/audio', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Session-Epoch': String(session?.session_epoch) }, body: blob }, true);
    },
    streamText(text, onEvent) { return streamSend('/text', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,session_epoch:session?.session_epoch})}, onEvent); },
    streamWav(blob, onEvent) { return streamSend('/audio', {method:'POST',headers:{'Content-Type':'audio/wav','X-Session-Epoch':String(session?.session_epoch)},body:blob}, onEvent); },
    async stop() {
      const path = route('/stop'), sid = session.session_id, stamp = ++generation;
      streamAbort?.abort();
      pendingStop = stamp;
      try {
        const next = await request(path, { method: 'POST' });
        if (stamp !== generation) return null;
        if (next.session_id !== sid || !Number.isInteger(next.session_epoch) || next.session_epoch <= session.session_epoch) throw new Error('停止确认的会话代次无效');
        session = next; return next;
      } catch (error) { if (stamp !== generation) return null; session = undefined; throw error; }
      finally { if (pendingStop === stamp) pendingStop = undefined; }
    },
  };
}
