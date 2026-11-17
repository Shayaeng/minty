import type { Env } from '../env';
import { HttpError, json, jsonBody, unprocessable } from '../http';

export async function savePeople(env: Env, request: Request, id: number): Promise<Response> {
  const b = await jsonBody(request);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw unprocessable('Expected account relationships');
  const fields = ['holder_name', 'beneficiary_name', 'responsible_adult_name'] as const;
  const values = fields.map(k => {
    const v = (b as Record<string, unknown>)[k];
    if (v !== null && (typeof v !== 'string' || v.length > 100)) throw unprocessable(`${k} must be text up to 100 characters or null`);
    return typeof v === 'string' ? v.trim() || null : null;
  });
  const row = await env.DB.prepare('UPDATE accounts SET holder_name=?, beneficiary_name=?, responsible_adult_name=? WHERE id=? RETURNING id').bind(...values, id).first();
  if (!row) throw new HttpError(404, 'Account not found');
  return json(row);
}
