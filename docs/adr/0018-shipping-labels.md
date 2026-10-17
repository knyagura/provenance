# 0018: Shipping labels with Parcel2Go (test mode first)

Date: 2026-10-17. Status: accepted. Live labels wait for NuTuYu's Parcel2Go key.

## Decision
- **Courier:** Parcel2Go, which resells Evri, Royal Mail, DPD and others through one account.
- **Who uses labels:** only for items the seller posts themselves (Photo evidence, under £75), at the *Post it with tracking* step. For dearer items a courier collects and witnesses the parcel, so they don't need labels.
- **Delivery address:**
  - The buyer adds a delivery address on the order page. They're asked for it by notification when they pay.
  - A basket checkout's recipient address counts as the delivery address.
  - The seller sees the address only on the label. The buyer can change it until there's a label or the parcel is recorded as sent.
- **Making a label:**
  - The seller picks a parcel size (small, medium, large) and a service with its price.
  - The label fills in the carrier and tracking number for the step.
  - It prints from `/orders/{id}/shipping-label`: carrier, service, address, and the tracking number with a QR code.
  - One label at a time. A label can be cancelled until the parcel is recorded as sent.
- **Test mode (now):**
  - Labels are marked *TEST — not valid for posting*.
  - The tracking number is made up (`P2GTEST…`) and nothing is charged.
  - Prices come from the `shipping_services` table, as a guide.

## Switching on live labels (later)
1. NuTuYu opens a Parcel2Go business account with prepay balance and creates API credentials.
2. The owner adds them as Supabase function secrets: `PARCEL2GO_CLIENT_ID` and `PARCEL2GO_CLIENT_SECRET`. These are never put in code or chat.
3. A `shipping-label` Edge Function will then:
   - get live quotes;
   - buy the label from the prepay balance;
   - store it through `record_live_label()`, which only the service role can run.
4. The label cost comes off the seller's payout.

## Consequences
- Migration 025 adds:
  - `orders.deliver_to`, which members can't write directly; a trigger guards it;
  - the `shipping_services` and `shipping_labels` tables;
  - the functions `order_shipping`, `set_delivery_address`, `create_label`, `cancel_label` and `record_live_label`;
  - a request for the address when the buyer pays.
- Labels aren't readable directly. Buyer, seller and staff read them through `order_shipping()`.
- Tests: `tests/label_checks.mjs`, plus a browser journey covering the buyer's address, the seller's label, printing and the step filled in.
