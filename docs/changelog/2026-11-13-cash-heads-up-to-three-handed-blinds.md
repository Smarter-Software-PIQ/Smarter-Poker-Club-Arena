# Cash, heads-up back to three-handed: nobody posts the small blind twice running (HU-EXE-002)

Date: 2026-11-13

## Defect

Heads-up the button is the small blind. When a third player was dealt into a
heads-up cash game, the button walked forward onto the player who had just
posted the big blind. That player skipped the small blind, and the previous
button posted the small blind twice running. Half a big blind moved from one
incumbent to the other at every such transition. Reproduced through the real
table engine on all 32 seat layouts of two incumbents and one newcomer (main
`4c351cfc`). Tournaments were already correct (`deadButton.ts`), and so was
three-handed down to heads-up (`headsUpButton.ts`).

Example, seats 1 and 2 heads-up, a newcomer at seat 3:

    before  hand 2  button 2  small blind 2  big blind 1
            hand 3  button 1  small blind 2  big blind 3   (seat 2 pays the small blind again)
    after   hand 3  button 2  small blind 1  big blind 3   (the button stays one hand)

## Fix

`ServerTableEngineBase.cashButtonStaysAfterHeadsUp`: for the one entry hand
after a heads-up hand the cash button stays where it was, so the previous big
blind posts the small blind and the big blind advances one seat. The deal and
the big-blind predictor (the wait-for-big-blind gate) use the same helper, so
they cannot disagree.

## Review changes (REVIEW-HU-EXE-002-3427141b, same day)

R1, two newcomers and Post Big Blind. `postBBToEnter` decided "is this seat the
small blind or the button" over every seated player, including other waiting
players who would not be dealt. With two newcomers between the heads-up button
and the big blind, one of whom tapped Post Big Blind, the second was dealt into
the small blind and an incumbent posted the big blind twice running (120 of 540
layouts on the first commit). The hole was older: three veterans plus two
newcomers showed it on main too. The gate now predicts the hand as it would be
dealt with the player admitted (everyone playing or already admitted to post,
plus this player). Two further holes of the same family, both present on main,
are closed with it: a post is held one hand when admitting it would push
another newcomer, already admitted and never dealt here, onto the small blind
or the button; and the wait-for-big-blind release does not let a waiter in on a
hand where that would do the same. Example, seats 1 and 2 heads-up, newcomers
at 3 and 4, both tap Post Big Blind:

    first commit  [1,2] button 2 sb 2 bb 1 | [1,2,4] button 2 sb 4 bb 1      (seat 4 enters on the small blind, seat 1 pays the big blind again)
    now           [1,2] button 2 sb 2 bb 1 | [1,2] button 1 sb 1 bb 2 | [1,2,3,4] button 1 sb 2 bb 3, seat 4 posts

The stay hand is not an orbit. The deal read a button that did not move as a
completed orbit: time banks refilled and the sit-out orbit counter ("removed
after the button passes them twice") advanced one hand early, on every such
entry hand. The stay hand no longer counts; the walk resumes from the same
seat on the next hand and wraps exactly when it would have.

Heads-up bomb pots (correcting the first version of this note, which said the
previous walk is used after one). A bomb hand records no blinds. Where the bomb
hand used the regular button, the rotation has already advanced past it and
the next regular hand walks on correctly or is one more heads-up hand, after
which the helper applies as usual. Where the table uses the separate bomb
button, the bomb hand rewinds the regular button, the helper still sees the
last regular heads-up hand and still fires on the entry hand. If the entry
hand itself is a bomb pot, the stay repeats on the first regular hand. All 720
probed bomb layouts (regular and separate bomb button) are clean. The stale comment in `BombPotScheduler.ts`
("the button can never stand still") is corrected; its behaviour was already
right (`from === to` is not a completed orbit).

## Known effects

- A newcomer seated between the button and the big blind waits one more
  heads-up hand (entry within two hands for one newcomer, three for two).
- Not changed, and the same before this work: when the heads-up big blind
  leaves or sits out and a new opponent arrives, the remaining player posts the
  small blind again, because the new opponent may only enter in the big blind;
  and three-handed down to heads-up when the big blind left repeats a small
  blind (the documented dead button, `headsUpButton.ts`). In that heads-up
  replacement case the button repeats on one seat and is still read as an
  orbit, as on main.
- A veteran who leaves after another player was admitted to post can still
  leave that player on the small blind for their first hand; the gate judges
  the table as it stands when the post is made and replayed.

The table rules text says: When More Players Are Dealt Into A Heads-Up Game,
The Button Stays Where It Was For That Hand, So The Previous Big Blind Posts
The Small Blind And Neither Of Them Posts The Same Blind Twice In A Row.

## Tests

`server/src/engine/CashHeadsUpToThreeHandedBlinds.law.test.ts`, through the real
`ServerTableEngine` (the dealing loop's release and replay steps are repeated by
hand in the test): 1,305 layouts.

| Group                                                                            | Layouts | main `a70600c196` | first commit `3427141bcd`                  | now  |
| -------------------------------------------------------------------------------- | ------- | ----------------- | ------------------------------------------ | ---- |
| Two incumbents, one newcomer                                                     | 32      | 32 fail           | 32 fail (orbit)                            | pass |
| Two incumbents, two newcomers: both wait, both post, lower posts, higher posts   | 720     | 720 fail          | 720 fail (120 blind order, the rest orbit) | pass |
| Heads-up straight to four-handed                                                 | 1       | fail              | fail                                       | pass |
| Three-handed to heads-up and back, returning player dealt in, waiting or posting | 540     | 460 fail          | 460 fail (orbit)                           | pass |
| One player left, a newcomer posts, a second sits down and posts or waits         | 12      | 12 fail           | 12 fail                                    | pass |

Every layout asserts: nobody posts the big blind twice running; the previous
big blind posts the small blind next whenever they are still dealt in; a
newcomer's first hand is never on the button or the small blind and is paid
for (the big blind or one live post); the button never sits on one seat three
hands running; the predictor equals the deal; the stay hand is not an orbit.
