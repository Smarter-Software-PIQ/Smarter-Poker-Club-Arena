# omahaPreflopJamFacingReraiseIsPriced: authority for the live switch

Built 2026-11-19 by lane CALL-OR-RAISE-2B of the WooWoo 48-hour audit successor, for the owner's complaint on hand #60156608 (a Horse 3-bet AKQQx in position, faced a person's 4-bet, 5-bet the pot and stacked off about 243 bb). This file does not authorize switching the option on: its evaluation is declared in the audit archive (`repairs/CALL-OR-RAISE-2/EVAL-DECLARATION-JAM.md`, hashed before its run) and no owner order names it.

## What it does

PLO4/PLO5 cash (ordinary and Lightning tables), high only, one board, no bomb pot, not a tournament, preflop, facing two or more raises (a 3-bet, a 4-bet, a 5-bet or later), heads-up with the re-raiser, the re-raiser not all in and the Horse with chips behind after a call. Before this option the preflop rules chose the re-raise (4-bet), the 5-bet jam and the call facing a re-raise by the hand's entry-score percentile against a bar (HorsePreflop, `raises >= 3` "jam-or-fold on true premiums only" and the 4-bet threshold facing a 3-bet); no step priced any of them against the hands that put the money in.

With the option on, the decision the re-raised-pot rules leave standing is replaced by the largest of three EVs, each at the lower bound of the Horse's equity (the estimate minus twice its standard error):

- EV(fold) = 0;
- EV(call) = the calling rule's `omahaReraisedCallEv`: realization at the stack-to-pot ratio the call leaves, in or out of position (the measured `omahaReraisedCallRealization`, archive `repairs/REALIZATION/REALIZATION.md`; 1 only when nothing is left behind) x equity against his range at this raise x the pot after the call net of rake - the call;
- EV(raise) = P(fold) x pot + P(call) x (realization at the ratio left x equity against the hands that continue x the pot called net of rake - chips added) + P(re-raise) x max(-chips added, EV of going on against the hands that raise again), with his answers from his own record (`horse_exact_profiles.reraise_response`, `reraiseResponseRatesForTheRaise`). The raise priced is the standing raise when the rules proposed one, else the pot raise capped by the stack.

The ranges are measured (`OMAHA_RAISE_RANGE_COMPOSITION`, `omahaMeasuredRangeEquity`): the composition of the hands people showed after making the k-th raise of a preflop street (production, PLO4/PLO5 cash, hands with a person, 2026-10-15 to 2026-11-17 00:00Z): two aces, two kings (fewer than two aces), and the rest drawn from the band of his measured re-raise rate. Shown after a 3-bet 600 (aces 50, kings 43), after a 4-bet 180 (31, 14), after a 5-bet or later 86 (24, 10). The range he continues with against the Horse's raise is the measured range one raise higher. Archive: `repairs/CALL-OR-RAISE-2/raise-range-summary.txt`, `scripts/r4.sql`.

Nothing is keyed to a hand class, the strength percentile, a position, a bet size or an account: the Horse's equity against those hands decides. A high-card hand without connection loses most of its equity to the aces part (AKQQx about 0.38 against two aces), a double-suited rundown keeps it (about 0.48); this comes out of the equity, not out of a rule.

Hand #60156608 (anonymised suits, unit test): fold 0, call +15.7, 5-bet +9.2 (lower bounds, chips); the call is played.

Boundaries: a call that `omahaPreflopReraiseDefencePricedInPosition` (ON in production) made of a fold is that option's and is not priced here. A spot with any other player still in the hand is not priced. A call that closes an all-in (nothing behind after it) is not priced. `omahaReraisedCallVsRaisePriced` runs after this option on its result.

Owner 2026-11-19 16:56 Chicago (aces facing a raise should get it all in when they can): measurement
`repairs/CALL-OR-RAISE-2/AA-MEASUREMENT.md`. In PLO4/PLO5 a Horse holding aces facing a person's 4-bet or more called
95 of 107 times in 7 days (median 1.8 pots behind); the call is chosen by HorseLogic's V38 preflop all-in price
(`v38_preflop_allin_price`, maniac_price consumer), which jams only to isolate other live players and so calls heads-up
however few chips stay behind. This option prices those calls against the jam; 34 of the 46 such heads-up calls in the
held-out set were at Lightning tables, so Lightning cash is in scope.

## Dependencies

Reads the re-raise response record (migration `20261118023000`, installed; 757 opponent rows hold one on 2026-11-19 20:22Z) and the opponent's measured re-raise rate. Without a record the population prior answers.

## The owner's orders it rests on

- 2026-11-19 15:34 Chicago, relayed by the lead (paraphrase as relayed): "Just calling would have been fine, see a flop and proceed. Re-raising AKQQ should never be an option. Re-raising a rundown would have been much better than AKQQ, because AKQQ is crushed when they call or shove."
- 2026-11-17 15:30 Chicago: "DONT' MAKE ANY BLANKET RULES, EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS".

Neither is an order to switch this option on.

## Receipts

`omaha_preflop_three_way_fold`, `omaha_preflop_three_way_call`, `omaha_preflop_three_way_raise` (every priced decision fires one), `omaha_preflop_three_way_changed`. The decision carries `omahaPreflopThreeWay`: every EV at the estimate and at the lower bound, the equities, the parts of the range and the realizations.

## Tests

`HorseOmahaReraisedRaisePriced.test.ts` "omahaPreflopJamFacingReraiseIsPriced: fold, call and raise priced against measured ranges (hand #60156608)"; `HorseOmahaOopReraisedPot.test.ts` "omahaPreflopJamFacingReraiseIsPriced in the decision (default OFF)" (unset and false byte-identical; on draws no random number and plays the largest lower-bound EV; PLO6, a tournament, Lightning and a bomb pot untouched).

## Evidence rows

- Mechanism, scope, receipts, tests: MET (unit tests).
- Option unset or false byte-identical: MET in unit tests; replay: see the evaluation.
- Value: see `repairs/CALL-OR-RAISE-2/EVAL-DECLARATION-JAM.md` and LANE-REPORT.md. Live reach: NOT MET.

## Limits

Shown hands only (a pot that ends before a showdown is not counted: 180 of 351 people's 4-bets were shown). One pooled composition of people for every opponent: a Horse raiser holds aces more often (Horses' 4-bets shown: 160 aces of 323), so against a Horse this prices the Horse's equity high. No per-player record of shown hands exists in the engine. The rest of the range is the percentile band. Heads-up only. At Lightning tables the same realization constants and compositions are used (both were measured over all cash hands; no Lightning-only measurement). No PLO5 solver exists.

## Rollback

`fn_ca_horse_option_switch_set('omahaPreflopJamFacingReraiseIsPriced', 'off', ...)`: the rules' own decision stands again.

## Replay

- Replay: NOT RUN (as of 2026-11-19 the declared evaluation (repairs/CALL-OR-RAISE-2/EVAL-DECLARATION-JAM.md) has not produced a scorer --row run row)

Pending the evaluation declared in `repairs/CALL-OR-RAISE-2/EVAL-DECLARATION-JAM.md`; the scorer lines are written there and in LANE-REPORT.md once it runs (the audited WooWoo window precedes the held-out set, so the scorer joins no node of it).
