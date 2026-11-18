# omahaPairedBoardRiverIsPriced: authority for the live switch

Built 2026-11-18 by lane PAIRED-RIVER on the lead's decision of 2026-11-18 (hand audit of hand 59993188). Evidence NOT MET: the declared evaluation of 2026-11-18 was INSUFFICIENT and one bar failed (below). This file does not authorize switching the option on; it records what the option is and what must pass first.

## What it does

Inside `omahaFacingBetEv` only (PLO4/PLO5 cash, one board, high only), on the river, heads-up, facing the first bet of the street (not a raise) made by a person, on a paired board, when the Horse holds a straight or a flush that no straight, flush or straight flush of the unseen cards beats (only a full house or quads does): the facing-bet verdict is priced on the bettor's line-conditioned range instead of on every five-card holding (`server/src/engine/HorseOmahaPairedRiverPriced.ts`).

- Before the flop: a bettor who re-raised holds the top share of hands by the engine's preflop percentile, at the width the engine's preflop re-raise defence already uses for a person (3-bet 0.40 PLO4 / 0.50 PLO5, 4-bet 0.28 / 0.38). An open or a call does not narrow him.
- Flop and turn: on a street he bet, holdings inside the engine's value share for that size on that board keep full weight and the rest a fitted weight; on a street he called, the same with the caller share. A street he checked carries no weight.
- The Horse's cards, the board and dead cards are removed from the deck he is dealt from, so its blockers to full houses and to lower flushes and straights are exact.
- River: each hand class (full house or better; flush or straight; trips or two pair; less) is bet with a measured relative frequency that depends on the bet's share of the pot.
- EV(call) = P(win) x the pot after rake + P(tie) x the split - P(lose) x the call, at the actual price, against the facing-bet rule's one margin (2% of the final pot). It is the facing-bet verdict in that spot, in both directions; the paired-board fold of 2026-10-25 does not decide where it says call (the facing-bet rule already runs after that fold).
- Not priced here: the lead of 40% of the pot or more into the Horse that bet the turn by a player who only called earlier streets (hand 59730132), which keeps the reviewed facing-bet verdict; a bet made by a Horse or by a player of unknown kind (the river frequencies are measured on people only); multiway pots; raises; six cards; tournaments; bomb pots; any hand below a straight.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaPairedBoardRiverIsPriced docs/horse-option-authority.d/omahaPairedBoardRiverIsPriced.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim), and how they are read

- 2026-10-25 (the paired-board fold, `HorsePloPairedBoardFold.ts`): "HE CALLED THE ALL IN ON THE TURN WHEN THE JACK PAIRED THE BOARD..." "ITS A FOLD 100% OF THE TIME"; that evening: "ADD PLO4 AND PLO5 AND THE FLOP TO THE PAIRED BOARD FOLD RULE".
- 2026-11-17 (no blanket rules): "EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS".
- 2026-11-18 11:13 America/Chicago, on hand 59993188: "HORSE PUT IN OVER 500 CHIPS AND FOLDED ... CALLING ON TURN AND FOLDING RIVER ...".

The two rulings conflict on hand 59993188: the 2026-10-25 rule folds the nut flush on a paired river at any price above 0.25; the 2026-11-17 ruling forbids a categorical answer. Lead's decision 2026-11-18: where a priced verdict exists, the later ruling governs and the categorical fold stands aside. Outside the spot above nothing of the 2026-10-25 rule changes. The owner was not asked.

## The hand

Hand 59993188, PLO5 1/2 fast-table cash, 2026-11-18 17:11Z. A Horse re-raised aces before the flop, called a 4-bet, called 75% of the pot on the flop and 74% on the turn, made the ace-high flush on a river that paired the board, and folded to an all-in of 54% of the pot at a price of 26.0% after putting in 610. The facing-bet EV ranks the bettor's value bets over all five-card holdings: 23.6% of random holdings make a full house on that board, so its 19.2% value region held nothing the nut flush beats. With this option the hand is a call: the model puts a full house or better at 54% of his bets (46% win for the Horse), against 26.0% needed.

## The measurement (read-only, 2026-10-19 to 2026-11-18)

Archive `woowoo-48h-audit-01BNteGYgf/repairs/PAIRED-RIVER/MEASUREMENT.md`. PLO4/PLO5 cash hands with a person seated, one board, no bomb pot, paired river, a Horse facing a person's river bet or raise: 832 decisions. A Horse held a straight or better in 262: it folded 83 (32%); the bettor held a full house or better in 157 (60%), a better straight or flush in 17, a worse straight or flush in 24, trips or two pair in 56, less in 8. Where only a full house or quads beat the Horse (175): 31 folds (18%), the Horse was ahead 48%. By size, the bettor's full houses: under 40% of the pot 18 of 49, 40 to 70% 30 of 65, 70 to 110% 76 of 109, raises 33 of 39. One person supplies 124 of the 262 (47%); with that person the bettor held a full house 71%, with the others 50%.

## The fit

614 heads-up first river bets by 29 people with known cards (table-revealed 186, operator record 428; offline evidence only, no card of a person is in the repository). Maximum likelihood of the bettor's class given the counted range of each spot, eleven numbers: for each of the three classes below a full house, log k = a + b x share of the pot (prior on b: normal, sd 1); the four street weights (prior on the logit: normal, sd 2); the re-raised-pot power (prior on the log: normal, sd 1). Result (`OMAHA_PAIRED_RIVER_FIT`): flush or straight 0.516 - 1.715 x, trips or two pair -0.317 - 1.729 x, less -1.16 - 0.128 x; outside weight on a street he bet 0.437 (flop) and 0.476 (turn), on a street he called 0.652 and 0.74; power 0.397. So against a full house a person bets a flush or straight on a paired river about 0.71 times as often at half the pot and 0.30 times as often at the pot.

Cross-fitted by time (each half priced by the other half's fit) the predicted shares match the recorded ones overall (full house 0.50 predicted, 0.49 recorded; flush or straight 0.17, 0.17) and by size (0.34 / 0.44 / 0.57 predicted against 0.25 / 0.41 / 0.60); log loss per bet 1.050 against 1.134 for a size-only table. Weak points: the fit is unstable between halves for the flop caller weight (0.10 and 0.82), 3-bet and 4-bet pots are few (69 and 8 bets; predicted full-house share 0.48 and 0.51 against 0.41 and 0.38 recorded), and one person is 43% of the rows.

A measured point against an existing rule, for the record: the lead into the turn aggressor (38 leads of 40% of the pot or more) showed a full house or better 47% of the time, against 54% for the other 466 bets of that size. The data do not show that lead as more polarized. This option still leaves that spot to the reviewed verdict.

## Evaluation (run 2026-11-18, declared before the run)

Declaration `repairs/PAIRED-RIVER/EVAL-DECLARATION.md` (sha256 8c66f7e1934ebc564dd9719fabdf6df13cb1298930bc5f68e88cdaa0aecbf5e2); results `EVAL-RESULTS.md`. Recorded decisions of the same 30 days priced with cross-fitted numbers, valued against the bettor's actual cards. This is not an engine replay.

- In scope: 28 decisions (12 recorded folds, 14 calls, 2 raises). Less than a straight in scope: 0. Multiway or raise in scope: 0.
- Added calls (recorded fold, option calls): 8. Won 37.5% at a mean price of 28.6% (+8.9 points; bar +2: met). Mean value +147 bb, 95% interval -83 to +417 (bar: interval above 0: NOT met). Four people; one supplies 5 of the 8.
- Removed calls: 1, and it was a winner (+34 bb; bar: none, or losing on average: NOT met).
- Folds kept: 4 (one win in four at a mean price of 33%). Calls kept: 13.
- Named hands: 59993188 call (46% against 26.0%); 59521326 call; 59730132 out of scope, unchanged.
- Sufficiency: at least 10 added calls were required; there were 8.

Verdict of this run under the declared rule: INSUFFICIENT, and the removed-call bar failed on its one decision.

Journal engine replay (Amendments 1 and 2 of the declaration, declared before it ran): `HorseLogic.decide` on the journaled request of every paired-river decision facing a wager in the exports of 2026-11-16 16:28Z to 2026-11-18 19:30Z (241 decisions), the option off against on. It is not the worker-runtime replay (opponent reads and request flags are not restored); the off arm reproduced the journaled action in 231 of 241.

- Changed decisions: 8, all fold to call, all nut-class straights or flushes in the spot. Changed with less than a straight: 0 (163 such decisions replayed). Changed outside the spot: 0.
- The replay showed that the option as first built also priced bets made by Horses (4 of the 8). The fit is on people only, so the option was narrowed to a person's bet before delivery.
- Added calls against a person: 4 (10 required). Won 1 of 4 at a mean price of 29.0%; mean +194 bb, 95% interval -47 to +664.
- Hand 59993188: journaled fold (the policy graph records the wager rules turning the reference call into a fold); off fold; on call.

Overall verdict: INSUFFICIENT. The option stays OFF.

## What must pass before it is switched on

1. At least 10 added calls against people with the interval above zero, on hands the fit has not seen (the fit covers 2026-10-19 to 2026-11-18 17:25Z). At the observed rate of 8 in 30 days that is five to six weeks of journal exports.
2. A worker-runtime replay (reads and request flags restored) of those hands, off against on, with the same bars.
3. League cards `plo4_omaha_paired_board_river_is_priced` and `plo5_omaha_paired_board_river_is_priced` (HorseLeague.ts; both arms carry the live set of 2026-11-18, arm A adds the option): no card below -2 SE. No league has run on them.

## Receipts

No new receipt name. The facing-bet receipts (`omaha_facing_bet_ev_call`, `_fold`, `_changed`) record the decision; the verdict carries `pairedRiverPriced` (the full-house share of his bets as priced, the preflop width, the holdings drawn) when it was priced here.

## Tests

`server/src/engine/HorseOmahaPairedRiverPriced.test.ts` (16 tests): hand 59993188 folds before and calls after; the same hand against a Horse's bet is untouched; the same hand at a price his range does not pay folds; a king-high flush in the same spot is untouched; hand 59521326 stays a call; hand 59730132 stays a fold; every recorded facing-bet decision outside the spot is byte-identical with the option on; unset and false are byte-identical; without `omahaFacingBetEv` the option does nothing.

## Evidence rows

- Mechanism, scope, tests: MET.
- Option unset or false: the decision is identical byte for byte (test above).
- Value: NOT MET (evaluation INSUFFICIENT, one bar failed). The option stays off.
