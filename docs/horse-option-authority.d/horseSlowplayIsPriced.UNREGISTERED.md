# horseSlowplayIsPriced: authority for the live switch (unregistered / dark)

**State: OFF in source (read `=== true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations, zero switch rows), not yet registered in the SQL option switch (registration rides the switch-list route and rename to `horseSlowplayIsPriced.md`). Evidence NOT MET.** Rows of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` met: mechanism, scope, receipts-designed, tests, off-identity, and HVH48 D+E hard-safety replay (`0` illegal / `0` refusals / `0` errors); activation-evidence sample size on people-only changed decisions is below the declared `n >= 20` bar (`n = 13` incl. resizes; `1` action-kind change); no live evidence.

**r3 (2026-11-28): every street left is priced, with inputs measured from real people. Re-graded against a bar declared in advance: FAIL (pooled +0.51 +/- 0.44 bb/100; with the never-folding profile left out -0.44 +/- 0.46). The people bar (`n >= 20`) is still not met. The option stays OFF.** Details in "r3 Grade" below.

Criteria declared before build or replay: `/Volumes/SmarterWork/agent-work/extreme-capacity/hd-abe2654e/criteria/CRITERIA-H4-SLOWPLAY-PRICED.md` (sha256 `5791476db747bfe945f0ef3dab049059c9fa0e78ad63c00e25084d55246bc693`, HORSE DECISIONS lane 2026-11-22).

## What it replaces

Unowned blanket random coin flip `H4` (`HorseLogic.ts`: `!isRiver && wetness < 0.5 && !scare.any && !vulnerable && !turnSetPound && fastRandom() < params.slowplayFreq && oppCount <= 2`) in non-Omaha / non-Fixed-Limit flop and turn monster spots.

## How each decision is priced

- Pure deterministic module `server/src/engine/HorseSlowplayPriced.ts` (zero `fastRandom()` draw, zero opponent hole cards, zero `opponentHud/` import).
- Uses measured NLH empirical pool priors with smooth Empirical-Bayes shrinkage from `server/src/engine/holdemEmpiricalPriors.ts` (`estimateHoldemFlopCbetFold`, `estimateHoldemTurnBetFold`, `estimateHoldemBetWhenCheckedTo`) against each live opponent's `ExploitCounters` (and structural `HoldemHudPacketOpponent` when provided).
- r2 (2026-11-24, criteria `hd-01BNteGZ/sp/CRITERIA-H4-SLOWPLAY-PRICED-R2.md`, sha256 `3178e72583229b197c3add048da6fbc7c8302cf12b8e3e7a9f224c4fe9fafe71`, declared before the measurement and the replay): every input is measured. Compares `EV(bet) = F * P + (1 - F) * U(e_c, P, b, bf)` against `EV(check) = B * U(e, P, s, bf) + (1 - B) * e * P`, where `U(e, P, w, bf) = e * (P + w) - (1 - e) * bf * w` (reducing identically to `e * (P + 2 * w) - w` at `bf = 1`), `F = prod_i F_i`, `B = 1 - prod_i (1 - B_i)`.
- Called equity `e_c = e ^ (1 + kappa * F / (1 - F))` (`conditionEquityAgainstRaiseCallRange`) with the measured NLH continuation sharpness `kappa` (flop 0.3151, turn 0.4068; `NLH_REFERENCE_CONTINUATION_SHARPNESS`). Multiway: `F` is the field fold probability, the called branch its complement.
- Stab size `s = min(effStack, frac * P)`, `frac` = measured pooled mean pot fraction of the first bet into a checked-to position (production `hand_history`, NLH, single board, no bomb pot, 2026-11-17T05:00Z..2026-11-24T05:00Z): flop 0.5009 (n 79,449), turn 0.6185 (n 37,846). Provenance pinned in `SLOWPLAY_PRICED_PROVENANCE`.
- No free-card penalty (r1 used `0.005 + 0.12 * wetness`, scaled by opponents and street, a hand-picked constant): over one street, with ranges fixed, expected equity after the next card equals current equity, so a free card costs no equity in expectation. Board wetness is not priced.
- r2b (2026-11-24, addendum `hd-01BNteGZ/sp/CRITERIA-H4-SLOWPLAY-PRICED-R2B-ADDENDUM.md`, sha256 `3212ee024a3551d6aee14481518468d462a5c8381c764bff1ac15e23ceafef12`): in position the Horse acts last on the street with no bet faced, so its check closes the street: stab probability `B = 0` and `EV(check) = e * P`. Out of position unchanged.
- r2c (2026-11-24, addendum `hd-01BNteGZ/sp/CRITERIA-H4-SLOWPLAY-PRICED-R2C-ADDENDUM.md`, sha256 `837667b1545af55dbbe4355968b01a4ae133db9b01e1c9e0fa4f6a2be1103a0c`, after audit `hd-01BNteGZ/aud/AUDIT.md`): replaces the r2b position rule. A stab is charged only by opponents who act after the Horse on this street and are live and not all-in (`canStab`, from dealer-relative seat order with the V17 players-behind predicate, independent of the street-IQ switch); none can stab: `B = 0`, `EV(check) = e * P`. Called equity `e_c = e ^ (1 + kappa * meanG)`, `meanG` = mean over opponents of `F_i / (1 - F_i)` (per-opponent, as `kappa` was measured; an all-in seat enters with `g = 0`). Heads-up equal to r2.
- r3 (2026-11-28, criteria `hd-01TLQer9/grade-runs/CRITERIA-SLOWPLAY2-01Gw7aDq.md`, sha256 `fdbc9d0fd9a2317615d7e74f33de57bb8c16eb7183b45972c4c9c9c710986e01`, declared before any harness run of the rebuilt code): **every street left is priced**, with what real people do. This replaces the one-street comparison of r2 (the formulas above are what the tree reduces to when one street is priced, with the r3 stab size, raise branch and stab-range equity). The model is a small explicit tree walked from this street to the river (3 streets on the flop, 2 on the turn; at most 125 nodes, about 30 microseconds):
  - State: street, pot `P`, the chips the Horse has put in since the decision `I`, effective stack `S`, equity `e`, and who bet last on the street before (the Horse, an opponent, nobody).
  - At each street: opponents who act before the Horse may lead (probability `L`; not on the decision street, where they have already checked); the Horse calls, or folds if calling is worse. Otherwise the Horse takes the better of a bet and a check. A bet `b = min(S, frac * P)` (`frac` = the engine's candidate bet as a pot fraction) is folded to by everyone (`F = prod_i F_i`, the Horse wins `P - I`), raised (`(1 - F) * rho`, to `min(S, m * b)`, the Horse calls) or called (next street, pot `P + 2b`). A check is bet into by opponents who act after the Horse (probability `A`; the Horse calls, or folds if worse) or checked through (next street, same pot).
  - After the river, or all-in: showdown `e * (P - I) - (1 - e) * bf * I`.
  - Equity is conserved over every opponent choice: a called bet meets `e_c = e ^ (1 + kappa * meanG)` (kappa flop 0.3151, turn 0.4068, river 0.9415); an opponent's bet made with probability `q` comes from the strongest `q` of its range, `e_b = e ^ (1 + kappa * (1 - q) / q)`, and the range that did not bet is weaker by exactly as much, `e_n = (e - q * e_b) / (1 - q)`.
  - The verdict's `evBet` and `evCheck` are the two values at the decision street. Check only when `evCheck > evBet`.
- r3 measured inputs (people only: production `hand_history`, NLH, `has_human`, single board, no bomb pot, 2026-10-19T00:00Z..2026-11-28T06:00Z, only actions taken by people, Horse actions excluded; queries and outputs in `hd-01TLQer9/grade-runs/slowplay2/measure/`; n and distinct people for every number, and the same with the top person excluded, are in the tables below). Pinned in `SLOWPLAY_PEOPLE_UNBET_POT_BET`, `SLOWPLAY_PEOPLE_BET_SIZE_QUANTILES`, `SLOWPLAY_PEOPLE_RAISE_SHARE_OF_CONTINUES`, `SLOWPLAY_PEOPLE_RAISE_TO_MULTIPLE`, provenance in `SLOWPLAY_PRICED_PROVENANCE`.
  - `L` and `A`: how often a person bets into an unbet pot, by street, by who bet last on the street before, and by lead (first to act) or checked to. On the decision street each opponent's own bet-when-checked-to record moves the people's rate by its log-odds distance from the pool; on later streets that record may lower the rate, never raise it.
  - The size of that bet: 20 quantile midpoints of the pot fraction per street; the priced size is `P * mean_j min(S / P, q_j)`, so the stack caps each bet before the mean is taken (this closes limitation S4).
  - `rho` and `m`: of a person's answers to a first bet that do not fold, the share that raise, and the median raise-to as a multiple of the bet.
  - `F_i`: unchanged, `estimateHoldemFlopCbetFold` / `estimateHoldemTurnBetFold`, and now `estimateHoldemRiverFoldToBet` for the river (measured NLH priors by bettor position and size, each opponent's record shrunk onto them). The people-only re-measure below agrees with these priors and is recorded as a cross-check, not pinned.
- r3, where nothing is measured the pricing leans to the bet (today's usual action), never to the check: the Horse only calls an opponent's bet, it never raises it (undervalues the check); a raise of the Horse's bet is called at the called-range equity, not at a stronger raising range (overvalues the bet); an opponent's bet is priced as the strongest part of its range with no bluffs in it (undervalues the check); with two opponents and the last bet theirs, both are priced at the lower "nobody bet" rate; a board with `wetness >= 0.5` is never checked (the blanket rule's own gate), because what a free card costs on a wet board is not priced.
- r3 call site: `horseSlowplayPricedDecision` adds one read, who made the last bet or raise on the street before, from the public action history. Nothing else in `HorseLogic.ts` changed.

## Known limitations (activation blockers)

- S2, continuation sharpness not converged: the measured `kappa` rises with the number of villain-strength samples K (NLH turn 0.326 at K 14, 0.372 at K 40, 0.4068 at K 120; flop 0.295 / 0.327 / 0.3151), so the pinned turn value is likely still low; its +/- SE is bootstrap over spots and omits this bias. It was fit on uniform-random hero and villain hands (0.02 < e < 0.98), not on monster hands or real ranges.
- S3, stab size was mostly the fleet's own sizing (r2: 99.85% of the measured sample were Horse bets). Closed by r3 for the size: it is now measured from people only. What r3 leaves open is the other side of the same coin, R1 below.
- S4, mean taken before the stack cap (r2). Closed by r3: the bet size is pinned as quantiles and each is capped by the stack before the mean.
- S6, one street only (r2). Closed by r3: every street left is priced.
- R1 (r3), the opponent is priced as a person: every betting rate and size is what people do. Most opponents at a table are Horses, whose rates differ. A Horse opponent's own record corrects the decision street only.
- R2 (r3), an opponent's record is one number for every spot (bet when checked to, any street, any history). It moves the people's rate on the decision street by its log-odds distance from the pool; on later streets it can only lower it. A person who stabs flops but gives up turns, or the reverse, is not seen.
- R3 (r3), the Horse's own later play is assumed to be the better of a bet and a check at the same pot fraction as the candidate bet. What it really does on the turn and river is decided by the engine's other rules, which the tree does not run.
- R4 (r3), three-way pots are priced as one continuing field (the pot grows by one call; both opponents stay). Raises of an opponent's bet, check-raises, a third bet on a street and rake are not in the tree.
- R5 (r3), the river raise size rests on 79 raises by 32 people; every other input has n of 163 or more.
- R6 (r3), equity does not move with the cards to come (ranges fixed, the martingale argument of r2). A board with wetness 0.5 or more is therefore never checked, exactly as the blanket rule gates it.
- Checks (slowplays) ONLY when `EV(check) > EV(bet)`.
- OFF / unset / false, Omaha (`vi.isOmaha`), and Fixed-Limit (`vi.isFixedLimit`) remain 100% byte-identical to `origin/main`.

## Receipts & Tests

- Receipts (`HorseDataLedger.ts`): `horse_slowplay_priced_checked`, `horse_slowplay_priced_bet`.
- Dedicated law (`docs/laws.d/server-src-engine-AHorseSlowplayIsPriced.md`): `server/src/engine/AHorseSlowplayIsPriced.law.test.ts` (r3: 30/30 passing; 13 of them fail on the r2c code, including all 11 added for r3).

## Replay

The `- Replay:` rows below are the r1 rows (scorer-written, r1 code). r2 results follow in their own section.

HVH48 `D` (NLH cash, 3,891 audited / 2,734 replayed) + `E` (NLH tournament, 10,937 audited / 5,356 replayed), AsOf opponent memory (76,098 settled `has_human` hands), seeds `1, 7, 42`, base switch `prod-switch-20261120T2115Z.json`, deduplicated on `(hand, seat, decision time, toCall, currentBet)` (0 duplicates). Note: because `horseSlowplayIsPriced` is `OPTION_SWITCH_REFUSED`, the replay runner injects `horseSlowplayIsPriced: true` on top of the sanitized base switch set and passes `--allow-unchanged h4_priced` to `audited-decision-replay.ts` for zero-change splits.

- Replay: fixed 0; newlyWrong 0; changed 2; unchanged 2732; unjudged 2; set hvh48-D-nlh-cash-asof; scorer 5302af2ab3e; source placed verdict-only; arm h4_priced vs off; replayed 2734 of 3891
- Replay: fixed 0; newlyWrong 0; changed 2; unchanged 5354; unjudged 2; set hvh48-E-nlh-tourney-asof; scorer 5302af2ab3e; source placed verdict-only; arm h4_priced vs off; replayed 5356 of 10937

### Facing Splits & Real-Card EV Grade (`audited-node-real-card-grade.py`, no hole cards or hand IDs)

| Set & Facing                | Audited / Replayed | Base Fidelity | Action Changed (up / dn) | Resized Only | Illegal / Refused / Err | Scorer fx / nw / unj | Real-Card EV (n, mean +/- SE, total)     | Top-Person Excluded (n, mean +/- SE)    |
| --------------------------- | ------------------ | ------------- | ------------------------ | ------------ | ----------------------- | -------------------- | ---------------------------------------- | --------------------------------------- |
| D all                       | 3,891 / 2,734      | 86.8%         | 2 (2 / 0)                | 33           | 0 / 0 / 0               | 0 / 0 / 2            | —                                        | —                                       |
| D people                    | 251 / 251          | 85.7%         | 0 (0 / 0)                | 6            | 0 / 0 / 0               | 0 / 0 / 0            | n=6, +0.454 +/- 0.614 bb (+2.73 bb)      | n=4, -0.168 +/- 0.118 bb (-0.67 bb)     |
| D horse_only                | 1,483 / 1,483      | 87.5%         | 2 (2 / 0)                | 20           | 0 / 0 / 0               | 0 / 0 / 2            | n=22, -0.068 +/- 0.664 bb (-1.50 bb)     | n=22, -0.068 +/- 0.664 bb               |
| D mixed                     | 1,000 / 1,000      | 86.0%         | 0 (0 / 0)                | 7            | 0 / 0 / 0               | 0 / 0 / 0            | n=7, -1.114 +/- 0.947 bb (-7.80 bb)      | n=3, -0.953 +/- 1.550 bb (-2.86 bb)     |
| E all                       | 10,937 / 5,356     | 86.2%         | 2 (2 / 0)                | 22           | 0 / 0 / 0               | 0 / 0 / 2            | —                                        | —                                       |
| E people                    | 681 / 681          | 80.8%         | 1 (1 / 0)                | 6            | 0 / 0 / 0               | 0 / 0 / 1            | n=7, +0.192 +/- 0.120 bb (+1.34 bb)      | n=2, +0.046 +/- 0.004 bb (+0.09 bb)     |
| E horse_only                | 3,281 / 3,281      | 86.6%         | 1 (1 / 0)                | 15           | 0 / 0 / 0               | 0 / 0 / 1            | n=16, +0.455 +/- 0.224 bb (+7.27 bb)     | n=16, +0.455 +/- 0.224 bb               |
| E mixed                     | 1,394 / 1,394      | 87.9%         | 0 (0 / 0)                | 1            | 0 / 0 / 0               | 0 / 0 / 0            | n=1, -0.021 bb (-0.02 bb)                | n=0                                     |
| **D + E people (pooled)**   | **932 / 932**      | **82.1%**     | **1 (1 / 0)**            | **12**       | **0 / 0 / 0**           | **0 / 0 / 1**        | **n=13, +0.313 +/- 0.279 bb (+4.07 bb)** | **n=8, +0.352 +/- 0.454 bb (+2.82 bb)** |
| **D + E action-only (all)** | —                  | —             | **4 (4 flop check>bet)** | —            | **0 / 0 / 0**           | **0 / 0 / 4**        | **n=4, +2.477 +/- 0.584 bb (+9.91 bb)**  | —                                       |

Receipts across D + E: `horse_slowplay_priced_bet` fired 77 times (`45` D, `32` E); `horse_slowplay_priced_checked` fired `0` times. Resized-only rows (`33` D, `22` E) arise solely from eliminating the `fastRandom() < params.slowplayFreq` coin flip ahead of downstream `monsterFrac` sizing jitter.

Verdict: **Hard safety PASS** (`0` illegal / `0` refusals / `0` errors across 8,090 replayed nodes), action-only real-card EV delta is `+2.477 +/- 0.584 bb` (`n=4`), and pooled people-only real-card EV delta is `+0.313 +/- 0.279 bb` (`n=13`, `+0.352 +/- 0.454 bb` without top person), **but `n = 13 < 20` on people-only changed decisions -> `Evidence NOT MET` -> stays strictly dark (`OPTION_SWITCH_REFUSED`, zero SQL migrations).**

## r2, r2b and r2c replay (2026-11-24, measured inputs; r2b = no stab in position; r2c = stab only by players acting after, per-opponent conditioning)

Same material as r1: r1 harness copied and repointed only (`hd-01BNteGZ/sp/replay/`, `replay-r2b/`, `replay-r2c/`; r2c against the combined worktree `follow-wt`), jobs `replay6/nodes/{D,E}.job.json`, base switch `prod-switch-20261120T2115Z.json`, AsOf memory (76,098 hands), seeds `1, 7, 42`, de-dup on `(hand, seat, decision time, toCall, currentBet)` (0 duplicates), committed scorer `5302af2ab3e2` (rows without the meta line, as in r1). Cells: action changed (up / dn) / resized only / scorer fixed-newly wrong-unjudged; illegal / refused / errors 0 / 0 / 0 in every cell.

| Set & Facing           | Replayed | r2                     | r2b                    | r2c                    |
| ---------------------- | -------- | ---------------------- | ---------------------- | ---------------------- |
| D all                  | 2,734    | 2 (2 / 0) / 33 / 0-0-2 | 2 (2 / 0) / 33 / 0-0-2 | 2 (2 / 0) / 33 / 0-0-2 |
| D people               | 251      | 0 / 6 / 0-0-0          | 0 / 6 / 0-0-0          | 0 / 6 / 0-0-0          |
| D people, top excluded | 207      | 0 / 6 / 0-0-0          | 0 / 6 / 0-0-0          | 0 / 6 / 0-0-0          |
| E all                  | 5,356    | 3 (2 / 1) / 21 / 0-1-2 | 2 (2 / 0) / 22 / 0-0-2 | 2 (2 / 0) / 22 / 0-0-2 |
| E people               | 681      | 1 (1 / 0) / 6 / 0-0-1  | 1 (1 / 0) / 6 / 0-0-1  | 1 (1 / 0) / 6 / 0-0-1  |
| E people, top excluded | 317      | 0 / 2 / 0-0-0          | 0 / 2 / 0-0-0          | 0 / 2 / 0-0-0          |

Receipts: r2 `horse_slowplay_priced_bet` 76 / `horse_slowplay_priced_checked` 1; r2b and r2c 77 / 0. The single r2 priced check (E, Horse-only, in position, turn; scored newly wrong) is a bet under r2b and r2c. The base arm is identical across r2, r2b and r2c on every node; r2c equals r2b on every decision, and on nodes where the base arm is unchanged from r1, r2c equals r1 on every decision (action and amount). No scorer-written Replay row: the committed scorer refuses to write an authority row from this harness because its rows declare no option set. Real-card EV leg not run (r1 grading cards no longer exist; hole cards not selected). Verdict: hard safety PASS; **Evidence NOT MET** (people-only changed decisions n = 1; real-card leg not run; known limitations above). Stays dark (`OPTION_SWITCH_REFUSED`).

## r3 Measured Inputs (People Only, 2026-11-28)

How often a person bets into an unbet pot (hits / n, people = distinct people; "top excluded" drops the person with the most rows in the cell):

| Street | Who Bet Last On The Street Before | Lead (First To Act)      | Lead, Top Excluded  | Checked To               | Checked To, Top Excluded |
| ------ | --------------------------------- | ------------------------ | ------------------- | ------------------------ | ------------------------ |
| Flop   | Nobody (no raise before the flop) | 79 / 336 = 0.235 (52)    | 64 / 268 = 0.239    | 177 / 527 = 0.336 (57)   | 164 / 446 = 0.368        |
| Flop   | Someone else                      | 278 / 3,117 = 0.089 (84) | 276 / 2,705 = 0.102 | 331 / 1,461 = 0.227 (78) | 322 / 1,288 = 0.250      |
| Flop   | The person                        | 214 / 323 = 0.663 (49)   | 185 / 276 = 0.670   | 956 / 1,385 = 0.690 (61) | 756 / 1,057 = 0.715      |
| Turn   | Nobody (flop checked through)     | 328 / 1,110 = 0.295 (70) | 272 / 948 = 0.287   | 252 / 890 = 0.283 (71)   | 211 / 775 = 0.272        |
| Turn   | Someone else                      | 66 / 925 = 0.071 (68)    | 64 / 794 = 0.081    | 102 / 338 = 0.302 (48)   | 96 / 298 = 0.322         |
| Turn   | The person                        | 279 / 402 = 0.694 (61)   | 256 / 362 = 0.707   | 398 / 702 = 0.567 (63)   | 331 / 556 = 0.595        |
| River  | Nobody (turn checked through)     | 259 / 842 = 0.308 (69)   | 240 / 721 = 0.333   | 207 / 891 = 0.232 (66)   | 176 / 757 = 0.232        |
| River  | Someone else                      | 51 / 397 = 0.128 (55)    | 48 / 349 = 0.138    | 66 / 196 = 0.337 (51)    | 60 / 172 = 0.349         |
| River  | The person                        | 234 / 363 = 0.645 (60)   | 202 / 310 = 0.652   | 183 / 331 = 0.553 (54)   | 158 / 289 = 0.547        |

The size of a person's first bet into an unbet pot, as a fraction of the pot:

| Street | n (People) | Mean +/- SE     | Median | Mean, Each Bet Capped At One Pot | Top Excluded: n, Mean, Median |
| ------ | ---------- | --------------- | ------ | -------------------------------- | ----------------------------- |
| Flop   | 2,035 (78) | 0.711 +/- 0.035 | 0.500  | 0.533                            | 1,707, 0.738, 0.500           |
| Turn   | 1,425 (73) | 0.682 +/- 0.031 | 0.510  | 0.558                            | 1,260, 0.697, 0.511           |
| River  | 1,000 (76) | 0.746 +/- 0.033 | 0.524  | 0.592                            | 892, 0.772, 0.529             |

Roughly one bet in ten is an all-in (flop 162, turn 131, river 137), which is why the mean sits far above the median and why the quantiles, capped by the stack, are pinned instead of the mean. The mean of the 20 pinned midpoints with no stack cap is 0.624 (flop), 0.609 (turn), 0.689 (river): lower than the sample mean, because the top 2.5% of bets is represented by one midpoint. The values pinned before r3 were 0.5009 (flop) and 0.6185 (turn), of which 99.85% were Horse bets.

A person first to answer the first bet of a street (cross-check of the fold priors, and the raise inputs):

| Street | Bet Size       | n     | Folds | Fold Rate | Raises | Top Excluded: n, Folds, Raises |
| ------ | -------------- | ----- | ----- | --------- | ------ | ------------------------------ |
| Flop   | Up to 0.4 pot  | 1,442 | 587   | 0.407     | 153    | 1,274, 513, 145                |
| Flop   | 0.4 to 0.7 pot | 1,420 | 684   | 0.482     | 140    | 1,247, 582, 134                |
| Flop   | Over 0.7 pot   | 529   | 314   | 0.594     | 31     | 447, 257, 26                   |
| Turn   | Up to 0.4 pot  | 400   | 123   | 0.308     | 47     | 343, 101, 43                   |
| Turn   | 0.4 to 0.7 pot | 936   | 415   | 0.443     | 83     | 825, 345, 77                   |
| Turn   | Over 0.7 pot   | 511   | 268   | 0.525     | 33     | 440, 222, 30                   |
| River  | Up to 0.4 pot  | 209   | 84    | 0.402     | 24     | 180, 76, 21                    |
| River  | 0.4 to 0.7 pot | 393   | 206   | 0.524     | 28     | 342, 183, 19                   |
| River  | Over 0.7 pot   | 387   | 229   | 0.592     | 27     | 337, 199, 22                   |

Raise share of the answers that continue: flop 324 / 1,806 = 0.179 (top excluded 305 / 1,616 = 0.189), turn 163 / 1,041 = 0.157 (150 / 940 = 0.160), river 79 / 470 = 0.168 (62 / 401 = 0.155). Median raise-to as a multiple of the bet: flop 3.479 (n 324, 59 people; top excluded 3.429), turn 2.835 (n 163, 45 people; 2.731), river 3.000 (n 79, 32 people; 3.000). Every input has an adequate sample: the smallest cell is the river "someone else bet last, checked to" at n 196 (51 people); the river raise size rests on 79 raises by 32 people and is the thinnest input.

## r3 Grade (2026-11-28, Honest Harness): FAIL, Stays OFF

Bar declared before any harness run of the rebuilt code: `hd-01TLQer9/grade-runs/CRITERIA-SLOWPLAY2-01Gw7aDq.md`, sha256 `fdbc9d0fd9a2317615d7e74f33de57bb8c16eb7183b45972c4c9c9c710986e01`. Same structure as the first grade's bar (`CRITERIA-HDA-HOLDEM-OPTIONS-GRADE.md`, sha256 `0655809c0a412e09669e91d45784dd994402ecfe73d4cb5fee82766a45d91df5`) and stricter in two ways: seeds 7 and 42 for every opponent profile (30 cells, was 14), and a new rule that the pooled gain must hold with the never-folding profile left out.

Harness `server/scripts/horse-grade.ts`, run from this branch at commit `b167b5565abf` (the code commit of this change), base = the 80 live switch rows (`prod-switch-20261128T0255Z.json`, the same file as the first grade), Hold'em, 100 bb, 6,000 pairs or deals a cell, seeds 1, 7 and 42, read as onMinusNoop in bb per 100 hands, paired by deal. Raw cells and the summary: `hd-01TLQer9/grade-runs/slowplay2/cells/` and `SUMMARY-slowplay2.txt`. No cell was run before the bar was written, and nothing in the model was changed after a cell was read.

Hard safety, all 30 cells: 0 illegal, 0 truncated, 0 no-op divergence. The option changes play in all 30 (4,395 divergent deals or pairs).

| Opponent Profile                                | All Cells (6)      | Heads-Up (3)    | 6-Max (3)      |
| ----------------------------------------------- | ------------------ | --------------- | -------------- |
| Mirror (Horses on both sides)                   | -0.72 +/- 0.59     | -0.54 +/- 2.34  | -0.74 +/- 0.61 |
| Nobluff (bets value only)                       | -0.14 +/- 1.25     | +1.24 +/- 1.66  | -1.90 +/- 1.88 |
| Balanced (value and a balanced share of bluffs) | +0.40 +/- 1.19     | +1.98 +/- 1.53  | -2.03 +/- 1.89 |
| Overbluff                                       | -0.40 +/- 1.30     | +0.73 +/- 1.75  | -1.79 +/- 1.94 |
| Caller (calls every bet, never folds)           | +12.87 +/- 1.65    | +19.45 +/- 2.76 | +9.24 +/- 2.05 |
| **Pooled, all 30 cells**                        | **+0.51 +/- 0.44** | +2.78 +/- 0.84  | -0.36 +/- 0.52 |
| **Pooled, caller left out (24 cells)**          | **-0.44 +/- 0.46** | +1.10 +/- 0.88  | -1.01 +/- 0.53 |

Against the bar: rule 1 (clean) met; rule 2 (reach) met; rule 3 (no cell below -2 SE) met, the lowest cell is z -1.62; rule 4 (pooled z >= 2) NOT met, z +1.15; rule 5 (no mixed sign) met; rule 6 (pooled z >= 2 with the caller left out) NOT met, z -0.97. **Verdict: FAIL.** The only profile that gains is the one that never folds, exactly as in the first grade; against every opponent that can fold the result is zero within its error, and at 6-max with the caller left out it leans negative (z -1.90).

Beside the code on main, on the 14 cells both were graded on:

| Code                   | Pooled, 14 Cells | Pooled, Caller Left Out (12 Cells) |
| ---------------------- | ---------------- | ---------------------------------- |
| main (one street, r2c) | +0.08 +/- 0.49   | -0.33 +/- 0.50                     |
| this change (r3)       | +0.45 +/- 0.52   | +0.01 +/- 0.53                     |

The rebuilt code is higher on both, by less than one standard error: the harness does not tell the two apart. The reason was measured (a diagnostic run, not a graded cell): in the mirror the r3 verdict was a check 0 times in 123 heads-up and 5 times in 129 at 6-max. None of the harness opponents has the record that makes r3 check (one that folds to most bets and bets when checked to), so what the harness grades is, again, the removal of the coin flip. What r3 adds is not exercised by this harness.

**Whether This Option's Own Evidence Bar Is Met: No.** The harness bar is failed. The people bar (n >= 20 changed people-only decisions on real hands) is not met either: the last replay (r2c) had n = 1, and no people-only replay of r3 has been run. The option stays OFF (`OPTION_SWITCH_REFUSED`, zero switch rows). What would move it: a people-only replay of r3 on real hands, and a harness opponent that folds and stabs at the people's measured rates.
