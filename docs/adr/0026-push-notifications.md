# 0026: Phone and desktop notifications (Web Push)

Date: 2026-10-18. Status: accepted.

## Decision
- **Turning it on.** *Account → Phone and desktop notifications → Notify me on this device* asks the browser for permission and subscribes that device.
  - It works on Android and desktop browsers. On iPhone it works once NuTuYu is added to the home screen, which iOS requires.
  - A member can have up to 10 devices, and can switch a device off or switch all pushes off.
- **What's pushed:** every new item in Updates (your turn, messages, offers, sales, alerts), with its link. Tapping a notification opens that page.
- **Sending.** The existing `send-notifications` worker, which runs every minute, also sends pushes.
  - It uses the `web-push` library and VAPID keys that it makes itself on its first run and keeps in Vault, so there's no setup.
  - Devices that have gone (404 or 410) are removed.
  - A push more than a day old isn't sent.

## Consequences
- Migration 034 adds:
  - `push_subscriptions`, which members can't read directly;
  - `notification_prefs.push_on` and `notifications.push_state`;
  - member functions and the worker's claim and done functions;
  - a trigger that queues pushes.
- Migration 034b adds the Vault keys: `push_public_key()` for anyone, the private key for the worker only.
- The service worker shows pushes and opens their link.
- Example mode records the device without a push service.
- Tests: `tests/growth_checks.mjs`, a unit test for the key format, and a browser check.
