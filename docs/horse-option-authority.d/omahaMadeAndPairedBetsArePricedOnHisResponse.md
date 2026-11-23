# omahaMadeAndPairedBetsArePricedOnHisResponse: authority for the live switch

PLO-OWNER lane REPLACEMENTS-5 (R5 v3, 2026-11-22). Changed 2026-11-22 by PLO-OWNER lead-5 (Turn 5b): a spot the rule cannot price is no longer decided by it.

Evidence NOT MET: the option stays OFF. This file does not authorize switching it on.

## Status of the evidence

- Formal 8-cell 224k-hand learning-bench grade (`20261221`/`20261222`, criteria `ef0b8f8e3de7`, head `5a9b8c6788ae`) = PASS (V342): 56/56 active, 56/56 control rows zero, worst pooled z `+1.2660` (bar 1.971), worst cell z `+2.2407` (bar 2.739). **This grade is against scripted opponents only.** No result against people was read. It was run before the per-decision memo and before the Turn 5b change below.
- Evidence: NOT MET (scripted opponents only; nothing measured against people)
- Replay: NOT RUN (no replay on audited production decisions is recorded)

## What it does

PLO4/PLO5 cash turn and river (table, and Lightning when `omahaPricedInLightning` opens it), high only, one board, no bomb pot, not fixed limit (`omahaPricedInScope`). Default OFF (`=== true`).

Replaces the bet-or-check halves of `#19` (`omahaMadeHandDefenseVsValueLeader`), `#9` (`omahaOverpairNoOopBarrelVsValueLeader`), `#10` (`omahaPairedTurnNoBarrelWithoutBoatVsValueLeader`), `#11` (`omahaPairedRiverNoThinLeadVsValueLeader`), and `plo_paired_board_river_check` in PLO4/PLO5 cash using `omahaCardImpact` with every live opponent's lifetime HUD response curve (`<s>.fb.{sm|bg}.{hu|mw}`, `<s>.rBet.{hu|mw}`, `<s>.stab.{hu|mw}`), shrunk continuously `n / (n + k)` with no cliff and no person-vs-Horse key. It prices those spots even when the legacy switches are off.

The guard is prove-it-to-check: a proposed bet becomes a check only when checking is proven better beyond the uncertainty (`evCheck - evBet > sampleSe + readSpread`); otherwise the bet stands.

When the rule cannot price a spot (an opponent all in, an invalid stack or pot, no card-impact sample) it does not decide it: it returns nothing and the legacy bet-or-check path of that site runs with the legacy switches as they are. Missing HUD data is not "cannot price": the fitted population priors answer.

## Receipts

- `omaha_made_paired_bet_on_his_response_kept`
- `omaha_made_paired_bet_on_his_response_checked`
- `omaha_made_paired_bet_on_his_response_unpriced_legacy`

## Tests

- `HorseOmahaMadeAndPairedBetsPriced.law.test.ts`: the rule function (strict read, scope, monotonic response, memo).
- `HorseOmahaMadeAndPairedBetsPricedWholeDecision.law.test.ts` (Turn 5b): PLO4 and PLO5 whole decisions; off fires nothing; on, the three call sites decide; a spot it cannot price gives the option-off decision.
