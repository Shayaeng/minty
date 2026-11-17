(function () {
    const el = id => document.getElementById(id);
    let persons = [], accounts = [], types = [];
    const legacy = a => [!JSON.parse(a.holder_ids || '[]').length ? a.holder_name : null, !a.beneficiary_id ? a.beneficiary_name : null, !a.responsible_adult_id ? a.responsible_adult_name : null].filter(Boolean);
    const textFields = ['owner', 'name', 'detailed_type', 'institution_manual', 'beneficiary_id', 'responsible_adult_id', 'mask', 'currency', 'balance_as_of', 'notes', 'login_url'];
    async function api(path, options) { const r = await fetch(path, options); const b = await r.json(); if (!r.ok)
        throw Error(b.detail || 'Request failed'); return b; }
    async function loadPeople() { const saved = {}; for (const f of ['owner', 'holder_ids', 'beneficiary_id', 'responsible_adult_id'])
        saved[f] = [...el(f).selectedOptions].map(o => o.value); persons = await api('/people'); for (const f of ['owner', 'holder_ids', 'beneficiary_id', 'responsible_adult_id']) {
        el(f).replaceChildren();
        if (f !== 'owner' && f !== 'holder_ids')
            el(f).append(new Option('Not specified', ''));
        for (const p of persons) {
            const o = new Option(p.label + (p.archived ? ' (archived)' : ''), p.id);
            o.disabled = !!p.archived;
            o.selected = saved[f].includes(p.id);
            el(f).append(o);
        }
    } }
    function edit(a) { const older = legacy(a); el('legacyPeople').hidden = !older.length; el('legacyClearLabel').hidden = !older.length; el('clearLegacy').checked = false; el('legacyPeople').textContent = 'Legacy relationship labels: ' + older.join(', ') + '. They are retained unless replaced with people or explicitly cleared.'; el('accountId').value = a.id; for (const f of textFields)
        el(f).value = a[f] ?? ''; el('detailed_type').value = a.detailed_type || 'other_investment'; el('balance').value = a.balance_current; const holders = Array.isArray(a.holder_ids) ? a.holder_ids : JSON.parse(a.holder_ids || '[]'); for (const o of el('holder_ids').options)
        o.selected = holders.includes(o.value); for (const f of ['owner', 'holder_ids', 'beneficiary_id', 'responsible_adult_id'])
        for (const o of el(f).options)
            if (o.selected)
                o.disabled = false; el('status').textContent = 'Editing ' + a.name; el('name').focus(); }
    async function load(editId) { accounts = await api('/accounts?view=all'); el('list').replaceChildren(); for (const a of accounts.filter(a => a.is_manual)) {
        const p = document.createElement('p'), button = document.createElement('button');
        button.className = 'pill';
        button.type = 'button';
        button.textContent = `${a.name}: ${a.balance_current} ${a.currency} - Edit`;
        button.onclick = () => edit(a);
        p.append(button);
        el('list').append(p);
        if (String(a.id) === editId)
            edit(a);
    } }
    el('form').onsubmit = async (e) => { e.preventDefault(); try {
        const id = el('accountId').value, body = {};
        for (const f of textFields)
            body[f] = el(f).value || null;
        body.holder_ids = [...el('holder_ids').selectedOptions].map(o => o.value);
        const previous = accounts.find(a => String(a.id) === id);
        if (previous && !el('clearLegacy').checked) {
            if (previous.holder_name && !JSON.parse(previous.holder_ids || '[]').length && !body.holder_ids.length)
                delete body.holder_ids;
            for (const [f, label] of [['beneficiary_id', 'beneficiary_name'], ['responsible_adult_id', 'responsible_adult_name']])
                if (previous[label] && !previous[f] && !body[f])
                    delete body[f];
        }
        body.balance_cents = Math.round(Number(el('balance').value) * 100);
        const saved = await api(id ? `/accounts/${id}/manual` : '/accounts', { method: id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        el('accountId').value = saved.id;
        await load();
        el('status').textContent = 'Account saved. Balances and net worth are updated.';
    }
    catch (e) {
        el('status').textContent = e.message;
    } };
    el('form').onreset = () => { setTimeout(() => { el('accountId').value = ''; el('balance_as_of').value = new Date().toISOString().slice(0, 10); el('status').textContent = ''; el('legacyPeople').hidden = true; el('legacyClearLabel').hidden = true; }, 0); };
    el('reloadPeople').onclick = () => loadPeople().catch(e => el('status').textContent = e.message);
    (async () => { try {
        const catalog = await api('/account-types');
        types = catalog.types;
        for (const t of types)
            el('detailed_type').append(new Option(t.label, t.id));
        await loadPeople();
        el('balance_as_of').max = new Date().toISOString().slice(0, 10);
        el('balance_as_of').value = el('balance_as_of').max;
        await load(new URLSearchParams(location.search).get('edit'));
    }
    catch (e) {
        el('status').textContent = e.message;
    } })();
})();
