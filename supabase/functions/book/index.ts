// POST /book  { service, date, time, name, email, phone, note }
// Controleert of de tijd nog vrij is, slaat de afspraak op, mailt klant en studio
// en zet hem (als dat is ingesteld) direct in iCloud.
import { availability, cors, db, getSettings, icloud, icloudConfigured, isEmail, json, mailNewBooking } from "../_shared/common.ts";
import { eventIcs } from "../_shared/caldav.js";
import { localToUtc, toHHMM } from "../_shared/planning.js";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Alleen POST." }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (body.website) return json({ error: "Ongeldige aanvraag." }, 400); // spamval
    const name = String(body.name ?? "").trim().slice(0, 80);
    const email = String(body.email ?? "").trim().slice(0, 120);
    const phone = String(body.phone ?? "").trim().slice(0, 30);
    const note = String(body.note ?? "").trim().slice(0, 500);
    const date = String(body.date ?? "");
    const time = Number(body.time);
    if (!name || !isEmail(email) || phone.replace(/\D/g, "").length < 8) {
      return json({ error: "Vul je naam, een geldig e-mailadres en telefoonnummer in." }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(time)) return json({ error: "Kies een datum en tijd." }, 400);

    const client = db();
    const settings = await getSettings(client);
    const service = settings.services.find((s) => s.id === body.service);
    if (!service) return json({ error: "Onbekende behandeling." }, 400);

    const { days } = await availability(client, settings, service, [date]);
    if (!days[0]?.slots.includes(time)) {
      return json({ error: "Deze tijd is net door iemand anders geboekt. Kies een andere tijd.", code: "taken" }, 409);
    }

    const start = localToUtc(date, time);
    const end = new Date(start.getTime() + service.minutes * 60_000);
    const { data: row, error } = await client.from("bookings").insert({
      service_id: service.id, service_name: service.name, price: service.price,
      starts_at: start.toISOString(), ends_at: end.toISOString(),
      name, email, phone, note: note || null,
    }).select("*").single();
    if (error) {
      if (error.code === "23P01") return json({ error: "Deze tijd is net door iemand anders geboekt. Kies een andere tijd.", code: "taken" }, 409);
      throw error;
    }

    let synced = false;
    if (icloudConfigured()) {
      try {
        const cal = icloud();
        const target = await cal.calendar(Deno.env.get("ICLOUD_CALENDAR")!);
        const uid = `boeking-${row.id}@aalashstudio`;
        const url = await cal.add(target, uid, eventIcs({
          uid, start, end,
          summary: `${service.name} – ${name}`,
          description: `Telefoon: ${phone}\nE-mail: ${email}${note ? `\nOpmerking: ${note}` : ""}\nPrijs: € ${service.price}\nGeboekt via de website`,
          location: settings.address,
        }));
        await client.from("bookings").update({ caldav_url: url, icloud_synced: true, icloud_error: null }).eq("id", row.id);
        synced = true;
      } catch (e) {
        console.error("iCloud schrijven mislukt:", e);
        await client.from("bookings").update({ icloud_error: String((e as Error).message || e) }).eq("id", row.id);
      }
    }

    const mailed = await mailNewBooking(client, row, settings).catch((e) => { console.error(e); return { customer: false, owner: false }; });

    return json({ id: row.id, date, time: toHHMM(time), end: toHHMM(time + service.minutes), service: service.name, synced, mailed: mailed.customer, email });
  } catch (e) {
    console.error(e);
    return json({ error: "Er ging iets mis bij het boeken. Probeer het opnieuw of neem contact op met de studio." }, 500);
  }
});
