const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {publicBrowser}=require('./browser-fixture.cjs');
let browser,baseURL,close;
const api='http://127.0.0.1:18000';
const pidA='11111111-1111-4111-8111-111111111111',pidB='22222222-2222-4222-8222-222222222222';
function wav(){const rate=16000,n=rate*4,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(9000*Math.sin(2*Math.PI*220*i/rate)),44+i*2);return b;}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function service(){
 const profiles=new Map(),sessions=new Map();let count=0,nextProfile=0;
 const state={profiles,sessions,requests:[],before:null};
 const snapshot=s=>({...s});
 const invalidate=id=>[...sessions.values()].filter(s=>s.profile_id===id).map(s=>{s.session_epoch++;s.state='idle';return snapshot(s);});
 state.handle=async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.pathname,m=request.method();
  let input;try{input=request.postDataJSON();}catch{}
  state.requests.push({p,m,input});
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify(body)});
  if(state.before&&await state.before({route,p,m,input,json}))return;
  if(p==='/v1/health')return json({status:'ok',profile_memory:true});
  if(p==='/v1/sessions'&&m==='POST'){const s={session_id:'session-'+ ++count,session_epoch:0,state:'idle',profile_id:null,sentence_streaming:state.streaming===true};sessions.set(s.session_id,s);return json(snapshot(s));}
  const sm=p.match(/^\/v1\/sessions\/([^/]+)(.*)$/);
  if(sm){const s=sessions.get(sm[1]);if(!s)return json({type:'error',code:'session_not_found',message:'会话已失效'},404);
   if(sm[2]===''&&m==='GET')return json(snapshot(s));
   if(sm[2]==='/profile'){if(input.session_epoch!==s.session_epoch)return json({type:'error',code:'stale_epoch',message:'请重新读取档案'},409);if(input.profile_id!==null&&!profiles.has(input.profile_id))return json({type:'error',code:'profile_not_found',message:'档案不存在'},404);s.session_epoch++;s.profile_id=input.profile_id;return json(snapshot(s));}
   if(sm[2]==='/stop'){s.session_epoch++;return json(snapshot(s));}
   if(sm[2].endsWith('/audio'))return route.fulfill({status:200,contentType:'audio/wav',body:wav()});
   if(sm[2]==='/text'){if(input.session_epoch!==s.session_epoch)return json({type:'error',code:'stale_epoch',message:'会话已更新，请重新读取档案'},409);if(state.speak)return json({type:'response',state:'ready',status:'ok',session_id:s.session_id,session_epoch:s.session_epoch,utterance_id:'turn-'+s.session_epoch,user_emotion:'neutral',reply:'你好，'+(profiles.get(s.profile_id)?.display_name||'匿名'),expression_intent:{style:'calm',intensity:.5},audio:{url:'/v1/sessions/'+s.session_id+'/turns/turn-'+s.session_epoch+'/audio',mime_type:'audio/wav',sample_rate_hz:16000,channels:1,duration_ms:4000}});return json({type:'error',code:'test_reply',message:'当前档案：'+(profiles.get(s.profile_id)?.display_name||'匿名')},503);}
  }
  if(p==='/v1/profiles'){
   if(m==='GET')return json({profiles:[...profiles.values()]});
   if(m==='POST'){if([...profiles.values()].some(p=>p.display_name===input.display_name))return json({type:'error',code:'profile_exists',message:'档案名称已存在'},409);const profile={profile_id:nextProfile++?pidB:pidA,display_name:input.display_name,preferences:{preferred_name:null,communication_style:null}};profiles.set(profile.profile_id,profile);return json(profile,201);}
  }
  const pm=p.match(/^\/v1\/profiles\/([^/]+)(\/preferences)?$/);
  if(pm){const profile=profiles.get(pm[1]);if(!profile)return json({type:'error',code:'profile_not_found',message:'档案不存在'},404);
   if(m==='GET')return json(pm[2]?profile.preferences:profile);
   if(m==='PATCH'){if(pm[2])for(const [k,v]of Object.entries(input))profile.preferences[k]=v?.trim()||null;else profile.display_name=input.display_name;return json({profile,affected_sessions:invalidate(profile.profile_id)});}
   if(m==='DELETE'){const affected=invalidate(profile.profile_id);if(pm[2]){profile.preferences={preferred_name:null,communication_style:null};return json({profile,affected_sessions:affected});}profiles.delete(profile.profile_id);for(const s of sessions.values())if(s.profile_id===profile.profile_id)s.profile_id=null;return json({deleted:true,affected_sessions:affected.map(s=>({...s,profile_id:null}))});}
  }
  return json({type:'error',code:'not_found',message:'接口不存在'},404);
 };
 return state;
}
async function setup(state=service()){
 const page=await browser.newPage({viewport:{width:1200,height:1000}});page.setDefaultTimeout(7000);
 await page.route(api+'/**',state.handle);await page.goto(baseURL);
 await page.getByRole('status',{name:'播放状态'}).filter({hasText:/三维头部已就绪/}).waitFor();
 return {page,state};
}
async function connect(page){await page.getByRole('button',{name:'连接本地服务',exact:true}).click();await page.getByRole('status',{name:'对话状态'}).filter({hasText:/已连接/}).waitFor();}
async function ready(page){await page.waitForFunction(()=>!document.querySelector('#profile-refresh').disabled);}
async function create(page,name){await page.getByLabel('档案名称',{exact:true}).fill(name);await page.getByRole('button',{name:'创建并选择档案'}).click();await page.getByLabel('当前档案',{exact:true}).filter({hasText:name}).waitFor();await ready(page);}
before(async()=>{({browser,baseURL,close}=await publicBrowser(path.resolve(__dirname,'..')));const page=await browser.newPage();console.log('Actual WebGL renderer:',await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl');const info=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(info.UNMASKED_RENDERER_WEBGL);}));await page.close();});
after(async()=>await close?.());
test('manual profile creation and explicit selection bind subsequent turns to the chosen person',async()=>{
 const {page}=await setup();try{
  await connect(page);await create(page,'实验甲');await create(page,'实验乙');
  await page.getByLabel('选择档案',{exact:true}).selectOption(pidA);await page.getByLabel('当前档案',{exact:true}).filter({hasText:'实验甲'}).waitFor();await ready(page);
  await page.getByLabel('输入中文').fill('你好');await page.getByRole('button',{name:'发送并播放回复'}).click();
  await page.getByRole('status',{name:'对话状态'}).filter({hasText:/当前档案：实验甲/}).waitFor();
  await page.getByLabel('选择档案',{exact:true}).selectOption('');await page.getByLabel('当前档案',{exact:true}).filter({hasText:'匿名'}).waitFor();await ready(page);
  assert.equal(await page.getByLabel('数字人回复').textContent(),'回复将在这里显示。');
 }finally{await page.close();}
});
test('server preferences are read across switches and reload, renamed safely, cleared and deleted',async()=>{
 const {page,state}=await setup();try{
  await connect(page);await create(page,'实验甲');
  await page.getByLabel('偏好称呼',{exact:true}).fill('小甲');await page.getByLabel('交流偏好',{exact:true}).fill('请简短回答。');
  await page.getByRole('button',{name:'保存偏好',exact:true}).click();await ready(page);
  await create(page,'实验乙');assert.equal(await page.getByLabel('偏好称呼',{exact:true}).inputValue(),'');
  await page.getByLabel('偏好称呼',{exact:true}).fill('小乙');await page.getByRole('button',{name:'保存偏好',exact:true}).click();await ready(page);
  await page.getByLabel('选择档案',{exact:true}).selectOption(pidA);await ready(page);
  assert.equal(await page.getByLabel('偏好称呼',{exact:true}).inputValue(),'小甲');assert.equal(await page.getByLabel('交流偏好',{exact:true}).inputValue(),'请简短回答。');
  await page.reload();await page.getByRole('status',{name:'播放状态'}).filter({hasText:/三维头部已就绪/}).waitFor();
  // Browser stores only a choice. The values must be read afresh from the service.
  state.profiles.get(pidA).preferences.preferred_name='服务端更新';await connect(page);
  assert.equal(await page.getByLabel('偏好称呼',{exact:true}).inputValue(),'服务端更新');
  assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])),[['digit-robot.selected-profile',pidA]]);
  const hostile='<img src=x onerror=alert(1)>';
  await page.getByLabel('档案名称',{exact:true}).fill(hostile);await page.getByRole('button',{name:'修改档案名称',exact:true}).click();await ready(page);
  assert.equal(await page.getByLabel('当前档案',{exact:true}).textContent(),hostile);assert.equal(await page.locator('#profile-panel img').count(),0);
  await page.getByRole('button',{name:'清空偏好',exact:true}).click();await ready(page);
  assert.equal(await page.getByLabel('偏好称呼',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('交流偏好',{exact:true}).inputValue(),'');
  await page.getByRole('button',{name:'删除档案',exact:true}).click();await ready(page);assert.equal(await page.getByLabel('当前档案',{exact:true}).textContent(),'匿名');
  await page.getByRole('button',{name:'重新读取档案',exact:true}).click();await ready(page);
  assert.equal(await page.getByLabel('选择档案',{exact:true}).locator('option').filter({hasText:hostile}).count(),0);
 }finally{await page.close();}
});

async function send(page){await page.getByLabel('输入中文').fill('你好');await page.getByRole('button',{name:'发送并播放回复'}).click();}
test('editing a profile immediately stops actual audio and blocks new turns until server confirmation',async()=>{
 const state=service();state.speak=true;const gate=deferred(),entered=deferred();
 const {page}=await setup(state);try{
  await connect(page);await create(page,'实验甲');await send(page);await page.waitForFunction(()=>document.querySelector('audio').currentTime>.15);
  state.before=async({p,m,json})=>{if(p==='/v1/profiles/'+pidA&&m==='PATCH'){entered.resolve();await gate.promise;return false;}};
  await page.getByLabel('档案名称',{exact:true}).fill('新档案');await page.getByRole('button',{name:'修改档案名称',exact:true}).click();await entered.promise;
  assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);assert.equal(await page.getByLabel('嘴部开合').textContent(),'0.00');
  for(const name of ['发送并播放回复','开始发言','创建并选择档案'])assert.equal(await page.getByRole('button',{name,exact:true}).isDisabled(),true);
  gate.resolve();await ready(page);await send(page);
  await page.getByLabel('数字人回复').filter({hasText:'你好，新档案'}).waitFor();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.15);
  assert.equal(JSON.parse(await page.locator('#frame').textContent()).session_epoch,2);
 }finally{gate.resolve();await page.close();}
});
test('switching profiles aborts a pending audio download and cannot replay its old response',async()=>{
 const state=service();state.speak=true;const gate=deferred(),entered=deferred();let first=true;
 state.before=async({route,p})=>{if(p.endsWith('/audio')&&first){first=false;entered.resolve();await gate.promise;await route.fulfill({status:200,contentType:'audio/wav',body:wav()}).catch(()=>{});return true;}};
 const {page}=await setup(state);try{
  await connect(page);await create(page,'实验甲');await send(page);await entered.promise;
  const aborted=page.waitForEvent('requestfailed',{predicate:r=>r.url().endsWith('/audio'),timeout:3000});
  await page.getByLabel('选择档案',{exact:true}).selectOption('');await ready(page);
  await aborted;gate.resolve();await page.waitForTimeout(100);
  assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);assert.equal(await page.getByLabel('数字人回复').textContent(),'回复将在这里显示。');
  await send(page);await page.getByLabel('数字人回复').filter({hasText:'你好，匿名'}).waitFor();
 }finally{gate.resolve();await page.close();}
});
test('failed preference writes stay visible and block turns until retry or confirmed server refresh',async()=>{
 const {page,state}=await setup();try{
  await connect(page);await create(page,'实验甲');
  let fail=true;state.before=async({p,m,json})=>{if(p.endsWith('/preferences')&&m==='PATCH'&&fail){fail=false;await json({type:'error',code:'profile_store_unavailable',message:'档案暂时无法保存'},503);return true;}};
  await page.getByLabel('偏好称呼',{exact:true}).fill('未保存称呼');await page.getByRole('button',{name:'保存偏好',exact:true}).click();
  await page.getByRole('status',{name:'档案状态'}).filter({hasText:/无法保存/}).waitFor();
  assert.equal(await page.getByRole('button',{name:'发送并播放回复'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'开始发言'}).isDisabled(),true);
  await page.getByRole('button',{name:'重新读取档案',exact:true}).click();await ready(page);
  assert.equal(await page.getByLabel('偏好称呼',{exact:true}).inputValue(),'');
  await page.getByLabel('偏好称呼',{exact:true}).fill('重试称呼');await page.getByRole('button',{name:'保存偏好',exact:true}).click();await ready(page);
  await page.getByRole('button',{name:'重新读取档案',exact:true}).click();await ready(page);assert.equal(await page.getByLabel('偏好称呼',{exact:true}).inputValue(),'重试称呼');
  assert.equal(await page.getByRole('button',{name:'发送并播放回复'}).isDisabled(),false);
 }finally{await page.close();}
});
test('a mutation carrying another session epoch confirms this session before the next turn',async()=>{
 const {page,state}=await setup();try{
  await connect(page);await create(page,'实验甲');
  state.before=async({p,m,input,json})=>{if(p==='/v1/profiles/'+pidA&&m==='PATCH'){
   const profile=state.profiles.get(pidA);profile.display_name=input.display_name;for(const s of state.sessions.values())s.session_epoch++;
   await json({profile,affected_sessions:[{session_id:'other-session',session_epoch:95,state:'idle',profile_id:pidA}]});return true;
  }};
  await page.getByLabel('档案名称',{exact:true}).fill('修改后');await page.getByRole('button',{name:'修改档案名称',exact:true}).click();await ready(page);
  await send(page);await page.getByRole('status',{name:'对话状态'}).filter({hasText:/当前档案：修改后/}).waitFor();
 }finally{await page.close();}
});
test('a delayed preference read cannot overwrite the explicitly rebound profile after reconnect',async()=>{
 const {page,state}=await setup();const gate=deferred(),entered=deferred();try{
  await connect(page);await create(page,'实验甲');await create(page,'实验乙');
  await page.getByLabel('选择档案',{exact:true}).selectOption(pidA);await ready(page);
  let once=true;state.before=async({p,m,json})=>{if(p==='/v1/profiles/'+pidB+'/preferences'&&m==='GET'&&once){once=false;entered.resolve();await gate.promise;await json({preferred_name:'迟到的乙',communication_style:'乙的偏好'}).catch(()=>{});return true;}};
  await page.getByLabel('选择档案',{exact:true}).selectOption(pidB);await entered.promise;
  await connect(page);assert.equal(await page.getByLabel('当前档案',{exact:true}).textContent(),'实验甲');
  gate.resolve();await page.waitForTimeout(150);assert.equal(await page.getByLabel('当前档案',{exact:true}).textContent(),'实验甲');assert.equal(await page.getByLabel('偏好称呼',{exact:true}).inputValue(),'');
  await send(page);await page.getByRole('status',{name:'对话状态'}).filter({hasText:/当前档案：实验甲/}).waitFor();
 }finally{gate.resolve();await page.close();}
});
test('service restart reconnect binds a valid saved choice and visibly clears a deleted choice',async()=>{
 const {page,state}=await setup();try{
  await connect(page);await create(page,'实验甲');
  state.sessions.clear();state.profiles.get(pidA).preferences={preferred_name:'重启后新值',communication_style:null};
  await connect(page);assert.equal(await page.getByLabel('当前档案',{exact:true}).textContent(),'实验甲');assert.equal(await page.getByLabel('偏好称呼',{exact:true}).inputValue(),'重启后新值');
  state.profiles.delete(pidA);state.sessions.clear();await connect(page);
  assert.equal(await page.getByLabel('当前档案',{exact:true}).textContent(),'匿名');assert.match(await page.getByRole('status',{name:'档案状态'}).textContent(),/不存在/);
  assert.equal(await page.evaluate(()=>localStorage.getItem('digit-robot.selected-profile')),null);
  assert.equal(await page.getByRole('button',{name:'发送并播放回复'}).isDisabled(),false);
 }finally{await page.close();}
});
test('local audio invalidating an unconfirmed profile switch requires a fresh server read before dialogue',async()=>{
 const {page,state}=await setup();const gate=deferred(),entered=deferred();try{
  await connect(page);await create(page,'实验甲');await create(page,'实验乙');
  await page.getByLabel('选择档案',{exact:true}).selectOption(pidA);await ready(page);
  state.before=async({p,input})=>{if(p.endsWith('/profile')&&input.profile_id===pidB){entered.resolve();await gate.promise;return false;}};
  await page.getByLabel('选择档案',{exact:true}).selectOption(pidB);await entered.promise;
  await page.getByRole('button',{name:'载入中文录音示例'}).click();await page.getByRole('status',{name:'播放状态'}).filter({hasText:/音频已就绪/}).waitFor();
  gate.resolve();await ready(page);
  assert.equal(await page.getByRole('button',{name:'发送并播放回复'}).isDisabled(),true);
  assert.match(await page.getByRole('status',{name:'档案状态'}).textContent(),/重新读取|重新连接/);
  await page.getByRole('button',{name:'重新读取档案',exact:true}).click();await ready(page);
  assert.equal(await page.getByLabel('当前档案',{exact:true}).textContent(),'实验乙');await send(page);await page.getByRole('status',{name:'对话状态'}).filter({hasText:/当前档案：实验乙/}).waitFor();
 }finally{gate.resolve();await page.close();}
});
test('preference mutation cancels playing sentences and prefetched later audio without reviving the queue',async()=>{
 const state=service();state.streaming=true;const gate=deferred(),entered=deferred();let first=true;
 state.before=async({route,p,json})=>{
  if(p.startsWith('/v2/')&&p.endsWith('/text')){
   const sid=p.split('/')[3],s=state.sessions.get(sid),uid='sentence-'+s.session_epoch,events=[];
   const emit=(type,fields={})=>events.push({type,session_id:sid,session_epoch:s.session_epoch,utterance_id:uid,...fields});
   emit('start');emit('meta',{user_emotion:'neutral',expression_intent:{style:'calm',intensity:.5}});
   for(let i=0;i<2;i++){const text=i?'请慢慢说。':'你好。';emit('sentence',{segment_index:i,text});emit('audio_ready',{segment_index:i,text,audio:{url:`/v2/sessions/${sid}/turns/${uid}/segments/${i}/audio`,mime_type:'audio/wav',sample_rate_hz:16000,channels:1,duration_ms:4000}});}
   emit('done',{status:'ok',reply:'你好。请慢慢说。',timings_ms:{}});
   await route.fulfill({status:200,contentType:'application/x-ndjson',body:events.map(e=>JSON.stringify(e)).join('\n')+'\n'});return true;
  }
  if(p.startsWith('/v2/')&&p.endsWith('/audio')){
   if(p.endsWith('/segments/1/audio')&&first){first=false;entered.resolve();await gate.promise;}
   await route.fulfill({status:200,contentType:'audio/wav',body:wav()}).catch(()=>{});return true;
  }
 };
 const {page}=await setup(state);try{
  await connect(page);await create(page,'实验甲');await send(page);await entered.promise;await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
  const aborted=page.waitForEvent('requestfailed',{predicate:r=>r.url().endsWith('/segments/1/audio')});
  await page.getByRole('button',{name:'清空偏好',exact:true}).click();await ready(page);await aborted;
  gate.resolve();await page.waitForTimeout(150);
  assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);assert.equal(await page.getByLabel('嘴部开合').textContent(),'0.00');assert.equal(await page.getByLabel('数字人回复').textContent(),'回复将在这里显示。');
  await send(page);await page.waitForFunction(()=>{try{return JSON.parse(document.querySelector('#frame').textContent).session_epoch===2&&!document.querySelector('audio').paused;}catch{return false;}});
 }finally{gate.resolve();await page.close();}
});
test('changing profiles clears the previous response playback record and disables its download',async()=>{
 const {page,state}=await setup();state.speak=true;try{
  await connect(page);await create(page,'实验甲');await send(page);await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
  await page.getByText('播放记录',{exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'下载播放记录',exact:true}).isDisabled(),false);
  await page.getByLabel('档案名称',{exact:true}).fill('改名后');await page.getByRole('button',{name:'修改档案名称',exact:true}).click();await ready(page);
  assert.equal(await page.getByRole('button',{name:'下载播放记录',exact:true}).isDisabled(),true);assert.equal(await page.locator('#frame').textContent(),'尚无播放记录');
  await send(page);await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
  await page.getByLabel('选择档案',{exact:true}).selectOption('');await ready(page);
  assert.equal(await page.getByRole('button',{name:'下载播放记录',exact:true}).isDisabled(),true);assert.equal(await page.locator('#frame').textContent(),'尚无播放记录');
 }finally{await page.close();}
});

test('failed preference reads after binding another profile clear stale identity and forbid writes until explicit refresh',async()=>{
 const {page,state}=await setup();try{
  await connect(page);await create(page,'实验甲');
  await page.getByLabel('偏好称呼',{exact:true}).fill('甲的称呼');await page.getByLabel('交流偏好',{exact:true}).fill('甲的偏好');
  await page.getByRole('button',{name:'保存偏好',exact:true}).click();await ready(page);
  await create(page,'实验乙');
  await page.getByLabel('偏好称呼',{exact:true}).fill('乙的称呼');await page.getByLabel('交流偏好',{exact:true}).fill('乙的偏好');
  await page.getByRole('button',{name:'保存偏好',exact:true}).click();await ready(page);
  await page.getByLabel('选择档案',{exact:true}).selectOption(pidA);await ready(page);
  let unavailable=true;state.before=async({p,m,json})=>{if(p==='/v1/profiles/'+pidB+'/preferences'&&m==='GET'&&unavailable){await json({type:'error',code:'profile_store_unavailable',message:'乙的档案暂时无法读取'},503);return true;}};
  await page.getByLabel('选择档案',{exact:true}).selectOption(pidB);
  await page.getByRole('status',{name:'档案状态'}).filter({hasText:/暂时无法读取/}).waitFor();await ready(page);
  const actions=['创建并选择档案','修改档案名称','保存偏好','清空偏好','删除档案'];
  for(const name of actions)assert.equal(await page.getByRole('button',{name,exact:true}).isDisabled(),true,name+' must require a confirmed profile');
  assert.equal(await page.getByLabel('当前档案',{exact:true}).textContent(),'档案未确认');
  for(const label of ['档案名称','偏好称呼','交流偏好'])assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),'','stale '+label+' must be cleared');
  assert.equal(await page.getByRole('button',{name:'发送并播放回复',exact:true}).isDisabled(),true);
  const start=state.requests.length;
  // Native button activation, including keyboard/script activation, cannot issue writes while unconfirmed.
  for(const name of actions)await page.getByRole('button',{name,exact:true}).evaluate(button=>button.click());
  assert.equal(state.requests.slice(start).some(request=>request.p.startsWith('/v1/profiles')&&request.m!=='GET'),false);
  unavailable=false;await page.getByRole('button',{name:'重新读取档案',exact:true}).click();await ready(page);
  assert.equal(await page.getByLabel('当前档案',{exact:true}).textContent(),'实验乙');
  assert.equal(await page.getByLabel('偏好称呼',{exact:true}).inputValue(),'乙的称呼');assert.equal(await page.getByLabel('交流偏好',{exact:true}).inputValue(),'乙的偏好');
  await page.getByLabel('偏好称呼',{exact:true}).fill('乙的新称呼');await page.getByRole('button',{name:'保存偏好',exact:true}).click();await ready(page);
  await page.getByRole('button',{name:'重新读取档案',exact:true}).click();await ready(page);assert.equal(await page.getByLabel('偏好称呼',{exact:true}).inputValue(),'乙的新称呼');
  await page.getByLabel('选择档案',{exact:true}).selectOption(pidA);await ready(page);
  assert.equal(await page.getByLabel('当前档案',{exact:true}).textContent(),'实验甲');assert.equal(await page.getByLabel('偏好称呼',{exact:true}).inputValue(),'甲的称呼');assert.equal(await page.getByLabel('交流偏好',{exact:true}).inputValue(),'甲的偏好');
 }finally{await page.close();}
});
