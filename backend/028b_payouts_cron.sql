-- 028b: sends queued payouts every 10 minutes (Supabase only: Vault, pg_cron, pg_net; the local test database skips it).
-- Like 017, a random token kept in Vault proves the call comes from this job. Nobody types or sees it.
create extension if not exists pg_net;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'payouts_worker') then
    perform vault.create_secret(encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex'), 'payouts_worker',
                                'Token pg_cron sends to the send-payouts Edge Function');
  end if;
end $$;

create or replace function public.payout_worker_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_token is not null and p_token = (select decrypted_secret from vault.decrypted_secrets where name = 'payouts_worker'), false)
$$;
revoke execute on function public.payout_worker_ok(text) from public, anon, authenticated;
grant execute on function public.payout_worker_ok(text) to service_role;

select cron.schedule('send-payouts', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://tkjmnivvcrcqkqjywafb.supabase.co/functions/v1/send-payouts',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-worker-token', (select decrypted_secret from vault.decrypted_secrets where name = 'payouts_worker')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$$);
