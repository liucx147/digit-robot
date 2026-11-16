const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { publicBrowser } = require('./browser-fixture.cjs');
// Agreed seams: the visible page, HTTP voice API, and browser media devices.
// Device input is a labelled oscillator, never evidence of real speech/ASR quality.
let browser, baseURL, close;
const api = 'http://127.0.0.1:18000', sid = 'microphone-session', uid = 'microphone-utterance';
function wav(leadingSilence=0) {
 const rate=16000, length=Math.round(rate*(2.3+leadingSilence)), b=Buffer.alloc(44+length*2);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(length*2,40);
 for(let i=0;i<length;i++){const t=i/rate-leadingSilence;b.writeInt16LE(t>=0&&(t<.6||t>=1.4&&t<2)?Math.round(9000*Math.sin(2*Math.PI*220*t)):0,44+i*2);}
 return b;
}
function result(epoch=0,leadingSilence=0) {return {type:'response',state:'ready',status:'ok',session_id:sid,session_epoch:epoch,utterance_id:uid,transcript:'我今天考试没考好，很难过。',user_emotion:'sadness',reply:'听起来你很失落，我愿意听你说。',expression_intent:{style:'gentle',intensity:.8},audio:{url:`/v1/sessions/${sid}/turns/${uid}/audio`,mime_type:'audio/wav',sample_rate_hz:16000,channels:1,duration_ms:Math.round((2.3+leadingSilence)*1000)}};}
async function setup(options={}) {
 const page=await browser.newPage({viewport:options.viewport||{width:1100,height:800},acceptDownloads:true});page.setDefaultTimeout(5000);
 const submitted=[];let epoch=0;
 await page.addInitScript(({silent=false,denied=false,rate=48000,deferPermission=false,deferStop=false,deferDecode=false,recordedData=null,unsupported=false}={})=>{
  window.mediaBoundary={streams:[],constraints:[],contexts:[],events:[],cameraStreams:[]};
  if(unsupported)window.MediaRecorder=undefined;
  const deadline=window.setTimeout.bind(window);
  window.setTimeout=(callback,delay,...args)=>{if(delay===30000){window.mediaBoundary.expireRecording=()=>callback(...args);}return deadline(callback,delay,...args);};
  const nativeDecode=AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData=async function(...args){const decoded=await nativeDecode.apply(this,args);if(deferDecode&&this.sampleRate===16000){deferDecode=false;return new Promise(resolve=>window.mediaBoundary.releaseDecode=()=>resolve(decoded));}return decoded;};
  const Recorder=window.MediaRecorder;
  if(Recorder)window.MediaRecorder=class extends Recorder {constructor(...args){super(...args);const add=this.addEventListener.bind(this);this.addEventListener=(type,callback,...rest)=>add(type,type==='stop'&&deferStop?event=>{deferStop=false;window.mediaBoundary.releaseStop=()=>callback(event);}:callback,...rest);if(recordedData)add('dataavailable',event=>Object.defineProperty(event,'data',{value:new Blob([recordedData==='empty'?'':recordedData==='large'?new Uint8Array(6*1024*1024+1):'not an audio recording'])}));this.addEventListener('dataavailable',event=>window.mediaBoundary.events.push({type:'data',size:event.data.size,mime:this.mimeType}));this.addEventListener('start',()=>window.mediaBoundary.events.push({type:'start'}));this.addEventListener('stop',()=>window.mediaBoundary.events.push({type:'stop'}));}};
  navigator.mediaDevices.getUserMedia=async constraints=>{
   window.mediaBoundary.constraints.push(constraints);
   if(constraints.video){const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const draw=()=>{const c=canvas.getContext('2d');c.fillStyle='#506070';c.fillRect(0,0,160,120);};draw();setInterval(draw,80);const stream=canvas.captureStream(15);window.mediaBoundary.cameraStreams.push(stream);return stream;}
   if(denied)throw new DOMException('permission denied','NotAllowedError');
   const context=new AudioContext({sampleRate:rate}), source=context.createOscillator(), gain=context.createGain(), destination=context.createMediaStreamDestination();
   gain.gain.value=silent?0:.25;source.frequency.value=440;source.connect(gain).connect(destination);source.start();await context.resume();
   while(context.currentTime<.1)await new Promise(resolve=>setTimeout(resolve,20));
   window.mediaBoundary.contexts.push(context);window.mediaBoundary.streams.push(destination.stream);
   if(deferPermission){deferPermission=false;await new Promise(resolve=>window.mediaBoundary.releasePermission=resolve);}
   return destination.stream;
  };
 },options.device||{});
 await page.route(api+'/**',async route=>{
  const request=route.request(), p=new URL(request.url()).pathname;
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(options.handle&&await options.handle(route,json,p,submitted))return;
  if(p==='/v1/sessions')return json({session_id:sid,session_epoch:epoch,state:'idle'});
  if(p.endsWith('/stop'))return json({session_id:sid,session_epoch:++epoch,state:'stopped'});
  if(p.endsWith('/audio')&&request.method()==='POST'){submitted.push({headers:request.headers(),body:request.postDataBuffer()});return json(result(epoch,options.leadingSilence));}
  if(p.endsWith('/text'))return json(result(epoch,options.leadingSilence));
  if(p.endsWith('/audio'))return route.fulfill({status:200,contentType:'audio/wav',body:wav(options.leadingSilence)});
  return json({session_id:sid,session_epoch:epoch,state:'generating',utterance_id:uid});
 });
 await page.goto(baseURL);await page.getByRole('status',{name:'播放状态'}).filter({hasText:/三维头部已就绪/}).waitFor();
 return {page,submitted};
}
async function connect(page){await page.getByRole('button',{name:'连接本地服务',exact:true}).click();await page.getByRole('status',{name:'对话状态'}).filter({hasText:/已连接/}).waitFor();}
async function start(page){await page.getByRole('button',{name:'开始发言',exact:true}).click();await page.getByRole('status',{name:'对话状态'}).filter({hasText:/正在录音/}).waitFor();}
async function finish(page){await page.waitForTimeout(350);await page.getByRole('button',{name:'结束发言',exact:true}).click();}
test('occupied microphone explains how to recover and a retry releases its audio track',async()=>{
 const {page,submitted}=await setup();
 try {
  await connect(page);
  await page.evaluate(()=>{window.retryMicrophone=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('DEVICE IN USE','NotReadableError');};});
  await page.locator('#microphone-start').click();
  await page.locator('#voice-status').filter({hasText:/麦克风.*占用/}).waitFor();
  assert.equal(submitted.length,0);
  await page.evaluate(()=>navigator.mediaDevices.getUserMedia=window.retryMicrophone);
  await start(page);
  await page.locator('#stop').click();
  await page.waitForFunction(()=>window.mediaBoundary.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));
  assert.equal(submitted.length,0);
 } finally {await page.close();}
});
before(async()=>{({browser,baseURL,close}=await publicBrowser(path.resolve(__dirname,'..')));await fs.mkdir(path.resolve(__dirname,'../../artifacts'),{recursive:true});});
after(async()=>{await close?.();});
test('a microphone turn posts mono PCM16 WAV and displays ASR text before actual reply playback',async()=>{
 const {page,submitted}=await setup();
 try {
  await connect(page);await start(page);
  assert.equal(await page.getByRole('button',{name:'发送并播放回复'}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'开始发言',exact:true}).isDisabled(),true);
  await finish(page);await page.getByRole('status',{name:'对话状态'}).filter({hasText:/正在播放/}).waitFor();
  assert.match(await page.getByLabel('语音转写').textContent(),/考试没考好/);
  assert.match(await page.getByLabel('数字人回复').textContent(),/我愿意听你说/);
  assert.equal(submitted.length,1);
  const {body,headers}=submitted[0];
  assert.equal(headers['content-type'],'audio/wav');assert.equal(headers['x-session-epoch'],'0');
  assert.equal(body.toString('ascii',0,4),'RIFF');assert.equal(body.toString('ascii',8,12),'WAVE');
  assert.equal(body.readUInt16LE(20),1);assert.equal(body.readUInt16LE(22),1);assert.equal(body.readUInt32LE(24),16000);assert.equal(body.readUInt16LE(34),16);
  assert.ok(body.length>3200&&body.length<=6*1024*1024);assert.ok(body.subarray(44).some(v=>v!==0));
  assert.equal(await page.evaluate(()=>window.mediaBoundary.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);
  assert.deepEqual(await page.evaluate(()=>window.mediaBoundary.constraints),[{audio:true,video:false}]);
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>=.2);
  const frame=JSON.parse(await page.locator('#frame').textContent());assert.equal(frame.utterance_id,uid);assert.equal(frame.session_epoch,0);
  assert.ok(Number(await page.getByLabel('嘴部开合').textContent())>.2);
  await page.getByRole('status',{name:'对话状态'}).filter({hasText:/回复播放完成/}).waitFor();
  assert.equal(await page.getByRole('button',{name:'开始发言',exact:true}).isEnabled(),true);
 } catch(error) {console.error('Device:',await page.evaluate(()=>({events:window.mediaBoundary.events,contexts:window.mediaBoundary.contexts.map(c=>({state:c.state,time:c.currentTime}))})));console.error('Public failure state:',await page.getByRole('status',{name:'对话状态'}).textContent(),await page.getByRole('status',{name:'播放状态'}).textContent());throw error;} finally {await page.close();}
});

test('ASR, generation and synthesis remain visible while waiting; recorded latency starts at End and ends at real media start',async()=>{
 let phase='transcribing',release,requested;const gate=new Promise(r=>release=r),post=new Promise(r=>requested=r);
 const {page}=await setup({handle:async(route,json,p)=>{
  if(p.endsWith('/audio')&&route.request().method()==='POST'){requested();await gate;await json(result());return true;}
  if(p===`/v1/sessions/${sid}`){await json({session_id:sid,session_epoch:0,state:phase,utterance_id:uid});return true;}
 }});
 try {
  await connect(page);await start(page);await finish(page);await post;
  await page.getByRole('status',{name:'对话状态'}).filter({hasText:/正在转写/}).waitFor();
  phase='generating';await page.getByRole('status',{name:'对话状态'}).filter({hasText:/正在生成回复/}).waitFor();
  phase='synthesizing';await page.getByRole('status',{name:'对话状态'}).filter({hasText:/正在合成语音/}).waitFor();
  release();await page.getByRole('status',{name:'对话状态'}).filter({hasText:/正在播放/}).waitFor();
  assert.match(await page.getByLabel('发言响应计时').textContent(),/软件观测.*毫秒/);
  await page.getByText('播放记录',{exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'下载播放记录'}).click();
  const download=await downloading, record=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  await fs.writeFile(path.resolve(__dirname,'../../artifacts/ticket-04-timing.json'),JSON.stringify(record,null,2));
  assert.equal(record.input.source,'microphone');assert.equal(record.input.timing_basis,'browser-performance-and-media-current-time-energy');
  assert.ok(record.input.speech_ended_at_ms>0);assert.ok(record.input.audio_started_at_ms>record.input.speech_ended_at_ms);
  assert.ok(record.input.speech_end_to_audio_start_ms>=400);
  assert.equal(record.response.transcript,'我今天考试没考好，很难过。');
 } finally {release();await page.close();}
});

for (const viewport of [{width:1100,height:680},{width:390,height:740}]) {
 test(`the head keeps a bounded height and active Stop remains visible at ${viewport.width}px`,async()=>{
  let release,requested;const gate=new Promise(r=>release=r),post=new Promise(r=>requested=r);
  const {page}=await setup({viewport,handle:async(route,json,p)=>{if(p.endsWith('/text')){requested();await gate;await json(result());return true;}}});
  try {
   const stage=await page.locator('.stage').boundingBox();assert.ok(stage.height<=540,'controls cannot stretch the head to their full height');
   await connect(page);await page.getByLabel('输入中文').fill('你好');await page.getByRole('button',{name:'发送并播放回复'}).click();await post;
   const stop=page.getByRole('button',{name:'停止',exact:true}), box=await stop.boundingBox();
   assert.equal(await stop.isEnabled(),true);assert.ok(box.y>=0&&box.y+box.height<=viewport.height,'active Stop is in the viewport without another scroll');
   await page.screenshot({path:path.resolve(__dirname,`../../artifacts/ticket-04-layout-${viewport.width}.png`)});
   await stop.click();await page.getByRole('status',{name:'对话状态'}).filter({hasText:/已停止/}).waitFor();
  } finally {release();await page.close();}
 });
}

for (const [name,device,expected] of [
 ['permission denied',{denied:true},/麦克风权限被拒绝/],
 ['unsupported browser',{unsupported:true},/支持 MediaRecorder/],
 ['empty recorder data',{recordedData:'empty'},/录音为空/],
 ['silent microphone',{silent:true},/全静音/],
 ['corrupt recorder format',{recordedData:'corrupt'},/录音转换失败/],
 ['oversized recorder data',{recordedData:'large'},/6 MiB/],
]) {
 test(`${name} is explained without a fabricated successful audio turn`,async()=>{
  const {page,submitted}=await setup({device});
  try {
   await connect(page);await page.getByRole('button',{name:'开始发言',exact:true}).click();
   if(!device.denied&&!device.unsupported){await page.getByRole('status',{name:'对话状态'}).filter({hasText:/正在录音/}).waitFor();if(device.recordedData!=='large')await finish(page);}
   await page.getByRole('status',{name:'对话状态'}).filter({hasText:expected}).waitFor();
   assert.equal(submitted.length,0);assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);assert.equal(await page.getByRole('button',{name:'播放音频',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'开始发言',exact:true}).isEnabled(),true);
   assert.equal(await page.evaluate(()=>window.mediaBoundary.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);
  } finally {await page.close();}
 });
}

test('the 30-second recording deadline visibly cancels and releases the microphone without upload',async()=>{
 const {page,submitted}=await setup();
 try {await connect(page);await start(page);await page.evaluate(()=>window.mediaBoundary.expireRecording());await page.getByRole('status',{name:'对话状态'}).filter({hasText:/最多 30 秒/}).waitFor();assert.equal(submitted.length,0);assert.equal(await page.evaluate(()=>window.mediaBoundary.streams[0].getTracks()[0].readyState),'ended');assert.equal(await page.getByRole('button',{name:'结束发言',exact:true}).isDisabled(),true);}finally{await page.close();}
});

for (const [name,device,releaseName] of [['permission',{deferPermission:true},'releasePermission'],['onstop',{deferStop:true},'releaseStop'],['decode',{deferDecode:true},'releaseDecode']]) {
 test(`global Stop during ${name} discards late device work, releases tracks and permits a new microphone epoch`,async()=>{
  const {page,submitted}=await setup({device});
  try {
   await connect(page);
   if(name==='permission')await page.getByRole('button',{name:'开始发言',exact:true}).click();
   else {await start(page);await finish(page);}
   await page.waitForFunction(key=>typeof window.mediaBoundary[key]==='function',releaseName);
   await page.getByRole('button',{name:'停止',exact:true}).click();await page.getByRole('status',{name:'对话状态'}).filter({hasText:/旧结果已失效/}).waitFor();
   await page.evaluate(key=>window.mediaBoundary[key](),releaseName);
   await page.waitForFunction(()=>window.mediaBoundary.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
   assert.equal(submitted.length,0);assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);
   assert.match(await page.getByRole('status',{name:'对话状态'}).textContent(),/已停止/);
   await start(page);await finish(page);await page.getByRole('status',{name:'对话状态'}).filter({hasText:/正在播放/}).waitFor();
   assert.equal(submitted.length,1);assert.equal(submitted[0].headers['x-session-epoch'],'1');
  }finally{await page.close();}
 });
}

test('global Stop during recording cancels rather than submitting the collected speech',async()=>{
 const {page,submitted}=await setup();
 try {await connect(page);await start(page);await page.getByRole('button',{name:'停止',exact:true}).click();await page.getByRole('status',{name:'对话状态'}).filter({hasText:/旧结果已失效/}).waitFor();assert.equal(submitted.length,0);assert.equal(await page.evaluate(()=>window.mediaBoundary.streams[0].getTracks()[0].readyState),'ended');assert.equal(await page.getByRole('button',{name:'结束发言',exact:true}).isDisabled(),true);}finally{await page.close();}
});

for (const lateStatus of [200,502]) {
 test(`Stop discards microphone POST HTTP ${lateStatus} and its old status while a new recording is active`,async()=>{
  let release,releaseStatus,requested,statusRequested,first=true,firstStatus=true;
  const gate=new Promise(r=>release=r),post=new Promise(r=>requested=r),statusGate=new Promise(r=>releaseStatus=r),statusPost=new Promise(r=>statusRequested=r);
  const {page,submitted}=await setup({handle:async(route,json,p,inputs)=>{
   if(p.endsWith('/audio')&&route.request().method()==='POST'&&first){first=false;inputs.push({headers:route.request().headers(),body:route.request().postDataBuffer()});requested();await gate;await json(lateStatus===200?result():{code:'asr_failed',message:'old ASR failed'},lateStatus);return true;}
   if(p===`/v1/sessions/${sid}`&&firstStatus){firstStatus=false;statusRequested();await statusGate;await json({session_id:sid,session_epoch:0,state:'synthesizing',utterance_id:uid});return true;}
  }});
  try {
   await connect(page);await start(page);await finish(page);await post;await statusPost;
   assert.equal(await page.getByRole('button',{name:'结束发言',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'发送并播放回复'}).isDisabled(),true);
   await page.getByRole('button',{name:'停止',exact:true}).click();await page.getByRole('status',{name:'对话状态'}).filter({hasText:/旧结果已失效/}).waitFor();
   await start(page);release();releaseStatus();await page.waitForTimeout(250);
   assert.match(await page.getByRole('status',{name:'对话状态'}).textContent(),/正在录音/);assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);
   await finish(page);await page.getByRole('status',{name:'对话状态'}).filter({hasText:/正在播放/}).waitFor();
   assert.equal(submitted.length,2);assert.equal(submitted[1].headers['x-session-epoch'],'1');
  }finally{release();releaseStatus();await page.close();}
 });
}

for(const [code,message,http] of [['empty_transcript','未得到有效中文文本，未继续生成',422],['stage_timeout','语音转写超时',504],['unsupported_media_type','格式不支持',415]]){
 test(`ASR ${code} stays an explicit failure instead of a spoken success`,async()=>{
  const {page}=await setup({handle:async(route,json,p)=>{if(p.endsWith('/audio')&&route.request().method()==='POST'){await json({type:'error',code,message},http);return true;}}});
  try{await connect(page);await start(page);await finish(page);await page.getByRole('status',{name:'对话状态'}).filter({hasText:new RegExp(code)}).waitFor();assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);assert.equal(await page.getByRole('button',{name:'播放音频',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'开始发言',exact:true}).isEnabled(),true);}finally{await page.close();}
 });
}

test('a nominally successful response with blank ASR text cannot fetch or play the reply audio',async()=>{
 let fetched=false;
 const {page}=await setup({handle:async(route,json,p)=>{
  if(p.endsWith('/audio')&&route.request().method()==='POST'){const answer=result();answer.transcript='   ';await json(answer);return true;}
  if(p.endsWith('/audio')){fetched=true;return false;}
 }});
 try{await connect(page);await start(page);await finish(page);await page.getByRole('status',{name:'对话状态'}).filter({hasText:/未得到有效语音转写/}).waitFor();assert.equal(fetched,false);assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);}finally{await page.close();}
});

test('local audio playback offers no concurrent microphone turn and enables it again after completion',async()=>{
 const {page}=await setup();
 try{await connect(page);await page.getByLabel('选择本地音频',{exact:true}).setInputFiles({name:'local-cadence.wav',mimeType:'audio/wav',buffer:wav()});await page.getByRole('status',{name:'播放状态'}).filter({hasText:/音频已就绪/}).waitFor();await page.getByRole('button',{name:'播放音频',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);assert.equal(await page.getByRole('button',{name:'开始发言',exact:true}).isDisabled(),true);await page.getByRole('status',{name:'播放状态'}).filter({hasText:/播放完成/}).waitFor();assert.equal(await page.getByRole('button',{name:'开始发言',exact:true}).isEnabled(),true);}finally{await page.close();}
});

test('a microphone recording failure releases only audio tracks and leaves camera-only gaze available',async()=>{
 const {page}=await setup();
 try {
  await connect(page);await page.getByRole('button',{name:'开启摄像头注视'}).click();await page.waitForFunction(()=>window.mediaBoundary.cameraStreams.length===1);
  await start(page);await page.evaluate(()=>window.mediaBoundary.expireRecording());await page.getByRole('status',{name:'对话状态'}).filter({hasText:/最多 30 秒/}).waitFor();
  assert.equal(await page.evaluate(()=>window.mediaBoundary.streams[0].getAudioTracks()[0].readyState),'ended');
  assert.equal(await page.evaluate(()=>window.mediaBoundary.cameraStreams[0].getVideoTracks()[0].readyState),'live');
  const constraints=await page.evaluate(()=>window.mediaBoundary.constraints);assert.equal(constraints[0].audio,false);assert.ok(constraints[0].video);assert.deepEqual(constraints[1],{audio:true,video:false});
  await page.getByRole('button',{name:'停止注视',exact:true}).click();assert.equal(await page.evaluate(()=>window.mediaBoundary.cameraStreams[0].getVideoTracks()[0].readyState),'ended');
 }finally{await page.close();}
});

test('a later text turn clears the microphone input timing instead of reusing the previous speech end',async()=>{
 const {page}=await setup();
 try {
  await connect(page);await start(page);await finish(page);
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>=.15);
  await page.getByRole('status',{name:'对话状态'}).filter({hasText:/回复播放完成/}).waitFor();
  assert.match(await page.getByLabel('发言响应计时').textContent(),/软件观测/);
  await page.getByLabel('输入中文').fill('谢谢你，我好一点了。');await page.getByRole('button',{name:'发送并播放回复'}).click();
  await page.getByRole('status',{name:'对话状态'}).filter({hasText:/正在播放/}).waitFor();
  assert.match(await page.getByLabel('发言响应计时').textContent(),/等待本轮发言/);
  await page.getByText('播放记录',{exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'下载播放记录'}).click();const download=await downloading,record=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal('input' in record,false);assert.equal(record.response.transcript,'我今天考试没考好，很难过。');
 }finally{await page.close();}
});

async function timingRecord(page, name) {
 await page.getByText('播放记录',{exact:true}).evaluate(e=>e.parentElement.open=true);
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'下载播放记录'}).click();
 const download=await downloading,record=JSON.parse(await fs.readFile(await download.path(),'utf8'));
 await fs.writeFile(path.resolve(__dirname,`../../artifacts/ticket-04-review-${process.env.TIMING_EVIDENCE||'green'}-${name}.json`),JSON.stringify(record,null,2));
 return record;
}

test('1000 ms leading silence keeps reply activity timing pending until real playback reaches the signal',async()=>{
 const {page}=await setup({leadingSilence:1});
 try {
  await connect(page);await start(page);await finish(page);
  // Freeze the silent media position while comparing the UI and downloaded snapshot.
  await page.waitForFunction(()=>{const audio=document.querySelector('audio');if(audio.currentTime<.15)return false;audio.pause();return true;});
  const silent=await timingRecord(page,'leading-silence-pending');
  assert.equal(silent.input.reply_activity_started_at_ms,null,'file playing must not complete reply activity timing during leading silence');
  assert.equal(silent.input.speech_end_to_reply_activity_ms,null);
  assert.match(await page.getByLabel('发言响应计时').textContent(),/等待回复语音活动/);
  assert.ok(silent.input.audio_started_at_ms>silent.input.speech_ended_at_ms,'raw file-start timing remains available');
  await page.locator('audio').evaluate(a=>a.play());
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>=1.15);
  const active=await timingRecord(page,'leading-silence-active');
  assert.ok(active.input.reply_activity_offset_ms>=1000&&active.input.reply_activity_offset_ms<1020);
  assert.ok(active.input.reply_activity_audio_time_ms>=1000);
  assert.ok(active.input.reply_activity_started_at_ms-active.input.audio_started_at_ms>=900,'real leading silence belongs in response latency');
  assert.ok(active.input.speech_end_to_reply_activity_ms-active.input.speech_end_to_audio_start_ms>=900);
  assert.match(await page.getByLabel('发言响应计时').textContent(),/回复语音活动.*软件观测.*毫秒/);
 }finally{await page.close();}
});

test('paused media and a rejected play acknowledgement leave reply activity pending until an explicit retry',async()=>{
 const {page}=await setup({leadingSilence:1});
 try {
  // Delay/reject only the external device acknowledgement; real playback still runs.
  await page.evaluate(()=>{const play=HTMLMediaElement.prototype.play;let first=true;HTMLMediaElement.prototype.play=function(){const ack=play.call(this);if(!first)return ack;first=false;return ack.then(()=>new Promise((resolve,reject)=>{window.mediaBoundary.rejectPlayback=()=>reject(Error('device did not acknowledge playback'));}));};window.mediaBoundary.resumePlayback=()=>play.call(document.querySelector('audio'));});
  await connect(page);await start(page);await finish(page);
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>=.15);
  await page.locator('audio').evaluate(a=>a.pause());
  await page.waitForTimeout(1150);
  const paused=await timingRecord(page,'paused');assert.equal(paused.input.reply_activity_started_at_ms,null);
  assert.ok(await page.locator('audio').evaluate(a=>a.currentTime<1));
  await page.evaluate(()=>window.mediaBoundary.resumePlayback());
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>=1.15);
  // Keep this same attempt alive while saving evidence; an already ended attempt correctly ignores a late rejection.
  await page.locator('audio').evaluate(a=>a.pause());
  const unacknowledged=await timingRecord(page,'unacknowledged');assert.equal(unacknowledged.input.reply_activity_started_at_ms,null);
  await page.evaluate(()=>window.mediaBoundary.rejectPlayback());
  await page.getByRole('status',{name:'对话状态'}).filter({hasText:/音频播放失败/}).waitFor();
  const failed=await timingRecord(page,'play-failed');assert.equal(failed.input.reply_activity_started_at_ms,null);
  await page.getByRole('button',{name:'播放音频',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>=1.15);
  const retry=await timingRecord(page,'play-retry');assert.ok(retry.input.reply_activity_started_at_ms>failed.input.audio_started_at_ms);
 }finally{await page.close();}
});

for(const next of ['text','microphone']) {
 test(`Stop before reply activity ignores late device acknowledgement and isolates the next ${next} turn`,async()=>{
  const {page}=await setup({leadingSilence:1});
  try {
   await page.evaluate(()=>{const play=HTMLMediaElement.prototype.play;let first=true;HTMLMediaElement.prototype.play=function(){const ack=play.call(this);if(!first)return ack;first=false;return ack.then(()=>new Promise(resolve=>window.mediaBoundary.acknowledgeOldPlayback=resolve));};});
   await connect(page);await start(page);await finish(page);
   await page.waitForFunction(()=>document.querySelector('audio').currentTime>=.15);
   await page.getByRole('button',{name:'停止',exact:true}).click();
   await page.getByRole('status',{name:'对话状态'}).filter({hasText:/旧结果已失效/}).waitFor();
   await page.waitForTimeout(1100);
   const stopped=await timingRecord(page,`cancelled-before-${next}`);assert.equal(stopped.input.reply_activity_started_at_ms,null);
   if(next==='text'){await page.getByLabel('输入中文').fill('谢谢你。');await page.getByRole('button',{name:'发送并播放回复'}).click();}
   else {await start(page);await finish(page);}
   await page.waitForFunction(()=>document.querySelector('audio').currentTime>=.15);
   await page.evaluate(()=>window.mediaBoundary.acknowledgeOldPlayback());
   const pending=await timingRecord(page,`next-${next}-pending`);
   if(next==='microphone'){assert.equal(pending.input.reply_activity_started_at_ms,null);assert.ok(pending.input.speech_ended_at_ms>stopped.input.speech_ended_at_ms);}
   else assert.equal('input' in pending,false);
   await page.waitForFunction(()=>document.querySelector('audio').currentTime>=1.15);
   const current=await timingRecord(page,`next-${next}-active`);assert.equal(current.response.session_epoch,1);
   if(next==='microphone'){assert.ok(current.input.speech_end_to_reply_activity_ms-current.input.speech_end_to_audio_start_ms>=900);assert.equal(current.events.filter(e=>e.type==='reply-activity-start').length,1);}
   else {assert.equal('input' in current,false);assert.match(await page.getByLabel('发言响应计时').textContent(),/等待本轮发言/);}
  }finally{await page.close();}
 });
}

test('replaying the same reply preserves the first file-start and reply-activity observations',async()=>{
 const {page}=await setup();
 try {
  await connect(page);await start(page);await finish(page);
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>=.15);
  await page.getByRole('status',{name:'对话状态'}).filter({hasText:/回复播放完成/}).waitFor();
  const first=await timingRecord(page,'first-complete');assert.ok(first.input.reply_activity_started_at_ms>0);
  await page.getByRole('button',{name:'播放音频',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>=.2);
  const replay=await timingRecord(page,'replay');assert.deepEqual(replay.input,first.input);
  assert.equal(replay.events.filter(e=>e.type==='reply-activity-start').length,0);
 }finally{await page.close();}
});
