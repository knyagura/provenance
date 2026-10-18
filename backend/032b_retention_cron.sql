-- 032b: apply the retention rules every night at 03:23 (UTC). Needs pg_cron (Supabase only). Safe to re-run.
create extension if not exists pg_cron;
select cron.schedule('apply-retention', '23 3 * * *', $$select public.apply_retention()$$);
