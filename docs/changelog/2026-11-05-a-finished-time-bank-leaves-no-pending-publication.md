# A finished time bank leaves no pending publication (2026-11-05)

## What players saw

Spins, Sit & Gos and MTT tables froze for about 50 seconds in the middle of a
hand: one seat was "on the clock" with no countdown, no action, nothing, until
the engine watchdog noticed and re-armed the clock. On 2026-11-05 between 03:00
and 17:00 UTC `engine_recovery_events` holds 119 rows `seat N had no clock after
~50s; re-armed` on tournament tables (114 on Spins and Sit & Gos), still about
four an hour after the 14:50 UTC engine release.

## What the rows say

The twelve most recent freezes were read hand by hand from `hand_history`. In
all twelve the frozen seat had timed out on its previous decision: an action
recorded ~17.5 s after the one before it (the 15 s clock plus the settle beat).
On that seat's next decision there was no clock.

## Cause

When the 15 s clock runs out on a tournament table, the engine auto-activates
the seat's time bank with `deferPublication = true` (the bank is allocated and
flagged `pendingPublication` until the hand continuation lane retains it). If
the seat then acts or is auto-folded before that publication, `playerActed()`
set `isActive = false` but left `pendingPublication = true` (expiry did the
same).

On the seat's next `TURN_CHANGE`, `handleTurnChange` saw `pendingPublication`
and took the "publish the already allocated bank" branch instead of arming the
ordinary clock. `resumeDeferredPublication()` refused because the bank was not
active, so nothing was armed at all: no clock, no Horse decision, no auto-fold,
plus a phantom "time bank activated" broadcast.

## Fix (the line that produced it)

- `TimeBankEngine.playerActed()` and `onTimeBankExpired()` clear
  `pendingPublication` whenever the bank stops.
- `restorePlayerForRecovery()` never restores the flag onto an inactive bank,
  so a capture taken before this fix cannot bring the freeze back.
- `handleTurnChange` takes the deferred-publication branch only for an active
  bank; a stale flag falls through to the ordinary clock.

Pinned by `server/src/engine/AFinishedTimeBankLeavesNoPendingPublication.law.test.ts`
(fails against the old code, three of four assertions).

## Net

The watchdog's clock re-arm stays. After this release it is expected to read
zero `had no clock` rows for this cause; a non-zero count means another path
leaves a seat without a clock.
