const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {publicBrowser}=require('./browser-fixture.cjs');
let app;
const key='digitalhuman.acceptance-journal.v1';
const sha='a'.repeat(40);
before(async()=>{await fs.mkdir(path.resolve(__dirname,'../../artifacts/b-acceptance-journal'),{recursive:true});app=await publicBrowser(path.resolve(__dirname,'..'));});
after(async()=>app.close());
// API tones exercise real HTMLAudio; not real speech/physical acceptance evidence.
function tone(){const rate=16000,n=8000,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=2880;i<n;i++)b.writeInt16LE(Math.round(8000*Math.sin(i/rate*2*Math.PI*220)),44+i*2);return b;}
const sound=tone();
async function setup(options={}){
 const page=options.context?await options.context.newPage():await app.browser.newPage({acceptDownloads:true,viewport:{width:1280,height:1100}});page.setDefaultTimeout(3000);
 if(options.clock)await page.clock.install();
 if(options.noLocks)await page.addInitScript(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:undefined}));
 let epoch=0,sequence=0;
 await page.route('http://127.0.0.1:18000/**',async route=>{
  const request=route.request(),p=new URL(request.url()).pathname;
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(options.handle&&await options.handle(route,json,p))return;
  const session={session_id:'journal-session',session_epoch:epoch,state:'idle',sentence_streaming:!!options.sentences};
  if(p==='/v1/sessions')return json(session);
  if(p.endsWith('/stop')){epoch++;return json({...session,session_epoch:epoch});}
  if(p.endsWith('/text')||request.method()==='POST'&&p.endsWith('/audio')){
   const id='journal-turn-'+(++sequence),common={session_id:'journal-session',session_epoch:epoch,utterance_id:id};
   const metadata={user_emotion:'neutral',expression_intent:{style:'gentle',intensity:.5}};
   const audio=i=>({url:`/${options.sentences?'v2':'v1'}/sessions/journal-session/turns/${id}/${options.sentences?'segments/'+i+'/':''}audio`,mime_type:'audio/wav',duration_ms:500,sample_rate_hz:16000,channels:1});
   if(!options.sentences)return json({...common,...metadata,type:'response',state:'ready',status:'ok',reply:'私密回复标记',transcript:'私密转写标记',audio:audio(0)});
   const lines=[{type:'start'},{type:'meta',...metadata}];
   for(let i=0;i<2;i++)lines.push({type:'sentence',segment_index:i,text:'私密句子。'},{type:'audio_ready',segment_index:i,text:'私密句子。',...metadata,audio:audio(i)});
   lines.push({type:'done',reply:'私密句子。私密句子。',status:'ok',timings_ms:{total_ms:20}});
   return route.fulfill({status:200,contentType:'application/x-ndjson',body:lines.map(x=>JSON.stringify({...common,...x})).join('\n')+'\n'});
  }
  if(p.endsWith('/audio'))return route.fulfill({status:200,contentType:'audio/wav',body:sound});
  return json(session);
 });
 await page.goto(app.baseURL);await page.getByRole('status',{name:'播放状态'}).filter({hasText:'三维头部已就绪'}).waitFor();return page;
}
async function open(page){await page.getByText('验收记录',{exact:true}).click();}
async function start(page){await page.getByLabel('冻结代码 SHA（操作者声明）').fill(sha);await page.getByLabel('运行条件').selectOption('software-test');await page.getByRole('button',{name:'开始本段采集'}).click();await page.waitForFunction(()=>!document.querySelector('#acceptance-start').disabled||!document.querySelector('#acceptance-end').disabled||/容量|保存或记录失败/.test(document.querySelector('#acceptance-status').textContent));}
async function download(page){const d=page.waitForEvent('download');await page.getByRole('button',{name:'下载验收记录'}).click();return JSON.parse(await fs.readFile(await(await d).path(),'utf8'));}
test('journal is collapsed and stores nothing until explicit validated start; export includes actual renderer and declared scope',async()=>{
 const page=await setup();try{
 assert.equal(await page.locator('#acceptance-panel').getAttribute('open'),null);
 assert.equal(await page.evaluate(()=>localStorage.length),0);
 await open(page);await page.getByRole('button',{name:'开始本段采集'}).click();
 assert.equal(await page.evaluate(()=>localStorage.length),0);
 await start(page);const data=await download(page);
 assert.equal(data.segments.length,1);assert.equal(data.segments[0].declared_code_sha,sha);
 assert.equal(data.segments[0].conditions,'software-test');
 await fs.writeFile(path.resolve(__dirname,'../../artifacts/b-acceptance-journal/environment.json'),JSON.stringify({boundary:'software-test-only',collected_utc:new Date().toISOString(),browser_version:app.browser.version(),...data.segments[0].context},null,2));
 assert.match(data.segments[0].context.renderer.renderer,/.+/);
 assert.equal(data.segments[0].context.asset.version,'solid-v1');
 assert.equal(data.segments[0].context.asset.file,undefined);
 assert.equal(data.engineering_acceptance,'not-assessed');
 assert.equal(await page.evaluate(k=>localStorage.getItem(k)!==null,key),true);
 }finally{await page.close();}
});

async function connect(page){await page.locator('#voice-connect').click();await page.locator('#voice-status').filter({hasText:'已连接'}).waitFor();}
async function send(page){await page.getByLabel('输入中文').fill('私密输入标记');await page.locator('#voice-send').click();}
async function finished(page){await page.locator('#voice-status').filter({hasText:'回复播放完成'}).waitFor();}
for(const sentences of [false,true])test(`actual ${sentences?'two sentence':'single reply'} playback counts one full turn, excludes replay and dialogue contents`,async()=>{
 const page=await setup({sentences});try{
 await connect(page);await send(page);await finished(page);assert.equal(await page.evaluate(()=>localStorage.length),0);
 await open(page);await start(page);await send(page);await finished(page);
 let data=await download(page),segment=data.segments[0];
 assert.equal(segment.completed_turns,1);
 assert.deepEqual(segment.events.filter(e=>['attempt-start','input-end','reply-activity','turn-complete'].includes(e.type)).map(e=>e.type),['attempt-start','input-end','reply-activity','turn-complete']);
 const activity=segment.events.find(e=>e.type==='reply-activity');assert.ok(activity.audio_time_ms>=180);
 assert.match(activity.client_turn_id,/.+/);assert.equal(activity.session_id,'journal-session');assert.equal(activity.utterance_id,'journal-turn-2');
 assert.ok(!JSON.stringify(data).includes('私密'));
 if(!sentences){await page.locator('#play').click();await finished(page);data=await download(page);assert.equal(data.segments[0].completed_turns,1);assert.equal(data.segments[0].events.filter(e=>e.type==='turn-complete').length,1);}
 }finally{await page.close();}
});
for(const failure of ['model','media'])test(`${failure} failure is retained without content or completed turn; recovery still records`,async()=>{
 let fail=true;
 const page=await setup({handle:async(route,json,p)=>{if(failure==='model'&&fail&&p.endsWith('/text')){fail=false;await json({message:'私密错误原文',code:'stage_failed'},503);return true;}return false;}});
 try{
 await open(page);await start(page);await connect(page);
 if(failure==='media')await page.evaluate(()=>{const real=HTMLMediaElement.prototype.play;let first=true;HTMLMediaElement.prototype.play=function(){if(first){first=false;return Promise.reject(Error('私密设备错误'));}return real.call(this);};});
 await send(page);await page.locator('#voice-status').filter({hasText:/失败/}).waitFor();
 let data=await download(page);assert.equal(data.segments[0].completed_turns,0);assert.equal(data.segments[0].events.filter(e=>e.type==='failed').length,1);assert.ok(!JSON.stringify(data).includes('私密'));
 await send(page);await finished(page);data=await download(page);assert.equal(data.segments[0].completed_turns,1);assert.equal(data.segments[0].events.filter(e=>e.type==='failed').length,1);
 }finally{await page.close();}
});
test('stop preserves cancelled attempt, ignores late HTTP work and a new turn can complete',async()=>{
 let release,entered,first=true;const gate=new Promise(r=>release=r),requested=new Promise(r=>entered=r);
 const page=await setup({handle:async(route,json,p)=>{if(first&&p.endsWith('/text')){first=false;entered();await gate;try{await json({message:'私密迟到失败'},503);}catch{}return true;}return false;}});
 try{
 await open(page);await start(page);await connect(page);await send(page);await requested;
 await page.locator('#stop').click();await page.locator('#voice-status').filter({hasText:'旧结果已失效'}).waitFor();release();
 await send(page);await finished(page);const data=await download(page),events=data.segments[0].events;
 assert.equal(data.segments[0].completed_turns,1);assert.equal(events.filter(e=>e.type==='cancelled').length,1);assert.equal(events.filter(e=>e.type==='failed').length,0);
 assert.equal(events.filter(e=>e.type==='turn-complete').length,1);assert.notEqual(events.find(e=>e.type==='cancelled').client_turn_id,events.find(e=>e.type==='turn-complete').client_turn_id);
 }finally{release();await page.close();}
});
test('capture joining an in-flight turn cannot claim its completion; local audio is excluded',async()=>{
 const page=await setup();try{
 await connect(page);await send(page);await page.waitForFunction(()=>!document.querySelector('#audio').paused);
 await open(page);await start(page);await finished(page);let data=await download(page);assert.equal(data.segments[0].completed_turns,0);
 await page.locator('#sample').click();await page.locator('#play').click();await page.locator('#status').filter({hasText:'播放完成'}).waitFor();
 data=await download(page);assert.equal(data.segments[0].completed_turns,0);assert.equal(data.segments[0].events.filter(e=>e.type==='turn-complete').length,0);
 }finally{await page.close();}
});
test('reload preserves interrupted draft without auto capture; manual restart and end create separate segments; clear is explicit',async()=>{
 const page=await setup();try{
 await open(page);await start(page);await connect(page);await send(page);await finished(page);
 await page.reload();await page.locator('#status').filter({hasText:'三维头部已就绪'}).waitFor();await open(page);
 let data=await download(page);assert.equal(data.segments.length,1);assert.equal(data.segments[0].status,'interrupted');assert.equal(data.segments[0].needs_review,true);assert.equal(data.segments[0].completed_turns,1);
 assert.equal(await page.locator('#acceptance-end').isDisabled(),true);
 await connect(page);await send(page);await finished(page);assert.equal((await download(page)).segments[0].completed_turns,1);
 await start(page);await page.getByRole('button',{name:'记录服务重启'}).click();
 data=await download(page);assert.equal(data.segments.length,2);assert.equal(data.segments[1].status,'service-restart');assert.equal(data.segments[1].completed_turns,0);
 await start(page);await page.getByRole('button',{name:'结束本段采集'}).click();
 console.info('software clock phase: independent segments advanced');
 data=await download(page);assert.equal(data.segments.length,3);assert.equal(data.segments[2].status,'stopped');assert.equal(data.segments[0].completed_turns,1);
 await page.getByRole('button',{name:'清空本机验收草稿'}).click();assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);assert.equal((await download(page)).segments.length,0);
 }finally{await page.close();}
});
test('software-only accelerated clock requires 30 minutes and 20 complete turns in the same uninterrupted segment', {timeout:180000},async()=>{
 const page=await setup({clock:true});try{
 await open(page);await start(page);await connect(page);
 let data=await download(page);assert.equal(data.segments[0].software_candidate,false);
 // Throttle the external browser animation clock only while exercising idle statistics.
 // Native frame callbacks and real HTMLAudio are restored before every actual turn.
 await page.evaluate(()=>{window.nativeRaf=requestAnimationFrame;window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),1000);});
 console.info('software clock phase: advance first 30 minutes');
 await page.clock.runFor(30*60*1000);
 console.info('software clock phase: first 30 minutes advanced');
 await page.evaluate(()=>{window.requestAnimationFrame=window.nativeRaf;});
 data=await download(page);assert.equal(data.segments[0].software_candidate,false);assert.ok(data.segments[0].observed_ms>=1800000,JSON.stringify({observed:data.segments[0].observed_ms,review:data.segments[0].needs_review,last:data.segments[0].events.slice(-4)}));
 for(let i=0;i<20;i++){await send(page);await finished(page);if(i===9||i===19)console.info('software clock phase: completed actual media turns '+(i+1));}
 data=await download(page);assert.equal(data.segments[0].completed_turns,20);assert.equal(data.segments[0].software_candidate,true);assert.equal(data.engineering_acceptance,'not-assessed');
 console.info('software clock phase: independent 15-minute segments');
 await page.getByRole('button',{name:'记录服务重启'}).click();await start(page);await page.evaluate(()=>{window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),1000);});await page.clock.runFor(15*60*1000);await page.getByRole('button',{name:'结束本段采集'}).click();await start(page);await page.evaluate(()=>{window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),1000);});await page.clock.runFor(15*60*1000);
 console.info('software clock phase: independent segments advanced');
 data=await download(page);assert.equal(data.segments.length,3);assert.equal(data.segments[1].software_candidate,false);assert.equal(data.segments[2].software_candidate,false);assert.equal(data.segments[2].completed_turns,0);
 }finally{await page.close();}
});
test('browser heartbeat gap and visibility loss retain review events and exclude unobserved time',async()=>{
 const page=await setup({clock:true});try{
 await open(page);await start(page);await page.clock.runFor(2000);await page.clock.fastForward(30000);
 let data=await download(page),s=data.segments[0];assert.equal(s.needs_review,true);assert.ok(s.observed_ms<10000);assert.ok(s.events.some(e=>e.type==='heartbeat-gap'));
 // External browser visibility seam, never an application lifecycle event.
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.clock.runFor(5000);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 data=await download(page);assert.ok(data.segments[0].events.some(e=>e.type==='page-hidden'));assert.equal(data.segments[0].software_candidate,false);
 }finally{await page.close();}
});
test('quota failure stops collection, retains memory and cannot prevent actual Stop',async()=>{
 const page=await setup();const errors=[];page.on('pageerror',e=>errors.push(e.message));try{
 await open(page);await start(page);await connect(page);await send(page);await page.waitForFunction(()=>!document.querySelector('#audio').paused);
 await page.evaluate(()=>{window.storageChecks=[];const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='digitalhuman.acceptance-journal.v1'){window.storageChecks.push(document.querySelector('#audio').paused);throw new DOMException('private quota text','QuotaExceededError');}return write.call(this,k,v);};});
 await page.locator('#stop').click();await page.locator('#voice-status').filter({hasText:'旧结果已失效'}).waitFor();
 const data=await download(page);assert.equal(data.segments[0].status,'storage-failed');assert.ok(data.segments[0].events.some(e=>e.type==='storage-failed'));assert.ok(data.segments[0].events.some(e=>e.type==='cancelled'));assert.equal(data.segments[0].completed_turns,0);
 assert.deepEqual(await page.evaluate(()=>window.storageChecks),[true]);assert.equal(await page.locator('#acceptance-start').isDisabled(),true);assert.deepEqual(errors,[]);
 await send(page);await finished(page);assert.equal((await download(page)).segments[0].completed_turns,0);assert.ok(!JSON.stringify(data).includes('private quota'));
 }finally{await page.close();}
});
test('restored storage is projected through whitelist; corrupt draft stays visible and is not overwritten',async()=>{
 const page=await setup();try{
 await open(page);await start(page);await page.locator('#acceptance-end').click();
 await page.evaluate(k=>{const d=JSON.parse(localStorage.getItem(k));d.text='私密历史原文';d.segments[0].reply='私密旧回复';d.segments[0].context.preferences='私密偏好';d.segments[0].events[0].error='私密错误';localStorage.setItem(k,JSON.stringify(d));},key);
 await page.reload();await page.locator('#status').filter({hasText:'三维头部已就绪'}).waitFor();await open(page);assert.ok(!JSON.stringify(await download(page)).includes('私密'));
 await page.evaluate(k=>localStorage.setItem(k,'{corrupt private draft'),key);await page.reload();await page.locator('#status').filter({hasText:'三维头部已就绪'}).waitFor();await open(page);
 assert.match(await page.locator('#acceptance-status').textContent(),/无法读取/);assert.equal(await page.locator('#acceptance-start').isDisabled(),true);assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),'{corrupt private draft');
 }finally{await page.close();}
});
test('capacity boundary keeps old draft events and stops visibly without truncating',async()=>{
 const page=await setup();try{
 await open(page);await start(page);await page.locator('#acceptance-end').click();
 // Pre-existing synthetic storage history exercises capacity only, not turn completion.
 await page.evaluate(k=>{const d=JSON.parse(localStorage.getItem(k));d.segments[0].events=Array.from({length:10000},()=>({type:'heartbeat',observed_monotonic_ms:1,observed_utc:'2026-11-16T00:00:00.000Z'}));localStorage.setItem(k,JSON.stringify(d));},key);
 await page.reload();await page.locator('#status').filter({hasText:'三维头部已就绪'}).waitFor();await open(page);await start(page);
 const data=await download(page);assert.equal(data.segments[0].events.length,10000);assert.equal(data.segments[1].status,'capacity-exceeded');assert.equal(await page.locator('#acceptance-start').isDisabled(),true);assert.match(await page.locator('#acceptance-status').textContent(),/容量/);
 }finally{await page.close();}
});
test('hidden fraction between heartbeats and UTC clock shifts cannot inflate observed duration',async()=>{
 const page=await setup({clock:true});try{
 await open(page);await start(page);await page.clock.pauseAt(await page.evaluate(()=>new Date().toISOString()));
 const before=(await download(page)).segments[0].observed_ms;
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.clock.runFor(400);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 let data=await download(page);assert.equal(data.segments[0].observed_ms,before);
 await page.clock.setSystemTime(new Date(Date.now()+3600000));await page.clock.runFor(1000);data=await download(page);assert.ok(data.segments[0].events.some(e=>e.type==='clock-anomaly'));assert.equal(data.segments[0].software_candidate,false);
 }finally{await page.close();}
});
test('microphone input ends at the actual end button, not delayed permission; draft contains timing only',async()=>{
 const page=await setup();try{
 // Reuse an existing PCM recording instead of generating fragile tiny recorder fixtures.
 const fixture=await fs.readFile(path.resolve(__dirname,'../../reports/b-microphone/2026-11-15/final-microphone-scope/submitted-pcm16.wav'),'base64');
 await page.evaluate(fixture=>{
  const bytes=Uint8Array.from(atob(fixture),c=>c.charCodeAt(0));
  const Recorder=MediaRecorder;window.MediaRecorder=class extends Recorder{constructor(...args){super(...args);this.addEventListener('dataavailable',event=>Object.defineProperty(event,'data',{value:new Blob([bytes],{type:'audio/wav'})}));}};
  navigator.mediaDevices.getUserMedia=async()=>{const context=new AudioContext(),source=context.createOscillator(),dest=context.createMediaStreamDestination();source.connect(dest);source.start();await context.resume();window.testInputContext=context;await new Promise(r=>window.allowPermission=r);return dest.stream;};
 },fixture);
 await open(page);await start(page);await connect(page);await page.locator('#microphone-start').click();await page.waitForFunction(()=>!!window.allowPermission);
 let events=(await download(page)).segments[0].events;assert.equal(events.filter(e=>e.type==='attempt-start').length,1);assert.equal(events.filter(e=>e.type==='input-end').length,0);
 await page.waitForTimeout(250);await page.evaluate(()=>window.allowPermission());await page.locator('#voice-status').filter({hasText:'正在录音'}).waitFor();await page.waitForTimeout(200);
 await page.locator('#microphone-end').click();await finished(page);const data=await download(page);events=data.segments[0].events;
 const input=events.find(e=>e.type==='input-end');assert.equal(input.source,'microphone');assert.ok(input.input_end_monotonic_ms-events.find(e=>e.type==='attempt-start').observed_monotonic_ms>=450);assert.equal(data.segments[0].completed_turns,1);assert.ok(!JSON.stringify(data).includes('私密'));
 await page.evaluate(()=>window.testInputContext.close());
 }finally{await page.close();}
});
test('failed stop acknowledgement remains in journal after local cancellation without raw server error',async()=>{
 const page=await setup({handle:async(route,json,p)=>{if(p.endsWith('/stop')){await json({message:'私密停止错误'},503);return true;}return false;}});try{
 await open(page);await start(page);await connect(page);await send(page);await page.waitForFunction(()=>!document.querySelector('#audio').paused);await page.locator('#stop').click();await page.locator('#voice-status').filter({hasText:'服务端停止失败'}).waitFor();
 const data=await download(page);assert.ok(data.segments[0].events.some(e=>e.type==='cancelled'));assert.ok(data.segments[0].events.some(e=>e.type==='failed'&&e.stage==='stop'));assert.equal(data.segments[0].completed_turns,0);assert.ok(!JSON.stringify(data).includes('私密'));assert.equal(await page.locator('#audio').evaluate(a=>a.paused),true);
 }finally{await page.close();}
});

test('shared draft has one page owner; other pages cannot restore-write, capture or clear it and cleared history never revives',async()=>{
 const context=await app.browser.newContext({acceptDownloads:true,viewport:{width:1280,height:1100}});
 try{
 const owner=await setup({context,clock:true});await open(owner);await start(owner);await connect(owner);await send(owner);await finished(owner);
 await owner.clock.pauseAt(await owner.evaluate(()=>new Date(Date.now()+100).toISOString()));
 const original=await owner.evaluate(k=>localStorage.getItem(k),key);
 const other=await setup({context});await open(other);
 assert.equal(await other.evaluate(k=>localStorage.getItem(k),key),original,'opening a shared draft must not rewrite its active segment');
 await start(other);assert.match(await other.locator('#acceptance-status').textContent(),/另一个页面/);
 assert.equal((await download(other)).segments.length,1);
 await other.locator('#acceptance-clear').click();await other.locator('#acceptance-status').filter({hasText:'另一个页面'}).waitFor();assert.match(await other.locator('#acceptance-status').textContent(),/另一个页面/);
 await owner.clock.runFor(2000);let data=await download(owner);assert.equal(data.segments[0].completed_turns,1);assert.equal(data.segments[0].status,'recording');
 assert.equal(JSON.parse(await other.evaluate(k=>localStorage.getItem(k),key)).segments[0].completed_turns,1);
 await owner.locator('#acceptance-clear').click();await owner.clock.runFor(2000);assert.equal(await other.evaluate(k=>localStorage.getItem(k),key),null);
 await start(other);assert.match(await other.locator('#acceptance-status').textContent(),/另一个页面/);assert.equal(await owner.evaluate(k=>localStorage.getItem(k),key),null);
 await owner.close();await start(other);data=await download(other);assert.equal(data.segments.length,1);assert.equal(data.segments[0].completed_turns,0);assert.equal(data.segments[0].status,'recording');
 }finally{await context.close();}
});

test('simultaneous shared-page starts choose one owner and later takeover re-reads all segments and failures',async()=>{
 const context=await app.browser.newContext({acceptDownloads:true,viewport:{width:1280,height:1100}});
 try{
 const pages=await Promise.all([setup({context}),setup({context})]);
 for(const page of pages){await open(page);await page.locator('#acceptance-sha').fill(sha);await page.locator('#acceptance-conditions').selectOption('software-test');}
 await Promise.all(pages.map(page=>page.locator('#acceptance-start').click()));
 await Promise.all(pages.map(page=>page.locator('#acceptance-status').filter({hasText:/正在采集|另一个页面/}).waitFor()));
 const recording=await Promise.all(pages.map(page=>page.locator('#acceptance-end').isEnabled()));assert.equal(recording.filter(Boolean).length,1);
 const owner=pages[recording.indexOf(true)],other=pages[recording.indexOf(false)];
 await owner.locator('#acceptance-restart').click();await start(owner);await connect(owner);await send(owner);await owner.waitForFunction(()=>!document.querySelector('#audio').paused);
 await owner.evaluate(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='digitalhuman.acceptance-journal.v1')throw new DOMException('quota','QuotaExceededError');return write.call(this,k,v);};});
 await owner.locator('#stop').click();let data=await download(owner);assert.equal(data.segments.length,2);assert.equal(data.segments[1].status,'storage-failed');assert.ok(data.segments[1].events.some(e=>e.type==='cancelled'));
 await start(other);await other.locator('#acceptance-status').filter({hasText:'另一个页面'}).waitFor();await other.locator('#acceptance-clear').click();await other.locator('#acceptance-status').filter({hasText:'另一个页面'}).waitFor();
 assert.equal((await download(owner)).segments[1].status,'storage-failed');
 // The failed in-memory export above survives until reload; only previously saved history can be recovered after reload.
 await owner.reload();await owner.locator('#status').filter({hasText:'三维头部已就绪'}).waitFor();await open(owner);await start(owner);await owner.locator('#acceptance-restart').click();
 const saved=JSON.parse(await owner.evaluate(k=>localStorage.getItem(k),key));assert.equal(saved.segments.length,3);assert.equal(saved.segments[2].status,'service-restart');
 await owner.close();await start(other);data=await download(other);assert.equal(data.segments.length,4);assert.equal(data.segments[0].status,'service-restart');assert.equal(data.segments[2].status,'service-restart');assert.equal(data.segments[3].status,'recording');
 }finally{await context.close();}
});

test('failed clear stops the owner and keeps its memory export and exclusive draft permission',async()=>{
 const context=await app.browser.newContext({acceptDownloads:true,viewport:{width:1280,height:1100}});
 try{
 const owner=await setup({context,clock:true});await open(owner);await start(owner);await owner.clock.pauseAt(await owner.evaluate(()=>new Date(Date.now()+100).toISOString()));
 const stored=await owner.evaluate(k=>localStorage.getItem(k),key);
 await owner.evaluate(()=>{const remove=Storage.prototype.removeItem;Storage.prototype.removeItem=function(k){if(k==='digitalhuman.acceptance-journal.v1')throw new DOMException('denied','SecurityError');return remove.call(this,k);};});
 await owner.locator('#acceptance-clear').click();assert.equal(await owner.locator('#acceptance-end').isDisabled(),true);assert.equal(await owner.locator('#acceptance-start').isDisabled(),true);
 const data=await download(owner);assert.equal(data.segments[0].status,'storage-failed');assert.ok(data.segments[0].events.some(e=>e.type==='storage-failed'));
 await owner.clock.runFor(2000);assert.equal(await owner.evaluate(k=>localStorage.getItem(k),key),stored);
 const other=await setup({context});await open(other);await other.locator('#acceptance-clear').click();await other.locator('#acceptance-status').filter({hasText:'另一个页面'}).waitFor();assert.equal(await other.evaluate(k=>localStorage.getItem(k),key),stored);
 }finally{await context.close();}
});

test('missing browser draft ownership disables capture and clear but preserves default-off playback and Stop',async()=>{
 const page=await setup({noLocks:true});try{
 await open(page);assert.equal(await page.locator('#acceptance-start').isDisabled(),true);assert.match(await page.locator('#acceptance-status').textContent(),/不支持/);
 await page.locator('#acceptance-clear').click();assert.match(await page.locator('#acceptance-status').textContent(),/不支持/);assert.equal(await page.evaluate(()=>localStorage.length),0);
 await connect(page);await send(page);await finished(page);await send(page);await page.waitForFunction(()=>!document.querySelector('#audio').paused);await page.locator('#stop').click();await page.locator('#voice-status').filter({hasText:'旧结果已失效'}).waitFor();assert.equal(await page.locator('#audio').evaluate(a=>a.paused),true);
 assert.equal(await page.evaluate(()=>localStorage.length),0);assert.equal((await download(page)).segments.length,0);
 }finally{await page.close();}
});
