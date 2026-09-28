// GET /calendar-feed?token=...
// Agenda-abonnement met alle online afspraken. De studio-agenda heeft een knop
// "Abonneer in Apple Agenda" die deze link opent; daarna komen nieuwe afspraken vanzelf in je agenda.
import { db } from "../_shared/common.ts";

const esc = (s: string) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (d: string) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token") || "";
  const client = db();
  const { data: cfg } = await client.from("private_config").select("value").eq("key", "feed_token").maybeSingle();
  if (!cfg?.value || token.length < 20 || token !== cfg.value) return new Response("Deze agendalink is niet (meer) geldig.", { status: 403 });
  const since = new Date(Date.now() - 60 * 86400_000).toISOString();
  const { data } = await client.from("bookings").select("*").eq("status", "confirmed").gte("starts_at", since).order("starts_at");
  const { data: st } = await client.from("settings").select("data").eq("id", 1).single();
  const address = st?.data?.address || "";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AA Lashstudio//Afspraken//NL", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:AA Lashstudio afspraken", "X-WR-TIMEZONE:Europe/Amsterdam",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M",
  ];
  for (const b of data || []) {
    lines.push("BEGIN:VEVENT", `UID:boeking-${b.id}@aalashstudio`, `DTSTAMP:${utc(b.created_at)}`,
      `DTSTART:${utc(b.starts_at)}`, `DTEND:${utc(b.ends_at)}`, `SUMMARY:${esc(`${b.service_name} – ${b.name}`)}`,
      `DESCRIPTION:${esc(`Telefoon: ${b.phone}\nE-mail: ${b.email}${b.note ? `\nOpmerking: ${b.note}` : ""}\nPrijs: € ${b.price}`)}`,
      ...(address ? [`LOCATION:${esc(address)}`] : []),
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Afspraak", "TRIGGER:-PT30M", "END:VALARM",
      "END:VEVENT");
  }
  lines.push("END:VCALENDAR", "");
  return new Response(lines.join("\r\n"), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" },
  });
});
