# The Head Rides The Table State

Dan, November 5: "Yea it may have went on their head but the number on the screen above their head didn't update." The ledger was right every time. The felt only learned a head through the separate realtime tournament channel, which dropped six times for one player in one evening.

The tournament manager now reads each event's heads from `tournament_players.current_bounty` (one coalesced, spaced read; `server/src/tournament/seatBountyHeads.ts`) after every knockout, every completed hand and every table it starts, and hands them to every table engine it owns. Each engine publishes the head as `players[].bounty` on its live broadcast, its resync and its idle and observer snapshots, so the number moves in the same update as the chips. A seat with no ledger head publishes no field, never a guess. The table page shows the engine head first and keeps its own ledger read as the fallback for an older engine.

Proof: `server/src/engine/TheHeadRidesTheTableState.test.ts` (a real engine and refresher: knockout, split pot, table move, no needless rebroadcast, coalesced reads, failed reads) and `tests/unit/aSeatHeadComesFromTheEngine.test.ts`.
