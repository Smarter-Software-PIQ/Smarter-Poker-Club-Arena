# holdemOopReraiseRangeHoldsVsReraise: Authority For The Live Switch

Built 2026-11-24 by PLO-LEAD-6 beside `omahaOopReraiseRangeHoldsVsReraise` (live NLH cash, 7 days to 2026-11-24 07:00Z: the Horse's out-of-position 3-bets that were 4-bet folded 74.8% against a 61.4% break-even, n 1,404). Evidence NOT MET: the audited-decision scorer and the league card were not run; the generated-state replay below is the only grade. This file does not authorize switching the option on.

## What It Does

No-limit hold'em cash tables (never tournaments, Short Deck, Lightning), the Horse out of position facing one open with no caller. The same rule and receipt as `omahaOopReraiseRangeHoldsVsReraise` (`server/src/engine/HorseOopReraiseRangeHolds.ts`): EV(3-bet) priced on the opener's answer to a 3-bet (his measured fold to a 3-bet shrunk to the fitted NLH population answer) and the Horse's own answer to the 4-bet (priced at 2.3x the 3-bet) at the real depth, against the call or 0; a planned fold stands only for an ace at the seeded keep frequency the cap asks for. Equity is `holdemRangeEquity` against STRENGTH_ORDER bands; realization uses the engine's measured re-raised-pot realization (`omahaPreflopDefenceRealization`, fitted on Omaha calls: hold'em has no fit of its own, stated as a limit). A rejected 3-bet calls only where the brain's own call bar for the spot (strength >= callThreshold on the range-play read receipt) admits the call and EV(call) >= 0; otherwise it folds.

Receipts: `holdem_oop_reraise_range_holds_kept`, `_blocker_kept`, `_called`, `_folded`, `_unpriced`; numbers on the decision (`oopReraiseRangeHolds`). The validator admits the raise -> call only under the decision's own option; the raise -> fold is the existing NLH fold admission.

Default OFF in source (read `=== true`), registered in the option switch, switchable live.

## What Was Measured

@@NLH_TABLE@@

## Replay

- Replay: NOT RUN (the audited-decision scorer was not run; the generated-state replay above, server/scripts/oop-reraise-range/replay.ts, is the only grade)
