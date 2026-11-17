import type { Env } from '../env';
import { people } from '../people';
import { HttpError, json, jsonBody, unprocessable } from '../http';
export async function savePeople(env: Env, request: Request, id: number): Promise<Response> {
    const b = await jsonBody(request);
    if (!b || typeof b !== 'object' || Array.isArray(b))
        throw unprocessable('Expected account relationships');
    if ('holder_ids' in b) {
        const input = b as {
            holder_ids: unknown;
            beneficiary_id?: unknown;
            responsible_adult_id?: unknown;
        };
        const rows = await people(env);
        const valid = (id: unknown) => typeof id === 'string' && rows.some(p => p.id === id);
        if (!Array.isArray(input.holder_ids) || input.holder_ids.length > 20 || input.holder_ids.some(id => !valid(id)))
            throw unprocessable('Choose holders from Manage people');
        const beneficiary = input.beneficiary_id ?? null, adult = input.responsible_adult_id ?? null;
        if ((beneficiary !== null && !valid(beneficiary)) || (adult !== null && !valid(adult)))
            throw unprocessable('Choose relationships from Manage people');
        const row = await env.DB.prepare('UPDATE accounts SET holder_ids=?,beneficiary_id=?,responsible_adult_id=?,holder_name=NULL,beneficiary_name=NULL,responsible_adult_name=NULL WHERE id=? RETURNING id')
            .bind(JSON.stringify([...new Set(input.holder_ids)]), beneficiary, adult, id).first();
        if (!row)
            throw new HttpError(404, 'Account not found');
        return json(row);
    }
    const fields = ['holder_name', 'beneficiary_name', 'responsible_adult_name'] as const;
    const values = fields.map(k => {
        const v = (b as Record<string, unknown>)[k];
        if (v !== null && (typeof v !== 'string' || v.length > 100))
            throw unprocessable(`${k} must be text up to 100 characters or null`);
        return typeof v === 'string' ? v.trim() || null : null;
    });
    const row = await env.DB.prepare('UPDATE accounts SET holder_name=?, beneficiary_name=?, responsible_adult_name=? WHERE id=? RETURNING id').bind(...values, id).first();
    if (!row)
        throw new HttpError(404, 'Account not found');
    return json(row);
}
