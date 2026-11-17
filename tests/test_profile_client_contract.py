"""Real HTTP cancellation/epoch contract, production JS client, CPU model fixture."""
from pathlib import Path
import shutil
import subprocess
from threading import Event

import httpx
import pytest

from digit_robot.server import create_app
from digit_robot.voice import VoicePipeline
from test_sentence_api import serve
from test_voice_api import ModelFixture


@pytest.mark.skipif(shutil.which('node') is None, reason='Node is required for the production browser client contract')
@pytest.mark.parametrize('anonymous', [False, True])
def test_profile_binding_recovers_epoch_advanced_by_real_disconnect(tmp_path: Path, anonymous):
    release = Event()

    class Delayed(ModelFixture):
        def generate(self, messages, output_dir, cancel):
            assert release.wait(12)
            return super().generate(messages, output_dir, cancel)

    pipeline = VoicePipeline(Delayed(), tmp_path)
    script = r'''
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const [source,base,target] = process.argv.slice(1);
const raw = await fs.readFile(source,'utf8');
const {createVoiceClient} = await import('data:text/javascript;base64,'+Buffer.from(raw).toString('base64'));
const client = createVoiceClient(base), session = await client.open();
const pending = client.text('旧档案正在生成');pending.catch(()=>{});
const state = async()=>await (await fetch(base+'/v1/sessions/'+session.session_id)).json();
const wait = async condition=>{const end=Date.now()+3000;while(!await condition()){assert(Date.now()<end,'state transition deadline');await new Promise(r=>setTimeout(r,15));}};
await wait(async()=> (await state()).state==='generating');
client.invalidate();
await wait(async()=> (await state()).session_epoch===1);
const result = await client.bindProfile(target==='null'?null:target);
assert.equal(result.profile_id,target==='null'?null:target);
assert.equal(result.session_epoch,2);
assert.equal(await pending,null);
console.log('real-disconnect-binding-recovered');
'''
    with serve(create_app(pipeline)) as base, httpx.Client(base_url=base, timeout=5) as client:
        pid = client.post('/v1/profiles', json={'display_name': '合成切档对象'}).json()['profile_id']
        try:
            result = subprocess.run(['node', '--input-type=module', '-e', script,
                str(Path(__file__).resolve().parents[1]/'web/voice-client.js'), base,
                'null' if anonymous else pid], capture_output=True, text=True, encoding='utf-8', timeout=10)
            assert result.returncode == 0, result.stdout + result.stderr
        finally:
            release.set()
