const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { recordedMouthReferences } = require('./recorded-mouth.cjs');
const { publicBrowser } = require('./browser-fixture.cjs');
const webRoot = path.resolve(__dirname, '..');
let browser, baseURL, close;
before(async () => {
  ({browser,baseURL,close}=await publicBrowser(webRoot));
});
after(async () => {await close?.();});

test('a user freezes the Mandarin ledger then records actual canvas pixels and audible graph output', {timeout:90000}, async () => {
  const page = await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true});
  await page.goto(baseURL + '/measurement.html');
  await page.getByRole('button',{name:'准备固定40事件'}).click();
  await page.getByRole('status',{name:'测量状态'}).filter({hasText:/40 个固定事件已就绪/}).waitFor();
  await page.getByRole('button',{name:'录制画布与声音'}).click();
  await page.getByRole('status',{name:'测量状态'}).filter({hasText:/正在录制/}).waitFor();
  const canvasBox=await page.frameLocator('#product').getByLabel('三维数字人头部').boundingBox();
  assert.ok(canvasBox.y+canvasBox.height/2>=0&&canvasBox.y+canvasBox.height/2<1000,'the actual head stays visible while recording so the iframe render loop is not offscreen-throttled');
  await page.getByRole('status',{name:'测量状态'}).filter({hasText:/录制已完成/}).waitFor({timeout:60000});
  const getDownload = async name => {const event=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return await fs.readFile(await (await event).path());};
  const webm = await getDownload('下载原始音视频');
  assert.ok(webm.length > 20000);
  assert.deepEqual([...webm.subarray(0,4)], [0x1a,0x45,0xdf,0xa3]);
  const manifestBytes = await getDownload('下载采集清单');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.scope, 'browser-graph');
  assert.equal(manifest.audio_non_silent, true);
  assert.equal(manifest.complete_playback, true);
  assert.equal(manifest.acceptance_status,'pending-independent-physical-av');
  assert.equal(manifest.expected_events,40);
  await fs.mkdir(path.resolve(webRoot,'../artifacts/measurement'),{recursive:true});
  await fs.writeFile(path.resolve(webRoot,'../artifacts/measurement/capture.webm'),webm);
  await fs.writeFile(path.resolve(webRoot,'../artifacts/measurement/capture-manifest.json'),manifestBytes);
  await page.getByLabel('载入原始音视频').setInputFiles({name:'capture.webm',mimeType:'video/webm',buffer:webm});
  await page.getByRole('status',{name:'复核状态'}).filter({hasText:/已载入/}).waitFor();
  assert.ok(await page.locator('#review-video').evaluate(v => v.videoWidth > 100 && v.videoHeight > 100));
  const decoded = await page.getByLabel('载入原始音视频').evaluate(async input => {
    const context=new AudioContext();
    try {const audio=await context.decodeAudioData(await input.files[0].arrayBuffer());let peak=0;for(const sample of audio.getChannelData(0))peak=Math.max(peak,Math.abs(sample));return {peak,duration:audio.duration};}finally{await context.close();}
  });
  assert.ok(decoded.peak > .01 && decoded.duration > 30, 'the original recorded file decodes to non-silent audio, not just a live meter');
  const references=await recordedMouthReferences(page);
  const originalFrames=[references.opened,references.closed].map(frame=>Buffer.from(frame.png,'base64'));
  const sampledPTS=[references.opened.pts,references.closed.pts];
  const mouthPixels=await page.evaluate(async buffers=>{
    const counts=[],comparison=document.createElement('canvas');comparison.width=600;comparison.height=190;
    const graphics=comparison.getContext('2d');graphics.fillStyle='white';graphics.fillRect(0,0,600,190);graphics.fillStyle='black';graphics.font='16px sans-serif';
    for(let i=0;i<buffers.length;i++){
      const image=await createImageBitmap(await (await fetch('data:image/png;base64,'+buffers[i])).blob());
      const canvas=document.createElement('canvas');canvas.width=60;canvas.height=30;const context=canvas.getContext('2d');context.drawImage(image,270,340,60,30,0,0,60,30);
      const pixels=context.getImageData(0,0,60,30).data;
      const channels=[[],[],[]];for(let y=0;y<4;y++)for(let x=0;x<60;x++)for(let c=0;c<3;c++)channels[c].push(pixels[(y*60+x)*4+c]);
      const skin=channels.map(values=>values.sort((a,b)=>a-b)[120]);
      let contrast=0;for(let y=8;y<28;y++)for(let x=8;x<52;x++){const p=(y*60+x)*4;if(Math.max(...skin.map((value,c)=>Math.abs(pixels[p+c]-value)))>=20)contrast++;}
      counts.push(contrast);graphics.drawImage(canvas,i*300,30,300,150);graphics.fillText(i===0?'Recorded mouth opening':'Recorded closed reference',i*300,20);
    }
    return {counts,comparison:comparison.toDataURL('image/png').split(',')[1]};
  },originalFrames.map(frame=>frame.toString('base64')));
  assert.ok(mouthPixels.counts[1]<=80&&mouthPixels.counts[0]>=mouthPixels.counts[1]+30&&mouthPixels.counts[0]>=mouthPixels.counts[1]*1.5,'decoded central mouth contrast area exceeds a low-area closed reference by at least 30 pixels and 50%; PNG encoding noise or a uniform skin brightness shift is insufficient');
  await fs.writeFile(path.resolve(webRoot,'../artifacts/measurement/mouth-pixels-comparison.png'),Buffer.from(mouthPixels.comparison,'base64'));
  await fs.writeFile(path.resolve(webRoot,'../artifacts/measurement/decoded-frame-observations.json'),JSON.stringify({media_pts_seconds:sampledPTS,mouth_contrast_pixels:mouthPixels.counts,searched_presented_frames:references.samples,purpose:'Diagnostic mouth pixels only; these selected frames do not measure synchronization offset.'},null,2));
  await fs.writeFile(path.resolve(webRoot,'../artifacts/measurement/decoded-speech.png'),originalFrames[0]);
  await fs.writeFile(path.resolve(webRoot,'../artifacts/measurement/decoded-silence.png'),originalFrames[1]);
  await page.locator('#annotator').fill('automated unannotated recording check');
  await page.locator('#duration').fill(String(decoded.duration*1000));
  await page.getByRole('button',{name:'生成空白标注模板'}).click();
  await page.waitForFunction(()=>document.querySelector('#annotations').value.includes('automated unannotated recording check'));
  const annotationBytes = await getDownload('下载标注模板');
  const annotations = JSON.parse(annotationBytes);
  assert.ok(annotations.capture_manifest, 'template links original capture manifest');
  assert.equal(annotations.events.length,40);
  assert.ok(annotations.events.every(r=>r.audio_ms===null && r.visual_ms===null),'never fabricate independent observations from schedules');
  const evidenceRoot=path.resolve(webRoot,'../artifacts/measurement');
  await fs.writeFile(path.join(evidenceRoot,'annotations-unreviewed.json'),annotationBytes);
  const output=path.join(evidenceRoot,'report-unreviewed.json');
  await fs.rm(output,{force:true});
  const reportRun=spawnSync(process.env.PYTHON_EXE||'python',['-m','digital_human.measurement_cli','score','--ledger',path.resolve(webRoot,'measurement-fixtures/mandarin40/ledger.json'),'--annotations',path.join(evidenceRoot,'annotations-unreviewed.json'),'--output',output],{cwd:path.resolve(webRoot,'..'),env:{...process.env,PYTHONPATH:path.resolve(webRoot,'../src')},encoding:'utf8'});
  assert.equal(reportRun.status,0,reportRun.stderr);
  const report=JSON.parse(await fs.readFile(output,'utf8'));
  assert.equal(report.passed,0,'unreviewed actual capture never acquires fabricated passing timestamps');
  assert.equal(report.total,40);
  assert.equal(report.acceptance_status,'pending-independent-physical-av');
  await page.close();
});

test('permission denial and capture without an audio track are visible failures without silent fallback', async () => {
  for(const mode of ['denied','no-audio']) {
    const page=await browser.newPage();
    await page.addInitScript(mode=>{navigator.mediaDevices.getDisplayMedia=async()=>{if(mode==='denied')throw new DOMException('permission denied','NotAllowedError');return document.querySelector('iframe').contentDocument.querySelector('canvas').captureStream(30);};},mode);
    await page.goto(baseURL+'/measurement.html');
    await page.getByRole('button',{name:'准备固定40事件'}).click();
    await page.getByRole('status',{name:'测量状态'}).filter({hasText:/40 个固定事件已就绪/}).waitFor();
    await page.getByRole('button',{name:'选择窗口并录制'}).click();
    await page.getByRole('status',{name:'测量状态'}).filter({hasText:/采集失败/}).waitFor();
    assert.equal(await page.getByRole('button',{name:'下载原始音视频',exact:true}).isDisabled(),true);
    assert.equal(await page.frameLocator('#product').locator('audio').evaluate(audio=>audio.paused),true);
    await page.close();
  }
});
test('a missing frozen fixture is explained and recording remains unavailable', async()=>{
  const page=await browser.newPage();
  await page.route('**/measurement-fixtures/mandarin40/fixture.wav',route=>route.fulfill({status:404,body:'missing'}));
  await page.goto(baseURL+'/measurement.html');await page.getByRole('button',{name:'准备固定40事件'}).click();
  await page.getByRole('status',{name:'测量状态'}).filter({hasText:/准备失败/}).waitFor();
  assert.equal(await page.getByRole('button',{name:'录制画布与声音',exact:true}).isDisabled(),true);
  await page.close();
});


test('capture reloads the frozen Mandarin from the beginning after the embedded page changes or plays another input', async t => {
  const page=await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true});
  t.after(()=>page.close());
  await page.goto(baseURL+'/measurement.html');
  await page.getByRole('button',{name:'准备固定40事件'}).click();
  await page.getByRole('status',{name:'测量状态'}).filter({hasText:/40 个固定事件已就绪/}).waitFor();
  const product=page.frameLocator('#product');
  await product.getByRole('button',{name:'载入中文录音示例',exact:true}).click();
  await product.getByRole('status',{name:'播放状态'}).filter({hasText:/音频已就绪/}).waitFor();
  await product.getByRole('button',{name:'播放音频',exact:true}).click();
  await product.locator('audio').evaluate(audio=>new Promise(resolve=>{const tick=()=>audio.currentTime>.2?resolve():setTimeout(tick,20);tick();}));
  await page.getByRole('button',{name:'录制画布与声音',exact:true}).click();
  await page.getByRole('status',{name:'测量状态'}).filter({hasText:/正在录制/}).waitFor();
  const input=await product.locator('audio').evaluate(audio=>({duration:audio.duration,time:audio.currentTime}));
  assert.ok(input.duration>30,'recording must play the frozen 35s fixture rather than the changed 1.05s input');
  assert.ok(input.time<1,'recording restarts the real media at its beginning');
  await page.getByRole('button',{name:'停止录制',exact:true}).click();
  await page.getByRole('button',{name:'下载采集清单',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#download-manifest').disabled);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'下载采集清单',exact:true}).click();
  const manifest=JSON.parse(await fs.readFile(await (await download).path()));
  assert.equal(manifest.complete_playback,false,'an interrupted run retains raw evidence as incomplete');
  assert.equal(await product.locator('audio').evaluate(audio=>audio.paused),true,'capture Stop also stops real playback');
});


test('recording locks audio replacement, replay and dialogue controls while keeping expression and gaze available', async t=>{
  const page=await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true});t.after(()=>page.close());
  const apiRequests=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/v1/'))apiRequests.push(request.url());});
  await page.goto(baseURL+'/measurement.html');
  await page.getByRole('button',{name:'准备固定40事件'}).click();
  await page.getByRole('status',{name:'测量状态'}).filter({hasText:/40 个固定事件已就绪/}).waitFor();
  await page.getByRole('button',{name:'录制画布与声音',exact:true}).click();
  await page.getByRole('status',{name:'测量状态'}).filter({hasText:/正在录制/}).waitFor();
  const product=page.frameLocator('#product');
  for(const selector of ['#audio-file','#sample','#play','#stop','#voice-connect','#voice-send','#microphone-start','#microphone-end','#text-input','#api-base']) assert.equal(await product.locator(selector).isDisabled(),true,selector+' is locked during fixed capture');
  assert.equal(await product.getByLabel('微笑强度').isEnabled(),true);
  assert.equal(await product.getByLabel('选择固定人脸图片或视频',{exact:true}).isEnabled(),true);
  await product.getByLabel('微笑强度').fill('0.5');
  // Dispatching through a disabled input must not replace the real measured source either.
  await product.getByLabel('选择本地音频',{exact:true}).setInputFiles(path.resolve(webRoot,'assets/nihao-cc0.wav'));
  await product.locator('#sample').dispatchEvent('click');
  await product.locator('#voice-connect').dispatchEvent('click');
  await page.waitForTimeout(250);
  assert.ok(await product.locator('audio').evaluate(audio=>audio.duration>30&&!audio.paused));
  assert.deepEqual(apiRequests,[],'dialogue cannot start or replace the frozen playback during capture');
  await page.getByRole('button',{name:'停止录制',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#download-manifest').disabled);
  assert.equal(await product.locator('#audio-file').isEnabled(),true,'the input is available after capture');
});


test('a changed media source, seek, replay, pause or rate invalidates capture and retains the original evidence', {timeout:60000}, async()=>{
  for(const mode of ['pause','seek','source','replay','rate']) {
    const page=await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true});
    try {
      await page.goto(baseURL+'/measurement.html');
      await page.getByRole('button',{name:'准备固定40事件'}).click();
      await page.getByRole('status',{name:'测量状态'}).filter({hasText:/40 个固定事件已就绪/}).waitFor();
      await page.getByRole('button',{name:'录制画布与声音',exact:true}).click();
      await page.getByRole('status',{name:'测量状态'}).filter({hasText:/正在录制/}).waitFor();
      const audio=page.frameLocator('#product').locator('audio');
      await audio.evaluate(audio=>new Promise(resolve=>{const tick=()=>audio.currentTime>.8?resolve():setTimeout(tick,20);tick();}));
      await audio.evaluate((audio,mode)=>{
        if(mode==='pause')audio.pause();
        if(mode==='seek')audio.currentTime=audio.duration-.05;
        if(mode==='source'){audio.src='./assets/nihao-cc0.wav';audio.load();}
        if(mode==='replay'){audio.pause();audio.currentTime=0;audio.play().catch(()=>{});}
        if(mode==='rate')audio.playbackRate=2;
      },mode);
      await page.getByRole('status',{name:'测量状态'}).filter({hasText:/采集失效/}).waitFor({timeout:4000});
      const event=page.waitForEvent('download');await page.getByRole('button',{name:'下载采集清单',exact:true}).click();
      const manifest=JSON.parse(await fs.readFile(await (await event).path()));
      assert.equal(manifest.complete_playback,false,mode+' cannot produce complete fixed-input evidence');
      assert.equal(manifest.playback_integrity.status,'invalid');
      assert.ok(manifest.playback_integrity.reason);
      const media=page.waitForEvent('download');await page.getByRole('button',{name:'下载原始音视频',exact:true}).click();
      assert.ok((await fs.readFile(await (await media).path())).length>0,mode+' failed original media remains downloadable');
    }finally{await page.close();}
  }
});
