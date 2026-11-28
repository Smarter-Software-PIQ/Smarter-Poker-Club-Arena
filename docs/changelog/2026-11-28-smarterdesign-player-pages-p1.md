# 2026-11-28: Notifications wears #SmarterDesign (player pages, batch P1)

Dan, 2026-11-27: a routed page is rebuilt in #SmarterDesign, the arena workspace
look of Player Management, the Cashier and Club Data.

## What changed

`src/pages/NotificationsPage.tsx` / `.css`, CSS and markup only:

- The page root carries `arena-workspace`. The old page bar header
  (`AccountSurfaceHeader`) is replaced by the arena mast
  (`ArenaWorkspaceHeader area="reports"`, the Signal Desk scene) with the chrome
  "?". The mast title is the page's existing heading text, "Notifications", and
  the "?" panel carries the page's existing description, word for word. A
  `PageBar` under the mast (`titleAs={false}`, `showHelp={false}`) keeps the
  live status line ("Live Feed", "Synchronizing", "Refresh Needed" ...).
- The filter and action keys sit in an `arena-case arena-ops-case`, each group
  an `arena-switch arena-ops-keys`. The filter that is on lights through its
  existing `aria-pressed`; Mark All Read is the one lit primary.
- The list is an `arena-case`; each day heading wears `arena-section-title`,
  each signal is an `arena-ledger-row`, Dismiss is a small chrome key, a system
  signal's category tile is a chrome readout tile. Empty, error and action
  error messages sit in the same case language with chrome keys.
- The push banner (`PushEnableBanner`, its only consumer is this page) is
  dressed on this page in a chrome case with Turn On as the lit key, through
  rules scoped under `.ca-notif.arena-workspace`; its own sheet is untouched.
- The brushed-silver light mode went with the Signal Desk dress: like every
  arena workspace page, Notifications reads dark in either theme.
  `tests/player-identity-casino-realism.test.ts` was updated in the same commit.

No handler, guard, hook, string, role, aria attribute, number format or data
hook changed; no class name was removed.

## Pins

- `tests/components/notificationsPageIsPinned.test.tsx`, committed first
  against main e6aa72113 and unchanged after: every printed figure, the printed
  text, named regions and controls (with pressed and disabled state) in the
  loaded, Unread-cleared, empty, failed and busy (first load, dismissal in
  flight and refused) states.
- `tests/unit/notificationsArenaDressIsScoped.test.ts`: the banner dress is
  scoped to the Notifications arena root.

## Skipped in this batch

- `RakebackPage.tsx` and `SessionHistoryPage.tsx`: open PR #12313 touches both,
  and both are bound to another approved master
  (`tests/unit/cinematicRouteFamilies.test.ts`: Rakeback to the Rewards Circuit
  `RewardsSurfaceHeader`, Session History to the Play & Review
  `CasinoSurfaceHeader`).
- `TransactionHistoryPage.tsx`: bound to the Rewards Circuit
  `RewardsSurfaceHeader` by the same test.
