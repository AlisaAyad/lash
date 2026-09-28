// Stuurt herinneringen voor afspraken die binnen 24 uur beginnen.
// Wordt elk uur aangeroepen door de database (zie supabase/herinneringen.sql).
// Veilig om vaker aan te roepen: elke klant krijgt maximaal één herinnering.
import { cors, db, getSettings, json, mailConfig, mailReminder } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const client = db();
    const settings = await getSettings(client);
    if (!mailConfig(settings)) return json({ sent: 0, message: "E-mail is niet ingesteld." });
    const now = Date.now();
    const { data } = await client.from("bookings").select("*")
      .eq("status", "confirmed").is("reminder_sent_at", null)
      .gt("starts_at", new Date(now + 60 * 60_000).toISOString())
      .lte("starts_at", new Date(now + 24 * 3600_000).toISOString());
    let sent = 0;
    const failed: string[] = [];
    for (const b of data || []) {
      // Wie binnen een dag voor de afspraak boekte, heeft net een bevestiging gehad.
      if (new Date(b.starts_at).getTime() - new Date(b.created_at).getTime() < 24 * 3600_000) {
        await client.from("bookings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", b.id);
        continue;
      }
      // Eerst claimen, zodat een tweede aanroep dezelfde mail niet nog eens stuurt.
      const { data: claimed } = await client.from("bookings").update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", b.id).is("reminder_sent_at", null).select("id");
      if (!claimed?.length) continue;
      try { await mailReminder(b, settings); sent++; }
      catch (e) {
        failed.push(b.id);
        console.error("Herinnering mislukt:", e);
        await client.from("bookings").update({ reminder_sent_at: null, mail_error: String((e as Error).message || e).slice(0, 500) }).eq("id", b.id);
      }
    }
    return json({ sent, failed: failed.length });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
