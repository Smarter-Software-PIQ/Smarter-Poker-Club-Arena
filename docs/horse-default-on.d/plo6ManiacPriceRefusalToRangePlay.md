# plo6ManiacPriceRefusalToRangePlay (PLO6-AUDIT-013)

Opt-in (default OFF) since 2026-11-16: its reach row was not met by the deadline Hand Analysis set (see Reach). Kept as the evidence for the opt-in arm. Evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). The matched cases this rests on were merged as #10744; the receipt that counts an observed maniac raiser as #10750. The numbers below are in big blinds.

## Mechanism

Status: MET

PLO6 cash, preflop. When the raiser the Horse faces reads as a maniac on its own record (`observedManiacRaiser`) and there have been two raises or more, or the call is a quarter of the stack or more, the decision is taken by the price arithmetic in the V38 block of `HorseLogic.ts` (`maniacPrice38`), before the range play. The arithmetic calls when sampled equity against the players already in at the price clears the pot odds plus fixed margins, and otherwise folds outright.

Production hand 58751512, decision 13: the button, 390 big blinds deep with Td 5d Kc 4c Js Ac, faces 161 to call into 520 after a four-bet. Required equity is 161 / 681 = 0.236, plus 0.08 (the PLO6 domination margin) plus 0.03 (realization) = 0.346. The sampled three-way equity sits on that line, so with an observed maniac as the four-bettor every profile calls on 7 of 10 seeds and folds on 3 (`continuationGuard: preflop_priced_refusal`). It never shoves, which needs a 0.12 gap.

Against an unknown four-bettor, or one proven tight, the arithmetic is not used (the call is under 40% of the stack and the raiser is not all in), the range play decides, and the same hand shoves 60 of 60. So the Horse makes its least committed play against the opponent with the widest range.

The change: in that case only, a refusal by the arithmetic is no longer a fold. The decision falls through to the range play, which is what decides the same node against every other opponent. A call by the arithmetic is unchanged.

## Input fidelity

Status: MET

The node is the anonymised recorded hand (`fixtures/horse-plo6-floor-deep-stack-off-58751512.json`). A recorded node does not carry the table's VPIP floor or the seat's judged VPIP; the fixture supplies the two values the live decision received (floor 50, two hands judged at 50%). The opponent's record is NOT recorded: it is supplied by hand as a durable PLO6 cash profile built with `exploitHandIncrements` and `decayAndAdd` from stated public actions (120 raised hands; a re-raiser of half the raises it faces; 120 raised hands then 14 limps), installed at the exact table size. Opponent memory is on. The Horse's own identity and the second look are not reproduced. So this shows what the decision function does with a maniac read at a real node; it is not a replay of a hand in which a real maniac sat there.

## Value

Status: MET

Fold is 0. The alternatives' expected value at this node comes from this lane's value study (PLO6 archive, `followup/ev/EV-AT-CHANGED-NODES.md`, hand 6dc5eff8, side pots modelled, the four-bettor always calls the shove, the cold caller folds, no rake):

| Four-bettor range             |  Call | Shove, opener calls | Shove, opener folds |
| ----------------------------- | ----: | ------------------: | ------------------: |
| Random                        | +50.0 |               +82.0 |              +137.2 |
| Top quarter of six-card hands | +38.0 |               +43.7 |               +93.8 |
| Value only: exactly two aces  | +34.5 |               +28.1 |               +69.2 |

The change replaces the fold (0) with the range play's action, which at this node is the shove, on the refused share of decisions (18 of 60 against the every-hand raiser, 12 of 60 against the selective re-raiser). Change per refused decision: +28.1 to +137.2. It is positive under all three ranges, including value only, and under both responses of the opener. Per decision at the node, weighted by the refused share: +8.4 to +41.2 (every-hand raiser), +5.6 to +27.4 (selective).

Sensitivity: the sign does not depend on the range, because every alternative to folding is positive at this node. It does depend on the node: where the range play itself folds, the change does nothing; where the range play calls or raises with a hand that loses, the change loses what that play loses. This is one node and one holding. These are simulated values against assumed ranges, not production results.

## Continuation

Status: NOT APPLICABLE

Not applicable because no measured frequency is relied on: the unfavourable response is assumed.

The value table assumes the four-bettor always calls the shove, which is the unfavourable case for the shove (no fold equity is credited). The opener's response is not measured for this spot, so both of his responses are shown and the sign holds under each. Nothing in the argument relies on an assumed fold frequency.

## Reach

Status: NOT MET

At the matched node with the read installed: 18 of 60 decisions change against the every-hand raiser and against the raiser who went quiet for 14 hands, 12 of 60 against the selective re-raiser, 0 of 60 against an unknown, a sparse (four raises), a newly raising and three tight opponents, and 0 when the record sits on a player who is not the raiser faced.

In production the number of changed decisions is NOT measured, so this row is not met (Hand Analysis ruling 2026-11-15T06:00:45Z). No owner authority is retained for the unmet row and none is claimed.

What is measured, with live inputs, from `horse_brain_telemetry` (read 2026-11-15T05:46Z): `plo6_maniac_price_refusal_range_play_seen` fired 4 times on 2026-11-14 and once on 2026-11-15; `observed_maniac_raiser_seen` fired 276 and 395 times on the same days. Those 5 are first-pass hand-offs to the range play. Changed decisions may be fewer (the range play may still fold), and second-look hand-offs are not counted, so this is not a bound on changed decisions. None was already the new action by construction (the old action was a fold).

Why the hand record cannot supply the count: a recorded hand carries the action and the public node, and it does not carry the opponent read, the guard or a receipt marker. Six-card cash preflop Horse decisions at the price gate alone (a raise before, the call under 40% of the stack, and two raises or a call of 25% or more) numbered 8,190 from 2026-11-14T12:00Z to 2026-11-15T05:50Z; only the maniac read picks the 5 out of a set like that. Whether any of the 5 faced a person is not known: 41 six-card cash hands had a person on 2026-11-14 and 1 on 2026-11-15.

How the row was written: the four receipts `plo6_maniac_price_refusal_{floored,unfloored}_{continued,folded}` (#10914) count what the first pass chose after each hand-off, from the first release containing 4982d504 (54c9aac8, sealed 2026-11-15T10:00:17Z). Fixed time, set by the reviewer: 24 hours after that seal (2026-11-16T10:00:17Z). Zero hand-offs and hand-offs with no changed action are both NOT MET (Hand Analysis 2026-11-15T14:59:59Z); a changed count also needs the committed action from the decision journal, not the counters.

Result: NOT MET (Hand Analysis rulings 2026-11-15T06:00:45Z, 14:59:59Z, 16:08:40Z and 17:03:57Z, the last setting the decision read at 2026-11-16T06:00Z from the decision journal, both passes). Only a changed accepted decision measured from the decision journal by the decision read keeps the option on; none was measured, so the option went opt-in in the pull request that made this change. Which case applied is recorded with that pull request and in the PLO6 archive (`phase1-play/maniac-row5/DECISION.md`): no eligible opportunity (the evidence was unavailable), eligible decisions with no changed action, unreadable evidence, or a harmful decision. In the first three cases this is a promotion-evidence disposition: the production reach the row requires was not shown. It is not a finding that the decision is wrong.

What the measurement could and could not see: the hand-off receipt and the four outcome receipts count the first pass only. While the option was on by default (until this change), the deep second look ran the same decision with it on and telemetry off (`horseDecision/workerRuntime.ts`), and its action could be the one the table executed, so a zero receipt count does not exclude a hand-off; the decision journal is read for both passes. The journal of the first release in the window (54c9aac8, 2026-11-15T10:00:17Z to 13:15:53Z) was not retained, so its second-look decisions are unreadable; its first-pass receipt count stands.

Earlier ceiling, kept for the record: in the frozen two-day interval (2026-11-10T15:50Z to 2026-11-12T15:50Z), human-facing PLO6 cash, 596 hands, 648 Horse preflop decisions faced a human's raise; 71 were re-raise sized (20 big blinds or more to call, under 40% of the stack) and 51 of those were folds. Decisions facing a Horse's raise are not in this count. The rule reads the public record and not who the raiser is, so a Horse whose record reads as a maniac is treated the same way.

## Scope

Status: MET

Gated in code to all of: Omaha high with six hole cards (PLO6), cash, the raiser faced an observed maniac, the raiser not all in, the call under 40% of the stack. Pinned by decision-level cases in `HorsePlo6OpponentReadMatrix.test.ts`: the same node dealt as PLO5 with the same record keeps the fold with the option on or off (removing the six-card condition fails that case); the open node, where the arithmetic is not used, is unchanged; unknown, sparse, tight and newly raising raisers are unchanged. Excluded by the code condition and not by a case of their own: a call of 40% or more of the stack and a raiser who is all in (`variantPrice38`), tournaments and hi-lo. PLO4, PLO5, hi-lo, hold'em and tournaments are outside the evidence and outside the rule.

## Visibility

Status: MET

`plo6_maniac_price_refusal_range_play_seen` fires each time a refusal is handed to the range play on the first pass (telemetry on; the deep second look is not counted) (registered in `HorseDataLedger.ts`; an occurrence counter, so a quiet day is not a fault). Its denominator is `observed_maniac_raiser_seen` (#10750).

## Limits

Status: MET

- One recorded node and one holding. The opponent's record is synthetic.
- The tournament, hi-lo, all-in raiser and 40% exclusions are code conditions with no matched case of their own.
- The value figures are simulated against three assumed ranges with full equity realization on the call line; they are not win rates.
- The production reach shown is a first-pass count of hand-offs (5 in about 30 hours), not a count of changed decisions, and second-look hand-offs are not counted; row 5 is not met.
- The rule changes the fold only. It does not make the Horse shove where the call was chosen, so against an observed maniac at this node the Horse still calls 42 times in 60 where the shove is worth more.
- It makes no change against a tight raiser. At this node the shove against an aces-only range is worth 28.1 when the opener calls and 69.2 when he folds, against 34.5 for the call, so no change there is supported.
- Natural use needs a human who reads as a maniac at a PLO6 cash table and re-raises a Horse; until one is observed on a release that carries this, live behaviour is unverified.
