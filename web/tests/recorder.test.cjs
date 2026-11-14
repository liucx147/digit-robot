const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
let encodeWav, createRecorder;
test.before(async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'recorder.js'), 'utf8');
  ({ encodeWav, createRecorder } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')));
});

function microphone(t, getUserMedia) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalContext = globalThis.AudioContext;
  let process, closed = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
  globalThis.AudioContext = class {
    sampleRate = 16000;
    destination = {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return process = { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    async resume() {}
    async close() { closed++; }
  };
  t.after(() => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
    globalThis.AudioContext = originalContext;
  });
  return { feed(samples) { process.onaudioprocess({ inputBuffer: { getChannelData: () => samples } }); },
           get closed() { return closed; } };
}

test('start and stop return captured WAV while releasing the external microphone and audio context', async t => {
  let released = false;
  const stream = { getTracks: () => [{ stop() { released = true; } }] };
  const device = microphone(t, async () => stream);
  const recorder = createRecorder();
  await recorder.start();
  assert.equal(recorder.active, true);
  device.feed(new Float32Array([-.5, 0, .5]));
  const result = Buffer.from(await (await recorder.stop()).arrayBuffer());
  assert.equal(result.readUInt32LE(40), 6);
  assert.equal(result.readInt16LE(44), -16384);
  assert.equal(recorder.active, false);
  assert.equal(released, true);
  assert.equal(device.closed, 1);
});

test('permission denial remains visible and does not leave an active recording', async t => {
  microphone(t, async () => { throw new DOMException('permission denied', 'NotAllowedError'); });
  const recorder = createRecorder();
  await assert.rejects(recorder.start(), /permission denied/);
  assert.equal(recorder.active, false);
  await assert.rejects(recorder.stop(), /没有录到/);
});

test('cancelled late permission is stopped and cannot revive recording', async t => {
  let grant, released = false;
  microphone(t, () => new Promise(resolve => { grant = resolve; }));
  const recorder = createRecorder();
  const pending = recorder.start();
  recorder.cancel();
  grant({ getTracks: () => [{ stop() { released = true; } }] });
  await assert.rejects(pending, /取消/);
  assert.equal(released, true);
  assert.equal(recorder.active, false);
});

test('thirty seconds releases capture and preserves only the bounded WAV until stop', async t => {
  let released = false, limits = 0;
  const device = microphone(t, async () => ({ getTracks: () => [{ stop() { released = true; } }] }));
  const recorder = createRecorder({ onLimit: () => { limits++; } });
  await recorder.start();
  device.feed(new Float32Array(16000 * 31).fill(.1));
  await Promise.resolve();
  assert.equal(limits, 1);
  assert.equal(released, true);
  assert.equal(recorder.active, false);
  const wav = Buffer.from(await (await recorder.stop()).arrayBuffer());
  assert.equal(wav.readUInt32LE(40), 960000);
});

test('audio-context initialization failure releases the granted microphone', async t => {
  let released = false;
  microphone(t, async () => ({ getTracks: () => [{ stop() { released = true; } }] }));
  globalThis.AudioContext = class { constructor() { throw new Error('audio device unavailable'); } };
  const recorder = createRecorder();
  await assert.rejects(recorder.start(), /audio device unavailable/);
  assert.equal(released, true);
  assert.equal(recorder.active, false);
});

test('cancel invalidates a queued duration-limit callback', async t => {
  let limits = 0;
  const device = microphone(t, async () => ({ getTracks: () => [{ stop() {} }] }));
  const recorder = createRecorder({ onLimit: () => { limits++; } });
  await recorder.start();
  device.feed(new Float32Array(16000 * 30));
  recorder.cancel();
  await Promise.resolve();
  assert.equal(limits, 0);
});

test('public WAV encoder emits mono PCM16 headers and independently known sample values', async () => {
  const blob = encodeWav(new Float32Array([-1, -.5, 0, .5, 1, 2, -2]), 16000);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(4), 50);
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt16LE(20), 1);
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt32LE(24), 16000);
  assert.equal(bytes.readUInt32LE(28), 32000);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => bytes.readInt16LE(44 + i * 2)),
                   [-32768, -16384, 0, 16384, 32767, 32767, -32768]);
});
