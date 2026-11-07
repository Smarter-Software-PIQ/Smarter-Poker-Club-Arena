# V31 restarts as R8; a stalled rebuild is Critical; the park's recordings are byte-exact

Dan delegated the V31 decision on 2026-11-07 ("YOU CAN DECIDE ON THE V31 SOLVER
PIPELINE... BOTH COMPUTERS ARE ON"). It was first decided PARK (20261107130621,
13:06 UTC). This reverses it to RESTART, as R8.

## Why restart

- Dan approved the R8 plan on 2026-11-06 (option A, a new evaluation set), and
  its tooling is on main: contract v3 (#9807), ten times the hands (#9735), the
  pinned mood clock (#9734), the strict re-check (#9817, #9852) and the density
  pre-flight (#9856). The park did not weigh any of it.
- The park read the legacy `solver_status` table ("M2 idle since 2026-08-16").
  V31 worker liveness shows both hosts completed R7 on 2026-10-31 (M1 6,099/6,099,
  M2 856/856, 0 invalid). Both answer SSH on the LAN today.
- R7's cash league lost (-3.575 +/- 1.768 bb/100) but its tourney_ev league won
  (+0.566 +/- 0.258), while both tournament paired replays were exactly zero: the
  v2 contract played tables R7 was not keyed for. Contract v3 fixes that, and R8
  is its first playbook.
- Nothing serves until R8 passes every v3 run.

## What changes

- `20261107182648`: `gto_v31_program_state` gains `rebuilding` and `stall_after`
  (72 h). `fn_audit_gto_v31_certified` reports a rebuilding program as one warn
  with the latest time of every stage (worker and compactor heartbeats, bundle
  approval, source artifacts, dataset transitions, evaluation receipts,
  execution anchors, re-check rounds), and as the Critical
  `certified_v31_rebuild_stalled` once none has moved for `stall_after`.
  Serving with no active dataset is Critical in every state and counts open
  bindings only (the park counted revoked ones too). Self-verifies both
  branches inside its transaction. Dry-run against production with ROLLBACK:
  `certified_v31_rebuilding`, last progress 2026-11-07 18:28 UTC.
- `20261107182659`: the hourly `ca-resolve-proven-tournament-finishes-hourly` job
  and `fn_ca_resolve_proven_tournament_finishes()` are retired. #9879 (class 7 of
  `fn_resolve_settled_financial_alerts`) closes the same alarm on strictly
  stronger evidence, including the one that matters: exactly one terminal
  receipt. The hourly resolver would have closed a double payment.
- The six audit migrations already installed on 2026-11-07 (130545, 130621,
  130745, 131013, 140000, 140500) are now production's bytes exactly and are
  rows in `recorded-migrations.manifest.json`.

## Exit condition

Promote when R8 passes every contract v3 run. If R8 loses any v3 cash run, return
the program to `parked` by a dated migration carrying the receipts.
