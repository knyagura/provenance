# 0015: Home page straight to the items; popups staff configure

Date: 2026-10-17. Status: accepted.

## Decision
- **Home page:** the items start at the top, under the category bar and the heading "Newly listed" (20 items). The hero and the three-step "how it works" strip are gone from the page. "How protection works" next to the heading opens the explanation as a popup. "Protection grows with the price" stays below the items.
- **Popups** are set up by staff in the console (*Popups* tab), with no code change needed. Each popup has:
  - a type (explanation, offer or announcement);
  - title, text, optional steps, a button (internal links only) and an optional offer code;
  - who sees it: everyone, visitors who aren't signed in, or members;
  - which pages (`/` is the home page only, `/search` and so on match as prefixes, `*` is every page);
  - a delay, a priority, Live on or off, and optional start and end dates.
- **Showing:** one popup at a time, the highest priority one that fits. Each person sees a popup once: closing it (the button, Esc, or clicking outside) is remembered in their browser. Saving with "Show again" makes everyone who closed it see it again.
- **Starting popups:**
  - "Pre-loved, with proof": the three protection steps, live on the home page.
  - "New to NuTuYu? Join today": for visitors, switched off.
- **Offer codes** in a popup are display only for now. Checkout doesn't apply them yet; that needs a voucher feature.

## Consequences
- Migration 021 (`site_popups`, `staff_popups`, `staff_save_popup`). Every change is recorded in `staff_actions`.
- The browser tests switch popups off in every journey except the popup journey, so popups never cover the pages under test.
