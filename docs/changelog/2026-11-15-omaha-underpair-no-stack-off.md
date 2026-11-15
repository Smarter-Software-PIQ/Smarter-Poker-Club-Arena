# Omaha: a Horse put its stack in with an underpair structure (hand 59518335); two options, off by default

Date: 2026-11-15. Lane: PLO Strategy. Owner complaint about production hand 59518335 (PLO5 1/2 cash, big blind ante). Two new options, both off by default (read `=== true`): `omahaNoCallColdFourBetWithoutPremium` and `omahaUnderpairNoMultiwayFlopContinue`.

## What happened

A player opened to 9 under the gun and two Horses called. A Horse on the button with a pair of queens and three low cards (400 deep) re-raised to 50; a Horse in the big blind re-raised cold to 180 with suited aces; the opener called; the button called 130 more. On K-T-6 the big blind bet 139 into 561, the opener called, and the button called 139 with the underpair and a gutshot. On the 7 the big blind checked, the opener bet the pot with a straight, the button put its last 81 in, and the big blind folded aces with top and bottom pair.

## Root cause

Each decision was replayed through `HorseLogic.decide` from the public snapshot the engine stored with it (fixture `server/src/engine/HorseOmahaUnderpair.fixture.json`, anonymised to seats) and traced to its branch:

1. The re-raise to 50: `HorsePreflop.ts`, the 3-bet value branch (`strength_value`): strength 0.63 against a 3-bet bar of 0.36 to 0.54. That bar is the style bar multiplied by the table's VPIP floor (`vpipFloorMul` in `HorseLogic.ts`); the same hand on a table without a floor has a bar of 0.97 and folds to the open. This is the first cause of the hand, and it is NOT changed here.
2. The call of the cold 4-bet: `HorsePreflop.ts`, `v86_plo_three_bettor_continues` (price 0.23, strength 0.63 against 0.56 times the tightness). With the Horse's own VPIP well under the floor the node shoves instead. By the engine's own aces model the call pays its price (39% heads-up against a random aces hand, 29% three-way).
3. The flop call: `HorseLogic.ts`, the committed-call branch: estimated equity 0.26 to 0.30 against a required 0.177. Exact equity against the two hands actually held: 15.3% for a direct price of 14.2%.
4. The turn all-in for 81 into about 2,000: the same branch, 0.13 to 0.26 against a required 0.09 to 0.11. Priced on what it knew (it was in fact drawing dead).

The big blind's line: the cold 4-bet with suited aces is standard; the flop bet was a quarter of the pot with one pot-sized bet behind (the replay bets 26% to 59% of the pot, so the recorded size is at its small end), which priced in every draw; the turn check and the fold to a pot bet and an all-in (0.18 to 0.32 estimated against a required 0.32; four outs against a straight) are consistent with a value-heavy bettor.

## What changed

New `server/src/engine/HorseOmahaUnderpair.ts`, wired outermost on both decision paths in `HorseLogic.ts` (`omahaOutermostCallDiscipline`):

1. `omahaNoCallColdFourBetWithoutPremium`: a Horse whose own preflop re-raise is re-raised cold (the re-raiser had put no voluntary money in before) folds a hand without a pair of aces or a premium structure (`omahaReraisedPremium`), unless the call is all in or leaves no more behind than the call itself and its equity against aces pays the direct price. Receipts `omaha_no_call_cold_four_bet_without_premium` and `_priced_in`.
2. `omahaUnderpairNoMultiwayFlopContinue`: on an unpaired flop, facing a bet and a call from two live opponents, exactly one pair below the top card of the board with no flush draw and fewer than eight nut-straight outs folds, unless the call costs less than a tenth of the resulting pot. Receipts `omaha_underpair_no_multiway_flop_continue` and `_priced_in`.

PLO4 and PLO5 cash, high only. With both unset or false the brain decides exactly as before. League cards plo4/plo5 for each; evidence files `docs/horse-default-on.d/omahaNoCallColdFourBetWithoutPremium.md` and `omahaUnderpairNoMultiwayFlopContinue.md`.

## Not changed, and open

The VPIP floor lowering the 3-bet bar (cause 1) and, for a call above 30% of the stack, the jam bar (cause 2's shove) is the defect this trace found; it has no option here. Neither new option is shown to gain: the recorded calls were at or near their price. Both wait for a declared evaluation.
