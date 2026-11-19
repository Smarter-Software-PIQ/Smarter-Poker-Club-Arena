# tests/a-capacity-check-never-upgrades-the-tournament-lock.law.test.ts

A seatless rebuy holds its event's tournament row FOR NO KEY UPDATE from its seat root, so the capacity check it reaches (fn_ensure_late_registration_capacity) must lock that row FOR NO KEY UPDATE too: asking FOR UPDATE upgraded the lock against a hand commit's FOR KEY SHARE and deadlocked nine times on 2026-11-19 (alert 445924). The law pins migration 20261119235115, refuses a later redefinition that puts FOR UPDATE back, and keeps the native proof (scripts/ci/test-rebuy-capacity-lock-order.py) gated in CI.
