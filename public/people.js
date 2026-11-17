(function () {
    const el = id => document.getElementById(id), esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    el('themeToggle').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; localStorage.setItem('minty-theme', t); };
    let people = [];
    async function api(path, body, method = 'PUT') { const r = await fetch(path, body ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined); const b = await r.json(); if (!r.ok)
        throw Error(b.detail || 'Unable to save person'); return b; }
    async function load() { people = await api('/people'); el('peopleList').innerHTML = people.map((p, i) => `<form data-person="${p.id}" class="person-row"><label>Name<input name="label" value="${esc(p.label)}" maxlength="100" required></label><small>Internal ID: ${p.id}${p.archived ? ' - Archived' : ''}</small><div class="account-actions"><button class="pill">Save name</button><button class="pill" type="button" data-archive="${p.id}">${p.archived ? 'Restore' : 'Archive'}</button><button class="pill" type="button" data-move="${i}" data-direction="-1" ${i === 0 ? 'disabled' : ''}>Move up</button><button class="pill" type="button" data-move="${i}" data-direction="1" ${i === people.length - 1 ? 'disabled' : ''}>Move down</button></div></form>`).join(''); }
    el('newPerson').onsubmit = async (e) => { e.preventDefault(); try {
        await api('/people', { label: el('newLabel').value }, 'POST');
        el('newLabel').value = '';
        await load();
        el('peopleStatus').textContent = 'Person added. Login access is unchanged.';
    }
    catch (e) {
        el('peopleStatus').textContent = e.message;
    } };
    el('peopleList').onsubmit = async (e) => { e.preventDefault(); const form = e.target.closest('[data-person]'); if (!form)
        return; try {
        await api(`/people/${form.dataset.person}`, { label: form.elements.label.value });
        await load();
        el('peopleStatus').textContent = 'Person saved.';
    }
    catch (e) {
        el('peopleStatus').textContent = e.message;
    } };
    el('peopleList').onclick = async (e) => { try {
        const a = e.target.closest('[data-archive]');
        if (a) {
            const p = people.find(p => p.id === a.dataset.archive);
            await api(`/people/${p.id}`, { label: p.label, archived: !p.archived });
            await load();
        }
        const m = e.target.closest('[data-move]');
        if (m) {
            const ordered = [...people], i = Number(m.dataset.move), j = i + Number(m.dataset.direction);
            [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
            await api('/people/order', { ids: ordered.map(p => p.id) });
            await load();
        }
    }
    catch (e) {
        el('peopleStatus').textContent = e.message;
    } };
    load().catch(e => el('peopleStatus').textContent = e.message);
})();
