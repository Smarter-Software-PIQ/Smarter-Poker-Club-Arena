# Omaha river: only the nuts raise a bet; a set pounds the turn

Date: 2026-11-14. Lane: PLO Strategy. Owner-reported hand 59401453 (PLO5 1/2 cash).

## What happened

A Horse with top set bet 24 into 52 on the flop, 42 into 100 on a turn card that made a straight possible with a flush draw live, and on a river with no pair, no possible flush and three possible straights faced a full-pot lead of 184 and moved all in for 314.35. It was called by the nut straight.

The owner's ruling: facing a river bet a Horse without the nuts never raises, whatever it reads the bettor to be; it calls at most and leans toward folding. A strong, vulnerable made hand on the turn bets big.

## Root cause

- River: the low-SPR commitment branch of the facing-a-bet path (`HorseLogic.ts`, `if (committed)`) jams any hand whose equity estimate clears 0.42 unless a flat rule names it. The Omaha flat rule there (`preferFlat15`) reads `omahaNutStatus`, which is only computed for straights and flushes. A set is neither, so it was re-shoved at 0.57 to 0.62 estimated equity. The opt-in `v55OmahaRiverTripsFlat` names this class and is off.
- Turn: `omahaMadeClass` marks a set weak wherever a straight or flush is possible, and V40 caps a weak class at half the pot from the turn on.

## What changed

- New `server/src/engine/HorseOmahaRiverNutRaise.ts`, run in the `wager_rules` node (option `omahaRiverNutRaiseOnly`, on by default): in PLO4, PLO5 and PLO6 high on one board, a river raise or an all-in for more than the call, facing a wager, stands only with the exact nuts or an effective-nut hand; every other raise becomes a call. Receipts `omaha_river_non_nut_raise_flatted`, `omaha_river_non_nut_raise_fold_restored`.
- V81 gains the river cell `trips_set_drawy` (PLO4 and PLO5, a set or trips on a straight- or flush-possible river, facing 0.9 pot or more with chips behind the call), under the same option. Receipt `v81_river_set_big_bet_fold`.
- An Omaha high set on a straight-possible turn with no possible flush bets the monster tier's geometric size instead of the V40 half pot (option `omahaTurnSetPound`, on by default). Receipt `omaha_turn_set_pound`.
- The worker's receipt validator admits the new raise-to-call transition for the three games only with the request, on which it re-runs the rule.

## At the hand's nodes (live cash profile, 60 seeds)

| Node                       | Before                                                                        | After                                                                                |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| River, facing 184 into 184 | all in 60 of 60                                                               | fold 60 of 60 (call 40 of 40 when the bettor is measured as a postflop over-bluffer) |
| Turn, checked to, pot 100  | bet 39 to 46 (median 42) on 60 of 60; with the opponent memory off, 28 checks | bet 81 to 87 (median 84) on 60 of 60                                                 |

## Tests

`HorseOmahaRiverNutRaise.test.ts` (29 cases), the complaint law `horseComplaints/plo5-top-set-jams-over-a-pot-river-lead.law.test.ts` (exact replay, every profile, with a control that brings the all-in back when the option is off). Tests that pinned a non-nut river raise were updated where the ruling contradicts them and now hold the option off to keep measuring their own rule: `HorseOmahaRiverTripsFlat`, `HorseOmahaBoats`, `HorsePlo6RiverNuts`, `HorseV15RiverRaiseGate`, `HorsePloEliteOverhaul` (V86 small-pot near-nut raise), `HorseNearNutRiverValue`, `HorseOmahaPressureSampling`, `plo4/Plo4Phase10Selection`. The two historical corpora (`HorseOpponentExploitNeutrality`, `HorseOmahaTournamentPressure`) keep their recorded bytes with both options off.

## Evidence and limits

`docs/horse-default-on.d/omahaRiverNutRaiseOnly.md` and `docs/horse-default-on.d/omahaTurnSetPound.md` answer the eight evidence rows, including where the value sign differs by range and what was not measured.
