# tests/hot-tables-autovacuum-tuning.law.test.ts

Enforces tighter per-table PostgreSQL autovacuum/autoanalyze thresholds (`0.02` / `0.01`) on high-churn dealing and ledger tables (`tables`, `table_seats`, `chip_ledger`, `hand_state_snapshots`, `ca_hand_gap_watch_history`) plus `fillfactor = 80` on `tables` and `table_seats` to prevent index bloat and sudden sequential-scan planner flips.
