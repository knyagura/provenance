-- Provenance: migration 017 — only the scheduled job can start the notification sender.
-- A random token is made inside the database and kept in Supabase Vault; nobody types or sees it.
-- pg_cron sends it to the send-notifications Edge Function, which asks the database whether it matches.
-- Needs supabase_vault, pg_cron and pg_net (Supabase has them; the local test database doesn't). Safe to re-run.
create extension if not exists pg_net;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'notifications_worker') then
    perform vault.create_secret(encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex'), 'notifications_worker',
                                'Token pg_cron sends to the send-notifications Edge Function');
  end if;
end $$;

create or replace function public.notification_worker_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_token is not null and p_token = (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_worker'), false)
$$;
revoke execute on function public.notification_worker_ok(text) from public, anon, authenticated;
grant execute on function public.notification_worker_ok(text) to service_role;

-- Replaces the 016b job (same name), now sending the token.
select cron.schedule('send-notifications', '* * * * *', $$
  select net.http_post(
    url := 'https://tkjmnivvcrcqkqjywafb.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-worker-token', (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_worker')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$$);
