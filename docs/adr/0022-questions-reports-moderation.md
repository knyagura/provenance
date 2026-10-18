# 0022: Questions before buying, reports, and staff moderation

Date: 2026-10-18. Status: accepted.

## Decision
- **Questions on listings.**
  - Signed-in members ask the seller from the item page.
  - Answered questions are public, shown as "A buyer asked", without the asker's name. Unanswered ones are seen only by the asker and the seller.
  - The seller is notified, and answers on the item page or from *Questions to answer* on Your sales. The asker is notified of the answer.
  - Sellers can remove spam.
  - Limits: 5 questions an hour and 20 a day per member, and 3 unanswered per listing.
  - Email addresses, UK mobile numbers, "WhatsApp", "PayPal" and "bank transfer" are refused. Taking a sale off NuTuYu loses buyer protection.
- **Reports.**
  - Members report a listing or a member: it looks fake, isn't allowed, scam or paying outside NuTuYu, offensive, misleading or wrong category, or something else (with a note).
  - Each report counts once per member and target; there's a limit of 10 a day.
  - The seller isn't told who reported them.
- **Staff moderation** (the *Moderation* tab). Reports are grouped by what was reported, most-reported first. Staff can:
  - **hide a listing**: it comes off sale, and the seller sees why on Your sales but can't re-publish it;
  - **suspend a member**: all their listings come off sale, their payouts are held, and they can't list, buy, offer, ask or message;
  - **restore** either, or **dismiss** the reports.
  - Every decision needs a note, which is sent to the member and recorded with the staff member's name.

## Consequences
- Migration 029 adds:
  - `listings.moderated_at` and `moderation_note`, and `profiles.suspended_at` and `suspended_reason`, which members can't change;
  - triggers that stop suspended members in every table where they could start something;
  - the `listing_questions` and `reports` tables, which members can't read directly;
  - functions for members and for staff.
- Example mode keeps this in the browser. Hidden example items show a banner but stay in browse, because they come from a fixed catalogue.
- Tests: `tests/moderation_checks.mjs`, plus a browser journey covering ask, answer, report and hide.
