const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {publicBrowser}=require('./browser-fixture.cjs');

test('default measurement captures the current head and records actual renderer without implying physical acceptance',async()=>{
 const app=await publicBrowser(path.resolve(__dirname,'..'));
 try {
  const page=await app.browser.newPage({acceptDownloads:true,viewport:{width:1280,height:1000}});
  await page.goto(app.baseURL+'/measurement.html');
  await page.locator('#prepare').click();
  await page.locator('#capture-status').filter({hasText:'40 个固定事件已就绪'}).waitFor();
  assert.equal(await page.frameLocator('#product').locator('#avatar-name').innerText(),'实体三维头部 · solid-v1');
  await page.locator('#record-graph').click();
  await page.locator('#capture-status').filter({hasText:'正在录制'}).waitFor();
  await page.waitForTimeout(700);
  await page.locator('#stop-capture').click();
  await page.waitForFunction(()=>!document.querySelector('#download-manifest').disabled);
  const pending=page.waitForEvent('download'); await page.locator('#download-manifest').click();
  const manifest=JSON.parse(await fs.readFile(await (await pending).path(),'utf8'));
  assert.equal(manifest.avatar.version,'solid-v1');
  assert.equal(manifest.avatar.type,'solid-head');
  assert.match(manifest.avatar.sha256,/^[a-f0-9]{64}$/);
  assert.ok(manifest.renderer.renderer);
  assert.ok(manifest.renderer.webgl_version);
  assert.equal(manifest.complete_playback,false);
  assert.equal(manifest.acceptance_status,'pending-independent-physical-av');
  const folder=path.resolve(__dirname,'../../artifacts/b-engineering');
  await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'current-head-capture-manifest.json'),JSON.stringify(manifest,null,2));
 } finally {await app.close();}
});
