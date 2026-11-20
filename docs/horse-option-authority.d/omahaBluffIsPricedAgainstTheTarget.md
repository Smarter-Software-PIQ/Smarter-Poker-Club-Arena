# omahaBluffIsPricedAgainstTheTarget: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago (verbatim): "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc." Built by the HORSE DECISIONS lane on 2026-11-19 (lead session 01TLQer7J) for classes 2 and 4 of the 48-hour audit of PLO5 Lightning cash against persons (archive plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J/A-plo5-lightning/REPORT.md). Default OFF in source (read `=== true`). Evidence NOT MET: no league and no replay yet. **Do not switch on.**

## What it does

PLO4/PLO5 cash, one board, high only, no bomb pot, not fixed limit, not a tournament; at a table AND in the Lightning pools (the option opens Lightning itself; `omahaPricedInLightning` is not read). It is the outermost answer of HorseLogic `wager_rules` (HorseOmahaBluffPricedAgainstTheTarget.ts), after the public bet size:

1. A wager facing no bet, heads-up, on any street (the river bluff baseline, the river nut-blocker bluff, the card-impact press bets and every other owner's bet alike: nothing asks what the hand is called) stands only when

   EV(bet) = f.P - (1 - f).(b - r.e_called.(P + 2b)) > EV(check) = r.e_all.P

   f his fold share at this price; e_called the Horse's sampled showdown share against the strongest (1 - f) of his holdings (the weakest fold first; on the river ordered by his own score on the board, on the flop and turn by the nested continue classes of the big-draw sample); e_all its share against all of them; r = 1 on the river or when the bet puts the matched stack in, else 1 in position and 0.8 out of it (OMAHA_BIG_DRAW_OOP_REALISATION). Else the check.

2. A final CALL facing a flop bet (one or two opponents) is priced against a raise to each legal size by `omahaPricedSampledRaise` with `omahaSampledRaiseIsPricedAtEverySize`'s size grid (REUSED unchanged: the seeded sample, the continue ranges for a bet and a raise, the fold at the price each raise lays, the share against the part that continues at that price, the sampled margin), each opponent's fold to a bet taken from his measured record below. A raise priced above the call is made at the size of highest value.
3. A RAISE facing a flop or turn bet is priced the same way: kept (or resized to the priced size) when a raise is priced above the call, else the comparison's answer, the call, or the fold when the call is worth less than nothing.

His fold share (omahaTargetFoldShare): his fold-to-bet cell for this street (HorseMind.omahaStreetReadOf, foldToBet[street]) shrunk toward his kind's measured street rate (HorseOmahaPricedMode.omahaPricedKindPrior) by 16 pseudo-opportunities (the person fold model's fitted prior strength); with no street cell, his pooled postflop counters (HorseMind.foldToBetCountersOf) shrunk toward his kind's pooled rate and carried to the street by his kind's street-over-pooled log-odds; with neither, his kind's street rate. That rate is read at the median bet size of the bets behind it (OMAHA_TARGET_FOLD_REFERENCE_BET_POT: flop 0.449, turn 0.626, river 0.792 of the pot; priced-01BNteGZ/calibration/rates.json) and carried to the price of this bet by the fitted size slope of the person fold model on logit(s/(P+s)) (OMAHA_FLOP_BET_PERSON_FOLD_FIT.logitMdf, 1.142). Continuous: no sample threshold, no label, no size cut. The bet size enters only through the price.

Not re-priced: the river raise of `riverBluffCheckRaise` (already priced on the lower 99% bound of his measured answer to that exact line); multiway bets (the formula is heads-up; kept, receipt `_unpriced_kept`); turn and river calls (owned by `omahaTurnRiverRaiseIsPriced`); river raises from other owners.

## The audited hands

Class 2 (bluff or thin bet into a calling range, 47 CLEAR+LIKELY flags) and class 4 (missed raise, 86 LIKELY flags, 51 on the flop). Every flagged row of both classes was re-priced with the option on (bluffprice-01TLQer7J/BUILD.md lists each): class 2, 16 of 49 change (14 bets to the check: 7 flop, 7 river; 2 turn raises to the call), 3 multiway rows are not priced; class 4, 39 of the 63 flop calls become a raise (36 raises, 3 all-ins; turn and river calls are not in scope). The audit's river pot-sized bluffs with no showdown value against WooWoo stay: with his record f is about 0.73 at a pot bet, and on these 48 hours he folded 36 of 42 river bets of 0.75 to 1.05 pot (wfold3.py), so the audit's continue model (MDF plus 0.20 for a person) is what disagrees with the measurement there. Law fixtures (ABluffOrThinBetIsPricedAgainstTheTarget.law.test.ts): hands 59971022, 60168678, 59970978, 59972602, 59990589, 60062664, 60007086 (bet to check), 60005614, 60012446 (raise to call), 60144236, 59973358, 59989435, 60018347, 59989137, 60120165, 60169065 (call to raise).

## Receipts

omaha_bluff_priced_against_target_bet_kept, \_checked, \_call_kept, \_call_raised, \_raise_kept, \_raise_resized, \_raise_called, \_raise_folded, \_unpriced_kept (HorseDataLedger.ts); the changing ones also as per-decision rule receipts. Receipt validator: bet to check admitted in the bet-or-check spot re-derived from the request; flop / turn raise to call only with the request, in the sampled spot, for the exact chips of the call (horseDecision/responseValidation.ts).

## Tests

HorseOmahaBluffPricedAgainstTheTarget.test.ts (his measured fold: prior, shrinkage, pooled carry, size continuity; the share against the strongest holdings, flop/turn classes and river order; the closed form; scope and identity; the whole decision off byte-identical for unset / false / truthy non-boolean, on legal and admitted by the receipt validator with some decisions changed; receipts registered). ABluffOrThinBetIsPricedAgainstTheTarget.law.test.ts (the audit fixtures, red off, green on; table and Lightning alike).

## Limits

- Opponent holdings are every unseen holding, ordered by strength; his line on earlier streets does not narrow the range (it enters only through his measured fold).
- EV(check) is the Horse's share of the pot as it stands; a bet he makes after the check and a check-raise are not priced.
- His per-street cell is empty in production today (horse_exact_profiles.street_counters), so his pooled record, carried by his kind's street ratio, is what is read for persons now.
- The size slope was fitted on flop bets; turn and river sizes are carried by the same slope.

League cards (HorseLeague.ts, declared, not run): plo4_omaha_bluff_is_priced_against_the_target and plo5_omaha_bluff_is_priced_against_the_target, the live options of 2026-11-18 in both arms, arm A adds the option.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; the audit fixtures of the law test are function-level re-pricings, not a replay)
