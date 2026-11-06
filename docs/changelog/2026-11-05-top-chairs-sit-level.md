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

Each top pod is still placed exactly as before (image box anchor). A second
pass then levels pods that share one rail line: a pod whose plate lands below
another plate on its line rises to that plate, but never past the point where
its PAINTED crown (or position chip) would break the jackpot clearance or its
card lane (`restingAvatarTop`). Lanes where every chair wears the same art are
pixel-identical to before. Six-max is untouched.

### Why Not Simply Anchor The Crown

The first version of this PR anchored every pod by its painted crown. On the
CI harness (every chair a vip_wolf, crown 3.8%) that moved the two top chairs
up by under half a pixel, which flipped the bet placement into a layout where
the top chairs' bets covered their plates (`table-proportions.spec.ts`, 320px
normal mini and 375px main revealed). Levelling only changes a lane whose
plates actually differ, so same-art lanes cannot drift.

## Tests

- `tests/unit/protectedCardLayout.test.tsx`: new "two top chairs on one rail
  line sit level whatever character each wears" (penguin + wolf, live
  proportions). Fails on the old line with the plates 51px apart.
- Existing pins are unchanged; single chairs keep their exact placement.
- `table-proportions.spec.ts` 320px 9-seat normal mini and 375px 9-seat pass.

## Scope

Client presentation only. Engine, seat assignment, action order, balances and
hand history are untouched.

## Phase 2: The Rule Is A Law

`tests/two-top-chairs-sit-level.law.test.tsx` (registry
`docs/laws.d/two-top-chairs-sit-level.md`) replaces the single unit case. It
runs every library character beside a crown-free neighbour (free_business) and
a deep-crown neighbour (vip_vigilante), on both sides: plates level within 2px
and no painted head inside the jackpot clearance. A same-art lane must keep its
exact legacy placement. Against the pre-#9587 code 101 of 102 cases fail.
