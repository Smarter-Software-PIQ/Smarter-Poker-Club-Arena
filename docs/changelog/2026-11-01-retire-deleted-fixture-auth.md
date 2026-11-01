# 2026-11-01: retire the Auth rows of three erased test fixtures

Five retired test fixtures had erased profiles (status `deleted`, tombstoned
username, both GDPR requests `anonymized`) but kept their Auth rows. The owner
ordered the deletion finished (Dan, 2026-10-31 15:34 and 2026-11-01 00:05
America/Chicago).

- `438192e7` and `905811de` were already soft-deleted in GoTrue. Their four
  erasure requests were completed with `fn_mark_gdpr_completed` (SQL, 05:1x UTC).
- `c81296d4`, `6fd4f8ef` and probebet (`...0091`) still hold a live Auth row.
  `scripts/ci/retire-deleted-fixture-auth.mjs`, started by an operator through
  `retire-deleted-fixture-auth.yml`, soft deletes exactly those three through
  GoTrue's admin API (`should_soft_delete: true`, so the UUID survives for every
  ledger row that names it) and then completes their erasure requests.

The door proves each erasure first (one `deleted` profile, every request
`anonymized` or `completed`) and refuses before any write otherwise. It reads
and writes no wallet, chip or seat row: probebet's 300 diamonds stay in its
wallet. A second run finds every row already soft-deleted and changes nothing.
There is no schedule.
