# A job token cannot start trusted work (2026-11-11)

The independent review of the merge-queue secrets boundary asked for four repairs before the
queue is enabled (items 1, 2, 4 and 6). Dan authorized securing the boundary at 03:19 and 11:38
Chicago. The queue stays off until these land, pass re-review and pass a trial.

## Why

A merge_group run executes the queued commit's own workflow files. A queued change can
therefore write a job that holds the job token and sends `workflow_dispatch` or
`repository_dispatch`. Those events start runs from `main` with `ci-main` secrets. Without a
check at the receiving end, a change that never merged could start production work.

## What changed

1. **Token cap (item 1).** In `ci.yml` the `changes` job ran pull-request code and held
   `actions: write` so it could cancel superseded attempts. It now holds only read access.
   The cancel moved to `retire_superseded`. That job runs only for same-repository pull
   requests and checks out the default branch, so it never runs pull-request code.
2. **Refuse job-token dispatches (item 2).** Every job that holds a secret or an environment
   in a dispatchable workflow now refuses a dispatch whose triggering actor is
   `github-actions[bot]`. Jobs in dispatch-only workflows, and jobs whose own condition
   already admits only a dispatch event, use the short form of the guard. Owner and agent
   dispatches with their own identity are unchanged.

   The trusted job-token senders keep working. Each receiver checks the sender before doing
   anything:

   | Sender                                  | Event                      | Receiver(s)                                |
   | --------------------------------------- | -------------------------- | ------------------------------------------ |
   | `dispatch-merged-migrations.yml`        | `apply-merged-migration`   | `apply-merged-migration.yml`               |
   | `auto-deploy-hetzner.yml`               | `run-post-deploy-e2e`      | `post-deploy-e2e.yml`, `backup-engine.yml` |
   | `gto-v31-qualification.yml` recheck job | `operation=recheck`        | `gto-v31-qualification.yml`                |
   | `stage-engine-release.yml`              | `deploy-club-arena-engine` | `auto-deploy-hetzner.yml`                  |

   For the first three senders, the receiver now proves that the dispatch is the exact intent
   the sender recorded on its own run, and that no earlier run has consumed it. An earlier
   draft accepted any run of the sender that finished within 30 minutes; the owner rejected
   that before merge. See
   [the exact-intent binding](2026-11-11-a-job-dispatch-is-bound-to-its-exact-intent.md).

   The engine receiver keeps its existing selection-run proof through
   `read-engine-prequalification.py`.

   The law `tests/unit/aJobTokenCannotStartTrustedWork.law.test.ts` lists every
   dispatchable workflow and pins this for each one.

3. **workflow_run readers (item 4).** `gto-v31-qualification.yml` recheck-after-release and
   `operational-alert-addressing.yml` live-addressing now require all three:
   - a head repository equal to this repository;
   - `main`;
   - an allowed triggering event (`repository_dispatch`, and `schedule` or
     `repository_dispatch`, respectively).

   Their environment is now plain `ci-main`. The `ci-pull-request` environment was deleted
   with its secrets (#10504), and the environment law now refuses any workflow that names it.

4. **Fork pull requests (item 6).** `money-trigger-recovery.yml` mints its App token only
   for same-repository pull requests. A fork gets a failing check from
   `fork-refused`, which holds no permissions and no secrets. The pull-request reporter also
   refuses a cross-repository head before it creates any check, and a merge group that
   carries any fork entry, or whose origin cannot be read, is never treated as live.

## Pre-merge guard against forks: no ruleset change needed

GitHub enters a pull request into the merge queue only when its branch requirements are met;
otherwise `gh pr merge` only enables auto-merge. The App-posted `Money trigger` check is
required. A fork never receives it, because item 6 refuses forks before the token is minted,
so a fork pull request cannot be enqueued. A same-repository branch requires write access,
which already allows a direct push of workflow files. The queue therefore grants no new
power. A CODEOWNERS or approval requirement would block every lane's self-merge, so none is
proposed.

## Residual risk

See the exact-intent binding record. A cited run alone no longer admits anything.
