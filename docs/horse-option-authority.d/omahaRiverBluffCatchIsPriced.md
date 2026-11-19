# omahaRiverBluffCatchIsPriced: authority for the live switch

Built 2026-11-18 (WooWoo PLO5 audit, lane TURN-RIVER; live evidence A/repairs/LIVE-VERIFY/DAILY/2026-11-18.md: heads-up Horses fold to a human's first river bet 80% at 0.40-0.60 pot, n 30, break-even 34%, and 83% at 0.85-1.10 pot, n 30, break-even 50%). Evidence NOT MET: the declared evaluation (A/repairs/RIVER-FACING/EVAL-DECLARATION.md, sha256 0baf22ed...) FAILED on 2026-11-18 (EVAL-RESULTS.md): cross-fitted delta -1.46 bb per spot [-8.07, +5.58] on 228 heads-up first river bets, 3 S-08 changes. The serving folds were right on average (folded hands' true equity 0.189 against a price of 0.294; calling them all would cost 11.6 bb each): the measured bettors under-bluff the river. This file does not authorize switching the option on.

## What it does

Inside `omahaFacingBetEv` only (PLO4/PLO5 cash, no tournament, one board, high only), a heads-up FIRST river bet (not a raise; no caller, no earlier all-in, nobody behind). Everything else (turn, multiway, raises, six-card hands, tournaments) is the verdict that serves today, key for key.

1. Range composition, measured: the strength percentile u (share of all holdings on the board that beat it) of the bettor's actual holding in every heads-up first river bet a Horse faced in the audit window (n 269; rows `bin:potShare` in `OMAHA_RIVER_BETTOR_ROWS`, source sha256 5ef47bd379f0ef52fe0622659d5cc863d9adb58daa2a049fd55155e7e3b142cf). Read at the bet's pot share by a Gaussian kernel in log pot share (Silverman bandwidth on the same rows), Jeffreys prior per bin. The pot share is the point the measured distribution is read at, never a threshold.
2. Blockers: the bin's weight is pi_b x p_b / r_b (share of the bin among holdings left given the Horse's cards over its share among all holdings).
3. The player: the bins that lose to the median holding (u >= 0.5) are multiplied by his measured tendency, omahaEvBluffShare / prior (the read that serves today); nothing keyed to an account.
4. EV = equity x (pot after call, rake off) - call; no realization (river). SE from the Dirichlet on the bin masses (kernel effective n) and the within-bin sampling; outside 2 SE of the margin the sign decides, inside the call is mixed with probability Phi(edge/SE) on a public-state draw (own salt).

## Declared limits (must be addressed or accepted before activation)

- The table is measured on PLO5 rows only (the audit window had no PLO4 heads-up river bets with cards); PLO4 reads the PLO5 table.
- The bettor's line (bet or checked the turn) is not a stratum (n too small); one human supplies about half the rows (concentration WARN in the daily report).
- Raises are out of scope (12 measured rows).

## Activation

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256, after the declared evaluation passes. Rollback: switch row off.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
