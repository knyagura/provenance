# 0020: Staff reports

Date: 2026-10-17. Status: accepted.

## Decision
- A **Reports** tab in the staff console covers a chosen period (last 7 or 30 days, this month, last 12 months, or any dates up to two years). Days are in UK time.
- **Sales:**
  - orders paid, sellers and buyers;
  - value of items sold, what buyers paid, the average item and what's due to sellers;
  - by protection level and top categories.
- **Fees:**
  - transaction fees, processing and boost commission;
  - less promotions NuTuYu covered and NuTuYu-funded voucher codes, which gives the **net to NuTuYu**;
  - courier and authentication charges are shown separately, because they pass on to partners.
- **Disputes:**
  - opened, and the rate against orders paid;
  - released or refunded, still waiting, and time to decide;
  - by reason.
- **Handover time:** average and median from payment to the buyer's confirmation, by protection level, plus shipping labels made.
- **12 months by month:** orders, items sold, net fees and disputes.
- **Download CSV** for a spreadsheet.
- Reports show totals only, never buyers or sellers.

## Consequences
- Migration 027: `staff_report(from, to)`, for staff only, plus indexes on paid, disputed and resolved times.
- Example mode counts the example orders in that browser.
- Tests: `tests/report_checks.mjs`, `web/tests/unit/reports.test.ts`, and a browser check of the tab and the CSV download.
