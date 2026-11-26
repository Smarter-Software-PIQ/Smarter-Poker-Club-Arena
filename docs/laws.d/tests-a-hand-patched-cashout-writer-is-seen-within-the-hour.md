# tests/a-hand-patched-cashout-writer-is-seen-within-the-hour.law.test.ts

The four cashout writers were installed from the weekly-v3 component
20260914164700 and, by recorded decision, have no mirror in
`supabase/migrations`. Their repo-side proof is the read-only
`cashier-release-contract.sql`, which pins each body by md5 with the cashier
grants, policies, triggers and indexes. Until 2026-11-26 it ran only after a
client publish, so a body changed straight in production stayed unseen until
the next release. The hourly Schema Integrity Audit now runs it, opens one issue
when it fails and closes it on the next clean run. The law pins the job, its
alarm, and that the contract stays read-only and names all four writers.
