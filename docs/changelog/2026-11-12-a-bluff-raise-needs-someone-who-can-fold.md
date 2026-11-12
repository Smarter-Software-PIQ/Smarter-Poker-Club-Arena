# A Bluff Raise Needs Someone Who Can Fold

2026-11-12. Hold'em Strategy lane. Finding HVH2D-TRN-001, row 8, of the
two-day Human vs Horse study. Engine source:
`server/src/engine/HorsePreflop.ts`. No migration. Companion to the
guaranteed-pool correction (#10612).

## What happened

KJo in the big blind with 59 big blinds faced an all-in for more than its
stack in a Free Buy. The reference policy drew its 3-bet bluff branch and
returned a raise. At that price a raise can only be a call for the whole
stack, against a player who is already all in and cannot fold.

In production the tournament utility arbiter folded it, for an unrelated and
wrong reason: the rebuy was priced against the 2 chips collected so far. With
that pricing corrected (#10612) the arbiter no longer overrules it, so the
call-off would stand. Replayed from the journal's own generator state: as
recorded, reference all_in and final fold; with the corrected pool, final
all_in.

## The correction

The 3-bet bluff branch now also requires that hero can raise (the price to
call is less than hero's stack) and that somebody is left to fold (the lone
raiser is not all in, or a caller is). The test sits after the random draw,
so the draw still happens and every other decision's random stream is
unchanged. Value 3-bets, squeezes and the 4-bet bluff are not touched; the
4-bet bluff already has its own stack condition.

## Proof

`server/src/engine/ABluffRaiseNeedsSomeoneWhoCanFold.test.ts`, 2 cases,
replaying the anonymised decision-time request from the journal's recorded
generator state. Old branch: the decision case fails, the event list holds
three_bet_bluff. New branch: reference fold, final fold.

## Limits

- One recorded instance. How often the branch fired at a price of the whole
  stack is not measured.
- The squeeze bluff branches have no such condition and are not changed
  here; no instance of them was observed.
- Not live until an engine release contains it.
