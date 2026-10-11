-- Provenance: migration 011b — confirm orders automatically after the protection window.
-- Needs pg_cron (Supabase has it; the local test database doesn't). Run AFTER 011. Safe to re-run.
create extension if not exists pg_cron;
select cron.schedule('auto-confirm-custody', '7 * * * *', $$select public.auto_confirm_custody()$$);
