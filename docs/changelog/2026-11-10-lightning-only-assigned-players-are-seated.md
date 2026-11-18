# Lightning: Only Assigned Players Are Seated

Dan, 2026-11-10: "display only authoritative assignments and handle reassignment, cancellation and reconnect without stale players or card leakage."

#10395 drew one anonymous arriving seat per player the matcher's last pass left waiting (USER_EVENT `lightning_pool_waiting`). That count is not an assignment: the players it counts may be formed into another table and never sit at the hero's. Showing them as seats was misleading, so this change removes it from the client.

## What changed (client only)

- `TablePage` no longer computes or passes arriving seats, and `SeatSlot` no longer has an `arriving` chair or its CSS. A Lightning room's open chair draws nothing until a formed hand's snapshot seats a real player there.
- `src/lightning/lightningPoolArrivals.ts` and its store are deleted. `noteLightningUserEvent` consumes a `lightning_pool_waiting` frame and ignores it, so the engine frame (already in the engine candidate f970a6d4) shows nothing: no seat and no text.
- The only arrival shown is #10370's: the formed hand's real players arrive inside the engine's arrival window, then the deal.

## Tests

`tests/lightning/lightning-only-assigned-players-are-seated.test.tsx`: the frame is consumed and draws nothing, nothing in the table reads it, and a Lightning room's open chair draws nothing. The #10395 seat tests are removed with the feature.

## Delivery

PR #10410, squash `1c923d34059f`, published by run 42923399037. Both `ca-static.smarter.poker/build-info.json` and `smarter.poker/hub/club-arena/build-info.json` served `1c923d34` at 2026-11-10 23:3x UTC, before the owner-ordered engine release (candidate f970a6d4, which sends the frame) could seal.

## Verification: only the authoritative table is shown

Read from the engine and client source, and pinned by tests:

- **Nothing before formation.** No room hears anything about a forming table until `begin_dealing`, the bind, the lease, the participants check and the rules read have all passed. The participants' rooms are only learned after the participants check.
- **Cancelled or rolled-back formation shows nobody.** A refusal at `begin_dealing` reaches no room at all. A refusal after the participants are read (rules or variant) sends each room only the idle shape (`stage: waiting`, `players: []`, `hand_id: null`).
- **Voided after the deal, inside the arrival window.** `abandon()` sends every room the idle shape and the host publishes nothing after it. On the client, an empty roster clears every arrival in flight (`nextSeatArrivals`).
- **Reassignment.** A player can only be at a table the matcher formed. A different table brings only its own players: the voided table's players never arrive on the next. The roster ledger is per room, so another room never inherits a player.
- **Reconnect / RESYNC.** A RESYNC of the same table replays no arrival and keeps those already in flight. A RESYNC of a voided hand re-sends no hole card (`rePushHoleCards` refuses a terminal hand).
- **Private data.** Hole cards travel only through `sendToUser`, to their owner, in the owner's room. No published seat carries a face before showdown: every published seat has `cards` and it is empty. On the client, a Lightning room's seat cards stay hidden (`seat__cards--deal-pending`, opacity 0) through the arrival window and the button beat, so the hero's own cards appear with the deal and not before it. They are present in the DOM during that hold, but they are the hero's own cards in the hero's own room. The existing law `ALightningHandsCardsAndMoneyStayWithTheirOwners` already pins that no room sees another player's untabled card.

Tests: `server/src/lightning/LightningOnlyAssignedPlayersAreSeen.test.ts` (4) and the ledger cases in `tests/lightning/lightning-only-assigned-players-are-seated.test.tsx` (7 in all).

## Engine follow-up

The same follow-up removes #10395's `lightning_pool_waiting` broadcast from the engine (worker report, supervisor dependency, GameServer wiring, registry frame and its test). It reaches production only in the 04:00 America/Chicago window, through the release owner's selected candidate. The client keeps consuming and ignoring the frame, because the engine candidate f970a6d4 sends it until an engine without it is serving.

## Still to observe live

After the engine with the arrival window (#10370) is serving, a real Lightning join or table change needs to be read from its frames or database rows, to show the assignment preceded the visible seats.
