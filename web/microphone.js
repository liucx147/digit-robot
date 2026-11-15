// Capture is browser-local. Only a completed, checked PCM WAV leaves this module.
export function createMicrophoneRecorder(onFailure) {
  let generation = 0, active;
  const current = turn => active === turn && turn.generation === generation;
  function release(turn) {
    clearTimeout(turn?.timer);
    turn?.stream?.getTracks().forEach(track => track.stop());
  }
  function cancel() {
    generation++;
    const turn = active; active = undefined;
    release(turn);
    if (turn?.recorder?.state !== 'inactive') { try { turn?.recorder?.stop(); } catch {} }
    turn?.context?.close().catch(() => {});
  }
  function fail(turn, error) {
    if (!current(turn)) return;
    cancel(); onFailure(error);
  }
  return {
    cancel,
    async start() {
      cancel();
      const turn = active = { generation, chunks: [], size: 0 };
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('录音需要 localhost 或 HTTPS，以及支持 MediaRecorder 的浏览器');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!current(turn)) { stream.getTracks().forEach(track => track.stop()); return false; }
        turn.stream = stream;
        const recorder = turn.recorder = new MediaRecorder(stream);
        turn.stopped = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
        recorder.addEventListener('dataavailable', event => {
          if (!current(turn) || !event.data.size) return;
          turn.chunks.push(event.data); turn.size += event.data.size;
          if (turn.size > 6 * 1024 * 1024) fail(turn, new Error('录音超过 6 MiB 限制，请缩短发言'));
        });
        recorder.addEventListener('error', event => fail(turn, new Error(`麦克风录音失败：${event.error?.message || '设备错误'}`)));
        stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
          if (current(turn) && !turn.finishing) fail(turn, new Error('麦克风已断开，请检查设备后重试'));
        }));
        recorder.start(250);
        turn.started = performance.now();
        turn.timer = setTimeout(() => fail(turn, new Error('录音最多 30 秒，已取消本轮，请缩短发言')), 30000);
        return true;
      } catch (error) {
        if (!current(turn)) return false;
        cancel(); throw error;
      }
    },
    async finish() {
      const turn = active;
      if (!turn?.recorder || turn.finishing) return null;
      turn.finishing = true; clearTimeout(turn.timer);
      try {
        if (performance.now() - turn.started > 30000) throw new Error('录音最多 30 秒，请缩短发言');
        turn.recorder.stop();
        await turn.stopped;
        release(turn);
        if (!current(turn)) return null;
        const encoded = new Blob(turn.chunks, { type: turn.recorder.mimeType });
        turn.chunks = [];
        if (!encoded.size) throw new Error('录音为空，请确认麦克风后重新发言');
        // decodeAudioData resamples the complete recording to this context's rate.
        const context = turn.context = new AudioContext({ sampleRate: 16000 });
        const decoded = await context.decodeAudioData(await encoded.arrayBuffer());
        if (!current(turn)) return null;
        if (decoded.sampleRate !== 16000) throw new Error('浏览器不支持 16 kHz 录音转换，请更换浏览器');
        if (!decoded.length || !Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error('录音为空，请重新发言');
        if (decoded.duration > 30) throw new Error('录音最多 30 秒，请缩短发言');
        const bytes = new ArrayBuffer(44 + decoded.length * 2), view = new DataView(bytes);
        if (bytes.byteLength > 6 * 1024 * 1024) throw new Error('录音超过 6 MiB 限制');
        const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
        text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
        view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, decoded.length * 2, true);
        const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
        let audible = false;
        for (let i = 0; i < decoded.length; i++) {
          let sample = 0;
          for (const values of channels) sample += values[i] / channels.length;
          sample = Math.max(-1, Math.min(1, sample));
          const pcm = Math.round(sample * (sample < 0 ? 32768 : 32767));
          if (Math.abs(pcm) > 2) audible = true;
          view.setInt16(44 + i * 2, pcm, true);
        }
        if (!audible) throw new Error('录音为空或全静音，请确认麦克风后重新发言');
        return new Blob([bytes], { type: 'audio/wav' });
      } catch (error) { if (!current(turn)) return null; throw new Error(`录音转换失败：${error.message}`); }
      finally {
        release(turn);
        if (turn.context?.state !== 'closed') await turn.context?.close().catch(() => {});
        if (active === turn) active = undefined;
      }
    },
  };
}
