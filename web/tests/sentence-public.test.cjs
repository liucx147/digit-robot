const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs/promises');
const {publicBrowser}=require('./browser-fixture.cjs');
let app;
before(async()=>{app=await publicBrowser(path.resolve(__dirname,'..'));});
after(async()=>{await app?.close();});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function wav(){const rate=16000,n=rate*1.1,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(8000*Math.sin(i/rate*2*Math.PI*220)),44+i*2);return b;}
async function setup({delayedGeneration=true,delayedAudio=false,badAudio=false}={}){
 const release=deferred(),requests=[],completed=[];let epoch=0,streamEnded=false;
 const api=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin',app.baseURL);res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Session-Epoch');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  const p=new URL(req.url,'http://localhost').pathname;requests.push(p);
  const json=body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
  const session=()=>({session_id:'sentence-session',session_epoch:epoch,state:'idle',sentence_streaming:true});
  if(p==='/v1/health')return json({sentence_streaming:true});
  if(p==='/v1/sessions')return json(session());
  if(p.endsWith('/stop')){epoch++;return json(session());}
  if(p.startsWith('/v2/')&&p.endsWith('/text')){
   for await(const chunk of req){};
   res.setHeader('Content-Type','application/x-ndjson');
   const initial=epoch;
   const emit=(type,extra={})=>res.write(JSON.stringify({type,session_id:'sentence-session',session_epoch:initial,utterance_id:'sentence-turn',...extra})+'\n');
   emit('start');emit('meta',{user_emotion:'sadness',expression_intent:{style:'gentle',intensity:.5}});
   const segment=i=>{emit('sentence',{segment_index:i,text:i?'我们可以一起想办法。':'听起来你很难过。'});emit('audio_ready',{segment_index:i,text:i?'我们可以一起想办法。':'听起来你很难过。',user_emotion:'sadness',expression_intent:{style:'gentle',intensity:.5},audio:{url:badAudio?'https://external.invalid/audio':`/v2/sessions/sentence-session/turns/sentence-turn/segments/${i}/audio`,mime_type:'audio/wav',duration_ms:1100,sample_rate_hz:16000,channels:1}});};
   segment(0);if(delayedGeneration)await release.promise;segment(1);emit('done',{reply:'听起来你很难过。我们可以一起想办法。',status:'ok',timings_ms:{first_audio_ready_ms:100,total_ms:200}});streamEnded=true;return res.end();
  }
  if(p.endsWith('/audio')){
   const index=Number(p.split('/').at(-2));if(delayedAudio&&index===0)await new Promise(r=>setTimeout(r,700));completed.push(index);res.setHeader('Content-Type','audio/wav');return res.end(wav());
  }
  json(session());
 });
 await new Promise(r=>api.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${api.address().port}`,page=await app.browser.newPage({acceptDownloads:true,viewport:{width:1280,height:960}});page.setDefaultTimeout(7000);
 await page.goto(app.baseURL);await page.getByRole('status',{name:'播放状态'}).filter({hasText:'三维头部已就绪'}).waitFor();
 await page.getByText('本地服务连接',{exact:true}).click();await page.getByLabel('本地服务地址').fill(base);
 await page.getByRole('button',{name:'连接本地服务',exact:true}).click();await page.getByRole('status',{name:'对话状态'}).filter({hasText:'已连接'}).waitFor();
 const send=async()=>{await page.getByLabel('输入中文').fill('今天很难过');await page.getByRole('button',{name:'发送并播放回复'}).click();};
 const close=async()=>{release.resolve();await page.close();api.closeAllConnections();await new Promise(r=>api.close(r));};
 return {page,release,requests,completed,send,close,get streamEnded(){return streamEnded;}};
}
test('first sentence plays while generation is unfinished; full queue exports correlated frames and separate timing',async()=>{
 const f=await setup();try{await f.send();await f.page.waitForFunction(()=>!document.querySelector('#audio').paused&&Number(document.querySelector('#mouth-weight').textContent)>.05);assert.equal(f.streamEnded,false);f.release.resolve();await f.page.getByRole('status',{name:'对话状态'}).filter({hasText:'回复播放完成'}).waitFor();
 await f.page.getByText('播放记录',{exact:true}).click();const download=f.page.waitForEvent('download');await f.page.locator('#download').click();const record=JSON.parse(await fs.readFile(await (await download).path(),'utf8'));
 assert.deepEqual(record.segments.map(x=>x.segment_index),[0,1]);assert(record.frames.some(x=>x.segment_index===1&&x.weights.jawOpen>0));assert(record.frames.every(x=>x.utterance_id==='sentence-turn'&&x.session_epoch===0));assert(record.client_timings_ms.first_reply_activity_ms<record.client_timings_ms.total_playback_ms);assert.equal(record.frames.at(-1).weights.jawOpen,0);
 }finally{await f.close();}
});
test('prefetched audio can finish out of order but playback stays in sentence order',async()=>{
 const f=await setup({delayedGeneration:false,delayedAudio:true});try{await f.send();await f.page.getByRole('status',{name:'对话状态'}).filter({hasText:'回复播放完成'}).waitFor();assert.deepEqual(f.completed,[1,0]);await f.page.getByText('播放记录',{exact:true}).click();const download=f.page.waitForEvent('download');await f.page.locator('#download').click();const record=JSON.parse(await fs.readFile(await (await download).path(),'utf8'));assert.deepEqual(record.events.filter(e=>e.type==='play').map(e=>e.segment_index),[0,1]);}finally{await f.close();}
});
test('Stop drops the current segment and late future sentences without reviving audio',async()=>{
 const f=await setup();try{await f.send();await f.page.waitForFunction(()=>!document.querySelector('#audio').paused);await f.page.getByRole('button',{name:'停止',exact:true}).click();await f.page.getByRole('status',{name:'对话状态'}).filter({hasText:'旧结果已失效'}).waitFor();f.release.resolve();await f.page.waitForTimeout(400);assert.equal(await f.page.locator('#audio').evaluate(a=>a.paused),true);assert.equal(await f.page.locator('#play').isDisabled(),true);assert(!f.requests.some(p=>p.includes('/segments/1/')));}finally{await f.close();}
});
test('foreign segment audio is a visible failure and is never fetched',async()=>{
 const f=await setup({delayedGeneration:false,badAudio:true});try{const foreign=[];f.page.on('request',r=>{if(r.url().includes('external.invalid'))foreign.push(r.url());});await f.send();await f.page.getByRole('status',{name:'对话状态'}).filter({hasText:'回复失败'}).waitFor();assert.deepEqual(foreign,[]);assert.equal(await f.page.locator('#audio').evaluate(a=>a.paused),true);}finally{await f.close();}
});
