-- Provenance: migration 005 — Supabase Storage bucket for listing photos and video.
-- Run AFTER 004. Safe to re-run. Contains no DROP statements.
--
-- Public bucket: listing photos are public anyway, and public URLs let link previews (WhatsApp,
-- Google) show the photo. Each seller writes only inside their own folder: <user id>/<listing id>/<file>.
-- Evidence photos taken at hand-over and unboxing go in a separate PRIVATE bucket in a later step.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-media', 'listing-media', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
on conflict (id) do nothing;

do $$ begin
  create policy "sellers upload listing media to their own folder" on storage.objects for insert to authenticated
    with check (bucket_id = 'listing-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "sellers replace their own listing media" on storage.objects for update to authenticated
    using (bucket_id = 'listing-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
    with check (bucket_id = 'listing-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "sellers delete their own listing media" on storage.objects for delete to authenticated
    using (bucket_id = 'listing-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
exception when duplicate_object then null; end $$;
