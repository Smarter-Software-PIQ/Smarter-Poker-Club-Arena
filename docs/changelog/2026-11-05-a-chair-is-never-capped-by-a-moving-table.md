# A Chair Is Never Capped By A Moving Table (2026-11-05)

## What Was Reported

Danimal, iPhone, Afternoon Free Buy (NLH) Table 9, hand #55575208, 5:29 PM
Chicago. Dan: "YOU NEED TO PLACE FAIL SAFES OR OTHER THINGS IN PLACE FOR THE
AVATARS POSITION TO NEVER EVER EVER BE ABLE TO CHANGE DURING LIVE PLAY".

Engine (hand_history): 1 msp_diego, 2 squeeze777, 3 KenjiJAX, 4 RaySA,
5 empty, 6 PVDHank, 7 Danimal (hero), 8 Freeroll, 9 kickermoose. Correct.
Dan's desktop spectator view of the same table was correct.

On Danimal's phone the left-hand chairs (8, 9, 1) were right, and every chair
that belongs further right (KenjiJAX, RaySA, the empty seat 5, PVDHank and
Danimal himself) was drawn at about 30% of the felt, on top of the left-hand
chairs.

## Root Cause

`TablePage` fits the rotated ring to the screen with `fitSeatToViewport`,
which clamps each pod between `minX` and `maxX`. It passed the scaler's left
edge as `getBoundingClientRect().left`: where the table is PAINTED at that
instant. A table caught mid-slide, mid-zoom or mid-scroll reports a large left
edge, `maxX` collapses to ~30%, and every chair right of it is pinned there.
The ring is memoized on the scaler size, not on that reading, so the wrong
ring stayed after the table came to rest.

Reproduced on the live site: shifting `.multi-table-page__table-slot` by 360px
while the table re-fit moved seats 6, 7, 8, 9 to 29.74% and the bottom seat to
27.32%, and they stayed there after the shift was removed.

## Fix

1. The left edge is read from LAYOUT offsets inside the table's own page
   (`scalerLayoutLeftPx`). Transforms, zoom and scroll do not move layout
   offsets. On a resting phone table both readings are equal (1px measured
   live), so nothing moves in normal play. The value is a memo dependency.
2. Failsafe in `fitSeatToViewport`: a window that does not leave room for a
   whole chair either side of the table's centre is refused, and a fitted
   chair can never reach or cross the centre line from its own side. Either
   case keeps the chair on its own rail spot.

## Tests

- `tests/a-chair-is-never-capped-by-a-moving-table.law.test.ts` (registry
  `docs/laws.d/a-chair-is-never-capped-by-a-moving-table.md`): Danimal's frame;
  every ring, every chair, every left edge from -width to +width at eight
  widths, no chair changes side; TablePage reads layout, never paint.
  10 of 10 fail on the previous code.
- 327 table, seat, layout and law test files pass (4,995 tests).
- Browser: `the-chairs-never-change-order.spec.ts` 4/4,
  `table-proportions.spec.ts` 9-seat 320 mini, 375 and 393 pass.

## Scope

Client presentation only. Engine, seats, action order, balances and hand
history untouched. Open phones pick it up on their next reload.
