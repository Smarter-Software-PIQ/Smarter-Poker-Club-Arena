# A Bounty-Only Event Keeps The Reference Action

2026-11-12. Hold'em Strategy lane. Finding HVH2D-TRN-001, direction 2, of the
two-day Human vs Horse study. Engine source:
`server/src/engine/HorseTournamentUtility.ts`. No migration. Applies to every
tournament variant, because the arbiter is shared.

## What players saw

In a Midday Free Buy (progressive knockout, no prize pool, every chip of value
is a head), big-stacked Horses entered pots with hands the reference policy
had folded: 34o at 115 big blinds, K5o at 111. The exported originals hold 23
such decisions in 22 hands of one event, 13 of them with a human in the hand.

## Cause, from the production journal

The reference policy chose fold (15), a small raise (6), check (1) or bet (1).
The tournament utility arbiter replaced each with an all-in (`policyGraph`
node `tournament_utility`), and the wager rules then turned most of those into
an executed raise.

The arbiter weights payout by prize / (prize + bounty). This event's prize
pool is 0 by design, so that weight is 0: chips have no modeled worth and only
the head won or lost in this hand counts. Every one of these Horses covered
the table, so the all-in could not bust and scored as a free shot at a head.
In the replayed hand the all-in was worth +0.066 pool points of head value
while losing 198 chips on average; fold was worth 0.

The priced pool of 0 is correct here. This is not the guarantee defect of
direction 1 and the guarantee correction does not touch this event.

## The correction

When a bounty event has no payout pool the arbiter reports
`chip_value_not_modeled` and does not choose. The reference action stands, as
it does for every other unavailable reason. A bounty event with a prize pool
is evaluated exactly as before.

## Proof

`server/src/engine/ABountyOnlyEventKeepsTheReferenceAction.test.ts`, 9 cases. The first 3
replaying the anonymised decision-time request of one of the 23 decisions
(seats, stacks and heads only). On the old arbiter the decision case fails:
the request returns a raise. On the new one it folds and carries the refusal
reason. The third case gives the same event a prize pool and shows the arbiter
still evaluates it. The other 5 fix the boundaries: the action returned on a
stand-down is legal and is the policy graph's final action; a covered stack
stands down as a covering one does; a knockout with any prize pool, an event
with no bounty pool and a satellite with a prize pool are not affected; an
event whose payout weight is zero stands down whatever its type.

What the records say about awards (completed events, 2026-10-29 to
2026-11-12): 321 satellites, every one with a prize pool and none with a
bounty pool, their tickets paid out of that pool; 16 knockouts with a bounty
pool and no prize pool, none of them a satellite. So the stand-down reaches
exactly those 16 and nothing with separately recorded awards. Missing award
data is a different case and is already refused upstream as an incomplete
context.

## Limits

- This removes a wrong override; it does not teach the arbiter what chips are
  worth in a knockout with no prize pool. Valuing chips as future head equity
  is a model change and is not built here. Until then such events play the
  reference policy with no tournament-utility adjustment in either direction,
  including any correct head-hunting calls the arbiter used to add.
- A knockout whose prize pool is small next to its bounty pool has the same
  weakness in proportion. It is not changed here.
- The recorded override fires on a minority of outcome samples for the same
  request (2 of 10 seeds on the original body), so the 23 exported decisions
  are a floor for one event, not a rate.
- Not live until an engine release contains it.
