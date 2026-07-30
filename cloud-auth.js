/* Web account, authentication, and cloud-save adapter.
 * Gameplay/API configuration remains browser-local; only game saves are synchronized. */
(function(){
  var cfg=window.DZ_WEB_CONFIG||{};
  if(!window.supabase||!cfg.supabaseUrl||!cfg.supabasePublishableKey)return;
  var client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,detectSessionInUrl:true}});
  var currentUser=null,remoteReady=false,suppressWrite=false,writeTimer=null;
  window.DZCloudAccessToken='';
  window.DZCloud={
    get accessToken(){return client&&currentUser?client.auth.getSession().then(function(x){return x.data.session&&x.data.session.access_token||'';}):Promise.resolve('');},
    get user(){return currentUser;},
    client:client
  };
  function toast(text){var e=document.getElementById('dz-cloud-toast');if(!e)return;e.textContent=text;e.classList.add('show');setTimeout(function(){e.classList.remove('show');},2600);}
  function gate(){return document.getElementById('dz-auth-gate');}
  function status(text,bad){var e=document.getElementById('dz-auth-status');if(e){e.textContent=text||'';e.className=bad?'bad':'';}}
  function renderAccount(){
    var gateEl=gate(),name=document.getElementById('dz-account-name'),button=document.getElementById('dz-account-button');
    if(gateEl)gateEl.classList.toggle('hidden',!!currentUser);
    if(name)name.textContent=currentUser?(currentUser.email||currentUser.user_metadata&&currentUser.user_metadata.full_name||'已登录'):'未登录';
    if(button)button.textContent=currentUser?'退出账号':'登录 / 云存档';
  }
  function ensureUi(){
    if(document.getElementById('dz-auth-gate'))return;
    var style=document.createElement('style');style.textContent='\n#dz-auth-gate{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:22px;background:radial-gradient(circle at 50% 20%,rgba(123,170,247,.25),transparent 40%),rgba(247,249,255,.98);backdrop-filter:blur(12px)}#dz-auth-gate.hidden{display:none}.dz-auth-card{width:min(100%,420px);padding:30px 25px;border:1px solid rgba(102,142,222,.25);border-radius:24px;background:#fff;box-shadow:0 20px 70px rgba(65,92,145,.18);text-align:center;color:#27324c}.dz-auth-mark{font-size:38px;margin-bottom:10px}.dz-auth-card h1{font-size:22px;margin:0 0 8px}.dz-auth-card p{font-size:13px;line-height:1.7;color:#71809c;margin:0 0 18px}.dz-auth-card input{width:100%;box-sizing:border-box;border:1px solid #d5def0;border-radius:12px;padding:13px 14px;font-size:14px;margin:8px 0}.dz-auth-card button{width:100%;border:0;border-radius:12px;padding:13px;margin-top:9px;cursor:pointer;font-size:14px;font-weight:650;background:#5b8def;color:white}.dz-auth-card button.secondary{background:#5865F2}.dz-auth-card small{display:block;color:#94a0b8;margin-top:14px;line-height:1.6}.dz-auth-card #dz-auth-status{min-height:19px;margin-top:8px;font-size:12px;color:#4b8a68}.dz-auth-card #dz-auth-status.bad{color:#cc596f}#dz-cloud-account{position:fixed;top:12px;right:12px;z-index:530;border:1px solid rgba(120,148,205,.26);border-radius:12px;background:rgba(255,255,255,.86);padding:7px 9px;box-shadow:0 3px 14px rgba(45,65,110,.12);font-size:11px;color:#53617b;display:flex;gap:7px;align-items:center}#dz-cloud-account button{border:0;background:transparent;color:#527fd7;cursor:pointer;font-size:11px;padding:2px}#dz-cloud-toast{position:fixed;left:50%;bottom:86px;z-index:2100;transform:translate(-50%,16px);opacity:0;pointer-events:none;background:#223152;color:#fff;padding:10px 14px;border-radius:10px;font-size:12px;transition:.2s}#dz-cloud-toast.show{transform:translate(-50%,0);opacity:1}\n';document.head.appendChild(style);
    var wrap=document.createElement('div');wrap.innerHTML='<div id="dz-auth-gate"><div class="dz-auth-card"><div class="dz-auth-mark">✦</div><h1>可爱徒弟系统 · Web</h1><p>登录后，剧情存档会安全同步至你的云端账户。AI API Key 与个人设置始终仅保存在当前浏览器。</p><input id="dz-auth-email" type="email" autocomplete="email" placeholder="输入邮箱以获取登录链接"><button id="dz-email-login">发送邮箱登录链接</button><button id="dz-discord-login" class="secondary">使用 Discord 登录</button><div id="dz-auth-status"></div><small>首次登录即自动创建账户。继续即表示同意仅将游戏存档用于跨设备同步。</small></div></div><div id="dz-cloud-account"><span id="dz-account-name">正在检查登录…</span><button id="dz-account-button">登录 / 云存档</button></div><div id="dz-cloud-toast"></div>';
    while(wrap.firstChild)document.body.appendChild(wrap.firstChild);
    document.getElementById('dz-email-login').onclick=function(){
      var email=String(document.getElementById('dz-auth-email').value||'').trim();if(!/^\S+@\S+\.\S+$/.test(email)){status('请输入有效邮箱。',true);return;}
      status('正在发送登录链接…');client.auth.signInWithOtp({email:email,options:{emailRedirectTo:location.origin}}).then(function(r){status(r.error?('发送失败：'+r.error.message):'登录链接已发送，请在邮箱中打开。',!!r.error);});
    };
    document.getElementById('dz-discord-login').onclick=function(){status('正在跳转 Discord…');client.auth.signInWithOAuth({provider:'discord',options:{redirectTo:location.origin}}).then(function(r){if(r.error)status('Discord 登录失败：'+r.error.message,true);});};
    document.getElementById('dz-account-button').onclick=function(){if(currentUser){client.auth.signOut();}else{if(gate())gate().classList.remove('hidden');}};
  }
  function readLocal(){try{var raw=localStorage.getItem('dz_saves');return raw?JSON.parse(raw):[];}catch(e){return [];}}
  function writeLocal(data){try{localStorage.setItem('dz_saves',JSON.stringify(Array.isArray(data)?data:[]));return true;}catch(e){return false;}}
  function pullCloud(){
    if(!currentUser)return Promise.resolve();
    return client.from('web_game_saves').select('payload,updated_at').eq('slot_key','primary').maybeSingle().then(function(r){
      if(r.error){toast('云存档读取失败：'+r.error.message);return;}
      var local=readLocal(),remote=r.data&&r.data.payload;
      if(Array.isArray(remote)&&remote.length){suppressWrite=true;writeLocal(remote);suppressWrite=false;toast('已载入云存档');}
      else if(local.length)return pushCloud(local,true);
    });
  }
  function pushCloud(saves,quiet){
    if(!currentUser||suppressWrite)return Promise.resolve();
    return client.from('web_game_saves').upsert({user_id:currentUser.id,slot_key:'primary',payload:Array.isArray(saves)?saves:[],updated_at:new Date().toISOString()},{onConflict:'user_id,slot_key'}).then(function(r){if(r.error)toast('云存档保存失败：'+r.error.message);else if(!quiet)toast('云存档已同步');});
  }
  function schedulePush(saves){if(!currentUser||suppressWrite)return;clearTimeout(writeTimer);writeTimer=setTimeout(function(){pushCloud(saves,false);},900);}
  function installSaveHook(){
    if(!window.writeSaves||window.writeSaves.__cloudWrapped)return;
    var original=window.writeSaves;function wrapped(arr){var result=original(arr);schedulePush(arr);return result;}wrapped.__cloudWrapped=true;window.writeSaves=wrapped;
  }
  function setUser(user,session){
    currentUser=user||null;
    window.DZCloudAccessToken=session&&session.access_token||'';
    renderAccount();
    if(currentUser){installSaveHook();pullCloud();}
  }
  ensureUi();installSaveHook();
  client.auth.getSession().then(function(r){var s=r.data&&r.data.session;setUser(s&&s.user,s);}).catch(function(){setUser(null,null);});
  client.auth.onAuthStateChange(function(_event,session){setTimeout(function(){setUser(session&&session.user,session);},0);});
})();
