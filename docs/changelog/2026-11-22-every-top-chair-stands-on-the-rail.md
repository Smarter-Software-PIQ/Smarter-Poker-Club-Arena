# 2026-11-22: every top chair stands on the rail, at every table size

Dan, about the six-max table on a phone: "THEY MUST 100% OF THE TIME BE ON THE
RAIL AND NEVER ON TOP OF THE TABLE OR OVERLAPPING THE FELT", then, of the other
table sizes that drew the same chair on the felt: "FULLY BUILD, FIX AND ENHANCE
ALL OF THESE".

## What a player saw

#11774 fixed the six-max top seat in the 600px phone layout only. On heads-up,
four-seat and eight-seat tables, on the two top diagonals of the 3/5/7/9/10
seat rings, and on six-max on a portrait
tablet (641-768px), the top chair's name plate still sat 11-22% down the
table canvas, below the 8.9% where the felt begins. Tournament top chairs were
never placed by the layout hook at all and sat on the felt by CSS alone.

## Cause

The phone placed top chairs from the TOP DOWN: the pod was raised until the
portrait's crown kept 8px under the jackpot plate (the `two-top-chairs-sit-level`
lane, #9587) or met the tab bar, and the chair allocator then pushed it back
down until crown and caption lane cleared the bar. Whatever did not fit above
the rail was paid for by the name plate, on the felt.

## Fix

`src/components/table/topChairRail.ts` (replacing `sixSeatTopRail.ts`) places
every top chair from the RAIL UP, from two numbers only: the table canvas and
the chair's own rail station (y 5 or y 6, `seatLayoutFor(n)`). The plate's
bottom edge rests on the station; the portrait rises as far as its size takes
it, under the jackpot plaque and tab bar, which paint above it. Nothing above
the chair is an input, so nothing above it can push it onto the felt again.

- `useProtectedCardLayout.ts` applies it on every portrait layout from 481 to
  768px (the 600px layout every phone uses, and portrait tablets), cash and
  tournament (tournament top chairs join the top lane). A page narrower than
  481px is a multi-table mini tile or a squeezed desktop window, not a phone's
  table; extending the rule there collided with the minis' tabled hands and
  crown clearances in CSS Beat, so those keep their approved placement.
- `opponentAvatarLayout.ts` never nudges a top chair.
- `mobileAvatarEnlargement.ts` lets those portraits pass behind the tab bar
  instead of shrinking them (CLAUDE.md 10.7c: no portrait got smaller).
- The nine-seat phone ring keeps its approved centred plates and only gains a
  floor: never past the felt on the shortest canvases.
- Two chairs on one rail line share one station, so they sit level by
  construction. The level law is kept, not dropped: it now requires level AND
  on the rail on portrait phones and tablets, and still checks the 2026-11-05
  levelling everywhere else.

## Why it regressed

Each layer was fixed for its own case: #9587 levelled two top chairs under the
jackpot clearance (correct for level, but it fixed the height from above),
and #11774 moved only the six-max phone case onto the rail. Nothing asserted
where a top plate ended up on any other ring or width.

## How it is pinned

- `tests/every-top-chair-stands-on-the-rail.law.test.tsx`: stations of every
  ring, the arithmetic at measured canvases and plate heights, and the real hook
  at a raw phone, the phone layout and a tablet for every ring, cash and
  tournament.
- `tests/two-top-chairs-sit-level.law.test.tsx`: level and on the rail.
- `readMobileTableLayout` ("Top Seat" violations) in the browser guard cases
  and the post-deploy live proof: plate off its station, plate or portrait over
  the felt window, portrait not under the tab bar.
