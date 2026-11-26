# A Draining Horse Is Never Folded Out Of A Live Hand (2026-11-25)

Follow-up to `2026-11-24-a-horse-only-extra-table-yields-to-an-owed-main.md` (#12011).

## What Was Wrong

The variety drain stands one Horse a cycle up from a Horse-only extra table so the slot can go to a game with no table. It used `engine.leaveTable`, the door every departure uses, and that door folds a seat that still holds cards at once (owner 2026-10-25: a player's leave means now). That is right for a player's own choice. A Horse the fleet releases did not choose to give up its hand, so a Horse holding a strong hand could be folded only to free a slot a minute sooner.

## The Change

**Files:** `server/src/engine/ServerTableEngineBase.ts`, `server/src/services/HorseSessionRotator.ts`
**What changed:** the engine answers `liveInHand(userId)`: the seat holds unfolded cards in the hand being played, read exactly as `leaveTable` reads it (the hand controller's state; none between hands). The drain takes a Horse that has folded or is between hands. If every Horse at the table is in the hand, nobody leaves that cycle and the drain asks again 90 seconds later. Ordinary departures (end of a shift, a person's leave) are unchanged.

## Why It Broke

The drain reused the departure door without asking the one question that door answers differently for a chosen leave and an imposed one.

## Hardening

`server/src/services/anExtraTableYieldsToAnOwedMain.law.test.ts`: a live Horse is never the one released (the folded one goes); a table where every Horse is in the hand releases nobody; the engine's `liveInHand` reads the hand controller and `is_folded`, and the drain asks it before `leaveTable`. Reverting the rotator change fails the first case.
