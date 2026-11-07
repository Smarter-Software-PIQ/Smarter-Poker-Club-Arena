# tests/retention-passes-an-operator-archived-table.law.test.ts

Dan, 2026-11-07: hand-history retention never selects a hand of a table the operator archived (`tournament_abort_hand_dispositions`), because the archive guard refuses every write there and one such hand rolled back the whole page and stopped the cursor; the restoration-case citations are read once per page. Pinned in migration 20261107224000 and in any later redefinition of `sp_prune_hand_history`.
