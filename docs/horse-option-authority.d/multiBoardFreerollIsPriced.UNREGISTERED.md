# multiBoardFreerollIsPriced: authority for the live switch (unregistered / dark)

**State: OFF in source (read `=== true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations, zero switch rows), not yet registered in the SQL option switch (registration rides the switch-list route and rename to `multiBoardFreerollIsPriced.md`). Evidence NOT MET.** Rows of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` met: mechanism, scope, receipts-designed, tests, off-identity, and paired multi-board bomb-pot hard-safety evaluation (`0` illegal / `0` Pot-Limit cap violations / `0` freeroll folds / `0` exceptions / `0` single-board diffs across `2,400` paired multi-board + `300` single-board control spots); real-human production multi-board sample size is below the declared `n >= 20` people-decision activation bar; no live evidence.

Criteria declared before code edit or evaluation run: `/Volumes/SmarterWork/agent-work/extreme-capacity/hd-abe2654e/criteria/CRITERIA-MULTIBOARD-FREEROLL-PRICED.md` (sha256 `303d1f2643f0a06e7c410e471f5ae1dab892b1d595ac4fb80a48f92d0b09a5ed`, HORSE DECISIONS lane 2026-11-22).

## What it replaces

Two unowned blanket random coin flips in `server/src/engine/HorseLogic.ts` on multi-board hands (`multiBoard36`, `nBoards36 >= 2`, `lockShare36 >= 1 / nBoards36`):

1. `v36_freeroll_bet` (`lockShare36 >= 1 / nBoards36 && lockShare36 < 1 && fastRandom() < 0.9` with random sizing `Math.max(0.75, geomFrac) + fastRandom() * 0.15`).
2. `v36_freeroll_raise` (`lockShare36 >= 1 / nBoards36 && (nBoards36 === 2 || lockShare36 >= 2 / 3 || potFrac36 <= 1)` with `lockShare36 < 1 ? unlockedEq36 >= 0.2 && fastRandom() < 0.85 : fastRandom() < 0.9` and random sizing `0.9 + fastRandom() * 0.2`).

## How each decision is priced

- Pure deterministic module `server/src/engine/HorseMultiBoardFreerollPriced.ts` (zero `fastRandom()` draw, zero opponent hole cards, zero `opponentHud/` import).
- Total freeroll equity across `N` boards: `E_total = lockShare36 + (1 - lockShare36) * unlockedEq36`.
- Risk-adjusted utility with `heroBubbleFactor` (`bf >= 1`): `U(e, pot, wager, bf) = e * (pot + wager) - (1 - e) * bf * wager` (reduces identically to `e * (pot + 2 * wager) - wager` at `bf = 1`).
- **Open / checked-to freeroll (`lockShare36 >= 1 / N && lockShare36 < 1`):** Compares legal candidate bet sizes (`0.50`, `0.75`, `1.00`, geometric, max-legal / all-in — strictly bounded by `minBet`, `heroStack`, and Pot-Limit `pot` cap) against check using shrunk opponent fold and `betWhenCheckedTo` priors (`holdemEmpiricalPriors.ts` + `ExploitCounters`), `lockShare36`-invariant calling-range discount on `unlockedEq36`, and continuous free-card equity erosion on the unlocked board(s). Bets the highest-EV legal size iff `max EV(bet, b) > EV(check)`; otherwise checks.
- **Facing-bet freeroll (`lockShare36 >= 1 / N` and qualifying lock/price scope):** Fold is NEVER considered. Compares legal candidate raise-TO sizes (`0.75x`, `1.00x (pot + toCall)`, and max-legal / all-in — strictly respecting `minRaise`, effective stack, and Pot-Limit cap `currentBet + pot + toCall`) against calling using `lockShare36`-invariant raise-continuing equity, shrunk fold-to-raise priors, and `heroBubbleFactor`. Raises to the highest-EV legal size iff `max EV(raise, r) > EV(call)`; otherwise calls.
- OFF / unset / false and all single-board hands (`!multiBoard36`) remain 100% byte-identical to `origin/main` (including exact `fastRandom()` stream).

## Receipts & Tests

- Receipts (`HorseDataLedger.ts`): `v36_freeroll_priced_bet`, `v36_freeroll_priced_check`, `v36_freeroll_priced_raise`, `v36_freeroll_priced_call`.
- Dedicated law (`docs/laws.d/server-src-engine-AMultiBoardFreerollIsPriced.md`): `server/src/engine/AMultiBoardFreerollIsPriced.law.test.ts` (`13/13` passing).
- League refusal (`HorseLeague.ts` `UNMEASURABLE_MATCHUPS`): `multiboard_freeroll_is_priced` (`HorseLeague` deals single-board hands only).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (existing audited decision sets cover single-board hands only and contain fewer than 20 real-human multi-board freeroll decisions; paired multi-board bomb-pot NLH/PLO4 safety and synthetic EV evaluation is recorded in prose below and in `/Volumes/SmarterWork/agent-work/extreme-capacity/hd-abe2654e/v36-freeroll/REPORT.md`)

### Paired Multi-Board Bomb-Pot Evaluation (seeds `1, 7, 42`, zero hole cards / zero hand IDs)

| Bucket        | Paired Spots | Illegal (OFF / ON) | PL Cap Viol / Folds (ON) | Action-Kind / Sizing Diffs | OFF Receipts (`bet` / `raise` / `call`) | ON Receipts (`bet` / `check` / `raise` / `call`) | Synthetic EV Delta (ON - OFF, bb)          |
| ------------- | ------------ | ------------------ | ------------------------ | -------------------------- | --------------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| `nlh_open`    | 600          | 0 / 0              | 0 / 0                    | 324 / 147                  | 452 / 0 / 0                             | 487 / 20 / 0 / 0                                 | `+0.642 +/- 0.204 bb` (`+385.41 bb`)       |
| `nlh_facing`  | 600          | 0 / 0              | 0 / 0                    | 452 / 5                    | 0 / 483 / 117                           | 0 / 0 / 532 / 68                                 | `+1.538 +/- 0.431 bb` (`+923.04 bb`)       |
| `plo4_open`   | 600          | 0 / 0              | 0 / 0                    | 31 / 294                   | 501 / 0 / 0                             | 533 / 21 / 0 / 0                                 | `+1.041 +/- 0.151 bb` (`+624.77 bb`)       |
| `plo4_facing` | 600          | 0 / 0              | 0 / 0                    | 169 / 166                  | 0 / 472 / 128                           | 0 / 0 / 534 / 66                                 | `+5.178 +/- 0.787 bb` (`+3,106.51 bb`)     |
| **Pooled**    | **2,400**    | **0 / 0**          | **0 / 0**                | **976 / 612**              | **953 / 955 / 245**                     | **1,020 / 41 / 1,066 / 134**                     | **`+2.100 +/- 0.236 bb` (`+5,039.72 bb`)** |

Single-board control (`300` paired NLH + PLO4 spots across seeds `1, 7, 42`): `0` decision differences, `0` `fastRandom()` state differences. Verdict: **Hard safety PASS**, positive synthetic paired EV in every bucket, **stays strictly DARK (`OPTION_SWITCH_REFUSED`, `Evidence NOT MET`)** until live/replay real-human multi-board evidence reaches `n >= 20`.
