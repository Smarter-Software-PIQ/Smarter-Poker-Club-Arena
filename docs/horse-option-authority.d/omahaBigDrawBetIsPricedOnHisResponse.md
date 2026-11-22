# omahaBigDrawBetIsPricedOnHisResponse: authority for the live switch

PLO-OWNER lane REPLACEMENTS-5 (R4, 2026-11-21). Evidence NOT MET: the option stays OFF until live production switch approval. Formal 8-cell 224k-hand learning-bench grade (`20261213`/`20261214`, criteria `b6100cf7834a`, head `6151b0016679`) = **PASS (V331 CONFIRM)**: 56/56 active (`21,991` parted), 56/56 CTRL `0/0.000000`, `0` candidate-only Horse flags / `0` HUD refused, 7/7 GUARD-POOLED PASS (`max z = +0.9274 <= 1.971`), 56/56 GUARD-CELL PASS (`max z = +2.4042 <= 2.739`), ALL 56 IV `+0.240 +/- 0.486 (z = +0.4951)`, latency `0 / 4,773 (0.0000%) > 100 ms` (faster than OFF in all 4 formats).

## What it does

- **Scope:** PLO4 and PLO5 cash only (`omahaPricedInScope`), flop and turn, checked-to spots (`decision.action === 'check'`, `toCall <= 0.005`) holding a big draw (`omahaBigDraw`). PLO6, hold'em, hi-lo, tournaments, bomb pots, multi-board, river, preflop, and facing-a-bet spots untouched.
- **Replaces:** The checked-to bet half of `#17` (`omahaBigDrawAggression`), dropping the categorical out-of-position bar and legacy pooled `HorseMind.omahaReadConditionalOf` fold read.
- **Opponent read:** ONE lifetime HUD source (`OpponentHud.hudStat`, public actions only, shrinkage `n / (n + k)`, zero cliff, zero person-vs-Horse key): `<s>.fb.bg.{hu|mw}`, `<s>.rBet.{hu|mw}`, `<s>.stab.{hu|mw}`.
- **Proof bar:** Bet stands only when `evBet - evCheck > sampleSe + readSpread` and `evBet > 0`.
- **Law:** `server/src/engine/HorseOmahaBigDrawBetPriced.law.test.ts`
- **Source:** `server/src/engine/HorseOmahaBigDrawBetPriced.ts`, wired in `HorseLogic.ts` (`omahaBigDrawAggression`).

## Replay

- Replay: NOT RUN (formal 8-cell 224k-hand learning-bench grade V331 PASS on 20261213/20261214; production live-hand audit replay pending)
