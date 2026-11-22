# omahaMadeAndPairedBetsArePricedOnHisResponse: authority for the live switch

PLO-OWNER lane REPLACEMENTS-5 (R5 v3, 2026-11-22). Evidence NOT MET: the option stays OFF until live production switch approval. Formal 8-cell 224k-hand learning-bench grade (`20261221`/`20261222`, criteria `ef0b8f8e3de7`, head `5a9b8c6788ae`) = **PASS (V342 CONFIRM)**: 56/56 active (`21,812` parted), 56/56 CTRL `0/0.000000`, `0` candidate-only Horse flags / `0` HUD refused, 7/7 GUARD-POOLED PASS (4/7 negative, `aggro_reg -18.22 z=-2.0538`, max `z = +1.2660 <= 1.971`), 56/56 GUARD-CELL PASS (`max z = +2.2407 <= 2.739`), ALL 56 IV `-0.2578 +/- 0.4225 (z = -0.6101)`, latency `0 / 4,775 (0.0000%) > 100 ms` (faster than OFF in all 4 formats).

## What it does

PLO4/PLO5 cash turn and river (table, and Lightning when `omahaPricedInLightning` opens it), high only, one board, no bomb pot, not fixed limit (`omahaPricedInScope`). Default OFF (`=== true`).

Replaces the bet-or-check halves of `#19` (`omahaMadeHandDefenseVsValueLeader`), `#9` (`omahaOverpairNoOopBarrelVsValueLeader`), `#10` (`omahaPairedTurnNoBarrelWithoutBoatVsValueLeader`), `#11` (`omahaPairedRiverNoThinLeadVsValueLeader`), and `plo_paired_board_river_check` in PLO4/PLO5 cash using `omahaCardImpact` with every live opponent's lifetime HUD response curve (`<s>.fb.{sm|bg}.{hu|mw}`, `<s>.rBet.{hu|mw}`, `<s>.stab.{hu|mw}`), shrunk continuously `n / (n + k)` with zero cliff and zero person-vs-Horse key, and a prove-it-to-check uncertainty guard (`evBet - evCheck >= -(sampleSe + readSpread)`) plus exact 3-branch multiway raise-branch EV. Acts even when those legacy switches are OFF.

## Receipts

- `omaha_made_paired_bet_on_his_response_kept`
- `omaha_made_paired_bet_on_his_response_checked`
- `omaha_made_paired_bet_on_his_response_unpriced_kept`

## Replay

- Replay: NOT RUN (formal 8-cell 224k-hand learning-bench grade V342 PASS on 20261221/20261222; production live-hand audit replay pending)
