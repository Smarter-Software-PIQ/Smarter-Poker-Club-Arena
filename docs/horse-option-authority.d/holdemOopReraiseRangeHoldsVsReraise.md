# holdemOopReraiseRangeHoldsVsReraise: Authority For The Live Switch

Built 2026-11-24 by PLO-LEAD-6 beside `omahaOopReraiseRangeHoldsVsReraise` (live NLH cash, 7 days to 2026-11-24 07:00Z: the Horse's out-of-position 3-bets that were 4-bet folded 74.8% against a 61.4% break-even, n 1,404). Evidence NOT MET: the audited-decision scorer was not run; the generated-state replay and the league runs below (mirror and heads-up exploit probes) are the only grades. This file does not authorize switching the option on.

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

Not run: the audited-decision scorer, a live read (the league runs are in the next section). Hold'em realization uses the Omaha re-raised-pot fit (no hold'em fit exists): stated as a limit.

## League (chips), 2026-11-24

Harness `server/scripts/oop-reraise-range/league.ts`; the production options of 2026-11-24 in both arms, the option (and nothing else) added in ON; same seeds; one niced job at a time; no database. bb/100 ± standard error. Not the declared league card (`nlh_holdem_oop_reraise_range_holds_vs_reraise`), whose arms carry no production options.

Mirror (HorseLeague `runMatchup`, production styles; half the seats ON, half OFF, swapped): NLH 6-max 100 bb, 12,000 hands: ON +1.0 ± 2.5, OFF -1.0.

Exploit probes (ExploiterLeague `runExploiterCell`, heads-up, the script in seat 0 with memory on; the script is the production Horse with the option OFF except its answer to the Horse's 3-bet of its own button open: a 4-bets every such 3-bet (2.3x), b 4-bets only with aces or kings and otherwise never re-raises, c calls every such 3-bet). 12,000 hands per arm on the same deals; the Horse's bb/100 against the script, and ON - OFF differenced hand by hand (`ExploiterCellSpec.onPair`). Fold to 4-bet: the share of the Horse's out-of-position 3-bets that folded when script a 4-bet them.

| depth  | probe | OFF          | ON           | ON - OFF     | 3-bets OFF -> ON | fold to 4-bet OFF -> ON |
| ------ | ----- | ------------ | ------------ | ------------ | ---------------- | ----------------------- |
| 100 bb | a     | -53.4 ± 11.0 | +8.7 ± 10.9  | +62.1 ± 7.8  | 928 -> 278       | 76% -> 27%              |
| 100 bb | b     | +9.9 ± 9.1   | -15.5 ± 8.8  | -25.4 ± 7.1  | 1019 -> 322      |                         |
| 100 bb | c     | +20.6 ± 12.1 | +6.2 ± 9.8   | -14.4 ± 9.0  | 901 -> 273       |                         |
| 300 bb | a     | -85.0 ± 17.0 | +13.4 ± 16.4 | +98.4 ± 13.7 | 930 -> 139       | 82% -> 5%               |
| 300 bb | b     | +9.9 ± 15.8  | -16.2 ± 13.9 | -26.1 ± 11.8 | 1001 -> 152      |                         |
| 300 bb | c     | +11.5 ± 19.9 | -3.7 ± 15.1  | -15.3 ± 15.8 | 926 -> 137       |                         |

Tuning (NLH heads-up 100 bb, 12,000 hands per arm; ON - OFF):

| setting                                                              | a           | b           | c           | fold to 4-bet vs a |
| -------------------------------------------------------------------- | ----------- | ----------- | ----------- | ------------------ |
| default: cap 0.45, ace blockers                                      | +62.1 ± 7.8 | -25.4 ± 7.1 | -14.4 ± 9.0 | 27%                |
| cap at the bluff break-even (`horse.reraiseFoldShareCap` 1, clamped) | +50.0 ± 7.8 | -19.4 ± 6.9 | not run     | 46%                |
| ace or king blockers (development switch, not committed)             | +60.3 ± 8.2 | -18.5 ± 6.8 | -26.2 ± 9.1 | 37%                |
| ace or king blockers, cap at the break-even                          | +45.8 ± 7.5 | -10.5 ± 6.4 | -19.2 ± 9.0 | 54%                |

Decomposition (6,000 hands per arm): the planned-fold rule alone (EV test off) a +72.9 ± 12.0, b -28.1 ± 10.1, c -2.3 ± 14.1; the EV test alone (planned folds not rejected) a +31.2 ± 11.1, b -4.5 ± 8.9, c -16.2 ± 12.6.

Reading. Heads-up today's NLH Horse folds 76-82% of its out-of-position 3-bets to a 4-bet, and the always-4-bet script takes 53-85 bb/100 from it; ON cuts that share to 27% (100 bb) and 5% (300 bb) and turns the loss into a small win (+62 and +98 bb/100). The heads-up out-of-position 3-bet count falls three times at 100 bb (901-1,019 -> 273-322 per 12,000 hands) and six to seven times at 300 bb (926-1,001 -> 137-152). Against scripts that do not 4-bet light, ON costs chips: about -25 bb/100 against b at both depths (3.6 and 2.2 standard errors) and -14 to -15 against c (1.6 and 1.0). The cost is mostly the planned-fold rule: with no measured 4-bet rate (the opener's call : 4-bet split is the population's), it removes the hands that would fold to a 4-bet whether or not this opener ever 4-bets. Raising the cap or widening the blockers moves chips from a to b and does not fix c (the differences between settings are inside the noise: the same settings against c read -26 to -14). No setting tried wins against all three; the default is kept. The six-max mirror is neutral. Recommendation: keep the option off until the opener's answer to a 3-bet (`openFacesThreeBet`, defined in `HorseOopReraiseRangeHolds.ts`, not stored) is carried per player, so that the planned-fold rule binds in proportion to how often this opener 4-bets.

## Replay

- Replay: NOT RUN (the audited-decision scorer was not run; the generated-state replay above, server/scripts/oop-reraise-range/replay.ts, is the only grade)
