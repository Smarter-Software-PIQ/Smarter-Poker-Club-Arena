# tests/dark-table-predicate-storm-closure-and-cancelled-settlement-phase2.law.test.ts

Non-dealing `tables.updated_at` writes cannot conceal a stopped tournament table or self-resolve an open dark alert, every versioned `storm:financial_alerts:<source>` incident auto-closes when all member alerts resolve, and conservation-verified cancelled tournaments self-resolve their operational alerts.
