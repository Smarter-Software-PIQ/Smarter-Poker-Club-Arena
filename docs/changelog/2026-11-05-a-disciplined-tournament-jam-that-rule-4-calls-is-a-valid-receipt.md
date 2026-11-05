# A disciplined tournament jam that rule 4 calls is a valid horse receipt (2026-11-05)

## What happened

From 15:16Z on 2026-11-05 the live horse decision worker refused 65 no-limit
hold'em tournament decisions with "invalid policy receipt: policy_graph"
(41 of them on release 71087373 after 18:11Z, read from the engine log and
`hand_history` actions with origin `horse_fallback`). Each refusal became a
fallback fold, so the horse folded hands its brain had decided to continue
with, for example JTs, QTo and 99 facing a 3-bet.

## Cause, read from the journaled receipts

Four refused receipts were read from the engine's decision journal (request
and decision, read-only) and replayed exactly through today's brain with the
journaled RNG. In every one the `wager_rules` node took a preflop jam to a
call:

1. an owner proposed a jam facing a 3-bet or more (the Phase 7 tournament
   utility arbiter, or the reference ladder);
2. the tournament shove discipline (Dan 2026-10-25) rewrote the deep or
   covering jam into a sized raise;
3. hold'em rule 4a (Dan 2026-10-31, `holdem_no_four_bet_bluff`) turned that
   sized re-raise into a call.

The node records only its input and output, jam -> call. The response
validator admitted a rule 4 call only from a fold (the 4-bettor continues)
or a raise (no 4-bet bluff), so it refused the receipt.

## Fix

`horseDecision/responseValidation.ts` also admits jam -> call in
`wager_rules` for no-limit hold'em, only when the request is known, only
facing a 3-bet (`holdemFourBetSpot`), and only when the shove discipline
re-run on that request really turns the jam into a raise. Nothing else in
the validator changes; the brain's decisions do not change. The horse now
plays the call its brain chose instead of the fallback fold.

## Proof

`TournamentJamDisciplinedThenCalledReceipt.law.test.ts` validates three real
refused receipts (ids anonymised) against their own requests, fails on the
old validator, and pins that the same receipts are still refused with no
request, in a cash game, or on an all-in-or-fold table.
