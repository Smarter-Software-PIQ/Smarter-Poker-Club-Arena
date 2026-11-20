# omahaMultiwayRiverCallNeedsStrength: authority for the live switch

Lane brief of 2026-11-16 (PLO4/PLO5 defence, part 2). Evidence NOT MET: it FAILED its declared paired league evaluation on 2026-11-17 and is OFF-ONLY.

## What it does

PLO4/PLO5 cash, one board, high only, the river, facing a bet with at least one other opponent live beside the bettor (one who called the bet in front, one all in from an earlier street, or one still to act behind), with a hand that is not nut class (`omahaNutClassNow`): a call is replaced by the multiway exact-hand verdict (a raise is not touched: the option prices the call only, so under the owner's order of 2026-11-17 11:49 America/Chicago, no blanket rules, it does not decide a raise; the first build turned a raise into the call and that step was removed on 2026-11-17) (`HorseOmahaMultiwayDiscipline.omahaMultiwayRiverCallVerdict`). The verdict is the facing-bet EV of `HorseOmahaFacingBetEv` against the bettor alone (his value region and bluff share by bet size and line, moved by his measured read; the population prior when he is unmeasured) multiplied by the chance of beating every other player's continuing range: a caller of this bet holds the strongest 0.35 of all holdings, a player still to act continues with the strongest 0.25 (and is there only with that share), an earlier all-in holds the strongest 0.5; a caller's or a player behind's share is moved by his measured river-call rate against the population continue rate 0.39 (bounded 0.5x to 1.5x). The bettor's value region is the multiway one (wave two, 2026-11-16, `omahaMultiwayValueShare`, derived, no new constant): the heads-up share V1 by size and line holds hands whose weakest beats 1 - V1 of holdings; bet into n live players (the Horse and every field player), the same chance of being best against all of them, with the module's independence, needs (1 - Vn)^n = 1 - V1, so Vn = 1 - (1 - V1)^(1/n) (heads-up unchanged; the facing-bet EV option keeps the heads-up region). The ranges are taken as INDEPENDENT (the product of the shares, as omahaStrongHandValue's multiway pricing does); joint card removal between opponents is not modelled. The call is made when EV(call) clears the facing-bet margin (2% of the final pot); otherwise the hand folds. It never raises: a raise becomes the call the verdict allows, else a fold. A fold is never turned into a call.

Precedence: inside the owner-ruled chain (`omahaOwnerRuledFinal`, after the owner-ruled turn and flop verdicts), so no later rule raises over its fold; `omahaTurnRiverRaiseNeedsNuts` runs outside it and decides a raise on its own terms.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaMultiwayRiverCallNeedsStrength docs/horse-option-authority.d/omahaMultiwayRiverCallNeedsStrength.md sha256 <digest>`). Registered in the live switch OFF-ONLY (follow-up list migration 20261118013329 names it; HorseOptionSwitch.ts OPTION_SWITCH_OFF_ONLY, failed its declared evaluation): it cannot be switched on. The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on

The owner's principles of 2026-11-15, as the lane brief of 2026-11-16 relays them (in substance, not verbatim): no blanket rules, the decision is hand, player, price and pot dependent; play defence on bad cards; an owner-ruled check or fold is final; facing a bet on the turn or the river, raise only with the nuts. No verbatim owner order names this option; the brief that ordered it is the lane's (2026-11-16).

## Recorded hands and rulings it answers

Full sweep 2026-11-15 (archive full-sweep-20261115/SWEEP.md), family R: a river call of 10 bb or more without the nuts with three or more players live, 19 calls in 4,573 PLO4/PLO5 cash hands with a person seated, hand net -1,987 bb, 74% rule mistakes. Replayed through the verdict alone (archive defense2-20261116/R19-verdicts.txt; the sweep holds no action history before the river, so each state is rebuilt from the recorded pot, bet, players live and closing flag, the bettor with no earlier aggression and the population prior): 5 of the 19 now fold (59266920 straight, 59482217 top pair, 58476336 two pair, 58946767 flush, 58463768 set; every one of those five hands lost, together -329.5 bb); 14 still call, among them the costly non-nut flushes (59446997, 59484381) and full houses, which the verdict prices as calls at their price. None of the 19 is nut class.

Wave two review (archive wave2-20261116/r19/, the same reconstruction): of the 14 calls, by class. Full houses (58460578, 59489550, 59337203, 59471098) and the second-nut and queen-high flushes facing a bet and a call (59446997 at 5.1 to 1, 59484381 queen-high at 4 to 1) are calls under the stated ranges and stay calls with the multiway value region: their price needs 14 to 20% and they hold 41 to 82% against the bettor; 59446997 would fold only if both the bettor and the caller held the strongest tenth of all PLO5 holdings. Sets with good prices (58662831 at 22 to 1, 58804844), 59482217 trips at 10 to 1 and 58796916 flush stay calls. The caller prior 0.35 is not the loose part on these hands: tightening it alone (to the two-player share 0.19) moves only two of the 14. The loose prior is the bettor's heads-up value region applied to a bet into two players: with the multiway value region four calls become folds: 59484381 nine-high flush with a player behind (-356.7 bb), 59338631 trips on a double-paired board (-39.5), 58476336 bottom set at a pot-sized bet (EV -2.6, it won 37.3) and 58752006 top two pair on a four-flush board (won 32.4). 10 of the 14 still call; no near-nut hand folds (HorseOmahaMultiwayDiscipline.test.ts: the second-nut flush calls a bet and a call at every size).

## Receipts

omaha_multiway_river_call_folded. A receipt describes the final action: each is proposed and settled when the decision is final; its `_vetoed` twin (omaha_multiway_river_call_folded_vetoed) fires when a later rule replaced the verdict.

## Tests

HorseOmahaMultiwayDiscipline.test.ts (the multiway value region: derived identity, used by the verdict, the second-nut flush still calls; 16 seeds per class: trips facing a bet and a caller fold at every seed; every multiway river call is the verdict, a fold stays a fold and a raise is not touched; the field never raises the win share; heads-up, nut class unchanged; unset, false and truthy non-booleans byte-identical; no random number drawn; every decision admitted by the receipt validator).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001, the strategy-head method: unset and all three options false both give b5031a14 / 1adfd8e3 / 5b8cac9c / f5ed6fa1, 446 / 2714 / 428 / 2844 decisions, 0 illegal, 0 fallbacks; archive defense2-20261116/fp-\*.json).
- Value: FAILED (2026-11-17, bar written before the runs: archive plo-handoff-review-01a1cbbd/wave2b-01BNteGZ/eval/PROTOCOL.md, RESULTS.md; build 59b1c034607; both arms carry the 32 options live on 2026-11-16, arm A adds this one; 3 seeds x 4,000 mirrored pairs per cell; 0 illegal, 0 truncated, 0 fallbacks). Horse-only table PLO5 -0.27 bb/100, SE 0.11, 46 divergent pairs: loses beyond two standard errors. Horse-only PLO4 -0.42, SE 0.19 with 21 divergent pairs, human-like field PLO4 1 divergent pair and PLO5 none: inconclusive. The option is nearly inert in the league (18 call-to-fold receipts in 192,000 hands), so the failure rests on very few decisions. No constant was changed after the runs.
- Continuation, reach: NOT MET.

## Limits

The constants are the facing-bet module's population shares (0.35 / 0.25 / 0.5), not measured for multiway fields; the multiway value region rests on the same independence assumption; the 0.5x to 1.5x bounds on the caller read are stated, not measured; 0.39 is the sweep's heads-up continue rate to a Horse river bet (138 of 353), not a multiway rate. Independence of the ranges is a simplification. The sweep replay is a reconstruction, not the recorded state.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
