# multiBoardNonFreerollIsPriced: authority for the live switch (unregistered / dark)

**State: OFF in source (read `=== true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations, zero switch rows), not yet registered in the SQL option switch (registration rides the switch-list route and rename to `multiBoardNonFreerollIsPriced.md`). Evidence NOT MET.** Rows of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` met: mechanism, scope, receipts-designed, tests, off-identity, and paired multi-board bomb-pot hard-safety evaluation (`0` illegal / `0` Pot-Limit cap violations / `0` exceptions / `0` single-board diffs / `0` freeroll diffs across `2,400` paired non-freeroll multi-board + `300` single-board + `150` freeroll control spots); real-human production multi-board sample size is below the declared `n >= 20` people-decision activation bar; no live evidence.

Criteria declared before code edit or evaluation run: `/Volumes/SmarterWork/agent-work/extreme-capacity/hd-abe2654e/criteria/CRITERIA-MULTIBOARD-NONFREEROLL-PRICED.md` (sha256 `d1b8241343934988b71cd564fde816902746565988b71d37f223c9f5718dac72`, HORSE DECISIONS lane 2026-11-22).

## What it replaces

Three unowned fixed-cliff / hash-coin-flip branches in `server/src/engine/HorseLogic.ts` on multi-board non-freeroll hands (`v86 && multiBoard36 && boardEq36.length >= 2 && lockShare36 < 1 / nBoards36`):

1. `v86_multiboard_dead_half_fold`: fixed blanket fold `potFrac36 >= 0.6 && minBoardEq86 < 0.18 && maxBoardEq86 < 0.88` (which folded profitable calls when average equity across boards exceeded pot odds + risk utility, e.g., 85%/15% = 50% total equity vs a 0.6x pot bet needing 27.3%).
2. `v86_multiboard_or_plo8` facing-bet raise: fixed hash coin flip `!isRiver && !raisedAfterAggr && potFrac36 <= 1.0 && boardEq >= 0.8 && minBoardEq >= 0.32 && v86Hash01 < 0.78` with hash-randomized sizing `0.88 + v86Hash01 * 0.12`.
3. `v86_multiboard_or_plo8` open bet: fixed hash coin flip `!isRiver && barrelPlan !== true && lockShare36 < 1 / nBoards36 && boardEq >= 0.78 && minBoardEq >= 0.32 && v86Hash01 < 0.85` with hash-randomized sizing `0.78 + v86Hash01 * 0.14`.

## How each decision is priced

- Pure deterministic module `server/src/engine/HorseMultiBoardNonFreerollPriced.ts` (zero `fastRandom()` draw, zero `v86Hash01()`, zero opponent hole cards, zero `opponentHud/` import).
- Average multi-board equity: `E_avg = mean(boardEq36)`.
- Risk-adjusted utility with `heroBubbleFactor` (`bf >= 1`): `U(e, pot, wager, bf) = e * (pot + wager) - (1 - e) * bf * wager` (reduces identically to `e * (pot + 2 * wager) - wager` at `bf = 1`).
- **Facing-bet non-freeroll (`v86 && multiBoard36 && boardEq36.length >= 2 && lockShare36 < 1 / nBoards36`):** Applies continuous non-river `deadBoardRealizationPenalty` (`0` strictly on river and `0` when calling all-in; never a hard cliff fold) to compute `EV(call) = U(E_call_realized, P0, effCall, bf)` vs `EV(fold) = 0`, and compares legal candidate raise-TO sizes (`0.75x`, `1.00x (pot + toCall)`, effective max, and max-legal / all-in — strictly respecting `minRaise`, effective stack, Pot-Limit cap `currentBet + pot + toCall`, and `!raisedAfterAggr`) via `EV(raise, r) = F_raise(r) * pot + (1 - F_raise(r)) * U(E_called_raise(r), P0, effWager, bf)` using unclamped top-MDF quantile continuing-range equity and shrunk fold-to-raise priors (`holdemEmpiricalPriors.ts` + `ExploitCounters`). Selects `argmax { EV(fold)=0, EV(call), max_r EV(raise, r) }`.
- **Open / checked-to non-freeroll (`v86 && multiBoard36 && !isRiver && barrelPlan !== true && lockShare36 < 1 / nBoards36`):** Compares legal candidate bet sizes (`0.50`, `0.75`, `1.00`, geometric, max-legal / all-in — strictly bounded by `minBet`, `heroStack`, and Pot-Limit `pot` cap) against check using shrunk fold and `betWhenCheckedTo` priors, unclamped top-MDF quantile calling-range equity tightening, continuous free-card equity erosion across boards (`0` on river), and `heroBubbleFactor`. Bets the highest-EV legal size iff `max EV(bet, b) > EV(check)`; otherwise checks.
- OFF / unset / false, all single-board hands (`!multiBoard36`), and all freeroll hands (`lockShare36 >= 1 / nBoards36`) remain 100% byte-identical to `origin/main` (including exact `fastRandom()` stream).

## Receipts & Tests

- Receipts (`HorseDataLedger.ts`): `v86_multiboard_priced_fold`, `v86_multiboard_priced_call`, `v86_multiboard_priced_raise`, `v86_multiboard_priced_open_bet`, `v86_multiboard_priced_open_check`.
- Dedicated law (`docs/laws.d/server-src-engine-AMultiBoardNonFreerollIsPriced.md`): `server/src/engine/AMultiBoardNonFreerollIsPriced.law.test.ts` (`14/14` passing).
- League refusal (`HorseLeague.ts` `UNMEASURABLE_MATCHUPS`): `multiboard_non_freeroll_is_priced` (`HorseLeague` deals single-board hands only).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (existing audited decision sets cover single-board hands only and contain fewer than 20 real-human multi-board non-freeroll decisions; paired multi-board bomb-pot NLH/PLO4 safety and synthetic EV evaluation is recorded in prose below and in `/Volumes/SmarterWork/agent-work/extreme-capacity/hd-abe2654e/v86-multiboard/REPORT.md`)

### Paired Multi-Board Bomb-Pot Evaluation (seeds `1, 7, 42`, zero hole cards / zero hand IDs)

| Bucket        | Paired Spots | Illegal (OFF / ON) | PL Cap Viol (ON) | Dead-Half Saved | Action-Kind / Sizing Diffs | OFF Receipts (`or_plo8` / `dead_half`) | ON Receipts (`open_bet` / `open_check` / `call` / `raise` / `fold`) | Synthetic EV Delta (ON - OFF, bb)           |
| ------------- | ------------ | ------------------ | ---------------- | --------------- | -------------------------- | -------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| `nlh_open`    | 600          | 0 / 0              | 0                | 0               | 150 / 287                  | 239 / 0                                | 376 / 124 / 0 / 0 / 0                                               | `+3.520 +/- 0.770 bb` (`+2,112.23 bb`)      |
| `nlh_facing`  | 600          | 0 / 0              | 0                | 14              | 107 / 83                   | 134 / 19                               | 0 / 0 / 188 / 122 / 9                                               | `+7.274 +/- 1.617 bb` (`+4,364.30 bb`)      |
| `plo4_open`   | 600          | 0 / 0              | 0                | 0               | 96 / 269                   | 115 / 0                                | 300 / 129 / 0 / 0 / 0                                               | `+2.899 +/- 0.262 bb` (`+1,739.17 bb`)      |
| `plo4_facing` | 600          | 0 / 0              | 0                | 136             | 240 / 95                   | 86 / 160                               | 0 / 0 / 380 / 190 / 30                                              | `+7.192 +/- 0.657 bb` (`+4,315.16 bb`)      |
| **Pooled**    | **2,400**    | **0 / 0**          | **0**            | **150**         | **593 / 734**              | **574 / 179**                          | **676 / 253 / 568 / 312 / 39**                                      | **`+5.221 +/- 0.483 bb` (`+12,530.86 bb`)** |

Controls across seeds `1, 7, 42`: single-board (`300` paired NLH + PLO4 spots) = `0` decision diffs, `0` `fastRandom()` diffs; freeroll (`150` paired NLH + PLO4 spots) = `0` decision diffs, `0` `fastRandom()` diffs. Verdict: **Hard safety PASS**, strongly positive synthetic paired EV in every bucket, **stays strictly DARK (`OPTION_SWITCH_REFUSED`, `Evidence NOT MET`)** until live/replay real-human multi-board evidence reaches `n >= 20`.
