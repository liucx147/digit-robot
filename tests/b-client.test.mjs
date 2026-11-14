import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceClient } from '../examples/b-client.js';

const response = (body) => new Response(JSON.stringify(body), { status: 200 });
const audioElement = () => ({ src: 'previous.wav', pause() {}, removeAttribute() { this.src = ''; }, load() {} });

test('reopening discards a late response from the previous session', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let session = 0;
  let finishOld;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/v1/sessions')) return response({ session_id: `s${++session}`, session_epoch: 0 });
    return new Promise((resolve) => { finishOld = resolve; });
  };
  const audio = audioElement();
  const client = createVoiceClient('http://api', audio);
  await client.open();
  const old = client.text('old message');
  await client.open();
  finishOld(response({ session_id: 's1', session_epoch: 0, audio: { url: '/old.wav' } }));
  assert.equal(await old, null);
  assert.equal(audio.src, '');
});

test('a late stop acknowledgement cannot roll back a newer reset epoch', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let finishStop;
  let sentEpoch;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/v1/sessions')) return response({ session_id: 's1', session_epoch: 0 });
    if (url.endsWith('/stop')) return new Promise((resolve) => { finishStop = resolve; });
    if (url.endsWith('/reset')) return response({ session_id: 's1', session_epoch: 2 });
    sentEpoch = JSON.parse(options.body).session_epoch;
    return response({ session_id: 's1', session_epoch: sentEpoch, audio: { url: '/current.wav' } });
  };
  const client = createVoiceClient('http://api', audioElement());
  await client.open();
  const stop = client.stop();
  await client.reset();
  finishStop(response({ session_id: 's1', session_epoch: 1 }));
  await stop;
  await client.text('current');
  assert.equal(sentEpoch, 2);
});
