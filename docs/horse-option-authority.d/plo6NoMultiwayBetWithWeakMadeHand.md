# plo6NoMultiwayBetWithWeakMadeHand: authority for the live switch

Status: built, OFF, unevaluated; switching ON needs recorded authority. Evidence NOT MET (development evidence only); no owner order to switch this option on is recorded in this file.

## What it does

A PLO6 multiway bet with a weak made hand and no qualifying draw becomes a check. The spot (`plo6MultiwayWeakBetSpot` in `server/src/engine/HorsePlo6MultiwayWeakBet.ts`): six-card Omaha high, pot limit, one board, not a bomb pot, not all-in-or-fold; cash and tournaments; flop or turn; nothing to call and a check legal; two or more live opponents (not folded, not sitting out; an all-in opponent counts). The Horse's best hand is a weak made hand: one pair below the top card of the board (a pocket pair under it, or a pair with a lower board card), bottom two pair, or the board's own pair with such a pair. It holds no qualifying draw: no nut flush draw, fewer than eight straight outs and fewer than four outs to the nut straight. It is not nut class. Then a bet (or a raise or all-in that opens the betting) becomes a check.

It never turns a check into anything and never touches a decision facing a bet, a heads-up pot, the river, PLO4 or PLO5, top pair, an overpair, top two pair, a set or better, a hand with the qualifying draw or a nut-class hand. It reads the Horse's cards, the board and the public seats; no opponent read; no random number.

Where it runs: first in `omahaOwnBetRules` (`HorseLogic.ts`, both decision paths), with the owner-ruled own-bet checks, so the pricing rules never see the bet; `omahaOwnerRuledFinal` keeps the check when a later rule proposes a bet in the spot (receipt `omaha_owner_ruled_check_kept`). The decision receiver admits the bet-to-check transition only in PLO6 and, when the request is known, only where the spot re-run on it holds (`responseValidation.ts`).

Default OFF in source (read `=== true`). Registered in the option switch (follow-up migration `20261115221700_horse_option_switch_plo6_multiway_weak_bet`), switchable live, not off-only. On live only by an option-switch row whose note cites this file and its sha256 (`authority: plo6NoMultiwayBetWithWeakMadeHand docs/horse-option-authority.d/plo6NoMultiwayBetWithWeakMadeHand.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (cited by file, not quoted)

- Owner order to the PLO6 lane, 2026-11-15 13:37 and 15:42 America/Chicago (bring the PLO Strategy work to PLO6; build what is unfinished): recorded in the PLO6 archive checkpoint, `agent-evidence/extreme-archive/plo6-audit-01TLQer9Hdf/CHECKPOINT.md`, entries 2026-11-15T19:59:19Z and 2026-11-15T21:53:52Z. The checkpoint records the orders in the lane's words; the owner's own text is not copied here.
- The owner's principles of 2026-11-15 for the Omaha strategy work (the verbatim texts): `agent-evidence/extreme-archive/plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md`.

Neither file is an order to switch this option on. That order, when given, is recorded here with its time before any `on` row cites this file.

## Recorded hands it answers

The PLO6 human-table sweep, family D2 (`agent-evidence/extreme-archive/plo6-audit-01TLQer9Hdf/phase1-play/plo-port-20261115/SWEEP-PLO6.md`, section 2 row 1; 45 bets in 43 hands, hand net -1,005.5 bb):

58871344, 58718499, 58462589, 58723936, 58469752, 59285463, 58698748, 58409374, 58722129, 59544392, 58928618, 58906290, 58406317, 58740649, 58731525, 58753437, 58738906, 58718726, 58466272, 58721646, 58904916, 58734090, 58730197, 58718987, 58752745, 58740938, 58733475, 58729480, 58723402, 58728500, 58717395, 58461204, 58692649, 58719791, 58893007, 58897376, 58722787, 58895243, 58720340, 58734903, 58725374, 58463364, 58716315

## Receipts

plo6_multiway_weak_made_hand_bet_checked (one receipt: the rule reads no opponent, so it has no withheld state). A default-off option production does not set is silent.

## Tests

`HorsePlo6MultiwayWeakBet.test.ts` (the rule's own cases), `HorsePlo6MultiwayWeakBetWiring.test.ts` (through `HorseLogic.decide`: unset equals false at every seed with no receipt; on, every bet in the spot becomes a check and the receipt fires once per bet; no change heads-up, in PLO5, facing a bet, with the nut flush draw, with a nut-class hand; a later rule's bet does not stand), `responseValidation.test.ts` (the admitted and refused transitions).

## Measured (development evidence, unevaluated)

Population: every Horse decision with a person live in PLO6 cash, 2026-11-10T21:30Z to 2026-11-15T20:05Z: 912 hands, 7 persons, one person in 667 of the hands. "Net" is the Horse's whole-hand result, a hand counted once per row. Source: `agent-evidence/extreme-archive/plo6-audit-01TLQer9Hdf/phase1-play/plo-port-20261115/MULTIWAY-WEAK-BET-WIRING.md`, section 9.

| set                                                       | bets | hands | net bb   | lost (hands, bb) | won (hands, bb) | lost to won |
| --------------------------------------------------------- | ---- | ----- | -------- | ---------------- | --------------- | ----------- |
| every multiway flop or turn bet                           | 454  | 402   | +3,827.4 | 173, -11,491.2   | 229, +15,318.6  | 0.75        |
| sweep family D2                                           | 45   | 43    | -1,005.5 | 29, -1,470.8     | 14, +465.4      | 3.16        |
| the option removes                                        | 62   | 58    | -1,403.7 | 41, -1,825.9     | 17, +422.2      | 4.33        |
| of them, in D2                                            | 42   | 40    | -1,103.6 | 28, -1,455.8     | 12, +352.2      | 4.13        |
| of them, not in D2 (the cost side of the wider class)     | 20   | 18    | -300.1   | 13, -370.1       | 5, +70.0        | 5.29        |
| D2 bets the option keeps (four or more nut-straight outs) | 3    | 3     | +98.2    | 1, -15.0         | 2, +113.2       | 0.13        |
| the same weak hands, kept by the draw                     | 40   | 38    | -97.0    | 20, -922.9       | 18, +825.9      | 1.12        |
| every other multiway flop or turn bet (untouched)         | 392  | 349   | +4,866.5 | 137, -10,029.9   | 212, +14,896.4  | 0.67        |

The Horses already check this spot 312 times in the window against the 62 bets. Of the 62 removed bets, 57 had exactly one person live.

## Evidence rows

- Mechanism, scope, visibility (flag and receipt in `HorseDataLedger.ts`), tests: MET.
- Option unset or false: the decision is identical to the base at every seed of the wiring test's spots, and no receipt fires. The lane's decision-digest pin on PLO6 cells is not recorded here.
- Value: NOT MET. Development evidence only (the table above): 62 bets, -1,403.7 bb net removed against +422.2 bb of winning hands removed, lost to won 4.33. No paired evaluation has been run.
- Continuation: NOT MET. What the checked hand does on the next street, and what a check wins where the bet took the pot (9 of the 62 bets), is not measured.
- Reach: NOT MET. 62 bets in 912 hands, 7 persons, one person in 667 of the hands; not counted in production; league card `plo6_no_multiway_bet_with_weak_made_hand` (six seats, production personas) has not been run as an evaluation; a 600-pair reach check (seed 20261115) diverged in 14 pairs, so the league reaches the spot.

## Limits

- Five days, 912 cash hands, 7 persons, one person in 667 hands: mostly one opponent.
- Whole-hand results, not the value of the bet; all-in luck not removed; rake as recorded; no solver grade; no counterfactual.
- The conditions were chosen on the same hands they are measured on. Cells under about 10 bets are not stable; the draw thresholds (eight straight outs, four nut-straight outs) rest on cells of 4 to 19 bets.
- No opponent read: the rule cannot tell a player who calls everything from one who folds.
- Tournaments are admitted on the argument that a check adds no chips, not on evidence (2 such bets in the window, +23.4 bb).
- The nut flush draw keeps the bet although the 11 such bets in the window lost (-274.7 bb): owed to the evaluation.
- Outside the option and not built: the same hands bet heads-up (22 bets, -452.5 bb) and on the river (3 bets, -80.1 bb).
