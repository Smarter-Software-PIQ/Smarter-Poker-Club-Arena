# A pending horse audit analysis that completes another is kept (2026-11-07)

Follow-up to `2026-11-07-a-completed-horse-audit-analysis-replaces-the-partial-one.md`
(migration 20261107191435, PR #9917).

## What was still open

The completion rule (a submission that keeps every stored flaw unchanged and
adds more replaces the stored analysis) lived only in the direct save. Two
other orderings could still leave a less complete analysis on the panel:

1. **Both runs save before the machine audit.** Both are held as
   `pending_machine_audit`; the audit row's trigger attached the earliest and
   filed the rest as duplicate / retained_existing, so a partial run followed
   by its completion showed the partial one.
2. **A save racing the machine audit.** The save looked for the audit row
   before the writer committed and filed itself as pending after the writer's
   trigger had already looked for pending rows. Nothing attached it.

## The fix (migration 20261107213505)

- The attach trigger walks every pending submission in submission order and
  applies the same completion rule: each one that completes the current choice
  replaces it (the replaced one becomes `superseded`); exact repeats are
  `duplicate`; anything else is `retained_existing`.
- The save (on its no-usable-row path only) and the trigger (only when it is
  about to attach) take the same transaction-scoped advisory lock for the day,
  so whichever commits second sees the other. The save re-reads the row after
  the lock. Lock order is the same on both sides, so it cannot deadlock with
  the row lock the save takes on an existing row.
- Concurrent saves on an existing row were already serialised by the save's
  `SELECT ... FOR UPDATE`.

So no ordering of saves and audit writes can put a less complete analysis over
a more complete one: a replacement must contain every flaw it replaces, and
nothing is deleted from `horse_daily_audit_analysis_submissions`.

## Proof

- Rolled-back production probe of the new trigger body (pg_temp copy, one
  self-aborting DO block, fixture day 2099-12-31, zero rows left behind):
  pending A {a}, B {a,b}, C {x}, D {a,b,c}, A2 {a} in that order attached D;
  A and B `superseded`, D `completes_existing`, C and A2 `retained_existing`.
- After installation the same sequence is re-run against the installed
  trigger in a rolled-back probe (see the PR).
- `tests/a-pending-horse-audit-analysis-that-completes-another-is-kept.test.ts`.
