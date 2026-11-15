# The cash buy-in never waits on the disk

2026-11-14. Reported by Dan with two screen recordings of Whytegold502 unable to
sit at Kings Club Classic PLO4 0.25/0.50.

## What the player saw

He tapped an open seat and the buy-in sheet opened already saying "Your 25 Chip
Buy-In For Seat 5 Needs Confirmation". Retry Original Buy-In showed Joining for
about two seconds and then "Unable To Confirm Your Buy-In. The Original Request
Is Kept For Recovery." It did this for 25 minutes.

## What was read

- `client_error_events` for his account: fifteen `The Buy-In Could Not Be Safely
Saved In Time` between 00:18 and 01:47 UTC, each followed by "Unable To Start
  Your Buy-In" or "Unable To Confirm Your Buy-In". He is the only account with
  that error in seven days.
- Edge logs: his phone (Android, Chrome 157) sent no `atomic_table_buyin` and no
  receipt read at all between 01:08 and 01:38 UTC. Every one of those refusals
  happened on the device. No chips moved and none are owed.
- `cash_rejoin_constraints`: he left at 01:08:11 UTC with 20.87 and was asking
  for 25. The rejoin floor was met and was never the reason.
- `table_seats`: a horse took seat 5 at 01:25:27 UTC. His two requests that did
  reach the server (01:38:14, 01:47:27) were for seat 5 and were correctly
  answered "That Seat Was Taken". He was seated in seat 6 at 01:48:08.

## The cause

`lockCashBuyInJournal` was the one money intent in the client that took its
cross-tab lock by opening an IndexedDB database and a read/write transaction,
under a two second deadline. Every other intent uses Web Locks, which is held in
memory. On his phone the IndexedDB round trip took longer than two seconds.

It was worse than a refusal. The lock ran the critical section, which writes the
request to web storage, and then waited for the transaction to commit with the
deadline still running. When the deadline fired in that gap the caller was told
the request was never saved, while a saved request for seat 5 sat in storage.
The next open of the sheet read it back and presented a request no server had
seen as an original buy-in in doubt, pinned to a seat that was later taken.

## The fix

- `lockCashBuyInJournalInBrowser` takes the Web Lock. The deadline covers only
  the wait for the lock and is cancelled the moment the critical section starts.
  IndexedDB remains the fallback where Web Locks is missing or refuses.
- The IndexedDB fallback answers with the critical section's result as soon as
  it has run. The gate transaction's commit cannot fail work already stored.
- When a request cannot be saved on the device, the player is told "This Device
  Could Not Save Your Buy-In Request. Nothing Was Sent. Please Try Again."
  instead of being told a purchase is in doubt.

No watcher, sweep or repair was added. Pinned in
`tests/unit/buyInIdempotencyKey.test.ts` and
`tests/unit/cashBuyInCallbackRecovery.test.ts`.

## Not changed

The rejoin floor refusal still reads "The Minimum Buy In For This Game Right Now
Is N". `tests/chip-continuity-is-house-law.law.test.ts` records the ruling that
this message is a number and not a reason, and the floor was not what stopped
this player.

During the rollout a tab still running the previous bundle locks through
IndexedDB while a new tab locks through Web Locks, so the two do not exclude
each other. The server still refuses a second active seat at one table.
