import { beforeEach, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { call, getJson, loadFixture } from './helpers';

beforeEach(loadFixture);

it('saves distinct relationships without changing household owner or existing balances', async () => {
  const before = await env.DB.prepare('SELECT owner, balance_current_cents FROM accounts WHERE id=10').first();
  expect((await getJson('/accounts/10/people', { method: 'PUT', body: JSON.stringify({ holder_name: 'Sam', beneficiary_name: 'Child', responsible_adult_name: 'Alex' }) })).status).toBe(200);
  const a = (await getJson<any[]>('/accounts?view=all')).body.find(a=>a.id===10);
  expect(a).toMatchObject({ holder_name: 'Sam', beneficiary_name: 'Child', responsible_adult_name: 'Alex', institution_name: 'Chase' });
  expect(await env.DB.prepare('SELECT owner, balance_current_cents FROM accounts WHERE id=10').first()).toEqual(before);
  expect((await getJson('/accounts/10/people', { method: 'PUT', body: JSON.stringify({ holder_name: 42, beneficiary_name: null, responsible_adult_name: null }) })).status).toBe(422);
});

it('renders manual-only balances, counts overlapping relationships once and filters beneficiaries without Plaid', async () => {
  await env.DB.batch(['transaction_tags','transactions','accounts','items','net_worth','monthly_totals'].map(t=>env.DB.prepare(`DELETE FROM ${t}`)));
  const envOverrides = { PLAID_CLIENT_ID_ME_PRIMARY: '', PLAID_SECRET_ME_PRIMARY: '', TOKEN_ENC_KEY: '' };
  for(const [name,type,balance] of [['Savings','depository',10000],['Card','credit',2500]] as const) {
    expect((await getJson('/accounts',{envOverrides,method:'POST',body:JSON.stringify({owner:'me',name,type,balance_cents:balance,currency:'USD'})})).status).toBe(201);
  }
  const accounts=(await getJson<any[]>('/accounts?view=all',{envOverrides})).body;
  await getJson(`/accounts/${accounts.find(a=>a.type==='depository').id}/people`,{method:'PUT',body:JSON.stringify({holder_name:'Me',beneficiary_name:'Child',responsible_adult_name:'Me'})});
  const nodes = new Map<string, any>();
  const document={getElementById(id:string){if(!nodes.has(id)) nodes.set(id,{innerHTML:'',textContent:''});return nodes.get(id);}};
  const fetch = (path:string) => call(path,{envOverrides});
  let source=await (await call('/accounts-overview.js')).text();
  source=source.replace('(function () {','return (function () {').replace('  Promise.all(', '  return Promise.all(');
  await new Function('document','fetch',source)(document,fetch);
  expect(nodes.get('totals').innerHTML).toContain('$100.00');
  expect(nodes.get('totals').innerHTML).toContain('$25.00');
  expect(nodes.get('totals').innerHTML).toContain('$75.00');
  expect(nodes.get('accountList').innerHTML).toContain('Edit balance');
  expect(nodes.get('people').innerHTML).toContain('Everyone');
  nodes.get('people').onclick({target:{closest:()=>({dataset:{person:'child'}})}});
  expect(nodes.get('totals').innerHTML).toContain('$100.00');
  expect(nodes.get('accountList').innerHTML).toContain('Child beneficiary');
  expect(nodes.get('accountList').innerHTML).not.toContain('<h2>Card</h2>');
});
