-- 034b: where the Web Push (VAPID) keys live: Supabase Vault (Supabase only; the local test database skips this).
-- The send-notifications worker makes the key pair itself the first time it runs and stores it here; the public half
-- is what browsers need to subscribe, so anyone may read it. Nobody types or sees the private half.

create or replace function public.push_public_key()
returns text
language sql
stable
security definer
set search_path = public
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_public' $$;
revoke execute on function public.push_public_key() from public;
grant execute on function public.push_public_key() to anon, authenticated;

create or replace function public.push_vapid()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when pub.decrypted_secret is null then null else jsonb_build_object('public', pub.decrypted_secret, 'private', priv.decrypted_secret) end
    from (select 1) one
    left join vault.decrypted_secrets pub on pub.name = 'push_vapid_public'
    left join vault.decrypted_secrets priv on priv.name = 'push_vapid_private'
$$;
revoke execute on function public.push_vapid() from public, anon, authenticated;
grant execute on function public.push_vapid() to service_role;

-- Only sets them once: a second worker racing the first can't replace keys browsers already use.
create or replace function public.push_vapid_set(p_public text, p_private text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from vault.secrets where name = 'push_vapid_public') then
    return false;
  end if;
  perform vault.create_secret(p_private, 'push_vapid_private', 'Web Push private key (send-notifications)');
  perform vault.create_secret(p_public, 'push_vapid_public', 'Web Push public key (browsers subscribe with it)');
  return true;
end;
$$;
revoke execute on function public.push_vapid_set(text, text) from public, anon, authenticated;
grant execute on function public.push_vapid_set(text, text) to service_role;
