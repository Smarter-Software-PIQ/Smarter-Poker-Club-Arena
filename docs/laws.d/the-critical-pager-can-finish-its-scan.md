# tests/the-critical-pager-can-finish-its-scan.law.test.ts

2026-11-07: the critical pager (fn_sp_critical_scan, every five minutes, 8 s service-role budget) timed out on every call for at least 36 hours because the Midway promo runway read scanned ~628k unrelated union-wallet ledger legs a week. Migration 20261107203405 adds a partial covering index over exactly the runway's three leg shapes and refuses to install unless EXPLAIN of that read uses it. The read and the index stay in step; nothing is scheduled and no budget is raised to hide a slow read.
