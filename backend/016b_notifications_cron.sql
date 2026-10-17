-- Provenance: migration 016b — run the notification jobs.
-- Needs pg_cron and pg_net (Supabase has both; the local test database doesn't). Run AFTER 016. Safe to re-run.
--  * every minute: ask the send-notifications Edge Function to send waiting emails
--    (it does nothing until RESEND_API_KEY is set in the function's secrets)
--  * every hour: remind people about offers that run out within 6 hours
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('send-notifications', '* * * * *', $$
  select net.http_post(
    url := 'https://tkjmnivvcrcqkqjywafb.supabase.co/functions/v1/send-notifications',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$$);
select cron.schedule('offers-expiring', '17 * * * *', $$select public.notify_expiring_offers()$$);
