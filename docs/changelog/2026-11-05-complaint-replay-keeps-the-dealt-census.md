# Complaint Replay Keeps The Dealt Census (2026-11-05)

## What Was Wrong

`HorseComplaintReplay.stateAt` rebuilt a horse decision from its recorded
public snapshot without three fields the live engine hands every decision
(`ServerTableEngineTurns`): the dealt census `dealtSeatIds`, the posted
`blindSeats` and the table `format`.

Without the census, `dealtSeatOrder` falls back to seats that are live or
invested. Folded to the small blind, every uninvested folder dropped out, the
ring shrank to the two blinds, and the small blind replayed as a heads-up big
blind: `preflopPlayersBehind` returned 0 and the V70 opening range never
applied. Without the format a spin or heads-up SNG replayed as an MTT.

## Evidence

Ranges and sizing validation (hybrid release, 2026-11-05):

- Replayed 9-max cash small blind first in: 19.5% raise, 0% complete against
  a 42% target. Live horses in the same spot (18:00 to 24:00 UTC): 46.7% raise
  and 13.8% complete, n=210.
- With the fix the replay reads 42.0% raise and 12% complete at every depth.

## Fix

`stateAt` now passes `dealtSeatIds` (every seat in the snapshot, which is
HandController's dealt roster), `blindSeats` (from the non-dead blind posts)
and `format` (from the captured tournament stage). Pinned by
`server/src/engine/horseComplaints/a-replayed-small-blind-keeps-its-ring.law.test.ts`;
all four cases fail on the previous `stateAt`.

## Not Changed

No live decision path changes; this touches the offline complaint replay only.
The public snapshot still carries no tournament payout table, so a replayed
tournament decision takes the legacy ICM path where the live engine may not.
