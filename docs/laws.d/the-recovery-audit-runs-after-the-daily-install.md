# tests/the-recovery-audit-runs-after-the-daily-install.law.test.ts

The daily recovery-stack audit (`club-arena-verify.timer`) fires after the 04:00-04:05 America/Chicago release window in both CST and CDT, so its result describes the control generation that window just installed. Before 2026-11-13 it fired at 09:17Z, ahead of the window, and a repaired verifier could not clear a false RecoveryStackDegraded until the following day.
