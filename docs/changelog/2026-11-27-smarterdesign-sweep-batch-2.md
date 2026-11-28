# #SmarterDesign sweep, batch 2: reports, Lightning, Player Offers, Cashier Statements

Dan, 2026-11-27: the painted console frames are "the old style"; pages use
#SmarterDesign, the arena workspace language Player Management, the Cashier
and Club Operations already wear. Batch 2 follows the batch 1 patterns
(`docs/club-operations/SMARTERDESIGN-INVENTORY.md`).

- Bomb Pot Report and Insurance Report: the painted console became the thin
  chrome case through `ClubPageSection` with `arena`; the 7 / 30 / 90 day
  window is one chrome switch lit by aria-pressed; the totals are chrome
  meters; every table or day is a chrome ledger row with its figures beneath;
  Back / Export CSV are chrome keys with Export lit. `family` stays on each
  console tag, as `tests/unit/dataReportScopeIdentity.test.ts` reads it.
- Lightning operations: the overview and the Cluster detail moved to the chrome
  case. Every in-page choice and action group is a chrome switch; each Cluster
  and integrity signal is a chrome row; fields are dark wells. The control
  confirmation dialogs portal to the body and keep their popup chassis, and
  every new rule is scoped to `.arena-workspace` so they are untouched.
  Destructive controls keep their red ink. The phase 12 and 13 tests stub
  `ClubPageSection` with the same stand-in they used for `SpadeConsole`.
- Player Offers (`PromotionsPage`): `RewardsSurfaceHeader` gained an opt-in
  `arena` prop; only Promotions passes it, so the other 18 pages on that
  header are unchanged. Views are a chrome switch, each offer a chrome row,
  Claim a lit chrome key, Invite Friends / Daily Bonus the case's keys.
- Cashier Statements: each section is a chrome case, the range and filter
  choices chrome switches, the totals chrome meters, every entry a chrome
  ledger row, the actions chrome keys, and the fields dark wells.

Markup and CSS only. Every handler, guard, string, role and aria label is
unchanged. Renders: before and after at 393px and 1440px.
