// POST /studio  (alleen voor ingelogde studio-beheerders)
//   { action: "status" }                 -> welke koppelingen werken, plus de link voor het agenda-abonnement
//   { action: "feed-reset" }             -> nieuwe abonnementslink (de oude werkt dan niet meer)
//   { action: "cancel", id, notify }     -> afspraak annuleren (en de klant mailen als notify=true)
//   { action: "resync", id }             -> afspraak opnieuw naar iCloud sturen
//   { action: "resend", id }             -> bevestigingsmail opnieuw sturen
import { cors, db, feedToken, getSettings, icloud, icloudConfigured, json, mailCancel, mailConfig, mailNewBooking, studioEmail } from "../_shared/common.ts";
import { eventIcs } from "../_shared/caldav.js";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const client = db();
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await client.auth.getUser(jwt);
    if (!u?.user) return json({ error: "Log opnieuw in." }, 401);
    const { data: admin } = await client.from("admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
    if (!admin) return json({ error: "Dit account heeft geen toegang tot de studio." }, 403);

    const body = await req.json().catch(() => ({}));
    const settings = await getSettings(client);
    const base = Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "");

    if (body.action === "status" || body.action === "feed-reset") {
      const token = await feedToken(client, body.action === "feed-reset");
      const feed = `${base}/functions/v1/calendar-feed?token=${token}`;
      const mail = mailConfig(settings)
        ? { ok: true, message: `Bevestigingen gaan vanaf ${Deno.env.get("MAIL_FROM")}. Meldingen van nieuwe afspraken gaan naar ${studioEmail()}.` }
        : { ok: false, message: "E-mail is nog niet ingesteld. Vul BREVO_API_KEY en MAIL_FROM in bij de Secrets van Supabase." };
      let ic: Record<string, unknown> = { configured: false };
      if (icloudConfigured()) {
        try {
          const cals = await icloud().calendars();
          const want = Deno.env.get("ICLOUD_CALENDAR")!.trim().toLowerCase();
          const found = cals.some((c) => c.name.trim().toLowerCase() === want);
          ic = { configured: true, ok: found, message: found ? `Afspraken gaan direct in iCloud-agenda "${Deno.env.get("ICLOUD_CALENDAR")}".` : `Agenda "${Deno.env.get("ICLOUD_CALENDAR")}" niet gevonden. Wel: ${cals.map((c) => c.name).join(", ")}` };
        } catch (e) {
          ic = { configured: true, ok: false, message: String((e as Error).message || e) };
        }
      }
      return json({ feedUrl: feed, webcalUrl: feed.replace(/^https?:/, "webcal:"), mail, icloud: ic });
    }

    const { data: b } = await client.from("bookings").select("*").eq("id", body.id).maybeSingle();
    if (!b) return json({ error: "Afspraak niet gevonden." }, 404);

    if (body.action === "cancel") {
      await client.from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", b.id);
      let removed = true, mailed = false;
      if (b.caldav_url && icloudConfigured()) {
        try { await icloud().remove(b.caldav_url); } catch (e) { removed = false; console.error(e); }
      }
      if (body.notify) {
        try { mailed = await mailCancel(b, settings); } catch (e) { console.error(e); }
      }
      return json({ ok: true, removedFromIcloud: removed, mailed });
    }

    if (body.action === "resend") {
      const r = await mailNewBooking(client, b, settings);
      if (!r.customer) return json({ error: "Versturen is niet gelukt. Controleer de e-mailinstellingen." }, 500);
      return json({ ok: true });
    }

    if (body.action === "resync") {
      if (!icloudConfigured()) return json({ error: "iCloud is niet ingesteld." }, 400);
      const cal = icloud();
      const target = await cal.calendar(Deno.env.get("ICLOUD_CALENDAR")!);
      const uid = `boeking-${b.id}@aalashstudio`;
      if (b.caldav_url) { try { await cal.remove(b.caldav_url); } catch (_) { /* bestaat misschien niet meer */ } }
      const url = await cal.add(target, uid, eventIcs({
        uid, start: new Date(b.starts_at), end: new Date(b.ends_at),
        summary: `${b.service_name} – ${b.name}`,
        description: `Telefoon: ${b.phone}\nE-mail: ${b.email}${b.note ? `\nOpmerking: ${b.note}` : ""}\nPrijs: € ${b.price}`,
        location: settings.address,
      }));
      await client.from("bookings").update({ caldav_url: url, icloud_synced: true, icloud_error: null }).eq("id", b.id);
      return json({ ok: true });
    }

    return json({ error: "Onbekende actie." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
