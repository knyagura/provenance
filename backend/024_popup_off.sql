-- Provenance: migration 024 — the "how it works" popup is switched off for now: the site opens straight
-- onto the items. Staff can switch it (or any popup) back on in the console. Safe to re-run.
update public.site_popups set active = false where key = 'how-it-works';
