# Lightning: Only Assigned Players Are Seated

Dan, 2026-11-10: "display only authoritative assignments and handle reassignment, cancellation and reconnect without stale players or card leakage."

#10395 drew one anonymous arriving seat per player the matcher's last pass left waiting (USER_EVENT `lightning_pool_waiting`). That count is not an assignment: the players it counts may be formed into another table and never sit at the hero's. Showing them as seats was misleading, so this change removes it from the client.

## What changed (client only)

- `TablePage` no longer computes or passes arriving seats, and `SeatSlot` no longer has an `arriving` chair or its CSS. A Lightning room's open chair draws nothing until a formed hand's snapshot seats a real player there.
- `src/lightning/lightningPoolArrivals.ts` and its store are deleted. `noteLightningUserEvent` consumes a `lightning_pool_waiting` frame and ignores it, so the engine frame (already in the engine candidate f970a6d4) shows nothing: no seat and no text.
- The only arrival shown is #10370's: the formed hand's real players arrive inside the engine's arrival window, then the deal.

## Tests

`tests/lightning/lightning-only-assigned-players-are-seated.test.tsx`: the frame is consumed and draws nothing, nothing in the table reads it, and a Lightning room's open chair draws nothing. The #10395 seat tests are removed with the feature.

## Follow-up

The engine still sends the count (#10395, engine candidate f970a6d4). It is harmless after this change and will be removed from the engine in a follow-up through the normal daily window. Cancellation, reassignment, reconnect and private-data verification follow in this file.
