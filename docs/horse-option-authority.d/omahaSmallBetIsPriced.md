# omahaSmallBetIsPriced: authority for the live switch

Built 2026-11-18 by the PLO Strategy lane (block-bet design, plo-handoff-review-01a1cbbd/blockbet-013U37/BLOCK-BET-SPEC-20261118.md). Evidence NOT MET: no declared evaluation has run yet (bar written first: blockbet-013U37/PASS-BAR.md). This file does not authorize switching the option on.

## What it does

PLO4/PLO5 cash, one board, high only, heads-up, on the turn or the river with nothing to call (the card-impact scope): the owner's check or bet is priced on the card-impact model (`server/src/engine/HorseOmahaCardImpact.ts`, the one owner of the bet-response model) beside bets of 10%, 20% and 25% of the pot (`OMAHA_SMALL_BET_SIZES`, a candidate set, not a threshold). The best small bet replaces the owner's choice only when its expected value is higher by 2% of the pot (`OMAHA_PRICED_SAMPLED_MARGIN`).

- Hand and range: the card-impact sample (the Horse's exact cards, the opponent's range weighted by his line, card removal).
- Response: at every size, his continue share is the model's own level at the reference bet (60% of the pot: the pot odds scaled by his measured continue rate, `omahaCardImpactKeep`) moved on the log-odds scale by what the measured response of his kind (a person or a Horse) moves between that size and the reference; of the continuing hands, the measured share of his kind at that size raises (`server/src/engine/HorseOmahaSmallBetConstants.ts`, generated from blockbet-013U37/measure/smallbets.json, 5,379 PLO4/PLO5 cash hands with a person seated, Nov 13-17; each cell shrunk toward the two-variant pool with 6 pseudo-counts; the curve starts at a share of 0 where nothing folds). A person's response is never used for a Horse opponent, nor the reverse.
- Never: a bet into a check, a nut-class bet made smaller, an all-in changed, an owner-ruled check (out-of-position and paired-board checks) turned into a bet. The limped-pot minimum bet still acts after it.
- Not priced (owner's decision kept, receipt `omaha_small_bet_unpriced_kept`): the flop (no card-impact model), multiway, no legal small size.

Receipts: `omaha_small_bet_priced_bet`, `omaha_small_bet_resized`, `omaha_small_bet_kept`, `omaha_small_bet_unpriced_kept`, `omaha_small_bet_owner_check_kept`.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- Earlier: "THE SIZE OF THE BET SHOULD NOT MAKE OR BREAK THE DECISION".

## Known limits

The measured response is unconditional on the board and the hand; only its shape by size is used, its level is the model's. River raise shares at small sizes rest on small cells (n 20-34 per variant). The joint-policy filter of bets under 25% of the pot (HorseTournamentUtility.ts) and the defence side (small-bet range rows by bettor kind) are NOT in this option (spec parts 2.4 and B).

## Tests

`server/src/engine/HorseOmahaSmallBet.test.ts`: off byte-identical (unset, false, truthy non-boolean; same randoms, no receipts), the card-impact model unchanged without a curve, the curve's level, shape, kind split and continuity, the verdict's never-rules and margin, and decide-level reach with receipts that pass the worker validator.

## Evaluation

Not run. Bar: blockbet-013U37/PASS-BAR.md (replay on audited decisions, then one paired league evaluation).

## Evidence rows

None. Switch-on needs a WIN under the bar, a reviewed head and an evidence row.
