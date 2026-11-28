# #SmarterDesign: finishing the partial operator pages (2026-11-28)

The generated #SmarterDesign inventory listed eleven operator pages as
Partial: wearing the arena workspace, but missing the chrome mast or still
hosting one painted console panel. This pass finishes seven of them.

## Masts added

- **Custom Messages** (`ClubWelcomeMessagePage`) and **Banner Displays**
  (`ClubBannerDisplaysPage`): the PageBar head (a hidden title and the "?")
  is now `ArenaWorkspaceHeader` (area `control`) with the same title, the
  same help summary and the club's name. Their cases dropped the 52px top
  margin that cleared the old floating "?".
- **Bomb Pots** (`TableBombSettingsPage`): the mast (area `dashboard`) on the
  ready, loading and error states.
- **Cashier Statement** (`CashierStatementsPage`): the mast (area `cashier`,
  title Cashier) heads the page; Back To Cashier moved above it, one key
  wide. `CashierWorkspace` takes `hasVisibleTitle`, so its page bar keeps
  only the live status pill.

## Painted panels moved to the chrome

- **Jackpot Announcements** (`BBJThresholdPanel`, Club Settings): the
  chrome case (`ClubPageSection arena`), one chrome row per threshold, chrome
  keys for Turn On / Off and Remove, dark wells, Add Announcement lit.
- **Promotion standings** (`LeaderboardCard`, Player Offers): its own frame
  is the chrome case; inside an offer row the standings use the workspace
  inks, with Retry Rankings as a chrome key.
- **Performance Score** (`AgentScoreCard`, Agent Dashboard): the page already
  seats it in a chrome case, so it prints no second frame: section title
  with the grade, the overall score on a readout tile, chrome rows.

Each panel has a single host page with an arena root, and its dress is scoped
under `.arena-workspace`.

## What did not change

Every handler, guard, hook, read, string, role, aria attribute, number format
and data hook is the same. Classes were only added, except one: the
LeaderboardCard `.glass .error button` lit-word rule was retired because it
competed with the chrome switch for that button. No e2e selector names it.
`tests/components/LeaderboardCard.test.tsx` now counts the chrome case where
it used to count the painted frame.

## Proof

- Pinned before the change, unchanged after:
  `tests/components/partialOperatorMastPagesArePinned.test.tsx`,
  `tests/components/cashierStatementsMastIsPinned.test.tsx`,
  `tests/components/partialOperatorPanelsArePinned.test.tsx` (figures, words,
  data hooks, regions and control states, through `tests/helpers/surfacePin.ts`,
  which leaves out only the page head).
- Scope, single host and no new gradient, radius, shadow, hover or uppercase:
  `tests/unit/partialOperatorPanelsArenaIsScoped.test.ts`.
- Before and after renders at 393 and 1280 from the full-page harness. Its
  fixtures now answer the statement, jackpot threshold, bomb row, offers and
  score reads.

Still Partial: TournamentDetails, SettlementDashboardPage and
UnionStatementsPage (left for a later batch, as assigned), and
GameManagementPage.
