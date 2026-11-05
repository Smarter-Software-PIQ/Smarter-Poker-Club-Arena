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
