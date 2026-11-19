# Omaha: the river facing-bet verdict priced on his measured betting range (default OFF)

Date: 2026-11-18. Lane: VALUE-REGION (hand audit of hand 59993188, the general cause). One new option, off by default (read `=== true`): `omahaFacingBetValueIsRangeRelative`. Nothing is switched on by this change.

## What was there

The facing-bet EV (`HorseOmahaFacingBetEv.ts`) models the bettor's value bets as the strongest share of ALL five-card holdings (0.30 for a mid-size river bet, times 0.8 per earlier street he bet: 0.192 in hand 59993188), plus a population bluff prior. On a paired board a fifth of random holdings are full houses, so the value region holds nothing a flush beats, whatever his preflop and postflop line. In hand 59993188 the Horse folded the ace-high flush to a person's bet at a price of 26.0%.

## What changed

New `server/src/engine/HorseOmahaFacingBetValueRange.ts` (pure, deterministic). With the option on, inside `omahaFacingBetEv`, on the river, heads-up, facing a person's first bet (PLO4/PLO5 cash): the verdict is EV(call) at the actual price against his range on this board (preflop re-raise width, the Horse's blockers) weighted by the measured density of the strength percentile people bet at, by earlier aggression and bet size (1,201 recorded bets with known cards). See `docs/horse-option-authority.d/omahaFacingBetValueIsRangeRelative.md`.

## Evaluation

Declared before the run. Added calls won 39.5% at a mean price of 26.3% (+47.0 bb, interval above zero), but the 69 removed calls were winners on average, the reviewed paired-river lead (59730132) flips to a call and one correct river call of eleven flips to a fold. FAIL. The option stays OFF.

## Files

- `server/src/engine/HorseOmahaFacingBetValueRange.ts`, `HorseOmahaFacingBetValueRange.test.ts` (new).
- `server/src/engine/HorseLogic.ts`: the option, the count memo key and the call into the new module.
- `server/src/engine/HorseDataLedger.ts`, `HorseOmahaRuleSites.ts`, `HorseReferenceDecisionSources.ts`, `server/src/benchmark/HorseLeague.ts`, `ADefaultOffFlagHasALeagueCard.law.test.ts`: the registry entries and two league cards.
- The option-switch list follow-up migration and the proof script lists (generated).
