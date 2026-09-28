import { api, DEMO } from "./api.js";
import { localToUtc, toHHMM, weekday } from "./planning.js";
import { downloadIcs } from "./ics.js";

const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const DAYS_L = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MONTHS_L = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayNum = (d) => Number(d.slice(8, 10));
const mon = (d) => MONTHS[Number(d.slice(5, 7)) - 1];
const longDate = (d) => `${DAYS_L[weekday(d)]} ${dayNum(d)} ${MONTHS_L[Number(d.slice(5, 7)) - 1]}`;
const euro = (n) => Number.isInteger(Number(n)) ? `€ ${n}` : `€ ${Number(n).toFixed(2).replace(".", ",")}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ICON_CLOCK = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M7 3.8V7l2.2 1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
const ICON_PIN = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 12.5s4-3.6 4-6.6A4 4 0 0 0 3 5.9c0 3 4 6.6 4 6.6Z" stroke="currentColor" stroke-width="1.2"/><circle cx="7" cy="5.8" r="1.4" stroke="currentColor" stroke-width="1.2"/></svg>`;
const ICON_ARROW = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 2.5 9.5 7 5 11.5" stroke="#d94f86" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_BACK = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const flow = document.getElementById("flow");
const S = { settings: null, svc: null, days: null, date: null, time: null, done: null, error: null, loading: false, form: {} };
if (DEMO) document.getElementById("demo").hidden = false;

/** "Dinsdag en vrijdag · 11:00 – 19:00" */
function hoursText(hours) {
  const groups = new Map();
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    const h = hours[String(d)];
    if (!h) continue;
    const k = `${h[0]} – ${h[1]}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(DAYS_L[d]);
  }
  return [...groups].map(([t, ds]) => {
    const names = ds.length > 1 ? ds.slice(0, -1).join(", ") + " en " + ds.at(-1) : ds[0];
    return `${cap(names)} · ${t}`;
  }).join("<br>");
}

function stepbar(n, back) {
  return `<div class="stepbar">
    <button class="back" data-act="${back}" aria-label="Terug">${ICON_BACK}</button>
    <div class="progress"><small>Stap ${n} van 3</small><div class="track"><i style="width:${Math.round(n / 3 * 100)}%"></i></div></div>
  </div>`;
}

function render() {
  const st = S.settings;
  document.getElementById("brand").hidden = !S.svc && !S.done;
  const err = S.error ? `<div class="error" role="alert">${esc(S.error)}</div>` : "";

  // Bevestigd
  if (S.done) {
    const x = S.done;
    flow.innerHTML = `<section class="view done">
      <div class="check"><svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true"><path d="M6.5 13.5 11 18l8.5-10" stroke="#d94f86" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <h2>Tot snel!</h2>
      <p>${x.mailed ? `Je afspraak staat vast. De bevestiging is onderweg naar <b>${esc(x.email)}</b>, en een dag van tevoren krijg je een herinnering.` : "Je afspraak staat vast."}</p>
      <dl class="summary">
        <dt>Behandeling</dt><dd>${esc(x.service)}</dd>
        <dt>Datum</dt><dd>${cap(longDate(x.date))}</dd>
        <dt>Tijd</dt><dd>${x.time} – ${x.end}</dd>
      </dl>
      <p style="font-size:.9rem">Kom met schone wimpers, zonder mascara. Kun je niet? Laat het ons minstens 24 uur van tevoren weten.</p>
      <div class="stack">
        <button class="btn" data-act="ics">Zet in mijn agenda</button>
        <button class="btn ghost" data-act="again">Nog een afspraak maken</button>
      </div>
    </section>`;
    return;
  }

  // Welkom + behandeling kiezen
  if (!S.svc) {
    flow.innerHTML = `<section class="view">
      <div class="hero">
        <div class="eyebrow">Lash lifting · op afspraak</div>
        <h1>${esc(st.studioName || "AA Lashstudio")}</h1>
        <p>Kies je behandeling en plan direct een moment dat jou uitkomt.</p>
        <div class="info">
          <span>${ICON_CLOCK}<span>${hoursText(st.hours)}</span></span>
          ${st.address ? `<span>${ICON_PIN}<span>${esc(st.address)}</span></span>` : ""}
        </div>
      </div>
      ${err}
      <p class="label">Kies je behandeling</p>
      <div class="services">${st.services.map((s) => `
        <button class="svc" data-svc="${esc(s.id)}">
          <span class="txt"><span class="n">${esc(s.name)}</span><span class="d">${s.minutes} minuten</span></span>
          <span class="p num">${euro(s.price)}</span>
          <span class="go">${ICON_ARROW}</span>
        </button>`).join("")}
      </div>
    </section>`;
    return;
  }

  const svc = S.svc;
  const chosen = `<div class="chosen"><b>${esc(svc.name)}</b><span class="num">${svc.minutes} min · ${euro(svc.price)}</span></div>`;

  // Datum en tijd
  if (S.time == null) {
    if (S.loading || !S.days) {
      flow.innerHTML = `<section class="view">${stepbar(1, "home")}${chosen}${err}<div class="loading">Vrije tijden zoeken</div></section>`;
      return;
    }
    const days = S.days;
    if (!S.date || !days.find((d) => d.date === S.date && d.slots.length)) S.date = days.find((d) => d.slots.length)?.date || null;
    const slots = S.date ? days.find((d) => d.date === S.date).slots : [];
    const groups = [["Ochtend", 0, 720], ["Middag", 720, 1020], ["Avond", 1020, 1440]];
    flow.innerHTML = `<section class="view">${stepbar(1, "home")}${chosen}${err}
      <h2>Wanneer wil je komen?</h2>
      ${days.length ? `<div class="days" role="group" aria-label="Datum">${days.map((d) => `
        <button class="day" data-date="${d.date}" ${d.slots.length ? "" : "disabled"} aria-pressed="${d.date === S.date}" aria-label="${longDate(d.date)}${d.slots.length ? "" : ", vol"}">
          <span class="dw">${DAYS[weekday(d.date)]}</span><span class="dn">${dayNum(d.date)}</span><span class="dm">${d.slots.length ? mon(d.date) : "vol"}</span>
        </button>`).join("")}</div>` : ""}
      ${slots.length ? groups.map(([g, a, z]) => {
        const l = slots.filter((t) => t >= a && t < z);
        return l.length ? `<h3>${g}</h3><div class="slots">${l.map((t) => `<button class="slot" data-time="${t}">${toHHMM(t)}</button>`).join("")}</div>` : "";
      }).join("") : `<div class="empty" style="margin-top:18px">Er zijn op dit moment geen vrije tijden. Probeer het later nog eens.</div>`}
    </section>`;
    return;
  }

  // Gegevens
  const f = S.form;
  flow.innerHTML = `<section class="view">${stepbar(2, "backTime")}
    <h2 style="margin-top:14px">Bijna klaar</h2>
    <dl class="summary">
      <dt>Behandeling</dt><dd>${esc(svc.name)}</dd>
      <dt>Datum</dt><dd>${cap(longDate(S.date))}</dd>
      <dt>Tijd</dt><dd>${toHHMM(S.time)} – ${toHHMM(S.time + svc.minutes)}</dd>
      <dt>Prijs</dt><dd>${euro(svc.price)}</dd>
    </dl>
    ${err}
    <form id="bookForm" novalidate>
      <div class="field"><label for="fName">Naam</label><input id="fName" name="name" required autocomplete="name" value="${esc(f.name)}"></div>
      <div class="field"><label for="fPhone">Telefoonnummer</label><input id="fPhone" name="phone" type="tel" required autocomplete="tel" inputmode="tel" value="${esc(f.phone)}"></div>
      <div class="field"><label for="fMail">E-mailadres</label><input id="fMail" name="email" type="email" required autocomplete="email" inputmode="email" value="${esc(f.email)}"></div>
      <div class="field"><label for="fNote">Opmerking <span style="color:var(--muted);font-weight:400">(optioneel)</span></label><input id="fNote" name="note" placeholder="Bijv. eerste keer lashlift" value="${esc(f.note)}"></div>
      <div class="hp" aria-hidden="true"><label for="fWeb">Laat leeg</label><input id="fWeb" name="website" tabindex="-1" autocomplete="off"></div>
      <button class="btn" type="submit" id="submitBtn" ${S.loading ? "disabled" : ""}>${S.loading ? "Bezig met boeken…" : "Afspraak bevestigen"}</button>
      <p class="note">Betalen doe je in de studio.</p>
    </form>
  </section>`;
}

async function loadAvailability() {
  S.loading = true; S.days = null; S.error = null; render();
  try {
    const r = await api.getAvailability(S.svc.id);
    S.settings = r.settings; S.svc = r.service; S.days = r.days;
  } catch (e) { S.error = e.message; S.days = []; }
  S.loading = false; render();
}

const top = () => window.scrollTo({ top: 0, behavior: "smooth" });

flow.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.svc) { S.svc = S.settings.services.find((s) => s.id === b.dataset.svc); S.date = null; S.time = null; top(); loadAvailability(); return; }
  if (b.dataset.date) { S.date = b.dataset.date; render(); return; }
  if (b.dataset.time) { S.time = Number(b.dataset.time); S.error = null; render(); top(); return; }
  const a = b.dataset.act;
  if (a === "home") { S.svc = null; S.days = null; S.error = null; render(); top(); }
  if (a === "backTime") { S.time = null; S.error = null; render(); top(); }
  if (a === "again") { S.done = null; S.svc = null; S.days = null; S.time = null; S.date = null; render(); top(); }
  if (a === "ics" && S.done) {
    const x = S.done, st = S.settings;
    downloadIcs("afspraak-aa-lashstudio.ics", [{ uid: `klant-${x.id}@aalashstudio`, start: x.startIso, end: x.endIso,
      summary: `${x.service} bij ${st.studioName || "AA Lashstudio"}`, description: st.contactPhone ? `Vragen of verzetten: ${st.contactPhone}` : "", location: st.address, alarm: "-PT2H" }]);
  }
});

flow.addEventListener("input", (e) => { if (e.target.name) S.form[e.target.name] = e.target.value; });

flow.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  S.form = { ...S.form, ...fd };
  if (!fd.name.trim()) { S.error = "Vul je naam in."; return render(); }
  if (fd.phone.replace(/\D/g, "").length < 8) { S.error = "Vul een geldig telefoonnummer in."; return render(); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fd.email.trim())) { S.error = "Vul een geldig e-mailadres in."; return render(); }
  S.loading = true; S.error = null; render();
  try {
    const startDate = localToUtc(S.date, S.time);
    S.done = await api.book({ service: S.svc.id, date: S.date, time: S.time, name: fd.name.trim(), phone: fd.phone.trim(), email: fd.email.trim(), note: fd.note.trim(), website: fd.website });
    S.done.startIso = startDate.toISOString();
    S.done.endIso = new Date(startDate.getTime() + S.svc.minutes * 60000).toISOString();
    S.loading = false; S.time = null; render(); top();
  } catch (err) {
    S.loading = false;
    if (err.code === "taken") { S.time = null; await loadAvailability(); S.error = err.message; render(); }
    else { S.error = err.message; render(); }
  }
});

(async function start() {
  try { S.settings = await api.getSettings(); render(); }
  catch (e) { flow.innerHTML = `<div class="error" role="alert">${esc(e.message || "De agenda kon niet worden geladen.")}</div>`; }
})();
