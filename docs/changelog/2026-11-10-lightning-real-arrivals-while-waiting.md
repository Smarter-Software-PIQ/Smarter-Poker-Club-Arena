# Lightning: Real Arrivals While Waiting

Dan, 2026-11-10: "the transition to the next game feels fake, you are just sitting there, and then all at once all the players appear and cards are dealt, instead of showing all players as they arrive." On 15:31 Chicago he authorized building the follow-ups in full.

## What the matcher can know

`fn_lightning_match_and_form` forms a table in one step. Until a pass forms it, neither the engine nor the database knows who will sit at a waiting player's next table: the group is chosen from whoever is legal at that pass, and the choice depends on everyone freed in the meantime. Naming players before formation would sometimes name a player who then sits somewhere else, so this change never does.

What each forming pass does know is how many legal players it left waiting for the next table: its own `legal_count` less every player it placed in a hand. That is the database's count, read from the answer the worker already receives. No database function was changed.

## What changed

- **Engine** (`LightningClusterWorker`, `LightningSupervisor`, `LightningRegistry`, `GameServer`): after a forming pass that answered, the worker reports the waiting count (`lightningPoolWaitingAfterPass`). Every waiting room of the Cluster (a socket open, no hand) is told it privately when it changes, as USER_EVENT `lightning_pool_waiting` `{pool_session_id, cluster_id, waiting, at}`. A room dealt into a hand is told afresh on its next wait, and RESYNC repeats the last count. The frame carries a number only: no player id, name or chips.
- **Client** (`src/lightning/lightningPoolArrivals.ts`, `TablePage`, `SeatSlot`): while the hero waits, each OTHER waiting player is drawn as an anonymous arriving chair, clockwise from the hero, fading in at the player's Animation Speed with a slow breath. It has no name, avatar or stack, because it is a real player whose seat is not known yet. A count held when this wait began described the previous wait and is never used again. When the table forms, the real players take the chairs through the hand's arrival window (#10370), then the deal.
- **Inert until the engine sends it.** The client draws nothing new until it receives the frame, so publishing it before the engine changes nothing.

## Activation

The engine part reaches production only through the daily 04:00 America/Chicago release. Nothing was dispatched.

## Tests

- `server/src/lightning/LightningPoolWaiting.test.ts`: the count's arithmetic, a pass that failed reports nothing, a throwing listener never takes a pass down, only waiting rooms of that Cluster are told and only on change, a room in a hand hears nothing, and RESYNC repeats the count.
- `tests/lightning/lightning-real-arrivals-while-waiting.test.tsx`: the frame reaches the room's store, which chairs arrive (clockwise, capped, skipping taken seats), nothing for a stale count, a hand on the felt or a sit out, and the chair draws no name, image or stack.
