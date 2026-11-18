import { purposeEnv, rawDatabase, requirePurpose } from '../purpose';
import { classify } from './purpose-setup';
import { snapshotBalances } from '../audit/totals';
import { ACCOUNT_TYPES } from '../../public/account-types.js';
import { people } from '../people';
import type { Env } from '../env';
import type { Config } from '../config';
import { HttpError, json, jsonBody, unprocessable } from '../http';
export async function save(env: Env, config: Config, request: Request, id?: number): Promise<Response> {
    const input = await jsonBody(request) as Record<string, unknown>;
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw unprocessable('Expected an account');
    const old = id === undefined ? null : await env.DB.prepare('SELECT * FROM accounts WHERE id=? AND is_manual=1').bind(id).first<Record<string, unknown>>();
    if (id !== undefined && !old)
        throw new HttpError(404, 'Manual account not found');
    const b = { ...old, ...input };
    const { owner, name, currency } = b;
    const purpose=requirePurpose(input.purpose??old?.purpose);
    const inventoryValue=input.inventory_only??old?.inventory_only??false;
    if(![true,false,0,1].includes(inventoryValue as boolean|number))throw unprocessable('inventory_only must be true or false');
    const inventoryOnly=!!inventoryValue;
    const savedBalance=old?await rawDatabase(env.DB).prepare('SELECT balance_current_cents FROM accounts WHERE id=?').bind(id).first<{balance_current_cents:number|null}>():null;
    const balance=inventoryOnly?(savedBalance?.balance_current_cents??null):(input.balance_cents??savedBalance?.balance_current_cents);
    if (typeof owner !== 'string' || !config.users.has(owner))
        throw unprocessable('Choose a household person');
    const persons = await people(env);
    if (persons.find(p => p.id === owner)?.archived && owner !== old?.owner)
        throw unprocessable('Choose an active household person');
    if (typeof name !== 'string' || !name.trim() || name.length > 100)
        throw unprocessable('Nickname must be 1–100 characters');
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))
        throw unprocessable('Use a three-letter currency');
    if (!inventoryOnly && (typeof balance !== 'number' || !Number.isSafeInteger(balance)))
        throw unprocessable('Balance must be integer cents');
    const legacy = { depository: 'cash_management', investment: 'other_investment', credit: 'credit_card', loan: 'other_loan' };
    const detail = input.detailed_type ?? old?.detailed_type ?? legacy[b.type as keyof typeof legacy];
    const kind = ACCOUNT_TYPES.find(t => t.id === detail);
    if (!kind)
        throw unprocessable('Choose an account type');
    const text = (key: string, max: number) => { const v = b[key]; if (v == null || v === '')
        return null; if (typeof v !== 'string' || v.length > max)
        throw unprocessable(`${key} must be text up to ${max} characters`); return v.trim() || null; };
    const institution = text('institution_manual', 150), notes = text('notes', 2000), login = text('login_url', 500), mask = text('mask', 4);
    if (mask && !/^\d{4}$/.test(mask))
        throw unprocessable('Last four digits must be four numbers');
    if (login) {
        try {
            if (!['https:', 'http:'].includes(new URL(login).protocol))
                throw Error();
        }
        catch {
            throw unprocessable('Login page must be an http or https URL');
        }
    }
    const asOf = b.balance_as_of ?? new Date().toISOString().slice(0, 10);
    if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf || asOf > new Date().toISOString().slice(0, 10))
        throw unprocessable('Balance date must be a valid date, no later than today');
    let holders: unknown = b.holder_ids ?? [];
    if (typeof holders === 'string') {
        try {
            holders = JSON.parse(holders);
        }
        catch {
            throw unprocessable('Invalid holders');
        }
    }
    if (!Array.isArray(holders) || holders.length > 20 || holders.some(p => typeof p !== 'string' || !persons.some(x => x.id === p)))
        throw unprocessable('Choose holders from Manage people');
    const relation = (key: string) => { const p = b[key] ?? null; if (p !== null && (typeof p !== 'string' || !persons.some(x => x.id === p)))
        throw unprocessable('Choose relationships from Manage people'); return p as string | null; };
    const beneficiary = relation('beneficiary_id'), adult = relation('responsible_adult_id');
    const holderIds = JSON.stringify([...new Set(holders)]);
    const values = [owner, name.trim(), kind.base, kind.subtype, kind.id, currency, balance, institution, asOf, notes, login, mask, holderIds, beneficiary, adult, old?.purpose ?? purpose, Number(inventoryOnly)];
    if (id !== undefined) {
        await env.DB.batch([
            env.DB.prepare('UPDATE items SET owner=?, institution_name=? WHERE id=? AND status=\'manual\'').bind(owner, institution || 'Manual accounts', old!.item_id),
            env.DB.prepare(`UPDATE accounts SET owner=?,name=?,type=?,subtype=?,detailed_type=?,currency=?,balance_current_cents=?,institution_manual=?,balance_as_of=?,notes=?,login_url=?,mask=?,holder_ids=?,beneficiary_id=?,responsible_adult_id=?,purpose=?,inventory_only=?,holder_name=CASE WHEN ? THEN NULL ELSE holder_name END,beneficiary_name=CASE WHEN ? THEN NULL ELSE beneficiary_name END,responsible_adult_name=CASE WHEN ? THEN NULL ELSE responsible_adult_name END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND is_manual=1`).bind(...values, Number('holder_ids' in input), Number('beneficiary_id' in input), Number('responsible_adult_id' in input), id),
        ]);
    }
    else {
        const key = 'manual:' + crypto.randomUUID();
        await env.DB.batch([
            env.DB.prepare(`INSERT INTO items (owner,plaid_account,plaid_item_id,access_token_enc,institution_name,status) VALUES (?,'manual',?,'',?,'manual')`).bind(owner, key, institution || 'Manual accounts'),
            env.DB.prepare(`INSERT INTO accounts (owner,name,type,subtype,detailed_type,currency,balance_current_cents,institution_manual,balance_as_of,notes,login_url,mask,holder_ids,beneficiary_id,responsible_adult_id,purpose,inventory_only,item_id,plaid_account_id,is_manual)
        VALUES (${Array(values.length).fill('?').join(',')},(SELECT id FROM items WHERE plaid_item_id=?),?,1)`).bind(...values, key, key),
        ]);
        id = (await env.DB.prepare('SELECT id FROM accounts WHERE plaid_account_id=?').bind(key).first<{
            id: number;
        }>())!.id;
    }
    if (old && old.owner !== owner) {
        await env.DB.prepare("DELETE FROM net_worth WHERE date=date('now') AND owner=? AND NOT EXISTS (SELECT 1 FROM accounts WHERE owner=?)").bind(old.owner,old.owner).run();
    }
    if (old && old.purpose !== purpose) {
        await classify({...env, DB:rawDatabase(env.DB)},new Request('https://minty.local/account-setup',{
            method:'PUT',body:JSON.stringify({purpose}),
        }),id);
    }
    await snapshotBalances(purposeEnv(env,purpose));
    return json({ id, purpose, inventory_only:inventoryOnly }, old ? 200 : 201);
}
