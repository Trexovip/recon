/* ================= Core ================= */
const SECTIONS = [
  {key:'payout',  title:'Payout wallets',       side:'owed', api:true, sub:'From API and manual entries'},
  {key:'payin',   title:'Payin wallets',        side:'owed', api:true, sub:'From API and manual entries'},
  {key:'other',   title:'Other party payments', side:'owed', sub:'Entered manually'},
  {key:'banks',   title:'Bank accounts',        side:'held', api:true, sub:'From API and manual entries'},
  {key:'uses',    title:'Other uses',           side:'held', sub:'Entered manually'},
  {key:'recovery',title:'Recovery',             side:'held', sub:'Tracked separately, not in the difference'},
];
const SEC_NAME = {...Object.fromEntries(SECTIONS.map(s=>[s.key,s.title])), pnl:'Profit & loss'};
const TARGET_NAME = {payout:'Payout wallets', payin:'Payin wallets', banks:'Bank accounts'};
const FIELD_NAME = {amount:'Amount',name:'Name',note:'Note',flag:'Red flag',role:'Role',difference:'Difference',category:'Category',party:'Party',type:'Type',date:'Date',selected:'Accounts selected',target:'Goes to'};
const ICONS = {
  dashboard:'<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z"/>',
  sheet:'<path d="M4 4h16v16H4zM4 9h16M4 14h16M10 4v16"/>',
  recon:'<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  pnl:'<path d="M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3.2 5 1.4 5 3.3-2.2 3-5 3-5-1.1-5-3"/>',
  reports:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  closing:'<path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4"/>',
  log:'<path d="M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z"/>',
  connections:'<path d="M9 7H6a5 5 0 0 0 0 10h3M15 7h3a5 5 0 0 1 0 10h-3M8 12h8"/>',
  users:'<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.8M16 3.2a3.5 3.5 0 0 1 0 6.6"/>',
  settings:'<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const PAGES = [
  {id:'dashboard', title:'Dashboard'}, {id:'sheet', title:'Sheet'}, {id:'recon', title:'Recon data'},
  {id:'pnl', title:'Profit & loss'}, {id:'reports', title:'Reports'}, {id:'closing', title:'Day-end closing'}, {id:'log', title:'Activity log'},
  {group:'Admin'}, {id:'connections', title:'API connections', admin:true}, {id:'users', title:'Users', admin:true}, {id:'settings', title:'Settings', admin:true},
];

let me=null, state=null, meta={}, users=[], page='dashboard', pollTimer;
const $ = id => document.getElementById(id);
const fmt = n => n===null||n===undefined||n==='' ? '' : new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(Math.round((+n||0)*100)/100);
const fmtS = n => (n>0?'+':'')+fmt(n);
const short = n => { const a=Math.abs(n), s=n<0?'−':''; return a>=1e7?s+(a/1e7).toFixed(2)+' Cr':a>=1e5?s+(a/1e5).toFixed(2)+' L':a>=1e3?s+(a/1e3).toFixed(1)+' K':s+Math.round(a); };
const parseAmt = s => { const n=parseFloat(String(s).replace(/[^0-9.\-]/g,'')); return isNaN(n)?0:n; };
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dt = iso => iso ? new Date(iso).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
const tm = iso => new Date(iso).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
const dLabel = d => new Date(d+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
const dShort = d => new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
const addDays = (d,n) => { const x=new Date(d+'T00:00:00Z'); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10); };
const daysBetween = (a,b) => { const out=[]; for(let d=a; d<=b && out.length<400; d=addDays(d,1)) out.push(d); return out; };
const nameOf = u => u==='API'?'API':u==='sheet'?'From sheet':(users.find(x=>x.username===u)?.name || u || '');
const rowLabel = r => [r.bank, r.name, r.accountNo ? 'A/c ' + r.accountNo : ''].filter(Boolean).join(' – ');
const isAdmin = () => me?.role==='admin';
const diffWord = d => d>0?'Short by':d<0?'Funds exceed dues by':'Balanced';

function toast(msg,err=false){ const t=$('toast'); t.textContent=msg; t.className='toast show'+(err?' err':''); clearTimeout(t._h); t._h=setTimeout(()=>t.className='toast',err?6000:2500); }
async function api(path,opts={}){
  const r=await fetch(path,{headers:{'Content-Type':'application/json'},credentials:'same-origin',...opts,body:opts.body!==undefined?JSON.stringify(opts.body):undefined});
  const j=await r.json().catch(()=>({}));
  if(r.status===401 && !path.startsWith('/api/login')){ showAuth(false); throw new Error('Please log in again'); }
  if(!r.ok) throw new Error(j.error||('HTTP '+r.status));
  return j;
}
function openDlg(title,html){ $('dlgTitle').textContent=title; $('dlgBody').innerHTML=html; if(!dlg.open) dlg.showModal(); return $('dlgBody'); }
function download(name,rows){
  const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(q).join(',')).join('\n')],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click();
}

/* ---------- Totals ---------- */
function totalsOf(s){ const sum=k=>(s?.[k]||[]).reduce((a,r)=>a+(+r.amount||0),0); const t=Object.fromEntries(SECTIONS.map(x=>[x.key,sum(x.key)])); t.grand=t.payout+t.payin+t.other; t.diff=t.grand-t.banks-t.uses; return t; }
const totals = () => totalsOf(state);

/* ---------- Auth ---------- */
let setupMode=false;
function showAuth(setup){
  setupMode=setup; clearInterval(pollTimer);
  $('appView').classList.add('hidden'); $('authView').classList.remove('hidden');
  $('authTitle').textContent=setup?'Create the admin account':'Sign in';
  $('authSub').textContent=setup?'First-time setup. This person can add staff later.':(window._company||'Balance reconciliation');
  $('setupName').classList.toggle('hidden',!setup);
  $('authBtn').textContent=setup?'Create admin':'Sign in';
  $('aPass').autocomplete=setup?'new-password':'current-password';
  $('authErr').textContent=''; $(setup?'aName':'aUser').focus();
}
$('authForm').onsubmit=async e=>{
  e.preventDefault(); $('authErr').textContent='';
  const body={username:$('aUser').value.trim(),password:$('aPass').value,name:$('aName').value.trim()};
  try{ if(setupMode) await api('/api/setup',{method:'POST',body}); const r=await api('/api/login',{method:'POST',body}); me=r.user; $('aPass').value=''; startApp(); }
  catch(err){ $('authErr').textContent=err.message; }
};
$('logoutBtn').onclick=async()=>{ await api('/api/logout',{method:'POST'}).catch(()=>{}); me=null; showAuth(false); };
$('pwBtn').onclick=()=>{
  openDlg('Change password',`<form id="pwForm" style="max-width:360px"><label class="f">Current password</label><input class="inp" type="password" id="pwCur" autocomplete="current-password" required>
    <label class="f" style="margin-top:10px">New password (6+ characters)</label><input class="inp" type="password" id="pwNew" autocomplete="new-password" minlength="6" required>
    <div style="margin-top:14px"><button class="btn primary">Change password</button></div><div class="err-text" id="pwErr"></div></form>`);
  $('pwForm').onsubmit=async e=>{ e.preventDefault();
    try{ await api('/api/me/password',{method:'POST',body:{current:$('pwCur').value,password:$('pwNew').value}}); dlg.close(); toast('Password changed'); }
    catch(err){ $('pwErr').textContent=err.message; } };
};

/* ---------- Shell ---------- */
function renderNav(){
  const errs=(meta.connections||[]).filter(c=>c.enabled&&c.lastError).length, fresh=(meta.connections||[]).reduce((a,c)=>a+c.newCount,0);
  $('nav').innerHTML=PAGES.filter(p=>!p.admin||isAdmin()).filter(p=>!p.group||isAdmin()).map(p=>p.group?`<div class="nav-group">${p.group}</div>`:
    `<button data-page="${p.id}" ${p.id===page?'aria-current="page"':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[p.id]}</svg>${p.title}${p.id==='connections'&&(errs||fresh)?`<span class="count" title="${errs} failing, ${fresh} new accounts to review">${errs+fresh}</span>`:''}</button>`).join('');
  $('nav').querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));
}
function renderTop(){
  const t=totals();
  $('topDate').textContent=dLabel(meta.today);
  $('dayChip').className='chip '+(meta.locked?'closed':'open');
  $('dayChip').textContent=meta.locked?`Closed by ${meta.closing.closedByName} at ${tm(meta.closing.closedAt)}`:'Day open';
  $('topDiff').textContent=fmt(Math.abs(t.diff)); $('topDiffLabel').textContent=diffWord(t.diff);
  $('syncBtn').disabled=meta.locked || !(meta.connections||[]).some(c=>c.enabled);
  $('brand').innerHTML=`${esc(meta.settings?.companyName||'Balance Reconciliation')}<small>Payout reconciliation</small>`;
}
$('menuBtn').onclick=()=>$('side').classList.toggle('open');
function go(p){
  page=p; $('side').classList.remove('open');
  $('pageTitle').textContent=PAGES.find(x=>x.id===p)?.title||'';
  renderNav(); window.scrollTo(0,0); renderPage();
}
function renderPage(){ const fn=window['page_'+page]; $('content').innerHTML=''; if(fn) fn($('content')); }

$('syncBtn').onclick=async()=>{
  const b=$('syncBtn'); b.disabled=true; b.textContent='Refreshing…';
  try{ const r=await api('/api/sync',{method:'POST'});
    r.errors.length?toast('Refresh failed: '+r.errors.join(' | '),true):toast(`${r.changed} change(s)${r.newAccounts?`, ${r.newAccounts} new account(s) found`:''}`); }
  catch(e){ toast(e.message,true); }
  b.textContent='Refresh API'; await refresh(true); if(['dashboard','sheet','connections'].includes(page)) renderPage();
};

async function boot(){
  const r=await api('/api/me').catch(()=>null);
  if(!r){ document.body.innerHTML='<div class="auth"><div class="card">Can\'t reach the server. Start it with <b>node server.js</b> and open http://localhost:3000.</div></div>'; return; }
  window._company=r.companyName;
  if(r.setupNeeded) return showAuth(true);
  if(!r.user) return showAuth(false);
  me=r.user; startApp();
}
async function startApp(){
  $('authView').classList.add('hidden'); $('appView').classList.remove('hidden');
  $('meName').textContent=me.name; $('meRole').textContent=isAdmin()?'Admin':'Staff';
  users=isAdmin()?await api('/api/users').catch(()=>[]):[];
  await refresh(true); go('dashboard');
  clearInterval(pollTimer); pollTimer=setInterval(()=>refresh(false),10000);
}
async function refresh(force){
  const r=await api('/api/state'+(force||!meta.version?'':'?since='+meta.version)).catch(()=>null);
  if(!r) return;
  const changedMeta = r.locked!==meta.locked || JSON.stringify(r.connections)!==JSON.stringify(meta.connections);
  Object.assign(meta,{version:r.version,today:r.today,locked:r.locked,closing:r.closing,connections:r.connections,settings:r.settings,pnlToday:r.pnlToday,activityToday:r.activityToday});
  if(r.state) state=r.state;
  renderTop(); if(changedMeta) renderNav();
  if(force || (!r.unchanged || changedMeta)){
    const typing=document.activeElement && document.activeElement.matches('input,textarea,select') && $('content').contains(document.activeElement);
    if(!force && typing){ meta.version=0; return; }
    if(!force && ['dashboard','sheet'].includes(page)) renderPage();
  }
}

/* ---------- Charts (plain SVG) ---------- */
function lineChart(points,{h=200,zero=true}={}){
  if(points.length<2) return '<div class="empty">Not enough closings yet. The trend appears after two day-end closings.</div>';
  const W=640,H=h,pl=62,pr=12,pt=12,pb=26, ys=points.map(p=>p.y);
  let lo=Math.min(...ys), hi=Math.max(...ys); if(zero){lo=Math.min(lo,0);hi=Math.max(hi,0);} if(lo===hi){lo-=1;hi+=1;}
  const pad=(hi-lo)*.08; lo-=pad; hi+=pad;
  const x=i=>pl+i*(W-pl-pr)/(points.length-1), y=v=>pt+(hi-v)*(H-pt-pb)/(hi-lo);
  const d=points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const ticks=[hi-pad,(hi+lo)/2,lo+pad];
  const every=Math.ceil(points.length/7);
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend chart">
    ${ticks.map(t=>`<line class="axis" x1="${pl}" x2="${W-pr}" y1="${y(t)}" y2="${y(t)}"/><text x="${pl-6}" y="${y(t)+4}" text-anchor="end">${short(t)}</text>`).join('')}
    ${zero&&lo<0&&hi>0?`<line class="zero" x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}"/>`:''}
    <path class="area" d="${d}L${x(points.length-1)},${y(Math.max(lo,Math.min(0,hi)))}L${x(0)},${y(Math.max(lo,Math.min(0,hi)))}Z"/>
    <path class="line" d="${d}"/>
    ${points.map((p,i)=>`<circle class="dot" cx="${x(i)}" cy="${y(p.y)}" r="${points.length>40?1.5:3}"><title>${esc(p.label)}: ${fmt(p.y)}</title></circle>`).join('')}
    ${points.map((p,i)=>i%every===0||i===points.length-1?`<text x="${x(i)}" y="${H-6}" text-anchor="middle">${esc(p.short||p.label)}</text>`:'').join('')}
  </svg></div>`;
}
function barChart(points,{h=200}={}){
  if(!points.length||points.every(p=>!p.y)) return '<div class="empty">No entries in this period yet.</div>';
  const W=640,H=h,pl=62,pr=12,pt=12,pb=26, ys=points.map(p=>p.y);
  let lo=Math.min(0,...ys), hi=Math.max(0,...ys); if(lo===hi) hi=1;
  const y=v=>pt+(hi-v)*(H-pt-pb)/(hi-lo), bw=(W-pl-pr)/points.length, every=Math.ceil(points.length/7);
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">
    ${[hi,0,lo].filter((v,i,a)=>a.indexOf(v)===i).map(t=>`<line class="${t===0?'zero':'axis'}" x1="${pl}" x2="${W-pr}" y1="${y(t)}" y2="${y(t)}"/><text x="${pl-6}" y="${y(t)+4}" text-anchor="end">${short(t)}</text>`).join('')}
    ${points.map((p,i)=>`<rect class="${p.y>=0?'b-pos':'b-neg'}" x="${pl+i*bw+bw*.15}" width="${Math.max(1,bw*.7)}" y="${Math.min(y(0),y(p.y))}" height="${Math.max(p.y?1:0,Math.abs(y(p.y)-y(0)))}"><title>${esc(p.label)}: ${fmt(p.y)}</title></rect>`).join('')}
    ${points.map((p,i)=>i%every===0?`<text x="${pl+i*bw+bw/2}" y="${H-6}" text-anchor="middle">${esc(p.short||p.label)}</text>`:'').join('')}
  </svg></div>`;
}
function barsList(items,color){
  const max=Math.max(...items.map(i=>Math.abs(i.v)),1);
  return items.length?`<div class="bars">${items.map(i=>`<div class="bar-row"><span title="${esc(i.k)}">${esc(i.k)}</span><b>${fmt(i.v)}</b><div class="track"><div class="fill" style="width:${Math.abs(i.v)/max*100}%;background:${color}"></div></div></div>`).join('')}</div>`:'<div class="empty">Nothing yet.</div>';
}
