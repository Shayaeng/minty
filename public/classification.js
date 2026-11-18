(function(){
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let data=null,polls=0;
  const options=p=>`<option value="">Choose purpose</option><option value="personal" ${p==='personal'?'selected':''}>Personal</option><option value="churning" ${p==='churning'?'selected':''}>Churning</option>`;
  async function load(){const item=new URLSearchParams(location.search).get('item_id');const r=await fetch('/account-setup'+(item?'?item_id='+encodeURIComponent(item):''));data=await r.json();if(!r.ok)throw Error(data.detail||'Unable to load setup');
    $('classificationAccounts').innerHTML=data.accounts.length?data.accounts.map(a=>`<article class="classification-row"><div><strong>${esc(a.institution_name||'Institution not specified')} · ${esc(a.name||'Account')}</strong><p>${esc(a.subtype||a.type||'Type unknown')} ${a.mask?' · Last four '+esc(a.mask):''}</p><p>Household person: ${esc(a.owner_label)} · ${a.account_status==='closed'?'Closed':'Open'}${a.inventory_only?' · Inventory only':''}</p></div><label>Purpose<select required data-account-id="${a.id}">${options(a.purpose)}</select></label></article>`).join(''):'<p>No unclassified accounts are waiting right now. If a bank is still downloading accounts, refresh this page after sync.</p>';
    $('standaloneSetup').hidden=!data.standalone.length;$('classificationStandalone').innerHTML=data.standalone.map(r=>`<article class="classification-row"><div>${esc(r.kind==='bill'?'Bill':'Points')} · ${esc(r.name)}<p>Household person: ${esc(r.owner_label)}</p></div><label>Purpose<select required data-record-id="${r.id}" data-record-kind="${r.kind}">${options(null)}</select></label></article>`).join('');
    $('saveClassifications').disabled=!data.accounts.length&&!data.standalone.length;
    if(item&&!data.accounts.length&&polls++<20){
      $('classificationStatus').textContent='Waiting for Plaid to import the account list. New accounts remain Unclassified until you choose.';
      setTimeout(()=>load().catch(e=>$('classificationStatus').textContent=e.message),2000);
    }
  }
  document.querySelectorAll('[data-bulk-purpose]').forEach(b=>b.onclick=()=>document.querySelectorAll('[data-account-id]').forEach(s=>s.value=b.dataset.bulkPurpose));
  $('classificationForm').onsubmit=async e=>{
    e.preventDefault();$('saveClassifications').disabled=true;
    try{
      const accounts=[...document.querySelectorAll('[data-account-id]')].map(s=>({id:Number(s.dataset.accountId),purpose:s.value}));
      const standalone=[...document.querySelectorAll('[data-record-id]')].map(s=>({id:Number(s.dataset.recordId),kind:s.dataset.recordKind,purpose:s.value}));
      for(let i=0;i<Math.max(accounts.length,standalone.length);i+=100){
        const r=await fetch('/account-setup',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({accounts:accounts.slice(i,i+100),standalone:standalone.slice(i,i+100)})});
        const b=await r.json();if(!r.ok)throw Error(b.detail||'Unable to save');
      }
      $('classificationStatus').textContent='Classifications saved. Your current financial view is unchanged.';await load();
    }catch(e){$('classificationStatus').textContent=e.message+' Already saved choices are retained; refresh to finish the remaining accounts.';$('saveClassifications').disabled=false;}
  };
  load().catch(e=>$('classificationStatus').textContent=e.message);
})();
