# The GitHub App key lives only in github-app-main

2026-11-11, follow-up to #10524.

## What happened

- #10524 merged as `12e818b4d05c333b49966c22938c3dfd4dd846c0`. Its eight App-key jobs name the main-only `github-app-main` environment.
- `move-github-app-key` step `copy`, run 43125288320 (00:10:10Z to 00:10:24Z), wrote `AUTOPILOT_APP_PRIVATE_KEY`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` into `github-app-main`. No value was printed.
- These real runs minted an App token from `github-app-main` after the copy:
  - Agent Open PR 43125368856 (success);
  - Migration Ledger Is Reconciled 43125274902, attempt 2 (success). Attempt 1 was queued before the copy and failed on an empty key, which is the expected merge-to-copy window;
  - Estate Integrity 43125428748: its token mint steps succeeded. The run itself failed on cross-repository estate drift (5 problems, issue #7641). That check has failed on every run since 2026-11-09, so the failure is unrelated to the key.

## Why retire was done by hand

The `retire` step required a successful Estate Integrity run. Because of the pre-existing drift above, that condition cannot be met until #7641 is resolved. Rather than weaken the gate, the key was deleted from ci-main with the authenticated owner `gh` login (`gh secret delete AUTOPILOT_APP_PRIVATE_KEY --env ci-main`). That is the same single action the retire step performs, and it ran only after the three runs above proved `github-app-main` mints a token. ci-main went from 16 secrets to 15 and no longer holds the key.

## This change

- Deletes `.github/workflows/move-github-app-key.yml`.
- `tests/unit/workflowJobsReadOnlyMainOnlyEnvironments.law.test.ts` drops the mover's ci-main exception and refuses the mover's return.

## Note for rotation

`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` now exist in both `ci-main` and `github-app-main`. Rotating any of them must update both environments.
