# A deadlocked hand settlement is retried in the live path (2026-11-19)

Production alerts 258600 and 267092 (`postHandTasks.hand_history_failed`):
"atomic hand commit refused (rolled_back): deadlock detected", attempts 1, on
table 596f82eb hand #39888785 (2026-10-19 14:37:29Z) and table 1aa2ab60 hand
#44324262 (2026-10-22 20:04:21Z). 16 earlier receipts carry the same text.

## Cause

`fn_ca_settle_hand_stacks_absolute` catches its own errors and returns
`{reason: 'rolled_back', sqlstate}`. `fn_ca_commit_hand_settlement_before_lease_generation`
returned that object unchanged, so a deadlock one function deeper never became
the `atomic_hand_rolled_back` envelope (with commit hash) that the engine's
"confirmed atomic hand rollback" branch retries. The hand was thrown as a
deterministic refusal and waited for the startup resume door (#39888785 was
accepted 16 minutes later).

## Fix

Migration `20261119141104` re-raises a 40001 / 40P01 / 55P03 inner refusal with
its own SQLSTATE inside the block whose handler builds the canonical envelope.
Every other inner refusal keeps its shape. The engine is unchanged: its two
bounded rollback retries now apply. The resume door already treats those three
SQLSTATEs as "not the hand's one financial attempt".

## Proof

- Native: `scripts/ci/test-a-deadlocked-hand-settlement-is-retried.sh` loads
  production's exact preimage (md5 b49192e7...), reproduces the defect, installs
  the migration unchanged and proves all three transient classes, a
  non-transient refusal and a clean commit. Runs in
  `.github/workflows/hand-settlement-deadlock-proof.yml`.
- Law: `tests/a-deadlocked-hand-settlement-is-retried-in-the-live-path.law.test.ts`.
- Recurrence still routes through `postHandTasks.hand_history_failed` ->
  `financial_alerts` -> `operational_alert_events` with
  `target_task_id = 01a09b86-5ba8-7290-8657-1041f13dd3ca`; after the fix a
  deadlock only reaches it if both live retries also deadlock.
- Evidence: `docs/production-alerts/evidence/hand-commit-inner-deadlock/`.
