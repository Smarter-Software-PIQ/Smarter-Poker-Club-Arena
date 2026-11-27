# The Estate App Starts The Next Cycle

Lane: release-custody. Follows O25 (`#11946`), O27 (`#12038`), O27b (`#12073`) and the operator fallback (`#12190`).

## Why It Broke

A three-hourly cycle is owned by the first eligible `stage-engine-release.yml` run created inside its election window, `[S - 130 m, S - 10 m)`. Three kinds of event can create that run: a push to main, a delivered schedule, and the completion of a Backup run (`workflow_run`). GitHub delivers few of Stage's scheduled runs (8 of 96 a day on 2026-11-24 and 2026-11-25), so when nobody pushes, the Backup completion is the only event left.

Two Backup runs exist to be that event:

- `Backup after seal <run>-<attempt>`, started by the receiver (`auto-deploy-hetzner.yml`, job `certify-production`) after every seal (O24, O25).
- `Backup after keep-serving <cycle> <nonce>`, started by the cycle owner's Stage run after a cycle that did not seal (O27, O27b).

Both were started with the Actions job token, and GitHub raises no `workflow_run` event for a run the job token started (nine of nine job-token Backup runs from 2026-11-24 to 2026-11-26, recorded in O27b). Their completions created no Stage run. A window with no push had no owner, and the 10:00 CST cycles of 2026-11-25 and 2026-11-26 never ran. The cover since `#12190` is a cron on the owner's Mac that sends the operator dispatch; it works only while that Mac is on.

## The Root-Cause Fix

The two dispatches are sent as the estate GitHub App, `smarter-poker-autopilot[bot]`. A run the App starts raises `workflow_run` like a person's. Nothing else changes: no trigger, no timer, no election rule and no new way to start a Backup.

1. **Stage.** `next-candidate-after-cycle` still waits once, decides, records the intent and publishes it, in `ci-main` (it needs the Messenger note's key). It no longer sends: its token drops to `actions: read`, and it hands the exact body the intent record printed to a new job, `start-backup-as-estate-app`. That job runs in the main-only environment `github-app-main`, mints an App token scoped to this repository and `actions: write`, makes the one POST with it, then reads the run back with the job token and applies the same "never green for nothing" check as before. The App key and the service-role key are never in the same job.
2. **Receiver.** `certify-production` held no environment and no secret. It now names `github-app-main`, mints an App token scoped to this repository and `contents: write` (what a `repository_dispatch` needs), and makes its one POST with it. Every read still uses the job token.
3. **Backup.** The intent proof (first step of `refresh` and `certify`) used to run for every automated account except the App, which was trusted like a person. It now also runs for the App whenever the App's dispatch cites an intent (`inputs.intent_nonce` or `client_payload.intent_nonce`). The same record is proved by the same script: sender run, artifact, exact inputs, one-time title. An App or a person's dispatch that cites no intent is treated exactly as before. The job guards of `refresh` and `certify` are unchanged, so nothing new can start a Backup.
4. **Post-Deploy E2E.** The post-seal dispatch is one event with two receivers. The eleven proof steps of `post-deploy-e2e.yml` get the same clause, so the E2E run still proves the seal's intent now that the App sends it. Without this the proof would have been skipped silently on every seal.
5. **Stage's election needed no change.** Its admission, `scripts/ci/read-engine-prequalification.py` and `server/scripts/engine-release-window-doors.py` count a `workflow_run` run by event and title only. None asks who started the Backup. Stage's job guards refuse the job token on a dispatch event or a re-run; a `workflow_run` run whose actor is the App passes them as written.

## What Happens When The App Token Cannot Be Had

The seal or keep-serving decision is already made when the sending step runs, so a missing App token must leave the cycle exactly where it was before this change.

| Failure                                                                                                                             | What Happens                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The mint step fails (key or variable missing, App uninstalled, permission not granted, GitHub unavailable) or exceeds three minutes | The step is `continue-on-error`. The send goes out with the job token, as before, with the warning `NO ESTATE APP TOKEN, JOB TOKEN FALLBACK`. The Backup still certifies; its completion starts no election; the Mac cron covers. |
| GitHub refuses the App's POST                                                                                                       | The step looks once for the run. If none exists it sends with the job token, with the warning `ESTATE APP DISPATCH FAILED, JOB TOKEN FALLBACK`.                                                                                   |
| GitHub answers the App's POST with an error and starts the run anyway                                                               | The run is found, nothing is sent again (`ESTATE APP DISPATCH ANSWER LOST`). A second send could not be honoured anyway: the intent is proved once.                                                                               |
| GitHub accepts neither identity                                                                                                     | The step fails, as it did before with the job token alone.                                                                                                                                                                        |
| The recorded body does not reach the Stage sending job (GitHub drops a job output it takes for a secret)                            | The job rebuilds the five-field body from the recorded cycle, run, attempt and nonce, with the warning `RECORDED BODY NOT RECEIVED`. Backup still proves it against the record.                                                   |
| The App sent it but GitHub records another actor on the run                                                                         | Warning `ESTATE APP RUN NOT ATTRIBUTED`. The log line says whether the completion will elect, from the actor read back, never from the token used (CLAUDE.md 10.86).                                                              |

No warning here fails the job or pages anyone. The operator fallback on the Mac (`scripts/ops/cutover-operator-preparation.mjs`, `#12190`) is unchanged and stays as the cover for the fallback case.

## What Stops It Returning

- `tests/the-estate-app-starts-the-next-cycle.law.test.ts` (new, 35 tests): both jobs are in `github-app-main` and mint the token the estate way, scoped to one repository and one permission; the App token makes the one POST and nothing else; the two send steps are executed against a stand-in `gh` for a good token, no token, a refused POST, a lost answer and a double refusal; Backup's and Post-Deploy E2E's proof conditions are evaluated for the App, the job token and a person, with and without an intent; Stage's run name and `detect` condition are evaluated for both App-started completions; the three election readers name no actor for a `workflow_run`; no trigger or schedule changed; the Mac fallback is still present.
- `tests/unit/aJobTokenCannotStartTrustedWork.law.test.ts`: the record, publish, send order is now the job graph's (the recording job cannot send, the sending job needs it and sends the recorded body, no other Stage job can dispatch a workflow), and both App-sent receivers must carry the App proof clause.
- `tests/a-cycle-that-did-not-seal-starts-the-next-one.law.test.ts`: its send pins follow the send to the new job unchanged, and the body check now also binds the run id, the attempt and the exact field set.
- `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts`: the Stage job inventory is ten, and nothing needs the new job.
- `tests/unit/workflowJobsReadOnlyMainOnlyEnvironments.law.test.ts` (unchanged) already requires that a job reading the App key sits in `github-app-main` and mints a token.

## Verification

- Run from the worktree with a standalone Vitest config, because the repository config does not load in the authoring environment. The counts are in the pull request.
- The App installation on this organization grants `actions: write`, `contents: write` and `workflows: write` (read 2026-11-27 by the dispatching session).
- That a run the App starts raises `workflow_run` here was read from this repository's own history on 2026-11-27: `Production Integrity Audit` runs 40828219638, 40828254326 and 40828402770 (`repository_dispatch`, actor `smarter-poker-autopilot[bot]`, 2026-10-29) completed at 06:17:00Z, 06:17:20Z and 06:18:58Z, and the listener `Operational alert addressing` started runs 40828272381, 40828307207 and 40828463961 at 06:17:02Z, 06:17:22Z and 06:19:00Z under the same actor.
- Not executed: the workflows themselves. See Live Proof.

## What This Does Not Close

- **A Backup that ends before the window opens elects nothing, whoever started it.** The next election window opens at this cycle's start + 50 minutes. A post-seal Backup with nothing ahead of the sealed build ends in seconds, near start + 7 minutes. A keep-serving Backup that plans nothing or hands the host back ends near start + 26 minutes. Only a run that really certifies (25 to 124 minutes after a start + 25 dispatch) lands inside the window. So a stretch with no push and nothing to certify still depends on a delivered schedule or the Mac cron for its owner, and the O32 look-back still says `NO OWNER` when there is none. That is the election's timing and is not changed here.
- **The environment itself.** The settings of `github-app-main` cannot be read from the authoring session. Existing jobs use it from `schedule`, `workflow_run` and `repository_dispatch` runs on main with no approval, and `move-github-app-key.yml` asserts its branch rule is main only. Both sending jobs only ever run on main. A reviewer rule or wait timer added to that environment later would hold both sends; no step-level fallback can cover that.
- **The App key now reaches two release workflows.** It is read by one step in each, in jobs that check out nothing.

## Live Proof

Pending the first cycle after this merges. Expected, on issue `#11599` and in the run list:

- After a seal: a Backup run titled `Backup after seal <run>-<attempt>` whose actor is `smarter-poker-autopilot[bot]`, the receiver's log line "its completion starts the next cycle's election", the proof step green in `refresh`, and a Stage run with event `workflow_run` created at that Backup's completion (titled `Automatic Backup daily reservation`).
- After a cycle that does not seal: the same for `Backup after keep-serving <cycle> <nonce>`, sent by the Stage job `start-backup-as-estate-app`.
- The first window with no push in which that Stage run is the cycle's owner is the proof that the gap is closed.

## Merge Note

`stage-engine-release.yml`, `auto-deploy-hetzner.yml` and `backup-engine.yml` are release controls (`CONTROL_INPUTS`). This merges only in a merge window, 10 to 27 minutes after a cycle, and makes every existing Backup certificate unselectable until one new certification completes.
