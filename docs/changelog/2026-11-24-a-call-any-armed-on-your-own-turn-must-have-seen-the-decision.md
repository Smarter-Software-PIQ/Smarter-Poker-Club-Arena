# A Call Any Armed On Your Own Turn Must Have Seen The Decision (2026-11-24)

Owner report (Dan, relayed from a player): CoachTim68 entered a 5.00 tournament,
was seated, saw "Welcome Back", was dealt 5-3 offsuit and folded. Then he was
told he was out and offered a rebuy.

Record: Breakfast Turbo `425c3668-b301-4b07-9147-a940226a18a2`, hand
`67a4924c-baaf-4e9d-9f1a-638c2430b584`, table `22b4abe1`, 400/800 with a big
blind ante. He registered at 15:44:50 UTC with 5,000. His turn began at
15:45:12.2, when seat 1 (a Horse) shoved 9,450. `hand_history.actions` records
his seat as `all_in 5000`, origin `pre_action`, at 15:45:31.5. Client errors
from his phone (Android, build `2bc81daf`): "Table Display Fell Behind The
Engine" before the hand; later `STALE_ACTION` on `/action` (his Fold, refused
because his stack was already in) and `ACTION_NOT_ACCEPTED`.

## Cause

`ServerTableEngineTurns.setPreAction` runs an arm that arrives while it is
already the player's turn as an immediate action (the "LIVE E2E FIX
2026-08-15" branch). `/action` refuses any decision whose `actionContext` is
not the engine's current one. This door asked for nothing. A browser whose
display is behind does not know the turn is the hero's, so it still renders the
PreActionBar at a price that no longer exists. A Call Any armed there became an
immediate call of a shove the player never saw, and Call Any is uncapped, so the
whole stack went in. `LightningHandHost.setPreAction` has the same own-turn
branch.

The bar also arms Call Any from a swipe. A rightward drag with nothing selected
landed on the right edge, which is Call Any, so a finger that slid while
pressing Fold on a phone could arm it. The record cannot show which tap he made.
Either path ended in the same unguarded own-turn execution.

## Why and how it broke

The 2026-08-15 change was right on its own: an arm landing as the turn begins
must not wait until the next turn. The `actionContext` contract was added to
`/action` later (STALE_ACTION, retained decisions), and nothing revisited the
pre-action door, which is the other way a decision reaches the engine. The
swipe (Phase 2 T1-08) was added when Call Any was one of several equal
toggles. Its "start at the right edge" default was never weighed against Call
Any being the one choice that can commit a whole stack.

## Fix

- `server/src/engine/PreActionOnOwnTurn.ts` is the single rule. On the player's
  own turn, `auto_call` and `auto_call_any` act only when the arm names the
  current `action_context`. Otherwise nothing is armed or played, and the reply
  is `STALE_ACTION` with `/action`'s sentence. Fold-family and Check arms never
  commit chips, so they still act immediately without a context, and older
  pages keep working for those.
- Applied in `ServerTableEngineTurns.setPreAction` and
  `LightningHandHost.setPreAction`. `POST /preaction` carries `actionContext`
  (`handlers/preaction.ts`, `LightningSeatProxy`).
- Client: `TablePage` snapshots `tableState.actionContext` when the player
  presses a pre-action (`preActionSeenContextRef`, beside the price snapshot).
  `preActionSync` sends it with Call and Call Any, and `GameServerAPI.setPreAction`
  puts it in the body. A `STALE_ACTION` refusal disarms the bar and toasts "The
  Action Changed. Review The Table And Act."
- `PreActionBar`: a swipe never moves to or from Call Any. Call Any arms only
  from a tap on its own button.

## Hardening and regression tests

- `server/src/engine/AnArmOnYourOwnTurnMustHaveSeenIt.test.ts` puts a real
  `HandController` in his exact spot. A stale or absent context is refused
  with no chips moved and nothing armed. The current context still plays. Fold
  and Check/Fold still act immediately. An arm before the turn still waits.
  It fails on the previous code and passes with the fix.
- `LightningHandHost.test.ts`: the same rule on a Lightning own turn.
- `tests/unit/preActionSync.test.ts`: the arm carries the press-time decision,
  a Fold sends none, a STALE_ACTION refusal disarms the bar with the toast, and
  the API body carries the context.
- `tests/unit/preActionSwipeNeverArmsCallAny.test.tsx`: no swipe arms or moves
  Call Any, and a tap still arms it. It fails on the previous code.

## Method for future agents

Start from the durable record (`hand_history.actions[].origin`,
`client_error_events`), not from the player's description. Find which door
the decision came through. Check that every door into the same state
transition enforces the same contract (here, `/action` and `/preaction` both
decide for the hero). Put the rule in one module that both engines import.
Prove the regression test fails on the old code before calling it fixed.
