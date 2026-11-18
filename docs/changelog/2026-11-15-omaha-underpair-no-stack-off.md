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

## The VPIP floor (added the same day)

Owner, 11:35: "ADD IN A LIMP FOLD TO GET THE VPIP UP IF THEY ARE NOT PLAYING ENOUGH HANDS. THEY SHOULDN'T BE PUTTING IN TON'S OF CHIPS AND RAISING JUST TO MEET THE 50% VPIP. LIMP FOLD IS VPIP."

Cause 1 above is the floor: `vpipFloorMul` multiplies the style tightness and with it every preflop bar, raises included, until the Horse's judged VPIP reaches the steering target (70.6% on a 50% table). A third option, `omahaVpipFloorByLimp` (off by default, PLO4/PLO5 cash), takes the preflop decision a second time without the floor and lets the floor buy only the cheapest voluntary action: the limp first in, a call facing a raise (never a re-raise or a shove), and a fold to a raise after a limp unless the hand clears the ordinary bar. A limp counts as VPIP (`handFacts.ts`, `deriveFlowFlags`). With it on, the recorded re-raise to 50 is a call of 9 and the shove facing the 4-bet is a call. It reverses, for this case only, the owner's rule of 2026-08-30 that a Horse never open-limps. Receipts `omaha_vpip_floor_limp`, `omaha_vpip_floor_limp_fold`, `omaha_vpip_floor_three_bet_bar_kept`; evidence file `docs/horse-default-on.d/omahaVpipFloorByLimp.md`. The league seats no floored table, so the option is a refused matchup there and is unmeasured.

The floor's target (later the same day): the 70.6% is the floor plus 1.3 standard errors, read over a ten-hand window for every game but hold'em although the Classic floor judges a rolling thirty; Horses at 50%-floor PLO5 tables actually played 63.3% of hands. With `omahaVpipFloorByLimp` on the Horse aims three hands of the window above the stated floor (18 of 30, 60%) and the cheap call or limp under that aim is certain. In simulated 300-hand sittings that holds the floor as often as today (0.4% of rolling windows under it against 0.6%, never for the ten hands that turn the warning into a boot) at 58% VPIP instead of 64%, with 14% fewer floor-forced entries and none of them a raise. A one-hand buffer was tried and left 14% of windows under the floor.

## The full sweep's preflop leaks (added the same day)

The sweep of 4,573 human-seated PLO4/PLO5 cash hands ranks three preflop spots first. Each flagged decision was replayed from its stored snapshot (private rows; `full-sweep-20261115/private/preflop3/`):

- Calls of a 4-bet or more without aces (72): the re-raiser was the original opener 25 times, an earlier caller or 3-bettor 28 times and a cold third player 19 times; 64 were 150 big blinds or deeper and 48 faced a pot-sized re-raise (price 0.33 to 0.40). `omahaNoCallColdFourBetWithoutPremium` reaches 7 of them. The 22 with the winner at the table replay as the maniac price call.
- 3-bets with a weak pair (61): 20 are the VPIP floor (`omahaVpipFloorByLimp` turns 19 into calls and 1 into a fold), 5 the V86 elite 3-bet, 5 clear the unfloored value bar, 12 appear only when the opener is read as an aggressive raiser, and 19 do not replay without the live read.
- 4-bets without aces against the winner (21): 18 replay as the V53 pressure 4-bet, priced against a range as wide as his opens.

A fourth option, `omahaManiacReRaiseWidthMeasured` (off by default), reads a measured maniac's re-raise at his own counted re-raise rate instead of his whole raising width; the price arithmetic is unchanged. Replayed, 9 of the 18 4-bets that reproduce are no longer made (those hands lost 1,008 bb); most of the calls of his 5-bets remain calls. Evidence file `docs/horse-default-on.d/omahaManiacReRaiseWidthMeasured.md`.

## Open

None of the four options is shown to gain: the recorded calls were at or near their price, and the floor option cannot be dealt by the league. All wait for a declared evaluation.
