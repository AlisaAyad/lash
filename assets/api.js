// Verbinding met de server (Supabase). Zonder instellingen in config.js
// draait alles in demomodus met voorbeeldgegevens in de browser.
import { CONFIG } from "./config.js";
import { freeSlots, localParts, localToUtc, openDates, toHHMM, addDays } from "./planning.js";

export const DEMO = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY;

class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// ------------------------------------------------------------------ echt
const fnUrl = (name) => `${CONFIG.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${name}`;

async function call(name, { method = "GET", body, query = "", token } = {}) {
  let res;
  try {
    res = await fetch(fnUrl(name) + query, {
      method,
      headers: {
        apikey: CONFIG.SUPABASE_KEY,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Geen verbinding. Controleer je internet en probeer het opnieuw.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Er ging iets mis (${res.status}).`, data.code);
  return data;
}

const real = {
  getSettings: () => call("availability").then((d) => d.settings),
  getAvailability: (serviceId) => call("availability", { query: `?service=${encodeURIComponent(serviceId)}` }),
  book: (payload) => call("book", { method: "POST", body: payload }),
};

let sb = null;
function supa() {
  if (!sb) sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
  return sb;
}
const realStudio = {
  async session() { const { data } = await supa().auth.getSession(); return data.session; },
  async signIn(email, password) {
    const { data, error } = await supa().auth.signInWithPassword({ email, password });
    if (error) throw new ApiError("Inloggen mislukt. Controleer je e-mailadres en wachtwoord.");
    const { data: a } = await supa().from("admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
    if (!a) { await supa().auth.signOut(); throw new ApiError("Dit account heeft geen toegang tot de studio."); }
    return data.session;
  },
  signOut: () => supa().auth.signOut(),
  async getSettings() {
    const { data, error } = await supa().from("settings").select("data").eq("id", 1).single();
    if (error) throw new ApiError(error.message);
    return data.data;
  },
  async saveSettings(settings) {
    const { error } = await supa().from("settings").update({ data: settings, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw new ApiError("Opslaan mislukt: " + error.message);
  },
  async listBookings(from, to) {
    const { data, error } = await supa().from("bookings").select("*")
      .gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).order("starts_at");
    if (error) throw new ApiError(error.message);
    return data;
  },
  async action(body) {
    const s = await this.session();
    return call("studio", { method: "POST", body, token: s?.access_token });
  },
  cancel(id, notify) { return this.action({ action: "cancel", id, notify }); },
  resync(id) { return this.action({ action: "resync", id }); },
  resend(id) { return this.action({ action: "resend", id }); },
  status() { return this.action({ action: "status" }); },
  feedReset() { return this.action({ action: "feed-reset" }); },
};

// ------------------------------------------------------------------ demo
const DEFAULT_SETTINGS = {
  studioName: "AA Lashstudio",
  address: "",
  contactPhone: "",
  services: [
    { id: "lashlift-zonder-tint", name: "Lashlift zonder tint", minutes: 45, price: 35 },
    { id: "lashlift-met-tint", name: "Lashlift met tint", minutes: 60, price: 40 },
  ],
  hours: { "2": ["11:00", "19:00"], "5": ["11:00", "19:00"] },
  closedDates: [],
  step: 30,
  showDays: 10,
  minNoticeHours: 2,
};

const demo = (() => {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const bookings = [];
  const icloud = [];
  const names = ["Sanne de Vries", "Yasmin Bakker", "Emma Visser", "Lina El Amrani", "Julia Smit", "Noor Meijer", "Tess Mulder", "Aylin Demir"];
  let seed = 11;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const today = localParts(new Date()).date;
  const monday = addDays(today, -((new Date(today).getUTCDay() + 6) % 7));
  for (const date of openDates(settings, monday, 12)) {
    icloud.push({ start: localToUtc(date, 14 * 60), end: localToUtc(date, 14 * 60 + 30), title: "Pauze" });
    for (let i = 0; i < 4; i++) {
      const svc = settings.services[Math.floor(rnd() * 2)];
      const t = 11 * 60 + Math.floor(rnd() * 14) * 30;
      const s = localToUtc(date, t), e = new Date(s.getTime() + svc.minutes * 60000);
      if (t + svc.minutes > 19 * 60) continue;
      if ([...bookings, ...icloud.map((x) => ({ starts_at: x.start.toISOString(), ends_at: x.end.toISOString(), status: "confirmed" }))]
        .some((b) => b.status === "confirmed" && s < new Date(b.ends_at) && e > new Date(b.starts_at))) continue;
      const name = names[Math.floor(rnd() * names.length)];
      bookings.push({
        id: crypto.randomUUID(), created_at: new Date().toISOString(), service_id: svc.id, service_name: svc.name, price: svc.price,
        starts_at: s.toISOString(), ends_at: e.toISOString(), name, email: name.toLowerCase().replace(/ /g, ".") + "@voorbeeld.nl",
        phone: "06 " + (10000000 + Math.floor(rnd() * 89999999)), note: null, status: "confirmed", icloud_synced: false, icloud_error: null,
        confirmation_sent_at: new Date().toISOString(), owner_notified_at: new Date().toISOString(), reminder_sent_at: null, mail_error: null,
      });
    }
  }
  const busyList = () => [
    ...bookings.filter((b) => b.status === "confirmed").map((b) => ({ start: new Date(b.starts_at), end: new Date(b.ends_at) })),
    ...icloud,
  ];
  const wait = (v) => new Promise((r) => setTimeout(() => r(v), 250));
  const avail = (svc, dates) => {
    const earliest = new Date(Date.now() + settings.minNoticeHours * 3600000);
    const list = dates || openDates(settings, localParts(new Date()).date, settings.showDays);
    return list.map((date) => ({ date, slots: freeSlots({ settings, date, duration: svc.minutes, busy: busyList(), earliest }) }));
  };
  return {
    api: {
      getSettings: () => wait(JSON.parse(JSON.stringify(settings))),
      getAvailability: (id) => {
        const svc = settings.services.find((s) => s.id === id);
        return wait({ settings, service: svc, days: avail(svc), icloud: "ok" });
      },
      async book(p) {
        await wait();
        const svc = settings.services.find((s) => s.id === p.service);
        if (!avail(svc, [p.date])[0].slots.includes(p.time)) throw new ApiError("Deze tijd is net door iemand anders geboekt. Kies een andere tijd.", "taken");
        const s = localToUtc(p.date, p.time), e = new Date(s.getTime() + svc.minutes * 60000);
        const b = { id: crypto.randomUUID(), created_at: new Date().toISOString(), service_id: svc.id, service_name: svc.name, price: svc.price,
          starts_at: s.toISOString(), ends_at: e.toISOString(), name: p.name, email: p.email, phone: p.phone, note: p.note || null,
          status: "confirmed", icloud_synced: false, icloud_error: null,
          confirmation_sent_at: new Date().toISOString(), owner_notified_at: new Date().toISOString(), reminder_sent_at: null, mail_error: null };
        bookings.push(b);
        return { id: b.id, date: p.date, time: toHHMM(p.time), end: toHHMM(p.time + svc.minutes), service: svc.name, synced: false, mailed: false, email: p.email };
      },
    },
    studio: {
      _in: false,
      session() { return Promise.resolve(this._in ? { demo: true } : null); },
      signIn() { this._in = true; return wait({ demo: true }); },
      signOut() { this._in = false; return Promise.resolve(); },
      getSettings: () => wait(JSON.parse(JSON.stringify(settings))),
      saveSettings: (s) => { Object.assign(settings, JSON.parse(JSON.stringify(s))); return wait(); },
      listBookings: (from, to) => wait(bookings.filter((b) => new Date(b.starts_at) >= from && new Date(b.starts_at) < to)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map((b) => ({ ...b }))),
      cancel: (id) => { const b = bookings.find((x) => x.id === id); if (b) { b.status = "cancelled"; b.cancelled_at = new Date().toISOString(); } return wait({ ok: true, removedFromIcloud: true, mailed: false }); },
      resync: () => wait({ ok: true }),
      resend: () => wait({ ok: true }),
      status: () => wait({ demo: true, feedUrl: "", webcalUrl: "", mail: { ok: false, message: "Demomodus: er worden nog geen e-mails verstuurd." }, icloud: { configured: false } }),
      feedReset() { return this.status(); },
    },
  };
})();

export const api = DEMO ? demo.api : real;
export const studioApi = DEMO ? demo.studio : realStudio;
