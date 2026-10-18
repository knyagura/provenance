-- 031b: accept returns the seller hasn't answered within 48 hours. Needs pg_cron (Supabase only). Safe to re-run.
create extension if not exists pg_cron;
select cron.schedule('auto-accept-returns', '17 * * * *', $$select public.auto_accept_returns()$$);
