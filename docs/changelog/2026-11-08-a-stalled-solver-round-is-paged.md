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

## A switched-on playbook the serving engine does not use is paged too

After each engine release the strict re-check (#9852, #9913) binds the new
engine to an active V31 playbook. When the new engine's decision code differs
it skips with one line in a workflow summary, and a refused or failed re-check
leaves the engine unbound, so the horses silently play without the certified
playbook. `fn_gto_v31_serving_binding_check(8)`, hourly at minute 19, raises
one warning per (playbook, serving engine) when a promoted, unretired playbook
has no unrevoked binding for the engine that has led for more than 8 hours,
and resolves it when the binding appears, the playbook is retired or another
engine leads. Proof extended to 19/19 behaviours. Today no playbook is
switched on, so it reports nothing until R8 is promoted.
