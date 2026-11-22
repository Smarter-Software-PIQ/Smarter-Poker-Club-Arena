# horseSlowplayIsPriced: authority for the live switch (unregistered / dark)

**State: OFF in source (read `=== true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations, zero switch rows), not yet registered in the SQL option switch (registration rides the switch-list route and rename to `horseSlowplayIsPriced.md`). Evidence NOT MET.** Rows of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` met: mechanism, scope, receipts-designed, tests, off-identity, and HVH48 D+E hard-safety replay (`0` illegal / `0` refusals / `0` errors); activation-evidence sample size on people-only changed decisions is below the declared `n >= 20` bar (`n = 13` incl. resizes; `1` action-kind change); no live evidence.

Criteria declared before build or replay: `/Volumes/SmarterWork/agent-work/extreme-capacity/hd-abe2654e/criteria/CRITERIA-H4-SLOWPLAY-PRICED.md` (sha256 `5791476db747bfe945f0ef3dab049059c9fa0e78ad63c00e25084d55246bc693`, HORSE DECISIONS lane 2026-11-22).

## What it replaces

Unowned blanket random coin flip `H4` (`HorseLogic.ts`: `!isRiver && wetness < 0.5 && !scare.any && !vulnerable && !turnSetPound && fastRandom() < params.slowplayFreq && oppCount <= 2`) in non-Omaha / non-Fixed-Limit flop and turn monster spots.

## How each decision is priced

- Pure deterministic module `server/src/engine/HorseSlowplayPriced.ts` (zero `fastRandom()` draw, zero opponent hole cards, zero `opponentHud/` import).
- Uses measured NLH empirical pool priors with smooth Empirical-Bayes shrinkage from `server/src/engine/holdemEmpiricalPriors.ts` (`estimateHoldemFlopCbetFold`, `estimateHoldemTurnBetFold`, `estimateHoldemBetWhenCheckedTo`) against each live opponent's `ExploitCounters` (and structural `HoldemHudPacketOpponent` when provided).
- Compares `EV(bet) = F * P + (1 - F) * U(e, P, b, bf)` against `EV(check) = B * U(e_free, P, s, bf) + (1 - B) * e_free * P`, where `U(e, P, w, bf) = e * (P + w) - (1 - e) * bf * w` (reducing identically to `e * (P + 2 * w) - w` at `bf = 1`), `F = prod_i F_i`, `B = 1 - prod_i (1 - B_i)`, `s = min(effStack, 0.55 * P)`, and `e_free = max(0, e - freeCardPenalty(wetness, oppCount, street))`.
- Checks (slowplays) ONLY when `EV(check) > EV(bet)`.
- OFF / unset / false, Omaha (`vi.isOmaha`), and Fixed-Limit (`vi.isFixedLimit`) remain 100% byte-identical to `origin/main`.

## Receipts & Tests

- Receipts (`HorseDataLedger.ts`): `horse_slowplay_priced_checked`, `horse_slowplay_priced_bet`.
- Dedicated law (`docs/laws.d/server-src-engine-AHorseSlowplayIsPriced.md`): `server/src/engine/AHorseSlowplayIsPriced.law.test.ts` (16/16 passing).

## Replay

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
