import {beforeEach,expect,it,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {getJson,loadFixture} from './helpers';
import {purposeDatabase,scopeSql} from '../src/purpose';
import {FakePlaid,account,page,txn} from './fake-plaid';
import {syncItem, type ItemRow} from '../src/sync';
import {loadConfig} from '../src/config';
import {fernetEncrypt} from '../src/fernet';
import type {Env} from '../src/env';
import {PURPOSE_TABLES,PURPOSE_CACHES} from '../src/purpose-schema';
import {bankRows} from '../src/health';
import {purposeEnv} from '../src/purpose';
import {snapshotBalances} from '../src/audit/totals';

beforeEach(async()=>{
  await env.DB.batch(['bucket_overrides','churning_bucket_overrides','analytics_exclusions','churning_analytics_exclusions','bills','point_balances'].map(t=>env.DB.prepare(`DELETE FROM ${t}`)));
  await loadFixture();await env.DB.prepare("UPDATE accounts SET purpose=CASE id WHEN 11 THEN 'personal' WHEN 10 THEN 'churning' ELSE NULL END").run();
  for(const purpose of ['personal','churning'] as const)await snapshotBalances(purposeEnv(env as unknown as Env,purpose));
});
const get=(path:string,p='personal')=>getJson<any>(path,{headers:{'x-minty-purpose':p}});
const write=(path:string,body:unknown,p='personal',method='PUT')=>getJson<any>(path,{method,headers:{'x-minty-purpose':p},body:JSON.stringify(body)});
it('separates a mixed bank login by account and excludes unclassified accounts',async()=>{
  expect((await get('/accounts?view=all')).body.map((a:any)=>a.id)).toEqual([11]);
  expect((await get('/accounts?view=all','churning')).body.map((a:any)=>a.id)).toEqual([10]);
  expect((await get('/transactions')).body.map((t:any)=>t.id)).toEqual([102]);
  expect((await get('/transactions','churning')).body.map((t:any)=>t.id)).toEqual([100,101]);
  expect((await get('/transactions?q=Whole')).body).toEqual([]);
  expect((await get('/tags')).body).toEqual([]);
  expect((await get('/tags','churning')).body).toEqual(['car','groceries']);
  expect((await get('/account-setup')).body.accounts.map((a:any)=>a.id)).toEqual([20]);
  expect((await get('/accounts','all')).status).toBe(422);
});
it('defaults to Personal and refuses ambiguous or combined purposes',async()=>{
  expect((await getJson('/accounts?view=all')).body.map((a:any)=>a.id)).toEqual([11]);
  for(const path of ['/accounts?purpose=all','/accounts?purpose=combined','/accounts?purpose=personal&purpose=churning'])expect((await getJson(path)).status).toBe(422);
  expect((await get('/accounts?purpose=churning')).status).toBe(422);
  expect((await get('/accounts?purpose=churning','churning')).status).toBe(200);
  expect((await get('/accounts?owner=spouse')).body).toEqual([]);
});
it('classifies existing and closed accounts explicitly, validates the entire batch before saving',async()=>{
  await env.DB.prepare("UPDATE accounts SET purpose=NULL WHERE id=10").run();
  await env.DB.prepare("INSERT INTO account_lifecycle(account_id,account_status) VALUES(10,'closed')").run();
  expect((await get('/account-setup')).body.accounts.find((a:any)=>a.id===10)).toMatchObject({purpose:null,account_status:'closed'});
  expect((await write('/account-setup',{accounts:[{id:10,purpose:'churning'},{id:20,purpose:'all'}]})).status).toBe(422);
  expect((await env.DB.prepare('SELECT purpose FROM accounts WHERE id=10').first<any>()).purpose).toBeNull();
  expect((await write('/account-setup',{accounts:[{id:10,purpose:'churning'},{id:20,purpose:'personal'}]})).status).toBe(200);
  expect((await get('/account-bonuses','churning')).body.accounts[0]).toMatchObject({account_id:10,account_status:'closed'});
  expect((await get('/accounts?view=all')).body.map((a:any)=>a.id).sort()).toEqual([11,20]);
});
it('moves the original account, transactions, balance history and bonus records without copies or stale totals',async()=>{
  await write('/accounts/10/lifecycle',{bonus_answer:'yes'},'churning');
  const offer=await write('/account-bonuses/offers',{account_id:10,offer_name:'Citi reward',expected_amount_cents:50000},'churning','POST');
  expect(offer.status).toBe(201);
  await write('/account-bonuses/requirements',{offer_id:offer.body.id,description:'Deposit',deadline:'2026-12-01'},'churning','POST');
  await write('/account-bonuses/payments',{offer_id:offer.body.id,amount_cents:25000,received_date:'2026-09-20'},'churning','POST');
  await env.DB.prepare("INSERT INTO balance_snapshots(account_id,date,current_cents) VALUES(10,'2026-09-20',128455)").run();
  await get('/audit');await get('/audit','churning');
  expect((await write('/accounts/10/purpose',{purpose:'personal'},'churning')).status).toBe(200);
  expect((await get('/transactions')).body.map((t:any)=>t.id)).toEqual([100,101,102]);
  expect((await get('/transactions','churning')).body).toEqual([]);
  const bonuses=(await get('/account-bonuses')).body.accounts.find((a:any)=>a.account_id===10);
  expect(bonuses.offers[0]).toMatchObject({id:offer.body.id});
  expect(bonuses.offers[0].requirements).toHaveLength(1);expect(bonuses.offers[0].payments).toHaveLength(1);
  expect((await get('/account-bonuses','churning')).body.accounts).toEqual([]);
  expect((await get('/audit','churning')).body.totals).toEqual([]);
  expect((await get('/audit','churning')).body.net_worth).toEqual([]);
  expect((await get('/audit')).body.cards).toHaveLength(1);
  const raw=await env.DB.prepare('SELECT (SELECT count(*) FROM accounts) AS accounts,(SELECT count(*) FROM transactions) AS txns,(SELECT count(*) FROM account_bonus_offers) AS offers').first();
  expect(raw).toEqual({accounts:3,txns:5,offers:1});
  expect((await purposeDatabase(env.DB,'personal').prepare("SELECT current_cents FROM balance_snapshots WHERE account_id=10 AND date='2026-09-20'").first<any>()).current_cents).toBe(128455);
});
it('requires a visible manual purpose and supports inventory-only records without Plaid',async()=>{
  const body={owner:'me',name:'Inventory only',detailed_type:'checking',currency:'USD',inventory_only:true};
  expect((await write('/accounts',body,'personal','POST')).status).toBe(422);
  const r=await write('/accounts',{...body,purpose:'churning'},'personal','POST');expect(r.status).toBe(201);
  expect((await get('/accounts?view=all')).body.map((a:any)=>a.id)).not.toContain(r.body.id);
  const own=(await get('/accounts?view=all','churning')).body.find((a:any)=>a.id===r.body.id);
  expect(own).toMatchObject({purpose:'churning',inventory_only:1,balance_current:null,is_manual:1});
  expect((await get('/status')).body.items.manual).toBeUndefined();
  expect((await write(`/accounts/${r.body.id}/manual`,{purpose:'personal',inventory_only:false,balance_cents:23456},'churning')).status).toBe(200);
  expect((await get('/accounts?view=all')).body.find((a:any)=>a.id===r.body.id)).toMatchObject({balance_current:234.56,purpose:'personal'});
  expect((await get('/audit')).body.net_worth.at(-1).assets).toBe(647474);
});
it('separates standalone bills, points, settings and card-linked records, and blocks cross-view mutations',async()=>{
  await env.DB.prepare("INSERT INTO bills(owner,biller,match_name,amount_cents,due_date,source,purpose) VALUES('me','Personal bill','P',111,'2026-12-01','manual','personal'),('me','Churn bill','C',222,'2026-12-01','manual','churning')").run();
  await env.DB.prepare("INSERT INTO point_balances(owner,program,balance,as_of,source,purpose) VALUES('me','amex_mr',111,'2026-09-01','manual','personal'),('me','chase_ur',222,'2026-09-01','manual','churning')").run();
  await env.DB.prepare("INSERT INTO card_statements(account_id,issue_date,balance_cents,first_seen_at,last_seen_at) VALUES(10,'2026-09-01',999,'x','x')").run();
  await write('/retirement/profile',{owner:'me',target_cents:1000000});
  await write('/retirement/profile',{owner:'me',target_cents:9000000},'churning');
  expect((await get('/retirement')).body.profiles.me.target_cents).toBe(1000000);
  expect((await get('/retirement','churning')).body.profiles.me.target_cents).toBe(9000000);
  const db=purposeDatabase(env.DB,'personal');
  expect((await db.prepare('SELECT biller FROM bills').all()).results).toEqual([{biller:'Personal bill'}]);
  expect((await db.prepare('SELECT balance FROM point_balances').all()).results).toEqual([{balance:111}]);
  for(const table of ['card_statements','account_lifecycle','account_bonus_offers','holdings','investment_txns'])expect((await db.prepare(`SELECT * FROM ${table}`).all()).results).toEqual([]);
  for(const [path,body] of [['/accounts/10/lifecycle',{}],['/accounts/10/people',{holder_ids:[]}],['/accounts/10/view',{view:'retirement'}]] as const)expect((await write(path,body)).status).toBe(404);
  expect((await get('/accounts?account_id=10')).body.map((a:any)=>a.id)).toEqual([11]);
  expect((await get('/transactions?account_id=10')).body).toEqual([]);
  expect((await get('/transactions?tag=groceries')).body).toEqual([]);
  await env.DB.prepare("UPDATE items SET sync_start_cursor='loading' WHERE id=1").run();
  expect((await bankRows(purposeEnv(env as unknown as Env,'personal')))[0].txns).toBe(1);
  expect((await bankRows(purposeEnv(env as unknown as Env,'churning')))[0].txns).toBe(2);
});
it('requires every database table to have an explicit shared, source or purpose-cache policy',async()=>{
  const tables=(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{name:string}>()).results;
  const shared=['app_state','household_people','sync_pages','link_sessions','d1_migrations'];
  const known=new Set([...Object.keys(PURPOSE_TABLES),...PURPOSE_CACHES,...shared,...[...PURPOSE_CACHES,'app_state'].flatMap(t=>['churning_'+t,'legacy_purpose_'+t])]);
  expect(tables.map(t=>t.name).filter(t=>!t.startsWith('sqlite_')&&!t.startsWith('_cf_')&&!known.has(t))).toEqual([]);
});
it('separates cached corrections, category drilldowns, balance totals and account filter choices',async()=>{
  await write('/audit/buckets',{merchant:'Whole Foods Market',bucket:'saving'},'churning');
  expect((await get('/audit/buckets?merchant=Whole%20Foods%20Market')).body.bucket).toBeNull();
  expect((await get('/audit/buckets?merchant=Whole%20Foods%20Market','churning')).body.bucket).toBe('saving');
  const p=(await get('/audit')).body,c=(await get('/audit','churning')).body;
  expect(p.cards).toEqual([]);expect(c.cards.map((r:any)=>r.name)).toEqual(['Sapphire']);
  expect(p.net_worth.at(-1)).toMatchObject({assets:624018,debts:0});
  expect(c.net_worth.at(-1)).toMatchObject({assets:0,debts:128455});
  const path='/audit/transactions?category=FOOD_AND_DRINK&from=2026-09-01&to=2026-09-30';
  expect((await get(path)).body.transactions).toEqual([]);
  expect((await get('/audit/summary')).body.totals.every((r:any)=>r.bucket==='income')).toBe(true);
  expect((await get('/audit/exclusions')).body.accounts.map((r:any)=>r.id)).toEqual([11]);
  expect((await get('/audit/exclusions','churning')).body.accounts.map((r:any)=>r.id)).toEqual([10]);
  expect((await get('/bills')).body.cards).toEqual([]);
  expect((await get('/bills','churning')).body.cards.map((r:any)=>r.account_id)).toEqual([10]);
  for(const endpoint of ['/benefits','/points','/audit/advice','/audit/daily?from=2026-09-01&to=2026-09-30']){
    for(const purpose of ['personal','churning'])expect((await get(endpoint,purpose)).status,endpoint+' '+purpose).toBe(200);
  }
});
it('keeps Plaid accounts unclassified when discovered and preserves per-account choices through sync and reconnection',async()=>{
  const e=env as unknown as Env,plaid=new FakePlaid().install();
  try{
    const token=await fernetEncrypt('access-sandbox-secret',e.TOKEN_ENC_KEY!);
    await env.DB.prepare('UPDATE items SET access_token_enc=? WHERE id=1').bind(token).run();
    let item=(await env.DB.prepare('SELECT * FROM items WHERE id=1').first<ItemRow>())!;
    plaid.syncPages.push(page('purpose-1',false,{accounts:[account('acct-10'),account('acct-11'),account('new-account')],added:[txn('new-transaction','new-account')]}));
    expect(await syncItem(e,loadConfig(e),item,{pages:1})).toBe('good');
    const newAccount=(await get('/account-setup')).body.accounts.find((a:any)=>a.name==='Account new-account');expect(newAccount.purpose).toBeNull();
    for(const p of ['personal','churning'])expect((await get('/transactions',p)).body.some((t:any)=>t.plaid_txn_id==='new-transaction')).toBe(false);
    expect((await env.DB.prepare('SELECT id,purpose FROM accounts WHERE id IN(10,11) ORDER BY id').all()).results).toEqual([{id:10,purpose:'churning'},{id:11,purpose:'personal'}]);
    await write(`/accounts/${newAccount.id}/purpose`,{purpose:'churning'});
    expect((await get('/transactions','churning')).body.some((t:any)=>t.plaid_txn_id==='new-transaction')).toBe(true);
    plaid.syncPages.push(page('purpose-2',false,{accounts:[account('acct-10'),account('acct-11'),account('new-account'),account('later-account')]}));
    item=(await env.DB.prepare('SELECT * FROM items WHERE id=1').first<ItemRow>())!;
    await syncItem(e,loadConfig(e),item,{pages:1});
    expect((await env.DB.prepare('SELECT purpose FROM accounts WHERE id=?').bind(newAccount.id).first<any>()).purpose).toBe('churning');
    expect((await get('/account-setup')).body.accounts.find((a:any)=>a.name==='Account later-account').purpose).toBeNull();
    expect((await write('/link/reconnected',{item_id:1},'personal','POST')).status).toBe(200);
    expect((await env.DB.prepare('SELECT purpose FROM accounts WHERE id=10').first<any>()).purpose).toBe('churning');
  }finally{vi.restoreAllMocks();}
});
it('keeps EGG balances, snapshots, contributions, fees and security mix within the selected purpose',async()=>{
  await env.DB.prepare("UPDATE accounts SET type='investment',subtype='ira' WHERE id IN(10,11)").run();
  await env.DB.prepare("INSERT OR REPLACE INTO securities(security_id,name,type) VALUES('purpose-personal-stock','Personal stock','equity'),('purpose-churning-cash','Churning cash','cash')").run();
  await env.DB.prepare("INSERT INTO holdings(account_id,security_id,value_cents) VALUES(11,'purpose-personal-stock',11100),(10,'purpose-churning-cash',99900)").run();
  const year=new Date().getUTCFullYear();
  await env.DB.prepare(`INSERT INTO investment_txns(account_id,plaid_inv_txn_id,date,type,subtype,amount_cents) VALUES
    (11,'purpose-p-contribution',?,'cash','contribution',-10000),(10,'purpose-c-contribution',?,'cash','contribution',-90000),
    (11,'purpose-p-fee',?,'fee','management fee',111),(10,'purpose-c-fee',?,'fee','management fee',999)`).bind(...Array(4).fill(`${year}-09-01`)).run();
  const p=(await get('/retirement')).body,c=(await get('/retirement','churning')).body;
  expect(p.accounts.map((a:any)=>a.id)).toEqual([11]);expect(c.accounts.map((a:any)=>a.id)).toEqual([10]);
  expect(p.snapshots.every((s:any)=>s.account_id===11)).toBe(true);expect(c.snapshots.every((s:any)=>s.account_id===10)).toBe(true);
  expect(p.fees).toEqual([{owner:'me',cents:111}]);expect(c.fees).toEqual([{owner:'me',cents:999}]);
  expect(p.contributions.map((r:any)=>r.cents)).toEqual([10000]);expect(c.contributions.map((r:any)=>r.cents)).toEqual([90000]);
  expect(p.mix.reduce((n:number,r:any)=>n+r.cents,0)).toBe(11100);expect(c.mix.reduce((n:number,r:any)=>n+r.cents,0)).toBe(99900);
  expect((await purposeDatabase(env.DB,'personal').prepare('SELECT name FROM securities').all()).results).toEqual([{name:'Personal stock'}]);
});
it('scopes nested reads, aliases, metadata UPSERTs, updates and bulk tags at the shared DB boundary',async()=>{
  const db=purposeDatabase(env.DB,'personal');
  expect(await db.prepare("SELECT 'accounts' AS label,count(*) AS accounts FROM accounts").first()).toEqual({label:'accounts',accounts:1});
  expect((await getJson('/accounts/10/name',{method:'PUT',body:JSON.stringify({name:'Wrong view'})})).status).toBe(404);
  expect((await getJson('/accounts/11/name',{method:'PUT',body:JSON.stringify({name:'Own view'})})).status).toBe(200);
  expect((await getJson('/accounts/11/lifecycle',{method:'PUT',body:JSON.stringify({bonus_answer:'yes'})})).status).toBe(200);
  expect((await getJson('/transactions/tags',{method:'POST',body:JSON.stringify({ids:[100,102],add:['View tag']})})).status).toBe(200);
  expect((await env.DB.prepare("SELECT transaction_id FROM transaction_tags WHERE tag='View tag'").all()).results).toEqual([{transaction_id:102}]);
  expect(scopeSql("SELECT 'transactions' AS label FROM accounts",'churning')).toContain("'transactions'");
});
it('builds independent analytics without transfer matching or totals from the other purpose',async()=>{
  const p=await get('/audit');expect(p.status).toBe(200);
  const c=await get('/audit','churning');expect(c.status).toBe(200);
  expect(p.body.totals.map((t:any)=>t.bucket)).toEqual(['income']);
  expect(c.body.totals.map((t:any)=>t.bucket)).toEqual(['spend']);
  expect((await env.DB.prepare('SELECT sum(amount_cents) AS cents FROM monthly_totals').first<any>()).cents).toBe(-245000);
  expect((await env.DB.prepare('SELECT sum(amount_cents) AS cents FROM churning_monthly_totals').first<any>()).cents).toBe(8412);
});
