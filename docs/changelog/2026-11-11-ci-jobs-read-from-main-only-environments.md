# Secrets live in main-only environments, ahead of the merge queue

Owner authorization: 2026-11-11 03:19 America/Chicago ("I authorize the necessary secret-store and workflow changes to protect production credentials").

## Why

A merge-group run executes the workflow files in the queued commit, which can come from a fork pull request, inside the base repository with every repository-scoped secret available. Environment branch rules are matched against `GITHUB_REF`; a merge group's is `refs/heads/gh-readonly-queue/main/...`, which matches neither `main` nor `refs/pull/*/merge`. So moving every secret into such environments takes them out of a merge group's reach.

## Inventory (names only)

- Repository secrets (21): AUTOPILOT_APP_PRIVATE_KEY, CA_ORIGIN_HOST, CA_ORIGIN_HOST_KEY, CA_ORIGIN_SSH_KEY, CA_RECORD_GATEWAY_SSH_KEY, DATABASE_URL, GH_PAT, HETZNER_HOST, HETZNER_HOST_KEY, HETZNER_SSH_PRIVATE_KEY, INTERNAL_API_KEY, PRIVATE_RECORD_GATEWAY_DB_PASSWORD, PROBE_EMAIL, PROBE_PASSWORD, SP_EMAIL, SP_EMAIL_2, SP_PASS, SP_PASS_2, SUPABASE_DB_PASSWORD, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL. GH_PAT, PROBE_EMAIL, PROBE_PASSWORD, SP_EMAIL_2 and SP_PASS_2 have no workflow consumer.
- Organization secrets visible to the repository: 0.
- Existing environments: HorseCorrectiveQualification (HORSE_PHASE14_QUALIFICATION_SIGNING_KEY; branch rule main), money-trigger-recovery-trusted (MONEY_TRIGGER_REPORTER_PRIVATE_KEY; branch rule main), Production (no secrets; branch rule main; not used by any workflow).
- Consumers: 108 jobs in 57 workflows read repository secrets. 16 of them run on `pull_request` (same-repository only; GitHub withholds secrets from fork pull requests).
- Trusted-path audit: jobs started by `workflow_run` from workflows that run on merge groups (CI, Money Trigger Merge Group Request) check out the default branch and use head SHA/branch as data only (agent-autopilot, money-trigger-recovery). Every other `workflow_run` consumer listens only to main-produced runs, and artifacts are downloaded only from those. Caches written on queue or pull-request refs are not readable by main runs.

## Change

- New environments: `ci-main` (branch rule `main`) and `ci-pull-request` (branch rule `refs/pull/*/merge`).
- 100 jobs in 54 workflows now name an environment: `ci-main`, or for workflows that also run on `pull_request`, `ci-pull-request` on that event and `ci-main` otherwise. The native fixture job names `ci-main` only in its connected (workflow_dispatch) mode, and none on pull requests or merge groups. Jobs already in the two signing environments keep them.
- `copy-repository-secrets-to-environments.yml` (workflow_dispatch, main only) copies each repository secret into ci-main, and the needed subsets into ci-pull-request, HorseCorrectiveQualification and money-trigger-recovery-trusted, with the autopilot App token (secrets:write, environments:write). It first asserts every target's branch rule. Values never leave GitHub and are never printed.
- `tests/unit/workflowJobsReadOnlyMainOnlyEnvironments.law.test.ts` refuses a secret-reading job without an allowed environment, and any secret path into a merge-group job.

## Order

1. Merge this change (repository copies still back every job, so nothing breaks).
2. Run the copy workflow once.
3. Verify real runs on the environment copies: publish, migration dispatch/apply, money-trigger verification.
4. Delete the repository-level secrets, verify the same runs again, then delete the copy workflow.
5. Only then add the merge queue rule and run the controlled trial.

- Five repository secrets have no workflow consumer and are not copied anywhere: GH_PAT (a retired long-lived token the watchdog law forbids any workflow to name), PROBE_EMAIL, PROBE_PASSWORD, SP_EMAIL_2 and SP_PASS_2. They are deleted with the rest of the repository-level copies.
- `scripts/ci/spent-dss-recording.mjs` pins the bytes of `applied-migrations-recorded.yml`; its pin moves to the version whose only change is `environment: ci-main`.

- The copy ran once (run 43035791787) and the mover was then deleted; the law now pins its absence.
