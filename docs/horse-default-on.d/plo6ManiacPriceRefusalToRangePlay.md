# plo6ManiacPriceRefusalToRangePlay (PLO6-AUDIT-013)

On by default. Evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). The matched cases this rests on were merged as #10744; the receipt that counts an observed maniac raiser as #10750. The numbers below are in big blinds.

## Mechanism

PLO6 cash, preflop. When the raiser the Horse faces reads as a maniac on its own record (`observedManiacRaiser`) and there have been two raises or more, or the call is a quarter of the stack or more, the decision is taken by the price arithmetic in the V38 block of `HorseLogic.ts` (`maniacPrice38`), before the range play. The arithmetic calls when sampled equity against the players already in at the price clears the pot odds plus fixed margins, and otherwise folds outright.

Production hand 58751512, decision 13: the button, 390 big blinds deep with Td 5d Kc 4c Js Ac, faces 161 to call into 520 after a four-bet. Required equity is 161 / 681 = 0.236, plus 0.08 (the PLO6 domination margin) plus 0.03 (realization) = 0.346. The sampled three-way equity sits on that line, so with an observed maniac as the four-bettor every profile calls on 7 of 10 seeds and folds on 3 (`continuationGuard: preflop_priced_refusal`). It never shoves, which needs a 0.12 gap.

Against an unknown four-bettor, or one proven tight, the arithmetic is not used (the call is under 40% of the stack and the raiser is not all in), the range play decides, and the same hand shoves 60 of 60. So the Horse makes its least committed play against the opponent with the widest range.

The change: in that case only, a refusal by the arithmetic is no longer a fold. The decision falls through to the range play, which is what decides the same node against every other opponent. A call by the arithmetic is unchanged.

## Input fidelity

The node is the anonymised recorded hand (`fixtures/horse-plo6-floor-deep-stack-off-58751512.json`). A recorded node does not carry the table's VPIP floor or the seat's judged VPIP; the fixture supplies the two values the live decision received (floor 50, two hands judged at 50%). The opponent's record is NOT recorded: it is supplied by hand as a durable PLO6 cash profile built with `exploitHandIncrements` and `decayAndAdd` from stated public actions (120 raised hands; a re-raiser of half the raises it faces; 120 raised hands then 14 limps), installed at the exact table size. Opponent memory is on. The Horse's own identity and the second look are not reproduced. So this shows what the decision function does with a maniac read at a real node; it is not a replay of a hand in which a real maniac sat there.

## Value

Fold is 0. The alternatives' expected value at this node comes from this lane's value study (PLO6 archive, `followup/ev/EV-AT-CHANGED-NODES.md`, hand 6dc5eff8, side pots modelled, the four-bettor always calls the shove, the cold caller folds, no rake):

| Four-bettor range             |  Call | Shove, opener calls | Shove, opener folds |
| ----------------------------- | ----: | ------------------: | ------------------: |
| Random                        | +50.0 |               +82.0 |              +137.2 |
| Top quarter of six-card hands | +38.0 |               +43.7 |               +93.8 |
| Value only: exactly two aces  | +34.5 |               +28.1 |               +69.2 |

The change replaces the fold (0) with the range play's action, which at this node is the shove, on the refused share of decisions (18 of 60 against the every-hand raiser, 12 of 60 against the selective re-raiser). Change per refused decision: +28.1 to +137.2. It is positive under all three ranges, including value only, and under both responses of the opener. Per decision at the node, weighted by the refused share: +8.4 to +41.2 (every-hand raiser), +5.6 to +27.4 (selective).

Sensitivity: the sign does not depend on the range, because every alternative to folding is positive at this node. It does depend on the node: where the range play itself folds, the change does nothing; where the range play calls or raises with a hand that loses, the change loses what that play loses. This is one node and one holding. These are simulated values against assumed ranges, not production results.

## Continuation

The value table assumes the four-bettor always calls the shove, which is the unfavourable case for the shove (no fold equity is credited). The opener's response is not measured for this spot, so both of his responses are shown and the sign holds under each. Nothing in the argument relies on an assumed fold frequency.

## Reach

At the matched node with the read installed: 18 of 60 decisions change against the every-hand raiser and against the raiser who went quiet for 14 hands, 12 of 60 against the selective re-raiser, 0 of 60 against an unknown, a sparse (four raises), a newly raising and three tight opponents, and 0 when the record sits on a player who is not the raiser faced.

In production the reach is not measured, because opponent reads were not retained with the recorded hands. The ceiling from the frozen two-day interval (2026-11-10T15:50Z to 2026-11-12T15:50Z), human-facing PLO6 cash, 596 hands: 648 Horse preflop decisions faced a human's raise; 71 of them were re-raise sized (20 big blinds or more to call, under 40% of the stack), and 51 of those were folds. The change can touch at most those folds, and only where the human read as an observed maniac at that moment. The rule reads the public record and not who the raiser is, so a Horse whose record reads as a maniac is treated the same way; decisions facing a Horse's raise are not in this count. None of these was already the new action in production by construction (the old action was a fold).

## Scope

Gated in code to all of: Omaha high with six hole cards (PLO6), cash, the raiser faced an observed maniac, the raiser not all in, the call under 40% of the stack. Pinned by decision-level cases in `HorsePlo6OpponentReadMatrix.test.ts`: the same node dealt as PLO5 with the same record keeps the fold with the option on or off (removing the six-card condition fails that case); the open node, where the arithmetic is not used, is unchanged; unknown, sparse, tight and newly raising raisers are unchanged. Excluded by the code condition and not by a case of their own: a call of 40% or more of the stack and a raiser who is all in (`variantPrice38`), tournaments and hi-lo. PLO4, PLO5, hi-lo, hold'em and tournaments are outside the evidence and outside the rule.

## Visibility

`plo6_maniac_price_refusal_range_play_seen` fires each time a refusal is handed to the range play (registered in `HorseDataLedger.ts`; an occurrence counter, so a quiet day is not a fault). Its denominator is `observed_maniac_raiser_seen` (#10750).

## Limits

- One recorded node and one holding. The opponent's record is synthetic.
- The tournament, hi-lo, all-in raiser and 40% exclusions are code conditions with no matched case of their own.
- The value figures are simulated against three assumed ranges with full equity realization on the call line; they are not win rates.
- The production reach is a ceiling, not a count.
- The rule changes the fold only. It does not make the Horse shove where the call was chosen, so against an observed maniac at this node the Horse still calls 42 times in 60 where the shove is worth more.
- It makes no change against a tight raiser. At this node the shove against an aces-only range is worth 28.1 when the opener calls and 69.2 when he folds, against 34.5 for the call, so no change there is supported.
- Natural use needs a human who reads as a maniac at a PLO6 cash table and re-raises a Horse; until one is observed on a release that carries this, live behaviour is unverified.
