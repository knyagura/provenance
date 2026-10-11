-- Provenance: migration 008b — free unpaid holds every 5 minutes. Live database only (needs pg_cron,
-- which the local test database doesn't have). Run AFTER 008. Safe to re-run.
create extension if not exists pg_cron;
select cron.schedule('release-expired-checkouts', '*/5 * * * *', $$select public.release_expired_checkouts()$$);
