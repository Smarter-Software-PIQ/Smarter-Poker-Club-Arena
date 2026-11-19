# Omaha sampled raise: every legal size priced, the fold read at the price each raise lays

Date: 2026-11-19. Lane: PLO (Horse decisions). New option `omahaSampledRaiseIsPricedAtEverySize`, default OFF; nothing is switched and production does not change.

## Why

The independent verifier's follow-up on #11345: `omahaPricedSampledRaise` (HorseOmahaPricedRules.ts, the flop and turn raise of `omahaDrawRaiseIsPriced` and `omahaPressureIsPriced`) still read the fold to a raise size-blind and priced a single raise size. A minimum raise was priced with the fold share of an average raise and no size was compared with another. The owner's rule: the size of the bet may only feed the range and the price.

Both families are OFF in production, and their evaluations (EQUAL) were measured on the size-blind code, so the change sits behind a new default-OFF option rather than inside them: with it off every decision is byte-identical.

## What changed

- HorseOmahaPricedRules.ts: `omahaPricedSampledRaise` takes the legal raise-to range (`sizes`). With it, the fold, the call and a raise to the minimum, the middle, the maximum and the proposed size are priced; each raise's fold share is every opponent's fold at the price that raise lays (`omahaPricedSampledFoldAtPrice`, `OMAHA_PRICED_SAMPLED_REFERENCE_FOLD`: flop 0.369, turn 0.353, measured); the verdict names the action of highest value, the best raise and every row. Without `sizes` the code path is the one before.
- HorseOmahaPricedWiring.ts: `sampledSizes` supplies the range only with the option on; `omahaPricedDrawRaiseRule` makes a standing raise to the size of highest value (receipt `omaha_priced_draw_raise_resized`).
- Registered: HorseLogic.ts (HorseDecideOpts), HorseOptionSwitch.ts (release default off), HorseDataLedger.ts (flag and receipt), HorseOmahaRuleSites.ts (class priced, an input), HorseLeague.ts (cards plo4/plo5_omaha_sampled_raise_is_priced_at_every_size), ADefaultOffFlagHasALeagueCard.law.test.ts (its consumers), docs/horse-option-authority.d/omahaSampledRaiseIsPricedAtEverySize.md.

## Not in this change

The option-switch list migration (the lane lead generates one list migration for the lane) and the CI switch-evidence script's option list that goes with it; any league or replay; any switch.

## Tests

HorseOmahaSampledRaiseAtEverySize.test.ts (new, 15 tests). Server tsc 0.
