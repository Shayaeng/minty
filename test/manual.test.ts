import { beforeEach, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { call, getJson, loadFixture } from './helpers';

beforeEach(loadFixture);
const account = {purpose:'personal', owner: 'me', name: 'Unsupported bank', type: 'depository', currency: 'USD', balance_cents: 12345 };
const save = (path: string, body: unknown, method = 'POST') => getJson(path, { method, body: JSON.stringify(body) });

it('creates and updates a persistent manual balance without treating it as a Plaid connection', async () => {
  expect((await save('/accounts', account)).status).toBe(201);
  const a = (await getJson<any[]>('/accounts')).body.find(a => a.is_manual);
  expect(a).toMatchObject({ name: account.name, balance_current: 123.45 });
  expect((await getJson<any[]>('/items')).body.some(i => i.id === a.item_id)).toBe(false);
  expect((await save(`/accounts/${a.id}/manual`, { ...account, balance_cents: -250 }, 'PUT')).status).toBe(200);
  expect((await getJson<any[]>('/accounts')).body.find(b => b.id === a.id).balance_current).toBe(-2.5);
  expect((await env.DB.prepare('SELECT status FROM items WHERE id=?').bind(a.item_id).first<any>()).status).toBe('manual');
});

it('rejects invalid amounts and owners and refuses changes to Plaid accounts', async () => {
  expect((await save('/accounts', { ...account, balance_cents: 1.5 })).status).toBe(422);
  expect((await save('/accounts', { ...account, owner: 'unknown' })).status).toBe(422);
  expect((await save('/accounts/1/manual', account, 'PUT')).status).toBe(404);
});

it('refreshes manual-only net worth immediately without Plaid credentials', async () => {
  await env.DB.batch(['transaction_tags', 'transactions', 'accounts', 'items', 'net_worth', 'monthly_totals'].map(t => env.DB.prepare(`DELETE FROM ${t}`)));
  const envOverrides = { PLAID_CLIENT_ID_ME_PRIMARY: '', PLAID_SECRET_ME_PRIMARY: '', PLAID_CLIENT_ID_ME_BACKUP: '', PLAID_SECRET_ME_BACKUP: '', PLAID_CLIENT_ID_SPOUSE_PRIMARY: '', PLAID_SECRET_SPOUSE_PRIMARY: '', TOKEN_ENC_KEY: '' };
  const manualSave = (body: unknown, id?: number) => getJson(id ? `/accounts/${id}/manual` : '/accounts', { envOverrides, method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
  expect((await manualSave(account)).status).toBe(201);
  expect((await manualSave({ ...account, type: 'credit', balance_cents: 2345 })).status).toBe(201);
  const audit = () => getJson<any>('/audit', { envOverrides });
  expect((await audit()).body).toMatchObject({ totals: [], net_worth: [{ assets: 12345, debts: 2345 }], cards: [{ balance: 2345 }] });
  const a = (await getJson<any[]>('/accounts', { envOverrides })).body.find(a => a.type === 'depository');
  expect((await manualSave({ ...account, balance_cents: 54321 }, a.id)).status).toBe(200);
  expect((await audit()).body.net_worth).toMatchObject([{ assets: 54321, debts: 2345 }]);
  expect(await env.DB.prepare('SELECT current_cents FROM balance_snapshots WHERE account_id=?').bind(a.id).first()).toMatchObject({ current_cents: 54321 });
  for (const path of ['/items', '/investments', '/statements']) expect((await getJson(path, { envOverrides })).body).toEqual([]);
  // Execute the actual audit renderer with the manual-only API response and a minimal DOM.
  const source = await (await call('/cfa.js')).text();
  const main = { innerHTML: '', addEventListener() {} };
  const dialog = { addEventListener() {} };
  const document = { getElementById: (id: string) => id === 'cfa' ? dialog : main, addEventListener() {} };
  const window = { MintyCharts: { wire() {} }, addEventListener() {} };
  const script = source.replace('data = null', `data = ${JSON.stringify((await audit()).body)}`)
    .replace('if (new URLSearchParams(location.search).has("audit")) open();', 'render();');
  new Function('document', 'window', script)(document, window);
  expect(main.innerHTML).toContain('<h3>Net worth</h3>');
  expect(main.innerHTML).toContain('$520');
  expect(main.innerHTML).toContain('Cards owe $23 today');
  expect(main.innerHTML).toContain('Transaction history is needed');
  expect(main.innerHTML).not.toContain('No fees or interest charged');
});
