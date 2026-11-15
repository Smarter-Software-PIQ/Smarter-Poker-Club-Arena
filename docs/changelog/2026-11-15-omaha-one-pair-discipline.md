# 2026-11-15 Omaha one-pair discipline (option `omahaOnePairDiscipline`, on by default by owner order)

Owner complaints of 2026-11-14 from PLO5 cash: one-pair river value bets (hands 59407629, 59430325), a river check-call of a pot-sized bet after the flush and the straight completed (59431232: "STOP [...] CALLING RIVER BETS WHEN WE CAN'T [...] BEAT ANYTHING"), and one-pair stack-offs (59426444, 59417700).

New `server/src/engine/HorseOmahaOnePair.ts`, applied to the final answer of the `wager_rules` node. PLO4/PLO5 high, one board, no Hi-Lo, fixed limit, all-in-or-fold or bomb pot. It only reduces chips put in:

1. River: one pair or less never bets or raises for value (bet -> check, raise -> call); a river bluff the reference brain declared, and the river bluff check-raise, keep their wager.
2. River: a call of a 0.66-pot+ wager with two pair or less on a straight- or flush-possible board folds, unless the bettor is a measured postflop over-bluffer.
3. Flop and turn: one pair with fewer than four nut-class outs does not raise (call, or fold when the call costs more than half the effective stack) and does not call a wager costing more than half the effective stack (unless priced under 0.25).

The worker's receipt validator admits the bet -> check and raise -> call transitions where the rule, re-run on the request, produces them; folds use the existing PLO fold admission. Receipts: `omaha_one_pair_river_value_bet_checked`, `omaha_one_pair_river_value_raise_flatted`, `omaha_one_pair_river_beaten_call_folded`, `omaha_one_pair_raise_flatted`, `omaha_one_pair_raise_folded`, `omaha_one_pair_stack_off_folded`. League cards `plo4_omaha_one_pair_discipline`, `plo5_omaha_one_pair_discipline`. Evidence file `docs/horse-default-on.d/omahaOnePairDiscipline.md`.

With the option off, decisions are unchanged (a 112-decision sample is pinned against the base commit's digest in `HorseOmahaOnePair.test.ts`).

## Owner's order, 2026-11-15 00:37 to 00:56 America/Chicago

Ordered into the 4 AM release switched on. Read `!== false`; the league card is removed with the default. The evidence file marks Value, Continuation and Reach NOT MET with the owner's authority. The declared paired evaluation runs after the gate (on against explicit false); a failing result switches it off again. Where this section and an earlier one disagree about on and off, this section is the head's state.
