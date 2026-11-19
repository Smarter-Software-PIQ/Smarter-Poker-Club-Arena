# omahaFacingBetValueIsRangeRelative: authority for the live switch

Built 2026-11-18 by lane VALUE-REGION (hand audit of hand 59993188, the general cause). Evidence NOT MET: the declared evaluation of 2026-11-19 FAILED (below). This file does not authorize switching the option on; it records what the option is and what must pass first.

## What it does

Inside `omahaFacingBetEv` only (PLO4/PLO5 cash, one board, high only), on the river, heads-up, facing the first bet of the street (not a raise) made by a person: the bettor's bets are no longer "the strongest share of all five-card holdings" (`OMAHA_EV_VALUE_SHARE` times the line factors, with a separate bluff prior). They are his measured betting range on this board (`server/src/engine/HorseOmahaFacingBetValueRange.ts`):

- Range: his holdings drawn from the unseen cards (the Horse's cards, the board and dead cards removed, so the Horse's blockers are exact), deterministically from the cards. A bettor who re-raised before the flop holds the top share by the engine's preflop percentile, at the width the engine's preflop re-raise defence uses for a person (3-bet 0.40 PLO4 / 0.50 PLO5, 4-bet 0.28 / 0.38). An open or a call does not narrow him.
- Strength: each holding's percentile r in that range on the final board.
- Bets: the density of r among recorded river bets by people (fit below), by the number of earlier postflop streets he bet or raised (0, 1, 2) and by the bet's share of the pot, read linearly between the size centres 0.25 / 0.55 / 0.9 / 1.5 (no step). His bluffs are the density's mass at low r: no value percentile, no separate bluff prior.
- Verdict: EV(call) = P(win) x the pot after rake + P(tie) x the split - P(lose) x the call, at the actual price, against the facing-bet rule's one margin. It replaces the facing-bet verdict in that spot in both directions.
- Not covered: turn, multiway pots, raises, a Horse's bet or a bettor of unknown kind, six cards, tournaments, bomb pots.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaFacingBetValueIsRangeRelative docs/horse-option-authority.d/omahaFacingBetValueIsRangeRelative.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-17: "EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS".
- 2026-11-18 11:13 America/Chicago, on hand 59993188: "HORSE PUT IN OVER 500 CHIPS AND FOLDED ... CALLING ON TURN AND FOLDING RIVER ...".

## The fit

1,201 recorded first river bets by 37 people, heads-up into a Horse, cards known from the hand facts (operator record; offline evidence only, no person's card is in the repository), PLO4/PLO5 cash, 2026-10-19 to 2026-11-18. For each bet: the bettor's r in his range drawn as above (the Horse's cards removed). Histogram of r in 10 bins per (earlier aggressor streets, size centre), a bet's weight split between the two size centres around it; shrinkage: the pooled histogram (Laplace), the per-line histogram shrunk to it with 20 pseudo-bets, each cell shrunk to its line with 20 pseudo-bets. Density = bin share x 10. Cells: 531 / 455 / 215 bets with 0 / 1 / 2 earlier aggressor streets. One person supplies 467 of the 1,201 bets. People bet the top decile of their range 2 to 5 times as often as the middle; the bottom deciles (bluffs) carry 0.1 to 0.6.

## Evaluation (declared before the run; repairs/VALUE-REGION/EVAL-DECLARATION.md sha256 e4d374b9ab69cd6f6c32befe7b22cbb9c9bedd6013f6957d61d4ea2c4cc10439; results EVAL-RESULTS.md)

Recorded decisions of the same 30 days priced with cross-fitted densities (each half by the other half's fit), valued against the bettor's actual cards; and a journal replay through `HorseLogic.decide` (journal export 3, 147 turn/river decisions facing a wager, out-of-sample fit).

- Added calls: 110, won 39.5% at a mean price of 26.3% (+13.2 points), mean +47.0 bb, interval +11.7 to +85.1 (met).
- Removed calls: 69, they won on average (+8.0 bb, interval -10.2 to +27.7) (FAILED: the option folds calls that won).
- Net per changed decision: +25.8 bb, interval +3.5 to +51.3 (met).
- Named hands: 59993188 call (pWin 0.282 at a price of 0.260); the reviewed lead into the turn aggressor (59730132) flips to call (FAILED).
- Success catalogue: 0 of 30 correct river folds flipped; 1 of 11 correct river calls flipped to fold (bar 5%: FAILED).
- Journal: 5 changed, 0 outside the spot; 59993188 journaled fold, off fold, on call; 5 added calls against people (10 required: INSUFFICIENT).

Overall verdict: FAIL. The option stays OFF.

## What must pass before it is switched on

1. The removed calls must not be winners: the density's top bins over-weight his strongest holdings for players whose bets are wider; a per-bettor read of the density (when the mind has one) or a cross-checked removed-call bar on fresh hands.
2. Hand 59730132's reviewed verdict must hold, or the reviewer must accept the measurement (PAIRED-RIVER) that such leads are not more polarized.
3. At least 10 added calls against people in journal exports the fit has not seen, interval above zero; a worker-runtime replay with the same bars.
4. League cards `plo4_omaha_facing_bet_value_is_range_relative` and `plo5_omaha_facing_bet_value_is_range_relative`: no card below -2 SE. No league has run on them.

## Receipts

No new receipt name. The facing-bet receipts (`omaha_facing_bet_ev_call`, `_fold`, `_changed`) record the decision; the verdict carries `valueRange` (pWin, pTie, price, the Horse's own percentile, the preflop width, the holdings drawn) when it was priced here.

## Tests

`server/src/engine/HorseOmahaFacingBetValueRange.test.ts` (13 tests, synthetic cards of the shape of hand 59993188): folds before and calls after; the verdict is EV at the actual price against the measured range with the rule's margin; a genuinely beaten hand in the same spot still folds; the same hand at a price its range does not pay folds; unset and false are byte-identical, and without `omahaFacingBetEv` the option does nothing; a Horse's bet keeps the facing-bet verdict; the density's shape, continuity in size, blockers, mid-rank percentile, preflop depth and the evaluation seam.

## Evidence rows

- Mechanism, scope, tests: MET.
- Option unset or false: the decision is identical byte for byte (test above).
- Value: NOT MET (evaluation FAILED). The option stays off.
