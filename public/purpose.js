// Loaded synchronously in every page's head, before any data fetch or application script.
(function(){
  const key='minty_purpose',root=document.documentElement;
  const valid=p=>p==='personal'||p==='churning';
  const read=()=>{try{const p=localStorage.getItem(key);if(valid(p))return p;}catch{}const p=document.cookie.match(/(?:^|; )minty_purpose=(personal|churning)(?:;|$)/)?.[1];return valid(p)?p:'personal';};
  const selected=read();root.dataset.purpose=selected;
  const nativeFetch=window.fetch.bind(window);
  const neutral=new Set(['/healthz','/people','/users','/account-types','/account-setup','/capacity','/sync-request']);
  const pages=new Set(['/','/account-overview','/manual','/connect','/add-user','/connections-setup','/account-classification']);
  const api=url=>url.origin===location.origin&&!pages.has(url.pathname)&&!url.pathname.split('/').at(-1).includes('.');
  window.fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:input,location.href);
    if(!api(url))return nativeFetch(input,init);
    url.searchParams.set('purpose',selected);
    const request=new Request(input instanceof Request?input:new URL(input,location.href),init);
    const headers=new Headers(request.headers);headers.set('x-minty-purpose',selected);
    // Buffer the small JSON body: forwarding Request.body would turn ordinary form saves
    // into streaming uploads, which Chromium refuses on the local HTTP/1 development server.
    const response=await nativeFetch(url,{method:request.method,headers,credentials:request.credentials,
      cache:request.cache,redirect:request.redirect,mode:request.mode,signal:request.signal,
      referrerPolicy:request.referrerPolicy,integrity:request.integrity,keepalive:request.keepalive,
      ...(!['GET','HEAD'].includes(request.method)?{body:await request.blob()}:{})});
    if(response.ok&&!neutral.has(url.pathname)&&!url.pathname.startsWith('/link/')&&response.headers.get('x-minty-purpose')!==selected)throw Error('Minty could not verify the selected view. Reload after the Worker update finishes.');
    return response;
  };
  function hide(){root.dataset.purposeChanging='true';}
  function select(p){if(!valid(p)||p===selected)return;hide();try{localStorage.setItem(key,p);}catch{}document.cookie=`minty_purpose=${p}; Path=/; SameSite=Lax; Max-Age=31536000`;location.reload();}
  function notify(message){try{sessionStorage.setItem('minty_purpose_notice',message);}catch{}}
  async function move(id,p){if(!confirm(`Move this account to ${p==='personal'?'Personal':'Churning'}? Its entire transaction, balance and bonus history moves with it. Accounts and transactions are not copied.`))return;
    hide();try{const r=await fetch(`/accounts/${id}/purpose`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({purpose:p})});const b=await r.json();if(!r.ok)throw Error(b.detail||'Unable to move account');notify(`Account moved to ${p==='personal'?'Personal':'Churning'}. Switch views to see it.`);location.reload();}catch(e){delete root.dataset.purposeChanging;alert(e.message);}}
  window.MintyPurpose={current:selected,select,move,notify};
  addEventListener('pagehide',hide);
  addEventListener('pageshow',()=>{if(read()!==selected){hide();location.reload();}else delete root.dataset.purposeChanging;});
  addEventListener('storage',e=>{if(e.key===key&&read()!==selected){hide();location.reload();}});
  function mount(){
    const nav=document.createElement('nav');nav.id='purposeSwitch';nav.className='purpose-switch';nav.setAttribute('aria-label','Financial purpose');
    nav.innerHTML=`<strong>${selected==='personal'?'Personal':'Churning'}</strong><div role="group" aria-label="Select financial purpose"><button type="button" data-purpose="personal" aria-pressed="${selected==='personal'}">Personal</button><button type="button" data-purpose="churning" aria-pressed="${selected==='churning'}">Churning</button></div><a id="finishAccountSetup" href="/account-classification" hidden>Finish account setup</a><span id="purposeNotice" role="status"></span>`;
    nav.onclick=e=>{const b=e.target.closest('[data-purpose]');if(b)select(b.dataset.purpose);};document.body.prepend(nav);
    new ResizeObserver(()=>root.style.setProperty('--purpose-bar-height',nav.offsetHeight+'px')).observe(nav);
    try{const message=sessionStorage.getItem('minty_purpose_notice');if(message){document.getElementById('purposeNotice').textContent=message;sessionStorage.removeItem('minty_purpose_notice');}}catch{}
    const refreshSetup=()=>fetch('/account-setup').then(r=>r.ok?r.json():null).then(data=>{if(!data)return;const a=data.accounts.filter(a=>!a.purpose).length,n=data.standalone.length;const link=document.getElementById('finishAccountSetup');link.hidden=!a&&!n;link.textContent=`Finish account setup${a?' ('+a+' unclassified account'+(a===1?'':'s')+')':n?' (unclassified standalone records)':''}`;}).catch(()=>{});
    refreshSetup();setInterval(()=>{if(!document.hidden)refreshSetup();},60000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSetup();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
