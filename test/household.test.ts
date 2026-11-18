import { beforeEach, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { ACCOUNT_TYPES, accountType } from '../public/account-types.js';
import { snapshotBalances } from '../src/audit/totals';
import type { Env } from '../src/env';
import { getJson, loadFixture } from './helpers';

beforeEach(async()=>{
  await loadFixture();
  await env.DB.prepare('DELETE FROM household_people').run();
  await env.DB.prepare("DELETE FROM app_state WHERE key='people_imported'").run();
});
const noPlaid = { PLAID_CLIENT_ID_ME_PRIMARY:'',PLAID_SECRET_ME_PRIMARY:'',PLAID_CLIENT_ID_ME_BACKUP:'',PLAID_SECRET_ME_BACKUP:'',TOKEN_ENC_KEY:'' };
const post=(path:string,body:unknown,method='POST')=>getJson<any>(path,{envOverrides:noPlaid,method,body:JSON.stringify(body)});

it('imports exact IDs once, supports names with punctuation, reorders and archives without changing accounts, credentials or login access',async()=>{
  const original=(await env.DB.prepare('SELECT * FROM accounts ORDER BY id').all()).results;
  const imported=(await getJson<any[]>('/people')).body;
  expect(imported.map(p=>p.id)).toEqual(['me','spouse']);
  const added=await post('/people',{label:'Child: Alex, Jr.'});
  expect(added.status).toBe(200);
  const child=added.body.id;
  expect((await post('/people/me',{label:'Renamed, parent: Me'},'PUT')).status).toBe(200);
  expect((await post('/people/order',{ids:[child,'spouse','me']},'PUT')).status).toBe(200);
  const changed=(await getJson<any[]>('/people',{envOverrides:{MINTY_USERS:'BAD CONFIG'}})).body;
  expect(changed.map(p=>p.id)).toEqual([child,'spouse','me']);
  expect(changed[2].label).toBe('Renamed, parent: Me');
  const me=(await getJson<any[]>('/users')).body.find(p=>p.key==='me');
  expect(me.slots[0].account).toBe('me_primary');
  expect((await post('/people/me',{label:me.label,archived:true},'PUT')).status).toBe(200);
  expect((await getJson<any[]>('/users')).body.find(p=>p.key==='me').archived).toBe(true);
  expect((await env.DB.prepare('SELECT * FROM accounts ORDER BY id').all()).results).toEqual(original);
  expect((await getJson('/people',{token:null})).status).toBe(403);
});

it('persists every catalog type and independent relationships with old valuation dates and counts assets/debts correctly',async()=>{
  const child=(await post('/people',{label:'Child'})).body.id;
  for(const t of ACCOUNT_TYPES){
    const result=await post('/accounts',{purpose:'personal',owner:'me',name:t.label,detailed_type:t.id,currency:'USD',balance_cents:10000,balance_as_of:'2025-01-15',institution_manual:'Provider',holder_ids:['me','spouse'],beneficiary_id:child,responsible_adult_id:'me',notes:'Saved notes',login_url:'https://example.com/login',mask:'1234'});
    expect(result.status,t.id).toBe(201);
    const id=result.body.id;
    const saved=(await getJson<any[]>('/accounts?view=all')).body.find(a=>a.id===id);
    expect(saved).toMatchObject({detailed_type:t.id,type:t.base,account_type:{group:t.group},balance_as_of:'2025-01-15',institution_manual:'Provider',beneficiary_id:child,holder_name:'Me, Spouse'});
    expect((await post(`/accounts/${id}/manual`,{balance_cents:15000},'PUT')).status).toBe(200);
    expect((await env.DB.prepare('SELECT balance_as_of FROM accounts WHERE id=?').bind(id).first<any>()).balance_as_of).toBe('2025-01-15');
  }
  await snapshotBalances(env as unknown as Env);
  const manual=(await getJson<any[]>('/accounts?view=all')).body.filter(a=>a.is_manual);
  expect(manual).toHaveLength(24);
  const snapshots=await env.DB.prepare('SELECT s.date FROM balance_snapshots s JOIN accounts a ON a.id=s.account_id WHERE a.is_manual=1').all<{date:string}>();
  expect(snapshots.results.every(s=>s.date==='2025-01-15')).toBe(true);
  const egg=(await getJson<any>('/retirement')).body;
  const serialized=JSON.stringify(egg.accounts.filter((a:any)=>a.in_retirement));
  expect(serialized).toContain('Traditional IRA');
  expect(serialized).not.toContain('529 education savings');
  const usd=(await getJson<any>('/audit')).body.net_worth.at(-1);
  // Existing fixture: $28,740.18 assets, $1,284.55 debt, plus 20 assets and four debts at $150 each.
  expect(usd.assets).toBe(2874018+20*15000);
  expect(usd.debts).toBe(128455+4*15000);
  expect(accountType({type:'investment',subtype:null,name:'IRA 529 Roth'})?.id).toBe('other_investment');
});

it('rejects unsafe URLs and impossible dates without changing a saved manual balance',async()=>{
  const r=await post('/accounts',{purpose:'personal',owner:'me',name:'Savings',detailed_type:'savings',currency:'USD',balance_cents:10000});
  for(const b of [{login_url:'javascript:alert(1)'},{balance_as_of:'2025-02-31'},{beneficiary_id:'missing'},{holder_ids:['missing']}]){
    expect((await post(`/accounts/${r.body.id}/manual`,b,'PUT')).status).toBe(422);
  }
  expect((await getJson<any[]>('/accounts?view=all')).body.find(a=>a.id===r.body.id).balance_current).toBe(100);
});

it('migrates a legacy broad investment without guessing tax treatment or changing its identity and balance',async()=>{
  await env.DB.prepare("INSERT INTO accounts (purpose,id,owner,item_id,plaid_account_id,name,type,balance_current_cents,is_manual,holder_name,updated_at) VALUES ('personal',99,'me',1,'legacy-manual','IRA or 529?', 'investment',123456,1,'Original holder','2024-04-15T12:00:00Z')").run();
  const migration=env.TEST_MIGRATIONS.find(m=>m.name==='0023_household_people.sql')!;
  for(const sql of migration.queries.filter(q=>q.includes('UPDATE accounts SET detailed_type'))) await env.DB.prepare(sql).run();
  expect(await env.DB.prepare('SELECT id,owner,balance_current_cents,detailed_type,holder_name,balance_as_of FROM accounts WHERE id=99').first()).toEqual({id:99,owner:'me',balance_current_cents:123456,detailed_type:'other_investment',holder_name:'Original holder',balance_as_of:'2024-04-15'});
});
