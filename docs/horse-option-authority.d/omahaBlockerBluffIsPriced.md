# omahaBlockerBluffIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Build: sites-013U37 (plo-handoff-review-01a1cbbd/sites-013U37/DESIGN.md, PASS-BAR.md). Evidence NOT MET: the option stays OFF.

## What it does

PLO4/PLO5 cash river, heads-up, nothing to call: the V86 nut-blocker bluff (and the one-pair admission of `omahaRiverNutBlockerBluffReachable`) is sized first by the engine, and that EXACT placed amount is priced beside the check against his range and his measured fold to a bet (`omahaPricedSitesBlockerBluffAdmits(player, gs, opts, bet86Rb)`: `omahaPricedBet(..., amount).proposed.ev > evCheck`), on any board; the bluff is made only when that amount is priced above the check, and a bet it cannot price makes no bluff. Its other conditions (heads-up, the blocker, chips behind, the capped-line and station reads, its frequency draw) are unchanged and are registered as open site S6b (receipt `omaha_priced_site_blocker_bluff_gate_withheld`).

Scope: PLO4 and PLO5 cash, one board, high only, no bomb pot, not Lightning, not fixed limit (`omahaPricedInScope`). It acts where the rule it replaces acts; out of scope, and with the option unset or false, every decision is exactly as before.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaBlockerBluffIsPriced docs/horse-option-authority.d/omahaBlockerBluffIsPriced.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-17, earlier the same day: the size of the bet must not make or break a decision.

## The rule it replaces

The 0.28 equity line of the V86 river nut-blocker bluff and its paired-board bar (`omahaPricedBlockerBluffAdmits` under `omahaPairedBoardBetIsPriced`, else no bluff on a paired board), HorseLogic.ts decidePostflop.

That rule stays in source and keeps deciding while this option is off: it is live production behaviour.

## The priced comparison

`omahaPricedSitesBlockerBluffAdmits` (HorseOmahaPricedSites.ts) on `omahaPricedBet`: best bet row against the check.

The opponent read comes through one interface (`omahaPricedReadOfUser`, HorseOmahaPricedWiring.ts): the pooled read without its labels, and the per-street, per-texture cells through `omahaPricedSetStreetRatesSource` when that read is delivered. No prior, bluff share or bet-rate factor is computed in HorseOmahaPricedSites.ts: they are those of `omahaPricedBet` / `omahaPricedCardImpactRead` (HorseOmahaPricedRules.ts), so a fix there (the opponent-kind prior of the priced2 build) reaches this option with no edit. Every opponent range is drawn from the cards the Horse does not hold. A spot that cannot be priced keeps the engine decision with an `_unpriced_kept` receipt.

## Receipts

omaha_priced_site_blocker_bluff_admitted, \_refused, \_unpriced_kept (HorseDataLedger.ts).

## Tests

HorseOmahaPricedSites.test.ts (off and out of scope change nothing; each answer is the priced comparison; unpriced spots keep the decision; whole decisions with every site on are legal and fail no rule), HorseOmahaNoBlanketRule.law.test.ts (the site is registered; with the priced options on its legacy receipt does not decide).

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Replay on audited real decisions (PASS-BAR section 1): NOT MET (1 change, judged wrong, -57.4 bb). Archive plo-handoff-review-01a1cbbd/sites-013U37/REPLAY-20261118.md.
- League: INCONCLUSIVE (near-inert, low reach). Archive `plo-handoff-review-01a1cbbd/evals-013U37/omahaBlockerBluffIsPriced/RESULTS.md` (bar `PASS-BAR.md` there, written first), source eb30ce7a6f9, 2026-11-18. A minus B, bb/100:

  | cell | table                                          | sessions x pairs | A - B, bb/100 | SE    | z     | divergent pairs | inert sessions |
  | ---- | ---------------------------------------------- | ---------------- | ------------- | ----- | ----- | --------------- | -------------- |
  | F4   | PLO4, one Horse vs five human-calibrated seats | 400 x 500        | -0.036        | 0.036 | -1.00 | 1               | 399            |
  | F5   | PLO5, the same                                 | 400 x 500        | -0.008        | 0.017 | -0.47 | 3               | 397            |
  | M4   | PLO4, Horse-only, production styles            | 100 x 500        | +0.059        | 0.049 | +1.20 | 146             | 77             |
  | M5   | PLO5, the same                                 | 100 x 500        | +0.042        | 0.077 | +0.55 | 85              | 83             |

  Pooled: human-like -0.022 bb/100, SE 0.020 (z -1.11); Horse-only +0.051, SE 0.046 (z +1.11). Valid: every session present, 0 illegal, 0 truncated, 0 fallbacks. The option moved 1 and 3 of 200,000 pairs in the human-like cells: too little reach to measure.

- Overall: NOT MET. Do not switch on.

## Batch integration 2026-11-18 (PLO option batch, agent/plo-batch-013U37/feat/omaha-option-batch)

Default OFF, switchable in the registry but: **replay NOT MET (too thin: 1 change), league INCONCLUSIVE (near-inert); do not switch on.** It stays off.

Review R3 B1 of sites 27852aafb40, fixed in the batch: the admission priced "some bet beats the check" while a later, never-priced size (bet86Rb) was placed. Now the engine sizes the bluff first and `omahaPricedSitesBlockerBluffAdmits(player, gs, opts, bet86Rb)` prices THAT exact amount (`omahaPricedBet(..., amount).proposed.ev > evCheck`); a bet it cannot price makes no bluff (test: HorseOmahaPricedSites.test.ts, the placed amount is the priced amount). The gates that decide whether the bluff is offered at all (chips behind, the capped-line and station label reads, the persona frequency draw targetRb86) still act with the option on: they are registered as OPEN site S6b in HorseOmahaRuleSites.ts with their own receipt `omaha_priced_site_blocker_bluff_gate_withheld` (they are not priced).

League cards (HorseLeague.ts, declared, not run): plo4_omaha_blocker_bluff_is_priced and plo5_omaha_blocker_bluff_is_priced: the live options of 2026-11-16 in both arms, arm A adds omahaBlockerBluffIsPriced. Run once on eb30ce7a6f9: INCONCLUSIVE (Evidence rows).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
