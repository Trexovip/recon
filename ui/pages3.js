/* ================= API connections (admin) ================= */
let connsCache=[];
async function page_connections(el){
  el.innerHTML=`<div class="spread" style="margin-bottom:16px"><p class="note" style="margin:0;max-width:720px">Each connection pulls a list of wallets or bank accounts from one API. Choose which accounts go into the sheet; the rest are ignored. Manual entries in the sheet are not affected.</p>
    <button class="btn primary" id="cAdd">+ Add API connection</button></div><div class="grid2" id="cList"><div class="empty">Loading…</div></div>`;
  $('cAdd').onclick=()=>editConn(null);
  connsCache=await api('/api/connections').catch(e=>{toast(e.message,true);return [];}); if(page!=='connections') return;
  $('cList').innerHTML=connsCache.map(c=>{ const sel=Object.values(c.selected||{}).filter(Boolean).length, fresh=c.known.filter(a=>!(a.key in c.selected)).length;
    return `<div class="conn" data-id="${c.id}"><div class="spread"><h4>${esc(c.name)}</h4>
        ${!c.enabled?'<span class="badge b-man">Off</span>':c.lastError?'<span class="badge b-err">Failing</span>':c.lastSync?'<span class="badge b-ok">Working</span>':'<span class="badge b-warn">Not refreshed yet</span>'}</div>
      <div class="kvline"><span>Goes to <b>${TARGET_NAME[c.target]}</b></span><span>${c.method} ${esc(c.url.replace(/^https?:\/\//,'').slice(0,48))}</span>
        <span><b>${sel}</b> of ${c.known.length} accounts in sheet${fresh?`, <b class="loss">${fresh} new</b>`:''}</span><span>${c.lastSync?'Refreshed '+dt(c.lastSync):'Never refreshed'}</span></div>
      ${c.lastError?`<div class="banner warn" style="margin-bottom:10px">${esc(c.lastError)}</div>`:''}
      <div class="row-gap"><button class="btn sm primary" data-c="pick">Choose accounts</button><button class="btn sm" data-c="sync" ${meta.locked||!c.enabled?'disabled':''}>Refresh now</button>
        <button class="btn sm" data-c="edit">Edit</button><button class="btn sm danger" data-c="del">Delete</button></div></div>`; }).join('')
    ||'<div class="card empty" style="grid-column:1/-1">No API connections yet. Add one for your payout wallets and one for each bank API.</div>';
  $('cList').querySelectorAll('[data-c]').forEach(b=>b.onclick=async()=>{
    const c=connsCache.find(x=>x.id===b.closest('.conn').dataset.id), a=b.dataset.c;
    if(a==='edit') editConn(c);
    if(a==='pick') pickAccounts(c);
    if(a==='sync'){ b.disabled=true; b.textContent='Refreshing…';
      try{ const r=await api('/api/sync?id='+c.id,{method:'POST'}); r.errors.length?toast(r.errors[0],true):toast(`${r.changed} change(s)${r.newAccounts?`, ${r.newAccounts} new account(s)`:''}`); }catch(e){ toast(e.message,true); }
      await refresh(true); page_connections(el); }
    if(a==='del'){ if(!confirm(`Delete "${c.name}"? Its ${Object.values(c.selected).filter(Boolean).length} account(s) stay in the sheet as manual entries with their last balance.`)) return;
      try{ const r=await api('/api/connections/'+c.id,{method:'DELETE'}); toast(`Deleted. ${r.keptAsManual} row(s) kept as manual.`); await refresh(true); page_connections(el); }catch(e){ toast(e.message,true); } }
  });
}

function editConn(c){
  const v=c||{name:'',target:'payout',url:'',method:'GET',headers:{Authorization:''},body:null,listPath:'',nameField:'',balanceField:'',idField:'',bankName:'',bankNameField:'',accountNoField:'',enabled:true,autoIncludeNew:false};
  const hdrRow=(k='',val='')=>`<div class="hdr-row"><input class="inp hk" placeholder="Header name, e.g. Authorization" value="${esc(k)}"><input class="inp hv" placeholder="Value, e.g. Bearer abc123" value="${esc(val)}"><button type="button" class="ico" data-rm aria-label="Remove header">✕</button></div>`;
  openDlg(c?`Edit ${c.name}`:'Add API connection',`<form id="ceForm">
    <div class="form-grid">
      <div><label class="f">Connection name</label><input class="inp" id="ceName" value="${esc(v.name)}" placeholder="e.g. Trexo payout wallets" required></div>
      <div><label class="f">Balances go to</label><select class="inp" id="ceTarget">${Object.entries(TARGET_NAME).map(([k,n])=>`<option value="${k}" ${v.target===k?'selected':''}>${n}</option>`).join('')}</select></div>
      <div><label class="f">Method</label><select class="inp" id="ceMethod"><option ${v.method==='GET'?'selected':''}>GET</option><option ${v.method==='POST'?'selected':''}>POST</option></select></div>
    </div>
    <div style="margin-top:12px"><label class="f">API URL</label><input class="inp" id="ceUrl" value="${esc(v.url)}" placeholder="https://api.yourprovider.com/v1/wallets" required></div>
    <div style="margin-top:12px"><label class="f">Headers (API key, token)</label><div id="ceHdrs">${Object.entries(v.headers||{}).map(([k,x])=>hdrRow(k,x)).join('')||hdrRow()}</div><button type="button" class="btn sm" id="ceAddH">+ Add header</button>
      ${c?'<div class="note" style="margin-top:4px">Saved secrets show as ••••••. Leave them as they are to keep the current value.</div>':''}</div>
    <div style="margin-top:12px" id="ceBodyWrap" class="${v.method==='POST'?'':'hidden'}"><label class="f">Request body (JSON)</label><textarea class="inp" id="ceBody" placeholder='{"merchantId":"123"}'>${v.body?esc(JSON.stringify(v.body,null,2)):''}</textarea></div>
    <div class="row-gap" style="margin:16px 0 10px"><button type="button" class="btn primary" id="ceTest">Test connection</button><span class="note">Calls the API once and shows what came back, so you can pick the right fields.</span></div>
    <div id="ceTestOut"></div>
    <div class="form-grid" style="margin-top:12px">
      <div><label class="f">List of accounts is in</label><input class="inp" id="ceList" list="ceListOpts" value="${esc(v.listPath)}" placeholder="e.g. data"><datalist id="ceListOpts"></datalist></div>
      <div><label class="f">Account name field</label><input class="inp" id="ceNameF" list="ceFieldOpts" value="${esc(v.nameField)}" placeholder="e.g. name" required></div>
      <div><label class="f">Balance field</label><input class="inp" id="ceBalF" list="ceFieldOpts" value="${esc(v.balanceField)}" placeholder="e.g. balance" required></div>
      <div><label class="f">Unique ID field (optional)</label><input class="inp" id="ceIdF" list="ceFieldOpts" value="${esc(v.idField)}" placeholder="e.g. accountNo"></div>
      <datalist id="ceFieldOpts"></datalist>
    </div>
    <div class="note" style="margin-top:4px">Use the unique ID field when two accounts can have the same name (for example wallet ID).</div>
    <div id="ceBankBox" class="card" style="margin-top:12px;background:var(--soft)">
      <h3 style="margin-bottom:4px">Bank account details</h3>
      <p class="note" style="margin:0 0 10px">Several accounts can share a name, so each bank account is identified by bank name and account number.</p>
      <div class="form-grid">
        <div><label class="f">Account number field</label><input class="inp" id="ceAccF" list="ceFieldOpts" value="${esc(v.accountNoField||'')}" placeholder="e.g. accountNumber"></div>
        <div><label class="f">Bank name field (if the API sends it)</label><input class="inp" id="ceBankF" list="ceFieldOpts" value="${esc(v.bankNameField||'')}" placeholder="e.g. bankName"></div>
        <div><label class="f">Or fixed bank name for this API</label><input class="inp" id="ceBankN" value="${esc(v.bankName||'')}" placeholder="e.g. HDFC Bank"></div>
      </div>
    </div>
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">
      <label><input type="checkbox" id="ceEnabled" ${v.enabled?'checked':''}> Connection is on (included in Refresh API and auto refresh)</label>
      <label><input type="checkbox" id="ceAuto" ${v.autoIncludeNew?'checked':''}> Add new accounts to the sheet automatically (otherwise they wait for you to tick them)</label>
    </div>
    <div class="row-gap" style="margin-top:16px"><button class="btn primary">${c?'Save changes':'Save connection'}</button><span class="note">${c?'':'After saving, refresh it and choose which accounts to include.'}</span></div>
    <div class="err-text" id="ceErr"></div></form>`);
  const body=$('dlgBody');
  body.addEventListener('click',e=>{ if(e.target.matches('[data-rm]')) e.target.closest('.hdr-row').remove(); });
  $('ceAddH').onclick=()=>$('ceHdrs').insertAdjacentHTML('beforeend',hdrRow());
  $('ceMethod').onchange=e=>$('ceBodyWrap').classList.toggle('hidden',e.target.value!=='POST');
  const bankBox=()=>$('ceBankBox').classList.toggle('hidden',$('ceTarget').value!=='banks'); $('ceTarget').onchange=bankBox; bankBox();
  const collect=()=>({ id:c?.id, name:$('ceName').value, target:$('ceTarget').value, url:$('ceUrl').value.trim(), method:$('ceMethod').value,
    headers:Object.fromEntries([...body.querySelectorAll('.hdr-row')].map(r=>[r.querySelector('.hk').value.trim(),r.querySelector('.hv').value]).filter(([k])=>k)),
    body:$('ceBody').value, listPath:$('ceList').value.trim(), nameField:$('ceNameF').value.trim(), balanceField:$('ceBalF').value.trim(), idField:$('ceIdF').value.trim(),
    accountNoField:$('ceAccF').value.trim(), bankNameField:$('ceBankF').value.trim(), bankName:$('ceBankN').value.trim(),
    enabled:$('ceEnabled').checked, autoIncludeNew:$('ceAuto').checked });
  const test=async(again=true)=>{
    $('ceTestOut').innerHTML='<div class="note">Calling the API…</div>';
    try{ const r=await api('/api/connections/test',{method:'POST',body:collect()});
      $('ceListOpts').innerHTML=r.arrays.map(a=>`<option value="${esc(a)}">`).join('');
      $('ceFieldOpts').innerHTML=r.fields.map(f=>`<option value="${esc(f)}">`).join('');
      if(!$('ceList').value && r.arrays.length===1 && r.arrays[0]) $('ceList').value=r.arrays[0];
      const guess=(re)=>r.fields.find(f=>re.test(f));
      let changed=false; const fill=(id,g)=>{ if(!$(id).value && g){ $(id).value=g; changed=true; } };
      fill('ceNameF', guess(/acc\w*_?name|holder|(^|\.)name$/i)||r.fields.find(f=>/name/i.test(f)&&!/bank/i.test(f)));
      fill('ceBalF', guess(/bal|amount|avail/i));
      if($('ceTarget').value==='banks'){ fill('ceAccF', guess(/acc\w*(no|num)|account_?n|acno|acct/i)); if(!$('ceBankN').value) fill('ceBankF', guess(/bank/i)); }
      if(again && changed && $('ceNameF').value && $('ceBalF').value) return test(false);
      $('ceTestOut').innerHTML=`<div class="banner info">Connected. Lists found: <b>${r.arrays.map(a=>esc(a||'(whole response)')).join(', ')||'none'}</b>. Fields in each item: ${r.fields.map(esc).join(', ')||'none'}</div>
        ${r.mapError?`<div class="banner warn">${esc(r.mapError)}</div>`:''}
        ${r.duplicates?`<div class="banner warn">${r.duplicates} account(s) can't be told apart with the current fields. Set the account number field (and bank name) so each account is unique.</div>`:''}
        ${r.accounts.length?`<div class="note" style="margin-bottom:6px">${r.accounts.length} accounts read with the current fields. First 10:</div><div class="scroll"><table class="t"><thead><tr>${$('ceTarget').value==='banks'?'<th>Bank</th>':''}<th>Name</th>${$('ceTarget').value==='banks'?'<th>Account number</th>':'<th>ID</th>'}<th class="r">Balance</th></tr></thead><tbody>${r.accounts.slice(0,10).map(a=>`<tr>${$('ceTarget').value==='banks'?`<td>${esc(a.bank)}</td>`:''}<td>${esc(a.name)}${a.dup?' <span class="badge b-warn">Duplicate</span>':''}</td><td class="note">${$('ceTarget').value==='banks'?esc(a.accountNo):a.key!==a.name?esc(a.key):''}</td><td class="r">${fmt(a.balance)}</td></tr>`).join('')}</tbody></table></div>`:''}
        ${r.sample?`<details style="margin-top:8px"><summary class="note">Show first item from the API</summary><pre class="sample">${esc(r.sample)}</pre></details>`:''}
        ${!r.accounts.length&&!r.mapError&&r.fields.length?'<div class="note">Pick the name and balance fields below, then test again to preview.</div>':''}`;
    }catch(e){ $('ceTestOut').innerHTML=`<div class="banner warn">${esc(e.message)}</div>`; }
  };
  $('ceTest').onclick=()=>test();
  $('ceForm').onsubmit=async e=>{ e.preventDefault(); $('ceErr').textContent='';
    try{ const d=collect(); c?await api('/api/connections/'+c.id,{method:'PUT',body:d}):await api('/api/connections',{method:'POST',body:d});
      dlg.close(); toast(c?'Connection saved':'Connection added. Refresh it, then choose accounts.'); await refresh(true); page_connections($('content')); }
    catch(err){ $('ceErr').textContent=err.message; } };
}

function pickAccounts(c){
  if(!c.known.length){ openDlg(`Choose accounts: ${c.name}`,`<div class="empty">No accounts loaded yet. Click <b>Refresh now</b> on this connection first, then come back here.</div>`); return; }
  const sel={...c.selected}; let filter='all', q=''; const isBank=c.target==='banks';
  const present=a=>a.lastSeen===c.lastSync;
  openDlg(`Choose accounts: ${c.name}`,`<div class="filters">
      <label>Find<input class="inp" id="paQ" placeholder="${isBank?'Bank, name or account number':'Account name or ID'}"></label>
      <div class="seg" id="paSeg"><button data-f="all" aria-pressed="true">All</button><button data-f="on" aria-pressed="false">In sheet</button><button data-f="off" aria-pressed="false">Not in sheet</button><button data-f="new" aria-pressed="false">New</button></div>
      <button class="btn sm" id="paAll">Tick all shown</button><button class="btn sm" id="paNone">Untick all shown</button>
    </div>
    ${c.known.some(a=>a.dup)?`<div class="banner warn">Some accounts have the same ${isBank?'bank and name with no account number':'name and no unique ID'}, so they can only be told apart by their order in the API. ${isBank?'Edit this connection and set the account number field.':'Edit this connection and set the unique ID field.'}</div>`:''}
    ${c.known.some(a=>a.review)?`<div class="banner info">After the field change, ${c.known.filter(a=>a.review).length} account(s) with a shared name could not be matched to what was ticked before. They are marked "Check" below. Tick the right one.</div>`:''}
    <div class="note" id="paCount" style="margin-bottom:8px"></div>
    <div class="scroll" style="max-height:48vh"><table class="t"><thead><tr><th style="width:32px"></th>${isBank?'<th>Bank</th>':''}<th>Account name</th><th>${isBank?'Account number':'ID'}</th><th class="r">Balance</th><th>Status</th></tr></thead><tbody id="paBody"></tbody></table></div>
    <label style="display:block;margin-top:12px"><input type="checkbox" id="paAuto" ${c.autoIncludeNew?'checked':''}> Add new accounts to the sheet automatically in future</label>
    <div class="row-gap" style="margin-top:12px"><button class="btn primary" id="paSave" ${meta.locked?'disabled':''}>Save selection</button>${meta.locked?'<span class="note">Today is closed. Reopen it to change the sheet.</span>':''}</div>`);
  const shown=()=>c.known.filter(a=>(!q||[a.name,a.key,a.bank,a.accountNo].join(' ').toLowerCase().includes(q))&&(filter==='all'||(filter==='on'&&sel[a.key])||(filter==='off'&&!sel[a.key])||(filter==='new'&&!(a.key in c.selected))));
  const draw=()=>{
    const list=shown();
    const nameCount={}; for(const a of c.known){ const k=(a.bank||'').toLowerCase()+'|'+a.name.toLowerCase(); nameCount[k]=(nameCount[k]||0)+1; }
    $('paBody').innerHTML=list.map(a=>`<tr class="pa-row" data-row="${esc(a.key)}" style="cursor:pointer"><td><input type="checkbox" data-k="${esc(a.key)}" ${sel[a.key]?'checked':''} aria-label="Include ${esc(rowLabel(a))}"></td>${isBank?`<td>${esc(a.bank)}</td>`:''}<td>${esc(a.name)}${nameCount[(a.bank||'').toLowerCase()+'|'+a.name.toLowerCase()]>1?`<div class="note">Same name as another account${isBank&&a.accountNo?', check the account number':''}</div>`:''}</td><td>${isBank?(a.accountNo?`<b>${esc(a.accountNo)}</b>`:'<span class="badge b-warn">No account number</span>'):a.key!==a.name?`<span class="note">${esc(a.key)}</span>`:''}</td>
      <td class="r">${fmt(a.balance)}</td><td>${a.review?'<span class="badge b-warn">Check</span> ':''}${!(a.key in c.selected)?'<span class="badge b-api">New</span> ':''}${present(a)?'':'<span class="badge b-warn" title="Not in the latest API response">Missing</span>'}</td></tr>`).join('')||`<tr><td colspan="${isBank?6:5}" class="empty">No accounts match.</td></tr>`;
    const n=Object.values(sel).filter(Boolean).length, total=c.known.filter(a=>sel[a.key]).reduce((x,a)=>x+a.balance,0);
    $('paCount').textContent=`${n} of ${c.known.length} accounts selected, total balance ${fmt(total)}`;
  };
  $('paBody').onchange=e=>{ if(e.target.dataset.k!==undefined){ sel[e.target.dataset.k]=e.target.checked; draw(); } };
  // clicking anywhere on a row toggles that one account only
  $('paBody').onclick=e=>{ if(e.target.matches('input')) return; const tr=e.target.closest('tr[data-row]'); if(!tr) return; const k=tr.dataset.row; sel[k]=!sel[k]; draw(); };
  $('paQ').oninput=e=>{ q=e.target.value.toLowerCase(); draw(); };
  $('paSeg').querySelectorAll('button').forEach(b=>b.onclick=()=>{ filter=b.dataset.f; $('paSeg').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b)); draw(); });
  $('paAll').onclick=()=>{ shown().forEach(a=>sel[a.key]=true); draw(); };
  $('paNone').onclick=()=>{ shown().forEach(a=>sel[a.key]=false); draw(); };
  $('paSave').onclick=async()=>{
    try{ const r=await api(`/api/connections/${c.id}/selection`,{method:'POST',body:{selected:sel,autoIncludeNew:$('paAuto').checked}});
      dlg.close(); toast(`Selection saved. ${r.changes} change(s) in the sheet.`); await refresh(true); page_connections($('content')); }
    catch(e){ toast(e.message,true); } };
  draw();
}

/* ================= Users (admin) ================= */
async function page_users(el){
  el.innerHTML=`<div class="card" style="margin-bottom:18px"><h3>Add a person</h3>
      <form id="uAdd" class="form-grid" autocomplete="off">
        <div><label class="f">Name</label><input class="inp" id="nuName" required></div>
        <div><label class="f">User ID</label><input class="inp" id="nuUser" required></div>
        <div><label class="f">Password</label><input class="inp" id="nuPass" type="password" autocomplete="new-password" required minlength="6"></div>
        <div><label class="f">Role</label><select class="inp" id="nuRole"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
        <div><button class="btn primary">Add person</button></div>
      </form>
      <p class="note" style="margin:10px 0 0">Staff enter and edit sheet data, add income and expenses, refresh API balances, see reports and the activity log, and close the day. Admins can also delete rows and entries, reopen closed days, manage API connections, people and settings.</p></div>
    <div class="card" style="padding:0"><div class="scroll"><table class="t"><thead><tr><th>Name</th><th>User ID</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody id="uBody"></tbody></table></div></div>`;
  $('uAdd').onsubmit=async e=>{ e.preventDefault();
    try{ await api('/api/users',{method:'POST',body:{name:$('nuName').value,username:$('nuUser').value,password:$('nuPass').value,role:$('nuRole').value}}); e.target.reset(); toast('Person added'); page_users(el); }
    catch(err){ toast(err.message,true); } };
  users=await api('/api/users').catch(()=>users);
  $('uBody').innerHTML=users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td><span class="badge ${u.role==='admin'?'b-api':'b-man'}">${u.role==='admin'?'Admin':'Staff'}</span></td>
    <td>${u.active?'<span class="badge b-ok">Active</span>':'<span class="badge b-err">Disabled</span>'}</td><td>${u.lastLogin?dt(u.lastLogin):'Never'}</td>
    <td class="r" style="white-space:nowrap"><button class="btn sm" data-u="${esc(u.username)}" data-do="pw">Reset password</button>
      <button class="btn sm" data-u="${esc(u.username)}" data-do="role">Make ${u.role==='admin'?'staff':'admin'}</button>
      <button class="btn sm ${u.active?'danger':''}" data-u="${esc(u.username)}" data-do="active">${u.active?'Disable':'Enable'}</button></td></tr>`).join('');
  $('uBody').querySelectorAll('[data-do]').forEach(b=>b.onclick=async()=>{
    const u=users.find(x=>x.username===b.dataset.u), d=b.dataset.do; let body;
    if(d==='pw'){ const p=prompt(`New password for ${u.name} (6+ characters)`); if(!p) return; body={password:p}; }
    if(d==='role') body={role:u.role==='admin'?'staff':'admin'};
    if(d==='active'){ if(u.active&&!confirm(`Disable ${u.name}? They will be logged out.`)) return; body={active:!u.active}; }
    try{ await api('/api/users/'+u.username,{method:'PATCH',body}); toast('Saved'); page_users(el); }catch(e){ toast(e.message,true); } });
}

/* ================= Settings (admin) ================= */
function page_settings(el){
  const S=meta.settings;
  el.innerHTML=`<form id="stForm" class="stack" style="max-width:860px">
    <div class="card"><h3>General</h3><div class="form-grid">
      <div><label class="f">Company name</label><input class="inp" id="stName" value="${esc(S.companyName)}"></div>
      <div><label class="f">Business timezone</label><select class="inp" id="stTz">${['Asia/Kolkata','Asia/Dubai','Asia/Singapore','Europe/London','UTC'].map(z=>`<option ${S.timezone===z?'selected':''}>${z}</option>`).join('')}</select></div>
    </div><p class="note" style="margin:8px 0 0">The business day (for closings and the log) follows this timezone.</p></div>
    <div class="card"><h3>API refresh and alerts</h3><div class="form-grid">
      <div><label class="f">Refresh API balances automatically</label><select class="inp" id="stAuto">${[[0,'Off'],[5,'Every 5 minutes'],[15,'Every 15 minutes'],[30,'Every 30 minutes'],[60,'Every hour']].map(([v,l])=>`<option value="${v}" ${+S.autoRefreshMinutes===v?'selected':''}>${l}</option>`).join('')}</select></div>
      <div><label class="f">Flag a balance movement on the dashboard above</label><input class="inp" id="stTh" value="${fmt(S.alertThreshold)}" inputmode="decimal"></div>
    </div></div>
    <div class="card"><h3>Profit and loss categories</h3><div class="grid2">
      <div><label class="f">Income categories (one per line)</label><textarea class="inp" id="stInc" style="min-height:150px;font-family:var(--font)">${esc(S.incomeCategories.join('\n'))}</textarea></div>
      <div><label class="f">Expense categories (one per line)</label><textarea class="inp" id="stExp" style="min-height:150px;font-family:var(--font)">${esc(S.expenseCategories.join('\n'))}</textarea></div>
    </div></div>
    <div><button class="btn primary">Save settings</button></div></form>`;
  $('stForm').onsubmit=async e=>{ e.preventDefault();
    try{ await api('/api/settings',{method:'PUT',body:{companyName:$('stName').value,timezone:$('stTz').value,autoRefreshMinutes:+$('stAuto').value,alertThreshold:parseAmt($('stTh').value),
      incomeCategories:$('stInc').value.split('\n'),expenseCategories:$('stExp').value.split('\n')}}); toast('Settings saved'); await refresh(true); }
    catch(err){ toast(err.message,true); } };
}

boot();
