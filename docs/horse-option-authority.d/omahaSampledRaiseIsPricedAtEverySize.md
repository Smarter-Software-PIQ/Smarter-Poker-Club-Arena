# omahaSampledRaiseIsPricedAtEverySize: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago (no blanket rules; every decision by math, ranges, equity and EV) and of earlier the same day (the size of the bet must not make or break a decision: it may only feed the range and the price). Built by the PLO lane on 2026-11-19 for the verifier defect on `omahaPricedSampledRaise` (HorseOmahaPricedRules.ts). Evidence NOT MET: no league and no replay yet. **Do not switch on.**

## What it does

PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default OFF (read `=== true`). It is an input of `omahaDrawRaiseIsPriced` and `omahaPressureIsPriced` and acts only where one of them is on (both are OFF in production today). With it on, the sampled comparison of the flop and turn raise (`omahaPricedSampledRaise`):

- prices the fold (0), the call and a raise to each legal size: the minimum, the middle and the maximum legal raise (`OMAHA_PRICED_RAISE_STEPS`, the pot raise or the stack at most, no more than the deepest opponent holds) and the size proposed;
- reads each opponent's fold to a raise AT THE PRICE THAT RAISE LAYS HIM (`omahaPricedSampledFoldAtPrice`): his size-blind figure (his fold to a bet times 0.42, and the street read's fold-to-raise cell shrunk toward it) times the minimum-defence fold of this raise over the minimum-defence fold at the prices the measured raises laid (`OMAHA_PRICED_SAMPLED_REFERENCE_FOLD`). As in `omahaPricedRaise` (#11345) the fold priced is the smaller of the two readings of a cell (the cell shrunk toward the prior at this price; the whole read carried to this price);
- names the action of highest value: the raise of highest value when it is worth more than the call by 2 percent of the pot and more than the fold, else the call when it is worth more than the fold, else the fold;
- at the draw-raise rule (`omahaPricedDrawRaiseRule`) makes a raise that stands to the size of highest value (receipt `omaha_priced_draw_raise_resized`) and keeps the size given when it is that size; at the three draw-raise sites and the pressure raise the play is admitted when a raise of some legal size is priced above the call.

Off (absent, false or a truthy non-boolean): one size is priced with its fold share size-blind, exactly as #11212; every decision is byte-identical (HorseOmahaSampledRaiseAtEverySize.test.ts).

## The defect it repairs

`omahaPricedSampledRaise` took one raise-to amount and a fold share that did not depend on it. A 20-chip minimum raise into 120 was priced with the fold share of an average raise (0.18 with no read; the cell's figure with one), and no raise size was compared with another. With no read the old comparison raises the minimum with no pair and no draw facing 20 into 100 (2c3c7s8sKc on Qh9h3d: raise +4.2, call -4.0); priced at the price it lays, that raise is folded to 0.06 of the time and every action there is worth less than the fold.

## The measurement behind the reference price

Archive plo-handoff-review-01a1cbbd/full-sweep-20261115/private/decisions_full.csv (PLO4/PLO5 cash, heads-up, 2026-11-10 to 2026-11-15, a Horse's raise and the response to it; persons and Horses together), computed by sampledraise-01TLQer7J/fold-by-price.py (output fold-by-price.txt): flop 65 raises, mean minimum-defence fold 0.369, folded to 11 (0.17); turn 39 raises, mean 0.353, folded to 9 (0.23). By the price laid, flop and turn together: below 0.30, 1 of 21 folded; 0.30 to 0.40, 5 of 32; 0.40 and above, 14 of 51. The fold rises with the price laid; the option carries the population figure and each read along the minimum-defence line through the measured point.

## Limits

- The line through the measured point is the minimum-defence shape, not a fitted curve: 104 raises do not support more. The three price bands rise faster than the line below the reference price (1 of 21 against 0.09 to 0.12 priced), so a small raise is, if anything, still priced with too much fold.
- The range that continues against a raise (`omahaBigDrawEquities.raise`) is one sampled range for every size; only the fold share and the chips follow the size.
- The call is the realized share of the pot now, with no chips won on later streets.
- The rule sites apply the raise or the call. The fold the comparison names is reported in the verdict (`action`) and is not applied by `omahaPricedDrawRaiseRule`: a draw raise that is not priced above the call becomes the call, as with the option off; the fold or call of the hand stays with the facing-bet owner.
- One or two opponents only; three or more, or one all in, keep the decision given (unpriceable, as before).

## Receipts

omaha_priced_draw_raise_resized (new, HorseDataLedger.ts); the families' own receipts (omaha*priced_draw_raise*\*, omaha*priced_pressure*\*) count the decisions it changes.

## Tests

HorseOmahaSampledRaiseAtEverySize.test.ts: the defect pinned with the option off (a minimum raise and a pot raise share one fold share; no rows); the fold at the price (the population figure at the reference price, proportional elsewhere, never above either reading of a cell); each legal size priced, the row of highest value chosen, fold / call / raise by value on concrete hands; the rule site resizes or calls; unset / false / truthy non-boolean byte-identical through the whole decision, and alone without a family it changes nothing; on, every decision legal and admitted by the receipt validator.

## Evidence rows

- Mechanism, scope, visibility (receipt), tests: MET.
- Option unset or false: byte-identical (test above; HorseOmahaPricedRules.test.ts, HorseOmahaPricedRulesRecorded.test.ts and HorseOmahaPricedKindOptions.test.ts unchanged and passing).
- Value: NOT MET. No league and no counterfactual replay has been run.

League cards (HorseLeague.ts, declared, not run): plo4_omaha_sampled_raise_is_priced_at_every_size and plo5_omaha_sampled_raise_is_priced_at_every_size: the live options of 2026-11-16 and every priced family in both arms, arm A adds omahaSampledRaiseIsPricedAtEverySize.
