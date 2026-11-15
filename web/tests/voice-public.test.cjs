const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { publicBrowser } = require('./browser-fixture.cjs');
let browser, baseURL, close;
const api = 'http://127.0.0.1:18000';
const sid = 'service-session', uid = 'service-utterance';
function wav() {
  const rate=16000, length=rate*2.3, b=Buffer.alloc(44+length*2);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(length*2,40);
  for(let i=0;i<length;i++) {const t=i/rate;b.writeInt16LE(t<.6||t>=1.4&&t<2?Math.round(9000*Math.sin(2*Math.PI*220*t)):0,44+i*2);}
  return b;
}
function result(style='gentle', epoch=0) { return {type:'response',state:'ready',status:'ok',session_id:sid,session_epoch:epoch,utterance_id:uid,user_emotion:'sadness',reply:'听起来你很失落，我愿意听你说。',expression_intent:{style,intensity:.8},audio:{url:`/v1/sessions/${sid}/turns/${uid}/audio`,mime_type:'audio/wav',sample_rate_hz:16000,channels:1,duration_ms:2300}}; }
async function setup(handlers={}) {
 const page=await browser.newPage({viewport:{width:1100,height:1100},acceptDownloads:true});page.setDefaultTimeout(6000);
 await page.route(api+'/**', async route=>{
  const url=new URL(route.request().url()), p=url.pathname;
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(handlers.handle && await handlers.handle(route,json,p)) return;
  if(p==='/v1/sessions') return json({session_id:sid,session_epoch:0,state:'idle'});
  if(p.endsWith('/text')) return json(result(handlers.style));
  if(p.endsWith('/audio')) return route.fulfill({status:200,contentType:'audio/wav',body:wav()});
  if(p.endsWith('/stop')) return json({session_id:sid,session_epoch:1,state:'stopped'});
  return json({session_id:sid,session_epoch:0,state:'generating'});
 });
 await page.goto(baseURL);await page.getByRole('status',{name:'播放状态'}).filter({hasText:/三维头部已就绪/}).waitFor();
 await page.evaluate(()=>document.addEventListener('digitalhuman:frame',event=>{const audio=document.querySelector('audio');if(!audio.paused&&event.detail.weights.jawOpen>0)window.observedVoiceFrame=event.detail;if(audio.currentTime>=.85&&audio.currentTime<1.2)window.observedPauseFrame=event.detail;}));
 return page;
}
async function connect(page){await page.getByRole('button',{name:'连接本地服务',exact:true}).click();await page.getByRole('status',{name:'对话状态'}).filter({hasText:/已连接/}).waitFor();}
async function send(page){await page.getByLabel('输入中文').fill('我今天考试没考好，很难过。');await page.getByRole('button',{name:'发送并播放回复'}).click();}
before(async()=>{({browser,baseURL,close}=await publicBrowser(path.resolve(__dirname,'..')));await fs.mkdir(path.resolve(__dirname,'../../artifacts/solid-head'),{recursive:true});});
after(async()=>{await close?.();});
test('Chinese text returns readable reply, real audio and visible face with server-linked playback frames',async()=>{
 const page=await setup();
 // Capture actual rendered pixels synchronously at the documented frame event.
 // A protocol screenshot may complete after the short fixture has changed phase.
 await page.evaluate(()=>{
   window.cadencePixels={};
   const observe=()=>{
     const audio=document.querySelector('audio'),canvas=document.querySelector('#avatar'),t=audio.currentTime;
     const key=t>=.2&&t<=.5?'speaking':t>=.85&&t<=1.15?'pause':null;
     if(key&&!window.cadencePixels[key]){
       const image=document.createElement('canvas');image.width=canvas.width;image.height=canvas.height;
       image.getContext('2d').drawImage(canvas,0,0);
       window.cadencePixels[key]={audio_time_s:t,png:image.toDataURL('image/png').split(',')[1]};
     }
     if(window.cadencePixels.speaking&&window.cadencePixels.pause)document.removeEventListener('digitalhuman:frame',observe);
   };
   document.addEventListener('digitalhuman:frame',observe);
 });
 await connect(page);await send(page);
 await page.getByRole('status',{name:'对话状态'}).filter({hasText:/正在播放/}).waitFor();
 assert.match(await page.getByLabel('数字人回复').textContent(),/我愿意听你说/);
 assert.match(await page.getByLabel('用户文本情绪').textContent(),/悲伤/);
 assert.match(await page.getByLabel('数字人表达').textContent(),/温和关切/);
 await page.waitForFunction(()=>window.cadencePixels.speaking&&window.cadencePixels.pause);
 const rendered=await page.evaluate(()=>window.cadencePixels);
 const speaking=Buffer.from(rendered.speaking.png,'base64'),pause=Buffer.from(rendered.pause.png,'base64');
 assert.notDeepEqual(speaking,pause);
 await fs.writeFile(path.resolve(__dirname,'../../artifacts/solid-head/frame-pixel-timing.json'),JSON.stringify({speaking_s:rendered.speaking.audio_time_s,pause_s:rendered.pause.audio_time_s},null,2));
 await fs.writeFile(path.resolve(__dirname,'../../artifacts/ticket-03-speaking.png'),speaking);await fs.writeFile(path.resolve(__dirname,'../../artifacts/ticket-03-pause.png'),pause);
 await page.getByRole('status',{name:'对话状态'}).filter({hasText:/回复播放完成/}).waitFor();
 await page.getByText('播放记录',{exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'下载播放记录'}).click();const download=await downloading;
 const record=JSON.parse(await fs.readFile(await download.path(),'utf8'));await fs.writeFile(path.resolve(__dirname,'../../artifacts/ticket-03-playback.json'),JSON.stringify(record,null,2));
 assert.equal(record.session_id,sid);assert.equal(record.response.user_emotion,'sadness');assert.equal(record.response.expression_intent.style,'gentle');assert.ok(record.frames.length>15);
 assert.ok(record.frames.every(f=>f.utterance_id===uid&&f.session_epoch===0));assert.ok(record.frames.some(f=>f.weights.smile>0));assert.ok(record.frames.some(f=>f.weights.jawOpen>.4));
 assert.ok(record.frames.filter(f=>f.audio_time_ms>800&&f.audio_time_ms<1200).every(f=>f.weights.jawOpen===0));assert.equal(record.frames.at(-1).weights.jawOpen,0);
 await page.close();
});
test('invalid model output cannot become a successful spoken reply',async()=>{
 const page=await setup({handle:async(route,json,p)=>{if(!p.endsWith('/text'))return false;const bad=result();bad.expression_intent={style:'sadness',intensity:2};await json(bad);return true;}});
 await connect(page);await send(page);
 await page.getByRole('status',{name:'对话状态'}).filter({hasText:/回复失败/}).waitFor();
 assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);
 assert.equal(await page.getByRole('button',{name:'播放音频',exact:true}).isDisabled(),true);
 await page.close();
});
test('silent service WAV is an audio failure rather than a completed reply',async()=>{
 const page=await setup({handle:async(route,json,p)=>{if(!p.endsWith('/audio'))return false;const silent=wav();silent.fill(0,44);await route.fulfill({status:200,contentType:'audio/wav',body:silent});return true;}});
 await connect(page);await send(page);await page.getByRole('status',{name:'对话状态'}).filter({hasText:/回复失败/}).waitFor();
 assert.equal(await page.getByRole('button',{name:'播放音频',exact:true}).isDisabled(),true);assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);await page.close();
});
test('late rejected device acknowledgement cannot fail replay of the same server utterance',async()=>{
 const page=await setup();await page.addInitScript(()=>{});
 // The only replacement is the external media-device acknowledgement. Real audio still plays.
 await page.evaluate(()=>{const real=HTMLMediaElement.prototype.play;let first=true;HTMLMediaElement.prototype.play=function(){const ack=real.call(this);if(!first)return ack;first=false;return ack.then(()=>new Promise((_,reject)=>setTimeout(()=>{window.lateRejected=true;reject(Error('late device error'));},3500)));};document.addEventListener('digitalhuman:frame',event=>{const audio=document.querySelector('audio');if(window.lateRejected&&audio.currentTime>=1.4&&audio.currentTime<2&&!audio.paused)window.replayObservation={status:document.querySelector('#voice-status').textContent,mouth:event.detail.weights.jawOpen};});});
 await connect(page);await send(page);await page.getByRole('status',{name:'对话状态'}).filter({hasText:/回复播放完成/}).waitFor();
 await page.getByRole('button',{name:'播放音频',exact:true}).click();await page.waitForFunction(()=>window.replayObservation);
 const observed=await page.evaluate(()=>window.replayObservation);assert.match(observed.status,/正在播放/);assert.ok(observed.mouth>.4);
 await page.close();
});
for (const boundary of ['text','audio']) for (const lateStatus of [200,502]) {
 test(`Stop discards late ${boundary} HTTP ${lateStatus} and permits a new server epoch`,async()=>{
  let release, started, epoch=0, first=true;
  const gate=new Promise(r=>release=r), requested=new Promise(r=>started=r);
  const page=await setup({handle:async(route,json,p)=>{
   if(p.endsWith('/stop')){epoch=1;await json({session_id:sid,session_epoch:1,state:'stopped'});return true;}
   if(p.endsWith('/'+boundary)&&first){first=false;started();await gate;if(lateStatus===502)await json({code:'model_failure',message:'old failed'},502);else if(boundary==='text')await json(result());else await route.fulfill({status:200,contentType:'audio/wav',body:wav()});return true;}
   if(p.endsWith('/text')){const request=route.request().postDataJSON();assert.equal(request.session_epoch,epoch);await json(result('gentle',epoch));return true;}
  }});
  await connect(page);await send(page);await requested;
  await page.getByRole('button',{name:'停止',exact:true}).click();await page.getByRole('status',{name:'对话状态'}).filter({hasText:/旧结果已失效/}).waitFor();
  release();await page.waitForTimeout(250);assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);assert.match(await page.getByRole('status',{name:'对话状态'}).textContent(),/已停止/);
  await send(page);await page.waitForFunction(({uid,epoch})=>{try{const frame=JSON.parse(document.querySelector('#frame').textContent);return frame.utterance_id===uid&&frame.session_epoch===epoch&&frame.frame_id>0;}catch{return false;}},{uid,epoch:1});
  const frame=JSON.parse(await page.locator('#frame').textContent());assert.equal(frame.session_epoch,1);assert.equal(frame.utterance_id,uid);await page.close();
 });
}

for (const source of ['sample','file']) {
 test('Local '+source+' during an unconfirmed Stop requires reconnect and cannot revive old audio',async()=>{
  let release, stopped, epoch=0;
  const gate=new Promise(r=>release=r), requested=new Promise(r=>stopped=r);
  const page=await setup({handle:async(route,json,p)=>{
   if(p==='/v1/sessions'){epoch=0;await json({session_id:sid,session_epoch:0,state:'idle'});return true;}
   if(p.endsWith('/stop')){epoch=1;stopped();await gate;await json({session_id:sid,session_epoch:1,state:'stopped'});return true;}
   if(p.endsWith('/text')){
    if(route.request().postDataJSON().session_epoch!==epoch){await json({code:'stale_epoch',message:'session epoch is stale'},409);return true;}
    await json(result('gentle',epoch));return true;
   }
  }});
  try {
   await connect(page);await page.evaluate(()=>document.querySelector('audio').addEventListener('playing',()=>document.querySelector('#stop').click(),{once:true}));await send(page);await requested;
   if(source==='sample')await page.getByRole('button',{name:'载入中文录音示例'}).click();
   else await page.getByLabel('选择本地音频').setInputFiles({name:'local.wav',mimeType:'audio/wav',buffer:wav()});
   await page.getByRole('status',{name:'播放状态'}).filter({hasText:/音频已就绪/}).waitFor();
   assert.equal(await page.getByRole('button',{name:'发送并播放回复'}).isDisabled(),true);
   assert.match(await page.getByRole('status',{name:'对话状态'}).textContent(),/重新连接/);
   assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);
   release();await page.waitForTimeout(250);
   assert.equal(await page.getByRole('button',{name:'发送并播放回复'}).isDisabled(),true);
   assert.match(await page.getByRole('status',{name:'对话状态'}).textContent(),/重新连接/);
   assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);
   await page.evaluate(()=>{window.localReplayObserved=false;const audio=document.querySelector('audio');audio.addEventListener('timeupdate',()=>{if(audio.currentTime>=.1&&!audio.paused)window.localReplayObserved=true;});});
   await page.getByRole('button',{name:'播放音频',exact:true}).click();await page.waitForFunction(()=>window.localReplayObserved);
   assert.equal(await page.evaluate(()=>window.localReplayObserved),true);
   await connect(page);await send(page);await page.waitForFunction(uid=>window.observedVoiceFrame?.utterance_id===uid,uid);
   assert.match(await page.getByLabel('数字人回复').textContent(),/我愿意听你说/);
  } finally { release();await page.close(); }
 });
}

test('Invalid reconnect address disables the old session until a valid reconnect succeeds',async()=>{
 const page=await setup();
 try {
  await connect(page);await page.getByText('本地服务连接',{exact:true}).click();
  await page.getByLabel('本地服务地址').fill('not a local URL');
  await page.getByRole('button',{name:'连接本地服务',exact:true}).click();
  await page.getByRole('status',{name:'对话状态'}).filter({hasText:/连接失败/}).waitFor();
  assert.equal(await page.getByRole('button',{name:'发送并播放回复'}).isDisabled(),true);
  assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);
  await page.getByLabel('本地服务地址').fill(api);await connect(page);await send(page);
  await page.waitForFunction(uid=>window.observedVoiceFrame?.utterance_id===uid,uid);
  assert.match(await page.getByLabel('数字人回复').textContent(),/我愿意听你说/);
 } finally { await page.close(); }
});

test('Stop failure leaves actual audio stopped and requires reconnect before a new turn',async()=>{
 const page=await setup({handle:async(route,json,p)=>{if(!p.endsWith('/stop'))return false;await json({code:'unavailable',message:'service unavailable'},503);return true;}});
 await connect(page);await send(page);await page.waitForFunction(()=>document.querySelector('audio').currentTime>=.2);
 await page.getByRole('button',{name:'停止',exact:true}).click();await page.getByRole('status',{name:'对话状态'}).filter({hasText:/停止失败/}).waitFor();
 assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);assert.equal(await page.getByLabel('嘴部开合').textContent(),'0.00');assert.equal(await page.getByRole('button',{name:'发送并播放回复'}).isDisabled(),true);
 await page.waitForTimeout(350);assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);await connect(page);await send(page);await page.getByRole('status',{name:'对话状态'}).filter({hasText:/正在播放/}).waitFor();await page.close();
});

for (const failure of ['gpu_busy','model_failure','corrupt_audio','missing_audio','foreign_audio','wrong_epoch','fallback']) {
 test(`${failure} is visible and never enables a successful reply`,async()=>{
  const page=await setup({handle:async(route,json,p)=>{
   if(p.endsWith('/text')){
    if(['gpu_busy','model_failure'].includes(failure)){await json({code:failure,message:'模型阶段失败'},failure==='gpu_busy'?409:502);return true;}
    const answer=result();if(failure==='foreign_audio')answer.audio.url='https://external.invalid/cloud.wav';if(failure==='wrong_epoch')answer.session_epoch=4;if(failure==='fallback')answer.status='fallback';await json(answer);return true;
   }
   if(p.endsWith('/audio')&&failure==='corrupt_audio'){await route.fulfill({status:200,contentType:'audio/wav',body:'not WAV'});return true;}
   if(p.endsWith('/audio')&&failure==='missing_audio'){await json({code:'expired',message:'expired'},410);return true;}
  }});
  const foreign=[];page.on('request',r=>{if(!r.url().startsWith(baseURL)&&!r.url().startsWith(api)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))foreign.push(r.url());});
  await connect(page);await send(page);await page.getByRole('status',{name:'对话状态'}).filter({hasText:/回复失败/}).waitFor();
  assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);assert.equal(await page.getByRole('button',{name:'播放音频',exact:true}).isDisabled(),true);assert.deepEqual(foreign,[]);await page.close();
 });
}

for(const style of ['cheerful','calm','serious']){
 test(`${style} uses the documented real face channels independently of sadness`,async()=>{
  const page=await setup({style});await connect(page);await send(page);await page.waitForFunction(()=>window.observedPauseFrame);
  const frame=await page.evaluate(()=>window.observedPauseFrame);assert.equal(frame.weights.jawOpen,0);assert.equal(frame.weights.smile,style==='cheerful'?.68:0);
  assert.match(await page.getByLabel('用户文本情绪').textContent(),/悲伤/);assert.match(await page.getByLabel('数字人表达').textContent(),style==='cheerful'?/轻快友善/:style==='calm'?/平静清晰/:/认真沉稳/);
  await page.getByLabel('三维数字人头部').screenshot({path:path.resolve(__dirname,`../../artifacts/ticket-03-${style}.png`)});await page.close();
 });
}
