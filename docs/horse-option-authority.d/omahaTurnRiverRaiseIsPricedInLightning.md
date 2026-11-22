# omahaTurnRiverRaiseIsPricedInLightning: Authority For The Live Switch

Built 2026-11-22 by PLO-OWNER lead-4 lane LEAKS-RULES (freeing `#2` `omahaRiverNutRaiseOnly`, which remained held in BLANKET-AUDIT-5 Packet 09 solely because `omahaPricedInLightning` is off and listing `#2` left Lightning PLO4/PLO5 cash non-nut river raises without a priced owner). Evidence NOT MET: default OFF (read `=== true`), this file does not authorize switching the option on.

## What It Does

A narrow Lightning scope option (`server/src/engine/HorseOmahaPricedWiring.ts`, `omahaTurnRiverRaiseInLightningOn`). With it on (and `omahaTurnRiverRaiseIsPriced` on), `omahaPricedTurnRiverRaiseRule` and `omahaPricedOwnsTurnRiverRaise` include Lightning PLO4/PLO5 cash pools (`gs.publicMemoryDomain.speed === 'lightning'`) without widening `omahaPricedInLightning` to any other priced rule.

- **Zero new pricing math:** reuses the exact proven `omahaPricedTurnRiverRaiseRule` already live on regular PLO4/PLO5 cash tables.
- **Zero blast radius on other priced rules:** `omahaPricedInScope(player, gs, opts)` stays `false` in Lightning when only `omahaTurnRiverRaiseIsPricedInLightning` is on.
- **Response validator:** `responseValidation.ts` admits ONLY `omahaPricedAdmitsRaiseToCall` in Lightning when `omahaTurnRiverRaiseIsPricedInLightning` is on (not `omahaPricedSampledAdmitsResize`).
- **Scope isolation:** PLO6, hold'em, hi-lo (PLO8), tournaments, bomb pots, and multi-board are byte-identical. Zero person-vs-Horse key; zero unshown cards.

Receipt: `omaha_turn_river_raise_in_lightning` (fired alongside `omaha_priced_raise_*` when `omahaPricedInLightning` is off in a Lightning pool).

## What Was Measured

- Evidence: NOT MET (built 2026-11-22; unit, law, and receipt-validator tests pass; paired Lightning pool evaluation `LightningPairedEval` pending)
- Replay: NOT RUN (as of 2026-11-22 no replay of this Lightning scope option on real audited Lightning decisions is recorded)
