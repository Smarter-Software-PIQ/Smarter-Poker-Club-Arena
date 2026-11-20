# omahaPricedPriorsByOpponentKind: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago (no blanket rules; every decision by math, ranges, equity and EV). Built by the PLO Strategy lane (priced2-013U37, head 54d47a6a706); split behind this option in the 2026-11-18 option batch by the lead's ruling on review R2 (B1). Evidence NOT MET: the option wins inside the all-nine priced base, but the deployable package against production FAILED. **Do not switch on.**

## What it does

PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default OFF (read `=== true`). With it on, for every priced family that is on:

- every prior and reference rate a priced comparison reads is the opponent's KIND's (`HorseOmahaPricedMode.omahaPricedKindPrior`: a person's bluff table, bet and fold rates by street, card-impact bluff share and bet-rate elasticity for a person, a Horse's for a Horse; kind from `gs.humanUserIds`, else the seat's `is_horse`), each posterior re-centred on it (`omahaPricedRecentred`, `omahaPricedKindBetRate`);
- the card-impact read starts at his kind's figures, continuous at zero opportunities;
- the continuous facing-bet range takes the bettor's kind's bluff table (through the per-decision priced mode, `priorsByKind`);
- a spot a priced family cannot price keeps the decision given, exactly as with this option off; the old categorical rule never decides it (its `_unpriced_kept` receipt still fires with this option on, including `omaha_priced_pressure_unpriced_kept`).

ROWFIX 2026-11-18 (Horse Switch lane, PLO45-CASH improvement 5): until this change the option also made every unpriceable spot fall CLOSED to the categorical rule the family replaces (for example omahaTurnRiverRaiseNeedsNuts deciding PLO4/PLO5 cash turn and river raises), which re-opened blanket rules against the owner's 2026-11-17 ruling and confounded every evaluation of the priors. The fall-closed path is removed; the option now switches only the kind priors. Off is byte-identical (the off path was already "kept"). **Every league and replay result below measured the fall-closed version and is not evidence for the option as it now is: it is unevaluated.**

Off (absent or false): every priced family is byte-identical to #11212 (HorseOmahaPricedKindOptions.test.ts; HorseOmahaPricedRulesRecorded.test.ts on the main fixture).

## Evidence

Measurements behind the kind priors: archive plo-handoff-review-01a1cbbd/priced2-013U37/calib (5,379 PLO4/PLO5 cash hands with a person seated, 2026-11-13 19:40Z to 2026-11-17 19:40Z). Math review: R2, ACCEPTED (priced2-013U37/REVIEW-54d47a6a706-013U37.md).

- Replay (priced2-013U37/REPLAY.md): bar met for omahaTurnRiverRaiseIsPriced and all nine families WITH this option and omahaRaiseEvCountsLossesOnce on (not separated).
- League, this option alone inside the all-nine base: WIN. Archive `plo-handoff-review-01a1cbbd/evals-013U37/omahaPricedPriorsByOpponentKind/RESULTS.md` (bar `PASS-BAR.md` there, written first), source eb30ce7a6f9, 2026-11-18. Arm B = the 32 options of `OMAHA_LIVE_OPTIONS_20261116` + the nine priced families; arm A = B + this option. A minus B, bb/100:

  | cell | table                                          | sessions x pairs | A - B, bb/100 | SE    | z      | divergent pairs | inert sessions |
  | ---- | ---------------------------------------------- | ---------------- | ------------- | ----- | ------ | --------------- | -------------- |
  | F4   | PLO4, one Horse vs five human-calibrated seats | 400 x 500        | +6.237        | 0.676 | +9.22  | 1,183           | 27             |
  | F5   | PLO5, the same                                 | 400 x 500        | +4.369        | 0.791 | +5.52  | 1,180           | 26             |
  | M4   | PLO4, Horse-only, production styles            | 100 x 500        | +9.042        | 0.737 | +12.27 | 6,042           | 0              |
  | M5   | PLO5, the same                                 | 100 x 500        | +10.734       | 0.986 | +10.89 | 6,052           | 0              |

  Pooled: human-like +5.303 bb/100, SE 0.520 (z +10.19); Horse-only +9.888, SE 0.616 (z +16.06). It shows the option repairs the priced families against each other; it does not show the families with it beat production.

- League, the deployable package against production: FAIL. Archive `evals-013U37/pricedPackageVsProduction/RESULTS.md` (bar written first), source 86ab7637d9e, 2026-11-18. Arm B = production's live set (`OMAHA_LIVE_OPTIONS_20261116` + omahaTurnRiverRaiseIsPriced); arm A = B + this option + omahaBigBetCallsArePriced, omahaBluffShareFromBetRate, omahaDrawRaiseIsPriced, omahaFacingBetRangeIsContinuous, omahaOopTurnBarrelIsPriced, omahaPressureIsPriced, omahaUnderpairMultiwayIsPriced. A minus B, bb/100:

  | cell | table                                          | sessions x pairs | A - B, bb/100 | SE    | z     | divergent pairs | inert sessions |
  | ---- | ---------------------------------------------- | ---------------- | ------------- | ----- | ----- | --------------- | -------------- |
  | F4   | PLO4, one Horse vs five human-calibrated seats | 400 x 500        | -1.521        | 1.079 | -1.41 | 1,999           | 10             |
  | F5   | PLO5, the same                                 | 400 x 500        | -2.682        | 1.321 | -2.03 | 2,436           | 5              |
  | M4   | PLO4, Horse-only, production styles            | 100 x 500        | +1.125        | 0.485 | +2.32 | 4,503           | 0              |
  | M5   | PLO5, the same                                 | 100 x 500        | +1.619        | 0.560 | +2.89 | 4,524           | 0              |

  Pooled: human-like -2.101 bb/100, SE 0.853 (z -2.46); Horse-only +1.372, SE 0.370 (z +3.70). The human-like pooled figure and F5 are below -2 SE: FAIL.

- The configuration-0 FAIL of 2026-11-18 had both priced2 changes on (see omahaRaiseEvCountsLossesOnce.md).
- Overall: NOT MET. Do not switch on (neither this option nor the package).

Non-blocking review notes carried: riverCall is not re-centred on the kind (HorseOmahaPricedRules.ts omahaPricedRead, a posterior read as is); the priced code holds the pseudo-opportunity count (6) once: OMAHA_PRICED_SHRINK is OMAHA_PRICED_READ_PRIOR_STRENGTH; it equals HorseOpponentExploit.EXPLOIT_PRIOR_STRENGTH, which HorseOmahaPricedMode does not import (it stays a leaf module).

League cards (HorseLeague.ts, declared; run once on eb30ce7a6f9, WIN inside the all-nine base, see Evidence): plo4_omaha_priced_priors_by_opponent_kind and plo5_omaha_priced_priors_by_opponent_kind: the live options of 2026-11-16 in both arms, arm A adds omahaPricedPriorsByOpponentKind (both arms carry every priced family on).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
