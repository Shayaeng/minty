import type { Env } from '../env';
import type { Config } from '../config';
import { ACCOUNT_NAME } from '../accounts';
import { HttpError, bodyLimitFor, json, jsonBody, unprocessable } from '../http';
import { accountClosure, evaluateOffer, validDate } from '../../public/bonus-rules.js';
type Fields = Record<string, unknown>;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const utcToday = () => new Date().toISOString().slice(0, 10);
async function body(request: Request): Promise<Fields> {
    let b;
    try {
        b = await jsonBody(request, bodyLimitFor(new URL(request.url).pathname));
    }
    catch (e) {
        if (e instanceof SyntaxError)
            throw unprocessable('Expected valid JSON');
        throw e;
    }
    if (!b || typeof b !== 'object' || Array.isArray(b))
        throw unprocessable('Expected an object');
    return b as Fields;
}
function text(b: Fields, key: string, max = 4000, preserve = false): string | null {
    const v = b[key];
    if (v === null || v === undefined || v === '')
        return null;
    if (typeof v !== 'string' || v.length > max)
        throw unprocessable(`${key} must be text up to ${max} characters`);
    return preserve ? v : v.trim() || null;
}
function date(b: Fields, key: string, past = false): string | null {
    const v = b[key];
    if (v === null || v === undefined || v === '')
        return null;
    if (!validDate(v))
        throw unprocessable(`${key} must be a real YYYY-MM-DD date`);
    if (past && String(v) > utcToday())
        throw unprocessable(`${key} cannot be in the future`);
    return v as string;
}
function cents(b: Fields, key: string, positive = false): number | null {
    const v = b[key];
    if (v === null || v === undefined || v === '')
        return null;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < (positive ? 1 : 0) || v > 1000000000000)
        throw unprocessable(`${key} must be ${positive ? 'positive' : 'nonnegative'} integer cents (at most 1 trillion)`);
    return v;
}
function currency(b: Fields, key: string, defaultValue = 'USD'): string {
    const v = b[key] ?? defaultValue;
    if (typeof v !== 'string' || !/^[A-Z]{3}$/.test(v))
        throw unprocessable(`${key} must be a three-letter currency`);
    return v;
}
function choice(b: Fields, key: string, values: string[], fallback: string): string {
    const v = b[key] ?? fallback;
    if (typeof v !== 'string' || !values.includes(v))
        throw unprocessable(`Invalid ${key}`);
    return v;
}
async function account(env: Env, id: number): Promise<Fields> {
    const a = await env.DB.prepare('SELECT id,currency FROM accounts WHERE id=?').bind(id).first<Fields>();
    if (!a)
        throw new HttpError(404, 'Account not found');
    return a;
}
async function existing(env: Env, table: string, id: number): Promise<Fields> {
    // Table names are internal constants, never request input.
    const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first<Fields>();
    if (!row)
        throw new HttpError(404, 'Bonus record not found');
    return row;
}
export async function saveLifecycle(env: Env, request: Request, id: number): Promise<Response> {
    const a = await account(env, id);
    const old = await env.DB.prepare('SELECT * FROM account_lifecycle WHERE account_id=?').bind(id).first<Fields>();
    const b = { ...old, ...await body(request) };
    const status = choice(b, 'account_status', ['open', 'closed'], 'open');
    const opened = date(b, 'opened_date', true), closed = status === 'closed' ? date(b, 'closed_date', true) : null;
    if (opened && closed && closed < opened)
        throw unprocessable('Closed date cannot precede the opened date');
    await env.DB.prepare(`INSERT INTO account_lifecycle (account_id,opened_date,bonus_answer,account_status,closed_date,monthly_fee_cents,fee_currency,fee_waiver)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET opened_date=excluded.opened_date,bonus_answer=excluded.bonus_answer,
    account_status=excluded.account_status,closed_date=excluded.closed_date,monthly_fee_cents=excluded.monthly_fee_cents,fee_currency=excluded.fee_currency,
    fee_waiver=excluded.fee_waiver,updated_at=${NOW}`)
        .bind(id, opened, choice(b, 'bonus_answer', ['yes', 'no', 'unknown'], 'unknown'), status, closed, cents(b, 'monthly_fee_cents'), currency(b, 'fee_currency', String(a.currency || 'USD')), text(b, 'fee_waiver')).run();
    return json({ account_id: id });
}
export async function saveOffer(env: Env, request: Request, id?: number): Promise<Response> {
    const old = id === undefined ? null : await existing(env, 'account_bonus_offers', id);
    const input = await body(request), b = { ...old, ...input };
    const accountId = b.account_id;
    if (typeof accountId !== 'number' || !Number.isSafeInteger(accountId) || accountId < 1)
        throw unprocessable('account_id must identify a saved account');
    if (old && accountId !== old.account_id)
        throw unprocessable('An offer cannot be moved to a different account');
    const a = await account(env, accountId);
    if (!old) {
        const life = await env.DB.prepare('SELECT bonus_answer FROM account_lifecycle WHERE account_id=?').bind(accountId).first<{
            bonus_answer: string;
        }>();
        if (life?.bonus_answer !== 'yes')
            throw unprocessable('Set “Was there an opening bonus?” to Yes before adding an offer');
    }
    const offerCurrency = currency(b, 'currency', String(a.currency || 'USD'));
    if (old && offerCurrency !== old.currency && await env.DB.prepare('SELECT 1 FROM account_bonus_payments WHERE offer_id=? LIMIT 1').bind(id).first())
        throw unprocessable('Cannot change currency while payments are recorded for this offer');
    const trigger = choice(b, 'rule_trigger', ['unknown', 'opened', 'first_payment', 'last_payment', 'manual'], 'unknown');
    const unit = choice(b, 'rule_unit', ['days', 'months'], 'days');
    const value = b.rule_value ?? null;
    const ruleText = text(b, 'rule_text');
    if (trigger !== 'unknown') {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > (unit === 'months' ? 1200 : 36500) || !ruleText)
            throw unprocessable('A calculated closure date requires an explicit trigger, period, unit, and rule/source from the offer terms');
    }
    else if (value !== null)
        throw unprocessable('Record an explicit trigger before calculating a holding period');
    const override = date(b, 'closure_override_date'), reason = text(b, 'closure_override_reason');
    if (override && !reason)
        throw unprocessable('Explain the source or reason for the manually entered closure date');
    const url = text(b, 'offer_url', 2000);
    if (url) {
        try {
            const u = new URL(url);
            if (!['http:', 'https:'].includes(u.protocol))
                throw Error();
        }
        catch {
            throw unprocessable('Offer URL must use http or https');
        }
    }
    const complete = b.payment_complete ?? false;
    if (![true, false, 0, 1].includes(complete as boolean | number))
        throw unprocessable('payment_complete must be true or false');
    const keys = ['offer_name', 'offer_url', 'expected_cents', 'currency', 'terms_notes', 'original_terms', 'expected_payout_date', 'payment_complete', 'minimum_open_period', 'rule_trigger', 'rule_value', 'rule_unit', 'rule_text', 'trigger_date', 'closure_override_date', 'closure_override_reason'];
    const values = [text(b, 'offer_name', 200), url, cents(b, 'expected_cents'), offerCurrency, text(b, 'terms_notes'), text(b, 'original_terms', 48000, true), date(b, 'expected_payout_date'), Number(complete), text(b, 'minimum_open_period', 2000), trigger, value, unit, ruleText, date(b, 'trigger_date'), override, reason];
    const row = old
        ? await env.DB.prepare(`UPDATE account_bonus_offers SET ${keys.map(k => `${k}=?`).join(',')},updated_at=${NOW} WHERE id=? RETURNING id`).bind(...values, id).first()
        : await env.DB.prepare(`INSERT INTO account_bonus_offers (account_id,${keys.join(',')}) VALUES (${Array(keys.length + 1).fill('?').join(',')}) RETURNING id`).bind(accountId, ...values).first();
    return json(row, old ? 200 : 201);
}
export async function saveRequirement(env: Env, request: Request, id?: number): Promise<Response> {
    const old = id === undefined ? null : await existing(env, 'account_bonus_requirements', id), b = { ...old, ...await body(request) };
    if (typeof b.offer_id !== 'number' || !Number.isSafeInteger(b.offer_id))
        throw unprocessable('Choose an offer');
    if (old && b.offer_id !== old.offer_id)
        throw unprocessable('A requirement cannot be moved to a different offer');
    await existing(env, 'account_bonus_offers', b.offer_id);
    const description = text(b, 'description', 2000);
    if (!description)
        throw unprocessable('Describe the requirement');
    const values = [description, date(b, 'deadline'), date(b, 'completed_date', true)];
    const row = old ? await env.DB.prepare('UPDATE account_bonus_requirements SET description=?,deadline=?,completed_date=? WHERE id=? RETURNING id').bind(...values, id).first() : await env.DB.prepare('INSERT INTO account_bonus_requirements (description,deadline,completed_date,offer_id) VALUES (?,?,?,?) RETURNING id').bind(...values, b.offer_id).first();
    return json(row, old ? 200 : 201);
}
export async function savePayment(env: Env, request: Request, id?: number): Promise<Response> {
    const old = id === undefined ? null : await existing(env, 'account_bonus_payments', id), b = { ...old, ...await body(request) };
    if (typeof b.offer_id !== 'number' || !Number.isSafeInteger(b.offer_id))
        throw unprocessable('Choose an offer');
    if (old && b.offer_id !== old.offer_id)
        throw unprocessable('A payment cannot be moved to a different offer');
    await existing(env, 'account_bonus_offers', b.offer_id);
    const amount = cents(b, 'amount_cents', true), received = date(b, 'received_date', true);
    if (amount === null && !received)
        throw unprocessable('Record at least a received amount or date; unknown fields can stay blank');
    const values = [amount, received, text(b, 'notes', 2000)];
    const row = old ? await env.DB.prepare('UPDATE account_bonus_payments SET amount_cents=?,received_date=?,notes=? WHERE id=? RETURNING id').bind(...values, id).first() : await env.DB.prepare('INSERT INTO account_bonus_payments (amount_cents,received_date,notes,offer_id) VALUES (?,?,?,?) RETURNING id').bind(...values, b.offer_id).first();
    return json(row, old ? 200 : 201);
}
export async function deleteChild(env: Env, id: number, kind: 'requirements' | 'payments'): Promise<Response> {
    const r = await env.DB.prepare(`DELETE FROM account_bonus_${kind} WHERE id=? RETURNING id`).bind(id).first();
    if (!r)
        throw new HttpError(404, 'Bonus record not found');
    return json({ ok: true });
}
export async function list(env: Env, config: Config, url: URL): Promise<Response> {
    const today = url.searchParams.get('today') || utcToday();
    if (!validDate(today))
        throw unprocessable('today must be a real YYYY-MM-DD date');
    const [accounts, offers, requirements, payments] = await env.DB.batch([
        env.DB.prepare(`SELECT a.id AS account_id,${ACCOUNT_NAME('a')} AS name,a.owner,a.holder_ids,a.holder_name,
      coalesce(a.institution_manual,i.institution_name) AS institution_name,a.currency AS account_currency,
      l.opened_date,coalesce(l.bonus_answer,'unknown') AS bonus_answer,coalesce(l.account_status,'open') AS account_status,
      l.closed_date,l.monthly_fee_cents,coalesce(l.fee_currency,a.currency,'USD') AS fee_currency,l.fee_waiver
      FROM accounts a JOIN items i ON i.id=a.item_id LEFT JOIN account_lifecycle l ON l.account_id=a.id ORDER BY a.owner,a.id`),
        env.DB.prepare('SELECT * FROM account_bonus_offers ORDER BY id'),
        env.DB.prepare('SELECT * FROM account_bonus_requirements ORDER BY id'),
        env.DB.prepare('SELECT * FROM account_bonus_payments ORDER BY received_date,id'),
    ]);
    const reqBy = new Map<number, any[]>(), payBy = new Map<number, any[]>(), offBy = new Map<number, any[]>();
    for (const r of requirements.results as any[]) {
        if (!reqBy.has(r.offer_id))
            reqBy.set(r.offer_id, []);
        reqBy.get(r.offer_id)!.push(r);
    }
    for (const p of payments.results as any[]) {
        if (!payBy.has(p.offer_id))
            payBy.set(p.offer_id, []);
        payBy.get(p.offer_id)!.push(p);
    }
    const accountBy = new Map((accounts.results as any[]).map(a => [a.account_id, a]));
    for (const o of offers.results as any[]) {
        const req = reqBy.get(o.id) || [], pay = payBy.get(o.id) || [];
        const report = { ...o, requirements: req.map(r => ({ ...r, overdue: !r.completed_date && !!r.deadline && r.deadline < today, completed_late: !!r.completed_date && !!r.deadline && r.completed_date > r.deadline })), payments: pay, ...evaluateOffer(o, accountBy.get(o.account_id), req, pay, today) };
        if (!offBy.has(o.account_id))
            offBy.set(o.account_id, []);
        offBy.get(o.account_id)!.push(report);
    }
    return json({ today, accounts: (accounts.results as any[]).map(a => {
            const all = offBy.get(a.account_id) || [];
            const holders = (JSON.parse(a.holder_ids || '[]') as string[]).map(id => config.users.get(id) || id).join(', ') || a.holder_name;
            return { ...a, owner_label: config.users.get(a.owner) || a.owner, holder_label: holders, offers: all, closure: accountClosure(all, today) };
        }) });
}
