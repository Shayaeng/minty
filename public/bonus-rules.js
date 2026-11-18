// Pure, shared date-only rules. This module never interprets an offer or grants permission to close.
export function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const PERIOD_LIMITS = { days: 36500, months: 1200 };
export function addPeriod(date, value, unit) {
    if (!validDate(date) || !Number.isInteger(value) || value < 0 || !['days', 'months'].includes(unit) || value > PERIOD_LIMITS[unit])
        return null;
    const d = new Date(date + 'T00:00:00Z');
    if (unit === 'days')
        d.setUTCDate(d.getUTCDate() + value);
    else {
        const day = d.getUTCDate();
        d.setUTCDate(1);
        d.setUTCMonth(d.getUTCMonth() + value);
        const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        d.setUTCDate(Math.min(day, last));
    }
    return d.getUTCFullYear() > 9999 ? null : d.toISOString().slice(0, 10);
}
export function closureLabel(date, today) {
    return !date ? 'Closure terms unknown' : date > today ? `Keep open until ${date}` : 'Closure date reached — review terms';
}
export function evaluateOffer(offer, account, requirements = [], payments = [], today) {
    const dates = payments.map(p => p.received_date).filter(validDate).sort();
    const unknownDates = payments.length - dates.length;
    const triggers = { opened: account.opened_date, first_payment: unknownDates ? null : dates[0], last_payment: unknownDates ? null : dates.at(-1), manual: offer.trigger_date };
    const triggerLabels = { opened: 'account opened', first_payment: 'first recorded bonus payment', last_payment: 'latest recorded bonus payment', manual: 'explicit trigger date' };
    const trigger = triggers[offer.rule_trigger];
    const hasRule = offer.rule_trigger !== 'unknown' && !!offer.rule_text?.trim() && Number.isInteger(offer.rule_value) && offer.rule_value >= 0;
    const calculated = hasRule ? addPeriod(trigger, offer.rule_value, offer.rule_unit) : null;
    const override = validDate(offer.closure_override_date) ? offer.closure_override_date : null;
    const keepUntil = override || calculated;
    const outstanding = requirements.filter(r => !r.completed_date).sort((a, b) => (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31') || a.id - b.id);
    const unknownAmounts = payments.filter(p => !Number.isSafeInteger(p.amount_cents)).length;
    const received = payments.reduce((sum, p) => sum + (Number.isSafeInteger(p.amount_cents) ? p.amount_cents : 0), 0);
    const targetKnown = Number.isSafeInteger(offer.expected_cents);
    const targetReached = targetKnown && received >= offer.expected_cents;
    const paymentComplete = !!offer.payment_complete || targetReached;
    const status = paymentComplete ? (targetReached ? 'Expected amount received' : 'Payment marked complete') : payments.length > 0 ? (unknownAmounts ? 'Payment amounts incomplete' : targetKnown ? 'Partially received' : 'Received amount recorded; target unknown') : 'Awaiting payment';
    return {
        received_cents: unknownAmounts || (!payments.length && offer.payment_complete) ? null : received,
        known_received_cents: received, unknown_amount_payments: unknownAmounts,
        unknown_date_payments: unknownDates, latest_known_received_date: dates.at(-1) || null,
        remaining_cents: targetKnown && !unknownAmounts ? Math.max(0, offer.expected_cents - received) : null,
        payment_status: status,
        awaiting_payment: !paymentComplete,
        payout_overdue: !paymentComplete && !!offer.expected_payout_date && offer.expected_payout_date < today,
        requirements_outstanding: outstanding.length,
        requirements_overdue: outstanding.filter(r => !!r.deadline && r.deadline < today).length,
        next_requirement: outstanding[0] || null,
        calculated_closure_date: calculated,
        keep_open_until: keepUntil,
        keep_open_active: !!keepUntil && keepUntil > today,
        closure_date_reached: !!keepUntil && keepUntil <= today,
        closure_label: closureLabel(keepUntil, today),
        calculation: calculated ? `${trigger} (${triggerLabels[offer.rule_trigger]}) + ${offer.rule_value} ${offer.rule_unit === 'months' ? 'calendar months (month-end clamped)' : 'days'} = ${calculated}. Rule: ${offer.rule_text}` : hasRule ? unknownDates && ['first_payment', 'last_payment'].includes(offer.rule_trigger) ? 'One or more payment dates are unknown; the first/latest payment cannot be identified. No closure date calculated.' : `Waiting for ${triggerLabels[offer.rule_trigger] || 'the explicit trigger date'}; no closure date calculated.` : 'No explicit holding rule recorded; no closure date calculated.',
        closure_source: override ? `Manually entered override: ${offer.closure_override_reason || 'Source not recorded'}` : calculated ? offer.rule_text : null,
    };
}
export function accountClosure(offers, today) {
    const known = offers.map(o => o.keep_open_until).filter(Boolean).sort();
    const unknown = offers.filter(o => !o.keep_open_until).length;
    const last = known.at(-1) || null;
    return {
        label: unknown || !offers.length ? 'Closure terms unknown' : closureLabel(last, today),
        keep_open_until: unknown ? null : last, known_keep_open_until: last, unknown_offers: unknown,
        // A known future obligation remains active even if another offer's terms are unknown.
        keep_open_active: !!last && last > today,
        closure_date_reached: offers.length > 0 && unknown === 0 && !!last && last <= today,
    };
}
