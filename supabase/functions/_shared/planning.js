// Planningslogica: vrije tijden berekenen in Nederlandse tijd.
// Dit bestand staat twee keer in het project (server en website) en is identiek.
//   supabase/functions/_shared/planning.js
//   assets/planning.js
// Pas je iets aan? Doe het dan in beide.

export const TZ = "Europe/Amsterdam";

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Datum ("2026-09-29") en minuten sinds middernacht in Nederlandse tijd. */
export function localParts(d) {
  const p = {};
  for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Nederlandse datum + minuten omzetten naar een echt tijdstip (Date, UTC). */
export function localToUtc(date, minutes) {
  const [y, m, d] = date.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, 0, minutes);
  let t = target;
  for (let i = 0; i < 3; i++) {
    const lp = localParts(new Date(t));
    const [yy, mm, dd] = lp.date.split("-").map(Number);
    const seen = Date.UTC(yy, mm - 1, dd, 0, lp.minutes);
    if (seen === target) break;
    t += target - seen;
  }
  return new Date(t);
}

export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

/** 0 = zondag ... 6 = zaterdag */
export function weekday(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
export const toHHMM = (min) => String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");

/** Openingstijden van een datum als [open, dicht] in minuten, of null. */
export function hoursFor(settings, date) {
  const exc = settings.closedDates || [];
  if (exc.includes(date)) return null;
  const h = settings.hours[String(weekday(date))];
  return h ? [toMin(h[0]), toMin(h[1])] : null;
}

/** De eerstvolgende `count` datums waarop de studio open is, vanaf `from`. */
export function openDates(settings, from, count, maxDays = 120) {
  const out = [];
  for (let i = 0; i < maxDays && out.length < count; i++) {
    const d = addDays(from, i);
    if (hoursFor(settings, d)) out.push(d);
  }
  return out;
}

/**
 * Bezette intervallen (echte tijdstippen) omzetten naar minuten op één Nederlandse datum.
 * busy: [{start: Date, end: Date}]
 */
export function busyOnDate(busy, date) {
  const out = [];
  for (const b of busy) {
    const s = localParts(b.start), e = localParts(b.end);
    if (e.date < date || s.date > date) continue;
    if (e.date === date && e.minutes === 0 && s.date < date) continue;
    const from = s.date < date ? 0 : s.minutes;
    const to = e.date > date ? 1440 : e.minutes;
    if (to > from) out.push([from, to]);
  }
  return out;
}

/**
 * Vrije starttijden (minuten) op een datum.
 * earliest: Date; tijden die eerder beginnen worden overgeslagen.
 */
export function freeSlots({ settings, date, duration, busy, earliest }) {
  const h = hoursFor(settings, date);
  if (!h) return [];
  const step = settings.step || 30;
  const blocks = busyOnDate(busy, date);
  const out = [];
  for (let t = h[0]; t + duration <= h[1]; t += step) {
    if (earliest && localToUtc(date, t) < earliest) continue;
    if (blocks.some(([a, b]) => t < b && t + duration > a)) continue;
    out.push(t);
  }
  return out;
}
