// Browser-only API adapter. Playback always goes through main.js's decoded-audio path.
export function createVoiceClient(baseUrl) {
  const base = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || !['http:', 'https:'].includes(base.protocol)) throw new Error('请填写本机服务地址（localhost 或 127.0.0.1）');
  let session, generation = 0;
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
  return {
    get connected() { return !!session; },
    invalidate() { generation++; },
    async open() {
      const stamp = ++generation; session = undefined;
      const next = await request('/v1/sessions', { method: 'POST' });
      if (stamp !== generation) return null;
      if (!validSession(next)) throw new Error('本地服务返回的会话信息无效');
      session = next; return next;
    },
    async text(text) {
      const stamp = ++generation, sid = session?.session_id, epoch = session?.session_epoch;
      try {
        const result = await request(route('/text'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, session_epoch: epoch }) });
        if (!current(stamp, sid, epoch)) return null;
        if (result.session_id !== sid || result.session_epoch !== epoch) throw new Error('服务返回了不匹配的会话或代次');
        validateResult(result);
        const response = await fetch(new URL(result.audio.url, base), { cache: 'no-store' });
        if (!current(stamp, sid, epoch)) return null;
        if (!response.ok) throw new Error(`语音获取失败（HTTP ${response.status}）`);
        const blob = await response.blob();
        return current(stamp, sid, epoch) ? { result, blob } : null;
      } catch (error) { if (!current(stamp, sid, epoch)) return null; throw error; }
    },
    async stop() {
      const path = route('/stop'), sid = session.session_id, stamp = ++generation;
      try {
        const next = await request(path, { method: 'POST' });
        if (stamp !== generation) return null;
        if (next.session_id !== sid || !Number.isInteger(next.session_epoch) || next.session_epoch <= session.session_epoch) throw new Error('停止确认的会话代次无效');
        session = next; return next;
      } catch (error) { if (stamp !== generation) return null; session = undefined; throw error; }
    },
  };
}
