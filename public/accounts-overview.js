(function () {
    const el = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let accounts = [], users = [], persons = [], groups = {}, selected = '', category = '';
    const fields = [['holder_name', 'Owner / holder'], ['beneficiary_name', 'Beneficiary'], ['responsible_adult_name', 'Responsible adult']];
    const household = a => users.find(u => u.key === a.owner)?.label || a.owner;
    const key = s => s.trim().toLocaleLowerCase();
    const ids = a => [a.owner, ...JSON.parse(a.holder_ids || '[]'), a.beneficiary_id, a.responsible_adult_id].filter(Boolean);
    const legacy = a => [JSON.parse(a.holder_ids || '[]').length ? null : a.holder_name, a.beneficiary_id ? null : a.beneficiary_name, a.responsible_adult_id ? null : a.responsible_adult_name].filter(Boolean);
    const money = (v, c) => v == null ? 'Not available' : new Intl.NumberFormat(undefined, { style: 'currency', currency: /^[A-Z]{3}$/.test(c || '') ? c : 'USD' }).format(v);
    async function api(path, options) { const r = await fetch(path, options), b = await r.json(); if (!r.ok)
        throw Error(b.detail || 'Unable to load accounts'); return b; }
    function totals(rows) { const out = new Map(); for (const a of rows.filter(a => !a.excluded)) {
        const c = a.currency || 'USD';
        if (!out.has(c))
            out.set(c, { assets: 0, debts: 0, missing: 0, count: 0 });
        const t = out.get(c);
        t.count++;
        if (a.balance_current == null) {
            t.missing++;
            continue;
        }
        if (a.account_type.kind === 'debt')
            t.debts += a.balance_current;
        else
            t.assets += a.balance_current;
    } return out; }
    function render() {
        const names = new Map(persons.filter(p => !p.archived || accounts.some(a => ids(a).includes(p.id))).map(p => [p.id, p.label + (p.archived ? ' (archived)' : '')]));
        for (const a of accounts)
            for (const name of legacy(a))
                names.set('legacy:' + key(name), name + ' (legacy relationship)');
        el('people').innerHTML = `<button type="button" data-person="" aria-pressed="${!selected}">Everyone</button>` + [...names].map(([k, n]) => `<button type="button" data-person="${esc(k)}" aria-pressed="${selected === k}">${esc(n)}</button>`).join('');
        const rows = accounts.filter(a => !selected || ids(a).includes(selected) || legacy(a).some(name => 'legacy:' + key(name) === selected));
        const ts = totals(rows);
        el('totals').innerHTML = ts.size ? [...ts].map(([c, t]) => `<article class="balance-total"><h2>${esc(c)} · Overall net worth</h2>Assets<strong>${esc(money(t.assets, c))}</strong>Debts<strong>${esc(money(t.debts, c))}</strong>Net worth<strong>${esc(money(t.assets - t.debts, c))}</strong><p>${t.count} account(s)${t.missing ? ` · ${t.missing} without a balance` : ''}</p></article>`).join('') : '<p>No included account balances yet.</p>';
        el('categories').innerHTML = Object.entries(groups).map(([g, label]) => { const list = rows.filter(a => !a.excluded && a.account_type.group === g), sums = totals(list); return `<button type="button" class="summary-category" data-category="${g}" aria-pressed="${category === g}">${esc(label)}<small> · ${list.length} included account(s)</small>${sums.size ? [...sums].map(([c, t]) => `<strong>${esc(money(g === 'debts' ? t.debts : t.assets, c))} ${esc(c)}</strong>`).join('') : '<strong>No accounts</strong>'}</button>`; }).join('');
        el('categoryFilter').innerHTML = category ? `Showing ${esc(groups[category])}. <button type="button" class="pill" id="clearCategory">Show all accounts</button>` : '';
        const visible = rows.filter(a => !category || a.account_type.group === category);
        el('accountList').innerHTML = visible.length ? visible.map(a => `<article class="account-card"><h2>${esc(a.name || 'Account')}</h2><span>${a.is_manual ? 'Manual' : 'Connected'}${a.excluded ? ' · Excluded from totals' : ''}</span><strong class="amount">${esc(money(a.balance_current, a.currency))}</strong><dl><dt>Institution</dt><dd>${esc(a.institution_manual || a.institution_name || 'Not specified')}</dd><dt>Account type</dt><dd>${esc(a.account_type.label)}</dd><dt>Household person</dt><dd>${esc(household(a))}</dd>${fields.map(([f, l]) => `<dt>${l}</dt><dd>${esc(a[f] || 'Not specified')}</dd>`).join('')}<dt>${a.is_manual ? 'Balance as of' : 'Balance synced'}</dt><dd>${esc(a.is_manual ? (a.balance_as_of || 'Unknown') : (a.updated_at ? new Date(a.updated_at).toLocaleString() : 'Unknown'))}</dd>${a.mask ? `<dt>Last four</dt><dd>${esc(a.mask)}</dd>` : ''}</dl>${a.notes ? `<p>${esc(a.notes)}</p>` : ''}<div class="account-actions">${a.is_manual ? `<a href="/manual.html?edit=${a.id}">Edit balance &amp; details</a>` : ''}${a.login_url && /^https?:\/\//i.test(a.login_url) ? `<a href="${esc(a.login_url)}" target="_blank" rel="noopener noreferrer">Account login</a>` : ''}<button type="button" class="pill" data-edit-people="${a.id}">Edit relationships</button></div></article>`).join('') : '<p class="account-empty">No saved accounts for this view. Add an account or clear the filter.</p>';
    }
    el('people').onclick = e => { const b = e.target.closest('[data-person]'); if (b) {
        selected = b.dataset.person;
        render();
    } };
    el('categories').onclick = e => { const b = e.target.closest('[data-category]'); if (b) {
        category = category === b.dataset.category ? '' : b.dataset.category;
        render();
    } };
    el('categoryFilter').onclick = e => { if (e.target.closest('#clearCategory')) {
        category = '';
        render();
    } };
    el('accountList').onclick = e => { const b = e.target.closest('[data-edit-people]'); if (!b)
        return; const a = accounts.find(a => a.id === Number(b.dataset.editPeople)); el('peopleAccount').value = a.id; for (const f of ['holder_ids', 'beneficiary_id', 'responsible_adult_id']) {
        el(f).replaceChildren();
        if (f !== 'holder_ids')
            el(f).append(new Option('Not specified', ''));
        for (const p of persons) {
            const o = new Option(p.label + (p.archived ? ' (archived)' : ''), p.id);
            o.selected = f === 'holder_ids' ? JSON.parse(a.holder_ids || '[]').includes(p.id) : a[f] === p.id;
            o.disabled = !!p.archived && !o.selected;
            el(f).append(o);
        }
    } el('peopleError').textContent = ''; el('relationships').showModal(); };
    el('cancelPeople').onclick = () => el('relationships').close();
    el('peopleForm').onsubmit = async (e) => { e.preventDefault(); try {
        const body = { holder_ids: [...el('holder_ids').selectedOptions].map(o => o.value), beneficiary_id: el('beneficiary_id').value || null, responsible_adult_id: el('responsible_adult_id').value || null };
        await api(`/accounts/${el('peopleAccount').value}/people`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        accounts = await api('/accounts?view=all');
        render();
        el('relationships').close();
    }
    catch (e) {
        el('peopleError').textContent = e.message;
    } };
    Promise.all([api('/accounts?view=all'), api('/users'), api('/people'), api('/account-types')]).then(([a, u, p, c]) => { accounts = a; users = u; persons = p; groups = c.groups; render(); }).catch(e => { el('accountStatus').textContent = e.message; });
})();
