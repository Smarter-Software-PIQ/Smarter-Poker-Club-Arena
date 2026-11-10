# Lightning: Check/Fold In The Big Blind Releases On The Raise

Dan, 2026-11-10 (09:48 and 09:50 Chicago): "while in the big blind, check fold
didn't auto fold me, it still made me click it twice" and "i clicked check fold
but it didn't move me while in the bb ... it made me hit fold again."

## What production showed (engine 840429a3, client 884b85df)

- Hand 58348362 (big blind, formed 15:47:43Z): a horse raised at 15:47:49.462Z;
  the hero's fold was published at his turn, 15:47:53.303Z, with origin
  `player` and fold type `fast`: a fold request the engine held for the turn.
  Nothing released him at the raise.
- Hand 58348210 (big blind, formed 15:45:53Z): a horse raised at 15:46:09.649Z;
  the engine held no pre-action at the hero's turn and he folded by hand at
  15:46:27.514Z.

## Causes

1. **The bar judged "owes nothing" from the wrong number.** In a Lightning
   room the pre-action bar compared `tableState.currentBet` with the page's
   per-seat bet display, which can trail the hero's posted big blind. In that
   frame the big blind's bar offered Fold rather than Check/Fold, and the press
   went out as a fold request (`auto_fold`), not `auto_check_fold`.
2. **The host held a fold requested on a free seat until its turn, even after a
   raise priced it.** `requestFold` keeps an unpriced seat reserved (so a free
   seat cannot be released into a walk), and `releasePricedCheckFolds` skipped
   any seat with a pending fold, so the later raise released nobody.

Hand 58348210 fits cause 1: the bar offered and armed a choice that a raise
spends or that never folds. No engine log route exists to show the exact
request, so this is the best reading the hand records allow.

## Fixes

- `lightningHeroToCall` (src/lightning/lightningCheckFold.ts) reads the
  engine snapshot's `current_bet` and the hero's `bet`, the same pair
  `lightningFoldOnTurn` reads. In a Lightning room the bar's labels, its
  free/priced decision, the arm it sends and the armed price all use it;
  Classic tables are unchanged.
- `releasePricedCheckFolds` now also releases a pending fold whose seat a bet
  has just priced (`afterFold(userId, 'fast')`, once), so the player moves to
  the next hand at the raise. The public fold is still published at the seat's
  own turn. Horses get exactly the same release.

## Delivery

The client half ships with the normal publisher. The engine half is under
`server/**` and activates at the next 04:00 America/Chicago daily maintenance
window through the existing route.

## Tests

- `server/src/lightning/LightningHandHost.test.ts`: a fast fold asked for on a
  free big blind releases the moment a raise prices it (fails without the fix).
- `tests/lightning/lightning-big-blind-check-fold.test.ts`: the engine pair,
  the arm a free big blind sends, and the page reading it.
- Two source pins moved to the new expression in the same commit:
  `tests/lightning/lightning-phase-6-review-fixes.test.tsx` and
  `tests/unit/LiveHandNeverDimsAndPreActionsLand.test.ts`.
