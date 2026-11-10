# A rebuy is taking a seat again (2026-11-10)

## Report

MichaelJordan (Kings Club), Monday Night Turbo, to his agent: after a rebuy he
"could not see my cards", his stack "dwindled", signing out and back in brought
the cards back, and he asked for two rebuys to be credited.

## What the rows say

Tournament `c4a7ba9b-482a-49b0-85ee-0d65303898c6`, player
`c657675c-f970-4c42-8f19-ba4d8096be67`, times UTC on 2026-11-10.

- Purchases (`tournament_participant_funding_receipts`, matched one for one by
  `chip_ledger`): entry 20 at 01:50:41, rebuy 20 at 02:19:28, rebuy 20 at
  02:23:29, add-on 20 at 02:32:36. 80 chips in all; `tournament_players.rebuys`
  is 2. Finished 31st at 03:09:38, no prize.
- After the first rebuy (stack 5,000, same table, same seat 7) he was dealt
  into three hands and each ended in a fold with `origin: forced` after the
  full clock: 02:20:08 (35.6 s), 02:20:53 (35.7 s) and 02:21:42 (17.2 s). The
  third was his big blind holding A3 of diamonds; it cost 1,600 of the 5,000.
  His next action, 37 s into the following hand, was his own all-in for 3,400,
  which lost.
- After the second rebuy every action is `player` or `pre_action`. The record
  does not show the fault a second time.
- `client_error_events`: his page ran build `b64b4a00` at 02:03 and `51a3451e`
  by 02:31, so the page was reloaded in between, as he says. Nothing was
  reported by the page in the affected minutes: a seated player with no cards
  was not an error to it.

## Cause (client, `src/pages/TablePage.tsx`)

A tournament bust vacates the physical seat. The page answers that through
`applySeatRemoved`, from either of two callers: the engine's `seat_left` with
reason `busted_awaiting_rebuy_decision`, or the ten-second `table_seats` read
that no longer finds the player's row. `applySeatRemoved` sets
`leftSeatPendingRef`, a latch its own comment says is "cleared only by taking a
seat again".

The first buy-in receipt and the cash buy-in receipt clear it. The tournament
rebuy receipt (`onConfirmRebuy`) restored `heroSeat` and did not. While the
latch is set the page strips the player's own row from every snapshot, a resync
zeroes the seat, and, since #10215 on 2026-11-09, the hole-card door drops every
delivery ("a player who has asked to leave is shown no further cards"). The
build he was on contained #10215. A reload starts the latch clear, which is why
signing in again brought the cards back.

His first rebuy took 12 s, longer than the ten-second seat read, so that read
ran while he had no seat. His second took 8 s.

## Fix

The rebuy receipt clears the latch, like every other paid seat. It also stamps
`seatAcquiredAtRef`, so a seat read that began before the purchase and answers
after it falls inside the existing 15 s fresh-seat window and cannot set the
latch again, and it resets `bootNoticeShownRef` as the first buy-in does. The
receipt already asks the engine for a snapshot, which re-pushes the hand's hole
cards.

Client only. No engine, schema, chip or seat change.

## Pinned

`tests/a-rebuy-is-taking-a-seat-again.law.test.ts` runs the page's own
`applySeatRemoved`, rebuy receipt handler and hole-card door in the order of
that hand: bust, rebuy, deal. Four of its six cases fail on the page before
this change.

## Not done here

No chips were moved. The purchases and the affected hands are recorded above
for the owner's decision on a credit.
