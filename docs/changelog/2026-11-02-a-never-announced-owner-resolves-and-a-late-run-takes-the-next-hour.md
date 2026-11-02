# A Never-Announced Owner Resolves, And A Late Run Takes The Next Hour

Release 41511864834-1 entered its host transaction at 19:59:16 UTC and the seal reserved the 20:00 hourly cycle for it. An hourly cycle can only be announced in its :58 minute, so that cycle could never be announced. The run died at 20:06 ("original routine cycle expired; no later hour is authorized") and left a reserved, failed, never-announced owner. The next release (41513808484-1) refused at once ("a prior routine cycle owner remains unresolved"), because no resolution path accepted an owner without a bound window unless it was hard-coded.

Two corrections:

1. Reservation lead. `reserve-routine-cycle` reserves the next hour only while at least 180 seconds remain before it. A run admitted later owns the following hour, which its existing deadline covers. This removes the only way a fresh run could own an hour it can never announce.
2. Generic never-announced owner. `resolve-terminal-routine-failures` now records `unentered-cycle-proved` for any later, unpinned, expired, never-committed owner whose cycle has no bound window and carries its canonical failure. It uses the same positive witnesses as the pinned unentered daily profile: the durable failure equals the cycle copy and names the sealed desired runtime it recovered; every request, intent, checkpoint, retirement, hold, pin, lease and recovery-window trace is absent; its native units are quiet; both health views show one idle, unfrozen instance of the desired source with Inspector closed; and the database is idle with a fresh leader. Every witness is observed twice under the engine and seal locks before the receipt, audit and compare-and-swap. The resolution is revalidated on every load and by the read-scoped observer. An announced owner, a pinned owner, or any missing or changed witness stays authoritative.

The countdown capture epoch guards from this branch are unchanged.
