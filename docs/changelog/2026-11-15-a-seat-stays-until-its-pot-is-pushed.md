# A seat stays until its pot has been pushed (2026-11-15)

Dan: "THE PREVIOUS HAND PLAYED, DID NOT AWARD THE POT, OR SHIP IT TO THE
WINNING PLAYER ANIMATION... GET TO THE ROOT CAUSE AND FIX WHAT EVER PREVENTED
THE ANIMATIONS FROM AWARDING THE POT."

## What happened (read from production rows)

- Table `35d9812f` (Kings Club, Madness PLO5 1/2 + BB ante), hand 59517030.
  It went to a four-way showdown. TaliaK (seat 4) won 134.50 with fives full
  of jacks, and `hand_history.ended_at` is 16:57:05.295 UTC.
- `ca_seat_stack_exits` shows seat 4 leaving with 500.50 at 16:57:06.553
  UTC, **1.26 s after the hand ended**, while the four hands were still
  being read on the felt. The money was correct: 366.00 + 134.50 = 500.50.
- The next hand (59517216) started at 16:57:12.4. That 7.1 s gap is the
  normal four-way hold, so the engine's hold was not cut short.

## Root cause

`leaveTable` decides between the mid-hand path (accept the leave, keep the
seat until settlement) and the between-hands path (cash out now) by asking
whether `handController` is set. The controller is nulled at HAND_COMPLETE,
before the showdown read, the pot push and the muck have played. So a leave
during the completion hold took the between-hands path and emptied the chair
immediately. Every client lost the winner's seat before `pot_win`, so the
fan flew to the neutral point under the pot. The single-winner pot pill hit
`if (idx < 0) return;` and did not move at all.

This breaks two of Dan's rulings: the hand-completion law (2026-08-21: a hand
is not complete until the pot has been pushed to the winner) and the leave
ruling (2026-10-25: an avatar does not leave until its part is finished).

## The fix

Engine (`ServerTableEngineSeating`, `ServerTableEngineDealing`):
`completionPresentation` is opened at the deal for everyone dealt in and
closed right after `awaitHandCompletionDisplay`. A voluntary leave from a
participant inside that window is accepted and recorded as the durable
departure request (`requestSeatDeparture`), and the seat is marked
`leave_pending` and kept on the felt with no `seat_left`, no cash-out and no
grey-out. When the hold ends the seat is sat out of the next deal. The
next-hand `leave_pending` sweep in `prepareNextHand` then cashes it out
through the usual occupancy-keyed door. A player who was not dealt into that
hand still leaves at once. Horses and humans take the same door.

Settlement (`processLeavePending` gains an optional `holdSeat`, passed only
by `readCashHandDepartures`): end-of-hand settlement runs while the hand is
still being presented, and it used to cash out every `leave_pending` seat at
once. That included a mid-hand (for example all-in) leaver who then won, and
it could race a deferral made in the hold. It now leaves alone, untouched and
still pending, any seat that belongs to the presentation: a pot recipient
(main or side pot, high or low), a hand tabled at showdown, or a leave
deferred in the hold. The deferral is recorded before its durable write, so
there is no window in which settlement could see the new row first. A leaver
who folded out has already left the felt (`seat_left`) and is cashed out at
settlement as before. The held seats are cashed out by the next-hand sweep,
through the same occupancy-keyed cash-out with its durable receipt.
`fn_request_seat_departure` is idempotent per occupancy (ON CONFLICT), so a
repeated leave cannot queue twice.

Completion is the engine's own `awaitHandCompletionDisplay` timer. A client
acknowledgement never holds a seat, so a disconnected client cannot keep a
chair. The window is opened synchronously beside the deal (nothing is awaited
between the lease-authority check and `dealHand`), and the dealing loop's
error handler closes it if a hand dies.

Independent review follow-ups (same PR):

- The window opens at HAND_COMPLETE (`markHandCompletedForPresentation`),
  before settlement starts, not at the deal. A leave that lands before or
  during the deal takes its ordinary path, so a leaver is never dealt in.
- A held occupancy is recorded in `heldDepartures`. `executePendingSeatMoves`
  never moves it to another table (a must-move used to be able to carry a
  held leaver's stack to the Main with `leave_pending` cleared), and hold
  reconciliation still sees the full list.
- When the held seat is cashed out, `releaseDepartedSeats` emits `seat_left`
  and wakes the Cluster, as the between-hands branch did.
- The end of the hold sits a deferred leaver out only once the departure
  request is durable, so a failed write never leaves a player sat out while
  still seated.

Client (`TablePage`): `POT_WIN` resolves winners through `winnerSeatIdx`,
which is the live seat or else the last seat this client saw the player in.
The pot pill no longer returns silently. This covers clients while the old
engine is still serving.

## Delivery

- The client part is non-engine, so it publishes on merge.
- The engine part follows the daily 04:00-04:05 America/Chicago certified
  window (CLAUDE.md section 13).

## Pins

- `server/src/engine/aSeatStaysUntilItsPotIsPushed.law.test.ts` has human
  and horse twins. It fails with the fix switched off.
- `tests/animations-always-play.law.test.ts`: the pot ships to a winner who
  has already stood up.
