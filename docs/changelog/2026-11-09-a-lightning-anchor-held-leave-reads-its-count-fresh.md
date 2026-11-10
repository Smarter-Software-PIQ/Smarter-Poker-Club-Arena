# A Lightning anchor's held leave reads its count fresh (2026-11-09)

Engine half of the Lightning blind-off fix (bug report BUG-7C1347FF; database half: migration `20261109224717`).

## Cause

`releaseLeavesHeldByClock` decided from the hand-count mirror (`ChipContinuity`). The mirror is refreshed by this table's own settlements and by presence changes. A Lightning anchor deals no hands of its own (the pool's settlement trigger counts them) and a held leave is always reported active, so neither refresh ever happened: after the pool had played the owed hands the mirror still read "hands owed" and the seat was never cashed out unless the player came back and pressed Leave, or the engine restarted.

## Fix

On a Lightning anchor the release reads every held seat's session fresh (`chipContinuity.evaluate`) before it decides, the same read POST /leave already makes for an anchor. One bounded call per presence pass, only while a leave is held. A failed read keeps the old row; the seat is asked again on the next pass. The cash-out itself is unchanged: the voluntary door, once, for the held occupancy.

## Proof

- `server/src/engine/ChipContinuityLeave.behaviour.test.ts`: Lightning anchor, human and horse. The database completes the count with nobody connected; the release cashes out through the voluntary door exactly once. Fails without the change (the door is never asked).
- `server/src/lightning/LightningHandHost.test.ts`: a blinded-off seat with no socket is folded on its turn at once, never by the clock (passes against the unchanged host: the host needed no change).
- `server/src/engine/ChipContinuity.law.test.ts`: the fresh read stays ahead of the decision.

## Delivery

Engine source: staged and certified through the existing release route; activation belongs to the engine release owner. Safe with or without the database migration; the complete behavior needs both.
