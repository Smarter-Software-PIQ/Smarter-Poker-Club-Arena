# The Lightning Lane Never Re-sends After Sending

Dan's follow-up on #10392 (dedicated Lightning database lane), 2026-11-10.

## A correction to #10392's claim

The dedicated `engine_lightning_lane` login isolates **connection usage only**: Lightning no longer queues for a socket in the shared PostgREST pool. It does **not** remove shared CPU, I/O or lock contention. The lane runs on the same database, the same CPU and the same buffer cache, and its functions write relations that tournament and cash code also write.

### Relations the four lane calls write that tournament functions also write

Static read of the function bodies (production, 2026-11-10 22:55Z): the four entry functions and every `fn_*/atomic_*/ca_*/commit_*/settle_*/credit_*` function they call, four levels deep (47 functions). Writes are `INSERT INTO`, `UPDATE` and `DELETE FROM` sites; the number is how many functions named `%tournament%`/`%mtt%` also write that relation.

- `tournament_players` (32), `tables` (16), `table_seats` (16), `financial_alerts` (12), `chip_transactions` (5), `tournament_knockout_candidates` (5), `club_members` (5), `wallet_credit_idempotency` (3).

`tournament_players` and `tournament_knockout_candidates` sit in branches of the shared physical settlement door that a cash Lightning hand does not take. The rest are reached on Lightning's normal path. Row locks conflict only on the same rows, such as the same player's `club_members` wallet row or the same `tables` row; relation-level and index contention is shared regardless. This is a static analysis, not an observed lock graph.

### Load sampled during a top-of-hour tournament start (production)

| UTC      | active backends    | wait events                                       | ungranted locks | running tournaments              |
| -------- | ------------------ | ------------------------------------------------- | --------------- | -------------------------------- |
| 22:56:05 | 11 of 83 (max 480) | CPU 10, DataFileRead 1                            | 0               | -                                |
| 22:57:44 | 6                  | CPU 5, DataFileRead 1                             | 0               | -                                |
| 22:59:00 | 10                 | CPU 7, DataFileRead 1, WalSync 1, advisory lock 1 | 1               | 13                               |
| 23:00:57 | 4                  | CPU 4                                             | 0               | 13 (1 started in the last 5 min) |

- Buffer cache hit ratio: 97.79 % (pg_stat_database, cumulative).
- `fn_lightning_settle_hand` from pg_stat_statements deltas: 308 calls, mean 93 ms (22:56-22:59); 210 calls, mean 108 ms (22:59-23:01).
- `track_io_timing` is off, so pg_stat_statements carries no I/O time. Its cumulative totals also shrank between samples (entries evicted), so whole-database deltas are not reliable. Host CPU percentage is not readable from SQL.

**What this shows:** at this hour the database was mostly on CPU with very few active backends and no lock queue. It was a small burst, not the #10361 storm, so it says nothing about headroom under a storm. Under a storm, Lightning still competes for CPU, I/O, WAL and the shared rows above.

## Safety properties, checked on the code and the database

- **Permissions:** recorded on production after #10392's migration. The lane login has EXECUTE on the private wrapper only, cannot call `fn_lightning_settle_hand` directly, is not a member of service_role, and the URL reader is service_role only. This change touches no SQL.
- **Bounded connections:** at most 6 sockets per engine process; role connection limit 16. Two processes (a release overlap) hold 12. A third process would find the limit, fail `start()` and stay on PostgREST for its whole life, because `start()` runs once at boot. A socket lost and reopened later when the limit is reached fails at acquisition, which is before sending, so the call goes to PostgREST. At 22:55Z production had only the 4 fold-lane sessions from one Supavisor address and no lane sessions.
- **Timeouts (fixed here):** the role has `statement_timeout` 8 s and `lock_timeout` 4 s. #10392's `BEGIN` set `SET LOCAL statement_timeout` to the engine's 15 s client timeout, which overrode the role's 8 s. It is now `min(client timeout, 8 s)`, matching the shared path's service_role 8 s; `lock_timeout` 4 s is below the shared path's 8 s. The same 15 s override exists in the fold lane (`lightningFoldSession.ts`); it is not changed here and is reported to its owner.
- **Pool saturation:** no queueing. The seventh concurrent call, or an acquisition slower than 100 ms, is refused **before sending**. A socket that arrives late is released unused.

## Ambiguous outcomes (fixed here)

#10392 re-sent one class of call through PostgREST after the lane had sent it: a database error whose `COMMIT` answered `ROLLBACK` returned "not sent". That transaction did not commit, but the call did reach the server. Now a lane call has exactly three outcomes:

| Outcome                                    | When                                                                                                                                        | Through PostgREST? |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| NOT SENT (`null`)                          | not ready, credential absent, disabled, pool full, acquisition failed or over 100 ms                                                        | yes, once          |
| ROLLED BACK (`LIGHTNING_LANE_ROLLED_BACK`) | the database refused and the `COMMIT` answered `ROLLBACK`                                                                                   | no                 |
| UNKNOWN (`LIGHTNING_LANE_UNKNOWN`)         | socket lost after `BEGIN`, after the statement, or after `COMMIT` was sent; an error whose rollback was not confirmed; the request boundary | no                 |

The last two reach the caller as the same transport failure a PostgREST error is today. The caller resolves them from the operation's own durable record, never by a blind resend:

- **settle:** retried with the same request id and identical arguments, so the same `settle_request_hash`. `fn_lightning_settle_hand` returns the stored `settle_receipt` as a replay if the first attempt committed, and `already_settled` if the hash differs.
- **match-and-form:** re-asked with the same request id. `fn_lightning_match_and_form` returns the stored `cash_cluster_matcher_pass.result` with `replayed: true`.
- **begin dealing and bind:** never re-sent. The host abandons the instance, and abandon is keyed by the instance id. Bind also replays on the same instance and hand number.

A refusal raised by the wrapper itself also disables the lane, so later calls are refused before sending.

**Tests do not prove at-most-once.** They prove the code's decisions at each simulated failure point: 24 lane tests (acquisition failure, late acquisition, saturation, loss after `BEGIN`, after send, after `COMMIT` sent, an unconfirmed rollback, the request boundary, a confirmed rollback, a wrapper refusal, the 8 s budget) and 4 backend tests (PostgREST used only when nothing was sent; a retry carries the same request id). At-most-once is proven only in production by:

1. no `lightning_hand.settle_request_id` that settled more than once, and no hand whose settlement appears both as a lane commit and as a later non-replay PostgREST settle;
2. `cash_cluster_matcher_pass` showing one row per request id, with every re-ask marked `replayed`;
3. `poker_lightning_lane_unknown_total` and `_rolled_back_total` compared with the host's settle replays for the same window.

## Engine inclusion

The engine half activates only with a selected, certified candidate. This lane neither selects nor dispatches one.
