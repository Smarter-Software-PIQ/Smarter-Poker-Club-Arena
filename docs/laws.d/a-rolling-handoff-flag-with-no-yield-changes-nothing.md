# tests/a-rolling-handoff-flag-with-no-yield-changes-nothing.law.test.ts

The classic engine run-spec and the Backup engine carry `ENGINE_ROLLING_HANDOFF=on` (bootstrap for the rolling release, docs/ENGINE-ROLLING-HANDOFF.md); with the flag on and no yield requested the serving engine deals, owns and reports exactly as with the flag off: no unit moves, no successor phase, and the only added work is the handed-leases read.
