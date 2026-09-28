// Minimale CalDAV-client voor iCloud Agenda (zonder externe bibliotheken).
// Inloggen gaat met je Apple ID en een app-specifiek wachtwoord.
import { localToUtc, localParts, addDays, weekday, TZ } from "./planning.js";

const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"';

// ---------- kleine XML-hulpjes (iCloud gebruikt wisselende voorvoegsels) ----------
const unesc = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, "&");

export function tag(xml, name) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?=[\\s/>])[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>)`, "i");
  const m = xml.match(re);
  return m ? (m[1] ?? "") : null;
}
export function responses(xml) {
  const re = /<(?:[\w.-]+:)?response(?=[\s>])[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi;
  return [...xml.matchAll(re)].map((m) => m[1]);
}
const href = (xml) => { const h = xml && tag(xml, "href"); return h ? unesc(h.trim()) : null; };

// ---------- iCalendar lezen ----------
function parseIcsDate(line) {
  const i = line.indexOf(":");
  const params = line.slice(0, i).toUpperCase();
  const v = line.slice(i + 1).trim();
  if (/^\d{8}$/.test(v) || params.includes("VALUE=DATE") && !params.includes("DATE-TIME")) {
    const d = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    return { date: localToUtc(d, 0), allDay: true, ymd: d };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)), allDay: false };
  // Lokale tijd: we gaan uit van Nederlandse tijd (TZID=Europe/Amsterdam of zwevend).
  return { date: localToUtc(`${y}-${mo}-${d}`, +h * 60 + +mi), allDay: false };
}
function parseDuration(v) {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, , w, d, h, mi, s] = m.map((x) => x ?? 0);
  return ((+w * 7 + +d) * 86400 + +h * 3600 + +mi * 60 + +s) * 1000;
}

const DAYMAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Eenvoudige herhaling (DAGELIJKS/WEKELIJKS) uitrollen, voor als de server dat niet zelf doet. */
function expandRule(start, durMs, rrule, exdates, from, to) {
  const r = Object.fromEntries(rrule.split(";").map((p) => p.split("=")));
  const freq = r.FREQ, interval = Number(r.INTERVAL || 1);
  if (freq !== "DAILY" && freq !== "WEEKLY") return [{ start, end: new Date(start.getTime() + durMs) }];
  const until = r.UNTIL ? parseIcsDate("X:" + r.UNTIL)?.date : null;
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const days = r.BYDAY ? r.BYDAY.split(",").map((x) => DAYMAP[x.slice(-2)]) : null;
  const first = localParts(start);
  const firstDow = weekday(first.date);
  const out = [];
  let n = 0;
  for (let i = 0; i < 3660 && n < count; i++) {
    const day = addDays(first.date, i);
    const s = localToUtc(day, first.minutes); // zelfde kloktijd, ook over zomer/wintertijd heen
    if (until && s > until) break;
    if (s > to) break;
    let hit;
    if (freq === "DAILY") hit = i % interval === 0;
    else {
      const week = Math.floor((i + ((firstDow + 6) % 7)) / 7); // weken tellen vanaf maandag
      hit = week % interval === 0 && (days ? days.includes(weekday(day)) : weekday(day) === firstDow);
    }
    if (!hit) continue;
    n++;
    if (exdates.some((x) => Math.abs(x - s) < 60000)) continue;
    const e = new Date(s.getTime() + durMs);
    if (e > from) out.push({ start: s, end: e });
  }
  return out;
}

/** Alle bezette blokken uit iCalendar-tekst. */
export function parseBusy(ics, from, to) {
  const text = ics.replace(/\r?\n[ \t]/g, "");
  const out = [];
  for (const m of text.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)) {
    const lines = m[1].split(/\r?\n/).filter(Boolean);
    const get = (n) => lines.find((l) => l.toUpperCase().startsWith(n + ":") || l.toUpperCase().startsWith(n + ";"));
    const val = (n) => { const l = get(n); return l ? l.slice(l.indexOf(":") + 1).trim() : null; };
    if ((val("STATUS") || "").toUpperCase() === "CANCELLED") continue;
    if ((val("TRANSP") || "").toUpperCase() === "TRANSPARENT") continue;
    const ds = get("DTSTART") && parseIcsDate(get("DTSTART"));
    if (!ds) continue;
    let end;
    const de = get("DTEND") && parseIcsDate(get("DTEND"));
    if (de) end = de.date;
    else if (val("DURATION")) end = new Date(ds.date.getTime() + parseDuration(val("DURATION")));
    else end = ds.allDay ? localToUtc(addDays(ds.ymd, 1), 0) : ds.date;
    const dur = end - ds.date;
    if (dur <= 0) continue;
    const rrule = val("RRULE");
    if (rrule && !get("RECURRENCE-ID")) {
      const ex = lines.filter((l) => l.toUpperCase().startsWith("EXDATE"))
        .flatMap((l) => l.slice(l.indexOf(":") + 1).split(",").map((v) => parseIcsDate("X:" + v)?.date).filter(Boolean));
      out.push(...expandRule(ds.date, dur, rrule, ex, from, to));
    } else {
      out.push({ start: ds.date, end });
    }
  }
  return out.filter((b) => b.end > from && b.start < to);
}

// ---------- iCalendar schrijven ----------
const icsEsc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsUtc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = " " + rest.slice(74); }
  out.push(rest);
  return out.join("\r\n");
}

export function eventIcs({ uid, start, end, summary, description, location }) {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AA Lashstudio//Online boeken//NL", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsEsc(summary)}`,
    description ? `DESCRIPTION:${icsEsc(description)}` : null,
    location ? `LOCATION:${icsEsc(location)}` : null,
    "STATUS:CONFIRMED", "TRANSP:OPAQUE",
    "END:VEVENT", "END:VCALENDAR", "",
  ].filter((x) => x !== null).map(fold).join("\r\n");
}

// ---------- de client ----------
const range = (d) => icsUtc(d);

export class ICloudCalendar {
  constructor({ username, password, baseUrl = "https://caldav.icloud.com/" }) {
    this.auth = "Basic " + btoa(`${username}:${password}`);
    this.base = baseUrl;
  }

  async req(method, url, body, headers = {}, soft = false) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: this.auth, "Content-Type": "application/xml; charset=utf-8", ...headers },
      body,
      redirect: "follow",
    });
    if (!soft && (res.status === 401 || res.status === 403)) {
      throw new Error("iCloud weigert de inloggegevens. Controleer je Apple ID en het app-specifieke wachtwoord.");
    }
    return res;
  }

  async propfind(url, depth, props) {
    const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop>${props}</d:prop></d:propfind>`;
    const res = await this.req("PROPFIND", url, body, { Depth: String(depth) });
    const text = await res.text();
    if (res.status !== 207 && !res.ok) throw new Error(`iCloud gaf fout ${res.status} bij PROPFIND`);
    return { text, url: res.url || url };
  }

  async discover() {
    if (this.home) return this.home;
    const a = await this.propfind(this.base, 0, "<d:current-user-principal/>");
    const p = href(tag(a.text, "current-user-principal"));
    if (!p) throw new Error("Kon je iCloud-account niet vinden (geen principal).");
    const principal = new URL(p, a.url).href;
    const b = await this.propfind(principal, 0, "<c:calendar-home-set/>");
    const h = href(tag(b.text, "calendar-home-set"));
    if (!h) throw new Error("Kon de agenda-map van je iCloud-account niet vinden.");
    this.home = new URL(h, b.url).href;
    if (!this.home.endsWith("/")) this.home += "/";
    return this.home;
  }

  async calendars() {
    const home = await this.discover();
    const r = await this.propfind(home, 1, "<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/>");
    const out = [];
    for (const resp of responses(r.text)) {
      const rt = tag(resp, "resourcetype") || "";
      if (!/<(?:[\w.-]+:)?calendar(?=[\s/>])/i.test(rt)) continue;
      const comps = tag(resp, "supported-calendar-component-set");
      if (comps && comps.trim() && !/VEVENT/i.test(comps)) continue;
      let url = new URL(href(resp), r.url).href;
      if (!url.endsWith("/")) url += "/";
      out.push({ url, name: unesc((tag(resp, "displayname") || "").trim()) });
    }
    return out;
  }

  async calendar(name) {
    const all = await this.calendars();
    const want = name.trim().toLowerCase();
    const c = all.find((x) => x.name.trim().toLowerCase() === want);
    if (!c) throw new Error(`Agenda "${name}" niet gevonden in iCloud. Wel gevonden: ${all.map((x) => `"${x.name}"`).join(", ") || "geen"}.`);
    return c;
  }

  /** Bezette blokken in één agenda tussen from en to (Date). */
  async busy(cal, from, to) {
    const tr = `<c:time-range start="${range(from)}" end="${range(to)}"/>`;
    const q = (expand) => `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query ${NS}>
  <d:prop><c:calendar-data>${expand ? `<c:expand start="${range(from)}" end="${range(to)}"/>` : ""}</c:calendar-data></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">${tr}</c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
    let res = await this.req("REPORT", cal.url, q(true), { Depth: "1" }, true);
    if (res.status >= 400) res = await this.req("REPORT", cal.url, q(false), { Depth: "1" });
    const text = await res.text();
    if (res.status >= 400) throw new Error(`iCloud gaf fout ${res.status} bij het ophalen van afspraken`);
    const out = [];
    for (const resp of responses(text)) {
      const data = tag(resp, "calendar-data");
      if (data) out.push(...parseBusy(unesc(data), from, to));
    }
    return out;
  }

  /** Afspraak toevoegen. Geeft de URL van de afspraak terug. */
  async add(cal, uid, ics) {
    const url = cal.url + encodeURIComponent(uid) + ".ics";
    const res = await this.req("PUT", url, ics, { "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*" });
    if (!res.ok) throw new Error(`iCloud gaf fout ${res.status} bij het toevoegen van de afspraak`);
    return url;
  }

  async remove(url) {
    const res = await this.req("DELETE", url, undefined, {});
    if (!res.ok && res.status !== 404) throw new Error(`iCloud gaf fout ${res.status} bij het verwijderen`);
  }
}

export { TZ };
