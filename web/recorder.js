// Mono PCM16 keeps browser capture compatible with the local ASR boundary.
export function encodeWav(samples, sampleRate) {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const label = (offset, text) => [...text].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); label(8, 'WAVE');
  label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  });
  return new Blob([bytes], { type: 'audio/wav' });
}

export function createRecorder({ onLimit = () => {} } = {}) {
  let generation = 0, active = false, capture, timer, chunks = [], count = 0, sampleRate = 16000;
  function release() {
    active = false;
    clearTimeout(timer);
    if (!capture) return;
    const { stream, context, source, processor, mute } = capture;
    capture = undefined;
    if (processor) processor.onaudioprocess = null;
    source?.disconnect(); processor?.disconnect(); mute?.disconnect();
    stream.getTracks().forEach(track => track.stop());
    context.close().catch(() => {});
  }
  function cancel() {
    generation++;
    release();
    chunks = []; count = 0;
  }
  return {
    get active() { return active; },
    async start() {
      cancel();
      const token = generation;
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!navigator.mediaDevices?.getUserMedia || !Context) throw new Error('浏览器不支持麦克风录音，请使用 localhost 或 HTTPS。');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      if (token !== generation) {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('录音已取消');
      }
      try {
        const context = new Context({ sampleRate: 16000 });
        capture = { stream, context };
        sampleRate = context.sampleRate;
        if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) throw new Error('麦克风采样率不受语音接口支持。');
        await context.resume();
        if (token !== generation) throw new Error('录音已取消');
        const source = context.createMediaStreamSource(stream);
        const processor = context.createScriptProcessor(4096, 1, 1);
        const mute = context.createGain(); mute.gain.value = 0;
        capture = { stream, context, source, processor, mute };
        const limit = () => {
          if (!active || token !== generation) return;
          release();
          queueMicrotask(() => { if (token === generation) onLimit(); });
        };
        processor.onaudioprocess = event => {
          if (!active || token !== generation) return;
          const input = event.inputBuffer.getChannelData(0);
          const take = Math.min(input.length, sampleRate * 30 - count);
          if (take > 0) { chunks.push(input.slice(0, take)); count += take; }
          if (count >= sampleRate * 30) limit();
        };
        source.connect(processor); processor.connect(mute); mute.connect(context.destination);
        active = true;
        timer = setTimeout(limit, 30000);
      } catch (error) {
        stream.getTracks().forEach(track => track.stop());
        if (token === generation) cancel();
        throw error;
      }
    },
    async stop() {
      generation++;
      release();
      if (!count) throw new Error('没有录到声音，请开始录音后再结束发言。');
      const samples = new Float32Array(count);
      let offset = 0;
      for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
      chunks = []; count = 0;
      return encodeWav(samples, sampleRate);
    },
    cancel,
  };
}
