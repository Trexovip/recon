/* ================= Recon data ================= */
let reconSel={a:'live',b:null,changedOnly:true};
async function snapshotFor(key){
  if(key==='live') return {label:'Today (live)', state, totals:totals()};
  const c=await api('/api/closings/'+key); return {label:'Closing '+dLabel(key), state:c.state, totals:c.totals};
}
async function page_recon(el){
  const closings=await getClosings(true);
  const dates=closings.map(c=>c.date);
  if(!reconSel.b || !dates.includes(reconSel.b)) reconSel.b=dates.find(d=>d<meta.today)||dates[0]||null;
  if(reconSel.a!=='live' && !dates.includes(reconSel.a)) reconSel.a='live';
  const opts=sel=>`<option value="live" ${sel==='live'?'selected':''}>Today (live)</option>`+dates.map(d=>`<option value="${d}" ${sel===d?'selected':''}>Closing ${dLabel(d)}</option>`).join('');
  el.innerHTML=`<div class="filters no-print">
      <label>Compare<select class="inp" id="rA">${opts(reconSel.a)}</select></label>
      <label>With<select class="inp" id="rB">${dates.length?opts(reconSel.b):'<option>No closings yet</option>'}</select></label>
      <label style="flex-direction:row;align-items:center;gap:6px;font-weight:500;padding-bottom:7px"><input type="checkbox" id="rChg" ${reconSel.changedOnly?'checked':''}> Only rows that changed</label>
      <span style="margin-left:auto"></span><button class="btn" id="rCsv">Export to Excel (CSV)</button><button class="btn" onclick="print()">Print</button>
    </div><div id="rBody"></div>`;
  if(!dates.length){ $('rBody').innerHTML='<div class="card empty">Recon compares two points in time. Close at least one day to compare it with today.</div>'; return; }
  const draw=async()=>{
    $('rBody').innerHTML='<div class="empty">Loading…</div>';
    const [A,B]=await Promise.all([snapshotFor(reconSel.a),snapshotFor(reconSel.b)]).catch(e=>{toast(e.message,true);return [];});
    if(!A||page!=='recon') return;
    const ta=A.totals, tb=B.totals;
    const steps=[['Payout wallets',ta.payout-tb.payout],['Payin wallets',ta.payin-tb.payin],['Other party',ta.other-tb.other],['Bank accounts',-(ta.banks-tb.banks)],['Other uses',-(ta.uses-tb.uses)]];
    const vals=[tb.diff]; let run=tb.diff; for(const [,d] of steps){ run+=d; vals.push(run); }
    const lo=Math.min(0,...vals), hi=Math.max(0,...vals), span=(hi-lo)||1, X=v=>(v-lo)/span*100;
    let cur=tb.diff;
    const walk=[`<div>Difference at ${esc(B.label)}</div><div class="w-track"><div class="w-bar total" style="left:${Math.min(X(0),X(tb.diff))}%;width:${Math.abs(X(tb.diff)-X(0))}%"></div></div><div class="r"><b>${fmt(tb.diff)}</b></div>`];
    for(const [k,d] of steps){ const s=cur; cur+=d;
      walk.push(`<div>${k} ${d===0?'':d>0?'<span class="note">raised it</span>':'<span class="note">lowered it</span>'}</div><div class="w-track">${d?`<div class="w-bar ${d>0?'up':'down'}" style="left:${Math.min(X(s),X(cur))}%;width:${Math.max(.4,Math.abs(X(cur)-X(s)))}%"></div>`:''}</div><div class="r ${d>0?'loss':d<0?'gain':''}">${d?fmtS(d):'–'}</div>`); }
    walk.push(`<div><b>Difference at ${esc(A.label)}</b></div><div class="w-track"><div class="w-bar total" style="left:${Math.min(X(0),X(ta.diff))}%;width:${Math.abs(X(ta.diff)-X(0))}%"></div></div><div class="r"><b>${fmt(ta.diff)}</b></div>`);

    const secHTML=SECTIONS.map(s=>{
      const a=A.state[s.key]||[], b=B.state[s.key]||[], bm=new Map(b.map(r=>[r.id,r])), am=new Map(a.map(r=>[r.id,r]));
      let rows=[...a.map(r=>({name:rowLabel(r),open:bm.get(r.id)?.amount??null,close:r.amount??0,flag:r.flag})),...b.filter(r=>!am.has(r.id)).map(r=>({name:rowLabel(r),open:r.amount??0,close:null}))];
      rows.forEach(r=>r.mv=(r.close||0)-(r.open||0));
      const ot=rows.reduce((x,r)=>x+(r.open||0),0), ct=rows.reduce((x,r)=>x+(r.close||0),0);
      if(reconSel.changedOnly) rows=rows.filter(r=>r.mv!==0||r.open===null||r.close===null);
      rows.sort((x,y)=>Math.abs(y.mv)-Math.abs(x.mv));
      return `<div class="card"><div class="card-head"><h3>${s.title}</h3><span class="right ${ct-ot?'':'muted'}"><b>${ct-ot?fmtS(ct-ot):'No change'}</b></span></div>
        <div class="scroll"><table class="t"><thead><tr><th>Name</th><th class="r">${esc(B.label.replace('Closing ',''))}</th><th class="r">${esc(A.label.replace('Closing ',''))}</th><th class="r">Movement</th><th class="r">%</th></tr></thead><tbody>
        ${rows.map(r=>`<tr class="${r.flag?'flagged':''}"><td>${esc(r.name)}${r.open===null?' <span class="badge b-api">New</span>':r.close===null?' <span class="badge b-warn">Removed</span>':''}</td>
          <td class="r">${r.open===null?'–':fmt(r.open)}</td><td class="r">${r.close===null?'–':fmt(r.close)}</td><td class="r"><b>${r.mv?fmtS(r.mv):'–'}</b></td>
          <td class="r note">${r.open?((r.mv/r.open)*100).toFixed(1)+'%':''}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No changes</td></tr>'}
        </tbody><tfoot><tr><td>Total</td><td class="r">${fmt(ot)}</td><td class="r">${fmt(ct)}</td><td class="r">${fmtS(ct-ot)}</td><td></td></tr></tfoot></table></div></div>`;
    }).join('');
    $('rBody').innerHTML=`<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>How the difference moved</h3><span class="right note">Red raised the difference (worse), green lowered it (better)</span></div><div class="walk">${walk.join('')}</div></div>
      <div class="grid2">${secHTML}</div>`;
    $('rCsv').onclick=()=>{
      const out=[[`Recon: ${A.label} vs ${B.label}`],[],['Section','Name',B.label,A.label,'Movement']];
      for(const s of SECTIONS){ const a=A.state[s.key]||[], bm=new Map((B.state[s.key]||[]).map(r=>[r.id,r])), am=new Set(a.map(r=>r.id));
        for(const r of a) out.push([s.title,rowLabel(r),bm.get(r.id)?.amount??'',r.amount??0,(r.amount||0)-(bm.get(r.id)?.amount||0)]);
        for(const r of (B.state[s.key]||[]).filter(r=>!am.has(r.id))) out.push([s.title,rowLabel(r)+' (removed)',r.amount,'',-(r.amount||0)]); }
      out.push([],['Difference','',tb.diff,ta.diff,ta.diff-tb.diff]);
      download(`recon-${reconSel.a}-vs-${reconSel.b}.csv`,out);
    };
  };
  $('rA').onchange=e=>{reconSel.a=e.target.value; draw();};
  $('rB').onchange=e=>{reconSel.b=e.target.value; draw();};
  $('rChg').onchange=e=>{reconSel.changedOnly=e.target.checked; draw();};
  draw();
}

/* ================= Profit & loss entries ================= */
let pnlF={from:null,to:null,type:'',cat:''};
async function page_pnl(el){
  if(!pnlF.from){ pnlF.from=meta.today.slice(0,8)+'01'; pnlF.to=meta.today; }
  const S=meta.settings;
  el.innerHTML=`<div class="card no-print" style="margin-bottom:18px"><h3>Add income or expense</h3>
      <form id="pForm" class="form-grid">
        <div><label class="f">Date</label><input class="inp" type="date" id="pDate" value="${meta.today}" max="${meta.today}"></div>
        <div><label class="f">Type</label><div class="seg" id="pType"><button type="button" data-t="income" aria-pressed="true">Income</button><button type="button" data-t="expense" aria-pressed="false">Expense</button></div></div>
        <div><label class="f">Category</label><select class="inp" id="pCat"></select></div>
        <div><label class="f">Party / account</label><input class="inp" id="pParty" placeholder="e.g. Mercalix"></div>
        <div><label class="f">Amount</label><input class="inp" id="pAmt" inputmode="decimal" required></div>
        <div><label class="f">Note</label><input class="inp" id="pNote"></div>
        <div><button class="btn primary">Add entry</button></div>
      </form></div>
    <div class="grid3" id="pStats" style="margin-bottom:18px"></div>
    <div class="filters no-print">
      <label>From<input class="inp" type="date" id="fFrom" value="${pnlF.from}"></label>
      <label>To<input class="inp" type="date" id="fTo" value="${pnlF.to}"></label>
      <label>Type<select class="inp" id="fType"><option value="">All</option><option value="income">Income</option><option value="expense">Expense</option></select></label>
      <label>Category<select class="inp" id="fCat"><option value="">All</option>${[...S.incomeCategories,...S.expenseCategories].map(c=>`<option>${esc(c)}</option>`).join('')}</select></label>
      <span style="margin-left:auto"></span><button class="btn" id="pCsv">Export to Excel (CSV)</button>
    </div>
    <div class="card" style="padding:0"><div class="scroll"><table class="t"><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Party</th><th>Note</th><th class="r">Amount</th><th>Entered by</th><th></th></tr></thead><tbody id="pBody"></tbody></table></div></div>`;
  let type='income';
  const setCats=()=>{ $('pCat').innerHTML=(type==='income'?S.incomeCategories:S.expenseCategories).map(c=>`<option>${esc(c)}</option>`).join(''); };
  $('pType').querySelectorAll('button').forEach(b=>b.onclick=()=>{ type=b.dataset.t; $('pType').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b)); setCats(); });
  setCats(); $('fType').value=pnlF.type; $('fCat').value=pnlF.cat;
  $('pForm').onsubmit=async e=>{ e.preventDefault();
    try{ await api('/api/pnl',{method:'POST',body:{date:$('pDate').value,type,category:$('pCat').value,party:$('pParty').value,amount:parseAmt($('pAmt').value),note:$('pNote').value}});
      $('pAmt').value=''; $('pNote').value=''; $('pParty').value=''; toast('Entry added'); load(); refresh(true); }catch(err){ toast(err.message,true); } };
  for(const [id,k] of [['fFrom','from'],['fTo','to'],['fType','type'],['fCat','cat']]) $(id).onchange=e=>{ pnlF[k]=e.target.value; load(); };
  let rows=[];
  async function load(){
    rows=(await api(`/api/pnl?from=${pnlF.from}&to=${pnlF.to}`).catch(()=>[])).filter(e=>(!pnlF.type||e.type===pnlF.type)&&(!pnlF.cat||e.category===pnlF.cat));
    const inc=rows.filter(e=>e.type==='income').reduce((a,e)=>a+e.amount,0), exp=rows.filter(e=>e.type==='expense').reduce((a,e)=>a+e.amount,0);
    $('pStats').innerHTML=`<div class="card stat"><small>Income</small><b class="gain">${fmt(inc)}</b></div><div class="card stat"><small>Expenses</small><b class="loss">${fmt(exp)}</b></div>
      <div class="card stat"><small>${inc-exp>=0?'Net profit':'Net loss'}</small><b class="${inc-exp>=0?'gain':'loss'}">${fmtS(inc-exp)}</b><div class="sub">${dShort(pnlF.from)} to ${dShort(pnlF.to)}</div></div>`;
    $('pBody').innerHTML=rows.map(e=>`<tr data-id="${e.id}"><td>${dShort(e.date)}</td><td><span class="badge ${e.type==='income'?'b-in':'b-out'}">${e.type==='income'?'Income':'Expense'}</span></td>
      <td>${esc(e.category)}</td><td>${esc(e.party)}</td><td class="note">${esc(e.note)}</td><td class="r"><b class="${e.type==='income'?'gain':'loss'}">${fmt(e.amount)}</b></td>
      <td class="note">${esc(e.createdByName)}<br>${dt(e.createdAt)}</td>
      <td class="r" style="white-space:nowrap"><button class="ico" data-pa="edit" title="Edit">✎</button><button class="ico" data-pa="hist" title="History">🕘</button>${isAdmin()?'<button class="ico" data-pa="del" title="Delete">✕</button>':''}</td></tr>`).join('')
      ||'<tr><td colspan="8" class="empty">No entries in this period.</td></tr>';
    $('pBody').querySelectorAll('[data-pa]').forEach(b=>b.onclick=()=>{ const e=rows.find(x=>x.id===b.closest('tr').dataset.id); pnlAction(b.dataset.pa,e,load); });
    $('pCsv').onclick=()=>download(`pnl-${pnlF.from}-to-${pnlF.to}.csv`,[['Date','Type','Category','Party','Note','Amount','Entered by','Entered at'],
      ...rows.map(e=>[e.date,e.type,e.category,e.party,e.note,e.type==='income'?e.amount:-e.amount,e.createdByName,new Date(e.createdAt).toLocaleString('en-IN')]),[],['','','','','Income',inc],['','','','','Expenses',-exp],['','','','','Net',inc-exp]]);
  }
  load();
}
async function pnlAction(a,e,reload){
  if(a==='hist') return showHistory(e.id,`${e.category} ${fmt(e.amount)}`);
  if(a==='del'){ if(!confirm(`Delete this ${e.type} of ${fmt(e.amount)}?`)) return; try{ await api('/api/pnl/'+e.id,{method:'DELETE'}); toast('Entry deleted'); reload(); refresh(true); }catch(err){ toast(err.message,true); } return; }
  const S=meta.settings, cats=t=>(t==='income'?S.incomeCategories:S.expenseCategories);
  const b=openDlg('Edit entry',`<form id="eForm" class="form-grid">
    <div><label class="f">Date</label><input class="inp" type="date" id="eDate" value="${e.date}"></div>
    <div><label class="f">Type</label><select class="inp" id="eType"><option value="income">Income</option><option value="expense">Expense</option></select></div>
    <div><label class="f">Category</label><select class="inp" id="eCat"></select></div>
    <div><label class="f">Party</label><input class="inp" id="eParty" value="${esc(e.party)}"></div>
    <div><label class="f">Amount</label><input class="inp" id="eAmt" value="${fmt(e.amount)}"></div>
    <div><label class="f">Note</label><input class="inp" id="eNote" value="${esc(e.note)}"></div>
    <div><button class="btn primary">Save changes</button></div></form>`);
  const fill=()=>{ const list=cats($('eType').value); $('eCat').innerHTML=[...new Set([...list,e.category])].map(c=>`<option ${c===e.category?'selected':''}>${esc(c)}</option>`).join(''); };
  $('eType').value=e.type; fill(); $('eType').onchange=fill;
  $('eForm').onsubmit=async ev=>{ ev.preventDefault();
    try{ await api('/api/pnl/'+e.id,{method:'PATCH',body:{date:$('eDate').value,type:$('eType').value,category:$('eCat').value,party:$('eParty').value,amount:parseAmt($('eAmt').value),note:$('eNote').value}}); dlg.close(); toast('Entry saved'); reload(); refresh(true); }
    catch(err){ toast(err.message,true); } };
}

/* ================= Reports ================= */
let repP='month', repFrom=null, repTo=null;
function periodRange(p){
  const t=meta.today, y=t.slice(0,4), m=t.slice(0,7);
  if(p==='today') return [t,t];
  if(p==='7d') return [addDays(t,-6),t];
  if(p==='month') return [m+'-01',t];
  if(p==='lastmonth'){ const first=addDays(m+'-01',-1).slice(0,7)+'-01'; return [first,addDays(m+'-01',-1)]; }
  if(p==='year') return [y+'-01-01',t];
  return [repFrom||m+'-01',repTo||t];
}
async function page_reports(el){
  el.innerHTML=`<div class="filters no-print">
      <div class="seg" id="repSeg">${[['today','Today'],['7d','Last 7 days'],['month','This month'],['lastmonth','Last month'],['year','This year'],['custom','Custom']].map(([k,l])=>`<button data-p="${k}" aria-pressed="${repP===k}">${l}</button>`).join('')}</div>
      <label class="${repP==='custom'?'':'hidden'}" id="rcF">From<input class="inp" type="date" id="repFrom"></label>
      <label class="${repP==='custom'?'':'hidden'}" id="rcT">To<input class="inp" type="date" id="repTo"></label>
      <span style="margin-left:auto"></span><button class="btn" id="repCsv">Export to Excel (CSV)</button><button class="btn" onclick="print()">Print</button>
    </div><div id="repBody"><div class="empty">Loading…</div></div>`;
  $('repSeg').querySelectorAll('button').forEach(b=>b.onclick=()=>{ repP=b.dataset.p; page_reports(el); });
  const [from,to]=periodRange(repP); $('repFrom').value=from; $('repTo').value=to;
  $('repFrom').onchange=e=>{repFrom=e.target.value; page_reports(el);}; $('repTo').onchange=e=>{repTo=e.target.value; page_reports(el);};
  const [entries,closings]=await Promise.all([api(`/api/pnl?from=${from}&to=${to}`).catch(()=>[]),getClosings(true)]);
  if(page!=='reports') return;
  const inc=entries.filter(e=>e.type==='income'), exp=entries.filter(e=>e.type==='expense');
  const I=inc.reduce((a,e)=>a+e.amount,0), E=exp.reduce((a,e)=>a+e.amount,0), N=I-E;
  const sorted=[...closings].sort((a,b)=>a.date.localeCompare(b.date));
  const start=sorted.filter(c=>c.date<from).pop()||sorted.find(c=>c.date>=from&&c.date<=to);
  let end=sorted.filter(c=>c.date<=to).pop(); let endLabel=end?dShort(end.date):'';
  const live=to>=meta.today && !meta.locked;
  const endDiff=live?totals().diff:end?.totals.diff, startDiff=start?.totals.diff;
  if(live) endLabel='today (live)';
  const posChange=(startDiff!=null&&endDiff!=null)?startDiff-endDiff:null;
  const days=daysBetween(from,to), byDay={};
  for(const e of entries){ byDay[e.date]??={i:0,e:0}; byDay[e.date][e.type==='income'?'i':'e']+=e.amount; }
  const cByDate=Object.fromEntries(sorted.map(c=>[c.date,c]));
  const group=list=>{ const g={}; for(const e of list) g[e.category]=(g[e.category]||0)+e.amount; return Object.entries(g).sort((a,b)=>b[1]-a[1]); };
  const gi=group(inc), ge=group(exp);
  const parties={}; for(const e of entries) if(e.party){ parties[e.party]??={i:0,e:0}; parties[e.party][e.type==='income'?'i':'e']+=e.amount; }
  const partyRows=Object.entries(parties).map(([k,v])=>({k,...v,n:v.i-v.e})).sort((a,b)=>Math.abs(b.n)-Math.abs(a.n)).slice(0,10);
  const catTable=(rows,total,cls)=>rows.length?`<table class="t"><tbody>${rows.map(([k,v])=>`<tr><td>${esc(k)}</td><td class="r ${cls}">${fmt(v)}</td><td class="r note">${total?(v/total*100).toFixed(1)+'%':''}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td><td class="r">${fmt(total)}</td><td></td></tr></tfoot></table>`:'<div class="empty">None in this period.</div>';

  // top movers between start and end closings
  let movers='<div class="empty">Needs a closing at the start and end of the period.</div>';
  if(start && (end||live) && (live || end.date!==start.date)){
    const [A,B]=await Promise.all([live?{state}:api('/api/closings/'+end.date),api('/api/closings/'+start.date)]).catch(()=>[]);
    if(A&&B){ const list=[]; for(const s of SECTIONS){ const bm=new Map((B.state[s.key]||[]).map(r=>[r.id,r.amount||0])); for(const r of A.state[s.key]||[]){ const d=(r.amount||0)-(bm.get(r.id)||0); if(d) list.push({s:s.title,n:rowLabel(r),d}); } }
      list.sort((a,b)=>Math.abs(b.d)-Math.abs(a.d));
      movers=list.length?`<table class="t"><thead><tr><th>Name</th><th>Section</th><th class="r">Change</th></tr></thead><tbody>${list.slice(0,12).map(m=>`<tr><td>${esc(m.n)}</td><td class="note">${m.s}</td><td class="r"><b>${fmtS(m.d)}</b></td></tr>`).join('')}</tbody></table>`:'<div class="empty">No changes.</div>'; }
  }
  if(page!=='reports') return;
  $('repBody').innerHTML=`
    <div class="grid4">
      <div class="card stat"><small>Income</small><b class="gain">${fmt(I)}</b><div class="sub">${inc.length===1?'1 entry':inc.length+' entries'}</div></div>
      <div class="card stat"><small>Expenses</small><b class="loss">${fmt(E)}</b><div class="sub">${exp.length===1?'1 entry':exp.length+' entries'}</div></div>
      <div class="card stat"><small>${N>=0?'Net profit':'Net loss'}</small><b class="${N>=0?'gain':'loss'}">${fmtS(N)}</b><div class="sub">${I?`Margin ${(N/I*100).toFixed(1)}% of income`:'Income − expenses'}</div></div>
      <div class="card stat"><small>Funds position change</small><b class="${posChange==null?'':posChange>=0?'gain':'loss'}">${posChange==null?'–':fmtS(posChange)}</b><div class="sub">${posChange==null?'Needs day-end closings':`Difference ${fmt(startDiff)} on ${dShort(start.date)} → ${fmt(endDiff)} ${endLabel}`}</div></div>
    </div>
    <p class="note" style="margin:10px 2px 18px">Net profit comes from the income and expense entries. Funds position change shows how much the gap between money held and money owed improved (positive) or worsened (negative) over the period.</p>
    <div class="grid2">
      <div class="card"><h3>Daily profit and loss</h3>${barChart(days.map(d=>({label:dLabel(d),short:dShort(d),y:(byDay[d]?.i||0)-(byDay[d]?.e||0)})))}</div>
      <div class="card"><h3>Difference at each closing</h3>${lineChart(sorted.filter(c=>c.date>=from&&c.date<=to).map(c=>({label:dLabel(c.date),short:dShort(c.date),y:c.totals.diff})))}</div>
      <div class="card"><h3>Income by category</h3>${catTable(gi,I,'gain')}</div>
      <div class="card"><h3>Expenses by category</h3>${catTable(ge,E,'loss')}</div>
      <div class="card"><h3>By party</h3>${partyRows.length?`<table class="t"><thead><tr><th>Party</th><th class="r">Income</th><th class="r">Expenses</th><th class="r">Net</th></tr></thead><tbody>${partyRows.map(p=>`<tr><td>${esc(p.k)}</td><td class="r">${fmt(p.i)}</td><td class="r">${fmt(p.e)}</td><td class="r ${p.n>=0?'gain':'loss'}"><b>${fmtS(p.n)}</b></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Add a party name to entries to see this.</div>'}</div>
      <div class="card"><h3>Biggest balance movements</h3>${movers}</div>
    </div>
    <div class="card" style="margin-top:18px;padding:0"><div style="padding:14px 16px 0"><h3>Daily statement</h3></div><div class="scroll"><table class="t"><thead><tr><th>Date</th><th class="r">Income</th><th class="r">Expenses</th><th class="r">Net</th><th class="r">Closing difference</th><th class="r">Difference change</th><th>Closed by</th></tr></thead><tbody>
      ${days.slice().reverse().map(d=>{ const c=cByDate[d], v=byDay[d]||{i:0,e:0}; if(!c&&!v.i&&!v.e) return '';
        const ch=c&&c.prevDiff!=null?c.totals.diff-c.prevDiff:null;
        return `<tr><td>${dLabel(d)}</td><td class="r">${v.i?fmt(v.i):'–'}</td><td class="r">${v.e?fmt(v.e):'–'}</td><td class="r ${v.i-v.e>=0?'gain':'loss'}"><b>${v.i||v.e?fmtS(v.i-v.e):'–'}</b></td>
          <td class="r">${c?fmt(c.totals.diff):'<span class="note">Not closed</span>'}</td><td class="r ${ch>0?'loss':ch<0?'gain':''}">${ch==null?'–':fmtS(ch)}</td><td class="note">${c?esc(c.closedByName):''}</td></tr>`; }).join('')||'<tr><td colspan="7" class="empty">Nothing in this period.</td></tr>'}
    </tbody><tfoot><tr><td>Total</td><td class="r">${fmt(I)}</td><td class="r">${fmt(E)}</td><td class="r">${fmtS(N)}</td><td></td><td></td><td></td></tr></tfoot></table></div></div>`;
  $('repCsv').onclick=()=>{
    const out=[[`Profit & loss report ${from} to ${to}`],[],['Income',I],['Expenses',E],['Net',N],['Funds position change',posChange??''],[],['Income by category'],...gi,[],['Expenses by category'],...ge,[],['Daily statement'],['Date','Income','Expenses','Net','Closing difference']];
    for(const d of days){ const c=cByDate[d], v=byDay[d]||{i:0,e:0}; if(c||v.i||v.e) out.push([d,v.i,v.e,v.i-v.e,c?c.totals.diff:'']); }
    download(`report-${from}-to-${to}.csv`,out);
  };
}

/* ================= Day-end closing ================= */
async function page_closing(el){
  const t=totals(), pt=meta.pnlToday||{income:0,expense:0,net:0};
  const kv=(tt,p)=>`<div class="grid4" style="margin:6px 0 14px">${[['Payout',tt.payout],['Payin',tt.payin],['Other party',tt.other],['Grand total',tt.grand],['Bank accounts',tt.banks],['Other uses',tt.uses]].map(([k,v])=>`<div class="card stat" style="padding:10px 12px"><small>${k}</small><b style="font-size:17px">${fmt(v)}</b></div>`).join('')}
    <div class="card stat" style="padding:10px 12px;background:var(--ink);color:var(--paper);border-color:var(--ink)"><small style="color:inherit;opacity:.75">${diffWord(tt.diff)}</small><b style="font-size:17px">${fmt(Math.abs(tt.diff))}</b></div>
    ${p?`<div class="card stat" style="padding:10px 12px"><small>Profit / loss</small><b style="font-size:17px" class="${p.net>=0?'gain':'loss'}">${fmtS(p.net)}</b></div>`:''}</div>`;
  el.innerHTML=`<div class="card" style="margin-bottom:18px">
      <h3>${meta.locked?`${dLabel(meta.today)} is closed`:`Close ${dLabel(meta.today)}`}</h3>${kv(t,pt)}
      ${meta.locked?`<div class="note">Closed by ${esc(meta.closing.closedByName)} at ${tm(meta.closing.closedAt)}.</div>`:`<div class="row-gap"><input class="inp" id="cRem" placeholder="Remarks (optional), e.g. HDFC statement pending" style="max-width:520px"><button class="btn primary" id="cBtn">Close today and lock entries</button></div>`}
    </div>
    <div class="card" style="padding:0"><div class="scroll"><table class="t"><thead><tr><th>Date</th><th class="r">Payout</th><th class="r">Payin</th><th class="r">Other party</th><th class="r">Banks</th><th class="r">Other uses</th><th class="r">Difference</th><th class="r">Change</th><th class="r">Profit / loss</th><th>Closed by</th><th></th></tr></thead><tbody id="cBody"><tr><td colspan="11" class="empty">Loading…</td></tr></tbody></table></div></div>`;
  if($('cBtn')) $('cBtn').onclick=async()=>{
    if(!confirm(`Close ${dLabel(meta.today)} with a difference of ${fmt(t.diff)}?\n\nEntries will be locked for today.`)) return;
    try{ await api('/api/closings',{method:'POST',body:{remarks:$('cRem').value}}); toast('Day closed'); await refresh(true); page_closing(el); }catch(e){ toast(e.message,true); } };
  const list=await getClosings(true); if(page!=='closing') return;
  $('cBody').innerHTML=list.map(c=>{ const ch=c.prevDiff==null?null:c.totals.diff-c.prevDiff, p=c.pnl||{net:0};
    return `<tr><td><b>${dLabel(c.date)}</b>${c.remarks?`<div class="note">${esc(c.remarks)}</div>`:''}</td><td class="r">${fmt(c.totals.payout)}</td><td class="r">${fmt(c.totals.payin)}</td><td class="r">${fmt(c.totals.other)}</td>
      <td class="r">${fmt(c.totals.banks)}</td><td class="r">${fmt(c.totals.uses)}</td><td class="r"><b>${fmt(c.totals.diff)}</b></td>
      <td class="r ${ch>0?'loss':ch<0?'gain':''}">${ch==null?'–':fmtS(ch)}</td><td class="r ${p.net>=0?'gain':'loss'}">${p.net?fmtS(p.net):'–'}</td>
      <td class="note">${esc(c.closedByName)}<br>${dt(c.closedAt)}, ${c.entries===1?'1 entry':c.entries+' entries'}</td>
      <td class="r" style="white-space:nowrap"><button class="btn sm" data-v="${c.date}">View</button>${isAdmin()?` <button class="btn sm" data-ro="${c.date}">Reopen</button>`:''}</td></tr>`; }).join('')||'<tr><td colspan="11" class="empty">No days closed yet.</td></tr>';
  $('cBody').querySelectorAll('[data-v]').forEach(b=>b.onclick=async()=>{
    const c=await api('/api/closings/'+b.dataset.v).catch(e=>toast(e.message,true)); if(!c) return;
    openDlg(`Closing for ${dLabel(c.date)}`,`<div class="note">Closed by ${esc(c.closedByName)} at ${dt(c.closedAt)}${c.remarks?'. Remarks: '+esc(c.remarks):''}</div>${kv(c.totals,c.pnl)}
      <div class="row-gap"><button class="btn" id="vCsv">Export to Excel (CSV)</button><button class="btn" id="vRecon">Compare with today</button></div>
      ${SECTIONS.map(s=>`<h4 style="margin:16px 0 6px">${s.title}: ${fmt(c.totals[s.key])}</h4><div class="scroll"><table class="t"><tbody>
        ${(c.state[s.key]||[]).map((r,i)=>`<tr class="${r.flag?'flagged':''}"><td class="note" style="width:30px">${i+1}</td><td class="name">${esc(rowLabel(r))}${r.note?`<div class="note">${esc(r.note)}</div>`:''}</td><td class="r">${fmt(r.amount)||'–'}</td></tr>`).join('')}
      </tbody></table></div>`).join('')}`);
    $('vCsv').onclick=()=>exportSheet(c.state,c.date);
    $('vRecon').onclick=()=>{ dlg.close(); reconSel={a:'live',b:c.date,changedOnly:true}; go('recon'); };
  });
  $('cBody').querySelectorAll('[data-ro]').forEach(b=>b.onclick=async()=>{
    if(!confirm(`Reopen ${dLabel(b.dataset.ro)}? Its closing record will be removed so it can be closed again.`)) return;
    try{ await api('/api/closings/'+b.dataset.ro,{method:'DELETE'}); toast('Day reopened'); await refresh(true); page_closing(el); }catch(e){ toast(e.message,true); } });
}

/* ================= Activity log ================= */
let logF={date:null,user:'',sec:'',q:''};
async function page_log(el){
  logF.date??=meta.today;
  el.innerHTML=`<div class="filters">
      <label>Date<input type="date" class="inp" id="lDate" value="${logF.date}" max="${meta.today}"></label>
      <label>Person<select class="inp" id="lUser"><option value="">Everyone</option></select></label>
      <label>Section<select class="inp" id="lSec"><option value="">All</option>${Object.entries(SEC_NAME).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}<option value="_sys">Logins, API, closings, settings</option></select></label>
      <label>Search<input class="inp" id="lQ" placeholder="Name, note, IP…" value="${esc(logF.q)}"></label>
      <span style="margin-left:auto"></span><button class="btn" id="lCsv">Export to Excel (CSV)</button>
    </div>
    <div class="card" style="padding:0"><div class="scroll"><table class="t" style="min-width:960px"><thead><tr><th>Time</th><th>Who</th><th>From where</th><th>Action</th><th>Section</th><th>Row</th><th>Field</th><th class="r">Before</th><th class="r">After</th></tr></thead><tbody id="lBody"></tbody></table></div></div>`;
  $('lSec').value=logF.sec;
  const rowsAll=await api('/api/audit?date='+logF.date).catch(()=>[]); if(page!=='log') return;
  const people=[...new Map(rowsAll.map(l=>[l.user,l.userName])).entries()];
  $('lUser').innerHTML='<option value="">Everyone</option>'+people.map(([u,n])=>`<option value="${esc(u)}">${esc(n)}</option>`).join(''); $('lUser').value=logF.user;
  const draw=()=>{
    const q=logF.q.toLowerCase();
    const rows=rowsAll.filter(l=>(!logF.user||l.user===logF.user)&&(!logF.sec||(logF.sec==='_sys'?!l.section:l.section===logF.sec))&&(!q||JSON.stringify(l).toLowerCase().includes(q)));
    $('lBody').innerHTML=rows.map((l,i)=>`<tr><td>${tm(l.at)}</td><td>${esc(l.userName)}<div class="note">${esc(l.role)}</div></td><td>${esc(l.ip)}<div class="note">${esc(l.device)}</div></td>
      <td>${esc(l.action)}${l.details?.length?` <button class="btn sm" data-det="${i}">Details</button>`:''}</td><td>${esc(SEC_NAME[l.section]||'')}</td><td>${esc(l.rowName||'')}</td>
      <td>${esc(FIELD_NAME[l.field]||l.field||'')}</td><td class="r from">${showVal(l.field,l.from)}</td><td class="r">${showVal(l.field,l.to)}</td></tr>`).join('')||'<tr><td colspan="9" class="empty">Nothing recorded.</td></tr>';
    $('lBody').querySelectorAll('[data-det]').forEach(b=>b.onclick=()=>{ const l=rows[+b.dataset.det];
      openDlg(l.action+' details',`<div class="scroll"><table class="t"><thead><tr><th>Section</th><th>Account</th><th>Change</th><th class="r">Before</th><th class="r">After</th></tr></thead><tbody>
        ${l.details.map(d=>`<tr><td>${esc(SEC_NAME[d.section])}</td><td>${esc(d.rowName)}</td><td class="note">${esc(d.what||'')}</td><td class="r from">${d.from==null?'':fmt(d.from)}</td><td class="r">${d.to==null?'':fmt(d.to)}</td></tr>`).join('')}</tbody></table></div>`); });
    $('lCsv').onclick=()=>download(`activity-${logF.date}.csv`,[['Time','User','Role','IP','Device','Action','Section','Row','Field','Before','After'],
      ...rows.map(l=>[new Date(l.at).toLocaleString('en-IN'),l.userName,l.role,l.ip,l.device,l.action,SEC_NAME[l.section]||'',l.rowName||'',FIELD_NAME[l.field]||l.field||'',l.from??'',l.to??''])]);
  };
  $('lDate').onchange=e=>{logF.date=e.target.value; page_log(el);};
  $('lUser').onchange=e=>{logF.user=e.target.value; draw();}; $('lSec').onchange=e=>{logF.sec=e.target.value; draw();}; $('lQ').oninput=e=>{logF.q=e.target.value; draw();};
  draw();
}
