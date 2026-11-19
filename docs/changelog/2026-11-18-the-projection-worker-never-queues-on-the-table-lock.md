# The projection worker never queues on the table lock or a player key (incident 075013fd)

**Migration:** `20261118155509`. **Follow-up to:** #11269 (`20261118073646`),
which named this as still open.

## What was still wrong after #11269

`fn_project_hand_side_effects` is the projection worker's RPC
(`handProjection.ts`, `projectChain`). It banks the hand's deferred rake and
BBJ/insurance obligations (both bankers try-lock), then took three kinds of
key with a blocking `pg_advisory_xact_lock`:

- `hand-post-commit:<table>`, the per-table mutex the envelope also takes;
- `player-stats:<uuid>` for every seated player, in uuid order;
- `hand-projection:<table>`.

The after-function it calls
(`fn_project_hand_side_effects_after_post_commit_20260908`) then took
`player-stats-user:<uuid>` for every seated player of a cash chip hand, also
blocking, after it had already claimed the outbox row and written the club
member projections. The cash commission batch, the cash source retry and the
Midway weekly promo take the same keys.

How long a waiter waited, from the production role settings (read
2026-11-18):

- The worker calls through PostgREST, which connects as `authenticator`
  (`lock_timeout` 8s) and switches to `service_role` (`statement_timeout`
  8s). So a waiting projection held its connection for up to 8 s.
- The global `lock_timeout` is 0, so a direct SQL caller waited until its own
  statement timeout.

Either way one busy table, or one busy player, held a projection connection
and queued every later hand of that table behind it. Measured on PostgreSQL 16
against the production text: with the mutex held for 10 s, 19 of 20 projection
callers time out. A held `player-stats-user` key keeps the projection waiting
until the holder lets go. A writer that holds one player's key and then asks
for another's, in the other order, deadlocks with the projection (40P01).

## What changed

Only `fn_project_hand_side_effects`.

- **Table mutex.** It is tried for at most 250 ms. A busy table answers
  `table_busy` (`retryable: true`, `projection_applied: false`).
- **One 1 s deadline for every other key, from the moment the mutex is held.**
  Every key is tried, never waited on, and the uuid walks stay in uuid order:
  - `player-stats:` (`obligation_lock_busy`, detail `player_stats_lock_busy`);
  - `hand-projection:` (`table_busy`, detail `hand_projection_lock_busy`). Only
    a mutex holder takes it, so it is free; it is tried anyway so the function
    makes no blocking lock call at all;
  - every `player-stats-user:` key the after-function will take, taken
    before it runs (`obligation_lock_busy`, detail
    `player_stats_user_lock_busy`). The after-function's own blocking calls
    then re-enter keys this transaction already holds and never queue. The
    set is the after-function's (the hand's seated uuids, a cash hand at a
    non-Diamond club) or wider, never narrower; the law pins that against the
    production after-function text.
- **Nothing is written before any refusal.** The bankers' passes return early,
  and the `player-stats-user:` keys are tried only once the envelope answers
  already-completed or legacy (a pass that completes it returns
  `predecessor_pending` first). The outbox row stays, and the worker's
  existing deferral comes back for the hand.
- **Order and exactly-once are unchanged.** The outbox delete and the
  projection still happen only under the mutex, after the after-function's
  own predecessor check.
- **Same versioned contract as #11269.** The engine that ships with #11269
  sends `x-ca-post-commit-contract: 2` on this RPC and defers both reasons
  (`isQueuedPostCommitReason`). Every other caller gets `predecessor_pending`
  with the real reason in `queued_reason`. No server change is needed.

## What did not change, on purpose

- **The drain.** An earlier draft of this PR rewrote
  `fn_ca_drain_orphaned_post_commit_envelopes` to walk each table's whole
  backlog in one call. Review refused it: one function call is one
  transaction, so a drain over many hands holds every hand's locks until its
  single commit. The existing drain is kept as it is (it has no schedule and
  no caller; it is an operator's hand tool). If a multi-hand drain is ever
  needed, it has to be a `PROCEDURE` that commits after each hand.
- **The f06 tournament lane.** `smarter_private.f06_wait_table_lane`, called
  before the mutex, keeps its own per-tournament wait (`lock_timeout` 4s on
  that function, shared locks on the tournament's terminal-settlement keys).
  It is a separate lane under the owner's 2026-11-17 ruling and is out of
  scope here; the law names it as the one wait this function still makes.

## Proof

`scripts/ci/test-projection-table-lock-bound-postgres.py` (workflow
`projection-table-lock-bound.yml`) passes 52 checks locally on native
PostgreSQL 16.

**(a) Mutex held 10 s, 20 concurrent projection callers.**

- Before: 19 statement timeouts.
- After, contract 2: zero statement timeouts, every caller answers
  `table_busy` within 0.27 s server-side, all 20 within 0.40 s wall.
- After, contract 1: the same, answering `predecessor_pending` with
  `queued_reason` `table_busy`.
- After release, a worker-shaped drain projects every hand exactly once, in
  hand order, every envelope completes once and the rake is banked once.

**(c) `player-stats-user:` keys.**

- Before: a held key keeps the projection waiting past 1 s; a reverse-order
  holder deadlocks with it (40P01).
- After: a held key answers `obligation_lock_busy` (contract 1:
  `predecessor_pending`) within about 1.0 s and nothing is written; the hand
  then projects exactly once.
- After: the reverse-order holder is no deadlock. The projection gives up
  after 1.013 s and the holder then gets its key.
- After: a tournament hand takes no `player-stats-user:` key.
- After: two hands at two tables with overlapping players, listed in opposite
  orders in each hand, run concurrently in both start orders, 10 rounds each,
  with the after-function holding its keys 0.3 s and 1.5 s: 80 calls, 0
  deadlocks, 0 errors, the slowest wait 1.029 s, 20 bounded refusals, and
  every hand projected exactly once.

**Law:** `tests/the-projection-worker-never-queues-on-the-table-lock.law.test.ts`.
Besides the postimage and lock order, it refuses any later migration that
names `fn_project_hand_side_effects` or its after-function and carries a
queueing lock. It reads the whole file, string literals and dollar bodies
included, so a substitution migration (a `pg_temp` helper, `replace()`,
dynamic SQL, a split `'pg_' || 'advisory_xact_lock'`) is caught as well as a
literal `CREATE OR REPLACE`. Self-tests pin each of those shapes.

## Install notes

- **Prerequisite.** #11269's envelope must be live. The migration asserts its
  postimage `39d75365...` and refuses otherwise.
- **Pinned preimage** (read on production 2026-11-18): `39d043cd...`.
  **Postimage:** `94588bd7...`.
- **Stale pins:** no function in `public` or `smarter_private` carries the
  preimage md5 (read 2026-11-18). Nothing declared.
- **Money RPC registry:** the function writes nothing itself and gains no
  balance write, so no registry row.
- **Hand-path shared writes:** the function is not in the hand doors' call
  closure, and gains no write and no blocking lock.
- **Install window.** No table DDL, so it installs through the normal applier,
  outside the :50-:03 UTC window.
