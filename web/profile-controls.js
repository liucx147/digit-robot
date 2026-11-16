const storageKey = 'digit-robot.selected-profile';
export function attachProfileControls({stop,onChange,settled}) {
  const $ = selector => document.querySelector(selector);
  let client, version = 0, pending = false, blocked = true, selected = null, profiles = [], preferences = {};
  const confirmed = value => { if (!value) throw new Error('档案确认已中断，请重新读取档案或重新连接'); return value; };
  const notice = (text, failed = false) => { $('#profile-status').textContent = text; $('#profile-status').classList.toggle('error', failed); };
  function refresh() {
    $('#profile-panel').querySelectorAll('input,select,textarea,button').forEach(el => el.disabled = pending || !client);
    $('#profile-create').disabled ||= blocked;
    for (const id of ['profile-rename','profile-delete','profile-preferred-name','profile-communication-style','profile-save','profile-clear']) $('#' + id).disabled ||= blocked || !selected;
    onChange();
  }
  function render() {
    const select = $('#profile-select'); select.replaceChildren(new Option('匿名（不保存偏好）',''));
    for (const profile of profiles) select.add(new Option(profile.display_name,profile.profile_id));
    select.value = selected || '';
    const profile = profiles.find(p => p.profile_id === selected);
    $('#profile-current').textContent = profile?.display_name || '匿名';
    $('#profile-name').value = profile?.display_name || '';
    $('#profile-preferred-name').value = preferences.preferred_name || '';
    $('#profile-communication-style').value = preferences.communication_style || '';
    try { if (selected) localStorage.setItem(storageKey,selected); else localStorage.removeItem(storageKey); } catch { /* Selection persistence is optional. */ }
  }
  function clearUnconfirmedView() {
    preferences = {};
    $('#profile-current').textContent = '档案未确认';
    for (const id of ['profile-name','profile-preferred-name','profile-communication-style']) $('#' + id).value = '';
  }
  async function readPreferences(active,current,id) {
    const values = id ? await active.preferences(id) : {};
    if (current()) { selected = id; preferences = values; }
  }
  async function readProfiles(active,current) {
    const value = await active.profiles();
    if (current()) profiles = value.profiles;
  }
  async function operation(task) {
    if (pending || !client) return;
    const stamp = ++version, active = client;
    const current = () => stamp === version && client === active;
    pending = true; blocked = true; stop(); refresh(); notice('正在更新档案…');
    try {
      const message = await task(active,current);
      if (!current()) return;
      blocked = false; render(); notice(message || '档案已就绪。'); settled(false);
    } catch (error) {
      if (!current()) return;
      clearUnconfirmedView();
      notice('档案操作失败：' + error.message + '。请重新读取档案或重试。', true); settled(true);
    } finally { if (current()) { pending = false; refresh(); } }
  }
  $('#profile-select').addEventListener('change', () => {
    const id = $('#profile-select').value || null;
    operation(async (active,current) => { const next = confirmed(await active.bindProfile(id)); if (current() && next) await readPreferences(active,current,next.profile_id); });
  });
  $('#profile-create').addEventListener('click', () => {
    if (blocked) return;
    const name = $('#profile-name').value.trim();
    if (!name) { notice('请填写档案名称。',true); return; }
    operation(async (active,current) => {
      const profile = await active.createProfile(name);
      if (!current()) return;
      const next = confirmed(await active.bindProfile(profile.profile_id));
      if (!current() || !next) return;
      await readProfiles(active,current);
      if (current()) await readPreferences(active,current,next.profile_id);
    });
  });
  const mutate = task => {
    if (blocked || !selected) return;
    return operation(async (active,current) => {
      const value = confirmed(await task(active,selected));
      if (!current() || !value) return;
      const next = confirmed(await active.confirmProfileSession());
      if (!current() || !next) return;
      await readProfiles(active,current);
      if (current()) await readPreferences(active,current,next.profile_id);
    });
  };
  $('#profile-rename').addEventListener('click', () => {
    const name = $('#profile-name').value.trim();
    if (!name) { notice('请填写档案名称。',true); return; }
    mutate((active,id) => active.renameProfile(id,name));
  });
  $('#profile-save').addEventListener('click', () => {
    const values = {preferred_name:$('#profile-preferred-name').value,communication_style:$('#profile-communication-style').value};
    mutate((active,id) => active.savePreferences(id,values));
  });
  $('#profile-clear').addEventListener('click', () => mutate((active,id) => active.clearPreferences(id)));
  $('#profile-delete').addEventListener('click', () => mutate((active,id) => active.deleteProfile(id)));
  $('#profile-refresh').addEventListener('click', () => operation(async (active,current) => {
    const previous = selected;
    await readProfiles(active,current);
    if (!current()) return;
    const next = confirmed(await active.confirmProfileSession());
    if (!current() || !next) return;
    await readPreferences(active,current,next.profile_id);
    return previous && !selected ? '之前选择的档案已不存在，请重新选择。' : '已读取最新档案和偏好。';
  }));
  return {
    get blocked() { return blocked; },
    beginConnect() { version++; client = undefined; pending = false; blocked = true; $('#profile-panel').hidden = true; refresh(); },
    async connect(active) {
      const stamp = version, current = () => stamp === version;
      if (!await active.profilesSupported()) { if (current()) { blocked = false; onChange(); } return; }
      if (!current()) return;
      client = active; pending = true; $('#profile-panel').hidden = false; refresh();
      try {
        await readProfiles(active,current);
        if (!current()) return;
        let saved; try { saved = localStorage.getItem(storageKey); } catch {}
        selected = null; preferences = {};
        if (saved && profiles.some(p => p.profile_id === saved)) {
          const next = confirmed(await active.bindProfile(saved)); if (!current() || !next) return;
          await readPreferences(active,current,saved);
        }
        if (!current()) return;
        render(); blocked = false; notice(saved && !selected ? '之前选择的档案已不存在，请重新选择。' : '请选择档案，或使用匿名对话。');
      } catch (error) { if (!current()) return; clearUnconfirmedView(); notice('档案读取失败：' + error.message,true); throw error; }
      finally { if (current()) { pending = false; refresh(); } }
    }
  };
}
