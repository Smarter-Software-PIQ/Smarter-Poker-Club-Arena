# An entry post is one obligation (2026-11-15)

Player report, Burls, relayed by Dan at 21:26 Chicago on 2026-11-15: "How do we
lose 5.50 the pre flop raise was 4. I came in as a new guy I was in for 1 had
to call 3." Hand 59634000, NLH 0.50/1 Classic. This file is the task's
checkpoint, its evidence ledger and its record.

Pull requests: the engine correction "a new player's entry post is billed
once" (branch `fix/entry-post-never-double-billed`) and this restitution
(branch `restitution/entry-post-overcharges`, migration
`20261116041434_the_house_returns_new_players_the_entry_charges_they_did_not`).

## The charging contract

Read from the owner rulings recorded in the engine source and `docs/LAWS.md`.

| Seat state on a cash table                                    | Owes on its first dealt hand                      | Live / dead      | Authority                                                               |
| ------------------------------------------------------------- | ------------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| New buy-in, waits for the big blind                           | Its own big blind when the blind reaches the seat | Live             | Dan 2026-08-26, `EntryPostingAndButton.test.ts`                         |
| New buy-in, Post Big Blind                                    | One big blind                                     | Live, no dead SB | Dan 2026-08-26, `postBBToEnter` ("LIVE BIG BLIND ONLY")                 |
| New buy-in in the seat the small blind or button is reaching  | Nothing yet: held until both pass                 |                  | Dan 2026-08-29, `postBBWhenClear`                                       |
| Played here, sat out, comes back                              | Dead small blind + live big blind                 | SB dead, BB live | Bible V8 4.2, `returningFromSitout`                                     |
| Moved by must-move, break, balance or seat change             | Nothing to enter                                  |                  | Dan 2026-11-15, LAWS "A moved player never posts to enter"              |
| Moved before 2026-11-15 17:02 UTC                             | One big blind                                     | Live             | Dan 2026-09-05 (superseded)                                             |
| Short stack                                                   | The same charge, capped at the stack, all in      | Dead SB first    | `HandController.postBlinds`                                             |
| Tournament seat                                               | Neither charge                                    |                  | Owner correction 2026-10-27                                             |
| Lightning hand                                                | One big blind on a new player's first hand        | Live             | `LightningHandHost` (`bbOnlyPosts` only; no dead-blind list exists)     |

## What the engine did

Two requests reach the engine for a seat: Post Big Blind (`/post-bb`) and I'm
Back (`/sitout` false). I'm Back marked every cash seat as returning from
sit-out, including a seat that had never been dealt a hand.

- Post Big Blind and I'm Back on one arrival, in either order: the seat was in
  `postingBBToEnter` and `returningFromSitout` at once. `HandController`
  billed the dead-blind list (dead SB, live BB) and then the post-to-enter
  list (a second BB) and overwrote the seat's bet instead of adding to it.
  2.5 BB left the stack and 1 BB counted toward the call.
- I'm Back before the dealing loop registered the arrival: the loop does not
  register a seat already marked returning, so the wait for the big blind was
  skipped and the seat was dealt in for a dead SB plus a live BB.

Proven: the overlapping charge, read from each settled hand. Not proven: which
buttons each player tapped (the engine does not record requests) and which
change first made the two requests collide on 2026-11-07. Both paths are
closed whatever the trigger was.

## The correction

- `ServerTableEngineSeating.owesMissedBlindsOnReturn`: I'm Back marks a seat
  returning only if it has been dealt a hand here (`dealtInUserIds`, the
  oracle the sit-out and button rules already use), and never while it is
  waiting for, queued for, agreed to or posting its entry big blind. A moved
  arrival keeps the treatment it had.
- `ServerTableEngineDealing.entryChargeSeats`: one place decides each seat's
  entry charge for a deal; a seat is on one list or neither, and the entry
  post wins.
- `HandController.postBlinds`: a seat is billed the first entry charge that
  reaches it and no other, whichever host built the lists, a repeated entry
  included.
- `AnEntryPostIsOneObligation.test.ts`: 17 tests driving the real request
  handlers and the real hand in every order. Against the old behaviour 11
  fail (Burls: 197.50 left of 200 instead of 199; fresco: 13.58 instead of
  13.93) and the 6 that pin legitimate missed-blind returns, moved arrivals
  and tournaments pass both before and after.

## Burls, hand 59634000

Seat 4, NLH 0.50/1 Classic (main table), Midway Union. Bought in for 200.00 at
03:11:19 UTC (occupancy 460ef650, no seat move; he had just left the Sunday
Night Bounty). Hand 59633797 was dealt without him at 03:11:31. Hand 59634000,
03:12:22, button seat 5, was the first hand the occupancy was dealt.

| Step                                   | Stack  | Counted as his bet | Dead |
| -------------------------------------- | ------ | ------------------ | ---- |
| Before the hand                        | 200.00 |                    |      |
| Dead small blind (missed-blind charge) | 199.50 |                    | 0.50 |
| Live big blind (missed-blind charge)   | 198.50 | 1.00               |      |
| Second big blind (entry post)          | 197.50 | 1.00 (overwritten) |      |
| Calls the raise to 4.00                | 194.50 | 4.00               |      |

He folded the turn and lost 5.50. A new seat owes one big blind: 1.00 of the
2.50 was valid. The dead small blind was not valid: the seat was empty when
the blinds passed it, and a seat that has never been dealt a hand has missed
nothing. The second big blind was not valid. Restitution is 1.50.

The first report in chat proposed 1.00. That figure compared him with the
engine's most common entry post that day (big blind plus dead small blind),
which turned out to be players genuinely returning from sit-out, not new
seats. Measured against the rule, it is 1.50.

The pot: his extra big blind counted toward his total, so 1.00 of the
winner's uncalled 22.00 turn bet stayed in the pot (21.00 returned). Pot
22.50, rake 2.25, jackpot drop 0.25, 20.00 to the winner. All of it stands.

## fresco, hand 59632824

Seat 4, NLH 0.10/0.25 Classic Feeder. Bought in for 14.18 at 03:06:26 UTC
(occupancy a379d40b, no seat move). First hand dealt 03:07:48. Billed 0.50
live and 0.10 dead; owed 0.25. He folded the turn. Restitution 0.35 (the first
report said 0.25).

## The 53 entry posts of 2026-11-15 03:40 to 2026-11-16 03:40 UTC

Every cash hand in the window was read. Each post was classified by the buy-in
receipt or completed seat move that opened the occupancy, the hands the seat
was dealt before it, and the hands it sat out.

| Class                                                                 | Posts | Charge                 | Verdict                                         |
| --------------------------------------------------------------------- | ----- | ---------------------- | ----------------------------------------------- |
| New buy-in, first dealt hand, one live big blind                      | 6     | 1 BB                   | Correct                                         |
| Moved player, first hand at the new table, before the 17:02 UTC ruling | 4     | 1 BB                   | Correct under the 2026-09-05 rule then in force |
| Played here (7 to 690 hands), sat out 1 to 10 hands, came back        | 41    | Dead SB + live BB      | Missed-blind return as the engine implements it |
| New buy-in, first dealt hand, both charges                            | 2     | Dead SB + 2 BB         | Overcharged (Burls, fresco)                     |

The 41 returns are returns by evidence: each seat had been dealt at that table
in the same occupancy and then missed at least one hand. The engine bills a
return the dead small blind and big blind without checking that a blind
actually passed the seat while it was out; that is the existing rule and is
not changed here.

## The historical audit

| Population                                                                              | Range (UTC)                      | Read    | Flagged |
| --------------------------------------------------------------------------------------- | -------------------------------- | ------- | ------- |
| Every cash buy-in receipt, followed to the first retained hand its occupancy was dealt   | 2026-09-17 to 2026-11-16 04:00   | 254,129 receipts, 37,889 first hands | 24 |
| Every completed seat move, followed the same way                                         | 2026-11-01 to 2026-11-16 04:00   | 11,857 moves | 0 |
| Every cash hand, all posts (the table above)                                             | 2026-11-15 03:40 to 11-16 03:40  | 53 posts | the same 2 |

- First affected hand: 56509493, 2026-11-07 19:01 UTC. Before it, 904 new
  seats posted to enter and every one paid exactly one big blind.
- Last affected hand: 59634000. The engine correction is not serving yet, so
  further cases can occur until it is; the same query re-run after the cutover
  closes the range.
- All 24 are humans on Midway Union Classic and Madness cash tables. Human
  coverage from 2026-11-06 is complete: 293 human buy-ins, 199 dealt a
  retained hand, and for the other 94 the table's own commit record shows the
  seat was never dealt (86 tables dealt nothing in the window, 8 dealt without
  them).
- Not readable: hands no longer in `hand_history`. It holds about 6.9 million
  rows; older horse-only hands are not retained, so 216,240 of the buy-in
  receipts have no first hand to read (mostly horses before 2026-11-06). No
  horse hand that was read carries either charge shape. Before 2026-09-17
  there are no buy-in receipts; `hand_history` holds about 1,000 cash hands
  from that period and they were not classified.

## Per-case ledger

"Won" means the player won the whole pot: the second big blind came back as
uncalled (the hand's `return` exceeds the bet it refunds by one big blind) and
the dead small blind came back in the pot, less the rake taken on it.

| Hand     | UTC         | Player       | Table                        | BB   | Billed live + dead | Owed | Result | Restitution |
| -------- | ----------- | ------------ | ---------------------------- | ---- | ------------------ | ---- | ------ | ----------- |
| 56509493 | 11-07 19:01 | CMA          | PLO4 0.50/1 Classic Feeder   | 1.00 | 1.00 + 0.50        | 1.00 | lost   | 0.50        |
| 56615162 | 11-07 22:50 | Rooster      | PLO6 1/2 Classic Feeder      | 2.00 | 4.00 + 1.00        | 2.00 | lost   | 3.00        |
| 57126786 | 11-08 14:17 | Luvtasuck    | NLH 0.25/0.50 Classic Feeder | 0.50 | 1.00 + 0.25        | 0.50 | lost   | 0.75        |
| 57279189 | 11-08 17:12 | Danimal      | NLH 0.25/0.50 Classic Feeder | 0.50 | 1.00 + 0.25        | 0.50 | lost   | 0.75        |
| 57630371 | 11-09 00:35 | Bluffinbreed | NLH 0.50/1 Classic Feeder    | 1.00 | 2.00 + 0.50        | 1.00 | won    | 0.05        |
| 58203391 | 11-09 22:21 | Donkey       | PLO5 0.10/0.25 Classic       | 0.25 | 0.50 + 0.10        | 0.25 | lost   | 0.35        |
| 58222391 | 11-09 23:34 | MichaelJordan | NLH 0.25/0.50 Classic Feeder | 0.50 | 1.00 + 0.25       | 0.50 | won, no flop, no rake | 0.00 |
| 58246229 | 11-10 01:28 | WooWoo       | PLO5 1/2 Madness             | 2.00 | 4.00 + 1.00        | 2.00 | won, rake at cap | 0.00 |
| 58306954 | 11-10 05:44 | Burls        | NLH 1/2 Classic              | 2.00 | 4.00 + 1.00        | 2.00 | lost   | 3.00        |
| 58316803 | 11-10 08:22 | Probyourmom  | NLH 1/2 Classic              | 2.00 | 4.00 + 1.00        | 2.00 | won    | 0.10        |
| 58516060 | 11-11 07:40 | Probyourmom  | NLH 1/2 Classic Feeder       | 2.00 | 4.00 + 1.00        | 2.00 | lost   | 3.00        |
| 58692649 | 11-12 01:32 | BarryWhite   | PLO6 0.10/0.25 Classic Feeder | 0.25 | 0.50 + 0.10       | 0.25 | lost   | 0.35        |
| 58710591 | 11-12 02:58 | Twin2983     | NLH 1/2 Classic Feeder       | 2.00 | 4.00 + 1.00        | 2.00 | won, rake at cap | 0.00 |
| 58711319 | 11-12 03:02 | FishyFish    | PLO6 1/2 Classic             | 2.00 | 4.00 + 1.00        | 2.00 | lost   | 3.00        |
| 58808950 | 11-12 19:19 | Burls        | NLH 1/2 Classic Feeder       | 2.00 | 4.00 + 1.00        | 2.00 | lost   | 3.00        |
| 58879713 | 11-13 01:43 | BarryWhite   | PLO4 0.25/0.50 Classic Feeder | 0.50 | 1.00 + 0.25       | 0.50 | won, rake at cap | 0.00 |
| 58909662 | 11-13 03:42 | BarryWhite   | PLO6 0.10/0.25 Classic Feeder | 0.25 | 0.50 + 0.10       | 0.25 | lost   | 0.35        |
| 58920420 | 11-13 04:31 | nickw        | PLO4 1/2 Classic Feeder      | 2.00 | 4.00 + 1.00        | 2.00 | lost   | 3.00        |
| 59247360 | 11-14 05:04 | Bud33        | PLO5 1/2 Madness Feeder      | 2.00 | 4.00 + 1.00        | 2.00 | won, rake at cap | 0.00 |
| 59253146 | 11-14 05:40 | twin2983     | NLH 0.50/1 Classic Feeder    | 1.00 | 2.00 + 0.50        | 1.00 | lost   | 1.50        |
| 59390496 | 11-15 00:22 | Whytegold502 | PLO4 0.25/0.50 Classic Feeder | 0.50 | 1.00 + 0.25       | 0.50 | won    | 0.02        |
| 59412541 | 11-15 02:20 | Svge0217     | NLH 0.10/0.25 Classic Feeder | 0.25 | 0.50 + 0.10        | 0.25 | lost   | 0.35        |
| 59632824 | 11-16 03:07 | fresco       | NLH 0.10/0.25 Classic Feeder | 0.25 | 0.50 + 0.10        | 0.25 | lost   | 0.35        |
| 59634000 | 11-16 03:12 | Burls        | NLH 0.50/1 Classic           | 1.00 | 2.00 + 0.50        | 1.00 | lost   | 1.50        |

24 hands, 17 players, 23 duplicate big blinds with an invalid dead small blind
and 1 invalid dead small blind alone. 19 payments to 14 players, 24.92 chips.
Burls: 7.50 over three hands.

## The restitution

Migration `20261116041434`, the door `20261109212039` (Mongo's blind) used:
per case a 10.9 manual adjustment, a declared Midway Union bank debit,
`fn_credit_and_log` under the key
`entry-post-overcharge-make-good:<hand id>:<user id>`, one `chip_ledger` leg,
the adjustment settled and a resolved `financial_alerts` row. The file
re-reads every hand before it pays: the forced posts, that the seat is a
human's fresh buy-in with no move in its funding lineage dealt its first hand,
that a "lost" case won and was returned nothing, that a "won" case scooped a
flop-dealt pot with uncapped rake, and that the amount equals what those rows
give. It refuses to run if any case already has a key, a ledger leg or an
adjustment, asserts 19 cases and 24.92 and a bank that moved by exactly that,
and compares every hand row before and after. No pot, rake, jackpot drop,
winner or hand record changes.

Proved against production on 2026-11-16 in one self-aborting call (CLAUDE.md
11.5): `PROBE OK (rolled back): 19 cases, 24.92 paid, bank 146706041.98 ->
146706017.06`. Read back afterwards: no adjustment, no ledger leg, bank
146706041.98.
