# A migration fixed in place is dispatched by its merge (2026-11-08)

## What was wrong

`dispatch-merged-migrations.sh` (#9994) dispatched only the migration files a
merged PR ADDED (status added, renamed or copied). On 2026-11-08
`20261108011659_v31_public215_v2_sql_encoding_chain.sql` merged, its install
was refused (nothing applied, no `schema_migrations` row), and #10026 then
#10029 fixed it in the same file. In those PRs the file was MODIFIED, so the
dispatcher answered "no ordinary migration to dispatch" and the fix waited for
a hand install through the ops queue.

## What changed

- The dispatcher now also dispatches every `supabase/migrations/*.sql` the PR
  MODIFIED, in one filename-ordered list with the added ones. Every existing
  guard is unchanged: same-repository, merged, default-branch `if`; checkout
  of the default branch; window files queued, not sent; files absent from main
  skipped; the one bounded break-window wait and the re-check before sending.
- It cannot tell whether a modified file's version is installed: the job holds
  only its own GITHUB_TOKEN, no database credential. The applier reads
  `schema_migrations` and, for an installed version, logs `ALREADY-APPLIED`,
  "Nothing sent. This run changed nothing." and exits 0 (repository_dispatch
  carries no recovery or rake option). So a dispatched modified file that is
  already installed is a harmless no-op; the summary says so, and that the
  edit is then NOT installed.
- A removed file is never dispatched, and a rename sends only its new
  filename, never `previous_filename` (`changedPaths` in
  `scripts/ci/merged-migration-dispatch.mjs`).

## Tests

`tests/a-merged-migration-is-dispatched-by-its-merger.law.test.ts`: status
split (added/renamed/copied vs modified; removed/changed/unchanged never),
the `status<TAB>path` list format, a mixed plan, and the real script run
against a stub `gh` that answers through the script's own `--jq` filter with
the #10029 shape (modified + added + removed + rename): it sends the renamed-to,
modified and added files in filename order and never the removed or
renamed-away one. `DISPATCH_NOW_MS` is a test-only clock the workflow never
sets.
