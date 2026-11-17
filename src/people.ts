import type { Env } from './env';
import { loadConfig, parseUsers, type Config } from './config';
import { HttpError, json, jsonBody, unprocessable } from './http';
export interface Person {
    id: string;
    label: string;
    position: number;
    archived: number;
}
/** Import exactly once, in one D1 transaction. Afterwards D1 is authoritative, even if
 * MINTY_USERS changes. Existing IDs (and therefore Plaid credential suffixes) never change. */
export async function people(env: Env): Promise<Person[]> {
    const marker = await env.DB.prepare("SELECT 1 FROM app_state WHERE key='people_imported'").first();
    if (!marker) {
        const initial = [...parseUsers(env.MINTY_USERS?.trim() || 'me:Me')];
        await env.DB.batch([
            ...initial.map(([id, label], i) => env.DB.prepare(`INSERT OR IGNORE INTO household_people (id,label,position)
        SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM app_state WHERE key='people_imported')`).bind(id, label, i)),
            env.DB.prepare(`INSERT OR IGNORE INTO household_people (id,label,position)
        SELECT owner,owner,1000+row_number() OVER (ORDER BY owner) FROM
        (SELECT owner FROM accounts UNION SELECT owner FROM items)
        WHERE NOT EXISTS (SELECT 1 FROM app_state WHERE key='people_imported')`),
            env.DB.prepare("INSERT OR IGNORE INTO app_state (key,value) VALUES ('people_imported','1')"),
        ]);
    }
    return (await env.DB.prepare('SELECT * FROM household_people ORDER BY position,id').all<Person>()).results;
}
export async function householdConfig(env: Env): Promise<Config> {
    const rows = await people(env);
    // Build credential mappings from immutable IDs, never display labels.
    const config = loadConfig({ ...env, MINTY_USERS: rows.map(p => p.id).join(',') });
    config.users = new Map(rows.map(p => [p.id, p.label]));
    return config;
}
export async function listPeople(env: Env): Promise<Response> { return json(await people(env)); }
export async function reorderPeople(env: Env, request: Request): Promise<Response> {
    const rows = await people(env);
    const b = await jsonBody(request) as {
        ids?: unknown;
    };
    const ids = b?.ids;
    if (!Array.isArray(ids) || ids.length !== rows.length || new Set(ids).size !== rows.length || ids.some(id => !rows.some(p => p.id === id)))
        throw unprocessable('Order must contain every person exactly once');
    await env.DB.batch(ids.map((id, i) => env.DB.prepare('UPDATE household_people SET position=? WHERE id=?').bind(i, id)));
    return json({ ok: true });
}
export async function savePerson(env: Env, request: Request, id?: string): Promise<Response> {
    await people(env);
    const b = await jsonBody(request) as Record<string, unknown>;
    if (!b || typeof b !== 'object' || Array.isArray(b))
        throw unprocessable('Expected a person');
    if (typeof b.label !== 'string' || !b.label.trim() || b.label.length > 100)
        throw unprocessable('Name must be 1–100 characters');
    if (b.archived !== undefined && typeof b.archived !== 'boolean')
        throw unprocessable('Archived must be true or false');
    if (b.position !== undefined && (!Number.isSafeInteger(b.position) || Number(b.position) < 0))
        throw unprocessable('Position must be a nonnegative integer');
    if (!id) {
        id = 'p' + crypto.randomUUID().replace(/-/g, '').slice(0, 23);
        await env.DB.prepare('INSERT INTO household_people (id,label,position) VALUES (?,?,(SELECT coalesce(max(position),-1)+1 FROM household_people))').bind(id, b.label.trim()).run();
    }
    else {
        const r = await env.DB.prepare('UPDATE household_people SET label=?, archived=coalesce(?,archived), position=coalesce(?,position) WHERE id=? RETURNING id')
            .bind(b.label.trim(), b.archived === undefined ? null : Number(b.archived), b.position ?? null, id).first();
        if (!r)
            throw new HttpError(404, 'Person not found');
    }
    return json({ id });
}
