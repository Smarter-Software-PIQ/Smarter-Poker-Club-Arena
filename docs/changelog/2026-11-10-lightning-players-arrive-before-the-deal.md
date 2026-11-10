# Lightning: The New Table's Players Arrive Before Its Cards

2026-11-10. Dan, after the Check/Fold release: "the transition to the next game feels fake, you are just sitting there, and then all at once all the players appear and cards are dealt, instead of showing all players as they arrive."

## What the client could know

The Lightning matcher forms a hand in one step. Every player at the new table becomes known at the same instant, and while a player waits after a fold the engine sends only the idle shape (stage `waiting`, `players: []`, the player's own balance). No forming-table membership reaches a waiting player, because none exists: there is no earlier per-player arrival to show without inventing one.

What was wrong was the order. The opponents faded in over 160 ms (40 ms apart) while the first cards were already flying, so the new table and its deal landed as one event.

## What changed

- Engine (`server/src/lightning/LightningDealPresentation.ts`, `LightningHandHost.ts`): a new hand opens with an arrival window, `lightningArrivalMs(seats)`: one 120 ms step per opponent after the first plus the 180 ms arrival fade (660 ms at six seats), bounded so arrival plus deal stays inside the client's 2,600 ms deal-hold ceiling. The first turn clock (`dealShownAtMs`) waits for arrivals and deal together, so no player, horse or human, loses clock time to it. The engine sends the window as `lightning_arrival_ms` on `hand_started` and `arrival_ms` in the Lightning block.
- Client (`seatArrival.ts`, `lightningTransitionMotion.ts`, `TablePage.tsx`): with that window, the opponents arrive 120 ms apart inside it and the cards stay hidden until it ends, then deal. The window reaches the one deal scheduler through a ref consumed once, so a transport-gap recovery deal never waits a stale window and the animation law's scheduler pins are unchanged. Without the window (the engine serving today) nothing changes: the short ripple and an immediate deal.
- Tests: `server/src/lightning/LightningHandToHand.test.ts` (the window, the frame and snapshot fields, the first clock waiting for both, engine and client numbers agreeing), the Lightning block contract in `LightningHandHost.test.ts`, `tests/lightning/lightning-arrivals-before-deal.test.ts`, and the epoch pin in `lightning-table-change-is-one-motion.test.tsx` extended to the new argument.

## When it is visible

The client ships now and is inert until an engine sends the window. The engine part reaches production only through the daily 04:00 America/Chicago maintenance release; this change dispatched no release.
