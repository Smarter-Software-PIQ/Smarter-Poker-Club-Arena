# omahaOopReraiseRangeHoldsVsReraise: Authority For The Live Switch

**State: OFF since audit #200, 2026-11-26T03:06:44Z.** Built 2026-11-24 by PLO-LEAD-6 from the trace of hand a6f9206d-3a5e-4a7f-8c7c-65c67fcb2778 (OOP-3BET-FOLD-TRACE.md). Evidence NOT MET: the audited-decision scorer was not run; the generated-state replay and the league runs below (mirror and heads-up exploit probes) are the only grades. This file does not authorize switching the option on.

## What It Does

PLO4/PLO5 cash tables (never Lightning, PLO6, tournaments, hi-lo, bomb pots or more than one board), the Horse out of position facing one open with no caller (`server/src/engine/HorseOopReraiseRangeHolds.ts`, wired by `HorseOopReraiseRangeHoldsWiring.ts`). A 3-bet the brain chose stands only when

- EV(3-bet) = phi x P0 + kappa x [R x eq(h | his calling band) x Pot3 x (1 - rake) - I3] + rho x V4 is at least the priced call the existing calling rule admits (`omahaDowngradedThreeBetCalls`, coordinated hands and aces or equity past the price plus the margin) or 0; and
- the Horse's own answer to the pot 4-bet, asked on the public 4-bet frame (a side ask with the option off, no learning, intent writes discarded, the three random streams put back), is not a fold, unless the hand holds an ace and the seeded keep unit (a hash of the Horse's id, the pot and its own cards, recorded on the receipt) is under the keep frequency that holds the out-of-position 3-bet range's fold-to-4-bet share at or under `horse.reraiseFoldShareCap` (default 0.45, never above the 4-bettor's pure-bluff break-even for the size).

phi / kappa / rho are how the opener answers a 3-bet: his own decayed fold to a 3-bet (public counters foldTo3Bet / foldTo3BetOpp) shrunk to the fitted population answer (`OPENER_ANSWERS_PRIOR` 2026-11-24.v1, by game and depth, fitted by `server/scripts/oop-reraise-range/fit-opener-answers-three-bet.ts` on a read-only hand_history pull of 58,681 hands; the continuing share split call : 4-bet as the population splits it). The opener's band is `HorseMind.bandFor` of his line, the 4-bet band its top rho share and the calling band the next kappa share. Equity is the engine's seeded sampler; realization is the engine's measured out-of-position realization by depth after the call and by the call's own equity (`omahaPreflopDefenceRealization`). V4 is the value of the Horse's own answer: fold -I3, call R x eq(4-bet band) x Pot4 x (1 - rake) - I3 - C4, raise the stacks in against the 4-bet band.

A rejected 3-bet becomes the call where the calling rule admits it and EV(call) >= 0, otherwise the fold. The rule never adds a call the calling rule refuses and never adds a 3-bet. Where both are on it supersedes nothing: `omahaReraiseRangeOutOfPosition` still judges a 3-bet this rule keeps.

Receipts: `omaha_oop_reraise_range_holds_kept`, `_blocker_kept`, `_called`, `_folded`, `_unpriced`; every number on the decision (`oopReraiseRangeHolds`). The response validator admits the raise -> call only under the decision's own option (`oopReraiseRangeHoldsGate`), in the spot re-derived from the request, for the exact chips of the call; the raise -> fold is the existing PLO fold admission.

Default OFF in source (read `=== true`), registered in the option switch, switchable live; scopable per game (`horse.omahaGameScope.omahaOopReraiseRangeHoldsVsReraise`).

## What Was Measured

Generated-state replay (`server/scripts/oop-reraise-range/replay.ts`; the production options of 2026-11-24 about 07:10Z; a six-seat cash table, the Horse out of position facing one open at four seats (big blind against the cutoff, the button and under the gun; small blind against the button); seeded uniform deals, 400 per seat, read and depth in PLO and 1,500 in NLH; the opener unread, read as a wide re-raiser (counters shaped like PFR 60%, fold to a 3-bet 0) or as a tight opener (PFR 12%, fold to a 3-bet 70%); the 4-bet pot-sized in PLO and 2.3x the 3-bet in NLH, the Horse's answer asked at a separate 4-bet node; the strategy stream from spread seeds). Off is today's brain (arm offm), on the option (arm on5: keep table 2026-11-24.v3, margin 0.08, each branch raked on its own pot). Cap 0.45.

PLO4: 3-bet % of dealt / share of the 3-bets that fold to the 4-bet (n 3-bets); off -> on

| depth  | all reads                         | unread                          | wide re-raiser read             | tight read                      |
| ------ | --------------------------------- | ------------------------------- | ------------------------------- | ------------------------------- |
| 60 bb  | 11.5% / 4% -> 7.2% / 0% (n 345)   | 7.9% / 0% -> 5.8% / 0% (n 92)   | 18.8% / 7% -> 7.9% / 0% (n 126) | 7.9% / 0% -> 7.9% / 0% (n 127)  |
| 100 bb | 11.5% / 10% -> 5.2% / 1% (n 250)  | 7.9% / 0% -> 3.4% / 0% (n 55)   | 18.8% / 19% -> 4.2% / 4% (n 68) | 7.9% / 0% -> 7.9% / 0% (n 127)  |
| 150 bb | 11.5% / 33% -> 3.5% / 10% (n 170) | 7.9% / 50% -> 3.2% / 17% (n 52) | 18.8% / 19% -> 3.9% / 0% (n 62) | 7.9% / 50% -> 3.5% / 14% (n 56) |
| 200 bb | 11.5% / 40% -> 3.0% / 17% (n 143) | 7.9% / 65% -> 2.9% / 33% (n 46) | 18.8% / 19% -> 3.1% / 0% (n 49) | 7.9% / 65% -> 3.0% / 19% (n 48) |
| 300 bb | 11.5% / 49% -> 2.3% / 17% (n 109) | 7.9% / 78% -> 2.2% / 33% (n 36) | 18.8% / 25% -> 2.6% / 0% (n 42) | 7.9% / 78% -> 1.9% / 23% (n 31) |
| 400 bb | 11.5% / 53% -> 1.9% / 21% (n 92)  | 7.9% / 78% -> 2.2% / 33% (n 36) | 18.8% / 31% -> 1.6% / 0% (n 25) | 7.9% / 78% -> 1.9% / 23% (n 31) |
| 800 bb | 11.5% / 78% -> 2.4% / 19% (n 114) | 7.9% / 78% -> 2.4% / 38% (n 39) | 18.8% / 78% -> 2.5% / 0% (n 40) | 7.9% / 78% -> 2.2% / 20% (n 35) |

PLO5: 3-bet % of dealt / share of the 3-bets that fold to the 4-bet (n 3-bets); off -> on

| depth  | all reads                        | unread                          | wide re-raiser read             | tight read                      |
| ------ | -------------------------------- | ------------------------------- | ------------------------------- | ------------------------------- |
| 60 bb  | 9.1% / 4% -> 5.5% / 2% (n 264)   | 5.6% / 0% -> 4.2% / 0% (n 67)   | 16.0% / 6% -> 6.7% / 4% (n 107) | 5.6% / 0% -> 5.6% / 0% (n 90)   |
| 100 bb | 9.1% / 10% -> 3.8% / 0% (n 183)  | 5.6% / 0% -> 2.8% / 0% (n 44)   | 16.0% / 17% -> 3.1% / 0% (n 49) | 5.6% / 0% -> 5.6% / 0% (n 90)   |
| 150 bb | 9.1% / 33% -> 2.6% / 14% (n 126) | 5.6% / 56% -> 2.2% / 11% (n 36) | 16.0% / 17% -> 2.5% / 0% (n 40) | 5.6% / 56% -> 3.1% / 28% (n 50) |
| 200 bb | 9.1% / 35% -> 2.3% / 21% (n 112) | 5.6% / 60% -> 2.5% / 20% (n 40) | 16.0% / 17% -> 1.6% / 0% (n 26) | 5.6% / 60% -> 2.9% / 33% (n 46) |
| 300 bb | 9.1% / 38% -> 2.0% / 15% (n 94)  | 5.6% / 60% -> 1.8% / 0% (n 28)  | 16.0% / 22% -> 1.4% / 0% (n 22) | 5.6% / 60% -> 2.8% / 32% (n 44) |
| 400 bb | 9.1% / 45% -> 1.8% / 15% (n 84)  | 5.6% / 60% -> 1.8% / 0% (n 28)  | 16.0% / 35% -> 1.0% / 0% (n 16) | 5.6% / 60% -> 2.5% / 32% (n 40) |
| 800 bb | 9.1% / 71% -> 1.7% / 18% (n 83)  | 5.6% / 60% -> 1.5% / 0% (n 24)  | 16.0% / 78% -> 1.1% / 6% (n 17) | 5.6% / 60% -> 2.6% / 33% (n 42) |

Reading. Every on row is under the cap (highest 38%, PLO4 unread at 800 bb). The out-of-position 3-bet rate falls from 9-11.5% of dealt hands to 1.5-7%: at 150 bb and deeper the PLO5 range is 80% aces (PLO4 60%), at 60-100 bb 43% (PLO4 28%), the rest single-ace hands and, at 60-100 bb, some hands without an ace; the planned folds kept are ace-blocker hands. With the measured read of the opener of hand a6f9206d at 785 bb (the real-hand law) aces double-suited and aces with a suited ace 3-bet and the range folds at most 45% (today about 68%). 3-bets made under V53 pressure are rejected far more often (arm on0: PLO5 at 150 bb and deeper 92% rejected against 70% without pressure; at 60-100 bb 79% against 29%). With the option on, `omahaOopReraisedPotStrongRange` turned a 4-bet call of the kept range into a fold once in 1,127 PLO 3-bets that faced the 4-bet at 150 bb and deeper (off: 449 of 4,950). A few standing 3-bets fold at the separately asked 4-bet node because the Horse's own answer to a 4-bet is a mixed decision for some hands (`mix` in the keep table).

Not run: the audited-decision scorer, a live read (the league runs are in the next section). Realization is the engine's re-raised-pot fit (2,023 recorded calls).

## League (chips), 2026-11-24

Harness `server/scripts/oop-reraise-range/league.ts`; the production options of 2026-11-24 in both arms, the option (and nothing else) added in ON; same seeds; one niced job at a time; no database. bb/100 ± standard error. Not the declared league card (`plo4/plo5_omaha_oop_reraise_range_holds_vs_reraise`), whose arms carry no production options.

Mirror (HorseLeague `runMatchup`, production styles; half the seats ON, half OFF, swapped; ON's chips against OFF):

| card                 | hands  | ON         | OFF  |
| -------------------- | ------ | ---------- | ---- |
| PLO5 6-max 100 bb    | 12,000 | -0.3 ± 2.0 | +0.3 |
| PLO5 6-max 300 bb    | 12,000 | -2.0 ± 2.4 | +2.0 |
| PLO5 heads-up 100 bb | 16,000 | -1.9 ± 4.1 | +1.9 |
| PLO5 heads-up 300 bb | 16,000 | +1.7 ± 7.5 | -1.7 |
| PLO4 6-max 100 bb    | 12,000 | +1.8 ± 1.8 | -1.8 |

Exploit probes (ExploiterLeague `runExploiterCell`, heads-up, the script in seat 0 with memory on; the script is the production Horse with the option OFF except its answer to the Horse's 3-bet of its own button open: a 4-bets every such 3-bet (pot), b 4-bets only with aces or kings and otherwise never re-raises, c calls every such 3-bet). 12,000 hands per arm on the same deals; the Horse's bb/100 against the script, and ON - OFF differenced hand by hand (`ExploiterCellSpec.onPair`). Fold to 4-bet: the share of the Horse's out-of-position 3-bets that folded when script a 4-bet them.

| game, depth | probe | OFF         | ON          | ON - OFF    | 3-bets OFF -> ON | fold to 4-bet OFF -> ON |
| ----------- | ----- | ----------- | ----------- | ----------- | ---------------- | ----------------------- |
| PLO5 100 bb | a     | -5.1 ± 8.4  | +7.0 ± 7.9  | +12.2 ± 5.8 | 223 -> 59        | 73% -> 3%               |
| PLO5 100 bb | b     | -4.1 ± 7.5  | +2.5 ± 6.5  | +6.7 ± 5.0  | 235 -> 57        |                         |
| PLO5 100 bb | c     | -2.0 ± 7.1  | +4.5 ± 6.1  | +6.5 ± 5.2  | 235 -> 61        |                         |
| PLO5 300 bb | a     | -8.5 ± 9.9  | +13.1 ± 8.8 | +21.7 ± 6.2 | 229 -> 52        | 80% -> 21%              |
| PLO5 300 bb | b     | -3.5 ± 10.7 | +10.9 ± 9.9 | +14.4 ± 7.9 | 234 -> 55        |                         |
| PLO5 300 bb | c     | +7.2 ± 11.3 | +10.4 ± 9.7 | +3.2 ± 7.2  | 228 -> 55        |                         |
| PLO4 300 bb | a     | -9.5 ± 8.0  | -9.5 ± 8.1  | +0.0 ± 4.7  | 151 -> 66        | 75% -> 50%              |
| PLO4 300 bb | b     | -7.9 ± 9.1  | -8.1 ± 7.7  | -0.3 ± 6.6  | 149 -> 67        |                         |
| PLO4 300 bb | c     | -10.2 ± 9.7 | -4.2 ± 7.7  | +6.0 ± 6.5  | 149 -> 64        |                         |

Reading. ON never loses chips in PLO at the measured standard errors: it gains against the always-4-bet script (PLO5 +12 at 100 bb, +22 at 300 bb), and the near-aces range at 300 bb gains or breaks even against the scripts that do not 4-bet light (b, c), because the 3-bets it drops were losing ones and the call or fold that replaces them is the existing rule's. The mirror cards are all within about one standard error of 0. Against script a the share of the out-of-position 3-bets that fold to the 4-bet falls from 73-80% to 3% (PLO5 100 bb) and 21% (PLO5 300 bb); PLO4 at 300 bb reads 50% of 66 3-bets, over the cap: the keep table was fitted on six-max positions and heads-up ranges are wider (stated, not tuned). The heads-up out-of-position 3-bet count falls about four times (PLO5 223-235 -> 52-61 per 12,000 hands; PLO4 149-151 -> 64-67). Winning setting for PLO4/PLO5: the default (`horse.reraiseFoldShareCap` 0.45, ace blockers); nothing was tuned.

## Prior anchor

The opener's answer to the 3-bet (fold / call / 4-bet) has two selectable priors, runtime setting horse.openerAnswersPriorVersion (PLO lead-7, 2026-11-26):

- Baseline: version 2 is the indifference answer to the 3-bet faced (server/src/engine/HorsePreflopIndifferenceAnchor.ts): fold = s/(1+s) with s the 3-bet's risk over the pot it wins (2/3 for a pot-limit pot 3-bet); the 4-bet share is the opener's hands ahead of the Horse's own 3-bet range (the top half of that range's width, HORSE_OOP_THREE_BET_WIDTH, as a share of his open band) plus the bluffs a pot 4-bet carries at its own indifference (s/(1+2s)); the rest calls.
- Population weight: version 1 (compiled default, kept selectable for the comparison) is the table OPENER_ANSWERS_PRIOR 2026-11-24.v1 fitted on people and Horses pooled from hand_history, the mis-playing field; version 2 gives that population no weight.
- Own record: the opener's own decayed fold-to-3-bet record sits on top of either prior with weight OPENER_ANSWERS_PRIOR_MASS (6 opportunities), so it dominates once it has a real sample.
- No unshown cards: neither prior nor the record reads a hole card.

Graded 2026-11-26 (server/scripts/oop-reraise-range/league.ts, live options, heads-up probes 4,000 pairs seed 11, option ON - OFF bb/100 (SE), version 2 / version 1): always 4-bets the 3-bet (a): PLO5 100 bb +20.4 (8.3) / +16.9 (9.4); PLO5 300 bb +1.0 (12.2) / +19.3 (9.4); PLO4 300 bb -1.0 (6.8) / -5.9 (6.5); NLH 100 bb +75.4 (15.0) / +78.1 (14.3). 4-bets aces or kings only (b): +3.9 (8.1) / +7.2 (8.0); +23.8 (12.1) / +24.0 (11.8); +7.5 (10.7) / +5.4 (10.3); -13.8 (12.6) / -24.3 (13.2). Calls every 3-bet (c): +16.1 (8.4) / +20.9 (8.9); +21.7 (10.0) / +10.3 (8.4); +2.8 (6.9) / -0.7 (7.5); -22.5 (17.5) / -23.3 (17.5). League mirror PLO5 6-max 100 bb, 6,000 pairs: -0.18 (1.97) / +3.19 (2.12). Version 2 loses significantly to none of them; against version 1 it is within noise everywhere (largest gap PLO5 300 bb probe a, -18.3 with SEs of 9-12). Fold to the 4-bet against probe a with version 2: PLO5 100 bb 7%, 300 bb 42%, PLO4 300 bb 27%, NLH 18% (all under the 0.45 cap).

## Replay

- Replay: NOT RUN (the audited-decision scorer was not run; the generated-state replay above, server/scripts/oop-reraise-range/replay.ts, is the only grade)
