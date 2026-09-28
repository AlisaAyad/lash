-- AA Lashstudio – database opzetten
-- Plak dit hele bestand in Supabase > SQL Editor en klik op "Run".
-- Je kunt het veilig opnieuw draaien.

create extension if not exists btree_gist;

-- Instellingen (één rij): behandelingen, prijzen en openingstijden
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.settings (id, data) values (1, '{
  "studioName": "AA Lashstudio",
  "address": "",
  "contactPhone": "",
  "services": [
    { "id": "lashlift-zonder-tint", "name": "Lashlift zonder tint", "minutes": 45, "price": 35 },
    { "id": "lashlift-met-tint",    "name": "Lashlift met tint",    "minutes": 60, "price": 40 }
  ],
  "hours": { "2": ["11:00", "19:00"], "5": ["11:00", "19:00"] },
  "closedDates": [],
  "step": 30,
  "showDays": 10,
  "minNoticeHours": 2
}'::jsonb)
on conflict (id) do nothing;

-- Afspraken
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  service_id text not null,
  service_name text not null,
  price numeric,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  name text not null,
  email text not null,
  phone text not null,
  note text,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  cancelled_at timestamptz,
  caldav_url text,
  icloud_synced boolean not null default false,
  icloud_error text,
  -- Twee bevestigde afspraken kunnen nooit overlappen, ook niet als twee klanten tegelijk boeken
  constraint geen_dubbele_boeking exclude using gist (tstzrange(starts_at, ends_at) with &&) where (status = 'confirmed')
);
create index if not exists bookings_starts_at on public.bookings (starts_at);

-- E-mail (ook toegevoegd als je dit script eerder al had gedraaid)
alter table public.bookings add column if not exists confirmation_sent_at timestamptz;
alter table public.bookings add column if not exists owner_notified_at timestamptz;
alter table public.bookings add column if not exists reminder_sent_at timestamptz;
alter table public.bookings add column if not exists mail_error text;

-- Geheime waarden voor de server (niet leesbaar via de website)
create table if not exists public.private_config (
  key text primary key,
  value text not null
);

-- Wie mag de studio-agenda zien
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.settings enable row level security;
alter table public.bookings enable row level security;
alter table public.admins enable row level security;
alter table public.private_config enable row level security;

drop policy if exists "iedereen leest instellingen" on public.settings;
create policy "iedereen leest instellingen" on public.settings for select to anon, authenticated using (true);

drop policy if exists "beheer wijzigt instellingen" on public.settings;
create policy "beheer wijzigt instellingen" on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "beheer leest afspraken" on public.bookings;
create policy "beheer leest afspraken" on public.bookings for select to authenticated using (public.is_admin());

drop policy if exists "eigen beheerrecht zien" on public.admins;
create policy "eigen beheerrecht zien" on public.admins for select to authenticated using (user_id = auth.uid());

-- Klanten schrijven nooit rechtstreeks: boeken en annuleren loopt via de serverfuncties.
