# horseSlowplayIsPriced: authority for the live switch (unregistered / dark)

**State: OFF in source (read `=== true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations, zero switch rows), not yet registered in the SQL option switch (registration rides the switch-list route and rename to `horseSlowplayIsPriced.md`). Evidence NOT MET.** Rows of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` met: mechanism, scope, receipts-designed, tests, off-identity, and HVH48 D+E hard-safety replay (`0` illegal / `0` refusals / `0` errors); activation-evidence sample size on people-only changed decisions is below the declared `n >= 20` bar (`n = 13` incl. resizes; `1` action-kind change); no live evidence.

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

## Known limitations (activation blockers)

- S2, continuation sharpness not converged: the measured `kappa` rises with the number of villain-strength samples K (NLH turn 0.326 at K 14, 0.372 at K 40, 0.4068 at K 120; flop 0.295 / 0.327 / 0.3151), so the pinned turn value is likely still low; its +/- SE is bootstrap over spots and omits this bias. It was fit on uniform-random hero and villain hands (0.02 < e < 0.98), not on monster hands or real ranges.
- S3, stab size is mostly the fleet's own sizing: 99.85% of the measured sample are Horse bets (flop 79,328 / 79,449; turn 37,783 / 37,846). People stab bigger (mean 0.614 flop, 0.756 turn, n 121 / 63). The pinned value drifts with the Horses' policy.
- S4, mean taken before the stack cap: the model uses `min(effStack, mean_r * P)`; the right statistic is `E[min(effStack, r * P)]`, which is no larger. About 0.5% of the sample are jams of 3x pot or more (they lift the flop mean from about 0.46 to 0.50). Overstates the stab when stacks are shallow.
- S6, one street only: the benefit of checking (value from later streets, induced bluffs on later streets) is not priced, while the free-card cost was removed by the one-street martingale argument. In the HVH48 sample the option never prices a check when the Horse is last to act; in practice it is close to "never slowplay in position".
- Checks (slowplays) ONLY when `EV(check) > EV(bet)`.
- OFF / unset / false, Omaha (`vi.isOmaha`), and Fixed-Limit (`vi.isFixedLimit`) remain 100% byte-identical to `origin/main`.

## Receipts & Tests

- Receipts (`HorseDataLedger.ts`): `horse_slowplay_priced_checked`, `horse_slowplay_priced_bet`.
- Dedicated law (`docs/laws.d/server-src-engine-AHorseSlowplayIsPriced.md`): `server/src/engine/AHorseSlowplayIsPriced.law.test.ts` (r2c: 22/22 passing).

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
