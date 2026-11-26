# tests/the-bbj-drift-alarm-reads-its-window-once.law.test.ts

`bbj_drift_since` is the hourly alarm that compares every chip `rake_records`
books as a BBJ contribution with what reached `bbj_contributions`. It runs as
the service role, whose statements stop at 8 s. On 2026-11-26 a cold call took
10.7 s and was cancelled, so the alarm did not run. The day's BBJ-bearing rows
were fetched from the 6 GB `rake_records` heap, and the inlined CTE probed the
bank once per hand twice. Migration 20261126203947 adds the covering partial
index `idx_rake_records_bbj_window_cover` and materializes both CTEs; the
migration proves the new body returns the same answer as the old one on live
data before it commits. The law pins the signature and invoker shape, that
every CTE is materialized, that `rake_records` is read once, that the 6 minute
settle grace, the join by hand and the unlinkable count keep their meaning,
and that the index stays declared and is never dropped.
