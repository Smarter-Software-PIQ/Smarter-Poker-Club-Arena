# Post-deploy client specs follow three deliberate product changes

`post-deploy-e2e.yml` "Client browser verification" has been red since
2026-11-25. Three of its failures were specs still pinning behaviour that a
later merge replaced on purpose. Each spec now asserts the replacement, with
the same strength as before.

- `production-mobile-lobby-chrome.spec.ts`, "MY WALLETS lives in Cashier":
  asserted a centred Wallet Balances title with the count under it (received
  a 100px offset). #12021 (5474be8e4) replaced that with the approved Balance
  Ledger: title at the left, count on the same line beside the caret, and
  moved the fixture twin in `mobile-lobby-chrome.spec.ts` to that geometry.
  The production spec now checks the same geometry (title inset, title before
  count, caret gap, shared line, not clipped). Measured on the failing run's
  trace snapshot: inset 5px, caret gap 10.3px, line overlap 15px.
- `stats-deep.spec.ts`, "separates published cash and tournament samples":
  waited for a Cash Games overview read after returning from Tournaments. The
  page serves that return from its in-memory range memo ("Memory Cache" in the
  failure screenshot); #12026 (62a80b3d7) stopped clearing the memo on every
  background event. The spec reloads once after attaching its listener, so the
  published cash read is observed on the network, and still requires a cash
  read with zero tournament hands and a tournament read with zero cash hands.
- `gameplay-customization-runtime.spec.ts`, hero celebration: expected a
  "Countdown Paused" pill out of profit. #10976 (f5ab740e7) hides the
  countdown out of profit while keeping the stored count, pinned by
  `tests/charles-rule-paused-display.test.tsx`. The spec now requires both
  pills to be absent at that point.
