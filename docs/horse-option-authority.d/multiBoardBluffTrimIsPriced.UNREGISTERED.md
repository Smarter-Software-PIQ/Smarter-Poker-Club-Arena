# multiBoardBluffTrimIsPriced: authority for the live switch (unregistered / dark)

**State: OFF in source (read `=== true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations, zero switch rows), not yet registered in the SQL option switch (registration rides the switch-list route and rename to `multiBoardBluffTrimIsPriced.md`). Evidence NOT MET.** Rows of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` met: mechanism, scope, receipts-designed, tests, off-identity, and paired multi-board bomb-pot hard-safety evaluation (`0` illegal / `0` Pot-Limit cap violations / `0` exceptions / `0` single-board diffs across `2,400` paired multi-board + `300` single-board control spots); real-human production multi-board sample size is below the declared `n >= 20` people-decision activation bar; no live evidence.

Criteria declared before code edit or evaluation run: `/Volumes/SmarterWork/agent-work/extreme-capacity/hd-abe2654e/criteria/CRITERIA-MULTIBOARD-BLUFF-TRIM-PRICED.md` (sha256 `644e030196ba9ad0681ea9a2d43d1e053b9ba1073e8ae48c20206aace970a6b7`, HORSE DECISIONS lane 2026-11-22).

## What it replaces

Unowned V36 fixed blanket multiplier in `server/src/engine/HorseLogic.ts` (`v36_multiboard_bluff_trim`):

- `if (multiBoard36) { bluffScale *= nBoards36 >= 3 ? 0.35 : 0.5; }` — applied unconditionally on every multi-board hand regardless of opponent fold frequency, opponent count, public board-texture correlation, hero's own cross-board blockers, street/pot/stack/wetness geometry, or tournament `heroBubbleFactor`.

## How each decision is priced

- Pure deterministic module `server/src/engine/HorseMultiBoardBluffTrimPriced.ts` (zero `fastRandom()` draw, zero opponent hole cards, zero `opponentHud/` import).
- Computes each live opponent's shrunk single-board fold probability `F_1_i` from `holdemEmpiricalPriors.ts` + public `ExploitCounters` shrinkage adjusted smoothly for `street`, `potSize`, `effStack` (SPR), and `wetness` (`F_1_i = 0` when `canRespond === false`).
- Computes public multi-board independence exponent `effBoards in [1, nBoards]` from `nBoards`, public pairwise board correlation (shared ranks, paired-board density, shared dominant flush suits across `allBoards36`), and hero's own cross-board blocker coverage (hero cards + public boards only).
- Multi-board all-boards fold probability: `F_all = prod_i (F_1_i ^ effBoards)`.
- Risk-adjusted break-even fold probability at reference bluff size `s = 0.65` with `bf = max(1, heroBubbleFactor)`: `FE_be = (bf * s) / (1 + bf * s)`, and exact pure-bluff EV per pot unit `evPerPot = F_all * (1 + bf * s) - bf * s = (1 + bf * s) * (F_all - FE_be)`.
- Smoothly and monotonically maps `(F_all, FE_be, evPerPot)` into a bounded `bluffScale` multiplier `m in [0.0, 1.0]` anchored at `m(F_all === FE_be) = 0.35`: dropping smoothly to `~0.0` in hopeless multiway calling-station / 3-board spots, never exceeding `1.0`, and rising above legacy `0.35` / `0.50` only when `F_all` genuinely clears `FE_be` against tight folders in heads-up / low-oppCount spots.
- OFF / unset / false and all single-board hands (`!multiBoard36`) remain 100% byte-identical to `origin/main` (including exact `fastRandom()` sequence).

## Receipts & Tests

- Receipt (`HorseDataLedger.ts`): `v36_multiboard_bluff_trim_priced` (zero double-counting of legacy `v36_multiboard_bluff_trim`).
- Dedicated law (`docs/laws.d/server-src-engine-AMultiBoardBluffTrimIsPriced.md`): `server/src/engine/AMultiBoardBluffTrimIsPriced.law.test.ts` (`17/17` passing).
- League refusal (`HorseLeague.ts` `UNMEASURABLE_MATCHUPS`): `multiboard_bluff_trim_is_priced` (`HorseLeague` deals single-board hands only).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (existing audited decision sets cover single-board hands only and contain fewer than 20 real-human multi-board bluff-trim decisions; paired multi-board bomb-pot NLH/PLO4 safety and synthetic EV evaluation is recorded in prose below and in `/Volumes/SmarterWork/agent-work/extreme-capacity/hd-abe2654e/v36-blufftrim/REPORT.md`)

### Paired Multi-Board Bomb-Pot Evaluation (seeds `1, 7, 42`, zero hole cards / zero hand IDs)

| Bucket               | Paired Spots | Illegal (OFF / ON) | PL Cap Viol (ON) | Agg Actions (OFF -> ON) | Action Diffs | OFF / ON Receipts (`legacy` / `priced`) | Synthetic EV Delta (ON - OFF, bb)        |
| -------------------- | ------------ | ------------------ | ---------------- | ----------------------- | ------------ | --------------------------------------- | ---------------------------------------- |
| `nlh_2b_folder`      | 600          | 0 / 0              | 0                | 174 -> 201              | 30           | 600 / 0 legacy, 600 priced              | `+0.920 +/- 0.200 bb` (`+551.97 bb`)     |
| `nlh_3b_station_mw`  | 600          | 0 / 0              | 0                | 191 -> 176              | 15           | 600 / 0 legacy, 600 priced              | `+0.423 +/- 0.115 bb` (`+253.81 bb`)     |
| `plo4_2b_folder`     | 600          | 0 / 0              | 0                | 226 -> 226              | 0            | 600 / 0 legacy, 600 priced              | `+0.000 +/- 0.000 bb` (`+0.00 bb`)       |
| `plo4_3b_station_mw` | 600          | 0 / 0              | 0                | 178 -> 178              | 0            | 600 / 0 legacy, 600 priced              | `+0.000 +/- 0.000 bb` (`+0.00 bb`)       |
| **Pooled**           | **2,400**    | **0 / 0**          | **0**            | **769 -> 781**          | **45**       | **2,400 / 0 legacy, 2,400 priced**      | **`+0.336 +/- 0.058 bb` (`+805.78 bb`)** |

Controls across seeds `1, 7, 42`: single-board (`300` paired NLH + PLO4 spots) = `0` decision diffs, `0` `fastRandom()` diffs, `0` priced receipts. Note: in PLO4 cash, the V38 Omaha EV engine resolves most checked-to flop/turn and facing-bet lines independently of legacy `bluffScale`, so PLO4 multi-board spots show `0` diffs while remaining 100% legal and firing `v36_multiboard_bluff_trim_priced`. Verdict: **Hard safety PASS**, strongly positive synthetic paired EV across both NLH tight-folder and multiway calling-station regimes (`+5.8 sigma` pooled), **stays strictly DARK (`OPTION_SWITCH_REFUSED`, `Evidence NOT MET`)** until live/replay real-human multi-board evidence reaches `n >= 20`.
