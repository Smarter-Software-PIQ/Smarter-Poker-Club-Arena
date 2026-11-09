# Local test harness: full-ring feeder priority (2026-11-08/09)

Plain PostgreSQL 16 copy used to test migrations `20261108193515`,
`20261109010155` and `20261109021129` before and after they reached
production. Not production data; no money paths.

- `fixture.sql`: minimal tables and a reduced copy of `fn_cash_cluster_tick`
  and the buy-in gate that carries the same anchors as production.
- Build: run `fixture.sql`, then the three migrations in order, then create
  `ca_seat_stack_exits (id bigserial, table_id uuid, user_id uuid, stack numeric, exit_kind text default 'left', occurred_at timestamptz default clock_timestamp())`.
- `scenario.sql`: feeder start board trace (`scenario-board-trace.txt`; identical
  with and without `20261109021129`).
- `scenario2.sql`: return on leave and on bust (A, B), 6-max (C).
- `scenario3.sql`: return-then-rejoin (R1-R5).
- `scenario4.sql`, `scenario5.sql`: rejoin before the next tick (D1-D4, E1-E4).
- `conc_setup.sql`, `c3_setup.sql`: states for the two-session concurrency
  cases C1-C4 described in `../../2026-11-08-feeder-rules-live-verification.md`
  section 8.
