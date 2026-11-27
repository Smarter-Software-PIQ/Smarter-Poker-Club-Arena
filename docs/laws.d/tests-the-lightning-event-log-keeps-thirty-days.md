# tests/the-lightning-event-log-keeps-thirty-days.law.test.ts

`cash_cluster_events` is the cash cluster and Lightning event log. Until
2026-11-26 it had no retention: 46 GB and about 64 M rows in twelve weeks. No
state is replayed from it, every live reader is time-bounded, and the one that
reaches back ("cluster_frozen since the current epoch began") only needs the
events of a game that is frozen now. Migration 20261126215730 adds the
owner-only pruner `fn_ca_prune_cash_cluster_events` and a 5-minute job at 30
days and 15 000 rows. The law pins the 30-day floor, the owner-only shape, that
one call reads only the lowest ids by primary key and deletes at most 50 000
rows, that a frozen game's cluster_frozen events are kept, the schedule, the
migration laws, the manifest entry, and that no other migration adds an
age-based delete of this table.
