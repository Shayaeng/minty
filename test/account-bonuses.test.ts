import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { accountClosure, addPeriod, evaluateOffer, validDate } from '../public/bonus-rules.js';
import { snapshotBalances } from '../src/audit/totals';
import type { Env } from '../src/env';
import { call, getJson, loadFixture } from './helpers';

const noPlaid={PLAID_CLIENT_ID_ME_PRIMARY:'',PLAID_SECRET_ME_PRIMARY:'',PLAID_CLIENT_ID_ME_BACKUP:'',PLAID_SECRET_ME_BACKUP:'',PLAID_CLIENT_ID_SPOUSE_PRIMARY:'',PLAID_SECRET_SPOUSE_PRIMARY:'',TOKEN_ENC_KEY:''};
const write=(path:string,body:unknown,method='PUT')=>getJson<any>(path,{envOverrides:noPlaid,method,body:JSON.stringify(body)});
const report=async(today='2026-11-18')=>(await getJson<any>('/account-bonuses?today='+today,{envOverrides:noPlaid})).body;
const life=(b:unknown)=>write('/accounts/11/lifecycle',b);
async function offer(b:Record<string,unknown>={}) {
  await life({bonus_answer:'yes'});
  const r=await write('/account-bonuses/offers',{account_id:11,currency:'USD',...b},'POST');
  expect(r.status).toBe(201);return r.body.id as number;
}
const accountReport=async(today?:string)=>(await report(today)).accounts.find((a:any)=>a.account_id===11);
const itemReport=async(id:number,today?:string)=>(await accountReport(today)).offers.find((o:any)=>o.id===id);
beforeEach(loadFixture);

describe('date-only holding rules',()=>{
  it.each([
    ['2024-01-31',1,'months','2024-02-29'],['2025-01-31',1,'months','2025-02-28'],
    ['2024-02-29',12,'months','2025-02-28'],['2025-12-31',1,'days','2026-01-01'],
    ['2024-02-28',1,'days','2024-02-29'],['2025-03-09',1,'days','2025-03-10'],
  ])('adds an explicit period without timezone or month-overflow errors: %s', (from,value,unit,to)=>{
    expect(addPeriod(String(from),Number(value),String(unit))).toBe(to);
  });
  it('refuses impossible dates and unbounded preview inputs',()=>{
    expect(validDate('2025-02-29')).toBe(false);expect(validDate('2024-02-29')).toBe(true);
    expect(validDate('2026-2-01')).toBe(false);expect(addPeriod('2025-01-01',1e15,'days')).toBeNull();
  });
  it('never substitutes account opening for an unknown bonus-payment trigger',()=>{
    const r=evaluateOffer({rule_trigger:'last_payment',rule_value:6,rule_unit:'months',rule_text:'Six months after final payment',expected_cents:20000},{opened_date:'2025-01-01'},[],[],'2026-11-18');
    expect(r.keep_open_until).toBeNull();expect(r.closure_label).toBe('Closure terms unknown');
  });
  it('does not call an account safe when a holding date is reached or a bonus is fully received',()=>{
    const r=evaluateOffer({rule_trigger:'opened',rule_value:0,rule_unit:'days',rule_text:'Explicit zero-day rule',expected_cents:10000},{opened_date:'2025-01-01'},[{id:1,description:'Still required',deadline:'2025-02-01',completed_date:null}],[{amount_cents:10000,received_date:'2025-01-02'}],'2025-01-02');
    expect(r).toMatchObject({awaiting_payment:false,requirements_outstanding:1,closure_label:'Closure date reached — review terms'});
    expect(JSON.stringify(r)).not.toMatch(/safe to close/i);
  });
  it('requires every offer to have a reached date before the account-wide date-reached filter applies',()=>{
    expect(accountClosure([{keep_open_until:'2025-01-01'},{keep_open_until:null}],'2026-11-18')).toMatchObject({closure_date_reached:false,label:'Closure terms unknown'});
    expect(accountClosure([{keep_open_until:'2030-01-01'},{keep_open_until:null}],'2026-11-18')).toMatchObject({keep_open_active:true,closure_date_reached:false});
    expect(accountClosure([{keep_open_until:'2025-01-01'},{keep_open_until:'2026-11-18'}],'2026-11-18')).toMatchObject({closure_date_reached:true,keep_open_active:false,label:'Closure date reached — review terms'});
  });
});

it('defaults every saved account to unknown bonus/opened details without touching balances or granting login access',async()=>{
  const before=(await env.DB.prepare('SELECT * FROM accounts ORDER BY id').all()).results;
  const a=await accountReport();expect(a).toMatchObject({opened_date:null,bonus_answer:'unknown',account_status:'open',offers:[],closure:{label:'Closure terms unknown'}});
  expect((await life({opened_date:'2025-01-31',bonus_answer:'no',monthly_fee_cents:1200,fee_currency:'CAD',fee_waiver:'Maintain a minimum balance'})).status).toBe(200);
  expect((await accountReport()).monthly_fee_cents).toBe(1200);
  expect((await env.DB.prepare('SELECT * FROM accounts ORDER BY id').all()).results).toEqual(before);
  expect((await call('/account-bonuses',{token:null})).status).toBe(403);
  expect((await write('/account-bonuses/offers',{account_id:11},'POST')).status).toBe(422);
});

it('uses an explicitly selected opened/first/last/manual trigger and keeps calculation and override sources',async()=>{
  await life({opened_date:'2025-01-31'});
  const id=await offer({rule_trigger:'opened',rule_value:1,rule_unit:'months',rule_text:'Terms: one calendar month after opening'});
  expect(await itemReport(id,'2025-02-27')).toMatchObject({keep_open_until:'2025-02-28',keep_open_active:true,closure_label:'Keep open until 2025-02-28'});
  expect((await itemReport(id,'2025-02-28')).closure_label).toBe('Closure date reached — review terms');
  await write('/account-bonuses/payments',{offer_id:id,amount_cents:2500,received_date:'2025-02-10'},'POST');
  await write('/account-bonuses/payments',{offer_id:id,amount_cents:7500,received_date:'2025-02-20'},'POST');
  await write(`/account-bonuses/offers/${id}`,{rule_trigger:'first_payment',rule_value:6,rule_text:'Six months after first bonus installment'});
  expect((await itemReport(id)).calculated_closure_date).toBe('2025-08-10');
  await write(`/account-bonuses/offers/${id}`,{rule_trigger:'last_payment',rule_text:'Six months after latest bonus installment'});
  expect((await itemReport(id)).calculated_closure_date).toBe('2025-08-20');
  await write(`/account-bonuses/offers/${id}`,{rule_trigger:'manual',trigger_date:'2025-03-01',rule_value:30,rule_unit:'days',rule_text:'Thirty days after the explicitly identified qualifying event'});
  expect((await itemReport(id)).calculated_closure_date).toBe('2025-03-31');
  expect((await write(`/account-bonuses/offers/${id}`,{closure_override_date:'2025-04-15'})).status).toBe(422);
  await write(`/account-bonuses/offers/${id}`,{closure_override_date:'2025-04-15',closure_override_reason:'Issuer clarification recorded in saved terms'});
  const overridden=await itemReport(id);expect(overridden).toMatchObject({calculated_closure_date:'2025-03-31',keep_open_until:'2025-04-15'});expect(overridden.closure_source).toContain('Issuer clarification');
  await write(`/account-bonuses/offers/${id}`,{closure_override_date:null});
  expect((await itemReport(id)).keep_open_until).toBe('2025-03-31');
});

it('tracks overdue requirements and expected payouts separately from partial and completed payments',async()=>{
  const id=await offer({expected_cents:10000,expected_payout_date:'2025-04-10'});
  const r=await write('/account-bonuses/requirements',{offer_id:id,description:'Receive qualifying direct deposits',deadline:'2025-04-10'},'POST');
  const pay=await write('/account-bonuses/payments',{offer_id:id,amount_cents:2500,received_date:'2025-04-08'},'POST');
  expect(await itemReport(id,'2025-04-10')).toMatchObject({requirements_overdue:0,payout_overdue:false,received_cents:2500,remaining_cents:7500,awaiting_payment:true});
  expect(await itemReport(id,'2025-04-11')).toMatchObject({requirements_overdue:1,payout_overdue:true,requirements_outstanding:1,payment_status:'Partially received'});
  await write('/account-bonuses/payments',{offer_id:id,amount_cents:7500,received_date:'2025-04-12'},'POST');
  expect(await itemReport(id,'2025-04-12')).toMatchObject({requirements_overdue:1,payout_overdue:false,awaiting_payment:false,closure_label:'Closure terms unknown'});
  await write(`/account-bonuses/requirements/${r.body.id}`,{completed_date:'2025-04-13'});
  const complete=await itemReport(id,'2025-04-13');expect(complete.requirements_outstanding).toBe(0);expect(complete.requirements[0].completed_late).toBe(true);
  await write(`/account-bonuses/payments/${pay.body.id}`,{amount_cents:2000});
  expect((await itemReport(id,'2025-04-13')).awaiting_payment).toBe(true);
  expect((await getJson(`/account-bonuses/payments/${pay.body.id}`,{method:'DELETE'})).status).toBe(200);
  expect((await itemReport(id,'2025-04-13')).received_cents).toBe(7500);
});

it('allows an explicit settlement for an unknown expected amount without inferring closure terms or completing requirements',async()=>{
  const id=await offer({expected_payout_date:'2025-04-01'});
  await write('/account-bonuses/payments',{offer_id:id,amount_cents:5000,received_date:'2025-04-01'},'POST');
  expect(await itemReport(id)).toMatchObject({awaiting_payment:true,remaining_cents:null,closure_label:'Closure terms unknown'});
  await write(`/account-bonuses/offers/${id}`,{payment_complete:true});
  expect(await itemReport(id)).toMatchObject({awaiting_payment:false,payment_status:'Payment marked complete',closure_label:'Closure terms unknown'});
});

it('preserves multiple offers and original terms on one account without adding bonuses to financial balances or net worth',async()=>{
  await snapshotBalances(env as unknown as Env);
  const before=(await env.DB.prepare('SELECT * FROM accounts ORDER BY id').all()).results;
  const netBefore=(await env.DB.prepare('SELECT * FROM net_worth ORDER BY date,owner').all()).results;
  const terms='\n  Original terms <strong>as supplied</strong>\n';
  const one=await offer({offer_name:'First offer',expected_cents:100000,original_terms:terms,closure_override_date:'2025-06-01',closure_override_reason:'Explicit terms'});
  await offer({offer_name:'Later offer',expected_cents:200000,closure_override_date:'2030-01-01',closure_override_reason:'Later offer terms'});
  const unknown=await offer({offer_name:'Unknown terms'});
  await write('/account-bonuses/payments',{offer_id:one,amount_cents:100000,received_date:'2025-03-01'},'POST');
  expect((await itemReport(one)).original_terms).toBe(terms);
  const a=await accountReport();expect(a.offers).toHaveLength(3);expect(a.closure).toMatchObject({label:'Closure terms unknown',unknown_offers:1,known_keep_open_until:'2030-01-01'});
  await write(`/account-bonuses/offers/${unknown}`,{closure_override_date:'2025-01-01',closure_override_reason:'Reviewed historical terms'});
  expect((await accountReport()).closure.label).toBe('Keep open until 2030-01-01');
  await life({account_status:'closed',closed_date:'2025-12-01',bonus_answer:'no'});
  expect((await accountReport()).offers).toHaveLength(3);
  expect((await env.DB.prepare('SELECT * FROM accounts ORDER BY id').all()).results).toEqual(before);
  expect((await env.DB.prepare('SELECT * FROM net_worth ORDER BY date,owner').all()).results).toEqual(netBefore);
  expect(accountClosure([{keep_open_until:'2025-01-01'},{keep_open_until:'2030-01-01'}],'2026-11-18').label).toBe('Keep open until 2030-01-01');
});

it('validates dates, explicit holding rules, currencies and URLs without changing unrelated saved data',async()=>{
  const id=await offer();
  for(const b of [{rule_trigger:'opened',rule_value:180},{rule_value:180},{offer_url:'javascript:alert(1)'},{expected_payout_date:'2025-02-31'},{expected_cents:1.5},{closure_override_date:'2030-01-01'},{account_id:20}])expect((await write(`/account-bonuses/offers/${id}`,b)).status).toBe(422);
  expect((await life({opened_date:'2025-03-01',closed_date:'2025-02-01',account_status:'closed'})).status).toBe(422);
  expect((await getJson('/account-bonuses?today=2025-02-31')).status).toBe(422);
  expect((await write('/account-bonuses/payments',{offer_id:id,amount_cents:-1,received_date:'2025-01-01'},'POST')).status).toBe(422);
  await write('/account-bonuses/payments',{offer_id:id,amount_cents:100,received_date:'2025-01-01'},'POST');
  expect((await write(`/account-bonuses/offers/${id}`,{currency:'EUR'})).status).toBe(422);
  expect((await itemReport(id)).currency).toBe('USD');
});

it('accepts bounded original terms beyond 16 KiB while keeping other request caps unchanged',async()=>{
  const id=await offer({original_terms:'Original text\n'.repeat(2000)});
  expect((await itemReport(id)).original_terms).toHaveLength(28000);
  const tooLarge=await write(`/account-bonuses/offers/${id}`,{original_terms:'é'.repeat(40000)});
  expect(tooLarge.status).toBe(413);
  expect((await write('/accounts/11/lifecycle',{fee_waiver:'a'.repeat(20000)})).status).toBe(413);
});

it('records unknown payment dates or amounts without guessing a payout trigger or total',async()=>{
  await life({opened_date:'2025-01-01'});
  const id=await offer({expected_cents:30000,rule_trigger:'last_payment',rule_value:6,rule_unit:'months',rule_text:'Six months after latest installment'});
  const one=await write('/account-bonuses/payments',{offer_id:id,amount_cents:10000,received_date:'2025-02-01'},'POST');
  const two=await write('/account-bonuses/payments',{offer_id:id,amount_cents:10000},'POST');
  expect(two.status).toBe(201);
  expect(await itemReport(id)).toMatchObject({received_cents:20000,remaining_cents:10000,unknown_date_payments:1,keep_open_until:null,closure_label:'Closure terms unknown'});
  await write(`/account-bonuses/payments/${two.body.id}`,{received_date:'2025-02-10'});
  expect((await itemReport(id)).keep_open_until).toBe('2025-08-10');
  await write(`/account-bonuses/payments/${one.body.id}`,{received_date:null});
  await write(`/account-bonuses/payments/${two.body.id}`,{amount_cents:null});
  expect(await itemReport(id)).toMatchObject({received_cents:null,known_received_cents:10000,remaining_cents:null,unknown_date_payments:1,unknown_amount_payments:1,awaiting_payment:true,keep_open_until:null,payment_status:'Payment amounts incomplete'});
  expect((await write('/account-bonuses/payments',{offer_id:id},'POST')).status).toBe(422);
});

it('preserves receipt IDs, amounts, dates and notes while making unknown payment fields optional',async()=>{
  const id=await offer();
  await write('/account-bonuses/payments',{offer_id:id,amount_cents:12345,received_date:'2025-02-01',notes:'Retain original payment'},'POST');
  await write('/account-bonuses/payments',{offer_id:id,amount_cents:1000,received_date:null,notes:'Date unknown'},'POST');
  const before=(await env.DB.prepare('SELECT * FROM account_bonus_payments ORDER BY id').all()).results;
  const migration=env.TEST_MIGRATIONS.find(m=>m.name==='0027_bonus_payment_unknowns.sql')!;
  await env.DB.batch(migration.queries.map(sql=>env.DB.prepare(sql)));
  expect((await env.DB.prepare('SELECT * FROM account_bonus_payments ORDER BY id').all()).results).toEqual(before);
});
