# #SmarterDesign player pages batch P3: Player Statistics and Wallet (2026-11-28)

Dan, 2026-11-27: "NO DO NOT USE THOSE BULKY FRAMES, THATS THE OLD STYLE...
USE THE #SMARTERDESIGN STYLE". Batch P3 of the player pages moves two more
routed pages onto the arena workspace (`.claude/skills/smarter-design/SKILL.md`).

## What changed

**Player Statistics** (`/clubs/:clubId/members/:userId/statistics`,
`src/pages/PlayerStatisticsPage.tsx`). The root carries `arena-workspace`. The
back key sits above an `ArenaWorkspaceHeader` mast (`area="stats"`, title
"Player Performance", the page description and the tour behind the chrome
"?"). Instrument Controls and the Playing Style, Volume and Club Result cards
are chrome cases under section titles; the date range is a chrome switch lit
by `aria-pressed`; Game and the custom dates are dark wells; Confirm and Try
Again are the lit key; every figure is a chrome ledger row (Net keeps its sign
colour, live blue up and error red down); Metric Definitions is a chrome
disclosure; the empty, restricted, not found, failed and stale states sit in
chrome cases. `PlayerStatisticsPage.css` was rewritten as the page's arena
dress, every rule under `.player-stats-page.arena-workspace`.

**Wallet** (`/wallet`, `src/pages/PlayerWalletPage.tsx`). The root carries
`arena-workspace` and keeps `data-arena-surface="wallet"` and its
`<CashierWorkspace compact title="Wallet" ...>` (now `hasVisibleTitle`, so the
page's one h1 and "?" are the `cashier` mast's). The combined balance is a
chrome case with Playable Now, Diamonds and the held figures on readout tiles;
the ledger read status sits over four chrome keys with Add Chips lit; the five
panes are one chrome switch lit by `aria-selected`; the wallets are chrome
ledger rows in one case, the arena door lit; each pane is a chrome case under a
section title with its primary lit; the fields are dark wells; received and
sent diamonds, the receive ids and the earn doors are chrome rows; the earn
figures are readout tiles. The Chip Statement keeps its own case (no frame in
a frame). The dress is a new sheet, `src/pages/PlayerWalletArena.css`, every
rule scoped under `.wallet-page.arena-workspace`, so the shared
`CashierWorkspace` (Cashier, Statements, Trade) and `DiamondLedgerMore` are
unchanged elsewhere; `PlayerWalletPage.css` keeps its base desk rules.

## Skipped

**Hand History** (`src/pages/HandHistoryPage.tsx`): pinned to the Play & Review
master by `tests/unit/cinematicRouteFamilies.test.ts` (`PLAY_PAGES` requires
`CasinoSurfaceHeader` and `data-arena-surface="play"`). Converting it needs an
owner decision to retire that master for the page.

## How it is held

- Pinned first, against the old pages on main a3873e77f, and unchanged after:
  `tests/components/playerStatisticsPageIsPinned.test.tsx` (10 states) and
  `tests/components/playerWalletPageIsPinned.test.tsx` (13 states, all five
  panes): every printed figure (`tests/helpers/moneyFigures.ts`), the printed
  text, every named region and every control with its state.
- `tests/unit/walletArenaDressIsScoped.test.ts`: every wallet arena rule sits
  under the wallet's root; `CashierWorkspace.css` carries no wallet dress.
- CSS and markup only: no handler, guard, hook, string, role, aria, number
  format or `data-*` changed, and no class was removed.
- Inventory regenerated (`node scripts/smarterdesign-inventory.mjs --write`);
  batch entry in `docs/club-operations/SMARTERDESIGN-HISTORY.md`.
