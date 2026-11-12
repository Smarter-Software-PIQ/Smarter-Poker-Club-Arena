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

A bluff is chosen for its fold equity, and the branch assumed there was some.
There is none in two cases: the price to call is already hero's whole stack,
so the "raise" is only a call; or every opponent still in the hand is all in,
so the hand is shown down against all of them whatever hero does. The 3-bet
bluff and the generic squeeze bluff now require both that hero can raise and
that at least one live opponent still has chips
(`bluffRaiseCanFoldSomeone`, `everyLiveOpponentIsAllIn`, public seat flags
only).

What is deliberately not changed: raising over a short all-in when a player
behind or a caller still has chips. That raise can fold someone or contest a
side pot, so it keeps its place. Value 3-bets are untouched. The 4-bet bluff
already has its own stack condition. The pot-limit Omaha elite squeeze is not
touched. The test sits after the random draw, so the draw still happens and
every other decision's random stream is unchanged.

## Proof

`server/src/engine/ABluffRaiseNeedsSomeoneWhoCanFold.test.ts`, 8 cases. Two
replay the anonymised decision-time request from the journal's recorded
generator state: as recorded (the price is the whole stack), and with hero
given 120 big blinds so that a raise is legal but the only opponent is all in.
On the old branch both return the bluff raise; now neither does. Five cases
pin who can still fold: nobody when every live opponent is all in; a player
behind with chips; a caller with chips; no live opponent; and the combined
rule.

## Limits

- One recorded instance. How often the branch fired at a price of the whole
  stack is not measured.
- The generic squeeze bluff gets the same test on the same reasoning; no
  instance of it was observed. No full-decision replay shows the isolation
  raise firing after the change; it is pinned at the level of the rule.
- Not live until an engine release contains it.
