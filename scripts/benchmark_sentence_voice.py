"""Fixed-speech real browser/GPU benchmark; no model or API result replacements."""
import argparse
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlparse
import wave

from playwright.sync_api import sync_playwright


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:18003')
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--warm-runs', type=int, default=30)
    parser.add_argument('--native-renderer', action='store_true', help='Use the default GPU renderer instead of forced CPU SwiftShader; record the actual renderer')
    args = parser.parse_args()
    base = args.base.rstrip('/')
    if urlparse(base).hostname not in ('127.0.0.1', 'localhost') or not 1 <= args.warm_runs <= 100:
        parser.error('Use a loopback SSH tunnel and 1..100 warm runs')
    root = Path(__file__).resolve().parent.parent
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if (out / 'summary.json').exists():
        raise RuntimeError('Preserve previous evidence; use a fresh output directory')
    source = root / 'reports/voice-chain/input-synthetic.wav'
    fixture = out / 'browser-input.wav'
    with wave.open(str(source), 'rb') as audio:
        params, data = audio.getparams(), audio.readframes(audio.getnframes())
    with wave.open(str(fixture), 'wb') as audio:
        audio.setparams(params)
        audio.writeframes(b'\0' * (params.framerate // 2 * params.nchannels * params.sampwidth))
        audio.writeframes(data)
        audio.writeframes(b'\0' * (params.framerate * 2 * params.nchannels * params.sampwidth))
    summary = dict(base=base, checkout_commit=subprocess.check_output(['git','rev-parse','HEAD'], cwd=root, text=True).strip(),
        started_at_utc=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), warm_runs_planned=args.warm_runs,
        scope='One fixed original synthetic Chinese recording at Chromium microphone boundary; real MediaRecorder, ASR/LLM/Qwen3-TTS and rendered audio playback. Fresh session per round. Single-input repeatability, not language-wide quality or physical microphone acceptance.',
        source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(), samples=[])

    def save() -> None:
        (out / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

    save()
    with sync_playwright() as playwright:
        browser_args = ['--autoplay-policy=no-user-gesture-required',
            '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',f'--use-file-for-fake-audio-capture={fixture}']
        if not args.native_renderer:
            browser_args += ['--use-angle=swiftshader','--enable-unsafe-swiftshader']
        browser = playwright.chromium.launch(executable_path=os.environ.get('CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe'), headless=True,
            args=browser_args)
        summary['browser_version'] = browser.version
        summary['requested_renderer'] = 'native' if args.native_renderer else 'swiftshader'
        page = browser.new_page(viewport={'width':1360,'height':960}, accept_downloads=True)
        page.set_default_timeout(20000)
        active: dict = {}
        responses = []
        page.on('pageerror', lambda error: active.setdefault('page_errors', []).append(str(error)))
        def observe_upload(route):
            request = route.request
            if request.method == 'POST' and urlparse(request.url).path.endswith('/audio'):
                body = request.post_data_buffer
                assert body and body[:4] == b'RIFF'
                (active['folder']/'submitted-pcm.wav').write_bytes(body)
            route.continue_()
        page.route('**/v2/**', observe_upload)
        def observe_response(response):
            if response.request.method == 'POST' and '/v2/' in response.url:
                responses.append((active['folder'], response))
        def save_responses(folder):
            for target, response in responses:
                if target != folder:
                    continue
                try:
                    (folder/'http-stream.ndjson').write_bytes(response.body())
                except Exception as error:
                    (folder/'stream-observation-error.txt').write_text(str(error), encoding='utf-8')
        page.on('response', observe_response)
        try:
            page.goto(base)
            page.wait_for_load_state('networkidle')
            page.get_by_role('status', name='播放状态').filter(has_text='三维头部已就绪').wait_for()
            summary['renderer'] = page.evaluate("""() => {
              const gl=document.querySelector('#avatar').getContext('webgl2');
              const ext=gl?.getExtension('WEBGL_debug_renderer_info');
              return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable';
            }""")
            save()
            page.get_by_text('本地服务连接', exact=True).click()
            page.get_by_label('本地服务地址').fill(base)
            page.evaluate("""() => document.addEventListener('digitalhuman:frame', event => {
              const audio=document.querySelector('audio');
              if(window.captureHead&&!window.speakingHead&&!audio.paused&&audio.currentTime>=.2&&event.detail.weights.jawOpen>.05)
                window.speakingHead=document.querySelector('#avatar').toDataURL('image/png').split(',')[1];
            })""")
            def connect_and_record():
                page.get_by_role('button', name='连接本地服务', exact=True).click()
                page.get_by_role('status', name='对话状态').filter(has_text='已连接').wait_for()
                page.get_by_role('button', name='开始发言', exact=True).click()
                page.get_by_role('status', name='对话状态').filter(has_text='正在录音').wait_for()
                page.wait_for_timeout((params.nframes/params.framerate+1.15)*1000)
                page.get_by_role('button', name='结束发言', exact=True).click()

            def download_record(folder):
                page.get_by_text('播放记录', exact=True).click()
                with page.expect_download() as downloaded:
                    page.locator('#download').click()
                downloaded.value.save_as(folder/'playback.json')
                page.get_by_text('播放记录', exact=True).click()
                return json.loads((folder/'playback.json').read_text(encoding='utf-8'))

            for index in range(args.warm_runs+1):
                folder = out / ('cold-inference' if index==0 else f'warm-{index:02d}')
                folder.mkdir()
                active.clear(); active.update(folder=folder, page_errors=[])
                page.evaluate('(capture) => {window.captureHead=capture;window.speakingHead=null;}', index in (0,1,args.warm_runs))
                sample = dict(index=index, phase='cold-inference' if index==0 else 'warm', success=False)
                try:
                    connect_and_record()
                    page.get_by_role('status', name='对话状态').filter(has_text=re.compile('回复播放完成|回复失败')).wait_for(timeout=180000)
                    status = page.locator('#voice-status').inner_text()
                    assert '回复播放完成' in status, status
                    record = download_record(folder)
                    assert len(record['segments']) in (1,2,3)
                    assert [segment['segment_index'] for segment in record['segments']]==list(range(len(record['segments'])))
                    response = record['response']
                    assert len(response['reply'])<=80 and response['status']=='ok'
                    assert response['user_emotion']=='sadness'
                    transcript = page.get_by_label('语音转写',exact=True).inner_text()
                    assert '小林' in transcript and '难过' in transcript, transcript
                    assert record['frames'] and all(frame['utterance_id']==response['utterance_id'] and frame['session_epoch']==response['session_epoch'] for frame in record['frames'])
                    assert record['frames'][-1]['weights']['jawOpen']==0
                    assert any(frame['weights']['jawOpen']>.05 for frame in record['frames'])
                    for segment in record['segments']:
                        fetched = page.request.get(base+segment['audio']['url'])
                        assert fetched.status==200
                        path = folder/f"segment-{segment['segment_index']}.wav"
                        path.write_bytes(fetched.body())
                        with wave.open(str(path),'rb') as audio:
                            assert audio.getnframes()>0 and any(audio.readframes(audio.getnframes()))
                    assert not active['page_errors'], active['page_errors']
                    client = record['client_timings_ms']
                    assert client['first_reply_activity_ms'] is not None
                    sample.update(success=True,session_id=response['session_id'],utterance_id=response['utterance_id'],reply=response['reply'],transcript=transcript,
                        reply_characters=len(response['reply']),frames=len(record['frames']),segments=len(record['segments']),
                        server_timings_ms=record['server_timings_ms'],client_timings_ms=client,
                        audio_duration_ms=sum(s['audio']['duration_ms'] for s in record['segments']),
                        segment_rtf=[s['synth_ms']/s['audio']['duration_ms'] for s in response['audio_segments']])
                    if index in (0,1,args.warm_runs):
                        page.screenshot(path=str(folder/'completed-page.png'), full_page=True)
                        png = page.evaluate('window.speakingHead')
                        if png: (folder/'speaking-head.png').write_bytes(base64.b64decode(png))
                except Exception as error:
                    sample['error'] = str(error)
                    page.screenshot(path=str(folder/'failure-page.png'), full_page=True)
                    try: page.get_by_role('button', name='停止', exact=True).click(timeout=2000)
                    except Exception: pass
                summary['samples'].append(sample)
                save_responses(folder)
                save()
                print(json.dumps(sample, ensure_ascii=False), flush=True)

            # Real playback interruption, kept separately from latency samples.
            folder = out/'stop'; folder.mkdir()
            active.clear(); active.update(folder=folder,page_errors=[])
            page.evaluate("""() => document.querySelector('audio').addEventListener('playing', () => {
              const audio=document.querySelector('audio');window.stopObservation={requested:performance.now()};
              audio.addEventListener('pause',()=>window.stopObservation.paused=performance.now(),{once:true});
              document.querySelector('#stop').click();
            },{once:true})""")
            connect_and_record()
            page.get_by_role('status',name='对话状态').filter(has_text='旧结果已失效').wait_for(timeout=180000)
            page.wait_for_function('() => window.stopObservation?.paused')
            stop = page.evaluate('window.stopObservation')
            stop['software_stop_ms'] = stop['paused']-stop['requested']
            record = download_record(folder)
            stop['expired_audio_http'] = page.request.get(base+record['segments'][0]['audio']['url']).status
            page.wait_for_timeout(6000)
            stop['remained_stopped'] = page.locator('#audio').evaluate('(audio)=>audio.paused') and page.locator('#play').is_disabled()
            assert stop['remained_stopped'] and stop['expired_audio_http']==410 and stop['software_stop_ms']<=500
            summary['stop'] = stop
            save_responses(folder)
            warm = [sample for sample in summary['samples'] if sample['phase']=='warm']
            summary['warm_successes'] = sum(sample['success'] for sample in warm)
            if all(sample['success'] for sample in warm):
                def percentile(values, fraction):
                    return sorted(values)[max(0,math.ceil(len(values)*fraction)-1)]
                summary['warm_percentiles_ms'] = {metric:{'p50':percentile([sample['client_timings_ms'][metric] for sample in warm],.5),
                    'p95':percentile([sample['client_timings_ms'][metric] for sample in warm],.95)} for metric in ['first_audio_start_ms','first_reply_activity_ms','total_playback_ms','generation_done_observed_ms']}
            summary['finished_at_utc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
            save()
            print('BENCHMARK COMPLETE', json.dumps({k:v for k,v in summary.items() if k not in ('samples','scope')},ensure_ascii=False),flush=True)
        finally:
            save()
            browser.close()


if __name__=='__main__':
    main()
