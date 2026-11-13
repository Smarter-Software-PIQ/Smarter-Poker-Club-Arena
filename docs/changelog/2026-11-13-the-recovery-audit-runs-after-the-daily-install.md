# The recovery audit runs after the daily install (2026-11-13)

RecoveryStackDegraded (incident 7c162480-6d45-40bb-8ba0-d3252c9251f3) fired at
09:33Z on a healthy engine. The verifier concatenated the nested horse-manifest
`version` keys from `/health`; #10701 fixed that at 15:35Z.

The fix could not clear the alert for two days. `verify-recovery-stack.sh`
ships inside the engine-control generation, which the 04:00-04:05 Chicago
window installs (10:00Z in CST), while `club-arena-verify.timer` fired at
09:17Z, before the window. The next run (Nov 14 09:17Z) still used the old
script; the first run of the fixed one would have been Nov 15.

The timer now fires at 11:17Z, after the window in both offsets, so each daily
audit checks the generation that was just installed. The timer unit is written
by the same installer, so this lands with the next certified release and its
first run is that morning. Pinned by
`tests/the-recovery-audit-runs-after-the-daily-install.law.test.ts`.
