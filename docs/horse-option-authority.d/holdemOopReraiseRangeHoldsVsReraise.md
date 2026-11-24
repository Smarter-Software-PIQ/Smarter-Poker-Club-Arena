# holdemOopReraiseRangeHoldsVsReraise: Authority For The Live Switch

Built 2026-11-24 by PLO-LEAD-6 beside `omahaOopReraiseRangeHoldsVsReraise` (live NLH cash, 7 days to 2026-11-24 07:00Z: the Horse's out-of-position 3-bets that were 4-bet folded 74.8% against a 61.4% break-even, n 1,404). Evidence NOT MET: the audited-decision scorer and the league card were not run; the generated-state replay below is the only grade. This file does not authorize switching the option on.

## What It Does

No-limit hold'em cash tables (never tournaments, Short Deck, Lightning), the Horse out of position facing one open with no caller. The same rule and receipt as `omahaOopReraiseRangeHoldsVsReraise` (`server/src/engine/HorseOopReraiseRangeHolds.ts`): EV(3-bet) priced on the opener's answer to a 3-bet (his measured fold to a 3-bet shrunk to the fitted NLH population answer) and the Horse's own answer to the 4-bet (priced at 2.3x the 3-bet) at the real depth, against the call or 0; a planned fold stands only for an ace at the seeded keep frequency the cap asks for. Equity is `holdemRangeEquity` against STRENGTH_ORDER bands; realization uses the engine's measured re-raised-pot realization (`omahaPreflopDefenceRealization`, fitted on Omaha calls: hold'em has no fit of its own, stated as a limit). A rejected 3-bet calls only where the brain's own call bar for the spot (strength >= callThreshold on the range-play read receipt) admits the call and EV(call) >= 0; otherwise it folds.

Receipts: `holdem_oop_reraise_range_holds_kept`, `_blocker_kept`, `_called`, `_folded`, `_unpriced`; numbers on the decision (`oopReraiseRangeHolds`). The validator admits the raise -> call only under the decision's own option; the raise -> fold is the existing NLH fold admission.

Default OFF in source (read `=== true`), registered in the option switch, switchable live.

## What Was Measured

Generated-state replay (`server/scripts/oop-reraise-range/replay.ts`; the production options of 2026-11-24 about 07:10Z; a six-seat cash table, the Horse out of position facing one open at four seats (big blind against the cutoff, the button and under the gun; small blind against the button); seeded uniform deals, 400 per seat, read and depth in PLO and 1,500 in NLH; the opener unread, read as a wide re-raiser (counters shaped like PFR 60%, fold to a 3-bet 0) or as a tight opener (PFR 12%, fold to a 3-bet 70%); the 4-bet pot-sized in PLO and 2.3x the 3-bet in NLH, the Horse's answer asked at a separate 4-bet node; the strategy stream from spread seeds). Off is today's brain (arm offm), on the option (arm on5: keep table 2026-11-24.v3, margin 0.08, each branch raked on its own pot). Cap 0.45.

NLH: 3-bet % of dealt / share of the 3-bets that fold to the 4-bet (n 3-bets); off -> on

| depth  | all reads                          | unread                            | wide re-raiser read             | tight read                        |
| ------ | ---------------------------------- | --------------------------------- | ------------------------------- | --------------------------------- |
| 60 bb  | 11.8% / 27% -> 5.6% / 19% (n 1005) | 7.5% / 63% -> 4.4% / 39% (n 265)  | 20.5% / 0% -> 8.2% / 0% (n 491) | 7.5% / 63% -> 4.2% / 36% (n 249)  |
| 100 bb | 15.2% / 43% -> 4.9% / 25% (n 881)  | 12.5% / 78% -> 4.5% / 42% (n 272) | 20.5% / 0% -> 5.7% / 0% (n 342) | 12.5% / 78% -> 4.5% / 40% (n 267) |
| 150 bb | 15.2% / 44% -> 4.1% / 23% (n 730)  | 12.5% / 79% -> 3.6% / 36% (n 219) | 20.5% / 0% -> 4.7% / 0% (n 283) | 12.5% / 79% -> 3.8% / 39% (n 228) |
| 200 bb | 15.2% / 45% -> 3.6% / 26% (n 647)  | 12.5% / 81% -> 3.2% / 41% (n 191) | 20.5% / 0% -> 4.3% / 0% (n 258) | 12.5% / 81% -> 3.3% / 43% (n 198) |
| 300 bb | 15.2% / 49% -> 2.1% / 17% (n 380)  | 12.5% / 88% -> 1.5% / 37% (n 89)  | 20.5% / 0% -> 3.3% / 0% (n 198) | 12.5% / 88% -> 1.6% / 35% (n 93)  |
| 400 bb | 15.2% / 49% -> 2.0% / 18% (n 367)  | 12.5% / 88% -> 1.5% / 36% (n 88)  | 20.5% / 0% -> 3.1% / 0% (n 186) | 12.5% / 88% -> 1.6% / 35% (n 93)  |
| 800 bb | 15.2% / 49% -> 1.6% / 16% (n 295)  | 12.5% / 88% -> 1.0% / 34% (n 62)  | 20.5% / 0% -> 2.8% / 0% (n 168) | 12.5% / 88% -> 1.1% / 38% (n 65)  |

Reading. Today the unread NLH range folds 78-88% to the 4-bet at 100 bb and deeper. On, every row is under the cap (highest 43%, the tight read at 200 bb). The 3-bet rate falls from 7.5-20.5% to 1.0-8.2%: at 150 bb and deeper the range is JJ+ 36%, AK 28%, ace-blocker planned folds 26%; at 60-100 bb ace blockers 42%. Many rejected 3-bets become the calls the brain's own call bar admits (priced at or above 0).

Not run: the audited-decision scorer, the league card, a live read. Hold'em realization uses the Omaha re-raised-pot fit (no hold'em fit exists): stated as a limit.

## Replay

- Replay: NOT RUN (the audited-decision scorer was not run; the generated-state replay above, server/scripts/oop-reraise-range/replay.ts, is the only grade)
