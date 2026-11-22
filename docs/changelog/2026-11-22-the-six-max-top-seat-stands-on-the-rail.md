# 2026-11-22: the six-max top seat stands on the rail

Dan, with a phone screenshot of a watched 6-max PLO5 table: "IN THE 6 MAX GAMES
THE TOP VILLAIN (the_doc) IS TO LOW ON THE TABLE! THEY MUST 100% OF THE TIME BE
ON THE RAIL AND NEVER ON TOP OF THE TABLE OR OVERLAPPING THE FELT. THE TOP OF
THAT VILLAINS HEAD CAN BE 'CUT OFF' AT THE TOP OR 'UNDER THE ACTION BAR' WITH
THE ACTION BAR BEING LAYER 1 AND THE AVATAR LAYER 2. BUT THE CURRENT LAYOUT IS
BROKEN. KEEP EVERYTHING ELSE EXACTLY THE SAME."

## Cause

On the phone layout (600px wide) the top chair was placed from the top down, by
two mechanisms that both took the tab bar as a ceiling:

1. `useProtectedCardLayout` raised the pod until the portrait's crown met the
   bar (`naturalTarget = pageBox.top - 2 * scale`, the 2026-10-26 ruling).
2. The chair allocator (`opponentAvatarLayout.ts`, `space()`) then solved the
   chair inside a box whose top edge is the bar's bottom edge
   (`top = header bottom + 0.5`). The chair's parts include its portrait and
   the action caption lane reserved above the crown, so the allocator pushed
   the whole pod back down (`--sp-opponent-y`) until both were under the bar.

Whatever did not fit between the bar and the rail was paid for by the name
plate, on the felt. Measured on the real components (carbon_red skin, wolf
art; the felt window starts 8.9% down the table canvas, the rail station is 5%):

| Phone layout                | View    | Push down | Plate bottom before | After |
| --------------------------- | ------- | --------- | ------------------- | ----- |
| 600x1298 (390x844)          | seated  | 44.6px    | 10.5%               | 5.0%  |
| 600x1298 (390x844)          | watched | 46.2px    | 12.7%               | 5.0%  |
| 600x1298, tournament        | watched | 46.2px    | 15.9%               | 5.0%  |
| 600x1065 (320x568, 375x667) | seated  | 44.6px    | 13.6%               | 5.0%  |
| 600x1065                    | watched | 46.2px    | 16.0%               | 5.0%  |
| 600x900 (toolbars showing)  | watched | 44.6px    | 19.2%               | 5.0%  |

The tournament ticker strip moves the bar and the table down together, so it
does not change these numbers. A watched table is worse than a seated one
because its portraits are larger (2.3 against 2.1), and a shorter canvas is
worse again because the same portrait is a larger share of it.

The tab bar already painted above the table (`z-index: 350`, opaque black); the
stacking was never the defect.

## Why it broke

Three correct changes, each green, none of which touched this chair on purpose:

- 2026-11-13 moved action captions above the artwork.
- 2026-11-14 reserved that caption lane before the chairs lock, even with no
  action on screen. From then on the allocator had to fit a permanent 32px
  lane plus the crown under the bar, and the only thing it could move was the
  pod.
- 2026-11-18 raised the watched six-max portrait from 2.1 to 2.3.

Nothing checked where the top plate ended up. The 2026-08-19 guard
(`tests/e2e/top-rail-seat.spec.ts`) measures a static CSS harness with no
layout hook, and the phone guard cases asserted rail position for nine seats
only.

## Fix

The chair is placed from the rail up (`src/components/table/sixSeatTopRail.ts`):

- The plate's bottom edge rests on the chair's own rail station, y 5 of the
  table canvas (`seatLayoutFor(6)`), read from the wrapper. The tab bar, the
  portrait, the caption and any cards are not inputs.
- The chair allocator never nudges that chair. It is a fixed fact the other
  five chairs keep clear of, and it keeps its place in the ring order.
- The size fitter treats the tab bar as drawn over that one portrait and does
  not bound its top by the page, so it cannot answer by shrinking.
- The action caption keeps its lane above the crown where that lane is on
  screen, and sits just under the bar where the crown has gone behind it
  (`--sp-rail-caption-drop`). When the chair tables a hand that fills the lane,
  the caption goes beside the cards, using the nine-seat rail's existing
  placement.

Scope: six seats, the phone reference layout (481-640px wide, portrait), cash
and tournament, seated and watched. No portrait size, no stored value.

## Unchanged, and how that was checked

Twenty-five scenes were rendered headless before and after on the real
components and every element's box compared: the other five seats (portrait,
plate, cards, caption, chips), the board, pot, logo, table art, footer and
the dealer button when it is not the top chair's. All identical, with one
exception: on the 600x900 canvas two neighbours' chip stacks moved under one
pixel. The top chair's own dealer button and chips follow it (the button sits
under the plate, the chips below the button). Nine-seat tables, heads-up, four-
and eight-seat tables, raw 390px, tablet and desktop six-max are pixel-identical.

## Pinned by

- `tests/the-six-max-top-seat-stands-on-the-rail.law.test.tsx`: the arithmetic
  at five canvases and both plate heights, the real hook in jsdom at 2.1, 2.3,
  under the ticker and with a portrait taller than the room above the rail,
  and the three mechanisms (hook, allocator, fitter) plus the bar's layer.
- `readMobileTableLayout` (`tests/e2e/support/mobileLiveTableLayout.ts`), used
  by the browser guard cases and the post-deploy live proof: "Six-Max Top Seat"
  violations for a plate off its station, a plate or portrait over the felt
  window, and a portrait not under the tab bar. The six-max guard cases in
  `mobileAvatarSizingCases.ts` assert none, seated, watched and tournament.

## Known limits

- Rings of two, four and eight seats also have a top-centre chair, and on the
  phone layout its plate measures 10.5-15.9% down the canvas, on the felt.
  That is a different code path (the pod is held 8px under the jackpot plate,
  pinned by `two-top-chairs-sit-level`) and was not changed here.
- Premium skins paint narrower rails than the two standard ones. The station
  (5%) is above the painted felt on every shipped skin by measurement of the
  centre column, but the margin is under one percent on ocean_blue.
- On canvases shorter than about 600x1000 a watched top portrait's caption
  sits over its face, because the crown is well behind the bar.
