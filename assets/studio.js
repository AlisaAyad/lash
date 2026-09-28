import { studioApi as api, DEMO } from "./api.js";
import { addDays, localParts, localToUtc, toHHMM, toMin, weekday } from "./planning.js";
import { downloadIcs } from "./ics.js";

const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const DAYS_L = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dnum = (d) => Number(d.slice(8, 10));
const mon = (d) => MONTHS[Number(d.slice(5, 7)) - 1];
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "behandeling";

const $ = (id) => document.getElementById(id);
const app = $("app");
const today = localParts(new Date()).date;
const mondayOf = (d) => addDays(d, -((weekday(d) + 6) % 7));

const S = { week: mondayOf(today), bookings: [], settings: null, draft: null, sel: null, confirm: false, notify: true, status: null, error: null, dirty: false, resetAsk: false };

if (DEMO) $("demo").hidden = false;

function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}

// ---------------------------------------------------------------- inloggen
function renderLogin(msg) {
  $("logout").hidden = true;
  app.innerHTML = `<form class="panel stack login" id="login">
    <h2>Inloggen</h2>
    <p class="muted" style="margin:0">Alleen voor AA Lashstudio.</p>
    ${msg ? `<div class="error" role="alert">${esc(msg)}</div>` : ""}
    ${DEMO ? "" : `<div class="field"><label for="lMail">E-mailadres</label><input id="lMail" type="email" autocomplete="username" required></div>
    <div class="field"><label for="lPass">Wachtwoord</label><input id="lPass" type="password" autocomplete="current-password" required></div>`}
    <button class="btn" type="submit" id="lBtn">${DEMO ? "Demo bekijken" : "Inloggen"}</button>
  </form>`;
  $("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("lBtn").disabled = true; $("lBtn").textContent = "Bezig…";
    try { await api.signIn($("lMail")?.value.trim(), $("lPass")?.value); await boot(); }
    catch (err) { renderLogin(err.message); }
  });
}

// ---------------------------------------------------------------- data
async function loadWeek() {
  const from = localToUtc(S.week, 0), to = localToUtc(addDays(S.week, 7), 0);
  try { S.bookings = await api.listBookings(from, to); S.error = null; }
  catch (e) { S.error = e.message; S.bookings = []; }
  render();
}

async function loadStatus() {
  try { S.status = await api.status(); } catch (e) { S.status = { error: e.message }; }
  render();
}

function bookingEvent(b) {
  return {
    uid: `boeking-${b.id}@aalashstudio`, start: b.starts_at, end: b.ends_at,
    summary: `${b.service_name} – ${b.name}`,
    description: `Telefoon: ${b.phone}\nE-mail: ${b.email}${b.note ? `\nOpmerking: ${b.note}` : ""}\nPrijs: € ${b.price}`,
    location: S.settings.address,
  };
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Link gekopieerd"); }
  catch { const i = document.getElementById("feedLink"); if (i) { i.select(); toast("Selecteer en kopieer de link"); } }
}

async function boot() {
  $("logout").hidden = false;
  app.innerHTML = `<div class="loading">Agenda laden</div>`;
  try {
    S.settings = await api.getSettings();
    S.draft = JSON.parse(JSON.stringify(S.settings));
  } catch (e) { app.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  await loadWeek();
  loadStatus();
}

// ---------------------------------------------------------------- weergave
function calendar() {
  const st = S.settings;
  const all = [...Array(7)].map((_, i) => addDays(S.week, i));
  const live = S.bookings.filter((b) => b.status === "confirmed");
  const days = all.filter((d) => st.hours[String(weekday(d))] || live.some((b) => localParts(new Date(b.starts_at)).date === d));
  if (!days.length) return `<div class="empty">Deze week is de studio gesloten.</div>`;
  const ranges = days.map((d) => st.hours[String(weekday(d))]).filter(Boolean).map((h) => [toMin(h[0]), toMin(h[1])]);
  live.forEach((b) => { const s = localParts(new Date(b.starts_at)), e = localParts(new Date(b.ends_at)); ranges.push([s.minutes, e.minutes || 1440]); });
  const minH = Math.floor(Math.min(...ranges.map((r) => r[0])) / 60), maxH = Math.ceil(Math.max(...ranges.map((r) => r[1])) / 60);
  const PX = 52, top0 = minH * 60, height = (maxH - minH) * PX, y = (m) => (m - top0) / 60 * PX;
  const nowP = localParts(new Date());
  const cols = days.map((d) => {
    const h = st.hours[String(weekday(d))];
    let closed = "";
    if (!h) closed = `<div class="closed" style="top:0;height:${height}px"></div>`;
    else {
      const [o, c] = [toMin(h[0]), toMin(h[1])];
      if (o > top0) closed += `<div class="closed" style="top:0;height:${y(o)}px"></div>`;
      if (c < maxH * 60) closed += `<div class="closed" style="top:${y(c)}px;height:${height - y(c)}px"></div>`;
    }
    const evs = live.filter((b) => localParts(new Date(b.starts_at)).date === d).map((b) => {
      const s = localParts(new Date(b.starts_at)).minutes, dur = (new Date(b.ends_at) - new Date(b.starts_at)) / 60000;
      return `<button class="ev online" data-ev="${b.id}" aria-pressed="${S.sel === b.id}" style="top:${y(s) + 1}px;height:${Math.max(dur / 60 * PX - 2, 20)}px"><b>${esc(b.name)}${b.icloud_error || b.mail_error ? " ⚠" : ""}</b><span class="mono">${toHHMM(s)}</span> · ${esc(b.service_name)}</button>`;
    }).join("");
    const nl = d === nowP.date && nowP.minutes > top0 && nowP.minutes < maxH * 60 ? `<div class="nowline" style="top:${y(nowP.minutes)}px"></div>` : "";
    return `<div class="col" style="height:${height}px;background-size:100% ${PX}px">${closed}${evs}${nl}</div>`;
  }).join("");
  const times = [...Array(maxH - minH)].map((_, i) => i ? `<div style="top:${i * PX}px" class="mono">${String(minH + i).padStart(2, "0")}:00</div>` : "").join("");
  return `<div class="calscroll"><div class="cal" style="--n:${days.length};min-width:${52 + days.length * 120}px">
    <div class="ch"></div>${days.map((d) => `<div class="ch${d === today ? " today" : ""}">${DAYS[weekday(d)]}<b>${dnum(d)}</b></div>`).join("")}
    <div class="times" style="height:${height}px">${times}</div>${cols}</div></div>`;
}

function detail() {
  const b = S.bookings.find((x) => x.id === S.sel);
  if (!b) return "";
  const s = localParts(new Date(b.starts_at)), e = localParts(new Date(b.ends_at));
  const cancelled = b.status === "cancelled";
  const chips = cancelled ? `<span class="chip grey">Geannuleerd</span>` : [
    b.confirmation_sent_at ? `<span class="chip">Bevestiging verstuurd</span>` : `<span class="chip warn">Geen bevestiging</span>`,
    b.reminder_sent_at ? `<span class="chip">Herinnering verstuurd</span>` : "",
    b.icloud_error ? `<span class="chip warn">Niet in iCloud</span>` : b.icloud_synced ? `<span class="chip">In iCloud</span>` : "",
  ].join(" ");
  return `<div class="panel detail">
    <div class="row" style="justify-content:space-between;margin-bottom:10px"><h3>${esc(b.service_name)} — ${esc(b.name)}</h3><div class="row" style="gap:6px">${chips}</div></div>
    <dl class="kv">
      <dt>Wanneer</dt><dd>${DAYS_L[weekday(s.date)]} ${dnum(s.date)} ${mon(s.date)}, <span class="mono">${toHHMM(s.minutes)} – ${toHHMM(e.minutes)}</span></dd>
      <dt>Telefoon</dt><dd class="mono">${esc(b.phone)}</dd>
      <dt>E-mail</dt><dd style="word-break:break-all">${esc(b.email)}</dd>
      ${b.note ? `<dt>Opmerking</dt><dd>${esc(b.note)}</dd>` : ""}
      <dt>Prijs</dt><dd class="mono">€ ${esc(b.price)}</dd>
      ${b.mail_error ? `<dt>E-mail</dt><dd class="muted">${esc(b.mail_error)}</dd>` : ""}
      ${b.icloud_error ? `<dt>iCloud</dt><dd class="muted">${esc(b.icloud_error)}</dd>` : ""}
    </dl>
    ${cancelled ? "" : S.confirm ? `<div class="stack" style="margin-top:14px;gap:10px">
        <span style="font-size:.9rem">Deze afspraak annuleren?</span>
        <label style="display:flex;gap:6px;align-items:center;font-size:.9rem"><input type="checkbox" id="notify" ${S.notify ? "checked" : ""}> ${esc(b.name.split(" ")[0])} een annuleringsmail sturen</label>
        <div class="row"><button class="btn danger sm" data-act="cancelYes">Ja, annuleren</button><button class="btn ghost sm" data-act="cancelNo">Nee</button></div></div>`
      : `<div class="row" style="margin-top:14px">
        <button class="btn sm" data-act="ics">Zet in Apple Agenda</button>
        <button class="btn ghost sm" data-act="resend">Bevestiging opnieuw sturen</button>
        ${b.icloud_error ? `<button class="btn ghost sm" data-act="resync">Opnieuw naar iCloud</button>` : ""}
        <button class="btn ghost sm" data-act="cancelAsk">Annuleren</button></div>`}
  </div>`;
}

function settingsPanel() {
  const d = S.draft;
  const opts = (v) => { let o = ""; for (let m = 360; m <= 1320; m += 30) o += `<option value="${toHHMM(m)}" ${toHHMM(m) === v ? "selected" : ""}>${toHHMM(m)}</option>`; return o; };
  const hrs = [1, 2, 3, 4, 5, 6, 0].map((w) => {
    const h = d.hours[String(w)];
    return `<span>${DAYS[w]}</span><label style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="open-${w}" data-open="${w}" ${h ? "checked" : ""}>open</label>
      <span class="pair">${h ? `<select id="from-${w}" data-from="${w}" aria-label="Open vanaf ${DAYS_L[w]}">${opts(h[0])}</select>–<select id="to-${w}" data-to="${w}" aria-label="Open tot ${DAYS_L[w]}">${opts(h[1])}</select>` : `<span class="muted">gesloten</span>`}</span>`;
  }).join("");
  const svcs = d.services.map((s, i) => `
    <input id="sn-${i}" data-sname="${i}" value="${esc(s.name)}" aria-label="Naam behandeling">
    <input id="sm-${i}" data-smin="${i}" type="number" min="15" step="15" value="${s.minutes}" aria-label="Minuten">
    <input id="sp-${i}" data-sprice="${i}" type="number" min="0" step="1" value="${s.price}" aria-label="Prijs in euro">`).join("");
  const closed = (d.closedDates || []).filter((x) => x >= today).sort();
  return `<div class="panel stack">
    <div class="row" style="justify-content:space-between"><h3>Instellingen</h3>${S.dirty ? `<span class="chip warn">Niet opgeslagen</span>` : ""}</div>
    <div class="field"><label for="sAddr">Adres (komt in de e-mails)</label><input id="sAddr" data-setting="address" value="${esc(d.address || "")}" placeholder="Straat 1, 1234 AB Plaats"></div>
    <div class="field"><label for="sPhone">Telefoon voor klanten</label><input id="sPhone" data-setting="contactPhone" type="tel" value="${esc(d.contactPhone || "")}" placeholder="06 12345678"></div>
    <div class="label">Openingstijden</div>
    <div class="hrs">${hrs}</div>
    <div class="label">Behandelingen</div>
    <div class="svc-edit"><span class="muted">Naam</span><span class="muted">Min.</span><span class="muted">€</span>${svcs}</div>
    <div class="row"><button class="btn ghost sm" data-act="addSvc">Behandeling toevoegen</button>${d.services.length > 1 ? `<button class="btn ghost sm" data-act="delSvc">Laatste verwijderen</button>` : ""}</div>
    <div class="label">Dagen dicht (vakantie)</div>
    <div class="row"><input id="closedIn" type="date" min="${today}" style="border:1px solid var(--line);border-radius:6px;padding:4px 6px"><button class="btn ghost sm" data-act="addClosed">Toevoegen</button></div>
    ${closed.length ? `<div class="list">${closed.map((x) => `<div class="item"><span>${DAYS_L[weekday(x)]} ${dnum(x)} ${mon(x)}</span><button class="btn ghost sm" data-delclosed="${x}">Weg</button></div>`).join("")}</div>` : ""}
    <div class="field"><label for="notice">Klanten kunnen boeken tot</label>
      <select id="notice" style="border:1px solid var(--line);border-radius:6px;padding:5px">${[0, 1, 2, 4, 12, 24, 48].map((h) => `<option value="${h}" ${d.minNoticeHours === h ? "selected" : ""}>${h === 0 ? "vlak van tevoren" : h + " uur van tevoren"}</option>`).join("")}</select></div>
    <button class="btn" data-act="save" ${S.dirty ? "" : "disabled"} style="align-self:flex-start">Opslaan</button>
  </div>`;
}

function linksPanel() {
  const r = S.status;
  if (!r) return `<div class="panel"><div class="loading">Koppelingen controleren</div></div>`;
  if (r.error) return `<div class="panel stack"><h3>Koppelingen</h3><div class="error">${esc(r.error)}</div><p class="muted" style="margin:0;font-size:.85rem">Staan de serverfuncties al online? Zie stap 4 in de handleiding.</p><button class="btn ghost sm" data-act="status" style="align-self:flex-start">Opnieuw proberen</button></div>`;
  const ic = r.icloud || {};
  return `<div class="panel stack">
    <h3>Agenda op je iPhone</h3>
    ${r.demo ? `<p class="muted" style="margin:0;font-size:.9rem">In de demomodus is er nog geen agendalink. Na het koppelen staat hier je knop.</p>` : `
    <p style="margin:0;font-size:.9rem">Abonneer één keer. Daarna verschijnt elke nieuwe afspraak vanzelf in Apple Agenda, en verdwijnt hij weer als je annuleert.</p>
    <a class="btn" href="${esc(r.webcalUrl)}" style="text-align:center;text-decoration:none">Abonneer in Apple Agenda</a>
    <div class="row" style="gap:6px;flex-wrap:nowrap"><input id="feedLink" readonly value="${esc(r.feedUrl)}" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:.78rem;background:var(--surface-2)" aria-label="Agendalink"><button class="btn ghost sm" data-act="copyFeed">Kopieer</button></div>
    <details><summary>Werkt de knop niet?</summary><p>iPhone: Instellingen › Agenda › Accounts › Voeg account toe › Andere › Voeg agenda-abonnement toe, en plak de link. Mac: Agenda › Archief › Nieuw agenda-abonnement. Zet "Vernieuw" op elke 15 minuten of elke 5 minuten.</p>
    ${S.resetAsk ? `<div class="row" style="margin-top:8px"><span style="font-size:.85rem">Oude link stopt met werken.</span><button class="btn danger sm" data-act="feedResetYes">Nieuwe link maken</button><button class="btn ghost sm" data-act="feedResetNo">Nee</button></div>` : `<button class="btn ghost sm" data-act="feedReset" style="margin-top:8px">Nieuwe link maken</button>`}</details>`}
    <div class="row" style="justify-content:space-between;margin-top:6px"><h3>E-mail</h3>${r.mail?.ok ? `<span class="chip">Aan</span>` : `<span class="chip warn">Uit</span>`}</div>
    <p style="margin:0;font-size:.88rem">${esc(r.mail?.message || "")}</p>
    ${r.mail?.ok ? `<p class="muted" style="margin:0;font-size:.82rem">Klanten krijgen een bevestiging en een dag van tevoren een herinnering. Jij krijgt bij elke boeking een melding.</p>` : ""}
    ${ic.configured ? `<div class="row" style="justify-content:space-between;margin-top:6px"><h3>iCloud direct</h3>${ic.ok ? `<span class="chip">Verbonden</span>` : `<span class="chip warn">Fout</span>`}</div><p style="margin:0;font-size:.88rem">${esc(ic.message)}</p>` : ""}
  </div>`;
}

function render() {
  const end = addDays(S.week, 6);
  const live = S.bookings.filter((b) => b.status === "confirmed");
  const mins = live.reduce((a, b) => a + (new Date(b.ends_at) - new Date(b.starts_at)) / 60000, 0);
  const omzet = live.reduce((a, b) => a + Number(b.price || 0), 0);
  const problems = live.filter((b) => b.icloud_error || b.mail_error);
  const upcoming = live.filter((b) => new Date(b.ends_at) > new Date());
  app.innerHTML = `<div class="grid-bedrijf">
    <section>
      <div class="calhead">
        <div><div class="label">Studio-agenda</div><h2>${dnum(S.week)} ${mon(S.week)} – ${dnum(end)} ${mon(end)} ${end.slice(0, 4)}</h2></div>
        <div class="row"><button class="btn ghost sm" data-act="prev" aria-label="Vorige week">←</button><button class="btn ghost sm" data-act="thisweek">Deze week</button><button class="btn ghost sm" data-act="next" aria-label="Volgende week">→</button></div>
      </div>
      ${S.error ? `<div class="error" style="margin-bottom:14px">${esc(S.error)}</div>` : ""}
      <div class="panel stat" style="margin-bottom:14px;padding:14px 20px">
        <div><span class="label">Afspraken</span><b class="mono">${live.length}</b></div>
        <div><span class="label">Uren</span><b class="mono">${(mins / 60).toFixed(1).replace(".", ",")}</b></div>
        <div><span class="label">Omzet</span><b class="mono">€ ${omzet}</b></div>
        <div><span class="label">Nog te gaan</span><b class="mono">${upcoming.length}</b></div>
      </div>
      ${problems.length ? `<div class="error" style="margin-bottom:14px">Bij ${problems.length} afspraak${problems.length > 1 ? "en" : ""} deze week ging iets mis met e-mail of iCloud. Klik erop voor details.</div>` : ""}
      ${calendar()}
      <div class="legend"><span><i style="background:var(--ev-bg);border:1px solid var(--ev-line)"></i>Online geboekt</span><span><i style="background:repeating-linear-gradient(135deg,var(--busy-soft) 0 3px,transparent 3px 6px);border:1px solid var(--line)"></i>Gesloten</span></div>
      ${detail()}
    </section>
    <aside class="stack">${linksPanel()}${settingsPanel()}</aside>
  </div>`;
}

// ---------------------------------------------------------------- acties
app.addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.ev) { S.sel = t.dataset.ev; S.confirm = false; render(); return; }
  if (t.dataset.delclosed) { S.draft.closedDates = S.draft.closedDates.filter((x) => x !== t.dataset.delclosed); S.dirty = true; render(); return; }
  const a = t.dataset.act; if (!a) return;
  if (a === "prev") { S.week = addDays(S.week, -7); S.sel = null; return loadWeek(); }
  if (a === "next") { S.week = addDays(S.week, 7); S.sel = null; return loadWeek(); }
  if (a === "thisweek") { S.week = mondayOf(today); S.sel = null; return loadWeek(); }
  if (a === "cancelAsk") { S.confirm = true; return render(); }
  if (a === "cancelNo") { S.confirm = false; return render(); }
  if (a === "cancelYes") {
    t.disabled = true;
    const notify = $("notify")?.checked ?? false; S.notify = notify;
    try { const r = await api.cancel(S.sel, notify); toast(r.mailed ? "Geannuleerd en klant gemaild" : "Afspraak geannuleerd"); }
    catch (err) { toast(err.message); }
    S.confirm = false; return loadWeek();
  }
  if (a === "ics") { const b = S.bookings.find((x) => x.id === S.sel); if (b) downloadIcs(`afspraak-${b.name}.ics`, [bookingEvent(b)]); return; }
  if (a === "resend") { t.disabled = true; try { await api.resend(S.sel); toast("Bevestiging verstuurd"); } catch (err) { toast(err.message); } return loadWeek(); }
  if (a === "copyFeed") return copy(S.status.feedUrl);
  if (a === "status") { S.status = null; render(); return loadStatus(); }
  if (a === "feedReset") { S.resetAsk = true; return render(); }
  if (a === "feedResetNo") { S.resetAsk = false; return render(); }
  if (a === "feedResetYes") { S.resetAsk = false; try { S.status = await api.feedReset(); toast("Nieuwe link gemaakt. Abonneer opnieuw."); } catch (err) { toast(err.message); } return render(); }
  if (a === "resync") { t.disabled = true; try { await api.resync(S.sel); toast("Afspraak staat nu in iCloud"); } catch (err) { toast(err.message); } return loadWeek(); }
  if (a === "addSvc") { S.draft.services.push({ id: "", name: "Nieuwe behandeling", minutes: 30, price: 0 }); S.dirty = true; return render(); }
  if (a === "delSvc") { S.draft.services.pop(); S.dirty = true; return render(); }
  if (a === "addClosed") { const v = $("closedIn").value; if (v) { S.draft.closedDates = [...new Set([...(S.draft.closedDates || []), v])]; S.dirty = true; render(); } return; }
  if (a === "save") {
    const d = S.draft;
    for (const s of d.services) {
      s.name = s.name.trim(); s.minutes = Number(s.minutes); s.price = Number(s.price);
      if (!s.name || !(s.minutes >= 15)) { toast("Geef elke behandeling een naam en minstens 15 minuten."); return; }
      if (!s.id) { let id = slug(s.name), n = 2; while (d.services.some((x) => x !== s && x.id === id)) id = slug(s.name) + "-" + n++; s.id = id; }
    }
    d.closedDates = (d.closedDates || []).filter((x) => x >= today);
    d.address = (d.address || "").trim(); d.contactPhone = (d.contactPhone || "").trim();
    t.disabled = true;
    try { await api.saveSettings(d); S.settings = JSON.parse(JSON.stringify(d)); S.dirty = false; toast("Opgeslagen. Klanten zien de wijziging meteen."); }
    catch (err) { toast(err.message); }
    return render();
  }
});

app.addEventListener("change", (e) => {
  const t = e.target, d = S.draft; if (!d) return;
  if (t.dataset.open != null) { const w = t.dataset.open; if (t.checked) d.hours[w] = ["11:00", "19:00"]; else delete d.hours[w]; S.dirty = true; return render(); }
  if (t.dataset.from != null) { const w = t.dataset.from; if (toMin(t.value) < toMin(d.hours[w][1])) d.hours[w][0] = t.value; S.dirty = true; return render(); }
  if (t.dataset.to != null) { const w = t.dataset.to; if (toMin(t.value) > toMin(d.hours[w][0])) d.hours[w][1] = t.value; S.dirty = true; return render(); }
  if (t.id === "notice") { d.minNoticeHours = Number(t.value); S.dirty = true; return render(); }
});

app.addEventListener("input", (e) => {
  const t = e.target, d = S.draft; if (!d) return;
  const mark = () => { if (!S.dirty) { S.dirty = true; const btn = app.querySelector('[data-act="save"]'); if (btn) btn.disabled = false; } };
  if (t.dataset.setting) { d[t.dataset.setting] = t.value; mark(); }
  if (t.dataset.sname != null) { d.services[t.dataset.sname].name = t.value; mark(); }
  if (t.dataset.smin != null) { d.services[t.dataset.smin].minutes = Number(t.value); mark(); }
  if (t.dataset.sprice != null) { d.services[t.dataset.sprice].price = Number(t.value); mark(); }
});

$("logout").addEventListener("click", async () => { await api.signOut(); renderLogin(); });

window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

(async function start() {
  const s = await api.session().catch(() => null);
  if (s) boot(); else renderLogin();
})();
