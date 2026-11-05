# Top Chairs Sit Level, Whatever Character They Wear (2026-11-05)

## What Dan Saw

Live FLH 0.50/1 Classic (Deep Stack Society, Midway Union), phone portrait,
during the live verification of the seat-order fix (#9546): "MAMAPRIYA IS TOO
LOW". MamaPriya (seat 5, top left) sat about 51px lower than BigJake (seat 6,
top right). Both chairs share one rail line.

## Measured On The Live Table

| Seat | Art | Image box top | Image box height | Painted crown | `--sp-top-seat-shift` | Plate top |
| ---- | --- | ------------- | ---------------- | ------------- | --------------------- | --------- |
| 5 | free_penguin@2x | 108 | 174 | ~162 | 91.4px | 278 |
| 6 | vip_wolf@2x | 108 | 123 | ~113 | 41.0px | 227 |

The opponent spacing allocator (#9546) moved neither chair (both nudges 0).

## Root Cause

`useProtectedCardLayout` places the nine-seat (and every phone) top lane by
moving each top pod until its highest painted part keeps 8px of air below the
jackpot plate. It measured "highest painted part" with the image BOX
(`restingAvatarBox(...).top`). Library canvases carry transparency above the
head (`AVATAR_CROWN_TOP`: free_penguin 31%, vip_wolf 4%), and the table
normalizes figure size, so a penguin's box is taller and its head sits lower
inside it. Anchoring the box lined up two transparent rectangles and parked the
penguin's plate 51px below the wolf's. The six-max centre seat already used the
painted crown (`restingAvatarTop`); the nine-seat lane did not.

## Fix

`highest` now uses `restingAvatarTop(avatar, scale)` (the painted crown, through
the same static bust transform and opponent art scale) instead of the image
box top. Unknown or uploaded art has crown 0 and keeps its box boundary.

## Tests

- `tests/unit/protectedCardLayout.test.tsx`: new "two top chairs on one rail
  line sit level whatever character each wears" (penguin + wolf, live
  proportions). Fails on the old line with the plates 51px apart.
- The two existing pins that asserted the wolf's image box top at the 8px/9px
  line now assert its painted crown there, which is the rule they protected.

## Scope

Client presentation only. Engine, seat assignment, action order, balances and
hand history are untouched.
