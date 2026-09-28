// E-mails versturen via Brevo (gratis tot 300 mails per dag) en de teksten van de mails.
import { eventIcs } from "./caldav.js";
import { localParts, toHHMM, weekday } from "./planning.js";

const DAYS_L = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const MONTHS_L = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function when(b) {
  const s = localParts(new Date(b.starts_at)), e = localParts(new Date(b.ends_at));
  const [, m, d] = s.date.split("-").map(Number);
  return {
    day: `${DAYS_L[weekday(s.date)]} ${d} ${MONTHS_L[m - 1]}`,
    time: `${toHHMM(s.minutes)} – ${toHHMM(e.minutes)}`,
    start: toHHMM(s.minutes),
  };
}

const b64 = (s) => { let bin = ""; for (const x of new TextEncoder().encode(s)) bin += String.fromCharCode(x); return btoa(bin); };

/** Stuur een mail. cfg: { apiKey, from, fromName } */
export async function sendMail(cfg, { to, toName, subject, html, replyTo, ics }) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": cfg.apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { email: cfg.from, name: cfg.fromName || "AA Lashstudio" },
      to: [{ email: to, name: toName || to }],
      replyTo: replyTo ? { email: replyTo } : undefined,
      subject,
      htmlContent: html,
      attachment: ics ? [{ name: "afspraak.ics", content: b64(ics) }] : undefined,
    }),
  });
  if (!res.ok) throw new Error(`E-mail niet verstuurd (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

// ---------------------------------------------------------------- opmaak
function layout(title, body, settings) {
  const footer = [settings.studioName || "AA Lashstudio", settings.address, settings.contactPhone].filter(Boolean).map(esc).join(" · ");
  return `<!doctype html><html lang="nl"><body style="margin:0;background:#fcf5f7;font-family:Helvetica,Arial,sans-serif;color:#3b2b33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fcf5f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #f0dfe6;border-radius:16px">
<tr><td style="padding:28px 28px 8px;font-family:Georgia,serif;font-size:24px;color:#3b2b33">${esc(settings.studioName || "AA Lashstudio")}</td></tr>
<tr><td style="padding:0 28px 8px;font-size:20px;font-weight:bold;color:#d94f86">${esc(title)}</td></tr>
<tr><td style="padding:8px 28px 28px;font-size:15px;line-height:1.55">${body}</td></tr>
</table>
<p style="font-size:12px;color:#8c7882;margin:14px 0 0">${footer}</p>
</td></tr></table></body></html>`;
}

function card(b) {
  const w = when(b);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#fdf0f5;border-radius:12px;margin:14px 0">
<tr><td style="padding:14px 16px;font-size:15px;line-height:1.6">
<b>${esc(b.service_name)}</b><br>${esc(w.day)}<br>${esc(w.time)}${b.price != null ? `<br>€ ${esc(b.price)}` : ""}
</td></tr></table>`;
}

const first = (name) => esc(String(name || "").trim().split(/\s+/)[0]);
const contact = (s) => s.contactPhone ? ` Bel of app ons op <b>${esc(s.contactPhone)}</b>.` : " Beantwoord deze mail.";
const address = (s) => s.address ? `<p style="margin:0 0 10px">Adres: ${esc(s.address)}</p>` : "";

export function customerIcs(b, settings) {
  return eventIcs({
    uid: `klant-${b.id}@aalashstudio`, start: new Date(b.starts_at), end: new Date(b.ends_at),
    summary: `${b.service_name} bij ${settings.studioName || "AA Lashstudio"}`,
    description: settings.contactPhone ? `Vragen of verzetten: ${settings.contactPhone}` : "", location: settings.address,
  });
}
export function ownerIcs(b, settings) {
  return eventIcs({
    uid: `boeking-${b.id}@aalashstudio`, start: new Date(b.starts_at), end: new Date(b.ends_at),
    summary: `${b.service_name} – ${b.name}`,
    description: `Telefoon: ${b.phone}\nE-mail: ${b.email}${b.note ? `\nOpmerking: ${b.note}` : ""}\nPrijs: € ${b.price}`,
    location: settings.address,
  });
}

export function confirmationMail(b, s) {
  return {
    subject: `Je afspraak bij ${s.studioName || "AA Lashstudio"} staat vast – ${when(b).day} ${when(b).start}`,
    html: layout("Je afspraak staat vast", `<p style="margin:0 0 10px">Hoi ${first(b.name)},</p>
<p style="margin:0 0 10px">Bedankt voor je boeking. Tot dan!</p>${card(b)}${address(s)}
<p style="margin:0 0 10px"><b>Voorbereiding:</b> kom met schone wimpers, zonder mascara of make-up rond je ogen. Draag je lenzen, neem dan je lenzendoosje mee.</p>
<p style="margin:0 0 10px">Kun je niet komen? Laat het ons minstens 24 uur van tevoren weten.${contact(s)}</p>
<p style="margin:0;color:#8c7882;font-size:13px">In de bijlage zit de afspraak voor je agenda.</p>`, s),
    ics: customerIcs(b, s),
  };
}

export function reminderMail(b, s) {
  return {
    subject: `Herinnering: morgen om ${when(b).start} je ${b.service_name.toLowerCase()}`,
    html: layout("Tot morgen!", `<p style="margin:0 0 10px">Hoi ${first(b.name)},</p>
<p style="margin:0 0 10px">Een korte herinnering aan je afspraak van morgen.</p>${card(b)}${address(s)}
<p style="margin:0 0 10px">Kom met schone wimpers, zonder mascara.</p>
<p style="margin:0">Lukt het toch niet?${contact(s)}</p>`, s),
  };
}

export function cancelMail(b, s) {
  return {
    subject: `Je afspraak van ${when(b).day} is geannuleerd`,
    html: layout("Afspraak geannuleerd", `<p style="margin:0 0 10px">Hoi ${first(b.name)},</p>
<p style="margin:0 0 10px">Je afspraak hieronder is geannuleerd.</p>${card(b)}
<p style="margin:0">Je kunt altijd een nieuwe afspraak maken via onze website.${s.contactPhone ? ` Vragen? Bel of app ${esc(s.contactPhone)}.` : ""}</p>`, s),
  };
}

export function ownerMail(b, s, siteUrl) {
  const w = when(b);
  return {
    subject: `Nieuwe afspraak: ${b.name} – ${w.day} ${w.start}`,
    html: layout("Nieuwe afspraak", `<p style="margin:0 0 10px">Er is zojuist online geboekt.</p>${card(b)}
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.7">
<tr><td style="color:#8c7882;padding-right:14px">Naam</td><td>${esc(b.name)}</td></tr>
<tr><td style="color:#8c7882;padding-right:14px">Telefoon</td><td>${esc(b.phone)}</td></tr>
<tr><td style="color:#8c7882;padding-right:14px">E-mail</td><td>${esc(b.email)}</td></tr>
${b.note ? `<tr><td style="color:#8c7882;padding-right:14px">Opmerking</td><td>${esc(b.note)}</td></tr>` : ""}
</table>
<p style="margin:14px 0 0;font-size:14px">Tik op de bijlage <b>afspraak.ics</b> om hem in je agenda te zetten.${siteUrl ? ` Of bekijk alles in de <a href="${esc(siteUrl.replace(/\/$/, ""))}/studio.html" style="color:#d94f86">studio-agenda</a>.` : ""}</p>`, s),
    ics: ownerIcs(b, s),
  };
}
