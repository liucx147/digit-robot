// Real A HTTP/SQLite, synthetic model only. No GPU or production service.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {publicBrowser}=require('./browser-fixture.cjs');

async function port(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const number=server.address().port;await new Promise(resolve=>server.close(resolve));return number;}

async function backend(state,webRoot,number){
 const child=spawn(process.env.PYTHON_EXE||'python',[path.join(__dirname,'profile-api-fixture.py'),'--web-root',webRoot,'--state-dir',state,'--port',String(number)],{env:{...process.env,PYTHONPATH:process.env.B_PROFILE_BACKEND_SRC},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let diagnostics='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>diagnostics=(diagnostics+data.toString()).slice(-6000));
 const base=`http://127.0.0.1:${number}`;
 try {
  for(let i=0;i<80;i++){
   if(child.exitCode!==null)throw Error('test API exited: '+diagnostics);
   try{const response=await fetch(base+'/v1/health');if(response.ok){assert.equal((await response.json()).profile_memory,true);return {base,stop:async()=>{if(child.exitCode!==null)return;const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;}};}}catch(error){if(error.name==='AssertionError')throw error;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('test API did not become ready: '+diagnostics);
 }catch(error){child.kill();throw error;}
}

test('profile UI reads real SQLite state after service restart and clears/deletes persisted preferences',{
 skip:!process.env.B_PROFILE_BACKEND_SRC,
 timeout:60000,
},async()=>{
 const webRoot=process.env.B_PROFILE_WEB_ROOT || path.resolve(__dirname,'..');
 const state=await fs.mkdtemp(path.join(os.tmpdir(),'b-profile-synthetic-'));
 const number=await port(),app=await publicBrowser(webRoot);
 let service;
 try {
  service=await backend(state,webRoot,number);
  const page=await app.browser.newPage({viewport:{width:1280,height:960}});
  const connect=async()=>{
   await page.getByText('本地服务连接',{exact:true}).click();
   await page.getByLabel('本地服务地址').fill(service.base);
   await page.locator('#voice-connect').click();
   await page.locator('#profile-panel').waitFor({state:'visible'});
   await page.waitForFunction(()=>!document.querySelector('#profile-name').matches(':disabled'));
  };
  await page.goto(service.base);await page.locator('#status').filter({hasText:'三维头部已就绪'}).waitFor();await connect();
  const name='B合成档案-'+Date.now();
  await page.getByLabel('档案名称',{exact:true}).fill(name);
  await page.getByRole('button',{name:'创建并选择档案',exact:true}).click();
  await page.locator('#profile-current').filter({hasText:name}).waitFor();
  await page.locator('#profile-preferred-name').fill('合成称呼甲');
  await page.locator('#profile-communication-style').fill('合成交流偏好：简短');
  await page.getByRole('button',{name:'保存偏好',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#profile-preferred-name').matches(':disabled'));
  const list=await (await fetch(service.base+'/v1/profiles')).json();
  const profile=list.profiles.find(item=>item.display_name===name);
  assert.equal(profile.preferences.preferred_name,'合成称呼甲');
  await service.stop();service=await backend(state,webRoot,number);
  // A second actor modifies the source of truth while the old page is closed.
  await fetch(`${service.base}/v1/profiles/${profile.profile_id}/preferences`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({preferred_name:'合成称呼乙'})});
  await page.reload();await page.locator('#status').filter({hasText:'三维头部已就绪'}).waitFor();await connect();
  await page.locator('#profile-current').filter({hasText:name}).waitFor();
  assert.equal(await page.locator('#profile-preferred-name').inputValue(),'合成称呼乙','reconnect must read changed SQLite values instead of browser preference copies');
  const evidence=path.resolve(__dirname,'../../artifacts/b-profile-real-api',new Date().toISOString().replace(/[:.]/g,'-'));
  await fs.mkdir(evidence,{recursive:true});
  await page.screenshot({path:path.join(evidence,'profile-after-service-restart.png'),fullPage:true});
  await page.getByRole('button',{name:'清空偏好',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#profile-preferred-name').value===''&&!document.querySelector('#profile-preferred-name').matches(':disabled'));
  assert.deepEqual(await (await fetch(`${service.base}/v1/profiles/${profile.profile_id}/preferences`)).json(),{preferred_name:null,communication_style:null});
  await page.getByRole('button',{name:'删除档案',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#profile-current').textContent.includes('匿名'));
  assert.equal((await fetch(`${service.base}/v1/profiles/${profile.profile_id}`)).status,404);
  const renderer=await page.locator('#avatar').getAttribute('data-renderer');
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({scope:'real-A-HTTP-and-SQLite-with-synthetic-model-only',a_source_sha:'26c6b995c165d14753612aed4dad8dc78cedbaad',browser:await app.browser.version(),renderer:JSON.parse(renderer),service_restart:true,read_changed_server_value:true,cleared_preferences:true,deleted_profile:true,real_model_or_physical_acceptance:false},null,2));
 }finally{await service?.stop();await app.close();}
});
