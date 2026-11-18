# A migration's pins are checked against production before it merges (incident 075013fd)

**What broke.** #11256 passed every check and merged. Production's applier then refused its
`20261118034950` with 55000 `migration_left_a_stale_pin`:
`smarter_private.original_erased_cash_base_discharge(bigint,text)` pins `b7911a24...`, the body of
`fn_ca_tally_balance_move` the file rewrites. The stale-pin guard (`scripts/ci/migration-stale-pins.mjs`)
ran only inside the applier, after merge, and the merge-time pinning test uses repo fixtures, so the
refusal surfaced at install during an engine release window: revert #11260, re-land #11270.

**The fix.** A new `pins` job ("Migration pins move before merge") in
`window-migrations-install-before-merge.yml`, reusing that workflow's read-only production capture:

- The capture job (default branch, `ci-main`, `default_transaction_read_only=on`) also runs three constant
  queries from `scripts/ci/migration-pins-capture.mjs`: every function's body md5 in both forms the guard
  takes, and every 32+ hex run in every installed function's source (about 0.4 s on production; 10,953
  functions, 3,387 runs on 2026-11-18).
- `scripts/ci/migration-pins-before-merge.mjs rehearse` (secretless job): for each migration the branch adds
  or changes that the applier would guard and still has to install, it sends the file wrapped by the
  applier's own `stalePinGuardSQL` into a throwaway copy restored from production's schema (EXACT). If the
  file cannot install on an empty schema, a STATIC reading decides: the functions it changes (CREATE/ALTER/
  DROP, `pg_temp.*` substitution helpers, preimage and current-md5 literals at statement level) against
  production's md5s and pins, with `-- @stale-pin-ok` read by the applier's own `allowedStalePins`.

**Blind spots.** The exact half has the schema, not the rows, and pins in schemas the archive does not
restore; the static half cannot see a signature built at run time or a function changed only inside an
installed body, and assumes a pinner the same file changes has had its pin moved. Production can move
between this check and the install; the applier's guard stays the last word.

**Proof.** `tests/unit/aMigrationsPinsAreCheckedBeforeMerge.pg.test.ts` rebuilds the merge moment on a
native PostgreSQL (production's definitions from `scripts/ci/fixtures/cash-rake-pending/live-definitions.json`
plus a seeded pinner): #11256's byte-exact original fails both halves, naming the pinner; the re-landed file
passes and installs. Law: `tests/a-migrations-pins-are-checked-against-production-before-merge.law.test.ts`.
