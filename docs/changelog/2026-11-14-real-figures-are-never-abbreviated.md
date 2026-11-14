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

## Precision reconciliation (2026-11-14, follow-up)

**Cashier totals checked against the ledger.** Transaction History for KINGS
CLUB (club book, All kinds, All Time) showed 16,300 entries, 154,319,405.23
chips moved and 24,440.80 cash-outs paid. A plain read-only `SELECT` over
`chip_transactions` with the same club and type filters, cut off at the capture
time, returns 16,300 / 154,319,405.23 / 24,440.80. The last row is at 06:50
UTC, before both captures, so it is the same snapshot. (The summary RPC itself
caches closed days, so it was not called again for this check.)

**Supported precision versus the old 8-place cap.** Declared types reaching
these formatters include numeric(20,2) (`club_members.chip_balance`,
`bbj_payouts.total_amount`), numeric(18,2) (`tournaments.prize_pool`,
`agents.agent_wallet_balance`) and 792 unconstrained numeric columns
(`cashier_club_day_totals.volume`, `chip_ledger.post_to_balance`,
`club_members.held_chips`, `tournaments.bounty_pool_paid`). A JavaScript number
holds 15 significant digits exactly, and the 8-place cap printed a real ninth
decimal as zero. Live data today peaks at 282,300,352.00 with scale 2, so
nothing displayed wrongly, but supported values could. Fixed:

- `figureDigits` / `figureMagnitude` in `src/utils/format.ts`: a string or
  bigint figure is copied digit for digit with no limit; a number keeps all 15
  significant digits a double holds exactly (0.000000001 stays itself; binary
  noise such as 0.30000000000000004 is not a stored digit). Every shared
  formatter (`exactChips`, `compactChips`, `fmtChips`, `feeFigure`,
  `formatWalletChips`, `winLossChips`, `formatChips`, `formatSignedChips`)
  accepts strings and goes through it.
- The cashier history summary keeps the RPC's exact text totals
  (`volume`, `cashouts_paid`, `incoming`, `outgoing`, `net`) instead of
  converting them with `Number()`; signs are read from the digits.
- Already exact and unchanged: `formatWeeklyChipsForDisplay` (BigInt, canonical
  2-decimal text) and the conservation report (BigInt, 30 integer and 12
  fractional digits, refusing rather than rounding anything wider).

Regressions: `tests/real-figures-are-never-abbreviated.law.test.ts` ("keeps
every digit a supported data source can hold") and
`tests/cashier-club-load-order.test.tsx` (a 20-digit club total renders digit
for digit). Values PostgREST returns as JSON numbers are parsed by the browser
before any formatter sees them; for those, the 15-digit bound applies at the
read, far above every live value.

## No noise guessing; decimal text on the Player Management read (follow-up)

The 15-significant-digit number path could itself discard a meaningful digit,
and it decided by appearance what counted as noise. Now:

- A number prints the exact decimal it denotes (shortest round-trip form,
  exponent expanded). Decimal text and bigints are copied digit for digit.
- Client arithmetic applies the explicit chip rule, cents, before formatting:
  `chipCents` / `sumChips` at every inline sum, difference or average passed to
  a chip formatter (union treasury nets, wallet previews in the transfer and
  union wallet modals, cashier previews, union buy-in, union treasury total,
  agent commission total, tournament results, session profit per hand,
  Lightning owed blinds). `exactChipFigure` (cashier amounts, all scale-2
  sources) applies cents to numbers and prints text exactly.
- Player Management's list reads `ca_club_members_period_summary` with
  `net::text`, `fees::text` and `downline_fees::text`, and prints that text
  (W/L, fees, downline fees and the fee tooltip). The numbers stay for sign and
  sort.

Still JSON numbers, so the read itself is exact only to 15 significant digits
(every value up to 9,999,999,999,999.99 at cents): the Player Management wallet
balance and member record (`ca_club_members_page`, `ca_club_member_win_loss`
return jsonb, so a fix is a SQL change), the cashier roster wallets
(`fn_club_cashier_members_page_v3`) and history rows (`fn_cashier_history_feed`).
Live maxima: member wallet 19,392.60, agent wallet 209,693.62.
