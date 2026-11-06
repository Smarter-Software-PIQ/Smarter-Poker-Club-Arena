# The Free Buy cutoff proof runs in CI (2026-11-06)

`scripts/dev/test-free-buy-cutoff-postgres.sh` starts a throwaway
PostgreSQL 17 cluster and runs the native proof of migration
`20261106195136` from `scripts/dev/free-buy-cutoff/`. That covers Dan's
six-row acceptance table, mystery and PKO, the three legacy in-flight shapes,
retries, unregistration and promo conservation. It fails on any FAIL and on
fewer than 16 passing checks.

CI runs it on every change, in `accounting_postgres` shard 2 (step "Free Buy
promo money moves at the cutoff, never at sign-up").
`tests/unit/requiredCiRunnerRecovery.test.ts` pins the step in the exact shape
and position its other additions use. The cutoff law test now also requires
the CI caller.

Measured locally on PostgreSQL 16: 16 checks passed. Every repo test that reads
`.github/workflows/ci.yml` gives the same failures on this branch as on main
(all of them are environment-only on this machine), except the fingerprint
test this change updates, which passes.
