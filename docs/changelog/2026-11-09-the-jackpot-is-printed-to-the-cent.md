# The Bad Beat Jackpot is printed to the cent (2026-11-09)

Owner instruction, with a screenshot of the Kings Club jackpot popup: "for the
bbj display the full amount down to the decimal and the exact amounts for the
payouts... no rounded numbers. use exact numbers 100% of the time."

## What was wrong

The popup printed a 5,022.37 payout as "5K" and the 2,511.18 the bad beat hand
received as "+2.5K" (`compactChips`), and its header cut the 15,379.83 pool to
"15,379" (`Math.trunc`). The rules and stakes tables rounded every projected
payout to a whole chip (`Math.round`), the felt plate dropped the cents from
1,000 up, and the union pages abbreviated the pool with `fmtChips`.

## Cause

Display only. Every figure is stored to the cent: `bbj_pools.main_balance`,
`bbj_payouts.total_amount` and `bbj_payout_recipients.amount` are
`numeric(…,2)`. The surfaces followed the 2026-09-09 forward-facing compact
rule; today's instruction takes the jackpot out of it (recorded under
"Resolved conflicts" in `docs/LAWS.md`).

## Repair

`src/utils/jackpotExact.ts` is the one formatter for a jackpot chip amount:

- `jackpotChips` - separators and both decimals, never a suffix, never rounded;
- `jackpotTotalAtPercent` / `jackpotSplit` - a projected payout by the payout
  RPC's own arithmetic (`ROUND(main * pct / 100, 2)`, `ROUND(total * 0.50, 2)`,
  `ROUND(total * 0.25, 2)`, the table takes the rest), on integer cents;
- `jackpotPercent` - a percentage as it is, replacing `Math.round`.

Surfaces moved to it: the popup header, Winner rows, Basic and Mini pages
(`BBJInfoModal`, `BBJRecentHits`, `BBJBasicPanel`), `BBJRulesPanel`,
`BBJThresholdPanel`, `BBJMiniPanel`, `BBJAdminAnalytics`, the felt plate and
mini plate (`BadBeatJackpot`), `BadBeatJackpotPage`, and the jackpot banks on
`UnionGamesPage` and `UnionDashboardPage`. "About X Today" now reads "X If It
Hits Now", the wording the stakes table already used.

Unchanged because they were already exact: the lobby jackpot button, the hand
detail, the hit notification, the celebration and the seat credit. Diamond
jackpots are whole by custody and keep their own readout.

## History

No stored amount was changed. Read on production (2026-11-09): 220 rows in
`bbj_payouts`, every total at two decimals, every row's three shares adding to
its total, and every row's recipients (plus unpaid shares) adding to its total.
Past winners therefore print exactly from the same rows with no data
correction.

## Regression protection

`tests/the-jackpot-is-printed-to-the-cent.law.test.ts` (registered in
`docs/laws.d/`) pins the formatter, the payout arithmetic against production
payout `ad64a2d1` and refuses `compactChips`, `fmtChips`, zero-decimal `money`
and `Math.round/trunc(...).toLocaleString` on every jackpot chip surface.
Moved in the same change: `tests/bbj-history-total-payout.test.tsx`,
`tests/jackpot-initial-layout.test.tsx` and the mini plate pin in
`tests/the-mini-is-seen-and-discoverable.law.test.ts`.

## Delivery

Client only: no engine, schema or migration change.
