# Real figures are never rounded or abbreviated

Dan, 2026-11-13, with a Player Management screenshot (KingFish -1.5K, Burls
+393, Bud33 +1K, Today +1K): "IN THE PLAYER MANAGEMENT OR ANYWHERE REAL DATA IS
STORED. I DON'T WANT ROUNDED UP NUMBERS LIKE 393 OR 1.5K OR 1K USE WHOLE NUMBERS
AND DECIMALS ALWAYS ... FIX THIS LOGIC GLOBALLY FOR THE POKER ARENA."

## Cause

One shared formatter, `compactChips` in `src/utils/format.ts`, floored every
figure and abbreviated anything over 1,000 to K/M/B (the 2026-09-09
#ClubArenaConsole rule). `winLossChips` (Player Management win / loss) wrapped
it, and about 490 call sites across the app used it for money and counts.
`fmtChips` abbreviated with `toFixed(1)`, and a few surfaces carried private
copies: the tournament HUD and clock, the Club Data Simple tiles, the weekly
statement figure, the activity chart axis, and four "Under 1 Chip" branches
that hid real cents.

## Fix

- `exactChips` is the single figure formatter: thousands separators, no
  suffix, cents kept whenever the stored value has them.
- `compactChips` and `fmtChips` now return `exactChips`, so every call site is
  exact without churn.
- `winLossChips` prints a signed figure to the cent, always two decimals, so
  Player Management's win / loss lines up with the fee and wallet figures.
- The private K/M helpers and the "Under 1 Chip" branches are removed;
  `formatWalletDiamonds` no longer compacts above a million.
- The tournament tab pill prints the exact buy-in; its glyph budget is the
  ten the sub-line already fits (every buy-in through 9,999,999).
- The e2e funding verdict reads a separator-grouped whole figure as exact.

## Pinned

`tests/real-figures-are-never-abbreviated.law.test.ts` (registered in
`docs/laws.d/`). Every test that pinned the old compact output was updated in
the same commit.
