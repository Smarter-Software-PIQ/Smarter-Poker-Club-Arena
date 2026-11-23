# omahaTurnRiverRaiseIsPricedInLightning: Authority For The Live Switch

Built 2026-11-22 by PLO-OWNER lead-4 lane LEAKS-RULES (to give `#2` `omahaRiverNutRaiseOnly` a priced owner in Lightning PLO4/PLO5 cash). Changed 2026-11-22 by PLO-OWNER lead-5 (Turn 5b): nuts only.

Evidence NOT MET: default OFF (read `=== true`). This file does not authorize switching the option on.

## What It Does

A narrow Lightning scope option (`server/src/engine/HorseOmahaPricedWiring.ts`, `omahaTurnRiverRaiseInLightningOn`). With it on (and `omahaTurnRiverRaiseIsPriced` on), `omahaPricedTurnRiverRaiseRule` and `omahaPricedOwnsTurnRiverRaise` include Lightning PLO4/PLO5 cash pools (`gs.publicMemoryDomain.speed === 'lightning'`) without widening `omahaPricedInLightning` to any other priced rule.

Owner ruling 2026-11-15 12:52, enforced in the Lightning pool whenever this option is on: on the turn and the river facing a bet, a hand that is not the nuts folds or at best calls. It never raises.

- A nut-class hand (`omahaNutClassNow`, the classifier of `omahaTurnRiverRaiseNeedsNuts` and `omahaRiverNutRaiseOnly`) keeps the raise or the call it was given.
- A hand that is not nut class: a call or a fold is returned as it came (the rule never prices it up to a raise). A raise another owner proposed is never kept: the price chooses its call or its fold (`omaha_priced_raise_called` / `omaha_priced_raise_folded`), and when nothing can be priced it becomes the call.
- On ordinary (non-Lightning) tables this option changes nothing: `omahaTurnRiverRaiseIsPriced` behaves there as before.
- `omahaPricedInScope` stays false in Lightning for every other priced rule when only this option is on. The response validator admits only the raise-to-call change in Lightning under this option.
- PLO6, hold'em, hi-lo (PLO8), tournaments, bomb pots and multi-board are untouched. No person-versus-Horse key; no unshown cards.

Receipts: `omaha_turn_river_raise_in_lightning` (the pool was opened by this option alone), `omaha_turn_river_raise_in_lightning_non_nut_no_raise` (a non-nut raise was not kept).

The shadow stage re-decides this option only in Lightning pools (`HorseOptionShadowStage.ts`, `speeds: ['lightning']`).

## What Was Measured

- Evidence: NOT MET. **The option has no grade of any kind.** Its only evidence is unit and law tests.
- Law test `HorseOmahaLightningTurnRiverRaiseIsNutsOnly.law.test.ts` (Turn 5b): in Lightning PLO4/PLO5 turn and river spots facing a bet, switching the option on never adds a non-nut raise and leaves none.
- Law test `HorseOmahaTurnRiverRaiseInLightning.law.test.ts`: the option opens Lightning only to `omahaTurnRiverRaiseIsPriced`.
- Replay: NOT RUN (as of 2026-11-22 no replay of this option on real audited Lightning decisions is recorded)
