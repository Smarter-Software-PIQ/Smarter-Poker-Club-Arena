# Omaha re-raised pots: no dominated continue against a 4-bet, no one-pair stack-off after it

Date: 2026-11-15. Lane: PLO Strategy. Owner ruling 2026-11-14 23:49 America/Chicago on PLO hand 59455160. Option `omahaReraisedPotDiscipline`, on by default by the owner's order of 2026-11-15 00:55 (last section).

## What happened

In the reported hand a Horse continued before the flop through a 4-bet and a 5-bet with an ace-high broadway hand that had no pair of aces and no strong suited connected structure, then called all in on the turn with two pair that was not top two, because the remaining price looked cheap. The owner's ruling, in substance: after 4-bets and 5-bets such hands lose much of their value, and the Horse must not then call off its stack with top-and-bottom pair or one pair on the cheap price.

## Root cause

The preflop continue against a re-raise is a strength threshold that does not depend on how many raises came before it. After the flop, the committed-stack branch of `HorseLogic.ts` prices a stack-off with the generic equity estimate against pot odds, which are cheap once most chips are in; nothing asks what a 4-bet or 5-bet range holds.

## What changed

New `server/src/engine/HorseOmahaReraisedPot.ts`, the outermost call-discipline fold on both decision paths (after `omahaBigBetCallFold`). PLO4 and PLO5 cash, one board, high only; not bomb pots, all-in-or-fold tables or tournaments. In a pot raised three or more times before the flop (open, 3-bet, 4-bet), facing a wager:

1. Preflop: a continue (call, raise or all-in) with no pair of aces and no premium structure (kings double-suited, or a double-suited rundown of four ranks within a span of four, lowest seven or higher) folds. When the call already commits the stack (all in, or less than the resulting pot left behind) it is kept only if the hand's equity against a random hand holding a pair of aces pays the price of the call.
2. Flop, turn, river: one pair or two pair below top two does not commit its stack (a call that leaves less than the resulting pot behind, or any raise over the wager) unless its equity against a random hand that holds a pair of aces or already makes top two pair or better pays the price.

Equities are seeded Monte Carlo estimates that never draw from the brain's random stream. With the option unset or false the brain plays exactly as before (pinned in the tests, and checked against the base commit's decision digest on 2,400 hand pairs).

Receipts (registered in `HorseDataLedger.ts`): `omaha_reraised_pot_preflop_fold`, `omaha_reraised_pot_postflop_fold`, `omaha_reraised_pot_priced_in`. League cards: `plo4_omaha_reraised_pot_discipline`, `plo5_omaha_reraised_pot_discipline`. Evidence file: `docs/horse-default-on.d/omahaReraisedPotDiscipline.md`.

## Tests

`server/src/engine/HorseOmahaReraisedPot.test.ts`: the measures and both cells; a turn node of a 4-bet pot (anonymised fixture) where today's call with two pair below top two or top pair becomes a fold with its receipt, while top two pair, a made straight and the same hand in a pot raised only twice are unchanged; unset and false play identical poker in the league; on, the rule fires with receipts and no illegal action.

## Evaluation

Declared before any graded run (Horse mirror, development human field, one loose-aggressive value seat, one light 4-bettor seat; PLO4 and PLO5; 200 sessions of 300 hand pairs per cell). Pass rule: pooled human-field gain more than 2 SE above zero, no cell more than 2 SE below zero, no illegal action or fallback. Verdict: not yet run at the time of this commit; the option stays off until it passes.

## Owner's order, 2026-11-15 00:55 America/Chicago

Ordered into the 4 AM release switched on. `omahaReraisedPotDiscipline` is read `!== false`; its league card is removed with the default. Its evidence file marks Value, Continuation and Reach NOT MET with the owner's authority. The declared paired evaluation runs after this head's gate (option on against explicit false); a failing result switches it off again. Where this section and an earlier one disagree about on and off, this section is the head's state.

## Split at the release head

Only the preflop cell ships on. The postflop cell is the separate opt-in `omahaReraisedPotStackOffFold` (default OFF, league cards plo4/plo5 `_omaha_reraised_pot_stack_off_fold`): the development probe found the calls it folds positive against Horse holdings, so it waits for its evaluation. Figures in the evidence file.
