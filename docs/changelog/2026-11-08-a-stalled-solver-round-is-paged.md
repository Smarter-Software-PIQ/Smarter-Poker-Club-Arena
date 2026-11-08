# A stalled solver round is paged

2026-11-08. The R8 solver round finished its M1 capture at 07:47Z and then sat
idle for more than 11 hours with nothing paging: the only solver reader runs
once a day and reads "both hosts completed" as a normal parked pipeline, and
the program's own stall limit is 72 hours.

`fn_gto_v31_round_stall_check(6)` (migration 20261108191909), hourly at minute
17, raises one warning Production Alert when the V31 program is `rebuilding`
and its round has recorded no progress for 6 hours. Progress is the newest of
the program decision, the round dataset's stamps, its newest source row, model
preparation, freeze, runtime cell, evaluation epoch or receipt, and the newest
solver host or compactor heartbeat. The page names the last step and the
source rows per machine, points at the round's single writer and at
`~/.smarter-poker/ops/solver-host.sh check`, and resolves itself when the
round moves again or the program leaves `rebuilding`. It only reads; it never
starts or retries solver work.

Native proof (PostgreSQL 17, never production):
`scripts/ci/test-a-stalled-solver-round-is-paged.py`, 11/11 behaviours,
including the exact R8 shape of 2026-11-08. A read-only production replay at
19:2xZ found the same 11.6-hour idle round the alert would page on.
