# A Tournament Chair Is Shown The Moment It Is Taken

Owner ruling, 2026-11-18: "WHEN A PLAYER JOINS A TABLE IN BETWEEN THE BLINDS OR ANY OTHER REASON, THEIR STACK SHOULD SHOW, IT SHOULD NEVER SAY ZERO."

## Root cause

Every viewer draws the seats from the table engine's published roster, and the engine reads that roster only at the hand boundary. A tournament seat is never committed by that engine. The tournament manager moves a player in through `fn_ca_move_tournament_seat` (table balancing, a table break), or the database seats one (late registration, re-entry) or refills one (a rebuy) and leaves a manager wake. The only thing the manager told the destination engine was `wakeWaitingForPlayers()`, which ends a sleep and does nothing at a table with a hand in the air or parked on a break. The cash repair of 2026-11-17 (`SeatArrivalDisplay`) refuses tournament tables, because its signal comes from the buyer's browser and a tournament chair is never bought at the felt.

So until the destination table's next hand boundary:

- a player moved in by balancing or a table break, a late registrant and a re-entrant were not drawn at all;
- when the chair had belonged to a player who busted in the previous hand, it kept showing that player with a stack of 0;
- a player who busted and paid a rebuy during the next hand kept reading 0 in their own chair, because the roster had been read before the rebuy. Tournament tables do not pause for rebuys, so this lasted the rest of that hand.

On a table parked for a break the same staleness lasted the whole break.

## Fix

Engine source only, no schema change, no change to hand logic, money or the seat-move primitive.

- `server/src/tournament/committedSeatShow.ts` (new). `moved(tableId)` is called at the three places a certified move is acknowledged (direct, replayed, table-break arrival), beside the existing wake. `request()` is called from `GameServer.admitTournamentManagerWake` for a `late_registration`, `rebuy` or `reentry` wake. It makes one light read of the field's live seats and asks each owned table engine, without a read, whether its rows differ from what it shows. Only a table that answers yes reads its roster. Passes are coalesced: one in flight, at most one more queued.
- `ServerTableEngine.showCommittedTournamentSeats()` (new). Reads the table's committed seat rows through the same `loadSeatedPlayers` and `seatIdentity` path the roster uses, so names and anonymous-table scrubbing are identical. A row the adopted roster does not hold is published as a `seated` arrival with its real stack. A rostered player who is not in the hand, whose roster stack is zero and whose committed stack is positive, is published with the committed stack. A rostered player who is not in the hand and whose chair or identity a committed arrival now owns is no longer published. A hand participant is never replaced or restacked, and no stack is shown over the roster while a settlement is in flight.
- `SeatArrivalDisplay` gains `retainCommitted`, `holdsCommitted`, `showCommittedStack`, `committedStack` and `seatedArrivalClaims`. A committed arrival now also ends at once when a later committed read no longer holds it.
- `ServerTableEngine.noteSeatArrival` (the browser route) still answers `tournament_table`.
- Client: `mapEngineSnapshot` marks a `seated` arrival whose stack is not positive as pending, so it draws "..." and never 0. The table page already labels a `seated` arrival "Joining" on every table type.

Display only. `seatedPlayers` is still replaced only by `adoptSeatRoster` at the hand boundary, which supersedes every arrival and shown stack. Nothing written here is read by a deal, a pot, the button, blind positions, eliminations, bounty heads or any money path.

Cost: a certified move adds one roster read at its destination. A seat-committing wake adds one narrow read of the field's live seats plus one roster read at each table that changed.

## Regression lock

- `server/src/engine/aTournamentChairIsShownTheMomentItIsTaken.law.test.ts`: the arrival is published mid-hand on all four publication paths with the real stack and the hand state and roster are unchanged; it is superseded at the boundary; it ends when the row disappears and after two rosters without it; a replaced bust gives up its chair and a hand player never does; a same-table re-entry shows in its new chair; a rebuy shows over a roster zero but never over a hand player or during settlement; a cash table reads nothing; the browser route stays refused; requests are coalesced. Source pins hold the three `moved` call sites, the wake hook and the absence of any write in the show path.
- `server/src/tournament/committedSeatShow.test.ts`: one field read, only the changed table reads, an incomplete read is treated as unknown, coalescing, inactive manager, replaced engine, failed read.
- `tests/unit/aChairIsShownTheMomentItIsTaken.test.ts`: a tournament arrival maps with its stack for other players and the hero, and a `seated` arrival without chips maps as pending.

On the previous source the engine law file fails at `showCommittedTournamentSeats is not a function` in every arrival and rebuy case.

## Not changed

Cash tables keep their existing behaviour. The engine reaches production only through the certified 04:00 America/Chicago cutover.
