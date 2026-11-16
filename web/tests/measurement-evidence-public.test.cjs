const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {publicBrowser}=require('./browser-fixture.cjs');

// Frozen automatically generated, silent software clip; upload/metadata only.
// No head, physical loudspeaker, calibration or acceptance run is depicted.
const softwareVideoPath=path.resolve(__dirname,'fixtures/measurement-software.webm');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('external media needs explicit condition declarations before a physical manifest can be downloaded', {timeout:60000},async()=>{
 const app=await publicBrowser(path.resolve(__dirname,'..'));
 try{
  const page=await app.browser.newPage({acceptDownloads:true});
  await page.goto(app.baseURL+'/measurement.html');
  const create=page.getByRole('button',{name:'生成并下载物理采集清单',exact:true});
  assert.equal(await create.count(),1,'the operator can create a sidecar for original external media');
  assert.equal(await create.isDisabled(),true);
  assert.equal(await page.locator('#scope').inputValue(),'browser-graph');
  await page.locator('#prepare').click();
  await page.locator('#capture-status').filter({hasText:'40 个固定事件已就绪'}).waitFor();
  const bytes=await fs.readFile(softwareVideoPath);
  await page.getByLabel('载入原始音视频').setInputFiles({name:'synthetic-software-only.webm',mimeType:'video/webm',buffer:bytes});
  await page.locator('#review-status').filter({hasText:'已载入原始音视频'}).waitFor();
  await page.locator('#scope').selectOption('physical-av');
  await page.locator('#physical-operator').fill('synthetic software operator');
  await page.locator('#physical-conditions').fill('synthetic upload/schema test only; no physical capture, no calibration');
  assert.equal(await create.isDisabled(),true,'a media upload and scope selection do not assert matching conditions');
  await page.locator('#physical-confirm').check();
  assert.equal(await create.isEnabled(),true);
  const pending=page.waitForEvent('download');await create.click();
  const download=await pending;
  assert.equal(download.suggestedFilename(),'physical-capture-manifest.json');
  const manifestBytes=await fs.readFile(await download.path());const manifest=JSON.parse(manifestBytes);
  assert.equal(manifest.scope,'physical-av');
  assert.equal(manifest.media.path,'synthetic-software-only.webm');
  assert.equal(manifest.media.sha256,hash(bytes));
  assert.equal(manifest.avatar.version,'solid-v1');
  assert.ok(manifest.renderer.renderer);assert.ok(manifest.renderer.webgl_version);
  assert.equal(manifest.physical_review.basis,'operator-declared');
  assert.equal(manifest.physical_review.conditions_match,true);
  assert.equal(manifest.complete_playback,false,'confirmation does not invent full playback');
  assert.equal(manifest.audio_non_silent,false,'a software upload does not prove captured physical sound');
  assert.equal(manifest.calibration.status,'pending');
  assert.equal(manifest.acceptance_status,'pending-independent-media-review');
  await page.locator('#template').click();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#annotations').value).capture_manifest!==null);
  const annotations=JSON.parse(await page.locator('#annotations').inputValue());
  assert.equal(annotations.capture_manifest.path,'physical-capture-manifest.json');
  assert.equal(annotations.capture_manifest.sha256,hash(manifestBytes));
  assert.equal(annotations.events.length,40);assert.ok(annotations.events.every(e=>e.audio_ms===null&&e.visual_ms===null));
  // CLI invocation on the exported bundle proves the declaration is usable but not acceptance.
  const folder=path.resolve(__dirname,'../../artifacts/b-measurement-evidence',new Date().toISOString().replace(/[:.]/g,'-'));
  await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,manifest.media.path),bytes);
  await fs.writeFile(path.join(folder,'physical-capture-manifest.json'),manifestBytes);
  annotations.media.duration_ms=1000;annotations.review.annotator='synthetic software review';
  await fs.writeFile(path.join(folder,'annotations.json'),JSON.stringify(annotations,null,2));
  const run=spawnSync(process.env.PYTHON_EXE||'python',['-m','digital_human.measurement_cli','score','--ledger',path.resolve(__dirname,'../measurement-fixtures/mandarin40/ledger-solid-v1.json'),'--annotations',path.join(folder,'annotations.json'),'--output',path.join(folder,'report.json')],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,PYTHONPATH:path.resolve(__dirname,'../../src')},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(await fs.readFile(path.join(folder,'report.json'),'utf8'));
  assert.equal(report.evidence_scope,'physical-av');
  assert.equal(report.acceptance_status,'invalid-capture-evidence');
  assert.equal(report.provenance.capture_failure,'incomplete-capture');
  assert.equal(report.passed,0);assert.equal(report.total,40);
  // Separate confirmations are explicit declarations, not measurements inferred by the page.
  await page.locator('#physical-complete').check();await page.locator('#physical-audio').check();
  const declared=page.waitForEvent('download');await create.click();
  const declaredManifest=JSON.parse(await fs.readFile(await (await declared).path(),'utf8'));
  assert.equal(declaredManifest.complete_playback,true);assert.equal(declaredManifest.audio_non_silent,true);
  assert.equal(declaredManifest.physical_review.basis,'operator-declared');
  assert.equal(declaredManifest.calibration.status,'pending');
  assert.equal(declaredManifest.acceptance_status,'pending-calibration');
  await page.getByLabel('载入原始音视频').setInputFiles({name:'another-synthetic.webm',mimeType:'video/webm',buffer:bytes});
  assert.equal(await page.locator('#physical-confirm').isChecked(),false,'new media requires a fresh declaration');
  assert.equal(await create.isDisabled(),true);
  // Reopening evidence is order independent: original sidecar first, then its media.
  await page.getByLabel('载入采集清单').setInputFiles({name:'physical-capture-manifest.json',mimeType:'application/json',buffer:manifestBytes});
  await page.locator('#review-status').filter({hasText:'已载入原始采集清单'}).waitFor();
  await page.getByLabel('载入原始音视频').setInputFiles({name:'synthetic-software-only.webm',mimeType:'video/webm',buffer:bytes});
  await page.locator('#review-status').filter({hasText:'已载入原始音视频'}).waitFor();
  await page.locator('#template').click();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#annotations').value).capture_manifest!==null,{},{timeout:3000});
  assert.equal(JSON.parse(await page.locator('#annotations').inputValue()).capture_manifest.sha256,hash(manifestBytes));
  assert.equal(await create.isDisabled(),true,'loading an original sidecar does not grant new operator confirmations');
 }finally{await app.close();}
});

test('audio-only original media cannot produce a physical screen-video manifest', {timeout:60000},async()=>{
 const app=await publicBrowser(path.resolve(__dirname,'..'));
 try{
  const page=await app.browser.newPage({acceptDownloads:true});
  await page.goto(app.baseURL+'/measurement.html');await page.locator('#prepare').click();
  await page.locator('#capture-status').filter({hasText:'40 个固定事件已就绪'}).waitFor();
  const wav=await fs.readFile(path.resolve(__dirname,'../assets/nihao-cc0.wav'));
  await page.getByLabel('载入原始音视频').setInputFiles({name:'audio-only.wav',mimeType:'audio/wav',buffer:wav});
  await page.locator('#review-video').evaluate(v=>v.readyState>=1?Promise.resolve():new Promise(resolve=>v.addEventListener('loadedmetadata',resolve,{once:true})));
  await page.locator('#scope').selectOption('physical-av');
  await page.locator('#physical-operator').fill('synthetic test');await page.locator('#physical-conditions').fill('audio-only test');
  await page.locator('#physical-confirm').check();
  assert.equal(await page.locator('#physical-manifest').isDisabled(),true);
 }finally{await app.close();}
});

test('a known browser-origin manifest cannot be relabeled as a physical capture', {timeout:60000},async()=>{
 const app=await publicBrowser(path.resolve(__dirname,'..'));
 try{
  const page=await app.browser.newPage({acceptDownloads:true});
  await page.goto(app.baseURL+'/measurement.html');await page.locator('#prepare').click();
  await page.locator('#capture-status').filter({hasText:'40 个固定事件已就绪'}).waitFor();
  const bytes=await fs.readFile(softwareVideoPath);
  await page.getByLabel('载入原始音视频').setInputFiles({name:'known-browser-software.webm',mimeType:'video/webm',buffer:bytes});
  await page.locator('#review-status').filter({hasText:'已载入原始音视频'}).waitFor();
  const ledger=await fs.readFile(path.resolve(__dirname,'../measurement-fixtures/mandarin40/ledger-solid-v1.json'));
  const manifest={schema:1,scope:'browser-graph',media:{sha256:hash(bytes)},ledger_sha256:hash(ledger)};
  await page.getByLabel('载入采集清单').setInputFiles({name:'known-browser-manifest.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});
  await page.locator('#review-status').filter({hasText:'已载入原始采集清单'}).waitFor();
  await page.locator('#scope').selectOption('physical-av');
  await page.locator('#physical-operator').fill('synthetic test');await page.locator('#physical-conditions').fill('known browser software origin test');
  await page.locator('#physical-confirm').check();
  let downloads=0;page.on('download',()=>downloads++);
  await page.locator('#physical-manifest').click();
  await page.locator('#review-status').filter({hasText:'浏览器采集不能重标为物理采集'}).waitFor({timeout:3000});
  assert.equal(downloads,0);
 }finally{await app.close();}
});

test('scope changes clear physical declarations and edits during hashing abort an export', {timeout:60000},async()=>{
 const app=await publicBrowser(path.resolve(__dirname,'..'));
 try{
  const page=await app.browser.newPage({acceptDownloads:true});
  await page.goto(app.baseURL+'/measurement.html');await page.locator('#prepare').click();
  await page.locator('#capture-status').filter({hasText:'40 个固定事件已就绪'}).waitFor();
  const bytes=await fs.readFile(softwareVideoPath);
  await page.getByLabel('载入原始音视频').setInputFiles({name:'synthetic-race-case.webm',mimeType:'video/webm',buffer:bytes});
  await page.locator('#review-status').filter({hasText:'已载入原始音视频'}).waitFor();
  await page.locator('#scope').selectOption('physical-av');
  await page.locator('#physical-operator').fill('synthetic test');await page.locator('#physical-conditions').fill('software race case');
  for(const id of ['physical-confirm','physical-complete','physical-audio'])await page.locator('#'+id).check();
  await page.locator('#scope').selectOption('browser-graph');await page.locator('#scope').selectOption('physical-av');
  for(const id of ['physical-confirm','physical-complete','physical-audio'])assert.equal(await page.locator('#'+id).isChecked(),false,'scope changes invalidate the prior declarations');
  await page.locator('#physical-confirm').check();
  let downloads=0;page.on('download',()=>downloads++);
  await page.evaluate(()=>{
   document.querySelector('#physical-manifest').click();
   const conditions=document.querySelector('#physical-conditions');conditions.value='changed while hashing';conditions.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.locator('#review-status').filter({hasText:'媒体或声明已改变'}).waitFor({timeout:3000});
  assert.equal(downloads,0);
 }finally{await app.close();}
});

test('a stale failed manifest read cannot erase the newer original manifest', {timeout:60000},async()=>{
 const app=await publicBrowser(path.resolve(__dirname,'..'));
 try{
  const page=await app.browser.newPage({acceptDownloads:true});
  await page.goto(app.baseURL+'/measurement.html');await page.locator('#prepare').click();
  await page.locator('#capture-status').filter({hasText:'40 个固定事件已就绪'}).waitFor();
  const bytes=await fs.readFile(softwareVideoPath);
  await page.getByLabel('载入原始音视频').setInputFiles({name:'synthetic-current.webm',mimeType:'video/webm',buffer:bytes});
  await page.locator('#review-status').filter({hasText:'已载入原始音视频'}).waitFor();
  const ledger=await fs.readFile(path.resolve(__dirname,'../measurement-fixtures/mandarin40/ledger-solid-v1.json'));
  const manifestBytes=Buffer.from(JSON.stringify({schema:1,scope:'browser-graph',media:{sha256:hash(bytes)},ledger_sha256:hash(ledger)}));
  for(const failure of ['malformed-json','read-error']){
   // Delay only this external File read. The real file-input handler, parsing,
   // validation, status and template generation all run unchanged.
   await page.evaluate(failure=>{
    const file=new File(['{invalid json'],'old-invalid.json',{type:'application/json'});
    file.arrayBuffer=()=>new Promise((resolve,reject)=>{
     window.releaseOldManifest=()=>failure==='read-error'?reject(new Error('old read failed')):resolve(new TextEncoder().encode('{invalid json').buffer);
    });
    const transfer=new DataTransfer();transfer.items.add(file);
    const input=document.querySelector('#manifest-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
   },failure);
   await page.getByLabel('载入采集清单').setInputFiles({name:'current-original.json',mimeType:'application/json',buffer:manifestBytes});
   await page.locator('#review-status').filter({hasText:'已载入原始采集清单'}).waitFor();
   const currentStatus=await page.locator('#review-status').textContent();
   await page.evaluate(async()=>{window.releaseOldManifest();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));delete window.releaseOldManifest;});
   assert.equal(await page.locator('#review-status').textContent(),currentStatus,`${failure}: an old failure must not overwrite the newer success`);
   await page.locator('#annotations').fill('{"capture_manifest":null}');
   await page.locator('#template').click();
   await page.waitForFunction(()=>JSON.parse(document.querySelector('#annotations').value).capture_manifest!==null,{},{timeout:3000});
   const annotations=JSON.parse(await page.locator('#annotations').inputValue());
   assert.equal(annotations.capture_manifest.path,'current-original.json');
   assert.equal(annotations.capture_manifest.sha256,hash(manifestBytes),`${failure}: the template retains the newer original file identity`);
  }
  // Current errors still surface, and the prior manifest cannot remain usable.
  await page.getByLabel('载入采集清单').setInputFiles({name:'current-invalid.json',mimeType:'application/json',buffer:Buffer.from('{invalid json')});
  await page.locator('#review-status').filter({hasText:'清单读取失败'}).waitFor();
  await page.locator('#template').click();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#annotations').value).capture_manifest===null,{},{timeout:3000});
  assert.match(await page.locator('#review-status').textContent(),/清单读取失败/);
 }finally{await app.close();}
});
