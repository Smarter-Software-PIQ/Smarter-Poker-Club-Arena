# Omaha sampled raise: every legal size priced, the fold read at the price each raise lays

Date: 2026-11-19. Lane: PLO (Horse decisions). New option `omahaSampledRaiseIsPricedAtEverySize`, default OFF; nothing is switched and production does not change.

## Why

The independent verifier's follow-up on #11345: `omahaPricedSampledRaise` (HorseOmahaPricedRules.ts, the flop and turn raise of `omahaDrawRaiseIsPriced` and `omahaPressureIsPriced`) still read the fold to a raise size-blind and priced a single raise size. A minimum raise was priced with the fold share of an average raise and no size was compared with another. The owner's rule: the size of the bet may only feed the range and the price.

Both families are OFF in production, and their evaluations (EQUAL) were measured on the size-blind code, so the change sits behind a new default-OFF option rather than inside them: with it off every decision is byte-identical.

## What changed

- HorseOmahaPricedRules.ts: `omahaPricedSampledRaise` takes the legal raise-to range (`sizes`). With it, the fold, the call and a raise to the minimum, the middle, the maximum and the proposed size are priced; each raise's fold share is every opponent's fold at the price that raise lays (`omahaPricedSampledFoldAtPrice`, `OMAHA_PRICED_SAMPLED_REFERENCE_FOLD`: flop 0.369, turn 0.353, measured); the verdict names the action of highest value, the best raise and every row. Without `sizes` the code path is the one before.
- HorseOmahaPricedWiring.ts: `sampledSizes` supplies the range only with the option on; `omahaPricedDrawRaiseRule` makes a standing raise to the size of highest value (receipt `omaha_priced_draw_raise_resized`).
- Registered: HorseLogic.ts (HorseDecideOpts), HorseOptionSwitch.ts (release default off), HorseDataLedger.ts (flag and receipt), HorseOmahaRuleSites.ts (class priced, an input), HorseLeague.ts (cards plo4/plo5_omaha_sampled_raise_is_priced_at_every_size), ADefaultOffFlagHasALeagueCard.law.test.ts (its consumers), docs/horse-option-authority.d/omahaSampledRaiseIsPricedAtEverySize.md.

## Review follow-up (same day, REVIEW-7339ae3f40e, accept with notes)

- The raise is MADE at the priced size: the pressure raise of `omahaPressureIsPriced`, admitted when the best priced size beats the call, is now made at that size, a draw or not (`omahaPricedPressureRaiseSized`, receipt `omaha_priced_pressure_raise_resized`, called first in `omahaDrawRules`); before, it kept the brain's size. The receipt validator admits a resized raise for the exact chips of a priced size (`omahaPricedSampledAdmitsResize`, `omahaSampledRaiseResized` in responseValidation.ts; the generic wager clause is unchanged).
- The fold-to-raise cell is carried from the price it was measured at (`OmahaPricedCell.price`). No stored cell carries one today, so the frozen reference price stands only for raises made through 2026-11-15, and the authority file states that a price-indexed cell is required before switch-on (a counter migration, not written here).
- A player still to answer the wager is priced on his real call (the raise-to less his own bet).
- The share held when called is taken against the part of the range that continues at that price (`omahaPricedSampledContinuingShare`; `omahaBigDrawEquities` can return its sample counts), so a larger raise faces a stronger range.
- A raise the mix took without being priced above the call is resized under `omaha_priced_draw_raise_mixed_resized`.
- The legal sizes are priced whatever the proposed size is; a resized decision drops `valueSize` with `continuationGuard`.

## Delta review follow-up (same day, REVIEW-DELTA-51018cc8c3b, one blocking item)

- The admission of the pressure raise is carried with the decision. 51018cc8c3b kept it in a module set in HorseOmahaPricedWiring.ts keyed by the public spot, which outlived the decision: a later decision on the same public spot could inherit it. The set is deleted. `omahaPricedPressureWithheld` tells its caller (an object the caller owns); the brain's pressure block writes HorseLogic's per-decision memo `omahaPressureAdmittedAtPriceMemo` (the decision's state object and seat; cleared with the other per-decision memos at the start and end of every decision); `omahaDrawRules` reads it for the same state object and passes it to `omahaPricedPressureRaiseSized`.
- Tests: the whole decision in which the brain prices and admits the pressure raise and it is made at the priced size; a second decision on the same public spot inherits nothing (fails on 51018cc8c3b).
- Authority file: the dedicated validator admission against the generic clause; the direction of the bias of the two-class continuing range; the price of a player still to answer.

## Review notes C1, N1, N6 (same day, REVIEW-DELTA-6ff63300048 and the first review)

- N1, root: an admission by a priced size never leaves the raise at the brain's own unpriced size. The admission now carries the size it priced (`OmahaPricedPressureAdmission.sampledTo`, written only once the answer is the admission; HorseLogic's per-decision memo keeps it with the state object and seat). `omahaPricedPressureRaiseSized` prices the raise again and makes it at the size of highest value; where the spot cannot be priced again, no raise stands above the call any more, or the pricing throws, it makes the raise at the size the admission priced (before, it kept the brain's size). A draw the draw-raise rule owns is still priced and sized (or called) there. Pinned by the law `AnAdmittedPressureRaiseIsMadeAtItsPricedSize.law.test.ts`.
- N6: the receipts of the draw-raise rule are true under `omahaPricedMix`. A raise the mix took that was NOT priced above the call and is kept at the size given fires `omaha_priced_draw_raise_mixed_kept` (not `_kept`, which says it was priced above the call); a raise priced above the call that the mix turned into the call fires `omaha_priced_draw_raise_mixed_called` (not `_called`, which says it was not). Decisions are unchanged; only the receipt names.
- C1: a DRAW raise resized through the whole decision (HorseLogic.decide): fixtures in which the brain itself raises or shoves the nut flush draw with a wrap and the draw-raise rule makes it at the priced size; the test asserts that at least one whole decision moves (count above zero) before the per-item checks (the receipt, the rule's own answer, the legal range, the dedicated admission and the whole receipt validator). The first whole-decision test gets one such spot and now asserts its resized count above zero too.
- C2 and S1 were closed in 1cbb01f8859 (the same state object decided twice, the second with the mind off, inherits no resize; "no decision state").

## Not in this change

The option-switch list migration (the lane lead generates one list migration for the lane) and the CI switch-evidence script's option list that goes with it; any league or replay; any switch.

## Tests

HorseOmahaSampledRaiseAtEverySize.test.ts (new). Server tsc 0.
