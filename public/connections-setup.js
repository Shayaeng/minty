let USERS = null;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const color = i => `var(--u${i % 6})`;
let keyEdited = false;
let forUser = null; // an existing person whose keys aren't set yet (their "Add keys")
async function loadStatus() {
    let st = null;
    try {
        const r = await fetch("/status");
        if (r.ok)
            st = await r.json();
    }
    catch { }
    if (!st)
        return;
    $("checksTitle").hidden = false;
    $("checks").hidden = false;
    if (st.checks.some(c => c.id === "token_key" && !c.ok))
        $("keygen").open = true; // no key yet: show the generator
    $("checks").innerHTML = st.checks.map(c => `<li class="${c.ok ? "ok" : c.level}">
      <span class="mark">${c.ok ? "✓" : c.level === "error" ? "✕" : "!"}</span><span>${esc(c.message)}</span>
      ${!c.ok && c.fix ? `<span class="fix">${esc(c.fix)}</span>` : ""}</li>`).join("");
}
// The device lock (lock.js): Face ID / fingerprint / screen lock before Minty shows anything here.
async function loadLock() {
    const el = $("lockState");
    if (!window.MintyLock) {
        el.textContent = "The device lock isn't available on this page.";
        return;
    }
    const st = await MintyLock.status();
    const say = {
        on: "Minty asks for Face ID, your fingerprint or the screen lock before it shows anything on this device.",
        off: "Minty isn't locked on this device.",
        unset: "Minty isn't locked on this device.",
        unavailable: "This device has no Face ID, fingerprint or screen-lock sign-in, so Minty isn't locked here.",
    }[st];
    const action = st === "on" ? "Turn off" : st === "unavailable" ? null : "Turn on";
    el.innerHTML = `${esc(say)}${action ? ` <button type="button" id="lockToggle">${action}</button>` : ""}`;
    $("lockToggle")?.addEventListener("click", async () => {
        try {
            await (st === "on" ? MintyLock.turnOff() : MintyLock.turnOn());
        }
        catch {
            el.insertAdjacentHTML("beforeend", ' <span class="lockerr">That didn\u2019t work. Try again.</span>');
            return;
        }
        loadLock();
    });
}
$("genKey").addEventListener("click", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
    $("genVal").textContent = key;
    $("genOut").hidden = false;
    $("genHow").hidden = false;
    $("genKey").textContent = "Generate another";
});
$("genCopy").addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText($("genVal").textContent);
        $("genCopy").textContent = "Copied";
    }
    catch {
        getSelection().selectAllChildren($("genVal"));
        $("genCopy").textContent = "Press Ctrl+C";
    }
    setTimeout(() => { $("genCopy").textContent = "Copy"; }, 1500);
});
loadStatus();
loadLock();
fetch('/users').then(r => r.json()).then(users => {
    $('connectionSlots').innerHTML = users.map(u => `<section><h3>${esc(u.label)}${u.archived ? ' (archived)' : ''}</h3><ul>${u.slots.map(s => `<li>${esc(s.slot)}: ${s.configured ? 'Configured' : 'Not configured (optional)'}<br><code>PLAID_CLIENT_ID_${esc(s.account.toUpperCase())}</code><br><code>PLAID_SECRET_${esc(s.account.toUpperCase())}</code></li>`).join('')}</ul></section>`).join('');
}).catch(() => { $('connectionSlots').textContent = 'Could not load configuration names.'; });
