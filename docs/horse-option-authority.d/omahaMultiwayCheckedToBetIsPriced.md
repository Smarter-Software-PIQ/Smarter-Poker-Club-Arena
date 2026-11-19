# omahaMultiwayCheckedToBetIsPriced: authority for the live switch

Built 2026-11-19 by lane MULTIWAY-BET (WooWoo audit, session 013U37bY). Default OFF. Evidence NOT MET: the declared evaluation (archive repairs/MULTIWAY-BET/EVAL-DECLARATION.md, sha256 7ba0bba9...) FAILED three of nine bars (scope B7, river judge calibration B8, latency B9); no option-switch row may name it until a passing evaluation is recorded here.

## What it does

PLO4/PLO5 cash (table and fast-table speeds alike), one board, high only, pot limit, no bomb pot, a pot not re-raised before the flop, on the flop or the turn (not the river: its measured response did not hold out of sample), nothing to call, two or more live opponents: the owner's check is priced against bets of the card-impact candidate sizes (`OMAHA_CARD_IMPACT_SIZES`). Owner of the decision cell: `server/src/engine/HorseOmahaMultiwayDiscipline.ts` section 4 (the module that already owns the multiway bet-against-check price, `omahaBetVsCheckEv`); heads-up spots stay with `omahaSmallBetIsPriced`, so no spot has two owners. Inputs: the Horse's showdown share against each opponent's range (exact counts on the turn, the flop counts at 6 rivers per turn card), each opponent kind's measured multiway response as a function of his own hand strength and the bet's share of the pot, and the measured cost of the check (players still to act bet at their kind's measured rate). The bet replaces the check only when worth more by 2% of the pot. Runs first inside omahaOwnerRuledFinal, after every rule that can bet a check, so it changes only the chain's final check. Never turns a bet into a check, never overrides an owner-ruled check (`omahaWagerIsChecked`), never bets all in. Tournaments and PLO6 unchanged.

Receipts: `omaha_multiway_checked_to_bet_priced_bet`, `omaha_multiway_checked_to_bet_priced_bet_vetoed`, `omaha_multiway_checked_to_bet_kept`, `omaha_multiway_checked_to_bet_owner_check_kept`.

## The owner's orders it rests on (verbatim)

- "EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS"

## Evaluation (2026-11-19, held-out 2026-11-16..19 05:00Z, judged against the opponents' actual hands)

FAIL. Added bets +4.30 bb per change [4.00, 4.61] (n 2,821), adverse variant +3.27 [2.95, 3.60], every street positive; removed bets 0; off byte-identical on 3,180 replayed records; replay fidelity 0.9978. Failed: one replayed change resized a later rule's bet (scope), the judge under-predicts river folds by 0.12 (calibration), verdict p99 82.2 ms against 80 ms. The winner-always-calls variant is -1.10 [-1.44, -0.76] (reported). League cards plo4/plo5_omaha_multiway_checked_to_bet_is_priced: not run.

## Second build (2026-11-19 ~05:55Z, after the failed evaluation)

- B7: the rule moved from omahaOwnBetRules to the first line of omahaOwnerRuledFinal (it saw a check there that a later rule bet, and re-sized that bet).
- B8: river out of scope (fit window: model river all-fold 0.309 vs 0.582 observed; thin river response samples).
- B9: flop sample at 6 rivers per turn card (omahaFlopEvCounts riversPerTurn; every other caller unchanged): fit-window bet/check agreement with the 12-river sample 0.9831, verdict CPU p99 flop 16.5 ms, turn 10.5 ms.
- Winner-always-calls stress, fit window: flop -1.47 bb per change, turn +2.51.
- Next evaluation: EVAL-DECLARATION-2.md (held-out hands from 2026-11-19 05:00Z, journal-5).

## Tests

`server/src/engine/HorseOmahaMultiwayCheckedToBet.test.ts` (synthetic cards).
