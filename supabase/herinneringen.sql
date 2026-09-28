-- AA Lashstudio – elk uur herinneringen versturen
-- 1. Vervang hieronder JOUWPROJECT door de code uit je Supabase-adres
--    (https://JOUWPROJECT.supabase.co).
-- 2. Plak alles in Supabase > SQL Editor en klik op "Run".

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'aa-lashstudio-herinneringen';

select cron.schedule(
  'aa-lashstudio-herinneringen',
  '0 * * * *',   -- elk heel uur
  $$
  select net.http_post(
    url := 'https://JOUWPROJECT.supabase.co/functions/v1/reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Controleren of het werkt (na een uur): select * from net._http_response order by created desc limit 5;
