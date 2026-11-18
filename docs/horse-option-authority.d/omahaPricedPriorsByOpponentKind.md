# omahaPricedPriorsByOpponentKind: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago (no blanket rules; every decision by math, ranges, equity and EV). Built by the PLO Strategy lane (priced2-013U37, head 54d47a6a706); split behind this option in the 2026-11-18 option batch by the lead's ruling on review R2 (B1). Evidence NOT MET: no league of this option alone has run. **No league yet; do not switch on without a WIN.**

## What it does

PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default OFF (read `=== true`). With it on, for every priced family that is on:

- every prior and reference rate a priced comparison reads is the opponent's KIND's (`HorseOmahaPricedMode.omahaPricedKindPrior`: a person's bluff table, bet and fold rates by street, card-impact bluff share and bet-rate elasticity for a person, a Horse's for a Horse; kind from `gs.humanUserIds`, else the seat's `is_horse`), each posterior re-centred on it (`omahaPricedRecentred`, `omahaPricedKindBetRate`);
- the card-impact read starts at his kind's figures, continuous at zero opportunities;
- the continuous facing-bet range takes the bettor's kind's bluff table (through the per-decision priced mode, `priorsByKind`);
- a spot a priced family cannot price falls CLOSED: the old categorical rule acts as with the family off, beside the family's `_unpriced_kept` receipt (new receipt `omaha_priced_pressure_unpriced_kept`); `omahaTurnRiverRaiseIsPriced` owns a spot only where it can be priced.

Off (absent or false): every priced family is byte-identical to #11212 (HorseOmahaPricedKindOptions.test.ts; HorseOmahaPricedRulesRecorded.test.ts on the main fixture).

## Evidence

Measurements behind the kind priors: archive plo-handoff-review-01a1cbbd/priced2-013U37/calib (5,379 PLO4/PLO5 cash hands with a person seated, 2026-11-13 19:40Z to 2026-11-17 19:40Z). Math review: R2, ACCEPTED (priced2-013U37/REVIEW-54d47a6a706-013U37.md).

- Replay (priced2-013U37/REPLAY.md): bar met for omahaTurnRiverRaiseIsPriced and all nine families WITH this option and omahaRaiseEvCountsLossesOnce on (not separated).
- League: none of this option alone. The configuration-0 FAIL of 2026-11-18 had both priced2 changes on (see omahaRaiseEvCountsLossesOnce.md).
- Overall: NOT MET. Do not switch on.

Non-blocking review notes carried: riverCall is not re-centred on the kind (HorseOmahaPricedRules.ts omahaPricedRead, a posterior read as is); the priced code holds the pseudo-opportunity count (6) once: OMAHA_PRICED_SHRINK is OMAHA_PRICED_READ_PRIOR_STRENGTH; it equals HorseOpponentExploit.EXPLOIT_PRIOR_STRENGTH, which HorseOmahaPricedMode does not import (it stays a leaf module).

League cards (HorseLeague.ts, declared, not run): plo4_omaha_priced_priors_by_opponent_kind and plo5_omaha_priced_priors_by_opponent_kind: the live options of 2026-11-16 in both arms, arm A adds omahaPricedPriorsByOpponentKind (both arms carry every priced family on).
