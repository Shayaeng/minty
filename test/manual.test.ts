import { beforeEach, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { getJson, loadFixture } from './helpers';

beforeEach(loadFixture);
const account = { owner: 'me', name: 'Unsupported bank', type: 'depository', currency: 'USD', balance_cents: 12345 };
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
