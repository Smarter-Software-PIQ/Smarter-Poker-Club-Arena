# A seat-first board climbs one rung at a time, from every lane (2026-11-10)

Measured on `840429a3` after the Spin expiry fix installed (17:10Z): of the
first nine Spins to reach their first rung, six took one horse and a 30-60
minute second rung (windows 18:52-19:22Z), and three went from one horse to
three and dealt at 73-76 minutes (18:25:44, 18:27:21, 18:29:06Z, horse-only).

Two lanes act on a seat-first board when its window closes. The ladder's fast
lane (`fillPartialSeatFirstGame`) adds one horse and writes the next rung. The
discovery past-start walk, older than the ladder, fills every SNG and Spin to
`effective_max_players`. Whichever arrived first decided the board.

Fix: in `discoverTournaments`, a seat-first board with a seat sold, or whose
roster the pass could not read, is left to the fast lane; it also serves a
seated person after the 3-7 minute hold. A board with nothing sold keeps the
past-start path and its empty-event cancellation. The pinned
`if (needsPastStartTopUp) {` line is unchanged. Law:
`server/src/aSeatFirstBoardClimbsOneRungFromEveryLane.law.test.ts`.
