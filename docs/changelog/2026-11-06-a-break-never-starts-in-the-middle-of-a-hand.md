# A break never starts in the middle of a hand

Dan, 2026-11-06: "ANY AND ALL SCHEDULED BREAKS OR MAINTENANCE BREAKS MUST
FINISH THE CURRENT HAND THEY ARE ON, BEFORE THE BREAK STARTS. BREAKING IN THE
MIDDLE OF THE HAND MAKES THE PLATFORM 'FEEL BROKEN'. NOBODY DOES IT LIKE THAT.
YOU MUST ALWAYS 'CALL LAST HAND' AND THEN ONLY START EITHER BREAK AFTER ALL THE
HANDS HAVE FINISHED." Raised with a screenshot of 40 Chip Bounty Freezeout -
2.5K GTD (KINGS CLUB, Midway Union), spectating Burls: zoeokafor ALL IN with
2,400 in front, a 4,200 pot on the felt, and the centre clock reading
"Break: 1:16 Paused".

## What the rows say

Tournament `239ff085-536e-4cbf-a43e-969cfdea3c13`, Table 4
(`13351ab0-da12-4671-8ca8-49e06ef17710`). The :55 break was announced at
03:55:00 UTC. The hand on the felt was hand 56221104, dealt 03:54:58: seat 2
raised to 2,400, seat 5 (zoeokafor) moved all in for 12,150, seat 2 folded,
8,550 uncalled was returned, and the hand **settled at 03:55:25** with seat 5
winning the 6,600 pot. The next hand on that table was dealt at 04:05:12 with
seat 5 on 15,150. So the server did call the last hand and did wait for it to
settle; the screenshot is that settled hand's final action, still on screen
eight minutes later.

## The cause

`ServerTableEngineDealing`'s dealing loop parked the table at the pause gate
immediately after `await this.dealHand(...)` resolved - settlement had run, but
before the two steps that finish the hand for the people watching:

1. the hand-completion hold (winner shown, pot pushed with its total, cards
   mucked - the 2026-08-21 hand-completion law), and
2. the hand-free `broadcastCurrentState()` that clears the felt and lands the
   winner's new stack.

Both were deferred until the break ENDED. For the whole break every player and
spectator looked at bets in front, ALL IN badges, an unpushed pot and an
uncredited stack under a counting break clock - a break that looks like it
started in the middle of the hand. The park had been placed there on purpose so
`areAllTablesParked()` would go true a few seconds sooner; that saving is what
cost the felt its ending.

## The fix

The post-hand park now runs after the completion hold, the hand-free broadcast
and the arming of the rest, for every pause owner (hand-for-hand, the
synchronized tournament break, the maintenance break, weekly payout, final
table deal, terminal closeout, tournament moves). A table counts as parked only
once its hand is visibly over, so a tournament's five minutes start a few
seconds later (the length of the completion hold) and begin on a clean felt.
The top-of-loop gate, the before-deal gates and the server's
`waitForAllTablesParked` drain are unchanged: no new hand is dealt inside a
break and no break counts down while cards are in the air.

Pinned by `tests/a-break-never-starts-in-the-middle-of-a-hand.law.test.ts`
(registered in `docs/laws.d/`). This is an engine change: it activates through
the certified 04:00 America/Chicago daily release (CLAUDE.md section 13).
