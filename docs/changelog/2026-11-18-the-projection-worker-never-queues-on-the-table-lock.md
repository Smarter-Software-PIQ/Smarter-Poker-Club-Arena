# The projection worker never queues on the table lock, and one drain call clears a table (incident 075013fd)

**Migration:** `20261118155509`. **Follow-ups to:** #11269 (`20261118073646`),
which named both of these as still open.

## What was still wrong after #11269

1. **`fn_project_hand_side_effects` waited on the table lock with no bound.**
   - This is the projection worker's RPC (`handProjection.ts`, `projectChain`).
     It banks the hand's deferred rake and BBJ/insurance obligations, then
     takes `pg_advisory_xact_lock('hand-post-commit:<table>')`. After that it
     takes every seated player's `player-stats:<uuid>` lock and runs the
     envelope. Its outbox delete fires the obligation trigger.
   - Production `lock_timeout` is 0, so each waiter held a connection until
     service_role's 8 s statement timeout. That is the same pile-up the
     incident was. #11269 bounded only the envelope's own wait.
   - Measured on PostgreSQL 16 against the production text: one session holds
     the lock for 10 s, and 19 of 20 projection callers time out. The 20th had
     a deferred rake to bank, so it ends its pass before the lock.
2. **`fn_ca_drain_orphaned_post_commit_envelopes` advanced one hand per table
   per call.**
   - Its `NOT EXISTS earlier pending` filter picked only each table's
     head-of-line hand.
   - Measured: a 50-hand backlog on one table plus 3 on another, and one call
     applied 2 hands.

## What changed

- **Projection function: table mutex.** It tries the mutex for at most
  250 ms. A busy table answers `table_busy` (`retryable: true`,
  `projection_applied: false`).
- **Projection function: player locks.** They are still taken in uuid order.
  All of them share one 1 s deadline, which starts once the mutex is held. A
  held one answers `obligation_lock_busy` (`detail: player_stats_lock_busy`).
- **Nothing is written before either answer.** The function itself writes
  nothing; every write belongs to a callee that runs after the locks. So the
  outbox row stays, and the worker's existing deferral comes back for the hand.
- **Order and exactly-once are unchanged.** The outbox delete and the
  projection still happen only under the mutex, after the after-function's
  own predecessor check.
- **Same versioned contract as #11269.** The same `request.headers` read
  decides the answer:
  - The engine that ships with #11269 sends `x-ca-post-commit-contract: 2` on
    this RPC and defers both reasons (`isQueuedPostCommitReason`).
  - Every other caller gets `predecessor_pending`, with the real reason in
    `queued_reason`. That covers today's engine, a rolled-back build and any
    SQL caller. `predecessor_pending` is the one answer the pre-#11269 worker
    defers without a failure receipt (`handProjection.ts` at `e315035b8^`).
  - No server change is needed: #11269 already sends the header and defers
    every queued reason.
- **Drain.** One call walks each table's pending envelopes in hand order, the
  oldest backlog first, up to `p_limit` envelope calls in all.
  - A table stops at its first hand that does not complete: a queued answer,
    a refusal or an error. Its later hands are skipped for that call.
  - Each hand is the envelope itself, in its own subtransaction. So every lock
    wait is the envelope's bounded one (250 ms mutex, 1 s rows).
  - The answer keeps `seen`/`applied`/`failed` and adds `deferred`,
    `skipped`, `tables` and `stopped` (hand, number and reason per stopped
    table).

## Who calls the drain (CLAUDE.md 10.12)

Nobody, on any schedule:

- Its job `ca-post-commit-orphan-drain-10m` was retired by `20260922155223`.
- Production `cron.job` has no row naming it (read 2026-11-18).
- No function in `public` or `smarter_private` calls it, and no engine,
  client or script code does.
- `tests/a-retired-compensation-job-is-never-scheduled-again.law.test.ts`
  refuses any schedule that calls it.

It remains an operator's hand tool for an incident, granted to service_role
and postgres only. This change adds no schedule and no caller, and the new law
pins that.

## Proof

`scripts/ci/test-projection-table-lock-bound-postgres.py` (workflow
`projection-table-lock-bound.yml`) passes 48 checks locally on PostgreSQL 16.

**(a) Mutex held 10 s, 20 concurrent projection callers.**
- Contract 2: zero statement timeouts, every caller answers `table_busy`, at
  most 0.30 s server-side (the check allows 0.5 s), all 20 within 0.83 s wall.
- Contract 1: the same, answering `predecessor_pending` with `queued_reason`
  `table_busy`.
- While busy, nothing is projected or completed and the outbox stays intact.
- After release, a worker-shaped drain projects every hand exactly once, in
  hand order. Every envelope completes once, the deferred rake is banked once,
  and the outbox ends empty.
- A held `player-stats:` lock answers within ~1 s and writes nothing.

**(b) Drain.**
- One call applies the whole 53-hand backlog in hand order; a second call
  finds nothing.
- `p_limit` bounds a call, and the next call resumes in order.
- A held member row on hand 30 stops that table there with
  `obligation_lock_busy`. Its 20 later hands are skipped, the other table
  still drains, the call takes under 3 s, and the next call finishes the table.

**Law:** `tests/the-projection-worker-never-queues-on-the-table-lock.law.test.ts`.

## Install notes

- **Prerequisite.** #11269's envelope must be live. The migration asserts its
  postimage `39d75365...` and refuses otherwise.
- **Pinned preimages** (read on production 2026-11-18): projection
  `39d043cd...`, drain `6abdcb72...`.
- **Postimages:** projection `1e8eee8f...`, drain `7ae97730...`.
- **Stale pins:** no function carries either preimage md5.
- **Money RPC registry:** `fn_ca_money_rpc_writes_balances` is false for both
  functions today, and neither gains a balance write.
- **Hand-path shared writes:** no shared-row write or blocking lock is added;
  the only change is blocking to try.
- **Install window.** No table DDL, so it installs through the normal applier,
  outside the :50-:03 UTC window.
