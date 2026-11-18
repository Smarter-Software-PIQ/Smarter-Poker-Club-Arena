# Omaha: the opponent read by street and flop texture is used (default OFF)

Date: 2026-11-18. Lane: PLO Strategy (readwire). One new option, off by default (read `=== true`): `omahaReadIsByStreetAndTexture`. Nothing is switched on by this change.

## What was there

#11215 keeps each opponent's postflop play apart by street and by flop texture and no decision read it. The value-leader label, the bettor's bet rate beside the Horse mean (the facing-bet bluff share and its 0.65 cap) and the priced comparisons' fold to a bet / to a raise each read one pooled figure for every street and board.

## What changed

With the option on, for a PLO4/PLO5 cash decision on the flop, turn or river (one board, no bomb pot), those three inputs are read from the decision's own street (the flop's texture cell for the flop bet rate), each blended continuously with the pooled figure by the street cell's decayed opportunities: with no street evidence the pooled figure stands exactly; there is no opportunity threshold. `HorseOmahaFacingBetEv.ts` is not touched.

## Files

- New: `server/src/engine/HorseOmahaReadByStreet.ts` (pure read), `HorseOmahaReadByStreetRule.ts` (per-decision installer), `HorseOmahaReadByStreet.test.ts`, `server/src/benchmark/HorseLeagueStreetRead.ts` (the league learns the street read in a card's sandbox).
- Added lines: `HorseMind.ts` (the two per-street readers), `HorseLogic.ts` (the option and the per-decision wrapper), `HorseOmahaPricedWiring.ts` (getter of the street-rates source), `HorseDataLedger.ts`(+test), `HorseOmahaRuleSites.ts`, `HorseReferenceDecisionSources.ts`, `benchmark/HorseLeague.ts` (two cards and the learner call), the law test of the street read (law 8 admits the option's readers).
- The generated option-switch follow-up migration and `scripts/ci/test-horse-option-switch-evidence-postgres.sh`. Registering enables nothing.

Authority file: `docs/horse-option-authority.d/omahaReadIsByStreetAndTexture.md`.
