const el = id => document.getElementById(id);
async function api(path, options) { const r = await fetch(path, options); const b = await r.json(); if (!r.ok) throw Error(b.detail || 'Request failed'); return b; }
async function load() {
  const accounts = await api('/accounts?view=all'); el('list').replaceChildren();
  for (const a of accounts.filter(a => a.is_manual)) {
    const p = document.createElement('p'); const button = document.createElement('button');
    button.textContent = `${a.name}: ${a.balance_current} ${a.currency} � Edit`;
    button.onclick = () => { el('accountId').value=a.id; for(const k of ['owner','name','type','currency']) el(k).value=a[k]; el('balance').value=a.balance_current; };
    if (String(a.id) === new URLSearchParams(location.search).get('edit')) button.onclick();
    p.append(button); el('list').append(p);
  }
}
el('form').onsubmit = async e => { e.preventDefault(); try {
 const id=el('accountId').value; const body={}; for(const k of ['owner','name','type','currency']) body[k]=el(k).value;
 body.balance_cents=Math.round(Number(el('balance').value)*100);
 await api(id ? `/accounts/${id}/manual` : '/accounts', {method:id?'PUT':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 el('form').reset(); await load(); el('status').textContent='Account saved.';
} catch(e) {el('status').textContent=e.message;} };
(async()=>{try {for(const u of await api('/users')) {const o=document.createElement('option');o.value=u.key;o.textContent=u.label;el('owner').append(o);} await load();} catch(e){el('status').textContent=e.message;}})();
