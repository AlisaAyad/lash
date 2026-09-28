import { api, DEMO } from "./api.js";
import { localParts, localToUtc, toHHMM, weekday } from "./planning.js";
import { downloadIcs } from "./ics.js";

const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const DAYS_L = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayNum = (d) => Number(d.slice(8, 10));
const month = (d) => MONTHS[Number(d.slice(5, 7)) - 1];
const longDate = (d) => `${DAYS_L[weekday(d)]} ${dayNum(d)} ${month(d)}`;
const euro = (n) => `€ ${Number(n).toLocaleString("nl-NL", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })}${Number.isInteger(n) ? ",-" : ""}`;

const $ = (id) => document.getElementById(id);
const flow = $("flow");
const S = { settings: null, svc: null, days: null, date: null, time: null, done: null, error: null, loading: false, form: {} };

if (DEMO) $("demo").hidden = false;

function renderAside() {
  const st = S.settings;
  if (st.address) { $("address").textContent = st.address; $("address").hidden = false; }
  $("prices").innerHTML = st.services.map((s) => `<div class="item"><span>${esc(s.name)} <span class="muted">· ${s.minutes} min</span></span><span class="mono">${euro(s.price)}</span></div>`).join("");
  const today = weekday(localParts(new Date()).date);
  $("hours").innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const h = st.hours[String(d)];
    const c = d === today ? ' class="today"' : "";
    return `<span${c}>${DAYS_L[d]}</span><span class="mono${d === today ? " today" : ""}">${h ? `${h[0]} – ${h[1]}` : "gesloten"}</span>`;
  }).join("");
}

function steps(n) {
  return `<div class="steps">${["Behandeling", "Datum en tijd", "Gegevens", "Bevestigd"].map((l, i) =>
    `<span class="${i + 1 === n ? "on" : i + 1 < n ? "done" : ""}">${i + 1}. ${l}</span>`).join("")}</div>`;
}

function render() {
  const st = S.settings;
  const err = S.error ? `<div class="error" role="alert" style="margin-bottom:14px">${esc(S.error)}</div>` : "";

  if (S.done) {
    const x = S.done;
    flow.innerHTML = `${steps(4)}<div class="success">
      <div class="check" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M5 11.5l4 4 8-9" stroke="#d94f86" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <h2>Je afspraak staat vast</h2>
      <div class="summary"><span><b>${esc(x.service)}</b></span><span>${longDate(x.date)}</span><span class="mono">${x.time} – ${x.end}</span></div>
      ${x.mailed ? `<p style="margin:0">We hebben een bevestiging gestuurd naar <b>${esc(x.email)}</b>. Een dag van tevoren krijg je een herinnering.</p>` : ""}
      <p class="muted" style="margin:0">Kom met schone wimpers zonder mascara. Kun je niet komen? Laat het de studio minstens 24 uur van tevoren weten.</p>
      <div class="row"><button class="btn" data-act="ics">Zet in mijn agenda</button><button class="btn ghost" data-act="again">Nog een afspraak maken</button></div>
    </div>`;
    return;
  }

  if (!S.svc) {
    flow.innerHTML = `${steps(1)}${err}<h3 style="margin-bottom:12px">Welke behandeling wil je?</h3>
      <div class="services">${st.services.map((s) => `<button class="svc" data-svc="${esc(s.id)}"><span><span class="n">${esc(s.name)}</span><br><span class="d">${s.minutes} minuten</span></span><span class="mono">${euro(s.price)}</span></button>`).join("")}</div>`;
    return;
  }

  const svc = S.svc;
  if (S.time == null) {
    const back = `<button class="btn ghost sm" data-act="backSvc" style="margin-bottom:14px">← Andere behandeling</button>`;
    if (S.loading || !S.days) { flow.innerHTML = `${steps(2)}${back}${err}<div class="loading">Vrije tijden zoeken</div>`; return; }
    const days = S.days;
    if (!S.date || !days.find((d) => d.date === S.date && d.slots.length)) S.date = days.find((d) => d.slots.length)?.date || null;
    const slots = S.date ? days.find((d) => d.date === S.date).slots : [];
    const groups = [["Ochtend", 0, 720], ["Middag", 720, 1020], ["Avond", 1020, 1440]];
    flow.innerHTML = `${steps(2)}${back}${err}
      <div class="row" style="justify-content:space-between;margin-bottom:12px"><h3>Kies een datum</h3><span class="muted" style="font-size:.85rem">${esc(svc.name)} · ${svc.minutes} min</span></div>
      ${days.length ? `<div class="days" role="group" aria-label="Datum">${days.map((d) => `<button class="day" data-date="${d.date}" ${d.slots.length ? "" : "disabled"} aria-pressed="${d.date === S.date}"><span class="dw">${DAYS[weekday(d.date)]}</span><span class="dn">${dayNum(d.date)}</span><span class="dw" style="font-size:.65rem">${month(d.date)}</span><span class="dc">${d.slots.length ? d.slots.length + " vrij" : "vol"}</span></button>`).join("")}</div>` : ""}
      <h3 style="margin:18px 0 10px">Vrije tijden</h3>
      ${slots.length ? groups.map(([g, a, z]) => { const l = slots.filter((t) => t >= a && t < z); return l.length ? `<div class="label" style="margin:10px 0 6px">${g}</div><div class="slots">${l.map((t) => `<button class="slot" data-time="${t}">${toHHMM(t)}</button>`).join("")}</div>` : ""; }).join("")
        : `<div class="empty">Er zijn op dit moment geen vrije tijden. Probeer het later nog eens.</div>`}`;
    return;
  }

  const f = S.form;
  flow.innerHTML = `${steps(3)}${err}<h3 style="margin-bottom:12px">Jouw gegevens</h3>
    <div class="summary" style="margin-bottom:16px"><span><b>${esc(svc.name)}</b></span><span>${longDate(S.date)}</span><span class="mono">${toHHMM(S.time)} – ${toHHMM(S.time + svc.minutes)}</span><span class="mono">${euro(svc.price)}</span><button class="btn ghost sm" data-act="backTime" style="margin-left:auto">Wijzig</button></div>
    <form id="bookForm" class="form" novalidate>
      <div class="field"><label for="fName">Naam</label><input id="fName" name="name" required autocomplete="name" value="${esc(f.name)}"></div>
      <div class="field"><label for="fPhone">Telefoonnummer</label><input id="fPhone" name="phone" type="tel" required autocomplete="tel" value="${esc(f.phone)}"></div>
      <div class="field full"><label for="fMail">E-mailadres</label><input id="fMail" name="email" type="email" required autocomplete="email" value="${esc(f.email)}"></div>
      <div class="field full"><label for="fNote">Opmerking (optioneel)</label><input id="fNote" name="note" placeholder="Bijv. eerste keer lashlift" value="${esc(f.note)}"></div>
      <div class="hp" aria-hidden="true"><label for="fWeb">Laat leeg</label><input id="fWeb" name="website" tabindex="-1" autocomplete="off"></div>
      <div class="full row"><button class="btn" type="submit" id="submitBtn" ${S.loading ? "disabled" : ""}>${S.loading ? "Bezig met boeken…" : "Afspraak bevestigen"}</button><span class="muted" style="font-size:.85rem">Betalen doe je in de studio.</span></div>
    </form>`;
}

async function loadAvailability() {
  S.loading = true; S.days = null; S.error = null; render();
  try {
    const r = await api.getAvailability(S.svc.id);
    S.settings = r.settings; renderAside();
    S.svc = r.service; S.days = r.days;
  } catch (e) { S.error = e.message; S.days = []; }
  S.loading = false; render();
}

flow.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.svc) { S.svc = S.settings.services.find((s) => s.id === b.dataset.svc); S.date = null; S.time = null; loadAvailability(); return; }
  if (b.dataset.date) { S.date = b.dataset.date; render(); return; }
  if (b.dataset.time) { S.time = Number(b.dataset.time); S.error = null; render(); $("fName")?.focus(); return; }
  const a = b.dataset.act;
  if (a === "backSvc") { S.svc = null; S.days = null; S.error = null; render(); }
  if (a === "backTime") { S.time = null; S.error = null; render(); }
  if (a === "ics" && S.done) {
    const x = S.done, st = S.settings;
    downloadIcs("afspraak-aa-lashstudio.ics", [{ uid: `klant-${x.id}@aalashstudio`, start: x.startIso, end: x.endIso,
      summary: `${x.service} bij ${st.studioName || "AA Lashstudio"}`, description: st.contactPhone ? `Vragen of verzetten: ${st.contactPhone}` : "", location: st.address, alarm: "-PT2H" }]);
  }
  if (a === "again") { S.done = null; S.svc = null; S.days = null; S.time = null; S.date = null; render(); }
});

flow.addEventListener("input", (e) => { if (e.target.name) S.form[e.target.name] = e.target.value; });

flow.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  S.form = { ...S.form, ...fd };
  if (!fd.name.trim()) { S.error = "Vul je naam in."; render(); return; }
  if (fd.phone.replace(/\D/g, "").length < 8) { S.error = "Vul een geldig telefoonnummer in."; render(); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fd.email.trim())) { S.error = "Vul een geldig e-mailadres in."; render(); return; }
  S.loading = true; S.error = null; render();
  try {
    const startDate = localToUtc(S.date, S.time);
    S.done = await api.book({ service: S.svc.id, date: S.date, time: S.time, name: fd.name.trim(), phone: fd.phone.trim(), email: fd.email.trim(), note: fd.note.trim(), website: fd.website });
    S.done.startIso = startDate.toISOString();
    S.done.endIso = new Date(startDate.getTime() + S.svc.minutes * 60000).toISOString();
    S.loading = false; S.time = null; render();
  } catch (err) {
    S.loading = false;
    if (err.code === "taken") { S.time = null; S.error = err.message; await loadAvailability(); S.error = err.message; render(); }
    else { S.error = err.message; render(); }
  }
});

(async function start() {
  try {
    S.settings = await api.getSettings();
    renderAside(); render();
  } catch (e) {
    flow.innerHTML = `<div class="error" role="alert">${esc(e.message || "De agenda kon niet worden geladen.")}</div>`;
  }
})();

