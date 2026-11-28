# #SmarterDesign batch D1: Earn Diamonds, the Lightning entry and Flash Pool

Three player pages that still wore painted consoles or flat inline boxes now
wear the arena workspace (`.claude/skills/smarter-design/SKILL.md`):

- `/clubs/:clubId/earn-diamonds` (`DiamondEarnPage`): chrome mast, the
  Diamond Spins tabs as a chrome switch, every console an arena case with
  one lit key. `DiamondSpinsTabs` gained an opt-in `arena` prop; the wheel,
  bonus games and the four games keep their printed links.
- `/lightning/:clusterId` (`LightningEntryPage`): chrome mast around every
  state; the EmptyState screens became chrome cases in the same words; the
  approved Lightning card is unchanged.
- `/flash-pool` (`FlashPoolPage`): chrome mast, a chrome case per pool with
  readout tiles, a dark buy-in well and Play lit. Play still never joins.

No diamond amount, stake, buy-in, word, control, confirmation or behaviour
changed: each page was pinned on main first (`tests/components/*IsPinned`)
and the pins pass unchanged. Every new rule is scoped under the page's arena
root (`tests/unit/diamondD1ArenaDressIsScoped.test.ts`); the arena sheets
load only from these lazily loaded pages.

DiamondGamesPage was skipped: open PR #12313 edits it.
