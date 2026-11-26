# O32: Every Cycle Has An Owner Or Says So

Lane: release-custody. Follows O27 (PR #12038) and O27b.

## Why It Broke

The 10:00 CST cycle of 2026-11-26 had no owner, and nothing said so. Read from GitHub on
2026-11-26 (UTC in this list because the run records are UTC; the cycle start is 16:00Z):

- The election window of that cycle is 13:50:00Z to 15:50:00Z: the reservation from 13:50Z
  to the cutoff at 15:30Z, then the twenty-minute preparation window.
- Stage runs created by pushes: 45825254280 (13:02:19Z), 45826428013 (13:09:36Z),
  45827342754 (13:15:14Z), 45827378501 (13:15:27Z), 45827415694 (13:15:40Z) and 45827452208
  (13:15:53Z), all before the window, and 45857765392 (16:20:01Z), after it.
- Stage run 45832428826 ("Automatic Backup daily reservation", the completion of successful
  push Backup 45825254356) was created at 13:46:34Z, three and a half minutes before the
  window opened.
- No scheduled Stage run was delivered between 13:00Z and 16:30Z.
- Three Backup completions fell inside the window, and all three were titled "Backup
  completion outside election" with every job skipped:
  - 45842790604 at 14:49:01Z, from push Backup 45827343954, conclusion `failure`;
  - 45846574486 at 15:11:30Z, from push Backup 45827378798, conclusion `failure`;
  - 45850278483 at 15:33:31Z, from scheduled Backup 45845308550, conclusion `failure`.
- So no run claimed the cycle. No selection ran, no readiness or result line was posted to
  issue #11599, the outcome ledger got no record and the owner got no note.

Two defects:

1. **The election asked the Backup for a certificate.** `run-name` and `detect.if` of
   `stage-engine-release.yml` admitted a Backup completion only with
   `github.event.workflow_run.conclusion == 'success'`. Nothing else in the workflow reads
   the Backup that woke the run.
2. **A cycle without an owner was silent.** Every line on the cutover log, every ledger
   record and every owner note is written by the cycle's own owner run or by the receiver
   it dispatches. With no owner, none of them exists.

## The Election As Implemented

Facts read from the code on protected main (`c30522dc8`); line numbers are of that commit.

- **What a claim is.** There is no reservation object. The owner is the lowest-id eligible
  Stage run created inside the window that did not stand down
  (`.github/workflows/stage-engine-release.yml` 294 to 417). The run list is read with
  `created=<window start>..<window end>` (294), so a run created outside the window cannot
  be seen by any other run's election.
- **The window.** `[cutoff - lookback, cutoff + 20 minutes)`, with the cutoff 30 minutes
  before the cycle start and a lookback of 100 minutes three-hourly, five hours daily
  (199 to 239). A run judges itself by its own `created_at` (176 to 188).
- **Eligible runs** (379 to 386): a push or schedule run titled "Daily engine reservation",
  a `workflow_run` run titled "Automatic Backup daily reservation", or, inside the last
  twenty minutes only, the operator's own `repository_dispatch` from a User.
- **Standing down** (336 to 362): a run that finished green, first attempt, more than two
  minutes before the cutoff claimed nothing; a later green one is asked through its job
  record and claimed nothing only when its detect job skipped the cutoff step. A run still
  going, failed, cancelled or replayed keeps the cycle.
- **What the owner binds.** At the cutoff it re-reads main and takes the newest
  first-parent commit before the cutoff as `control` (556 to 558). Its own head does not
  have to be that commit, but its release-control projection must equal the control's (560
  to 566), otherwise it refuses and keeps serving.
- **The receiver's proof** (`scripts/ci/read-engine-prequalification.py` 208 to 260,
  `verify_selection`): the selecting run must be a push or schedule run, the operator's
  dispatch, or a `workflow_run` run titled "Automatic Backup daily reservation" (219); it
  must have been created in `[cutoff - 5 hours, cutoff + 20 minutes)` (236 to 238); it must
  hold exactly one first-attempt job named "Record the daily release evidence" (241 to 245)
  that started and finished inside `[cutoff, cutoff + 20 minutes)` (254 to 257); and its
  artifact `daily-engine-selection-<cycle>` must be unique (259 to 260).
- **The host's reader** (`server/scripts/engine-release-window-doors.py` 476 to 535,
  `install_state`) names the same runs by event and title.
- Assumption, not read from code: that GitHub's run list shows a run within two minutes of
  its creation. The look-back waits that long after a window closes before it judges it.

## The Designs Considered

**(b) A failed Backup completion still elects. Chosen.** None of the three readers reads
the Backup's conclusion; they name runs by event and title. The workflow names
`github.event.workflow_run` on two lines only, the run name and `detect.if`. An owner woken
by a failed Backup does what any owner does: binds main at the cutoff, selects the newest
certified commit or keeps serving, posts the result, starts the O27 Backup and notes the
owner. On 2026-11-26 this gives the cycle to run 45842790604 at 14:49:01Z. It does not
close the gap by itself: a window with no Backup completion is possible.

**(a) The owner chain, inside one run. Not built.** Three facts block it:

- A run can select once. `verify_selection` requires exactly one job named "Record the
  daily release evidence" in the run, executed inside one cycle's twenty-minute window.
  A second selection in the same run is refused by the receiver unless that proof changes.
- A chained owner is invisible to the election. Its `created_at` is outside the next
  window, so every in-window run would also claim. Making it the fallback only works after
  the window has closed, at cutoff + 20 minutes, which is the same instant the selection
  must already have finished.
- It is one link. Jobs are static, so the run that owned cycle N and then N + 1 has no job
  for N + 2. Two quiet windows in a row (an ordinary night) still leave a cycle unowned.

**(c) A job-token election class, or the estate GitHub App as dispatcher. Not built.**
This is the only structural closure: something must create a Stage run inside a window in
which nothing else happens, and the job token is the only identity a run holds. A job-token
`repository_dispatch` does create a run, but all three readers refuse it today, on purpose
(`tests/unit/aJobTokenCannotStartTrustedWork.law.test.ts`). Admitting it means a fifth
dispatch-intent operation, a new run title, and the same new class in the admission step,
in `verify_selection` and in `engine-release-window-doors.py` on the host, which is inside
the engine tree. None of it can be executed outside GitHub, and a wrong election costs a
cutover or risks two owners. The App route needs no reader change, but puts a second
dispatch identity in Stage and depends on a key this change could not check. Neither is
a change to ship unproven; both are written up under "Left Open".

## How It Was Fixed

1. **The election needs an event, not a certificate.** In `run-name` and `detect.if` the
   clause `conclusion == 'success'` became
   `(conclusion == 'success' || conclusion == 'failure' || conclusion == 'timed_out')`.
   Everything else in the clause is unchanged: first attempt, main, this repository,
   `backup-engine.yml`, started by a push (or one of the two titled dispatches). A
   cancelled or skipped Backup stays outside (a superseded push Backup arrives with the
   push that superseded it, which is itself an election event). The run title is the same,
   so no reader of the election changes.
2. **Every Stage run looks back once.** New job `cycle-look-back` (no `needs`, no secret,
   no wait, four minutes at most, `continue-on-error`) runs
   `scripts/release/cycle-without-outcome.py run --post`. For every scheduled cycle of the
   last 26 hours whose election has closed, with no `Cycle: ... / Result: ...` comment on
   issue #11599 and no record on the outcome ledger, it replays the election:
   - `NO OWNER`: no eligible run created in the window held the cycle. Said from the
     window's close plus two minutes, which is eight minutes before the cycle start.
   - `NO OUTCOME`: a run held the cycle and recorded nothing. Said 30 minutes after the
     start, after the receiver and the owner's own jobs have had their time.
   - unknown: a read failed. A warning, nothing posted, nothing recorded.
     It posts one comment per cycle; that comment is the cycle's result, so later runs post
     nothing. It reads the log again immediately before posting.
3. **The owner is told.** New job `cycle-without-outcome-note` (environment `ci-main`,
   job-token guard, runs only when the look-back posted) calls the existing
   `public.fn_ca_note_cycle_did_not_seal`, once per cycle in the database. Wording: "The
   10:00 AM engine cutover on November 26 did not run: nothing started it. The engine kept
   running the current version."
4. **The ledger has no hole.** `cutover-outcome-record` now needs the look-back and passes
   its findings to `cutover-outcome-ledger.py record --gaps`, which writes a `no-owner` or
   `no-outcome` record for each such cycle between the newest record and its own. The
   owner run stays the only writer of the ledger. A gap record is neither a refusal nor a
   reset: the same-gate check and the late seal reconciliation read past it.

## What Stops It Returning

- `tests/every-cycle-has-an-owner-or-says-so.law.test.ts` (new, registered in
  `docs/laws.d/`): the three completions of 2026-11-26 against the run name and `detect.if`;
  every conclusion; nothing downstream reads the waking Backup; no new title, trigger or
  timer; the look-back job's exact condition, permissions and bounds; the note job's guard
  and its two secrets; no release job needs the look-back; the script's windows and names
  equal the admission's; one write only.
- `tests/operations/cycle-without-outcome.test.py` (new, run by the law): the 13 Stage runs
  of 2026-11-26 replayed (NO OWNER at the 16:20Z push, said once; an owner under the new
  rule; an owner that left no result named 30 minutes after the start), both DST days
  (2027-03-14 and 2026-11-01), the stand-down rule, a second caller that posts nothing,
  every unreadable read, the serving-schedule rule, the ledger gaps, and the real command
  against a scripted `gh`.
- `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts`: the admission
  step itself run for 2026-11-26. The 14:49:01Z completion owns `2026-11-26T10` with the
  15:30Z cutoff, the 15:11:30Z completion defers to it by name, and an unreadable run list
  claims nothing. Its pins moved with the change: the refused list no longer holds a
  failed Backup and now holds cancelled, skipped and four more failed shapes; nine jobs
  instead of seven, with no release job needing the two new ones.
- `tests/a-cycle-that-did-not-seal-starts-the-next-one.law.test.ts`,
  `tests/a-window-migration-waits-for-the-daily-break.law.test.ts` and
  `tests/an-owed-engine-release-is-offered-until-production-holds-it.law.test.ts`: their
  exact copies of the election clause carry the new conclusions.

## Verification

- `python3 -B tests/operations/cycle-without-outcome.test.py`: 28 tests, pass.
- Targeted vitest (the repository config cannot load in the authoring environment): every
  test file that reads `stage-engine-release.yml` (30 files) plus the new law and the law
  registry. The failing set is the one protected main has in the same environment, before
  and after: seven tests in four files, caused by missing historic git objects, a missing
  `ws` package or PostgreSQL 17 being absent.
- `stage-engine-release.yml` parses as YAML and passes Prettier, as on main. Both new shell
  steps pass `bash -n`; the note step was run against a scripted `curl` (two failures then
  an answer; three failures; an unreadable cycle).
- Not executed: the workflow. Resting on source pins and local replays only: that a failed
  push Backup's completion is delivered to Stage as a `workflow_run` event with
  `conclusion: failure` (the three runs of 2026-11-26 show GitHub does deliver it, under
  the old title); the `ci-main` environment admitting the note job; the comment and
  artifact reads with the job token; the two-minute run-list margin.

## Live Proof

Pending. Expected after the merge:

- The first Stage run posts nothing new unless a cycle of the previous 26 hours has no
  result on issue #11599. The 10:00 CST cycle of 2026-11-26 qualifies if that run is
  created before about 12:00 CST on 2026-11-27: one `Result: NO OWNER` line and one note.
- The next failed push Backup inside an election window is followed by a Stage run titled
  "Automatic Backup daily reservation" whose detect job is not skipped.
- The next owner run's ledger artifact holds a `no-owner` record for any such cycle.

## Left Open

A window with no push to main, no delivered schedule and no Backup completion still has no
owner. It is now announced at the next Stage run of any kind instead of passing in
silence; it is not prevented. Closing it is design (c) above, a release-authority change
in all three election readers or a second dispatch identity. Smaller limits of this
change:

- Two Stage runs created within the same seconds can both post the line for one cycle.
  Each reads the log again just before posting; the owner note is still sent once.
- A note that fails three immediate attempts is not sent again once the line is on the
  log.
- The first run after the merge can report cycles up to 26 hours old.
- A Backup started by a schedule or by a manual dispatch still does not elect; only a push
  Backup and the two titled dispatches do, as before.
