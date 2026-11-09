# Horse study release: coordination handoff

Written 2026-11-09 ~05:00 UTC by the blind-structures lane, which also holds the
Horse acceptance assignment. Durable because the designated cross-lane route
could not be reached from a cloud session (see "The exact missing capability").

## 1. What the durable records actually say

Read from production, not inferred from the serving SHA.

| Outcome                 | Record                            | Verdict                                                                                                                                                                   |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replacement             | `/health` serves `391f7bc0`       | DID NOT OCCUR                                                                                                                                                             |
| Deploy attempt          | `ca_engine_deploy_attempts`       | NONE in the booked window. Last row 2026-11-07 21:22:45Z, target `391f7bc0`, shipped=true, "Hetzner transaction sealed and independently verified", actor `Smarter-Poker` |
| Certification / staging | `engine_deploy_exit_paths`        | NONE in the booked window. Last row 2026-11-07 21:22:45Z, stage `complete`, outcome `shipped`, release_result `sealed`                                                    |
| Freeze                  | `engine_maintenance_break_log`    | NO freeze inside the window. The only 2026-11-08 break was the routine daily one at 10:00:00Z (04:00 Chicago)                                                             |
| Thaw                    | `engine_maintenance_thaws`        | The routine 2026-11-08 break thawed cleanly: thawed 10:03:43Z, frozen 300s, `thaw_ok=true`, 1,504 tables resumed, shifted `complete: true`                                |
| Faults                  | `engine_maintenance_break_faults` | NONE in the last 36 hours                                                                                                                                                 |

So the window lapsed with **no operation started at all** - not a failed
certification, not a rolled-back freeze. Nothing was attempted. Correcting an
earlier statement of mine: an unchanged serving SHA proves only that
replacement did not happen; the four outcomes above are what establish the rest,
and they are distinct.

Note the daily 04:00 Chicago window on 2026-11-08 also passed without replacing
the engine - it ran its break on `391f7bc0` and resumed on `391f7bc0`.

## 2. The release owner

The engine/release evidence directories on the archive volume all carry the
session id `01a1b095`: `backup-daily-01a1b095`,
`daytime-engine-prequalification-01a1b095`, `seal-engine-01a1b095`,
`nov7-one-shot-01a1b095`. That is the same chat cited at the head of
`CLAUDE.md` as the November 6 engine direction
(`01a1b095-8bd5-7d42-afcf-1a0843448274`). Treat that lane as the release owner.

The last deploy's actor of record is the service identity `Smarter-Poker`,
acting through the certified path. `ca_engine_operator_commands` holds nothing
release-related since 2026-10-15, so there is no durable reservation row for
either booked window - both bookings exist only in
`docs/changelog/2026-11-08-horse-study-successor-window.md`, which itself
records that the original operator is unavailable and no competing receiver is
active.

## 3. The exact missing capability

The device bridge reaches the Mac Studio (`smarterpokers-mac-studio-local`) and
a folder grant for `/Volumes/SmarterArchives/agent-evidence` was approved. Two
things still block the designated route from a cloud session:

1. **`COORDINATION-INBOX.md` and `HORSE-LANES-STATUS.md` are symlinks whose
   targets resolve outside the granted folder**, and the bridge refuses to
   follow a link out of its grant. Staging either file fails with "not inside a
   folder connected to Cowork on this device".
2. **`device_bash` cannot mount that folder** ("mnt/agent-evidence failed to
   mount"), so the link targets cannot be resolved or read through a shell
   either.

What would close it: a grant on the symlink TARGET directory (or on `/Volumes`),
or a working mount for `device_bash`. Either one alone is enough.

The real archive tree IS readable at
`/Volumes/SmarterArchives/agent-evidence/extreme-archive`, so evidence can be
read there; only the two coordination files are unreachable.

## 4. What must be true before the next selection

Do not select a candidate until all three hold, checked in this order:

1. The candidate contains BOTH merged fixes - the PLO trip-board value fix and
   the tournament shared-memory read fix. A candidate that does not contain
   them cannot satisfy the acceptance gates no matter how cleanly it deploys.
2. Its qualification evidence is valid FOR THAT EXACT SHA.
3. Its Backup certificate is valid FOR THAT EXACT SHA.

## 5. Acceptance gates still open

All four remain open and none can be captured on `391f7bc0`, because the fixes
are not in it:

- SEALED receipt for the new release
- Serving SHA matching the certified candidate
- Complete thaw after its freeze
- Two natural decision receipts: an accepted tournament shared-memory read, and
  a natural PLO trip-board value bet - each tied to the exact engine revision,
  hand, Horse and decision receipt

Capturing a Horse decision now would record `391f7bc0` deciding WITHOUT the
fixes. That is not acceptance evidence and must not be filed as such.

## 6. Preserved, untouched

- The frozen study
- The 187 recovered Lightning folds
- Receipt-based coverage of 726 of 1,000 Horses

Nothing in this lane's work touched any of them. Passing evidence for unchanged
inputs is reusable as-is.

## 7. Standing constraint

Binding, from this lane's own handoff: "Engine activation happens ONLY at the
daily 04:00 America/Chicago certified release. You never dispatch, cancel,
retry or certify an engine release. You never restart the engine." This handoff
therefore books nothing and retries nothing.
