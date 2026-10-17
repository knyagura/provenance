-- 015: Indexes behind foreign keys the database advisor flagged, so look-ups and deletes stay fast as data grows.
create index if not exists contact_messages_handled_by_idx on public.contact_messages (handled_by);
create index if not exists contact_messages_user_idx on public.contact_messages (user_id);
create index if not exists custody_challenges_issued_to_idx on public.custody_challenges (issued_to);
create index if not exists custody_events_actor_idx on public.custody_events (actor_id);
create index if not exists custody_seals_issued_to_idx on public.custody_seals (issued_to);
create index if not exists message_reads_user_idx on public.message_reads (user_id);
create index if not exists offers_counter_of_idx on public.offers (counter_of);
create index if not exists order_messages_sender_idx on public.order_messages (sender_id);
create index if not exists orders_offer_idx on public.orders (offer_id);
create index if not exists reviews_author_idx on public.reviews (author_id);
create index if not exists staff_actions_staff_idx on public.staff_actions (staff_id);
create index if not exists staff_members_added_by_idx on public.staff_members (added_by);
