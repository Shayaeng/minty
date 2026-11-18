import { evaluateOffer } from './bonus-rules.js';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const money = (v, c) => v == null ? 'Unknown' : new Intl.NumberFormat(undefined, { style: 'currency', currency: c || 'USD' }).format(v / 100);
const decimal = v => v == null ? '' : String(v / 100);
const amount = v => v.trim() === '' ? null : Math.round(Number(v) * 100);
let report = { today: localToday(), accounts: [] }, personIds = null, currentAccountId = null, currentOfferId = null, busy = false;
const currentAccount = () => report.accounts.find(a => a.account_id === currentAccountId);
const currentOffer = () => currentAccount()?.offers.find(o => o.id === currentOfferId);
async function api(path, body, method = 'PUT') {
    const r = await fetch(path, body === undefined ? (method === 'DELETE' ? { method } : undefined) : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const b = await r.json();
    if (!r.ok)
        throw Error(b.detail || `Request failed (${r.status})`);
    return b;
}
const editor = document.createElement('dialog');
editor.id = 'bonusEditor';
editor.className = 'bonus-editor';
editor.setAttribute('aria-labelledby', 'bonusEditorTitle');
editor.innerHTML = `<div class="editor-heading"><h2 id="bonusEditorTitle">Opening &amp; bonus details</h2><button type="button" class="pill" id="closeBonusEditor">Close</button></div>
<p id="bonusEditorAccount"></p>
<form id="bonusAccountForm"><fieldset><legend>Account opening, status &amp; fees</legend><div class="form-grid">
<label>Account opened date<input name="opened_date" type="date"></label>
<label>Was there an opening bonus?<select name="bonus_answer"><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
<label>Account status<select name="account_status"><option value="open">Open</option><option value="closed">Closed</option></select></label>
<label id="bonusClosedWrap">Account closed date (optional)<input name="closed_date" type="date"></label>
<label>Monthly fee (optional)<input name="monthly_fee" type="number" min="0" step="0.01"></label>
<label>Fee currency<input name="fee_currency" pattern="[A-Z]{3}" maxlength="3" required></label></div>
<label>Fee-waiver requirements<textarea name="fee_waiver" maxlength="4000"></textarea></label>
<p class="bonus-caption">Unknown dates can stay blank. Marking an account closed does not change its saved financial balance. Update a manual balance separately if needed.</p>
<button class="pill">Save account details</button></fieldset></form>
<p id="bonusSavedOffersNote" class="bonus-caption"></p>
<section id="bonusOfferSection" hidden><h3>Offers for this account</h3><p>Record each offer separately; adding an offer never adds a financial account.</p>
<div class="editor-actions"><label>Saved offer<select id="bonusOfferSelect"></select></label><button type="button" class="pill" id="newBonusOffer">New offer</button></div>
<form id="bonusOfferForm"><fieldset><legend>Offer details</legend><div class="form-grid">
<label>Offer name<input name="offer_name" maxlength="200"></label><label>Offer URL<input name="offer_url" type="url" maxlength="2000"></label>
<label>Expected bonus amount<input name="expected_amount" type="number" step="0.01" min="0"></label><label>Bonus currency<input name="currency" pattern="[A-Z]{3}" maxlength="3" required></label>
<label>Expected payout date<input name="expected_payout_date" type="date"></label></div>
<label>Offer terms / notes<textarea name="terms_notes" maxlength="4000"></textarea></label>
<label class="check-label"><input name="save_original" type="checkbox">Save the original terms text</label>
<label id="bonusOriginalWrap" hidden>Original terms text<textarea name="original_terms" maxlength="48000" rows="6"></textarea><small>Up to 48,000 characters; the total request is limited to 64 KiB. Text is saved as entered.</small></label>
<label class="check-label"><input name="payment_complete" type="checkbox">Mark bonus payment complete / settled</label><p class="bonus-caption">Use this for an unknown expected amount or an agreed partial settlement. It does not complete requirements or change any closure date.</p>
</fieldset><fieldset><legend>Holding period &amp; closure terms</legend>
<label>Minimum account-open period, as stated in the terms<textarea name="minimum_open_period" maxlength="2000" rows="2"></textarea></label>
<p>Do not assume the holding period starts at account opening. Choose the trigger explicitly and record the rule from the terms.</p><div class="form-grid">
<label>Holding-period trigger<select name="rule_trigger"><option value="unknown">Unknown / no calculation</option><option value="opened">Account opened date</option><option value="first_payment">First recorded bonus payment date</option><option value="last_payment">Latest recorded bonus payment date</option><option value="manual">Explicit trigger date from the terms</option></select></label>
<label>Holding-period length<input name="rule_value" type="number" min="0" step="1"></label><label>Holding-period unit<select name="rule_unit"><option value="days">Days</option><option value="months">Calendar months</option></select></label>
<label id="bonusTriggerWrap" hidden>Explicit trigger date<input name="trigger_date" type="date"></label></div>
<label>Explicit calculation rule / source from the offer terms<textarea name="rule_text" maxlength="4000" rows="3"></textarea></label>
<p class="bonus-caption">First/latest payment means the first/latest recorded payment, including partial payments. Only choose that trigger when it matches the offer terms. Calendar-month calculations clamp to the last day of a shorter month.</p>
<label class="check-label"><input name="use_override" type="checkbox">Enter a closure date manually / override the calculation</label>
<div id="bonusOverrideWrap" hidden><label>Manual keep-open-until date<input name="closure_override_date" type="date"></label><label>Source / explanation for the manual date or override<textarea name="closure_override_reason" maxlength="4000"></textarea></label></div>
<div class="calculation" id="bonusCalculation" aria-live="polite"></div><p class="bonus-caption">Preview only until saved. A date being reached is a reason to review the terms, not permission to close. Requirement completion, payment and all offers on this account must be reviewed separately.</p>
</fieldset><button class="pill">Save offer</button></form>
<section id="bonusChildren" hidden><h3>Requirements checklist</h3><div id="bonusRequirements"></div>
<form id="newBonusRequirement" class="bonus-child-form"><label>New requirement<input name="description" maxlength="2000" required></label><label>Requirement deadline (optional)<input name="deadline" type="date"></label><button class="pill">Add requirement</button></form>
<h3>Bonus payments received</h3><p id="bonusPaymentSummary"></p><p class="bonus-caption">Unknown payment amounts or dates can stay blank. Enter at least one; unknown dates never supply a holding-period trigger.</p><div id="bonusPayments"></div>
<form id="newBonusPayment" class="bonus-child-form"><label>Received bonus amount<input name="amount" type="number" min="0.01" step="0.01"></label><label>Received date<input name="received_date" type="date"></label><label>Payment notes<input name="notes" maxlength="2000"></label><button class="pill">Record payment</button></form>
</section></section><p class="editor-status" id="bonusEditorStatus" role="status"></p>`;
document.body.append(editor);
const accountForm = $('bonusAccountForm'), offerForm = $('bonusOfferForm');
const field = (form, name) => form.elements.namedItem(name);
function updateVisibility() {
    $('bonusClosedWrap').hidden = field(accountForm, 'account_status').value !== 'closed';
    $('bonusOfferSection').hidden = field(accountForm, 'bonus_answer').value !== 'yes';
    $('bonusOriginalWrap').hidden = !field(offerForm, 'save_original').checked;
    const trigger = field(offerForm, 'rule_trigger').value, explicit = trigger !== 'unknown';
    $('bonusTriggerWrap').hidden = trigger !== 'manual';
    field(offerForm, 'rule_value').required = explicit;
    field(offerForm, 'rule_text').required = explicit;
    field(offerForm, 'rule_value').max = field(offerForm, 'rule_unit').value === 'months' ? 1200 : 36500;
    const override = field(offerForm, 'use_override').checked;
    $('bonusOverrideWrap').hidden = !override;
    field(offerForm, 'closure_override_date').required = override;
    field(offerForm, 'closure_override_reason').required = override;
}
function draftOffer() {
    const b = { account_id: currentAccountId };
    for (const name of ['offer_name', 'offer_url', 'terms_notes', 'expected_payout_date', 'minimum_open_period', 'rule_text'])
        b[name] = field(offerForm, name).value || null;
    b.expected_cents = amount(field(offerForm, 'expected_amount').value);
    b.currency = field(offerForm, 'currency').value;
    b.original_terms = field(offerForm, 'save_original').checked ? field(offerForm, 'original_terms').value : null;
    b.payment_complete = field(offerForm, 'payment_complete').checked;
    b.rule_trigger = field(offerForm, 'rule_trigger').value;
    b.rule_unit = field(offerForm, 'rule_unit').value;
    b.rule_value = b.rule_trigger === 'unknown' || field(offerForm, 'rule_value').value === '' ? null : Number(field(offerForm, 'rule_value').value);
    b.trigger_date = b.rule_trigger === 'manual' ? field(offerForm, 'trigger_date').value || null : null;
    b.closure_override_date = field(offerForm, 'use_override').checked ? field(offerForm, 'closure_override_date').value || null : null;
    b.closure_override_reason = field(offerForm, 'use_override').checked ? field(offerForm, 'closure_override_reason').value || null : null;
    return b;
}
function preview() {
    updateVisibility();
    const a = currentAccount();
    if (!a)
        return;
    const o = currentOffer(), r = evaluateOffer(draftOffer(), a, o?.requirements || [], o?.payments || [], localToday());
    $('bonusCalculation').textContent = `${r.closure_label}${r.keep_open_until ? ' · ' + r.keep_open_until : ''}\n${r.calculation}${r.closure_source ? '\nSource: ' + r.closure_source : ''}${r.calculated_closure_date && field(offerForm, 'use_override').checked ? '\nCalculated date retained for comparison: ' + r.calculated_closure_date : ''}`;
}
function renderChildren() {
    const o = currentOffer();
    $('bonusChildren').hidden = !o;
    if (!o)
        return;
    $('bonusRequirements').innerHTML = o.requirements.length ? o.requirements.map(r => `<form class="bonus-child-form" data-requirement="${r.id}"><label>Requirement<input name="description" maxlength="2000" required value="${esc(r.description)}"></label><div class="form-grid"><label>Deadline<input name="deadline" type="date" value="${esc(r.deadline)}"></label><label class="check-label"><input name="done" type="checkbox" ${r.completed_date ? 'checked' : ''}>Completed</label><label>Completion date<input name="completed_date" type="date" value="${esc(r.completed_date)}" max="${localToday()}" ${r.completed_date ? 'required' : 'disabled'}></label></div>${r.overdue ? '<p class="bonus-alert">Overdue requirement</p>' : ''}${r.completed_late ? '<p>Completed after its deadline.</p>' : ''}<div class="editor-actions"><button class="pill">Save requirement</button><button class="pill" type="button" data-delete-requirement="${r.id}">Delete requirement</button></div></form>`).join('') : '<p>No requirements recorded. This does not mean the offer has no requirements.</p>';
    $('bonusPaymentSummary').textContent = `${money(o.received_cents, o.currency)} received${o.unknown_amount_payments ? ' (known subtotal ' + money(o.known_received_cents, o.currency) + ', ' + o.unknown_amount_payments + ' amount(s) unknown)' : ''}; ${o.payment_status}. Expected: ${money(o.expected_cents, o.currency)}${o.remaining_cents == null ? '' : '; remaining: ' + money(o.remaining_cents, o.currency)}. Payments are not added to account balances.`;
    $('bonusPayments').innerHTML = o.payments.length ? o.payments.map(p => `<form class="bonus-child-form" data-payment="${p.id}"><div class="form-grid"><label>Received amount (${esc(o.currency)})<input name="amount" type="number" min="0.01" step="0.01" value="${decimal(p.amount_cents)}"></label><label>Received date<input name="received_date" type="date" value="${esc(p.received_date)}" max="${localToday()}"></label></div><label>Notes<input name="notes" maxlength="2000" value="${esc(p.notes)}"></label><div class="editor-actions"><button class="pill">Save payment</button><button class="pill" type="button" data-delete-payment="${p.id}">Delete payment</button></div></form>`).join('') : '<p>No bonus payments recorded.</p>';
    field($('newBonusPayment'), 'received_date').max = localToday();
}
function selectOffer(id) {
    currentOfferId = id == null ? null : Number(id);
    const a = currentAccount(), o = currentOffer();
    offerForm.reset();
    for (const name of ['offer_name', 'offer_url', 'currency', 'terms_notes', 'original_terms', 'expected_payout_date', 'minimum_open_period', 'rule_trigger', 'rule_unit', 'rule_text', 'trigger_date', 'closure_override_date', 'closure_override_reason'])
        field(offerForm, name).value = o?.[name] ?? ({ currency: a.account_currency || 'USD', rule_trigger: 'unknown', rule_unit: 'days' }[name] || '');
    field(offerForm, 'expected_amount').value = decimal(o?.expected_cents);
    field(offerForm, 'rule_value').value = o?.rule_value ?? '';
    field(offerForm, 'payment_complete').checked = !!o?.payment_complete;
    field(offerForm, 'save_original').checked = o?.original_terms != null;
    field(offerForm, 'use_override').checked = !!o?.closure_override_date;
    $('bonusOfferSelect').value = o ? String(o.id) : '';
    $('newBonusRequirement').reset();
    $('newBonusPayment').reset();
    renderChildren();
    preview();
}
function offerOptions() {
    const a = currentAccount();
    $('bonusOfferSelect').innerHTML = '<option value="">New / unsaved offer</option>' + a.offers.map(o => `<option value="${o.id}">${esc(o.offer_name || 'Unnamed offer')} (#${o.id})</option>`).join('');
    $('bonusSavedOffersNote').textContent = a.offers.length ? `${a.offers.length} saved offer(s) are retained even if the opening-bonus answer is changed. Select Yes to view or edit them.` : '';
}
async function openAccount(id, offerId) {
    if (busy)
        return;
    try {
        await refresh();
        currentAccountId = Number(id);
        const a = currentAccount();
        if (!a)
            throw Error('Account not found');
        $('bonusEditorTitle').textContent = 'Opening & bonus details';
        $('bonusEditorAccount').textContent = `${a.name || 'Account'} · ${a.institution_name || 'Institution not specified'} · Household person: ${a.owner_label}${a.holder_label ? ' · Holder: ' + a.holder_label : ''}`;
        accountForm.reset();
        for (const name of ['opened_date', 'bonus_answer', 'account_status', 'closed_date', 'fee_currency', 'fee_waiver'])
            field(accountForm, name).value = a[name] || '';
        field(accountForm, 'monthly_fee').value = decimal(a.monthly_fee_cents);
        field(accountForm, 'opened_date').max = localToday();
        field(accountForm, 'closed_date').max = localToday();
        offerOptions();
        selectOffer(offerId ?? a.offers[0]?.id ?? null);
        $('bonusEditorStatus').textContent = '';
        if (!editor.open)
            editor.showModal();
    }
    catch (e) {
        $('bonusStatus').textContent = e.message;
        $('accountStatus').textContent = e.message;
    }
}
async function act(fn, message) {
    if (busy)
        return;
    busy = true;
    editor.setAttribute('aria-busy', 'true');
    $('bonusEditorStatus').textContent = 'Saving…';
    const controls = [...editor.querySelectorAll('button,select,input,textarea')].map(control=>({control,disabled:control.disabled}));
    controls.forEach(({control}) => control.disabled = true);
    try {
        await fn();
        $('bonusEditorStatus').textContent = message;
    }
    catch (e) {
        $('bonusEditorStatus').textContent = e.message;
    }
    finally {
        busy = false;
        editor.removeAttribute('aria-busy');
        controls.forEach(({control,disabled}) => control.disabled = disabled);
    }
}
accountForm.onsubmit = e => {
    e.preventDefault();
    act(async () => {
        const b = {};
        for (const name of ['opened_date', 'bonus_answer', 'account_status', 'closed_date', 'fee_currency', 'fee_waiver'])
            b[name] = field(accountForm, name).value || null;
        b.monthly_fee_cents = amount(field(accountForm, 'monthly_fee').value);
        await api(`/accounts/${currentAccountId}/lifecycle`, b);
        await refresh();
        offerOptions();
        $('bonusOfferSelect').value = currentOfferId || '';
        preview();
    }, 'Account details saved. Financial balances were not changed.');
};
offerForm.onsubmit = e => {
    e.preventDefault();
    act(async () => {
        const r = await api(currentOfferId ? `/account-bonuses/offers/${currentOfferId}` : '/account-bonuses/offers', draftOffer(), currentOfferId ? 'PUT' : 'POST');
        await refresh();
        offerOptions();
        selectOffer(r.id);
    }, 'Offer saved. Requirements, payment and closure dates are tracked separately.');
};
$('newBonusRequirement').onsubmit = e => {
    e.preventDefault();
    act(async () => {
        const f = e.target;
        await api('/account-bonuses/requirements', { offer_id: currentOfferId, description: field(f, 'description').value, deadline: field(f, 'deadline').value || null }, 'POST');
        f.reset();
        await refresh();
        renderChildren();
        preview();
    }, 'Requirement added.');
};
$('newBonusPayment').onsubmit = e => {
    e.preventDefault();
    act(async () => {
        const f = e.target;
        await api('/account-bonuses/payments', { offer_id: currentOfferId, amount_cents: amount(field(f, 'amount').value), received_date: field(f, 'received_date').value || null, notes: field(f, 'notes').value || null }, 'POST');
        f.reset();
        await refresh();
        renderChildren();
        preview();
    }, 'Payment recorded. It does not complete requirements or grant permission to close.');
};
$('bonusRequirements').onsubmit = e => {
    e.preventDefault();
    const f = e.target.closest('[data-requirement]');
    if (!f)
        return;
    act(async () => {
        await api(`/account-bonuses/requirements/${f.dataset.requirement}`, { description: field(f, 'description').value, deadline: field(f, 'deadline').value || null, completed_date: field(f, 'done').checked ? field(f, 'completed_date').value || null : null });
        await refresh();
        renderChildren();
        preview();
    }, 'Requirement saved.');
};
$('bonusRequirements').onchange = e => { if (e.target.name === 'done') {
    const f = e.target.form, input = field(f, 'completed_date');
    input.disabled = !e.target.checked;
    input.required = e.target.checked;
    if (e.target.checked && !input.value)
        input.value = localToday();
} };
$('bonusPayments').onsubmit = e => {
    e.preventDefault();
    const f = e.target.closest('[data-payment]');
    if (!f)
        return;
    act(async () => {
        await api(`/account-bonuses/payments/${f.dataset.payment}`, { amount_cents: amount(field(f, 'amount').value), received_date: field(f, 'received_date').value || null, notes: field(f, 'notes').value || null });
        await refresh();
        renderChildren();
        preview();
    }, 'Payment saved.');
};
editor.addEventListener('click', e => {
    const req = e.target.closest('[data-delete-requirement]'), pay = e.target.closest('[data-delete-payment]');
    if ((req || pay) && confirm(`Delete this ${req ? 'requirement' : 'payment'} record?`))
        act(async () => { await api(`/account-bonuses/${req ? 'requirements' : 'payments'}/${req ? req.dataset.deleteRequirement : pay.dataset.deletePayment}`, undefined, 'DELETE'); await refresh(); renderChildren(); preview(); }, 'Record deleted.');
});
$('closeBonusEditor').onclick = () => editor.close();
editor.addEventListener('cancel', e => { if (busy)
    e.preventDefault(); });
$('newBonusOffer').onclick = () => { if (currentAccount().bonus_answer !== 'yes') {
    $('bonusEditorStatus').textContent = 'Save account details with opening bonus set to Yes first.';
    return;
} selectOffer(null); $('bonusEditorStatus').textContent = 'New offer. Existing offers remain saved.'; };
$('bonusOfferSelect').onchange = e => selectOffer(e.target.value || null);
accountForm.onchange = updateVisibility;
offerForm.oninput = preview;
offerForm.onchange = preview;
function decorate() {
    for (const node of document.querySelectorAll('[data-bonus-summary]')) {
        const a = report.accounts.find(a => a.account_id === Number(node.dataset.bonusSummary));
        if (!a)
            continue;
        node.textContent = `${a.account_status === 'closed' ? 'Closed' : 'Open'} · Opened: ${a.opened_date || 'Unknown'} · Opening bonus: ${{ yes: 'Yes', no: 'No', unknown: 'Unknown' }[a.bonus_answer]} · ${a.closure.label}${a.closure.keep_open_until && a.closure.keep_open_until <= report.today ? ' (' + a.closure.keep_open_until + ')' : ''}${a.closure.unknown_offers && a.closure.known_keep_open_until ? ' · Latest known keep-open date: ' + a.closure.known_keep_open_until : ''}`;
    }
}
function renderRows() {
    const filter = $('bonusFilter').value;
    const rows = report.accounts.filter(a => !personIds || personIds.has(a.account_id)).flatMap(a => (a.offers.length ? a.offers : [null]).map(o => ({ a, o }))).filter(({ a, o }) => filter === 'all' || filter === 'closed' && a.account_status === 'closed' || filter === 'requirements' && o?.requirements_outstanding > 0 || filter === 'payment' && o?.awaiting_payment || filter === 'holding' && a.closure.keep_open_active || filter === 'reached' && a.closure.closure_date_reached);
    $('bonusList').innerHTML = rows.length ? rows.map(({ a, o }) => `<article class="bonus-row" data-bonus-row="${a.account_id}" data-offer-row="${o?.id || ''}"><h3>${esc(a.name || 'Account')} · ${esc(a.institution_name || 'Institution not specified')}</h3><p>Household person: ${esc(a.owner_label)}${a.holder_label ? ' · Holder: ' + esc(a.holder_label) : ''}</p><p>${o ? esc(o.offer_name || 'Unnamed offer') : 'Opening bonus: ' + esc({ yes: 'Yes — offer not recorded', no: 'No', unknown: 'Unknown' }[a.bonus_answer])}</p><div class="bonus-badges"><span>${a.account_status === 'closed' ? 'Closed' : 'Open'}</span>${o?.requirements_overdue ? '<span class="bonus-alert">Overdue requirements: ' + o.requirements_overdue + '</span>' : ''}${o?.payout_overdue ? '<span class="bonus-alert">Overdue expected payout</span>' : ''}</div><dl><dt>Opened</dt><dd>${esc(a.opened_date || 'Unknown')}</dd><dt>Expected bonus</dt><dd>${o ? esc(money(o.expected_cents, o.currency)) : 'Unknown'}</dd><dt>Received bonus</dt><dd>${o ? esc(money(o.received_cents, o.currency)) : 'Not recorded'}${o?.unknown_amount_payments ? ' · known subtotal ' + esc(money(o.known_received_cents, o.currency)) : ''}${o?.unknown_date_payments ? ' · payment date(s) unknown' : o?.latest_known_received_date ? ' · latest ' + esc(o.latest_known_received_date) : ''}</dd><dt>Next requirement</dt><dd>${esc(o?.next_requirement?.description || (o ? 'None outstanding / recorded' : 'Not recorded'))}</dd><dt>Requirement deadline</dt><dd>${esc(o?.next_requirement?.deadline || 'Unknown')}</dd><dt>Expected payout</dt><dd>${esc(o?.expected_payout_date || 'Unknown')}</dd><dt>This offer: keep open until</dt><dd>${esc(o?.keep_open_until || 'Unknown')}</dd><dt>Monthly fee</dt><dd>${esc(money(a.monthly_fee_cents, a.fee_currency))}</dd></dl>${o ? `<p>${esc(o.payment_status)}${o.remaining_cents == null ? '' : ' · Remaining ' + esc(money(o.remaining_cents, o.currency))}</p><p><strong>${esc(o.closure_label)}</strong></p><details><summary>Closure calculation &amp; source</summary><p>${esc(o.calculation)}</p><p>${esc(o.closure_source || 'Source not recorded')}</p>${o.closure_override_date && o.calculated_closure_date ? '<p>Calculated date before override: ' + esc(o.calculated_closure_date) + '</p>' : ''}</details>` : '<p>Closure terms unknown</p>'}${a.offers.length > 1 ? `<p>All offers on this account: <strong>${esc(a.closure.label)}</strong>${a.closure.known_keep_open_until ? ' · latest known date ' + esc(a.closure.known_keep_open_until) : ''}${a.closure.unknown_offers ? ' · ' + a.closure.unknown_offers + ' offer(s) have unknown closure terms' : ''}</p>` : ''}${a.fee_waiver ? '<p>Fee waiver: ' + esc(a.fee_waiver) + '</p>' : ''}<button class="pill" type="button" data-manage-account="${a.account_id}" ${o ? 'data-manage-offer="' + o.id + '"' : ''}>${o ? 'View / edit offer' : 'Opening & bonus details'}</button></article>`).join('') : '<p>No accounts or offers match this filter.</p>';
}
async function refresh() {
    report = await api('/account-bonuses?' + new URLSearchParams({ today: localToday() }));
    renderRows();
    decorate();
    $('bonusStatus').textContent = '';
}
function setView(view) {
    $('inventoryView').hidden = view === 'bonuses';
    $('bonusView').hidden = view !== 'bonuses';
    document.querySelectorAll('[data-account-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.accountView === view)));
    const url = new URL(location.href);
    if (view === 'bonuses')
        url.searchParams.set('view', 'bonuses');
    else
        url.searchParams.delete('view');
    history.replaceState(null, '', url);
}
document.querySelectorAll('[data-account-view]').forEach(b => b.onclick = () => setView(b.dataset.accountView));
document.addEventListener('minty:accounts-filter', e => { personIds = new Set(e.detail.accountIds); renderRows(); });
$('bonusFilter').onchange = renderRows;
$('refreshBonuses').onclick = () => refresh().catch(e => $('bonusStatus').textContent = e.message);
$('bonusList').onclick = e => { const b = e.target.closest('[data-manage-account]'); if (b)
    openAccount(Number(b.dataset.manageAccount), b.dataset.manageOffer ? Number(b.dataset.manageOffer) : undefined); };
function refreshForDay() {
    if (!document.hidden && report.today !== localToday())
        refresh().then(() => {
            if (editor.open) {
                preview();
                editor.querySelectorAll('input[type="date"][max]').forEach(input => input.max = localToday());
            }
        }).catch(e => $('bonusStatus').textContent = e.message);
}
document.addEventListener('visibilitychange', refreshForDay);
setInterval(refreshForDay, 60000);
window.MintyBonuses = { openAccount, decorate };
setView(new URLSearchParams(location.search).get('view') === 'bonuses' ? 'bonuses' : 'inventory');
refresh().catch(e => $('bonusStatus').textContent = e.message);
