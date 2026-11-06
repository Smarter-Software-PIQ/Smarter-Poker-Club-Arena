# 2026-11-05 - The chairs never change order

## Report

Mongo (Chris Mongo), PLO8 Morning Stack - Table 1 (`8dd73d4c-5be5-4e1d-8795-91a13e4d0056`),
on his phone at 11:47-11:51 Chicago: "Cali raised but BigWade still has cards and
hasn't acted. He should be after button not where he's at" and "he still acts when
he should of he was in the other seat ... it's moved him back and forth a few times."

## What was true

The engine was right. `hand_history` (#55414869, #55415924, #55416829),
`hand_state_snapshots` and `table_seats` all agree: 1 sixesquads9, 2 Mongo,
3 Cali_Duncan, 4 BUTTONCHAMP, 5 BigWade, 6 raypatel, 7 champp, 8 king_01, 9 empty.
Action order and the position labels on screen (UTG / UTG+1 / MP, BB, CO) were
correct for every seat.

The picture was wrong. On the phone, the left-high chair (seat 5) stood empty and
BigWade was drawn in the bottom-left corner, below Cali_Duncan, right beside the
hero - so the whole table appeared to act out of turn.

## Root cause

`src/components/table/opponentAvatarLayout.ts` nudges opponent avatars so broad
character art does not overlap on dense phone rings (`--sp-opponent-x/y` on
`.seat`). Its candidate shifts include "slide to the edge of the page", and on the
first two solver passes nothing bounds how far a chair may travel. When the 9-max
ring could not fit, the cheapest legal answer was to carry seat 5 down the whole
side column and park it under seat 3. Each re-layout could pick a different answer,
which is the "back and forth".

## Fix

- `opponentRingOrderKept(before, after, centre)`: the clockwise order of every
  chair (occupied, empty, hero) must be identical after a nudge.
- `jointOpponentShifts` rejects any full solution that breaks it and keeps
  searching; the caller's existing fallbacks take over if none is left.
- `holdChairs()` re-reads every chair's rail (its wrapper, which a nudge never
  moves) after `space()` and before a wager proposal is accepted; if the applied
  frame reorders the ring, every nudge is withdrawn and the chairs sit on their
  rails.
- Ordinary spacing is untouched, including the 320px ring's two top caps sliding
  ~50-70px sideways together (the compact nine-seat fixture still passes).

## Pinned

`tests/the-chairs-never-change-order.law.test.ts` (registered in
`docs/laws.d/the-chairs-never-change-order.md`): Mongo's exact table, a forced
left-column squeeze, 60 random dense columns, and the DOM backstop.

No money, seat, engine or database change. Client-only.

## Second ruling, same day: the player is in his own seat

Dan: "Preserving circular order alone is insufficient if players can still shift
together into the wrong seat positions." So the rule is now
`opponentSeatsKept(rails, shown)`: the ring order is unchanged AND every chair is
drawn nearer its own rail spot than any other chair's (hero and empty seats
included). It is applied inside the joint solver and by the DOM backstop.

- **Found by it, on the 320px nine-seat ring:** the accepted layout slid the
  right-high player ~70px into the top-right cap's spot and pushed that cap
  player toward the middle. In order, but in each other's seats. Refused now;
  `tests/unit/opponentAvatarLayout.test.ts` records the refused answer.
- **Found by the browser check, on a 10-seat phone ring:** the old code moved a
  player 253px down the side column into the next seat - the same failure as
  Mongo's, on another layout.
- **Fallback.** When no spacing keeps everyone in his own seat, every chair sits
  on its rail and the ring is recorded as solved. Before, a failed pass left the
  ring "not ready", which also held back bet, button and tag placement until the
  next re-measure.
- **Taps.** Character art is scaled past its own slot, so a neighbour's crown
  could hang over a player's name plate and a tap there opened the neighbour's
  player menu. The art no longer catches taps; a pseudo-element sized to the
  unscaled slot does, dispatching to `.seat__avatar`, so the avatar's own click
  and keyboard handling is unchanged (`SeatSlot.css`).
- **Notes.** The note marker was not the trigger: it is a 16px absolutely
  positioned child of the avatar and is not part of the spacing measurement.
  The browser check runs with notes on and off and with long names.

## Browser check

`tests/e2e/css/the-chairs-never-change-order.spec.ts`, in the CSS Beat job. It
loads the real table stylesheets and the real ring, viewport-fit and spacing
code, seats tables the way TablePage does, and measures the rendered result:
Mongo's table (notes on/off, long names, repeated passes), Mongo's frame forced
and repaired, six phone sizes including landscape with players leaving and
joining, and every table size 2-10 from every viewer seat with the wrap from
the last seat to seat 1. The expected order comes from seat numbers alone.
Against the old code it fails on the 10-seat ring and on landscape.

Limit: the harness has no TablePage, so landscape felt sizing is not
representative; mapping and stability are asserted there, taps and decorations
only in portrait.
