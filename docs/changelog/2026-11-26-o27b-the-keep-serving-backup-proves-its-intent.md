# O27b: The Keep-Serving Backup Proves Its Intent

Lane: release-custody. Follows O27 (PR #12038, merged as `a5e97180`).

## Why It Broke

O27 said: when a three-hourly cycle does not seal, the cycle owner's Stage run starts one
Backup titled `Backup after keep-serving <cycle>`, that run certifies the next candidate, and
its completion starts the next cycle's election. On its first live use, the 01:00 CST cycle of
2026-11-26, it did neither.

The facts, read from GitHub on 2026-11-26 (UTC in this list because the run records are UTC):

- Stage run 45757793966 (push, created 04:51:03Z) owned the cycle. Its job "Start The Next
  Cycle When This One Did Not Seal" ran 06:30:48Z to 07:25:14Z, succeeded, and dispatched
  Backup run 45775146770.
- Backup run 45775146770: event `workflow_dispatch`, actor and triggering actor
  `github-actions[bot]`, title `Backup after keep-serving 2026-11-26T01`, created 07:25:02Z,
  completed 07:25:11Z, conclusion `success`. Jobs: `plan` success (07:25:06Z to 07:25:10Z),
  `refresh` skipped, `certify` skipped.
- **What skipped them.** `plan` ran its `plan` step for a `workflow_dispatch` (the seal steps
  and the inherit step were skipped as they always are for a dispatch), so
  `needs.plan.outputs.sha` was the dispatched commit `cc88b0de85b3` and not empty. The only
  clause of `refresh.if` left to be false is the job-token refusal,
  `!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && (github.actor == 'github-actions[bot]' || github.triggering_actor == 'github-actions[bot]'))`,
  whose one exception then was the seal's `repository_dispatch`. `certify.if` carries the
  same clause (its other terms, `always()`, a planned commit and "not deferred", all held).
  The refusal worked as designed; O27 sent a dispatch the guard exists to refuse.
- **The run was green.** Two skipped jobs and one passed job conclude `success`. A run that
  certified nothing reported the same as one that did (CLAUDE.md 10.86).
- **No election followed, and none could have.** The next Stage runs after 07:25:11Z are
  45775591934 (a push, 07:28:36Z) and 45775645595 (`workflow_run`, 07:29:04Z, from a Backup a
  push started). Nothing was created for 45775146770. This is not a Stage condition filtering
  the event: Stage's `detect.if` and `run-name` admit that title (the O27 law test proves the
  expression), and a filtered event still leaves a skipped Stage run titled "Backup completion
  outside election". GitHub created no run at all, because it creates no `workflow_run` event
  for a run the job token started. Measured over every Backup run in the listing window:
  - Started by the job token, no Stage `workflow_run` run within three minutes of completion
    and none in `owner-window-ready.yml` either (the other listener of the same workflow):
    45775146770, and the post-seal Backups 45565107439, 45544078518, 45522710215, 45497108697,
    45399317563, 45370915542, 45211969461 (and 45432467711 for Stage; the one
    `owner-window-ready.yml` run near it coincides with another completion). Nine of nine.
  - Started by a person, a Stage `workflow_run` run within seconds every time, even for runs
    that skipped everything in two seconds: 45696848341 to 45696864630, 45665331050 to
    45665352991, 45759269821 to 45766878262, 45746347783 to 45753404564, 45458766853 to
    45461178672, 45373629058 to 45396931237, 45341155501 to 45350081076, 45188945088 to 45199994877.
- So the O25 claim that the post-seal Backup's completion is an election trigger was also
  never true: every post-seal Backup is started by the receiver's job token. Every cycle owner
  since O25 came from a push or a delivered schedule.
- **Timing.** O27's arithmetic was sound for a real certification (dispatch at start + 25
  minutes, about 71 minutes of work, completion near start + 96, inside the election window
  `[start + 50, start + 150)`). The nine-second completion landed before the window opened
  only because the run did no work.

## How It Was Fixed

1. **The dispatch is the exact intent Stage recorded.** `scripts/ci/dispatch-intent.mjs` gains
   one operation, `backup-after-keep-serving` (sender `stage-engine-release.yml` on the four
   events that can own a cycle; inputs exactly `after_cycle` and `refresh=true`), and one
   receiver of the same name (`backup-engine.yml`, `workflow_dispatch`, `sha` must be empty,
   title `Backup after keep-serving <cycle> <nonce>`). Stage's `next-candidate-after-cycle`
   job now decides, then records the intent, then publishes it as the artifact
   `dispatch-intents-<run_attempt>` of its own run, then sends the body the record printed.
   It is the fourth trusted sender, built like the other three.
2. **Backup admits exactly that event and proves it first.** `refresh.if` and `certify.if`
   gain one exception beside the seal's:
   `(github.event_name == 'workflow_dispatch' && inputs.after_cycle != '')`. Their first step,
   the existing proof, now also runs for `workflow_dispatch` and proves receiver
   `backup-after-keep-serving`. `backup-engine.yml` declares the three `intent_*` inputs, and
   its run name carries the nonce the one-time rule needs while keeping the prefix Stage's
   listener matches. A job-token dispatch without `after_cycle` is refused as before; one
   with `after_cycle` and no valid intent fails its first step and reads nothing. A person's
   manual dispatch, with or without `sha`, is unchanged.
3. **Never green for nothing.** A run carrying `after_cycle` ends with the job
   `keep-serving-outcome` (no token, no secret): red unless the run certified, planned
   nothing, or handed the Backup host back (deferred). The Stage job also reads the jobs of
   the run it started (bounded, about four minutes) and fails when `refresh` was skipped; when
   it cannot read them it says so as a warning and never as success.
4. **The election claim is withdrawn, not patched.** The job-token route cannot start an
   election, by the election's own design: its three readers (Stage's admission step,
   `scripts/ci/read-engine-prequalification.py` used by the receiver's proof, and
   `server/scripts/engine-release-window-doors.py` on the host) count only events a job token
   cannot create. Teaching all three a new job-token class is a release-authority change
   inside the engine tree and is not made here. The job, the script, the law and the cutover
   document now say what the Backup gives the next cycle (a fresh certificate, written about
   54 minutes before the cutoff) and what it does not (an election run).

## What Stops It Returning

- `tests/unit/aJobTokenCannotStartTrustedWork.law.test.ts`: exactly four operations and five
  receivers; Backup admits exactly two events; the new sender is listed and refuses a job-token
  re-run; record, publish and send happen in that order; both Backup jobs carry the widened
  guard and prove both receivers first; only `refresh`, `certify` and the secret-free outcome
  job name `after_cycle`. The pinned lists `SENDERS` and `ADMITTED` were extended for this one
  sender and this one event; no pin was weakened.
- `tests/unit/dispatchIntent.test.ts`: the recorded dispatch is admitted from each owner
  event; another cycle, `refresh=false`, a chosen `sha`, an extra input, a missing intent (the
  shape of run 45775146770), a replay, a title without the nonce, a queue-branch sender, the
  seal's receiver and every wrong sender file or event are refused.
- `tests/a-cycle-that-did-not-seal-starts-the-next-one.law.test.ts`: the intent steps and
  their order, the admitted event and proof on both jobs, the run name with and without the
  nonce, the outcome job run against eight outcomes (the live one red), the Stage job's
  skipped-refresh failure, and the arithmetic (dispatch + 25, certification 71, certificate at
  - 96, cutoff + 150, a three-minute run never inside the window).
- `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`: its three exact pins of
  `refresh.if` and `certify.if` carry the new exception.

## Verification

- Targeted vitest (the repository config cannot load in the authoring environment): the three
  files above, 201 tests, pass. Every test file that reads either workflow or the intent
  script (41 files) and every test that enumerates all workflow files (80 files) fail only
  where protected main already fails in the same environment (missing historic git objects,
  a missing `ws` package, PostgreSQL 17 absent); the failing set is identical before and
  after.
- The related Python suites under `tests/operations/` pass.
- Both workflow files parse as YAML. `stage-engine-release.yml` passes Prettier as on main;
  `backup-engine.yml` and `dispatch-intent.mjs` already fail it on main and were not
  reformatted.
- Not executed: the workflows themselves. The receiver proof for a `workflow_dispatch` rests
  on the unit tests and on the shape GitHub gives `event.inputs`; `sha` now declares an empty
  default so an unset input arrives as an empty string, as the proof requires.

## Live Proof

Pending the next cycle that does not seal after this merges. Expected: one Backup run titled
`Backup after keep-serving <cycle> <nonce>` whose `refresh` and `certify` jobs run and whose
`keep-serving-outcome` job is green with "was refreshed and certified", a
`backup-engine/certified` status on the dispatched commit, and no Stage `workflow_run` run
from its completion.

## Left For A Release-Authority Decision

A cycle with no push, no delivered schedule and no person-started Backup inside its election
window still has no owner. Only an identity that is not the job token can change that. Two
routes exist: send the Backup dispatch as the estate GitHub App (key in the main-only
environment `github-app-main`; its events do start workflows, and it started dispatched runs
here until 2026-10-31), which needs no guard change but puts an unbound dispatch identity in Stage;
or add a job-token election class to all three readers above, engine tree included. Neither
was authorized for this change.
