# 2026-11-28: Hand History and Transaction History wear #SmarterDesign (player pages, batch P4)

Dan, 2026-11-27: "THE SAME #SMARTERDESIGN UPGRADE TO EVERY SINGLE PAGE,
SUBPAGE, BUTTON AND EVERYTHING ELSE". Both pages were bound by
`tests/unit/cinematicRouteFamilies.test.ts` to older masters (Transaction
History to the Rewards Circuit `RewardsSurfaceHeader`, Hand History to the Play
& Review `CasinoSurfaceHeader`). The later order governs (CLAUDE.md 10.8), so
the test now pins the arena shell for these two routes, in the same commits.

## Transaction History (`/transactions`)

CSS and markup only:

- Root `transaction-history-page arena-workspace`; `ArenaWorkspaceHeader
area="finance"` replaces the Rewards Circuit page bar, with the existing
  description (chip or Diamond wording) behind the chrome "?". The old bar
  printed no status word ("CHIP JOURNAL // LIVE" reads as the default), so no
  PageBar is needed; the statement's own Reconciled / Review word is the live
  state.
- `ChipStatement` gets its existing opt-in `arena` prop and forwards it to
  `TournamentPaymentStatus`, which gains the same opt-in (the `ClubPageSection`
  swap ChipStatement already uses). Only this page passes it: the wallet, the
  Financials page and Tournament Results keep the console.
- `RakebackWeekSoFar` (rendered on this page only) is an `arena-case` with an
  `arena-section-title` and one `arena-ledger-row` per club.
- `TransactionHistoryPage.css` dresses the statement's insides under
  `.transaction-history-page.arena-workspace`: Balance Now as a chrome readout,
  every club balance and journal leg on the row rim, the nightly check on the
  field glass, the payments rows on the row rim. `RewardsCircuitSurfaces.css`
  no longer names the page (its rules were for markup this page lost on
  2026-10-06, plus an `!important` black ground).

## Hand History (`/hand-history`)

CSS and markup only:

- Root `hand-history-page arena-workspace` (the `data-arena-surface="play"`
  marker went with the Play Circuit surface; only `PlayCircuitSurfaces.css` and
  the route-family test read it, and both are updated);
  `ArenaWorkspaceHeader area="handreview"` with the existing description; a
  `PageBar` (`titleAs={false}`, `showHelp={false}`) keeps the same Won and
  Biggest Pot / Events figures, now on chrome meters.
- Find A Hand is one `arena-case`: the label is the section title, the search,
  game and dates are search-well fields (16px so iOS does not zoom), Clear and
  Export For Tracker share a chrome switch with Export lit, the game mode and
  the eight filters are chrome switches lit by their existing `aria-pressed`.
- Every note and return (tournament export note, another player's link, linked
  hand error, Personal Assistant and Player Stats returns, stats evidence) is a
  case with its keys in a chrome switch, the first lit.
- The loaded-hands summary is a case of `arena-meter` tiles with Export lit;
  the hand list is a case of `arena-ledger-row` cards; an expanded card's
  actions are chrome keys with Open Hand Detail lit; Retry and Load More are
  lit keys.
- The dress is `src/pages/HandHistoryArena.css`, every rule under
  `.hand-history-page.arena-workspace`; `HandHistoryPage.css` keeps its rules
  (several are pinned by `tests/components/stats-personal-assistant-wiring.test.tsx`)
  and is outranked on this page. `PlayCircuitSurfaces.css` no longer names the
  page, so its `!important` record frames cannot overpaint the rows and tiles;
  Session History keeps every rule it had.
- Not touched: `HandDetailView`, `HandDetailModal`, `HandReplay`, the flag and
  note controls (table-layer surfaces with their own skin).

No handler, guard, hook, string, role, aria attribute, number format or data
hook changed; no class name was removed (the e2e selectors `.hh-summary`,
`.replay-btn` and the route names still resolve).

## Pins

Committed first against the old pages and unchanged after: every printed
figure (`tests/helpers/moneyFigures.ts`), the printed text, named regions and
controls with pressed, expanded and disabled state.

- `tests/components/handHistoryPageIsPinned.test.tsx`: loaded, a hand expanded,
  filtered to nothing, the tournament view, opened from Player Stats, empty,
  failed, first read in flight, Load More in flight.
- `tests/components/transactionHistoryPageIsPinned.test.tsx`: loaded with
  earlier movements, an earlier page in flight, empty, failed, first read in
  flight, the Diamond history door.
- Scoping: `tests/unit/handHistoryArenaDressIsScoped.test.ts`,
  `tests/unit/transactionHistoryArenaDressIsScoped.test.ts`.

## Skipped

`RakebackPage.tsx` and `SessionHistoryPage.tsx`: open PR #12313 edits both.
