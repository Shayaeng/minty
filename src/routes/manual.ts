import type { Env } from '../env';
import type { Config } from '../config';
import { HttpError, json, jsonBody, unprocessable } from '../http';

export async function save(env: Env, config: Config, request: Request, id?: number): Promise<Response> {
  const b = await jsonBody(request) as Record<string, unknown>;
  if (!b || typeof b !== 'object') throw unprocessable('Expected an account');
  const { owner, name, type, currency, balance_cents } = b;
  if (typeof owner !== 'string' || !config.users.has(owner)) throw unprocessable('Choose an owner');
  if (typeof name !== 'string' || !name.trim() || name.length > 100) throw unprocessable('Name must be 1–100 characters');
  if (!['depository', 'credit', 'loan', 'investment'].includes(String(type))) throw unprocessable('Invalid account type');
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw unprocessable('Use a three-letter currency');
  if (typeof balance_cents !== 'number' || !Number.isSafeInteger(balance_cents)) throw unprocessable('Balance must be integer cents');
  if (id !== undefined) {
    const r = await env.DB.prepare(`UPDATE accounts SET owner=?, name=?, type=?, currency=?, balance_current_cents=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND is_manual=1 RETURNING id`).bind(owner, name.trim(), type, currency, balance_cents, id).first();
    if (!r) throw new HttpError(404, 'Manual account not found');
    return json(r);
  }
  const key = 'manual:' + crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO items (owner,plaid_account,plaid_item_id,access_token_enc,institution_name,status) VALUES (?,'manual',?,'','Manual accounts','manual')`).bind(owner,key),
    env.DB.prepare(`INSERT INTO accounts (owner,item_id,plaid_account_id,name,type,currency,balance_current_cents,is_manual) VALUES (?,(SELECT id FROM items WHERE plaid_item_id=?),?,?,?,?,?,1)`).bind(owner,key,key,name.trim(),type,currency,balance_cents),
  ]);
  return json({ok:true},201);
}
