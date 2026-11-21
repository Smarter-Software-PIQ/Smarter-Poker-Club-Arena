# 2026-11-21: reserve-migration-version.sh recovers stale locks atomically

## Root cause

`scripts/reserve-migration-version.sh` serialized concurrent callers with `mkdir "${TMPDIR:-/tmp}/club-arena-migration-version.lock"` and cleared it only on a normal `EXIT` trap (`rmdir`). If a holder was killed with `SIGKILL` or terminated abruptly, the empty lock directory remained on disk indefinitely and permanently blocked every subsequent caller on the machine (observed 2026-11-21 with a leftover empty lock directory dated 2026-11-19).

## What changed

- `scripts/reserve-migration-version.sh`:
  - Writes the holder's PID (`pid`) and Unix epoch timestamp (`ts`) inside the lock directory immediately upon acquiring it, and releases the lock on `EXIT`, `INT`, and `TERM` (only when owned by `$$` or still unpopulated).
  - Adds portable `mtime_seconds` (shared with the `origin/main` ref freshness check), `pid_is_alive` (handling `EPERM` from live processes owned by another user as alive), `lock_is_stale`, and atomic guard-protected `reclaim_stale_lock`:
    - Recovers immediately when `$lock/pid` names a dead numeric PID.
    - Recovers an empty or legacy lock directory without a readable numeric PID only once its mtime is at least 30 seconds old (`lock_grace_s=30`), so a brand-new caller racing between `mkdir` and writing `pid` is never evicted.
    - Never evicts a live holder regardless of lock age.
    - Double-checks staleness inside an atomic `${lock}.reclaim` guard directory before removing `pid`/`ts` and `rmdir "$lock"`.
- `tests/a-migration-version-is-reserved-not-guessed.law.test.ts`:
  - Adds three focused tests covering: (a) a live holder blocking concurrent reservation even when the lock directory is 2 hours old, (b) immediate recovery when the lock directory names a dead holder PID, and (c) recovery when an empty lock directory is older than the 30-second grace threshold. Preserves the existing brand-new empty lock blocking test unchanged.
