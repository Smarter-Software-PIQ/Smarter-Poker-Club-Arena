# 2026-11-07 - Owner window for the round 3 realism engine release

## Owner order

Dan, in the round 3 realism chat, 2026-11-07 (America/Chicago), verbatim:

> "YOU CAN DO ALL OF THIS YOURSELF, DON'T ASK HUMAN TO DO ANYTHING, AND
> COORDINATE WITH THE "ENGINE CUTOVER AND UPDATE STATS" CHAT TO GET THIS DONE
> NOW, NOT AT 4AM"

and at 12:25: "complete the task in full ... FINISH ANY AND ALL TASKS USING THE
FASTEST, MOST EFFICIENT ROUTE."

## State

- #9875 (second tables where the demand is, the weekend curve, horses that
  leave a line join another, waiting-list names, live counts) merged at
  15:11Z. Its database half (`20261107140215`) is installed; its engine half
  is not serving.
- The single November 7 exception (#9857, #9877) was consumed by
  `40bc2467`, which the host SEALED. Run 42389189340 reported failure only
  because the observer cached an earlier systemd invocation id; #9892 fixed
  that check. Health: maintenance idle, tables dealing.
- Every door the current main engine calls exists in production pg_proc.

## What this change does

The one hard-coded November 7 exception becomes a table keyed by owner window,
with exactly two entries:

| window                                             | serving predecessor | expiry       |
| -------------------------------------------------- | ------------------- | ------------ |
| `2026-11-07-cutover-recovery-engine-release-1445z` | `92e26a9f`          | 20:45Z       |
| `2026-11-07-realism-round-3-engine-release-1945z`  | `40bc2467`          | 01:45Z Nov 8 |

- `engine-release-activation-floor.py`: `OWNER_EXCEPTIONS` binds each window to
  its exact floor manifest digest and exact order-entry digest.
- `engine-release-seal.py`: the window is read from the target's own protected
  floor; each window has its own claim file, predecessor and expiry. The first
  window's claim name and predecessor are unchanged, so its consumed state
  still refuses.
- `engine-release-transaction.sh`: `owner_exception_predecessor` replaces the
  three literal comparisons.
- One new `windows` entry and the matching one-time activation floor.
- `read-scoped-release-recovery.py` retains the previous producer pair.

Every existing guard is unchanged: Backup certificate for the exact version,
hand-boundary drain, durable freeze/certificate, proof and rollback reserve,
SEALED, v3 thaw, fresh Backup copy. No migration, schedule, publisher, watcher
or timer. `20261107124911` installs through the existing applier only after
this engine serves.
