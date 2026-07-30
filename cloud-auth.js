/* Browser account, login, and cloud-save adapter.
 * API keys and local preferences intentionally remain in the player's browser.
 * Only game saves are synchronized to the authenticated account. */
(function () {
  var cfg = window.DZ_WEB_CONFIG || {};
  var client = null;
  var currentUser = null;
  var suppressWrite = false;
  var writeTimer = null;
  var authBusy = false;
  var profileRequired = false;
  window.DZCloudAccessToken = '';
  window.DZCloud = {
    get accessToken() {
      return client && currentUser
        ? client.auth.getSession().then(function (r) { return (r.data.session && r.data.session.access_token) || ''; })
        : Promise.resolve('');
    },
    get user() { return currentUser; },
    client: null
  };

  function displayName(user) {
    return user && user.user_metadata && String(user.user_metadata.display_name || '').trim() || '';
  }
  function accountName(user) { return displayName(user) || (user && user.email) || '未登录'; }
  function providerName(user) {
    var provider = user && user.app_metadata && user.app_metadata.provider;
    return provider === 'discord' ? 'Discord' : provider === 'email' ? '邮箱魔法链接' : '已连接账户';
  }
  function gate() { return document.getElementById('dz-auth-gate'); }
  function panel() { return document.getElementById('dz-account-panel'); }
  function toast(message) {
    var el = document.getElementById('dz-cloud-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function setStatus(message, bad) {
    var el = document.getElementById('dz-auth-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('bad', !!bad);
  }
  function setProfileStatus(message, bad) {
    var el = document.getElementById('dz-profile-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('bad', !!bad);
  }
  function setBusy(busy) {
    authBusy = !!busy;
    ['dz-email-login', 'dz-discord-login'].forEach(function (id) {
      var button = document.getElementById(id);
      if (button) button.disabled = authBusy;
    });
  }
  function renderAccount() {
    var gateEl = gate();
    var name = document.getElementById('dz-account-name');
    var button = document.getElementById('dz-account-button');
    if (gateEl) gateEl.classList.toggle('hidden', !!currentUser);
    if (name) name.textContent = currentUser ? accountName(currentUser) : '登录以同步存档';
    if (button) button.textContent = currentUser ? '账户' : '登录';
    if (document.body) document.body.classList.toggle('story-bg-ready', !!currentUser);
  }
  function updateProfilePanel() {
    if (!currentUser) return;
    var email = document.getElementById('dz-profile-email');
    var provider = document.getElementById('dz-profile-provider');
    var input = document.getElementById('dz-profile-name');
    if (email) email.textContent = currentUser.email || '未提供邮箱';
    if (provider) provider.textContent = providerName(currentUser);
    if (input && document.activeElement !== input) input.value = displayName(currentUser);
  }
  function openAccount(required) {
    if (!currentUser) { if (gate()) gate().classList.remove('hidden'); return; }
    profileRequired = !!required;
    updateProfilePanel();
    setProfileStatus(required ? '请先设置一个普通用户名，它会显示在网页账户中心。' : '', false);
    var close = document.getElementById('dz-profile-close');
    if (close) close.style.display = required ? 'none' : '';
    if (panel()) panel().classList.add('show');
    setTimeout(function () { var input = document.getElementById('dz-profile-name'); if (input) input.focus(); }, 30);
  }
  function closeAccount() {
    if (profileRequired) return;
    if (panel()) panel().classList.remove('show');
  }
  function saveProfile() {
    if (!currentUser || !client) return;
    var input = document.getElementById('dz-profile-name');
    var name = String(input && input.value || '').trim();
    if (name.length < 2 || name.length > 24) { setProfileStatus('用户名请使用 2 到 24 个字符。', true); return; }
    var save = document.getElementById('dz-profile-save');
    if (save) save.disabled = true;
    setProfileStatus('正在保存用户名…');
    client.auth.updateUser({ data: { display_name: name } }).then(function (r) {
      if (save) save.disabled = false;
      if (r.error || !r.data || !r.data.user) { setProfileStatus('保存失败：' + ((r.error && r.error.message) || '请稍后重试。'), true); return; }
      currentUser = r.data.user;
      renderAccount(); updateProfilePanel();
      profileRequired = false;
      setProfileStatus('用户名已保存。');
      toast('账户资料已更新。');
      setTimeout(closeAccount, 450);
    }).catch(function () { if (save) save.disabled = false; setProfileStatus('网络连接失败，请稍后重试。', true); });
  }
  function signOutNow() {
    if (!client) return;
    /* Local logout updates the UI immediately; cloud data remains untouched. */
    currentUser = null;
    window.DZCloudAccessToken = '';
    profileRequired = false;
    closeAccount(); renderAccount();
    toast('已退出当前设备。');
    client.auth.signOut({ scope: 'local' }).catch(function () { toast('本地登录状态已清除。'); });
  }
  function ensureUi() {
    if (document.getElementById('dz-auth-gate')) return;
    var style = document.createElement('style');
    style.textContent = [
      '#dz-auth-gate{position:fixed;inset:0;z-index:3000;display:grid;place-items:center;padding:24px;overflow:auto;color:#25375f;background:linear-gradient(110deg,rgba(231,245,255,.90) 0%,rgba(243,249,255,.60) 45%,rgba(235,246,255,.84) 100%),url(\'https://cdn.jsdelivr.net/gh/IMCEZ/cute-disciple-system-web@main/assets/menu-bg.png\') center/cover no-repeat}#dz-auth-gate:before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse 60% 65% at 70% 48%,rgba(255,255,255,.78),rgba(255,255,255,0) 72%);pointer-events:none}#dz-auth-gate.hidden{display:none}',
      '.dz-auth-card,.dz-profile-card{position:relative;width:min(100%,452px);padding:34px 31px 27px;border:1px solid rgba(255,255,255,.86);border-radius:28px;background:rgba(255,255,255,.78);box-shadow:0 24px 74px rgba(50,102,170,.22),inset 0 1px 0 rgba(255,255,255,.96);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);text-align:center}.dz-auth-orbit{width:60px;height:60px;margin:0 auto 15px;border-radius:22px;background:linear-gradient(145deg,#dbeeff,#75a9f3);box-shadow:0 10px 26px rgba(70,130,215,.27);display:grid;place-items:center}.dz-auth-orbit i{width:23px;height:23px;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 5px rgba(255,255,255,.27);display:block}.dz-auth-kicker{font-size:11px;letter-spacing:.17em;color:#5c8ed9;font-weight:750;margin-bottom:7px}.dz-auth-card h1,.dz-profile-card h2{font-size:25px;letter-spacing:.04em;margin:0 0 10px;color:#26385f}.dz-auth-card p,.dz-profile-lead{font-size:13px;line-height:1.75;color:#647492;margin:0 auto 21px;max-width:335px}.dz-auth-form,.dz-profile-form{text-align:left}.dz-auth-label,.dz-profile-label{display:block;font-size:12px;color:#536786;font-weight:700;margin:0 0 7px}.dz-auth-card input,.dz-profile-card input{width:100%;border:1px solid #d4e1f5;border-radius:13px;padding:13px 14px;background:rgba(255,255,255,.88);font-size:14px;color:#26385f;outline:none;transition:.2s}.dz-auth-card input:focus,.dz-profile-card input:focus{border-color:#72a4ec;box-shadow:0 0 0 4px rgba(104,158,235,.16)}',
      '.dz-auth-card button,.dz-profile-card button{width:100%;min-height:46px;border:1px solid transparent;border-radius:13px;padding:11px 14px;margin-top:10px;cursor:pointer;font-size:14px;font-weight:750;letter-spacing:.02em;transition:transform .16s,box-shadow .16s,filter .16s}.dz-auth-card button:hover,.dz-profile-card button:hover{transform:translateY(-1px);filter:brightness(1.02)}.dz-auth-card button:disabled,.dz-profile-card button:disabled{cursor:wait;opacity:.66;transform:none}.dz-email-login,.dz-profile-save{background:linear-gradient(135deg,#5d91e9,#83b5fb);color:#fff;box-shadow:0 8px 18px rgba(72,130,220,.24)}.dz-discord-login,.dz-profile-secondary{background:rgba(255,255,255,.82);color:#3d4e78;border-color:#d6e2f5!important;box-shadow:0 5px 14px rgba(71,111,170,.08)}.dz-discord-login .discord-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;background:#5865f2;vertical-align:1px}.dz-auth-divider{display:flex;align-items:center;gap:10px;margin:16px 0 1px;color:#9aa9c0;font-size:11px}.dz-auth-divider:before,.dz-auth-divider:after{content:"";height:1px;flex:1;background:#dfe8f5}.dz-auth-card #dz-auth-status,.dz-profile-status{min-height:20px;margin-top:12px;font-size:12px;line-height:1.5;color:#3d896b}.dz-auth-card #dz-auth-status.bad,.dz-profile-status.bad{color:#c34c64}.dz-auth-note{margin:15px 0 0;color:#8797b1;font-size:11px;line-height:1.65}.dz-auth-note strong{color:#628de0;font-weight:700}',
      '#dz-cloud-account{position:fixed;top:max(12px,env(safe-area-inset-top));right:12px;z-index:530;display:flex;align-items:center;gap:8px;border:1px solid rgba(128,161,212,.25);border-radius:14px;background:rgba(255,255,255,.78);padding:7px 8px 7px 11px;box-shadow:0 4px 16px rgba(45,65,110,.11);backdrop-filter:blur(8px);font-size:11px;color:#53617b}#dz-cloud-account button{border:0;border-radius:8px;background:#eaf3ff;color:#4d7fd1;cursor:pointer;font-size:11px;font-weight:700;padding:5px 7px}#dz-cloud-toast{position:fixed;left:50%;bottom:86px;z-index:3300;transform:translate(-50%,16px);opacity:0;pointer-events:none;background:#253858;color:#fff;padding:10px 14px;border-radius:11px;font-size:12px;transition:.2s;box-shadow:0 7px 20px rgba(20,45,85,.18)}#dz-cloud-toast.show{transform:translate(-50%,0);opacity:1}',
      '#dz-account-panel{position:fixed;inset:0;z-index:3200;display:none;place-items:center;padding:20px;background:rgba(30,52,92,.22);backdrop-filter:blur(8px)}#dz-account-panel.show{display:grid}.dz-profile-card{width:min(100%,410px);text-align:left}.dz-profile-head{display:flex;align-items:flex-start;gap:12px}.dz-profile-head h2{font-size:21px;flex:1}.dz-profile-close{border:0;background:#edf4ff;color:#6288ce;border-radius:10px;width:34px;height:34px;cursor:pointer;font-size:20px;line-height:1}.dz-profile-info{display:grid;gap:8px;padding:12px 0 18px;margin-bottom:18px;border-bottom:1px solid #e0eaf6}.dz-profile-info div{display:flex;justify-content:space-between;gap:14px;font-size:12px;color:#8291aa}.dz-profile-info strong{max-width:68%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#425779;font-weight:700}.dz-profile-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.dz-profile-actions button{margin:0}.dz-profile-logout{background:#fff1f3!important;color:#c65a70!important;border-color:#ffd8df!important}.dz-profile-foot{margin-top:15px;color:#8a9ab3;font-size:11px;line-height:1.6}',
      '@media(max-width:520px){#dz-auth-gate{align-items:end;padding:16px 16px max(26px,env(safe-area-inset-bottom))}.dz-auth-card,.dz-profile-card{padding:28px 22px 22px;border-radius:24px}.dz-auth-card h1{font-size:23px}#dz-cloud-account{top:8px;right:8px}.dz-profile-actions{grid-template-columns:1fr}}'
    ].join('');
    document.head.appendChild(style);
    var wrap = document.createElement('div');
    wrap.innerHTML = '<section id="dz-auth-gate" aria-labelledby="dz-auth-title"><div class="dz-auth-card"><div class="dz-auth-orbit" aria-hidden="true"><i></i></div><div class="dz-auth-kicker">CUTE DISCIPLE SYSTEM · WEB</div><h1 id="dz-auth-title">把故事带回云端</h1><p>登录后即可同步你的剧情存档，在不同设备上继续与你的徒弟相遇。</p><div class="dz-auth-form"><label class="dz-auth-label" for="dz-auth-email">邮箱登录</label><input id="dz-auth-email" type="email" autocomplete="email" inputmode="email" placeholder="name@example.com"><button id="dz-email-login" class="dz-email-login" type="button">发送魔法登录链接</button><div class="dz-auth-divider">或</div><button id="dz-discord-login" class="dz-discord-login" type="button"><span class="discord-dot"></span>使用 Discord 继续</button><div id="dz-auth-status" role="status" aria-live="polite"></div></div><div class="dz-auth-note"><strong>只同步游戏存档。</strong> API Key 与本地个性化设置不会上传到云端。</div></div></section><div id="dz-cloud-account"><span id="dz-account-name">正在检查登录状态</span><button id="dz-account-button" type="button">登录</button></div><section id="dz-account-panel" aria-label="账户管理"><div class="dz-profile-card"><div class="dz-profile-head"><div><div class="dz-auth-kicker">ACCOUNT CENTER</div><h2>账户管理</h2></div><button id="dz-profile-close" class="dz-profile-close" type="button" aria-label="关闭">×</button></div><p class="dz-profile-lead">普通用户名仅用于本网页账户展示，可随时修改。</p><div class="dz-profile-info"><div><span>登录方式</span><strong id="dz-profile-provider"></strong></div><div><span>账号邮箱</span><strong id="dz-profile-email"></strong></div><div><span>云存档</span><strong>已启用</strong></div></div><div class="dz-profile-form"><label class="dz-profile-label" for="dz-profile-name">普通用户名</label><input id="dz-profile-name" type="text" maxlength="24" autocomplete="username" placeholder="输入 2-24 个字符"><div id="dz-profile-status" class="dz-profile-status" role="status" aria-live="polite"></div><button id="dz-profile-save" class="dz-profile-save" type="button">保存用户名</button></div><div class="dz-profile-actions"><button id="dz-profile-sync" class="dz-profile-secondary" type="button">立即同步存档</button><button id="dz-profile-logout" class="dz-profile-secondary dz-profile-logout" type="button">退出当前设备</button></div><div class="dz-profile-foot">退出仅清除本设备的登录状态，不会删除云端存档。</div></div></section><div id="dz-cloud-toast" role="status" aria-live="polite"></div>';
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    document.getElementById('dz-email-login').onclick = function () {
      if (authBusy || !client) return;
      var email = String(document.getElementById('dz-auth-email').value || '').trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { setStatus('请输入有效的邮箱地址。', true); return; }
      setBusy(true); setStatus('正在发送登录链接…');
      client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin } }).then(function (r) {
        setBusy(false); setStatus(r.error ? ('发送失败：' + r.error.message) : '登录链接已发送，请在邮箱中打开它。', !!r.error);
      }).catch(function () { setBusy(false); setStatus('网络连接失败，请稍后重试。', true); });
    };
    document.getElementById('dz-auth-email').addEventListener('keydown', function (event) { if (event.key === 'Enter') document.getElementById('dz-email-login').click(); });
    document.getElementById('dz-discord-login').onclick = function () {
      if (authBusy || !client) return;
      setBusy(true); setStatus('正在前往 Discord…');
      client.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: location.origin } }).then(function (r) {
        if (r.error) { setBusy(false); setStatus('Discord 登录失败：' + r.error.message, true); }
      }).catch(function () { setBusy(false); setStatus('网络连接失败，请稍后重试。', true); });
    };
    document.getElementById('dz-account-button').onclick = function () { if (currentUser) openAccount(false); else if (gate()) gate().classList.remove('hidden'); };
    document.getElementById('dz-profile-close').onclick = closeAccount;
    document.getElementById('dz-profile-save').onclick = saveProfile;
    document.getElementById('dz-profile-sync').onclick = function () { if (currentUser) { pushCloud(readLocal(), false); } };
    document.getElementById('dz-profile-logout').onclick = signOutNow;
  }
  function readLocal() { try { var raw = localStorage.getItem('dz_saves'); return raw ? JSON.parse(raw) : []; } catch (_) { return []; } }
  function writeLocal(data) { try { localStorage.setItem('dz_saves', JSON.stringify(Array.isArray(data) ? data : [])); return true; } catch (_) { return false; } }
  function pullCloud() {
    if (!currentUser) return Promise.resolve();
    return client.from('web_game_saves').select('payload,updated_at').eq('slot_key', 'primary').maybeSingle().then(function (r) {
      if (r.error) { toast('云存档读取失败：' + r.error.message); return; }
      var local = readLocal(), remote = r.data && r.data.payload;
      if (Array.isArray(remote) && remote.length) { suppressWrite = true; writeLocal(remote); suppressWrite = false; toast('已载入云存档。'); }
      else if (local.length) return pushCloud(local, true);
    });
  }
  function pushCloud(saves, quiet) {
    if (!currentUser || suppressWrite) return Promise.resolve();
    return client.from('web_game_saves').upsert({ user_id: currentUser.id, slot_key: 'primary', payload: Array.isArray(saves) ? saves : [], updated_at: new Date().toISOString() }, { onConflict: 'user_id,slot_key' }).then(function (r) {
      if (r.error) toast('云存档保存失败：' + r.error.message); else if (!quiet) toast('云存档已同步。');
    });
  }
  function schedulePush(saves) { if (!currentUser || suppressWrite) return; clearTimeout(writeTimer); writeTimer = setTimeout(function () { pushCloud(saves, false); }, 900); }
  function installSaveHook() {
    if (!window.writeSaves || window.writeSaves.__cloudWrapped) return;
    var original = window.writeSaves;
    function wrapped(arr) { var result = original(arr); schedulePush(arr); return result; }
    wrapped.__cloudWrapped = true; window.writeSaves = wrapped;
  }
  function setUser(user, session) {
    currentUser = user || null;
    window.DZCloudAccessToken = (session && session.access_token) || '';
    renderAccount(); updateProfilePanel();
    if (currentUser) {
      installSaveHook(); pullCloud();
      if (!displayName(currentUser)) setTimeout(function () { openAccount(true); }, 180);
    }
  }
  function cleanAuthCallbackUrl() {
    try { var url = new URL(window.location.href); ['code', 'error', 'error_code', 'error_description'].forEach(function (key) { url.searchParams.delete(key); }); window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : '') + (url.hash ? url.hash : '')); } catch (_) {}
  }
  function restoreExistingSession() {
    client.auth.getSession().then(function (r) { var session = r.data && r.data.session; setUser(session && session.user, session); }).catch(function () { setStatus('无法读取登录状态，请刷新后重试。', true); setUser(null, null); });
  }
  function finishOAuthCallback() {
    var url; try { url = new URL(window.location.href); } catch (_) { restoreExistingSession(); return; }
    var code = url.searchParams.get('code'), callbackError = url.searchParams.get('error_description') || url.searchParams.get('error');
    if (callbackError) { cleanAuthCallbackUrl(); setStatus('登录未完成：' + callbackError, true); setUser(null, null); return; }
    if (!code) { restoreExistingSession(); return; }
    setBusy(true); setStatus('正在完成登录…');
    client.auth.exchangeCodeForSession(code).then(function (r) {
      setBusy(false);
      if (r.error || !r.data || !r.data.session) { cleanAuthCallbackUrl(); setStatus('登录会话创建失败：' + ((r.error && r.error.message) || '请重新发起登录。'), true); setUser(null, null); return; }
      cleanAuthCallbackUrl(); setStatus('登录成功，正在载入你的存档…'); setUser(r.data.session.user, r.data.session);
    }).catch(function () { setBusy(false); setStatus('登录会话创建失败，请重新发起登录。', true); setUser(null, null); });
  }
  function startAuth() {
    if (!window.supabase || !cfg.supabaseUrl || !cfg.supabasePublishableKey) { setStatus('登录服务载入失败，请检查网络后刷新页面。', true); setBusy(true); return; }
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, { auth: { persistSession: true, detectSessionInUrl: false, flowType: 'pkce' } });
    window.DZCloud.client = client;
    installSaveHook(); finishOAuthCallback();
    client.auth.onAuthStateChange(function (_event, session) { setTimeout(function () { setUser(session && session.user, session); }, 0); });
  }
  ensureUi(); startAuth();
})();
