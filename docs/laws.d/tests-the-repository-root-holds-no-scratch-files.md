# tests/the-repository-root-holds-no-scratch-files.law.test.ts

On 2026-11-26 the repository root held 33 one-off files from August 2026: SQL
pasted for manual runs (`sql_to_run.txt`, `kill_locks.sql`, `get_view.sql`),
single-use patch and fix scripts (`patch_tablepage.sh`, `fix.cjs`,
`fix-buyin.patch`), captured output (`deploy_out.txt`, `response.out`,
`.vitest-full.log`, `test_output.log`), polling loops (`wait_pr.sh`) and an
empty `db_schema.sql`, plus a stray dry-run copy in `scratch/`. Nothing in the repository
referenced any of them, and none held a credential. They were removed. The law
refuses a tracked root file that looks like scratch work (root SQL, patches,
diffs, captured output, one-off fix, patch, kill or run scripts, local
screenshots) and any tracked file under `scratch/`; such work belongs in a
branch or a pull request, not on main.
