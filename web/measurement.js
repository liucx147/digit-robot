// Public measurement page: observes the real page/canvas/audio, never controller weights.
const $ = selector => document.querySelector(selector);
const iframe = $('#product');
let frozen, ledgerBytes, ledgerHash, fixtureFile, graphContext, elementSource;
let recorder, captureStream, recordingDestination, analyser, analysisSource, silentGain;
let chunks = [], recording = false, maxRms = 0, startedAt = 0, complete = false;
let rawMedia, manifest, loadedManifest, loadedMedia, mediaURL, framePTS = null, inputLock, playbackIntegrity, releasePlaybackGuard;
const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2,'0')).join('');
function status(message, failed = false) {$('#capture-status').textContent = message;$('#capture-status').classList.toggle('error',failed);}
function download(bytes, name, type) {const url=URL.createObjectURL(new Blob([bytes],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function jsonDownload(value,name) {download(JSON.stringify(value,null,2)+'\n',name,'application/json');}
async function waitUntil(predicate, message) {const deadline=performance.now()+20000;while(!predicate()){if(performance.now()>deadline)throw Error(message);await new Promise(resolve=>setTimeout(resolve,50));}}
function product() {const document=iframe.contentDocument;const audio=document?.querySelector('#audio');const canvas=document?.querySelector('canvas');if(!audio||!canvas)throw Error('实际说话头未加载');return {document,audio,canvas};}
async function loadFrozenInput() {
  const {document,audio}=product();
  const transfer=new DataTransfer();transfer.items.add(fixtureFile);
  const input=document.querySelector('#audio-file');input.files=transfer.files;
  const change=()=>input.dispatchEvent(new Event('change',{bubbles:true}));
  if(inputLock)inputLock.allow(change);else change();
  await waitUntil(()=>!document.querySelector('#play').disabled&&audio.readyState>=1,'固定音频无法加载');
  const bytes=await (await fetch(audio.currentSrc)).arrayBuffer();
  if(await sha256(bytes)!==frozen.fixture.sha256)throw Error('实际播放输入与固定音频不符');
  if(Math.abs(audio.duration*1000-frozen.fixture.duration_ms)>1||audio.currentTime!==0)throw Error('固定音频未从起点就绪');
}
$('#prepare').addEventListener('click',async()=>{
  try {
    $('#prepare').disabled=true;status('核对固定音频与事件表…');
    await waitUntil(()=>iframe.contentDocument?.querySelector('#sample')?.disabled===false,'说话头资源未就绪');
    const [ledgerResponse,audioResponse]=await Promise.all([fetch('./measurement-fixtures/mandarin40/ledger.json'),fetch('./measurement-fixtures/mandarin40/fixture.wav')]);
    if(!ledgerResponse.ok||!audioResponse.ok)throw Error('冻结资源缺失');
    ledgerBytes=await ledgerResponse.arrayBuffer();ledgerHash=await sha256(ledgerBytes);frozen=JSON.parse(new TextDecoder().decode(ledgerBytes));
    const bytes=await audioResponse.arrayBuffer();if(await sha256(bytes)!==frozen.fixture.sha256)throw Error('固定音频哈希不符');
    fixtureFile=new File([bytes],'mandarin40.wav',{type:'audio/wav'});
    await loadFrozenInput();
    $('#record-graph').disabled=false;$('#record-display').disabled=false;status(`${frozen.events.length} 个固定事件已就绪。请记录运行条件后采集。`);
  }catch(error){status(`准备失败：${error.message}`,true);}finally{$('#prepare').disabled=false;}
});
function lockProductInput() {
  const {document}=product();
  const controls=['#audio-file','#sample','#play','#stop'].map(selector=>document.querySelector(selector));
  let allowed=false, playbackStates;
  const block=event=>{if(!allowed&&controls.includes(event.target)){event.preventDefault();event.stopImmediatePropagation();}};
  for(const type of ['click','change'])document.addEventListener(type,block,true);
  const original=controls.slice(0,2).map(control=>control.disabled);
  return {
    allow(action){allowed=true;try{return action();}finally{allowed=false;}},
    disable(){playbackStates??=controls.slice(2).map(control=>control.disabled);controls.forEach(control=>control.disabled=true);},
    release(){if(playbackStates)controls.slice(2).forEach((control,i)=>control.disabled=playbackStates[i]);for(const type of ['click','change'])document.removeEventListener(type,block,true);controls.slice(0,2).forEach((control,i)=>control.disabled=original[i]);}
  };
}
function guardFrozenPlayback(audio) {
  const source=audio.currentSrc;
  let played=false, advanced=false;
  const handlers={
    play:()=>{if(played)finishCapture(false,'replay');played=true;},
    timeupdate:()=>{if(audio.currentTime>.05)advanced=true;},
    seeking:()=>{if(advanced||audio.currentTime>.001)finishCapture(false,'seek');},
    pause:()=>{if(!audio.ended)finishCapture(false,'pause');},
    ratechange:()=>{if(audio.playbackRate!==1)finishCapture(false,'playback-rate');},
    emptied:()=>finishCapture(false,'source-changed'),
    loadstart:()=>finishCapture(false,'source-changed'),
    error:()=>finishCapture(false,'media-error')
  };
  for(const [type,handler] of Object.entries(handlers))audio.addEventListener(type,handler);
  playbackIntegrity={status:'valid',fixture_verified_sha256:frozen.fixture.sha256,start_time_ms:audio.currentTime*1000};
  return {source,release:()=>{for(const [type,handler] of Object.entries(handlers))audio.removeEventListener(type,handler);}};
}
function meter() {
  if(!recording)return;
  const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);
  const rms=Math.sqrt(pcm.reduce((sum,v)=>sum+v*v,0)/pcm.length);maxRms=Math.max(maxRms,rms);
  requestAnimationFrame(meter);
}
function finishCapture(finished=false, reason=null) {
  if(!recording)return;
  if(reason)playbackIntegrity={...playbackIntegrity,status:'invalid',reason};
  complete=finished&&playbackIntegrity.status==='valid';recording=false;document.body.classList.remove('recording');
  releasePlaybackGuard?.();releasePlaybackGuard=null;
  product().audio.removeEventListener('ended',onEnded);
  inputLock?.release();inputLock=null;
  if(!complete){const stop=product().document.querySelector('#stop');stop.disabled=false;stop.click();}
  if(recorder.state!=='inactive')recorder.stop();
  $('#stop-capture').disabled=true;
}
let verifiedSource;
const onEnded=()=>{const {audio}=product();const valid=audio.ended&&audio.currentSrc===verifiedSource&&audio.playbackRate===1&&Math.abs(audio.duration*1000-frozen.fixture.duration_ms)<1;finishCapture(valid,valid?null:'unexpected-ended');};
async function startCapture(scope) {
  if(recording)return;
  $('#record-graph').disabled=true;$('#record-display').disabled=true;$('#prepare').disabled=true;
  $('#download-media').disabled=true;$('#download-manifest').disabled=true;
  let ownedStream;
  try {
    if(!frozen)throw Error('请先准备固定输入');
    inputLock=lockProductInput();
    const {audio,canvas}=product();
    graphContext ||= new AudioContext();await graphContext.resume();
    analyser=graphContext.createAnalyser();analyser.fftSize=2048;
    if(scope==='browser-graph') {
      if(!canvas.captureStream)throw Error('浏览器不支持画布采集');
      if(!elementSource){elementSource=graphContext.createMediaElementSource(audio);elementSource.connect(graphContext.destination);}
      recordingDestination=graphContext.createMediaStreamDestination();
      elementSource.connect(analyser);analyser.connect(recordingDestination);
      const canvasStream=canvas.captureStream(60);
      ownedStream=new MediaStream([...canvasStream.getVideoTracks(),...recordingDestination.stream.getAudioTracks()]);
    } else {
      if(!navigator.mediaDevices?.getDisplayMedia)throw Error('浏览器不支持窗口采集，请使用安全的本地地址');
      ownedStream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:60},audio:{suppressLocalAudioPlayback:false}});
      if(ownedStream.getVideoTracks().length!==1||ownedStream.getAudioTracks().length!==1)throw Error('必须选择一个视频轨和一个实际声音轨；请勾选共享音频');
      analysisSource=graphContext.createMediaStreamSource(ownedStream);analysisSource.connect(analyser);
      silentGain=graphContext.createGain();silentGain.gain.value=0;analyser.connect(silentGain);silentGain.connect(graphContext.destination);
    }
    if(ownedStream.getAudioTracks().length!==1||ownedStream.getVideoTracks().length!==1||ownedStream.getTracks().some(track=>track.readyState!=='live'))throw Error('音视频轨不可用');
    await loadFrozenInput();
    audio.playbackRate=1;
    inputLock.disable();
    const mime=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime)throw Error('浏览器不支持含声音的 WebM 录制');
    captureStream=ownedStream;chunks=[];maxRms=0;complete=false;startedAt=performance.now();
    recorder=new MediaRecorder(captureStream,{mimeType:mime,videoBitsPerSecond:3000000});
    recorder.addEventListener('dataavailable',event=>{if(event.data.size)chunks.push(event.data);});
    recorder.addEventListener('error',event=>{status(`录制失败：${event.error?.message||'媒体错误'}`,true);finishCapture(false);});
    recorder.addEventListener('stop',async()=>{
      const trackSettings=captureStream.getTracks().map(track=>({kind:track.kind,settings:track.getSettings()}));
      captureStream.getTracks().forEach(track=>track.stop());
      if(elementSource&&recordingDestination){elementSource.disconnect(analyser);recordingDestination=null;}
      analysisSource?.disconnect();analysisSource=null;analyser.disconnect();silentGain?.disconnect();silentGain=null;
      rawMedia=new Blob(chunks,{type:mime});
      manifest={schema:1,scope,media:{path:'capture.webm',sha256:await sha256(await rawMedia.arrayBuffer()),bytes:rawMedia.size,mime},ledger_sha256:ledgerHash,fixture_sha256:frozen.fixture.sha256,expected_events:frozen.events.length,playback_integrity:playbackIntegrity,complete_playback:complete,audio_non_silent:maxRms>.001,audio_max_rms:maxRms,track_settings:trackSettings,viewport:{width:canvas.width,height:canvas.height,device_pixel_ratio:devicePixelRatio},user_agent:navigator.userAgent,revision_and_conditions:$('#revision').value,recorder_elapsed_ms_telemetry:performance.now()-startedAt,calibration:{status:'pending'},acceptance_status:'pending-independent-physical-av',limitations:['Elapsed wall time is telemetry, not media PTS or source origin.','Canvas/audio-graph capture does not measure physical output.','Do not score controller records; independently annotate this original A/V file.']};
      loadedManifest={value:manifest,path:'capture-manifest.json',sha256:await sha256(new TextEncoder().encode(JSON.stringify(manifest,null,2)+'\n'))};
      $('#download-media').disabled=false;$('#download-manifest').disabled=false;$('#record-graph').disabled=false;$('#record-display').disabled=false;$('#prepare').disabled=false;
      $('#capture-summary').textContent=`${rawMedia.size} 字节；${complete?'完整播放':playbackIntegrity.status==='invalid'?'采集失效':'提前结束'}；${manifest.audio_non_silent?'已采到非静音音频图信号':'未采到非静音：无效采集'}。最终物理验收待完成。`;
      const invalid=playbackIntegrity.status==='invalid';
      status(invalid?`采集失效：播放输入或状态已改变（${playbackIntegrity.reason}）。已保留原始音视频，本次不完整。`:manifest.audio_non_silent?'录制已完成。请下载并独立复核原始音视频。':'录制已完成，但没有非静音声音，不能作为有效测量。',invalid||!manifest.audio_non_silent);
    });
    captureStream.getTracks().forEach(track=>track.addEventListener('ended',()=>finishCapture(false),{once:true}));
    const guard=guardFrozenPlayback(audio);verifiedSource=guard.source;releasePlaybackGuard=guard.release;
    product().audio.addEventListener('ended',onEnded,{once:true});
    iframe.scrollIntoView({block:'start'});
    canvas.scrollIntoView({block:'center'});
    recording=true;document.body.classList.add('recording');recorder.start(1000);meter();$('#stop-capture').disabled=false;
    const play=product().document.querySelector('#play');play.disabled=false;inputLock.allow(()=>play.click());inputLock.disable();status('正在录制真实画布与声音，请保持页面可见。');
  }catch(error){releasePlaybackGuard?.();releasePlaybackGuard=null;inputLock?.release();inputLock=null;ownedStream?.getTracks().forEach(track=>track.stop());if(elementSource&&recordingDestination){try{elementSource.disconnect(analyser);}catch{}recordingDestination=null;}analysisSource?.disconnect();analysisSource=null;analyser?.disconnect();silentGain?.disconnect();silentGain=null;recording=false;$('#record-graph').disabled=false;$('#record-display').disabled=false;$('#prepare').disabled=false;status(`采集失败：${error.message}`,true);}
}
$('#record-graph').addEventListener('click',()=>startCapture('browser-graph'));
$('#record-display').addEventListener('click',()=>startCapture('browser-output'));
$('#stop-capture').addEventListener('click',()=>finishCapture(false));
$('#download-media').addEventListener('click',()=>download(rawMedia,'capture.webm',rawMedia.type));
$('#download-manifest').addEventListener('click',()=>jsonDownload(manifest,'capture-manifest.json'));
const video=$('#review-video'),reviewCanvas=$('#review-canvas');
function presented(now,metadata){framePTS=metadata.mediaTime;$('#frame-pts').textContent=framePTS.toFixed(6);video.requestVideoFrameCallback(presented);}
if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(presented);
$('#manifest-file').addEventListener('change',async()=>{
  try {
    const file=$('#manifest-file').files[0];if(!file)return;
    const bytes=await file.arrayBuffer();const value=JSON.parse(new TextDecoder().decode(bytes));
    if(value.schema!==1||!value.media?.sha256||!value.ledger_sha256)throw Error('采集清单格式不符');
    loadedManifest={value,path:file.name,sha256:await sha256(bytes)};
    $('#scope').value=value.scope;
    $('#review-status').textContent='已载入原始采集清单。生成模板时会核对媒体和事件表哈希。';
  }catch(error){loadedManifest=null;$('#review-status').textContent=`清单读取失败：${error.message}`;}
});
$('#review-file').addEventListener('change',async()=>{
  loadedMedia=$('#review-file').files[0];if(!loadedMedia)return;
  if(mediaURL)URL.revokeObjectURL(mediaURL);mediaURL=URL.createObjectURL(loadedMedia);video.src=mediaURL;framePTS=null;
  $('#review-status').textContent='正在读取原始媒体…';
  video.onloadedmetadata=()=>{if(Number.isFinite(video.duration))$('#duration').value=video.duration*1000;$('#review-status').textContent='已载入原始音视频。请核对声音、媒体时长与原始时间轴。';$('#seek').disabled=false;$('#save-frame').disabled=false;$('#template').disabled=!frozen;$('#download-annotations').disabled=!frozen;makeTemplate();};
  video.onerror=()=>{$('#review-status').textContent='媒体解码失败。保留原始文件，不能使用此采集评分。';$('#template').disabled=true;$('#download-annotations').disabled=true;};
});
$('#seek').addEventListener('click',()=>{video.pause();video.currentTime=Number($('#seek-time').value);});
$('#save-frame').addEventListener('click',()=>{if(framePTS===null)return;reviewCanvas.width=video.videoWidth;reviewCanvas.height=video.videoHeight;reviewCanvas.getContext('2d').drawImage(video,0,0);reviewCanvas.toBlob(blob=>download(blob,`frame-pts-${framePTS.toFixed(6)}.png`,'image/png'));});
async function makeTemplate(){
  if(!frozen||!loadedMedia)return;
  const mediaHash=await sha256(await loadedMedia.arrayBuffer());
  const matches=loadedManifest?.value.media.sha256===mediaHash&&loadedManifest.value.ledger_sha256===ledgerHash&&loadedManifest.value.scope===$('#scope').value;
  const value={schema:1,ledger_sha256:ledgerHash,capture_manifest:matches?{path:loadedManifest.path,sha256:loadedManifest.sha256}:null,media:{path:loadedMedia.name,sha256:mediaHash,scope:$('#scope').value,duration_ms:Number($('#duration').value)||null,timebase:'single-media-timeline'},review:{annotator:$('#annotator').value,method:'independent-media-review',audio_basis:'captured-audio',visual_basis:'recorded-pixels'},source_origin_ms:Number($('#origin').value),calibration:{status:'pending'},events:frozen.events.map(event=>({expected_id:event.id,type:event.type,audio_ms:null,visual_ms:null,audio_observation_id:`audio-${event.id}`,visual_observation_id:`pixels-${event.id}`,audio_evidence:'',visual_evidence:'',note:'待独立观察；不要填写源音频或控制器的计划时间'})),unexpected:[]};
  $('#annotations').value=JSON.stringify(value,null,2);
}
$('#template').addEventListener('click',makeTemplate);
$('#download-annotations').addEventListener('click',()=>{try{jsonDownload(JSON.parse($('#annotations').value),'annotations.json');}catch{$('#review-status').textContent='标注 JSON 格式无效，请修正后下载。';}});
window.addEventListener('pagehide',()=>{if(recording){recorder.stop();captureStream.getTracks().forEach(track=>track.stop());}});
