const KEY = 'digitalhuman.acceptance-journal.v1';
const TYPES = new Set(['attempt-start','input-end','reply-activity','turn-complete','cancelled','failed','connected','capture-start','capture-end','service-restart','restore-interrupted','heartbeat','heartbeat-gap','clock-anomaly','page-hidden','page-visible','page-interrupted','storage-failed','capacity-exceeded','journal-failed']);
const STATUS_LABELS = {recording:'采集中',interrupted:'已中断','service-restart':'服务重启',stopped:'已结束','storage-failed':'保存失败','capacity-exceeded':'容量已满','journal-failed':'记录失败'};
const STAGES = ['turn','playback','connect','stop','local-audio','reconnect','profile-change','pagehide'];
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const numeric = value => Number.isFinite(value) && value >= 0;
const utc = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value);
const short = (value, size = 512) => typeof value === 'string' && value.length <= size;
const empty = () => ({version:1,engineering_acceptance:'not-assessed',boundary:'browser-software-observations-only',segments:[]});
// Explicit projections also apply to restored local drafts: unknown fields never reach export.
function contextSnapshot(value) {
  const asset=value?.asset, renderer=value?.renderer;
  if (!asset || !renderer || !short(asset.version,80) || !short(asset.type,80) || !/^[a-fA-F0-9]{64}$/.test(asset.sha256) || !['renderer','vendor','webgl_version'].every(key=>short(renderer[key])) || !short(value.browser,1024)) throw Error('invalid context');
  return {asset:{version:asset.version,type:asset.type,sha256:asset.sha256},renderer:{renderer:renderer.renderer,vendor:renderer.vendor,webgl_version:renderer.webgl_version},browser:value.browser};
}
function projectEvent(type, value = {}) {
  if (!TYPES.has(type)) throw Error('invalid event');
  const event={type};
  for (const key of ['client_turn_id','session_id','utterance_id']) if (token(value[key])) event[key]=value[key];
  if (['text','microphone'].includes(value.source)) event.source=value.source;
  if (STAGES.includes(value.stage)) event.stage=value.stage;
  for (const key of ['observed_monotonic_ms','epoch','audio_time_ms','input_end_monotonic_ms','reply_activity_monotonic_ms','delta_ms']) if (numeric(value[key])) event[key]=value[key];
  if (utc(value.observed_utc)) event.observed_utc=value.observed_utc;
  return event;
}
function restore(raw) {
  const draft=JSON.parse(raw);
  if (draft.version!==1 || !Array.isArray(draft.segments)) throw Error('invalid draft');
  const data=empty();
  for (const s of draft.segments) {
    if (!token(s.segment_id) || !/^[a-f0-9]{40}$/.test(s.declared_code_sha) || !['software-test','real-combination'].includes(s.conditions) || !utc(s.started_utc) || !numeric(s.started_monotonic_ms) || !Array.isArray(s.events) || !['recording','interrupted','service-restart','stopped','storage-failed','capacity-exceeded','journal-failed'].includes(s.status)) throw Error('invalid segment');
    const segment={segment_id:s.segment_id,declared_code_sha:s.declared_code_sha,conditions:s.conditions,context:contextSnapshot(s.context),started_utc:s.started_utc,started_monotonic_ms:s.started_monotonic_ms,status:s.status,needs_review:s.needs_review===true,observed_ms:numeric(s.observed_ms)?s.observed_ms:0,software_candidate:false,completed_turns:0,events:s.events.map(e=>projectEvent(e.type,e))};
    if (utc(s.ended_utc)) segment.ended_utc=s.ended_utc;
    if (numeric(s.ended_monotonic_ms)) segment.ended_monotonic_ms=s.ended_monotonic_ms;
    // Recompute only complete attempts inside this segment; never add across segments.
    const attempts=new Map();
    for (const e of segment.events) {
      if (e.type==='attempt-start') attempts.set(e.client_turn_id,{input:false,activity:false,terminal:false});
      const a=attempts.get(e.client_turn_id);if(!a||a.terminal)continue;
      if(e.type==='input-end')a.input=true;
      if(e.type==='reply-activity'&&a.input)a.activity=true;
      if(e.type==='turn-complete'&&a.input&&a.activity)segment.completed_turns++;
      if(['turn-complete','failed','cancelled'].includes(e.type))a.terminal=true;
    }
    if (s.status==='recording') {segment.status='interrupted';segment.needs_review=true;segment.ended_utc=new Date().toISOString();segment.events.push(projectEvent('restore-interrupted',{observed_utc:segment.ended_utc}));}
    data.segments.push(segment);
  }
  return data;
}
export function attachAcceptanceJournal() {
  const $=id=>document.getElementById(id);
  let data=empty(),active=null,blocked=false,lastMono=0,lastWall=0,lastVisible=document.visibilityState==='visible';
  const attempts=new Map();
  let ownsDraft=false,ownershipPending=false,releaseOwnership=null,leaving=false;
  const supportsOwnership=typeof navigator.locks?.request==='function';
  function status(text){$('acceptance-status').textContent=text;}
  function candidate(s){s.software_candidate=!s.needs_review&&['recording','stopped'].includes(s.status)&&s.observed_ms>=1800000&&s.completed_turns>=20;}
  function render(){
    for(const s of data.segments)candidate(s);
    $('acceptance-start').disabled=!!active||blocked||ownershipPending||!supportsOwnership;
    $('acceptance-end').disabled=!active;$('acceptance-restart').disabled=!active;
    $('acceptance-sha').disabled=!!active;$('acceptance-conditions').disabled=!!active;
    $('acceptance-summary').textContent=data.segments.length?data.segments.map((s,i)=>`第 ${i+1} 段：观测 ${(s.observed_ms/60000).toFixed(2)} 分钟，完成 ${s.completed_turns} 轮，${STATUS_LABELS[s.status]}，${s.needs_review?'连续性待复核':s.software_candidate?'达到软件计数候选，工程验收待复核':'未达到软件计数候选，工程验收待复核'}`).join('；'):'尚无记录。';
  }
  function halt(reason){
    if(blocked)return;
    const segment=active||data.segments.at(-1);
    if(segment){segment.events.push(projectEvent(reason,{observed_monotonic_ms:performance.now(),observed_utc:new Date().toISOString()}));segment.status=reason;segment.needs_review=true;segment.software_candidate=false;segment.ended_monotonic_ms=performance.now();segment.ended_utc=new Date().toISOString();}
    active=null;blocked=true;attempts.clear();
    status(reason==='capacity-exceeded'?'记录容量已满，采集已停止；内存记录完整保留，请下载后再显式清空。':'本机草稿保存或记录失败，采集已停止；请立即下载内存记录，再显式清空后重试。');render();
  }
  function save(){
    if(blocked||!ownsDraft)return;
    for(const s of data.segments)candidate(s);
    const raw=JSON.stringify(data);
    if(data.segments.reduce((n,s)=>n+s.events.length,0)>10000||raw.length>2*1024*1024){halt('capacity-exceeded');return;}
    try{localStorage.setItem(KEY,raw);}catch{halt('storage-failed');}
  }
  function context(){try{const canvas=$('avatar');return contextSnapshot({asset:JSON.parse(canvas.dataset.avatar||'null'),renderer:JSON.parse(canvas.dataset.renderer||'null'),browser:navigator.userAgent});}catch{return null;}}
  function append(type,value={}){const e=projectEvent(type,value);e.observed_monotonic_ms=performance.now();e.observed_utc=new Date().toISOString();active.events.push(e);return e;}
  function account(){
    if(!active)return;
    const now=performance.now(),wall=Date.now(),delta=now-lastMono,utcDelta=wall-lastWall;
    if(delta<0||Math.abs(utcDelta-delta)>2000){active.needs_review=true;append('clock-anomaly');}
    else if(delta>5000){active.needs_review=true;append('heartbeat-gap',{delta_ms:delta});}
    else if(lastVisible&&document.visibilityState==='visible')active.observed_ms+=delta;
    lastMono=now;lastWall=wall;lastVisible=document.visibilityState==='visible';
  }
  function finish(type){if(!active)return;account();append(type);active.status=type==='service-restart'?'service-restart':type==='page-interrupted'?'interrupted':'stopped';active.needs_review ||= type==='service-restart'||type==='page-interrupted';active.ended_utc=new Date().toISOString();active.ended_monotonic_ms=performance.now();active=null;attempts.clear();save();if(!blocked)status('本段已结束；软件记录候选，工程验收待复核。');render();}
  function readDraft(){
    try{const raw=localStorage.getItem(KEY);data=raw===null?empty():restore(raw);return true;}
    catch{blocked=true;status('本机草稿无法读取。请先保管原草稿；显式清空后才能开始。');render();return false;}
  }
  // Viewing/restoring is read-only. All mutations share one browser-managed lock,
  // held for the page lifetime, including stopped, failed and explicitly cleared drafts.
  // A new owner must re-read under the lock instead of publishing its stale snapshot.
  async function mutateDraft(action){
    if(ownsDraft){action(false);return;}
    if(ownershipPending||leaving)return;
    if(!supportsOwnership){status('浏览器不支持安全的跨页面草稿所有权，验收采集与清空不可用；仍可下载内存记录，业务功能照常。');return;}
    ownershipPending=true;render();
    try{
      await navigator.locks.request(KEY,{mode:'exclusive',ifAvailable:true},async lock=>{
        if(!lock){status('另一个页面持有验收草稿，不能采集或清空；请先下载所需记录并关闭该页面，再重试。本页内存快照仍可下载。');return;}
        if(leaving)return;
        ownsDraft=true;
        const held=new Promise(resolve=>{releaseOwnership=resolve;});
        ownershipPending=false;
        try{action(true);}catch{halt('journal-failed');}
        render();await held;ownsDraft=false;releaseOwnership=null;
      });
    }catch{status('无法取得安全的草稿写入权限；采集未开始，内存记录仍可下载。');}
    finally{ownershipPending=false;render();}
  }
  if(readDraft()&&data.segments.length)status('已读取本机草稿快照，旧采集不自动继续；开始新段时重新读取，其他页面可能仍在采集。工程验收待复核。');
  if(!supportsOwnership)status('浏览器不支持安全的跨页面草稿所有权，验收采集与清空不可用；仍可下载内存记录，业务功能照常。');
  $('acceptance-start').addEventListener('click',()=>{
    const code=$('acceptance-sha').value.trim(),conditions=$('acceptance-conditions').value,snapshot=context();
    if(active||blocked)return;
    if(!/^[a-fA-F0-9]{40}$/.test(code)||!['software-test','real-combination'].includes(conditions)||!snapshot){status('请填写完整冻结代码 SHA、运行条件，并等待三维头部就绪。');return;}
    void mutateDraft(fresh=>{
      if(fresh&&!readDraft())return;
      active={segment_id:crypto.randomUUID(),declared_code_sha:code.toLowerCase(),conditions,context:snapshot,started_utc:new Date().toISOString(),started_monotonic_ms:performance.now(),events:[],completed_turns:0,observed_ms:0,software_candidate:false,needs_review:document.visibilityState!=='visible',status:'recording'};
      attempts.clear();lastMono=performance.now();lastWall=Date.now();lastVisible=document.visibilityState==='visible';data.segments.push(active);append('capture-start');save();if(active)status('正在采集；仅软件记录候选，工程验收待复核。');render();
    });
  });
  function observe(type,value={}){
    if(!active)return;
    account();
    const event=projectEvent(type,value);
    if(type==='attempt-start')attempts.set(event.client_turn_id,{input:false,activity:false,terminal:false});
    const attempt=attempts.get(event.client_turn_id);
    if(!['connected','failed'].includes(type)&&(!attempt||attempt.terminal))return;
    if(attempt?.terminal)return;
    if(type==='input-end')attempt.input=true;
    if(type==='reply-activity'&&attempt.input)attempt.activity=true;
    if(type==='turn-complete'){if(attempt.input&&attempt.activity)active.completed_turns++;attempt.terminal=true;}
    if(['failed','cancelled'].includes(type)&&attempt)attempt.terminal=true;
    append(type,event);save();render();
  }
  $('acceptance-end').addEventListener('click',()=>finish('capture-end'));
  $('acceptance-restart').addEventListener('click',()=>finish('service-restart'));
  $('acceptance-clear').addEventListener('click',()=>{void mutateDraft(()=>{try{localStorage.removeItem(KEY);data=empty();active=null;blocked=false;attempts.clear();status('本机验收草稿已清空。');render();}catch{halt('storage-failed');status('清空失败，采集已停止；原草稿与内存记录已保留，请先下载。');}});});
  $('acceptance-export').addEventListener('click',()=>{if(active){account();save();render();}const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='acceptance-journal.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  setInterval(()=>{if(!active)return;account();append('heartbeat');save();render();},1000);
  document.addEventListener('visibilitychange',()=>{if(!active)return;account();active.needs_review=true;append(document.visibilityState==='hidden'?'page-hidden':'page-visible');save();render();});
  window.addEventListener('pagehide',()=>{leaving=true;finish('page-interrupted');releaseOwnership?.();});
  window.addEventListener('pageshow',()=>{leaving=false;});
  render();return {observe(type,value){try{observe(type,value);}catch{halt('journal-failed');}}};
}
