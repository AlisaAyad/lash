// GET /availability                 -> studiogegevens, behandelingen en openingstijden
// GET /availability?service=<id>    -> daarnaast de vrije tijden voor de komende open dagen
import { availability, cors, db, getSettings, json } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const client = db();
    const settings = await getSettings(client);
    const serviceId = new URL(req.url).searchParams.get("service");
    if (!serviceId) return json({ settings });
    const service = settings.services.find((s) => s.id === serviceId);
    if (!service) return json({ error: "Onbekende behandeling." }, 400);
    const { days, icloud } = await availability(client, settings, service);
    return json({ settings, service, days, icloud });
  } catch (e) {
    console.error(e);
    return json({ error: "De agenda kon niet worden geladen. Probeer het zo nog eens." }, 500);
  }
});
