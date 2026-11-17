(function () {
  const el = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let accounts = [], users = [], selected = '';
  const fields = [['holder_name','Owner / holder'],['beneficiary_name','Child beneficiary'],['responsible_adult_name','Responsible adult']];
  const household = a => users.find(u => u.key === a.owner)?.label || a.owner;
  const key = s => s.trim().toLocaleLowerCase();
  const money = (v,c) => v == null ? 'Not available' : new Intl.NumberFormat(undefined,{style:'currency',currency:/^[A-Z]{3}$/.test(c || '')?c:'USD'}).format(v);
  async function api(path, options) { const r=await fetch(path,options); const b=await r.json(); if(!r.ok) throw Error(b.detail || 'Unable to load accounts'); return b; }
  function render() {
    const names = new Map();
    for(const a of accounts) for(const name of [household(a), ...fields.map(([f])=>a[f])]) if(name) names.set(key(name),name);
    el('people').innerHTML = `<button type="button" data-person="" aria-pressed="${!selected}">Everyone</button>` + [...names].map(([k,n])=>`<button type="button" data-person="${esc(k)}" aria-pressed="${selected===k}">${esc(n)}</button>`).join('');
    const rows=accounts.filter(a=>!selected || [household(a),...fields.map(([f])=>a[f])].some(n=>n && key(n)===selected));
    const totals=new Map();
    for(const a of rows) { const c=a.currency || 'USD'; if(!totals.has(c)) totals.set(c,{assets:0,debts:0,missing:0}); const t=totals.get(c); if(a.balance_current==null){t.missing++;continue;} if(['credit','loan'].includes(a.type))t.debts+=a.balance_current; else if(['depository','investment'].includes(a.type))t.assets+=a.balance_current; }
    el('totals').innerHTML=[...totals].map(([c,t])=>`<article class="balance-total"><h2>${esc(c)} balances</h2>Assets<strong>${esc(money(t.assets,c))}</strong>Debts<strong>${esc(money(t.debts,c))}</strong>Net worth<strong>${esc(money(t.assets-t.debts,c))}</strong>${t.missing?`<p>${t.missing} account(s) have no balance and are excluded from totals.</p>`:''}</article>`).join('');
    el('accountList').innerHTML=rows.length?rows.map(a=>`<article class="account-card"><h2>${esc(a.name || 'Account')}</h2><span>${a.is_manual?'Manual':'Connected'}</span><strong class="amount">${esc(money(a.balance_current,a.currency))}</strong><dl><dt>Institution</dt><dd>${esc(a.institution_name || 'Not specified')}</dd><dt>Account type</dt><dd>${esc(a.subtype || a.type || 'Not specified')}</dd><dt>Household person</dt><dd>${esc(household(a))}</dd>${fields.map(([f,l])=>`<dt>${l}</dt><dd>${esc(a[f] || 'Not specified')}</dd>`).join('')}<dt>Balance updated</dt><dd>${esc(a.updated_at ? new Date(a.updated_at).toLocaleString() : 'Unknown')}</dd></dl><div class="account-actions">${a.is_manual?`<a href="/manual.html?edit=${a.id}">Edit balance</a>`:''}<button type="button" class="pill" data-edit-people="${a.id}">Edit relationships</button></div></article>`).join(''):'<p class="account-empty">No saved accounts for this view. Add an account to start tracking balances.</p>';
  }
  el('people').onclick=e=>{const b=e.target.closest('[data-person]');if(b){selected=b.dataset.person;render();}};
  el('accountList').onclick=e=>{const b=e.target.closest('[data-edit-people]');if(!b)return;const a=accounts.find(a=>a.id===Number(b.dataset.editPeople));el('peopleAccount').value=a.id;for(const [f] of fields)el(f).value=a[f]||'';el('peopleError').textContent='';el('relationships').showModal();};
  el('cancelPeople').onclick=()=>el('relationships').close();
  el('peopleForm').onsubmit=async e=>{e.preventDefault();try{const body={};for(const [f] of fields)body[f]=el(f).value.trim()||null;await api(`/accounts/${el('peopleAccount').value}/people`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});accounts=await api('/accounts?view=all');render();el('relationships').close();}catch(e){el('peopleError').textContent=e.message;}};
  Promise.all([api('/accounts?view=all'),api('/users')]).then(([a,u])=>{accounts=a;users=u;render();}).catch(e=>{el('accountStatus').textContent=e.message;});
})();
