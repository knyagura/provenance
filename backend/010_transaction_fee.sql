-- Provenance: migration 010 — the transaction fee (agreed 11 Oct 2026). Run AFTER 009. Safe to re-run.
--
-- Every item now carries a transaction fee of 3–8% of the price, paid by the buyer, plus the £0.80
-- processing fee. The rate follows the price band: 8% under £75, 6% from £75, 4% from £500, 3% from £1,500.
-- All of it is configurable: the rate per band, and the 3% floor and 8% ceiling every band is kept within.
-- The fee still pays for buyer protection; it replaces version 1's flat 5%.
--
--   1. compute_fees() keeps each band's rate between transaction_min_bp and transaction_max_bp and reports
--      the rate it charged (transaction_rate_bp). Version 1 settings have no limits, so old orders still add up.
--   2. Fee settings version 2 takes effect from the moment this migration runs. Orders already made keep
--      version 1, which they recorded.

create or replace function public.compute_fees(s jsonb, p_price integer, p_postage integer, p_payer text, p_boost_bp integer, p_version integer default null)
returns jsonb
language plpgsql immutable
set search_path = public
as $$
declare
  t jsonb;
  x jsonb;
  rate_bp integer;
  protection integer;
  processing integer := (s ->> 'processing_pence')::int;
  add_ons integer;
  commission integer := 0;
  promotion integer := 0;
  rate integer;
  coverable integer;
  buyer_fees integer;
  seller_fees integer;
begin
  if p_price is null or p_price < 0 or p_postage is null or p_postage < 0 then
    raise exception 'Prices are whole pence' using errcode = '22023';
  end if;
  if p_payer not in ('buyer', 'seller') then
    raise exception 'Payer must be buyer or seller' using errcode = '22023';
  end if;
  for x in select * from jsonb_array_elements(s -> 'tiers') loop
    if t is null or p_price >= (x ->> 'from_pence')::int then t := x; end if;
  end loop;
  rate_bp := least(coalesce((s ->> 'transaction_max_bp')::int, 10000),
             greatest(coalesce((s ->> 'transaction_min_bp')::int, 0), (t ->> 'protection_bp')::int));
  protection := least((s ->> 'protection_max_pence')::int,
                greatest((s ->> 'protection_min_pence')::int, (p_price::bigint * rate_bp + 5000) / 10000));
  add_ons := (t ->> 'courier_pence')::int + (t ->> 'hub_pence')::int;

  if p_boost_bp is not null and (s ->> 'boost_on')::boolean and p_price >= (s ->> 'boost_min_price_pence')::int then
    rate := least((s ->> 'boost_max_bp')::int, greatest((s ->> 'boost_min_bp')::int, p_boost_bp));
    commission := ((p_price::bigint * rate + 5000) / 10000)::int + (s ->> 'boost_fixed_pence')::int;
    coverable := case when (s -> 'promotion_covers' ->> 'protection')::boolean and p_payer = 'buyer' then protection else 0 end
               + case when (s -> 'promotion_covers' ->> 'processing')::boolean and p_payer = 'buyer' then processing else 0 end
               + case when (s -> 'promotion_covers' ->> 'add_ons')::boolean then add_ons else 0 end;
    promotion := least(coverable, ((commission::bigint * (s ->> 'promotion_share_bp')::int + 5000) / 10000)::int);
  end if;

  buyer_fees := case when p_payer = 'buyer' then protection + processing else 0 end;
  seller_fees := case when p_payer = 'seller' then protection + processing else 0 end;
  return jsonb_build_object(
    'fee_version', p_version,
    'tier', t ->> 'key',
    'price_pence', p_price,
    'postage_pence', p_postage,
    'transaction_rate_bp', rate_bp,
    'protection_pence', protection,
    'processing_pence', processing,
    'courier_pence', (t ->> 'courier_pence')::int,
    'hub_pence', (t ->> 'hub_pence')::int,
    'promotion_pence', promotion,
    'buyer_total_pence', p_price + p_postage + buyer_fees + add_ons - promotion,
    'commission_pence', commission,
    'seller_fees_pence', seller_fees,
    'seller_payout_pence', p_price - commission - seller_fees,
    'payer', p_payer
  );
end;
$$;
grant execute on function public.compute_fees(jsonb, integer, integer, text, integer, integer) to anon, authenticated;

insert into public.fee_settings (version, effective_from, note, settings) values (2, now(), 'Transaction fee 3–8% by price band, paid by the buyer, plus £0.80 processing (agreed 11 Oct 2026)', '{
  "tiers": [
    {"key": "enhanced",    "from_pence": 0,      "protection_bp": 800, "courier_pence": 0,   "hub_pence": 0},
    {"key": "verified",    "from_pence": 7500,   "protection_bp": 600, "courier_pence": 500, "hub_pence": 0},
    {"key": "luxury",      "from_pence": 50000,  "protection_bp": 400, "courier_pence": 500, "hub_pence": 1500},
    {"key": "ultraLuxury", "from_pence": 150000, "protection_bp": 300, "courier_pence": 500, "hub_pence": 3000}
  ],
  "transaction_min_bp": 300,
  "transaction_max_bp": 800,
  "processing_pence": 80,
  "protection_min_pence": 50,
  "protection_max_pence": 25000,
  "boost_on": true,
  "boost_min_price_pence": 2500,
  "boost_min_bp": 300,
  "boost_max_bp": 800,
  "boost_fixed_pence": 80,
  "promotion_share_bp": 0,
  "promotion_covers": {"protection": true, "processing": true, "add_ons": false},
  "checkout_hold_minutes": 30
}'::jsonb)
on conflict (version) do nothing;
