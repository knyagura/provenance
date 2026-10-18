-- 032: Privacy tools (UK GDPR): download my data, delete my account, and automatic clean-up of old data.
--
-- Download: everything NuTuYu holds about the member, as one JSON file.
-- Delete: allowed once nothing is in progress (no open orders as buyer or seller, no payout still to send). The
-- account is anonymised: name, bio, location, addresses, favourites, saved searches, baskets, notifications, API
-- keys, payout account and sign-in details are removed, listings come off sale, and the member can't sign in again.
-- Orders, their custody records, payments and staff decisions are kept (anonymised) for 6 years, because the law
-- requires financial records and buyers may still need the item's history; the passport never shows names anyway.
-- Clean-up (032b, daily): old notifications, sent emails, API usage counts, used one-time codes, handled contact
-- messages and closed reports are deleted once past their retention period (see the plan's Data model tab).

alter table public.profiles add column if not exists deleted_at timestamptz;

create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select jsonb_build_object(
    'exported_at', now(),
    'about', 'Everything NuTuYu holds about your account. Orders include only what you could see on the order page.',
    'account', (select jsonb_build_object('email', u.email) from auth.users u, me where u.id = me.id),
    'profile', (select to_jsonb(p) - 'id' from public.profiles p, me where p.id = me.id),
    'addresses', (select coalesce(jsonb_agg(jsonb_build_object('label', a.label, 'address', a.address, 'default', a.is_default)), '[]'::jsonb)
                    from public.addresses a, me where a.user_id = me.id),
    'notification_settings', (select to_jsonb(n) - 'user_id' from public.notification_prefs n, me where n.user_id = me.id),
    'listings', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'price_pence', l.price_pence, 'status', l.status,
                   'published', l.published, 'description', l.description, 'created_at', l.created_at)), '[]'::jsonb)
                   from public.listings l, me where l.seller_id = me.id),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'role', case when o.buyer_id = me.id then 'buyer' else 'seller' end,
                 'title', coalesce(o.listing_snapshot ->> 'title', ''), 'paid_at', o.paid_at, 'price_pence', o.price_pence,
                 'total_pence', case when o.buyer_id = me.id then o.total_pence end, 'state', o.custody_state, 'payout_status', o.payout_status,
                 'delivery_address', case when o.buyer_id = me.id then o.deliver_to end)), '[]'::jsonb)
                 from public.orders o, me where (o.buyer_id = me.id or o.seller_id = me.id) and o.payment_status <> 'legacy'),
    'messages_sent', (select coalesce(jsonb_agg(jsonb_build_object('order_id', m.order_id, 'body', m.body, 'at', m.created_at)), '[]'::jsonb)
                        from public.order_messages m, me where m.sender_id = me.id),
    'offers', (select coalesce(jsonb_agg(jsonb_build_object('listing_id', f.listing_id, 'amount_pence', f.amount_pence, 'made_by', f.made_by,
                 'status', f.status, 'created_at', f.created_at)), '[]'::jsonb)
                 from public.offers f, me where f.buyer_id = me.id or f.seller_id = me.id),
    'reviews_written', (select coalesce(jsonb_agg(jsonb_build_object('order_id', r.order_id, 'rating', r.rating, 'body', r.body, 'at', r.created_at)), '[]'::jsonb)
                          from public.reviews r, me where r.author_id = me.id),
    'favourites', (select coalesce(jsonb_agg(f.listing_id), '[]'::jsonb) from public.favourites f, me where f.user_id = me.id),
    'saved_searches', (select coalesce(jsonb_agg(to_jsonb(s) - 'user_id'), '[]'::jsonb) from public.saved_searches s, me where s.user_id = me.id),
    'questions_asked', (select coalesce(jsonb_agg(jsonb_build_object('listing_id', q.listing_id, 'question', q.body, 'answer', q.answer, 'at', q.created_at)), '[]'::jsonb)
                          from public.listing_questions q, me where q.asker_id = me.id),
    'reports_made', (select coalesce(jsonb_agg(jsonb_build_object('listing_id', r.listing_id, 'reason', r.reason, 'note', r.note, 'status', r.status, 'at', r.created_at)), '[]'::jsonb)
                       from public.reports r, me where r.reporter_id = me.id),
    'gift_cards_bought', (select coalesce(jsonb_agg(jsonb_build_object('amount_pence', g.amount_pence, 'status', g.payment_status, 'at', g.created_at)), '[]'::jsonb)
                            from public.gift_cards g, me where g.purchaser_id = me.id),
    'payouts', (select coalesce(jsonb_agg(jsonb_build_object('order_id', p.order_id, 'amount_pence', p.amount_pence, 'status', p.status, 'sent_at', p.sent_at)), '[]'::jsonb)
                  from public.payouts p, me where p.seller_id = me.id),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('title', n.title, 'body', n.body, 'at', n.created_at) order by n.created_at desc), '[]'::jsonb)
                        from (select * from public.notifications n, me where n.user_id = me.id order by n.created_at desc limit 500) n)
  )
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- What stops deletion right now (empty list: it can go ahead).
create or replace function public.account_deletion_blockers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(array_remove(array[
    case when exists (select 1 from public.orders o where o.buyer_id = auth.uid() and o.payment_status in ('paid', 'review', 'awaiting_payment')
                      and o.custody_state in ('not_started', 'in_progress', 'disputed') and o.dispute_resolution is null
                      and not (o.payment_status = 'awaiting_payment' and o.hold_expires_at < now()))
         then 'You have an order on its way to you. Confirm it or wait for it to finish first.' end,
    case when exists (select 1 from public.orders o where o.seller_id = auth.uid() and o.payment_status in ('paid', 'review')
                      and o.custody_state in ('not_started', 'in_progress', 'disputed') and o.dispute_resolution is null)
         then 'You have a sale in progress. Finish the handover first.' end,
    case when exists (select 1 from public.payouts p where p.seller_id = auth.uid() and p.status in ('waiting', 'queued', 'sending', 'failed', 'held'))
         then 'You have money still to be paid to you. Set up payouts, or contact us, first.' end
  ], null))
$$;
revoke execute on function public.account_deletion_blockers() from public, anon;
grant execute on function public.account_deletion_blockers() to authenticated;

create or replace function public.delete_my_account(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  p public.profiles;
  blockers jsonb;
  signin_removed boolean := true;
begin
  select * into p from public.profiles where id = me for update;
  if not found or p.deleted_at is not null then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> lower(p.username) then
    raise exception 'Type your username to confirm.' using errcode = '22023';
  end if;
  blockers := public.account_deletion_blockers();
  if jsonb_array_length(blockers) > 0 then
    raise exception '%', blockers ->> 0 using errcode = '55000';
  end if;

  update public.listings set published = false where seller_id = me and published;
  delete from public.addresses where user_id = me;
  delete from public.favourites where user_id = me;
  delete from public.saved_searches where user_id = me;
  delete from public.basket_items where owner_id = me;
  delete from public.baskets where owner_id = me;
  delete from public.notifications where user_id = me;
  delete from public.notification_prefs where user_id = me;
  delete from public.api_keys where owner_id = me;
  delete from public.payout_accounts where user_id = me;
  update public.listing_questions set hidden_at = coalesce(hidden_at, now()) where asker_id = me and answer is null;
  update public.profiles
     set username = 'deleted_' || substr(replace(me::text, '-', ''), 1, 10), bio = null, area = null, area_lat = null, area_lng = null,
         collection_ok = false, holiday_mode = true, multi_basket = false, bundle_min_items = null, bundle_pct = null, deleted_at = now()
   where id = me;
  -- Sign-in details. Supabase keeps them in its own auth schema; if that isn't writable here, staff finish it.
  begin
    update auth.users set email = 'deleted+' || replace(me::text, '-', '') || '@invalid.nutuyu' where id = me;
  exception when others then
    signin_removed := false;
  end;
  begin
    execute 'update auth.users set encrypted_password = null, raw_user_meta_data = ''{}''::jsonb, banned_until = ''infinity'' where id = $1' using me;
    execute 'delete from auth.identities where user_id = $1' using me;
    execute 'delete from auth.sessions where user_id = $1' using me;
  exception when others then
    signin_removed := false;
  end;
  insert into public.staff_actions (staff_id, action, subject, detail)
  values (me, 'account_deleted', me::text, jsonb_build_object('signin_removed', signin_removed));
  return jsonb_build_object('deleted', true, 'signin_removed', signin_removed);
end;
$$;
revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

-- Deleted accounts can't buy, sell or post: the suspension guard (029) covers them too.
create or replace function public.is_suspended(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select suspended_at is not null or deleted_at is not null from public.profiles where id = p_user), false) $$;

-- Retention. Returns how many rows each rule removed.
create or replace function public.apply_retention()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb := '{}'::jsonb;
  n integer;
begin
  delete from public.notifications where created_at < now() - interval '1 year';
  get diagnostics n = row_count; r := r || jsonb_build_object('notifications', n);
  delete from public.email_outbox where state in ('sent', 'failed') and created_at < now() - interval '90 days';
  get diagnostics n = row_count; r := r || jsonb_build_object('emails', n);
  delete from public.api_usage where minute < now() - interval '90 days';
  get diagnostics n = row_count; r := r || jsonb_build_object('api_usage', n);
  delete from public.custody_challenges where expires_at < now() - interval '30 days';
  get diagnostics n = row_count; r := r || jsonb_build_object('one_time_codes', n);
  delete from public.contact_messages where handled_at < now() - interval '2 years';
  get diagnostics n = row_count; r := r || jsonb_build_object('contact_messages', n);
  delete from public.reports where status <> 'open' and handled_at < now() - interval '2 years';
  get diagnostics n = row_count; r := r || jsonb_build_object('reports', n);
  delete from public.listing_questions where hidden_at < now() - interval '1 year';
  get diagnostics n = row_count; r := r || jsonb_build_object('removed_questions', n);
  return r;
end;
$$;
revoke execute on function public.apply_retention() from public, anon, authenticated;
