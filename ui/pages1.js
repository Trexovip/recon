/* ================= Dashboard ================= */
let closingsCache=null;
async function getClosings(force){ if(force||!closingsCache) closingsCache=await api('/api/closings').catch(()=>[]); return closingsCache; }

async function page_dashboard(el){
  const t=totals();
  el.innerHTML=`
    <div class="eq"><div class="eq-terms">
      <div class="term"><small>Payout wallets</small><b>${fmt(t.payout)}</b></div><span class="op">+</span>
      <div class="term"><small>Payin wallets</small><b>${fmt(t.payin)}</b></div><span class="op">+</span>
      <div class="term"><small>Other party</small><b>${fmt(t.other)}</b></div><span class="op">−</span>
      <div class="term"><small>Bank accounts</small><b>${fmt(t.banks)}</b></div><span class="op">−</span>
      <div class="term"><small>Other uses</small><b>${fmt(t.uses)}</b></div></div>
      <div class="term res"><small>${diffWord(t.diff)}</small><b>${fmt(Math.abs(t.diff))}</b></div>
    </div>
    <div class="grid4" id="dStats"></div>
    <div class="grid2" style="margin-top:18px">
      <div class="card"><div class="card-head"><h3>Difference at each day-end closing</h3><span class="right note">Last 30 days, today live</span></div><div id="dTrend"></div></div>
      <div class="card"><div class="card-head"><h3>Daily profit and loss</h3><span class="right note">Income − expenses, last 30 days</span></div><div id="dPnl"></div></div>
    </div>
    <div class="grid3" style="margin-top:18px">
      <div class="card"><h3>Needs attention</h3><div id="dAlerts"></div></div>
      <div class="card"><h3>Where the money is</h3><div id="dHeld"></div></div>
      <div class="card"><h3>Largest payout wallets</h3><div id="dWallets"></div></div>
    </div>
    <div class="grid2" style="margin-top:18px">
      <div class="card"><div class="card-head"><h3>API connections</h3>${isAdmin()?'<button class="btn sm right" id="dConn">Manage</button>':''}</div><div id="dConns"></div></div>
      <div class="card"><div class="card-head"><h3>Today's activity</h3><button class="btn sm right" id="dLog">Open log</button></div><div class="feed" id="dFeed"></div></div>
    </div>`;
  $('dLog').onclick=()=>go('log'); if($('dConn')) $('dConn').onclick=()=>go('connections');

  const [closings,pnlRows,feed]=await Promise.all([getClosings(true), api(`/api/pnl?from=${addDays(meta.today,-29)}&to=${meta.today}`).catch(()=>[]), api('/api/audit?date='+meta.today).catch(()=>[])]);
  if(page!=='dashboard') return;
  const sorted=[...closings].sort((a,b)=>a.date.localeCompare(b.date));
  const prev=sorted.filter(c=>c.date<meta.today).pop();
  const move=prev?t.diff-prev.totals.diff:null, pt=meta.pnlToday||{income:0,expense:0,net:0};
  const month=pnlRows.filter(e=>e.date.slice(0,7)===meta.today.slice(0,7)), mNet=month.reduce((a,e)=>a+(e.type==='income'?e.amount:-e.amount),0);
  $('dStats').innerHTML=`
    <div class="card stat"><small>Today's profit / loss</small><b class="${pt.net>=0?'gain':'loss'}">${fmtS(pt.net)}</b><div class="sub">Income ${fmt(pt.income)}, expenses ${fmt(pt.expense)}</div></div>
    <div class="card stat"><small>This month's profit / loss</small><b class="${mNet>=0?'gain':'loss'}">${fmtS(mNet)}</b><div class="sub">${month.length===1?'1 entry':month.length+' entries'}</div></div>
    <div class="card stat"><small>Difference change since last closing</small><b class="${move===null?'':move>0?'loss':'gain'}">${move===null?'–':fmtS(move)}</b><div class="sub">${prev?'Compared with '+dShort(prev.date):'No earlier closing yet'}</div></div>
    <div class="card stat"><small>Day status</small><b>${meta.locked?'Closed':'Open'}</b><div class="sub">${meta.locked?`by ${esc(meta.closing.closedByName)} at ${tm(meta.closing.closedAt)}`:`${meta.activityToday===1?'1 entry':meta.activityToday+' entries'} so far today`}</div></div>`;

  const last=sorted.filter(c=>c.date>=addDays(meta.today,-29)&&c.date<meta.today).map(c=>({label:dLabel(c.date),short:dShort(c.date),y:c.totals.diff}));
  last.push({label:'Today (live)',short:'Today',y:t.diff});
  $('dTrend').innerHTML=lineChart(last);
  const byDay={}; for(const e of pnlRows) byDay[e.date]=(byDay[e.date]||0)+(e.type==='income'?e.amount:-e.amount);
  $('dPnl').innerHTML=barChart(daysBetween(addDays(meta.today,-29),meta.today).map(d=>({label:dLabel(d),short:dShort(d),y:byDay[d]||0})));

  // alerts
  const alerts=[], th=+meta.settings.alertThreshold||0;
  for(const c of meta.connections.filter(c=>c.enabled&&c.lastError)) alerts.push(['hi',`<b>${esc(c.name)}</b> failed to refresh: ${esc(c.lastError)}`]);
  for(const c of meta.connections.filter(c=>c.newCount)) alerts.push(['md',`<b>${esc(c.name)}</b> has ${c.newCount} new account(s) to review${isAdmin()?'':' (admin)'}`]);
  const stale=SECTIONS.flatMap(s=>state[s.key].filter(r=>r.stale).map(r=>r.name));
  if(stale.length) alerts.push(['md',`${stale.length} API account(s) missing from the latest refresh: ${esc(stale.slice(0,4).join(', '))}${stale.length>4?'…':''}`]);
  const flagged=SECTIONS.flatMap(s=>state[s.key].filter(r=>r.flag).map(r=>`${r.name} (${fmt(r.amount)})`));
  if(flagged.length) alerts.push(['lo',`${flagged.length} flagged row(s): ${esc(flagged.slice(0,3).join(', '))}${flagged.length>3?'…':''}`]);
  if(!meta.locked && new Date().getHours()>=20) alerts.push(['lo','Today has not been closed yet']);
  if(prev && th){
    const full=await api('/api/closings/'+prev.date).catch(()=>null);
    if(full){ const old={}; for(const s of SECTIONS) for(const r of full.state[s.key]||[]) old[r.id]=r.amount;
      const big=SECTIONS.flatMap(s=>state[s.key].filter(r=>Math.abs((r.amount||0)-(old[r.id]||0))>=th).map(r=>({n:r.name,d:(r.amount||0)-(old[r.id]||0)})));
      big.sort((a,b)=>Math.abs(b.d)-Math.abs(a.d));
      for(const b of big.slice(0,5)) alerts.unshift(['md',`<b>${esc(b.n)}</b> moved ${fmtS(b.d)} since ${dShort(prev.date)}`]); } }
  if(page!=='dashboard') return;
  $('dAlerts').innerHTML=alerts.length?alerts.map(([l,h])=>`<div class="alert ${l}"><i></i><div>${h}</div></div>`).join(''):'<div class="empty">All clear.</div>';

  const held=[...state.banks.map(r=>({k:r.name,v:r.amount||0})),...state.uses.map(r=>({k:r.name,v:r.amount||0}))].filter(i=>i.v).sort((a,b)=>b.v-a.v).slice(0,8);
  $('dHeld').innerHTML=`<div class="note" style="margin-bottom:8px">Banks ${fmt(t.banks)} and other uses ${fmt(t.uses)}. Top 8:</div>`+barsList(held,'var(--held)');
  $('dWallets').innerHTML=barsList(state.payout.map(r=>({k:r.name,v:r.amount||0})).filter(i=>i.v).sort((a,b)=>b.v-a.v).slice(0,8),'var(--owed)');
  $('dConns').innerHTML=meta.connections.length?`<table class="t"><tbody>${meta.connections.map(c=>`<tr><td><b>${esc(c.name)}</b><div class="note">${TARGET_NAME[c.target]}</div></td>
    <td>${!c.enabled?'<span class="badge b-man">Off</span>':c.lastError?'<span class="badge b-err">Failing</span>':c.lastSync?'<span class="badge b-ok">OK</span>':'<span class="badge b-warn">Not run</span>'}</td>
    <td class="r">${c.selectedCount} of ${c.knownCount} accounts<div class="note">${c.lastSync?dt(c.lastSync):'Never refreshed'}</div></td></tr>`).join('')}</tbody></table>`
    :`<div class="empty">No API connections yet.${isAdmin()?' Add one in API connections.':''}</div>`;
  const items=feed.filter(e=>e.action!=='Logged in'&&e.action!=='Logged out').slice(0,8);
  $('dFeed').innerHTML=items.length?items.map(e=>`<div><b>${esc(e.userName)}</b>: ${esc(e.action)}${e.rowName?` <b>${esc(e.rowName)}</b>`:''}${e.field==='amount'&&e.to!=null?` to ${fmt(e.to)}`:''} <span class="note">${tm(e.at)}</span></div>`).join(''):'<div class="empty">No entries yet today.</div>';
}

/* ================= Sheet ================= */
let sheetFilter={q:'',flagged:false};
function page_sheet(el){
  el.innerHTML=`${meta.locked?`<div class="banner info">${dLabel(meta.today)} is closed. Entries are locked${isAdmin()?' until tomorrow, or reopen it in Day-end closing':' until tomorrow unless an admin reopens it'}.</div>`:''}
    <div class="filters no-print">
      <label>Find<input class="inp" id="sQ" placeholder="Name or note" value="${esc(sheetFilter.q)}"></label>
      <label style="flex-direction:row;align-items:center;gap:6px;font-weight:500;padding-bottom:7px"><input type="checkbox" id="sFlag" ${sheetFilter.flagged?'checked':''}> Flagged only</label>
      <span style="margin-left:auto"></span>
      <button class="btn" id="sCsv">Export to Excel (CSV)</button>
    </div>
    <div class="sheet-grid"><div class="col owed"><h2><i></i>Owed to customers and parties</h2><div id="col-owed"></div></div>
    <div class="col held"><h2><i></i>Where the money is</h2><div id="col-held"></div></div></div>`;
  $('sQ').oninput=e=>{sheetFilter.q=e.target.value; drawSheet();};
  $('sFlag').onchange=e=>{sheetFilter.flagged=e.target.checked; drawSheet();};
  $('sCsv').onclick=()=>exportSheet(state,meta.today);
  drawSheet();
}
function connName(id){ return meta.connections.find(c=>c.id===id)?.name||'API'; }
function badge(r){
  if(r.source==='api') return `<span class="badge b-api" title="${esc(connName(r.connId))}">API</span>`;
  if(r.source==='sample') return '<span class="badge b-sample" title="From your original sheet">Sheet</span>';
  return '<span class="badge b-man">Manual</span>';
}
function rowHTML(r,i){
  const L=meta.locked, editable=r.source!=='api'&&!L;
  return `<tr data-id="${r.id}" class="${r.flag?'flagged':''} ${r.stale?'stale':''}">
    <td class="n">${i+1}</td>
    <td class="nm">${editable?`<input class="cell name" data-f="name" value="${esc(r.name)}" aria-label="Name">`:`<span class="ro name">${esc(r.name)}</span>`}</td>
    <td class="nt"><input class="cell note" data-f="note" value="${esc(r.note)}" placeholder="Note" ${L?'disabled':''} aria-label="Note"></td>
    <td class="amt">${editable?`<input class="cell" data-f="amount" inputmode="decimal" value="${r.amount?fmt(r.amount):''}" placeholder="–" aria-label="Amount">`:`<span class="ro" title="${r.stale?'Missing from the latest API refresh':''}">${r.amount?fmt(r.amount):'–'}</span>`}</td>
    <td class="src">${badge(r)}${r.stale?' <span class="badge b-warn" title="Missing from the latest API refresh">!</span>':''}</td>
    <td class="who">${r.updatedAt?`${esc(nameOf(r.updatedBy))}<br>${dt(r.updatedAt)}`:''}</td>
    <td class="act"><button class="ico ${r.flag?'on':''}" data-a="flag" ${L?'disabled':''} title="Highlight in red" aria-label="Highlight">⚑</button><button class="ico" data-a="hist" title="Row history" aria-label="Row history">🕘</button>${editable&&isAdmin()?'<button class="ico" data-a="del" title="Delete row" aria-label="Delete">✕</button>':''}</td></tr>`;
}
function drawSheet(){
  if(!$('col-owed')) return;
  const q=sheetFilter.q.toLowerCase();
  const match=r=>(!q||(r.name+' '+r.note).toLowerCase().includes(q))&&(!sheetFilter.flagged||r.flag);
  $('col-owed').innerHTML=''; $('col-held').innerHTML='';
  const t=totals();
  for(const sec of SECTIONS){
    const all=state[sec.key]||[], rows=all.map((r,i)=>[r,i]).filter(([r])=>match(r));
    const el=document.createElement('div'); el.className='sec'; el.dataset.sec=sec.key;
    const apiCount=all.filter(r=>r.source==='api').length;
    el.innerHTML=`<div class="sec-head"><div><h3>${sec.title}</h3><div class="sub">${sec.api?`${apiCount} from API, ${all.length-apiCount} manual`:sec.sub}</div></div><span class="tot" id="tot-${sec.key}">${fmt(t[sec.key])}</span></div>
      <div class="scroll"><table class="rows"><tbody>${rows.map(([r,i])=>rowHTML(r,i)).join('')}</tbody></table></div>
      ${rows.length?'':`<div class="empty">${all.length?'No rows match.':'No rows yet.'}</div>`}${meta.locked?'':'<button class="add" data-a="add">+ Add manual entry</button>'}`;
    $('col-'+sec.side).appendChild(el);
  }
}
function updateSheetTotals(){ const t=totals(); for(const s of SECTIONS){ const e=$('tot-'+s.key); if(e) e.textContent=fmt(t[s.key]); } renderTop(); }
const rowCtx = el => { const sec=el.closest('.sec')?.dataset.sec, id=el.closest('tr')?.dataset.id; return {sec,id,row:sec&&id?state[sec].find(r=>r.id===id):null}; };
async function patchRow(sec,id,body){
  try{ const r=await api(`/api/rows/${sec}/${id}`,{method:'PATCH',body}); const i=state[sec].findIndex(x=>x.id===id); state[sec][i]=r.row; meta.version=r.version; return r.row; }
  catch(e){ toast(e.message,true); await refresh(true); drawSheet(); }
}
$('content').addEventListener('input',e=>{ if(page!=='sheet'||e.target.dataset.f!=='amount') return; const {row}=rowCtx(e.target); if(row){ row.amount=parseAmt(e.target.value); updateSheetTotals(); } });
$('content').addEventListener('change',async e=>{
  if(page!=='sheet') return; const f=e.target.dataset.f; if(!f) return;
  const {sec,id}=rowCtx(e.target); if(!id) return;
  let v=e.target.value; if(f==='amount'){ v=parseAmt(v); e.target.value=v?fmt(v):''; }
  const row=await patchRow(sec,id,{[f]:v});
  if(row){ const w=e.target.closest('tr')?.querySelector('.who'); if(w) w.innerHTML=`${esc(nameOf(row.updatedBy))}<br>${dt(row.updatedAt)}`; }
  updateSheetTotals();
});
$('content').addEventListener('click',async e=>{
  if(page!=='sheet') return; const a=e.target.dataset.a; if(!a) return;
  const {sec,id,row}=rowCtx(e.target);
  if(a==='add'){ try{ const r=await api('/api/rows',{method:'POST',body:{section:sec,name:'',amount:0}}); state[sec].push(r.row); meta.version=r.version; sheetFilter.q=''; $('sQ').value=''; drawSheet();
      const ins=document.querySelectorAll(`.sec[data-sec="${sec}"] input.name`); ins[ins.length-1]?.focus(); }catch(err){ toast(err.message,true); } }
  if(a==='flag'){ await patchRow(sec,id,{flag:!row.flag}); drawSheet(); }
  if(a==='del'){ if(!confirm(`Delete "${row.name||'this row'}" (${fmt(row.amount)||0})? This is recorded in the activity log.`)) return;
    try{ const r=await api(`/api/rows/${sec}/${id}`,{method:'DELETE'}); state[sec]=state[sec].filter(x=>x.id!==id); meta.version=r.version; drawSheet(); updateSheetTotals(); toast('Row deleted'); }catch(err){ toast(err.message,true); } }
  if(a==='hist') showHistory(id,row.name);
});
async function showHistory(id,name){
  const list=await api('/api/audit?rowId='+id).catch(()=>[]);
  openDlg(`History: ${name||'(no name)'}`, list.length?`<div class="scroll"><table class="t"><thead><tr><th>When</th><th>Who</th><th>From where</th><th>What</th><th class="r">Before</th><th class="r">After</th></tr></thead><tbody>
    ${list.map(l=>`<tr><td>${dt(l.at)}</td><td>${esc(l.userName)}</td><td>${esc(l.ip)}<div class="note">${esc(l.device)}</div></td><td>${esc(l.action)} ${esc(FIELD_NAME[l.field]||l.field||'')}</td><td class="r from">${showVal(l.field,l.from)}</td><td class="r">${showVal(l.field,l.to)}</td></tr>`).join('')}
    </tbody></table></div>`:'<div class="empty">No manual changes recorded for this row. API balance changes are listed under each API refresh in the activity log.</div>');
}
const showVal=(f,v)=> v===null||v===undefined ? '' : (f==='amount'||f==='difference') ? fmt(v) : typeof v==='boolean' ? (v?'Yes':'No') : esc(v);
function exportSheet(st,date){
  const rows=[], tot={};
  for(const s of SECTIONS){
    rows.push([s.title]); rows.push(['Sr.No','Name','Amount','Source','Note','Last entry by','Last entry at']); let t=0;
    (st[s.key]||[]).forEach((r,i)=>{ t+=+r.amount||0; rows.push([i+1,r.name,r.amount||0,r.source==='api'?'API: '+connName(r.connId):r.source,r.note,nameOf(r.updatedBy),r.updatedAt?new Date(r.updatedAt).toLocaleString('en-IN'):'']); });
    tot[s.key]=t; rows.push(['',s.title+' total',t]); rows.push([]);
  }
  const g=tot.payout+tot.payin+tot.other;
  rows.push(['Grand total (Payout + Payin + Other party)','',g],['Bank total','',tot.banks],['Other uses total','',tot.uses],['Difference','',g-tot.banks-tot.uses]);
  download(`reconciliation-${date}.csv`,rows);
}
