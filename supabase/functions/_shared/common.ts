// Gedeelde hulpjes voor de serverfuncties.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ICloudCalendar } from "./caldav.js";
import { cancelMail, confirmationMail, ownerMail, reminderMail, sendMail } from "./mail.js";
import { freeSlots, localParts, localToUtc, openDates } from "./planning.js";

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

export function db(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export type Service = { id: string; name: string; minutes: number; price: number };
export type Settings = {
  studioName: string;
  address?: string;
  contactPhone?: string;
  services: Service[];
  hours: Record<string, [string, string]>;
  closedDates?: string[];
  step: number;
  showDays: number;
  minNoticeHours: number;
};

export async function getSettings(client: SupabaseClient): Promise<Settings> {
  const { data, error } = await client.from("settings").select("data").eq("id", 1).single();
  if (error) throw new Error("Instellingen niet gevonden: " + error.message);
  return data.data as Settings;
}

// ---------- iCloud ----------
export function icloudConfigured() {
  return Boolean(Deno.env.get("ICLOUD_USERNAME") && Deno.env.get("ICLOUD_APP_PASSWORD") && Deno.env.get("ICLOUD_CALENDAR"));
}

export function icloud() {
  return new ICloudCalendar({
    username: Deno.env.get("ICLOUD_USERNAME")!.trim(),
    password: Deno.env.get("ICLOUD_APP_PASSWORD")!.replace(/\s/g, ""),
  });
}

/** Namen van agenda's waarvan de bezette tijden meetellen. Standaard: de boekingsagenda. */
export function busyCalendarNames(): string[] {
  const extra = (Deno.env.get("ICLOUD_BUSY_CALENDARS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set([Deno.env.get("ICLOUD_CALENDAR")!.trim(), ...extra])];
}

export async function icloudBusy(from: Date, to: Date) {
  const client = icloud();
  const all = await client.calendars();
  const names = busyCalendarNames().map((n) => n.toLowerCase());
  const useAll = names.includes("*");
  const cals = all.filter((c) => useAll || names.includes(c.name.trim().toLowerCase()));
  const lists = await Promise.all(cals.map((c) => client.busy(c, from, to)));
  return lists.flat();
}

export async function bookingsBusy(client: SupabaseClient, from: Date, to: Date) {
  const { data, error } = await client.from("bookings").select("starts_at, ends_at")
    .eq("status", "confirmed").lt("starts_at", to.toISOString()).gt("ends_at", from.toISOString());
  if (error) throw new Error(error.message);
  return (data || []).map((b) => ({ start: new Date(b.starts_at), end: new Date(b.ends_at) }));
}

/** Vrije tijden per datum voor een behandeling. */
export async function availability(client: SupabaseClient, settings: Settings, service: Service, dates?: string[]) {
  const today = localParts(new Date()).date;
  const list = dates ?? openDates(settings, today, settings.showDays || 10);
  if (!list.length) return { days: [], icloud: "off" };
  const from = localToUtc(list[0], 0);
  const to = localToUtc(list[list.length - 1], 1440);
  const busy = await bookingsBusy(client, from, to);
  let icloudState = "off";
  if (icloudConfigured()) {
    try {
      busy.push(...(await icloudBusy(from, to)));
      icloudState = "ok";
    } catch (e) {
      console.error("iCloud lezen mislukt:", e);
      icloudState = "error";
    }
  }
  const earliest = new Date(Date.now() + (settings.minNoticeHours ?? 2) * 3600_000);
  const days = list.map((date) => ({
    date,
    slots: freeSlots({ settings, date, duration: service.minutes, busy, earliest }),
  }));
  return { days, icloud: icloudState };
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// ---------- e-mail ----------
export function mailConfig(settings?: Settings) {
  const apiKey = Deno.env.get("BREVO_API_KEY"), from = Deno.env.get("MAIL_FROM");
  if (!apiKey || !from) return null;
  return { apiKey: apiKey.trim(), from: from.trim(), fromName: settings?.studioName || "AA Lashstudio" };
}
export const studioEmail = () => (Deno.env.get("STUDIO_EMAIL") || Deno.env.get("MAIL_FROM") || "").trim();

// deno-lint-ignore no-explicit-any
type Booking = Record<string, any>;

/** Bevestiging naar de klant en melding naar de studio. Fouten worden bewaard, niet gegooid. */
export async function mailNewBooking(client: SupabaseClient, b: Booking, settings: Settings) {
  const cfg = mailConfig(settings);
  if (!cfg) return { customer: false, owner: false };
  const replyTo = studioEmail() || undefined;
  const c = confirmationMail(b, settings);
  const o = ownerMail(b, settings, Deno.env.get("SITE_URL"));
  const [r1, r2] = await Promise.allSettled([
    sendMail(cfg, { to: b.email, toName: b.name, subject: c.subject, html: c.html, ics: c.ics, replyTo }),
    studioEmail() ? sendMail(cfg, { to: studioEmail(), subject: o.subject, html: o.html, ics: o.ics, replyTo: b.email }) : Promise.reject(new Error("STUDIO_EMAIL ontbreekt")),
  ]);
  const now = new Date().toISOString();
  const errors = [r1, r2].filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message || r));
  errors.forEach((e) => console.error("Mail mislukt:", e));
  await client.from("bookings").update({
    confirmation_sent_at: r1.status === "fulfilled" ? now : null,
    owner_notified_at: r2.status === "fulfilled" ? now : null,
    mail_error: errors.length ? errors.join(" | ").slice(0, 500) : null,
  }).eq("id", b.id);
  return { customer: r1.status === "fulfilled", owner: r2.status === "fulfilled" };
}

export async function mailReminder(b: Booking, settings: Settings) {
  const cfg = mailConfig(settings);
  if (!cfg) throw new Error("E-mail is niet ingesteld");
  const m = reminderMail(b, settings);
  await sendMail(cfg, { to: b.email, toName: b.name, subject: m.subject, html: m.html, replyTo: studioEmail() || undefined });
}

export async function mailCancel(b: Booking, settings: Settings) {
  const cfg = mailConfig(settings);
  if (!cfg) return false;
  const m = cancelMail(b, settings);
  await sendMail(cfg, { to: b.email, toName: b.name, subject: m.subject, html: m.html, replyTo: studioEmail() || undefined });
  return true;
}

/** Geheime sleutel voor het agenda-abonnement (wordt eenmalig aangemaakt). */
export async function feedToken(client: SupabaseClient, reset = false) {
  if (!reset) {
    const { data } = await client.from("private_config").select("value").eq("key", "feed_token").maybeSingle();
    if (data?.value) return data.value as string;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
  await client.from("private_config").upsert({ key: "feed_token", value: token });
  return token;
}
