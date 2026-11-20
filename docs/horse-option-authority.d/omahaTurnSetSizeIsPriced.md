# omahaTurnSetSizeIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Build: sites-013U37 (plo-handoff-review-01a1cbbd/sites-013U37/DESIGN.md, PASS-BAR.md). Evidence NOT MET: the option stays OFF.

## What it does

PLO4/PLO5 cash turn, nothing to call, in the turn set pound spot (a set where a straight is possible and a flush is not): the wager size is the highest-valued of the public-state candidates (the card-impact sizes and the pound size itself) priced against every live opponent. The decision to wager stays the engine's (the pound's spot is a value bet); only the size is priced.

Scope: PLO4 and PLO5 cash, one board, high only, no bomb pot, not Lightning, not fixed limit (`omahaPricedInScope`). It acts where the rule it replaces acts; out of scope, and with the option unset or false, every decision is exactly as before.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaTurnSetSizeIsPriced docs/horse-option-authority.d/omahaTurnSetSizeIsPriced.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-17, earlier the same day: the size of the bet must not make or break a decision.

## The rule it replaces

`omahaTurnSetPound` (HorseLogic.ts decidePostflop value sizing, hand 59401453): the monster tier's geometric size by hand class.

That rule stays in source and keeps deciding while this option is off: it is live production behaviour.

## The priced comparison

`omahaPricedSitesTurnSetSize` (HorseOmahaPricedSites.ts) on `omahaPricedBet`: every size row and the check.

The opponent read comes through one interface (`omahaPricedReadOfUser`, HorseOmahaPricedWiring.ts): the pooled read without its labels, and the per-street, per-texture cells through `omahaPricedSetStreetRatesSource` when that read is delivered. No prior, bluff share or bet-rate factor is computed in HorseOmahaPricedSites.ts: they are those of `omahaPricedBet` / `omahaPricedCardImpactRead` (HorseOmahaPricedRules.ts), so a fix there (the opponent-kind prior of the priced2 build) reaches this option with no edit. Every opponent range is drawn from the cards the Horse does not hold. A spot that cannot be priced keeps the engine decision with an `_unpriced_kept` receipt.

## Receipts

omaha_priced_site_turn_set_size_kept, \_resized, \_unpriced_kept (HorseDataLedger.ts).

## Tests

HorseOmahaPricedSites.test.ts (off and out of scope change nothing; each answer is the priced comparison; unpriced spots keep the decision; whole decisions with every site on are legal and fail no rule), HorseOmahaNoBlanketRule.law.test.ts (the site is registered; with the priced options on its legacy receipt does not decide).

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Replay on audited real decisions (PASS-BAR section 1): NOT MET (1 action change, judged wrong; sizes are not judged). Archive plo-handoff-review-01a1cbbd/sites-013U37/REPLAY-20261118.md.
- League: INCONCLUSIVE (near-inert, low reach). Archive `plo-handoff-review-01a1cbbd/evals-013U37/omahaTurnSetSizeIsPriced/RESULTS.md` (bar `PASS-BAR.md` there, written first), source eb30ce7a6f9, 2026-11-18. A minus B, bb/100:

  | cell | table                                          | sessions x pairs | A - B, bb/100 | SE    | z     | divergent pairs | inert sessions |
  | ---- | ---------------------------------------------- | ---------------- | ------------- | ----- | ----- | --------------- | -------------- |
  | F4   | PLO4, one Horse vs five human-calibrated seats | 400 x 500        | +0.006        | 0.101 | +0.05 | 31              | 372            |
  | F5   | PLO5, the same                                 | 400 x 500        | +0.256        | 0.143 | +1.79 | 62              | 354            |
  | M4   | PLO4, Horse-only, production styles            | 100 x 500        | -0.004        | 0.145 | -0.03 | 521             | 26             |
  | M5   | PLO5, the same                                 | 100 x 500        | +0.188        | 0.172 | +1.10 | 512             | 32             |

  Pooled: human-like +0.131 bb/100, SE 0.088 (z +1.50); Horse-only +0.092, SE 0.112 (z +0.82). Valid: every session present, 0 illegal, 0 truncated, 0 fallbacks. Low reach (31 and 62 divergent pairs in the human-like cells); no figure beyond 2 SE either way.

- Overall: NOT MET. Do not switch on.

## Batch integration 2026-11-18 (PLO option batch, agent/plo-batch-013U37/feat/omaha-option-batch)

Default OFF, switchable in the registry but: **replay NOT MET (too thin: 1 action change, sizes unjudged), league INCONCLUSIVE (near-inert); do not switch on.** It stays off.

League cards (HorseLeague.ts, declared, not run): plo4_omaha_turn_set_size_is_priced and plo5_omaha_turn_set_size_is_priced: the live options of 2026-11-16 in both arms, arm A adds omahaTurnSetSizeIsPriced. Run once on eb30ce7a6f9: INCONCLUSIVE (Evidence rows).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
