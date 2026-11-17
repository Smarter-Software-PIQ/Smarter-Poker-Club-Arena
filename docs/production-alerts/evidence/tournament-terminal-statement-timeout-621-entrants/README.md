# Nightly 20K 10d3c9b3: terminal settlement cancelled at 45 s (2026-11-17)

Read-only evidence, production project kuklfnapbkmacvwxktbh, 08:45-08:55Z.

- Tournament 10d3c9b3-52db-4200-8740-bce91b6d7bd5: status RUNNING, last bust 07:05:18Z, 14 durable terminal
  requests (`places`, observed winner baf4b2c4), latest 08:41:04Z `prepared`. No place-1 payout row.
- pg_stat_statements, `fn_execute_tournament_terminal_request`: max_exec_time 44,947 ms, which is the
  function's own `statement_timeout=45s`, not service_role's 8 s. The 07:45Z board comment said the
  function-level setting had no effect. For this call that is wrong: postgres_logs show a statement-timeout
  cancellation about every 46 s (08:36:25, 08:37:11, 08:37:57, ... 08:44:52).
- A live attempt was sampled 20 times over 30 s: `cpu` 19 times and `IO:DataFileRead` once, with no lock
  wait and no blocking pid.
- Bust-ranking CTE for 620 eliminated players: 24 ms.
- The "wallet-credit identity without payout evidence" guard, as on main: a parallel seq scan of
  `wallet_credit_idempotency` (1,899,870 rows) for each of 93 obligations, with 58.9M rows removed per
  worker. It took 19,312 ms with 3 workers and returned 0 rows.
- The same guard with a byte-wise prefix range: 10.9 ms (custom plan) and 7.5 ms (forced generic plan),
  using `wallet_credit_idempotency_key_pattern_idx` and returning the same 0 rows.
- Compile probe: the migration's DO body ran with the target renamed to `pg_temp.fn_settle_places_probe`,
  ending in RAISE. Result: `PROBE_OK anchor_once=1 compiled=1`. Nothing public was created or replaced.
- Some cancellations happened at fn_settle_tournament_places line 839 (the end-state proof), after the
  guard. The remaining per-place work was therefore under 45 s minus the guard time. It was not executed
  in isolation, because it moves money.
