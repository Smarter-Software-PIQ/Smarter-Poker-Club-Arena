# Lightning: Leave Next Hand Waits For The Hand, And The Session Card Adds Up

Dan, 2026-11-12, with a screenshot of the Lightning Session Results card:
"WHEN YOU CLICK 'LEAVE NEXT HAND' ... IT MEANS AFTER THE END OF THE CURRENT
HAND, YOU LEAVE THE TABLE. NOT AT THAT EXACT MOMENT. FIX THAT LOGIC, AND FIX
THE SESSION CARD DATA AS IT DOESN'T SEE ACCURATE. (AND IT SHOULD BE DISPLAYED
Smarter.Poker at the top, not smarter.poker."

## Leave Next Hand

Cause: `LightningLeaveControl` stopped matchmaking and then called
`handleLeaveTable` straight away, which suppressed the action bar, cancelled
pre-actions, auto-folded the live room hand and cashed the anchor seat out.

Fix: the control still stops matchmaking at once (no new deal is offered), but
TablePage now hands the leave to `leaveLightningAfterThisHand`. While the
player is live in the hand in front of them (`lightningLeaveWaitsForHand`) the
leave is queued, the button reads "Leaving After Hand", and the player keeps
acting normally. When that hand settles, they fold, or the room closes, the
original leave owner runs once. `handleLeaveTable` also no longer sends a fold
for a hand that has already settled.

Pinned by `tests/lightning/lightning-leave-waits-for-the-hand.law.test.ts`.

## Session card data

Session `aa7ead90-94a3-41c9-95ef-9a81e95422d1` (KingFish, PLO4 1.00/2.00) read
STARTING STACK 400, ENDING STACK 401, NET -14. All three were true; Auto Top Up
had applied 4, 1 and 10 between hands and the card did not show them.
`fn_lightning_session_stats` now answers `top_ups` (applied intents only) and
`total_buy_in` (starting stack plus top ups), and the card's second row is
TOTAL BUY-IN 415 / ENDING STACK 401 / NET -14, which reconciles on every
session. Migration `20261112184444`.

## Wordmark

The card art's plate read "smarter.poker". New art
`public/assets/results/chip-stack-report-v2.webp` reads "Smarter.Poker"
(new file name, because the asset pool is append-only); the old file stays.
