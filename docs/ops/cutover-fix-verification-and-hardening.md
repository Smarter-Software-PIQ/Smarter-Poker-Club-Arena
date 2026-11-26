# How A Cutover Fix Is Verified, Explained And Hardened

This is the close-out method for the three-hourly engine release route (Stage, Backup certification, the receiver, the migration gates) and the record of every fix closed out with it on 2026-11-23, 2026-11-24 and 2026-11-25. The cycle log and the index rows are in `docs/hardening/2026-11-21-dedicated-cutover-hardening.md`. The all-lane version of the method is the section "Close out a set of fixes" in `AGENT-PLAYBOOK.md`.

Times are UTC (`Z`) unless marked CST (America/Chicago). Every SHA, pull request number, run id and status time below was read from git or GitHub on 2026-11-24; a fact taken only from the lane checkpoint or the coordination inbox says so.

## The Owner's Standing Order

Owner (Dan), 2026-11-24 10:35 AM CST, standing. At the end of any set of fixes on the release route, every agent does all six steps before reporting the work done:

1. Test everything the fixes touched for bugs, gaps, stubs, errors, regressions and wiring issues.
2. Confirm each fix is a root-cause fix in the source that owns the behaviour. A cron, a watcher, a retry loop or a loosened assertion is a patch, not a fix.
3. For each fix, write down why it broke and how.
4. Harden each fix so it cannot break or regress: a law or regression test that fails the build, or a guard in the code that performs the action.
5. Record it in this file and in the hardening index.
6. Put this procedure, and a pointer to this file, in EVERY handoff prompt.

Policy lives in Markdown in the repository. It never lives in `.env` or any other credential file.

## Step 1 Checklist For The Release Route

- [ ] **Independent read.** A reader who did not write the change reads each commit line by line, read-only, and reports defects by severity. Done on 2026-11-23 (13:57Z to 14:25Z) and 2026-11-24 (05:20Z to 05:27Z, two read-only readers) for `806ab6b465c3`, `c47823d9e6f4`, `230716c5bd6d`, `4fe5c3b3c770`, `b99bd306892c`, `9d925cbbec48`, `4818a4e1a64c` and `be0c096102ab` (lane checkpoint).
- [ ] **Law harness.** Run every law and operations test that reads a changed file: the Vitest law files under `tests/`, the Python and Node suites under `tests/operations/`, and `tests/no-workflow-gains-a-new-timer.law.test.ts` for any workflow change.
- [ ] **Fails on main, passes on the branch.** Run the new tests against `origin/main`'s copy of the changed source and record the counts in the pull request (examples: `#11889` 5 failed on main, 200 passed on the branch; `#11910` 2 failures and 9 errors on main, 48 of 48 on the branch).
- [ ] **Hosted checks on the final head**, including the ownership check. The pull request body must carry its `Lane:` line; the "Agent Open PR" automation opens the pull request with a generic body first, so set the body with `gh pr edit` (the missing line failed the ownership check on `#11829`).
- [ ] **Full pre-push through `scripts/agent-push.sh`.** Never a plain push.
- [ ] **First live proof from the real run log.** Read the run that first exercised the fix in production and quote its line. A green check is not a live proof. A fix with no live run yet is recorded as "pending".
- [ ] **Consumers enumerated** whenever a certificate, commit status or run title changes meaning. `#11942` lists every reader of the old sealed-SHA certificate; `#11910` applies one rule at all four comparison sites so the selector and the release host cannot disagree.
- [ ] **Control inputs merge in a slot.** A change to a `CONTROL_INPUTS` path merges only between a SEALED post and the opening of the next Stage window, one such pull request per slot unless both are green together.

## Fix Records

Each record gives why it broke, how it was fixed, what stops it returning (files on `main`, or "none yet (OPEN)") and the live proof.

### Stage Election Clock Mismatch (2026-11-23 01:00 CST)

- **Why it broke:** Stage admission judged the window by `repository.pushed_at`, while the election between runs used each run's `created_at`. `c0706e2b3563` was pushed at 04:49:59Z and its run `45114163784` was created at 04:50:01Z; the window opened at 04:50:00Z. The run judged itself outside the window and prepared nothing; every later run deferred to it. No owner, no selection; the certified candidate was never offered.
- **How it was fixed:** `#11836` (`b99bd306892c`, merged 2026-11-23T10:02:15Z): admission and election both use the run's own `created_at`. Draft `#11829` (O18) was closed as superseded.
- **What stops it returning:** `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts`, `tests/operations/engine-release-recovery-window.py`.
- **Live proof:** Stage `45189708244` (push, created 14:01:08Z) owned and sealed the 2026-11-23 10:00 CST cycle.

### O17: Freeze Baseline Already Served

- **Why it broke:** the freeze-baseline reader ignored the serving engine. After a three-hourly seal past the nightly baseline, a later run would claim and soak a build production had already superseded, costing about an hour of the one Backup host.
- **How it was fixed:** `#11844` (`9d925cbbec48`, merged 2026-11-23T14:01:05Z): `scripts/ci/backup-freeze-baseline.py` answers `state=served` when the serving release contains the baseline.
- **What stops it returning:** `tests/the-four-am-build-is-certified-against-the-frozen-copy.law.test.ts`.
- **Live proof:** none recorded (pending).

### O19: Readiness Default Limit (D1)

- **Why it broke:** `scripts/release/three-hourly-readiness.py` walked 10 commits by default. On a busy night an older selectable candidate fell outside the walk and the tool said IN_FLIGHT while `--limit 50` said READY (2026-11-23 08:23Z, lane checkpoint).
- **How it was fixed:** `#11854` (`4818a4e1a64c`, merged 2026-11-23T14:24:45Z): default walk of up to 60 commits with no extra API call, plus a `copyHold` advisory.
- **What stops it returning:** `tests/operations/three-hourly-readiness.test.py`, `tests/the-three-hourly-readiness-cli-only-reads.law.test.ts`.
- **Live proof:** READY verdict on `b99bd306892c` at 2026-11-23T15:00:46Z (lane checkpoint).

### O20: Keep-Serving Cycles Were Not Logged (D3)

- **Why it broke:** only a seal wrote to issue `#11599`. A cycle that kept serving left no record, so the three lost cycles of 2026-11-23 (01:00, 04:00, 07:00 CST) have no comment there.
- **How it was fixed:** `#11856` (`be0c096102ab`, merged 2026-11-23T16:09:31Z): job `cutover-log-keep-serving` in `.github/workflows/stage-engine-release.yml`.
- **What stops it returning:** `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts`, `tests/the-live-engine-only-receives-a-backup-certified-version.law.test.ts`.
- **Live proof:** `#11599` comment 2026-11-23T18:30:48Z (13:00 CST, `Reason: current`, Stage `45230699826`).
- **Known gap (OPEN):** the job runs only when selection succeeds, so a blocked selection, a failed owner or a cycle with no owner still posts nothing (`DESIGN-GHJ.md`, brief G).

### Hand-Gap Incident 1e532243 And The Post-Commit Opponent Read

- **Why it broke:** four engine defects compounded (`#11883` body). After the hand settlement committed, `logHandHistory` awaited an opponent-profile read with a 1,500 ms timeout before the next hand could start. Opponent-memory reads ran inside the tournament's actor and took event-database slots. Any `TimeoutError` was classed as database congestion whatever its elapsed time, which halved tournament concurrency. The between-hand reserve leads were too short at peak load. Every full Backup soak from 2026-11-23T23:34Z failed `hand_gap_unintended_delay_exceeded` (lane checkpoint).
- **How it was fixed:** `#11883` (Alert Root-Fix lane, `74d10c32eb6a`, merged 2026-11-24T05:29:49Z): the post-commit read is detached, observe-only reads run at process root, a timeout counts as congestion only when the call was actually slow, and the two leads were widened.
- **What stops it returning:** `server/src/engine/noUnintendedDelayBetweenHands.law.test.ts`, `server/src/services/supabase/handHistory.test.ts`, `server/src/services/supabase/eventDatabaseBulkhead.test.ts`, `server/src/services/HorseExactOpponentMemory.test.ts`.
- **Live proof:** `74d10c32eb6a` certified 2026-11-24T07:42:29Z (Backup `45341155501`) and sealed 04:00 CST.
- **Still intermittent (OPEN):** `19203b9a1f0b` was refused at 12:47:19Z (Backup `45373629058`) and `56b30273c6c0` at 17:43:28Z (Backup `45439879910`; cash `fold` shape, 290 hands, 15 over the 250 ms budget, p95 889 ms; two showdown shapes also over). `192dc2a33704`, a descendant of `56b30273c6c0` with no fix in between, was certified at 18:49:44Z (Backup `45448751964`). The same code passed one soak and failed another. For the residual delay and for the soundness of the check itself: none yet (OPEN), with PLO-OWNER (check soundness) and Alert Root-Fix (residual delay).

### O22: Freeze Baseline Picked A Stale Refused Build

- **Why it broke:** the baseline advance stopped at the first commit touching `supabase/migrations/`, even when every migration it added was installed before freeze start (05:45Z). On 2026-11-24 the reader answered `due` for `329332c24c32`, which lacked the hand-gap fix; Backup `45336597819` claimed it and was cancelled by hand. The right baseline was `74d10c32eb6a`.
- **How it was fixed:** `#11889` (`0c014cd5c60b`, merged 2026-11-24T13:09:00Z): the advance crosses a migration commit only when the dispatcher's own apply run for each added file completed with success before freeze start; a new answer `state=refused` stops a refused baseline being claimed again.
- **What stops it returning:** `tests/the-four-am-build-is-certified-against-the-frozen-copy.law.test.ts` (O22 block, replay of 2026-11-24).
- **Live proof:** pending (first freeze after the merge starts 2026-11-25T05:45Z). The read-only dry run for 2026-11-24T05:46Z printed `baseline=74d10c32eb6a...` (pull request body).

### O23: Foreign (World Hub) Migrations Staled A Copy

- **Why it broke:** World Hub shares production's migration history table. Its trivia migrations `20261124060500` and `20261124061800` were installed by hand during the freeze. `d749a61e4c94`, certified at 06:29:38Z on an earlier copy, was refused: "Backup copy lacks installed migration". No Club Arena tree ships those versions and the serving engine already ran against them, so the refusal protected nothing and cost the 01:00 CST cycle.
- **How it was fixed:** `#11910` (`c5502245b990`, merged 2026-11-24T13:08:42Z): a version that neither the target's tree nor the control commit's tree ships is left out of the comparison on both sides, at all four sites (selector judge, refresh-due, certified digest, cutover status). Unreadable trees leave nothing out.
- **What stops it returning:** `tests/a-backup-copy-is-certified-by-what-it-holds.law.test.ts`, `tests/operations/backup-installed-migrations.test.py`.
- **Live proof:** 2026-11-24 10:00 CST: Stage `45408673446` selected `7f6e30be571d` although four World Hub trivia migrations (`20261124142200`, `142400`, `142600`, `142800`) were installed after its copy (lane checkpoint); sealed 16:01:32Z.

### Database-Enforced Freeze (#11906, C1 Lane)

- **Why it broke:** only Club Arena's merge dispatcher honoured the 23:45 to 04:15 Chicago release freeze. Hand runs of the applier (2026-11-21, 2026-11-22) and hand installs from another repo through the management API (2026-11-24) changed production under a certified copy.
- **How it was fixed:** `#11906` (`7f6e30be571d`, merged 2026-11-24T13:21:38Z): the applier refuses a hand install inside the freeze, and migration `20261124085047` adds an event-trigger guard that refuses migration DDL from every repo inside the freeze, except the installer routes and a named-outage override that is recorded.
- **What stops it returning:** `tests/a-hand-install-respects-the-release-freeze.law.test.ts`, `tests/the-release-freeze-refuses-ddl-from-every-repo.law.test.ts`, `tests/unit/theReleaseFreezeRefusesDdlFromEveryRepo.pg.test.ts`.
- **Live proof:** the C1 lane read the migration and both event triggers back as installed and enabled at about 13:27Z (`#11599` comment 2026-11-24T13:27:23Z). A refusal of a real hand install inside a freeze has not been observed yet (pending).

### O24: One Certification Attempt Per Cycle, And Export Drift

- **Why it broke:** after every seal the post-seal Backup spent about 48 minutes of the one host certifying the build that had just sealed (`45370915542`, `45399317563`). The selector never reads that certificate, so the next cycle's real candidate got a single attempt. Separately, one schema-evidence difference between the start and end of an export failed the whole run (`45324579997`).
- **How it was fixed:** `#11942` (`cd445e2d0236`, merged 2026-11-24T18:32:29Z): the post-seal run certifies main's newest unshipped candidate (ending in seconds when nothing is ahead), and the export is repeated once after a fixed 45 s pause when the evidence comparison refuses.
- **What stops it returning:** `tests/the-post-seal-backup-certifies-the-next-candidate.law.test.ts`, `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`.
- **Live proof:** pending (needs the first seal after the merge).

### O25: Orphaned Reservations And No Early Warning

- **Why it broke:** the election gives the cycle to the earliest eligible run whatever that run did. A run whose own reads fail claims nothing and ends green, and later runs still defer to it. Nothing told anyone before the cutoff that a cycle had no certified candidate.
- **How it is being fixed:** `#11946`, open, not merged (head `9cbdba03b2e0`): later runs pass over an earlier run that finished green without entering the cutoff step; the owner run comments the cycle's readiness on `#11599` when it reserves and 45 minutes before the cutoff; a successful post-seal Backup completion becomes an election trigger.
- **What stops it returning:** none yet on `main` (OPEN). The tests are in the open pull request.
- **Live proof:** none (not merged).

### O26: Wall-Clock Tests Gating Releases

- **Why it broke:** required checks and the engine prequalification ran tests that assert a duration in milliseconds. On a busy hosted runner they fail with nothing wrong in the code (`HoldemHotpathLatencyBitIdentical`, run `45375939160`: a measured 29.08 ms against a 25 ms ceiling, passed on a rerun of the same commit), which blocks a merge or disqualifies a candidate for a cycle.
- **How it was fixed:** `#11941` (`2a7eacd58868`, merged 2026-11-24T20:13:31Z): the cost bound is a quotient against a reference computed in the same process (limit 0.2), and a law refuses new tight wall-clock bounds in server tests.
- **What stops it returning:** `server/src/testing/theServerSuiteAssertsNoTightWallClockBound.law.test.ts`, `server/src/engine/HoldemHotpathLatencyBitIdentical.law.test.ts`.
- **Live proof:** hosted quotient 0.047 against the 0.2 limit (inbox post 20:13:39Z; not re-read from the shard log here).
- **Residual (OPEN):** 11 older tests of the same class are allowlisted as debt and named in the pull request.

### O21: Migration Installed After The Copy (W8)

- **Why it broke:** a candidate is certified on a copy of production. An ordinary migration that installs after the copy makes the candidate stale and the cycle keeps serving. The deferral `[slot - 90 min, slot + 10 min)` is shorter than a certification that starts early in the cycle.
- **How it is being fixed:** widen the deferral to `[slot - 150 min, slot + 10 min)`, database first. O21a is `#11947`, open, not merged (head `15adcae57593`): the install watch's helper follows 150 minutes. O21b (the dispatcher constant, wait budgets, readiness tool) is a local commit `3b6ed8f5abbd` on `claude/cutover-o21b-dispatcher-defers-150-minutes`, not pushed; it merges only after migration `20261124162837` is recorded installed.
- **Stated trade-off (corrected numbers):** ordinary migrations install only in `[slot + 10 min, slot + 30 min)`. That is 7 install windows a day, 135 minutes in total: six of 20 minutes after the 07, 10, 13, 16, 19 and 22 cycles, plus 04:15 to 04:30. The daytime worst case is 160 minutes from merge to install; a merge between 22:30 and 23:45 Chicago can wait up to 5 h 45 min. Outage installs keep their override route.
- **What stops it returning:** none yet on `main` (OPEN). `tests/the-install-watch-hour-starts-when-the-dispatcher-may-send.law.test.ts` exists on `main`; its 150-minute assertions are in the open pull request.
- **Live proof:** none (not merged). The preimage of the live helper is UNVERIFIED against production (stated in `#11947`).

### Shallow Shared Clone Blocked Full Pre-Push

- **Why it broke:** the shared checkout had been shallow at `d8688a66` since 2026-11-21. A pre-push test that walks history could not, so pushes that changed `server/scripts` were refused (lane checkpoint).
- **How it was fixed:** `git fetch --unshallow` on the shared clone, finished 2026-11-24T10:09:58Z (work-folder log `unshallow.log`).
- **What stops it returning:** none yet (OPEN). The pre-push refusal is fail-safe, but nothing detects a shallow shared clone earlier or names the cause.

### Coordination Inbox Posted To The Wrong File

- **Why it broke:** this lane's posts of 2026-11-24 05:19Z to 06:32Z went to the SSD1 mirror file only. Other lanes read the canonical file on SSD2 and did not see them.
- **How it was fixed:** the posts were re-posted to the canonical file, and the lane now posts only with `node scripts/ops/coordination-inbox-post.mjs`, which writes the canonical file and the mirror and refuses when SSD2 is not mounted.
- **What stops it returning:** `tests/unit/singleDriveLoss.test.ts` covers the helper. Nothing prevents a hand append to the mirror, so the rule is: post only through the helper.

### Post-Deploy E2E Live-Table Job Red

- **Why it is red:** nine-seat table portraits render about 132 px on short phones against an approved floor of 140 px (`below the approved size: 1:132.1<140.0 ...`, run `45404132008`). Job "Live-table and engine verification" failed on the seal runs `45211969793`, `45370915465` and `45399317604`. The lane's diagnosis read failing runs back to 2026-11-20 (not re-verified run by run here).
- **State:** OPEN. This is a product decision (scale on short phones, or hold 140 px everywhere), asked of the owner and posted to the client lane. Nothing was built.
- **What stops it returning:** none yet (OPEN).

### Live Switch Writes In Shadow State Change What A Candidate Is Tested With

- **Why it matters:** the Backup copy carries the option switch rows as they were at copy time. A switch row put into shadow state between a candidate's copy and its verdict changes the conditions of the soak. `56b30273c6c0` and `192dc2a33704` were both copied with a shadow row active (inbox posts 18:20Z to 18:51Z).
- **Rule:** no shadow-state switch writes from a candidate's copy time until its verdict, the same as the migration hold. The lane posts the copy times.
- **What stops it returning:** none yet (OPEN). This is a posted rule in the coordination inbox; no code enforces it.

### 2026-11-25: Six Cycles Lost To A Noisy Hand-Gap Gate (#11959, #12029)

- **Why it broke:** the Backup soak failed a candidate when the 95th-percentile unintended delay of any graded shape exceeded 250 ms. On a 30-minute soak a cell holds 5 to 400 hands, so one slow hand decides the percentile. Byte-identical engine code passed at 09:04Z (`989a07dc`, certified) and failed at 15:30Z (`58227a1b`), 17:03Z (`6aa61507`), 17:50Z (`4d88b3bf`) and 02:13Z (`4311a9ae`, 1 slow hand of 5 and 1 of 7): `git diff 989a07dc 58227a1b -- server/` is empty. With no certified candidate the 07:00 to 22:00 CST cycles kept serving.
- **How it was fixed:** `#11959` (PLO Strategy chat, merged 2026-11-26T02:56Z as `0401a633`): the judge tests the share of hands over budget with a one-sided exact binomial test against a 5% allowance (fail at p below 0.05) and keeps a hard 5,000 ms ceiling on the cell's maximum (p99 as its lower bound on a legacy grader). Under it 11 of 208 and 13 of 167 pass, the 7,632 ms stall still fails. `#12029` (follow-up): the binomial tail is summed in log space; `math.comb(n, i) * rate ** i` raised `OverflowError` from about 1,000 hands in a cell, which would have failed a long soak as a breach for the wrong reason.
- **What stops it returning:** `tests/backup-cert-checks-lifecycle-logs.law.test.ts` (the 2026-11-25 refusals as fixtures, a 2,400-hand cell, the judge constants); `scripts/ci/test-hand-gap-watch.py`. Each certification installs `standby-engine.sh` from its own control commit (`backup-engine.yml`, certify step), so the judge applies to every candidate whose control carries it.
- **Live proof:** pending the first certification after the deferred migration `20261124171043` installs (04:10Z).

### 2026-11-25: The 10:00 CST Cycle Had No Stage Run At All (O27, #12038)

- **Why it broke:** GitHub delivered 8 of Stage's 96 scheduled runs a day on 2026-11-24 and 2026-11-25; every cycle owner on 2026-11-25 was created by a push. After a seal the post-seal Backup's completion starts the next election (O24, O25). After a kept-serving cycle nothing did: the 07:00 cycle kept serving, nobody pushed between 07:50 and 09:30 CST, and no Stage run was created between 13:32Z and 16:37Z. A kept-serving cycle also meant no new certification attempt until somebody merged a server change.
- **How it was fixed:** `#12038`: Stage job `next-candidate-after-cycle` waits once in the owner run to the cycle start + 25 minutes, reads live `/health` and, when the cycle did not seal, dispatches one Backup of main on a fresh copy titled `Backup after keep-serving <cycle>`; Stage admits that completion as an election trigger. Decisions in `scripts/release/next-candidate-after-cycle.py`. The same job sends the owner one plain Messenger line per cycle that did not seal (`public.fn_ca_note_cycle_did_not_seal`, migration `20261126031810` in `#12043`).
- **What stops it returning:** `tests/a-cycle-that-did-not-seal-starts-the-next-one.law.test.ts`; the Stage job inventory in `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts`.
- **Live proof:** merged 2026-11-26T04:51Z (`a5e97180`); pending the first cycle that keeps serving after it. Its migration ships alone in `#12043`, which merges in an install window so it never blocks a certification (Backup refuses a commit carrying a merged migration production lacks).

### O21 Part 2: The Dispatcher Deferral Followed The Watch (#12027)

- **Why it broke:** part 1 (`#11947`) moved the install watch to 150 minutes; part 2 was a local commit that was never pushed, so the dispatcher still held only 90 minutes and migrations merged 94 to 133 minutes before a cycle kept staling certified copies. Building part 2 found a second defect: `threeHourlyDeferralWindow` and `three-hourly-readiness.py` looked only 0 to 2 hours ahead, so the new constant alone would have deferred about 120 minutes while every constant said 150.
- **How it was fixed:** `#12027` (merged 2026-11-26T02:57Z as `cc0b07eb`): constant 150, budgets 175 and 345, job timeout 360, look-ahead derived from the deferral in both places.
- **What stops it returning:** `tests/an-ordinary-migration-waits-for-the-three-hourly-engine-cutover.law.test.ts` counts the admitted minutes of a whole CST and CDT day (exactly 135, in seven runs; 261 on the old look-ahead); `tests/the-install-watch-hour-starts-when-the-dispatcher-may-send.law.test.ts` requires equality with the SQL helper; `tests/operations/three-hourly-readiness.test.py`.
- **Live proof:** `20261124171043` (merged 02:56Z, inside the 22:00 CST deferral) was held and installed at 04:10:08Z, the cycle start + 10 minutes.

### A Held Migration Read As Overdue (#12041)

- **Why it broke:** `check-migrations-are-live.mjs --min-age-hours 24` dated a file by its version stamp. `20261124171043`'s pull request sat a day, so the moment the deferral held it every pull request failed `Installed and merged migrations agree`.
- **How it was fixed:** `#12041`: the grace counts from the later of the stamp and the commit that added the file to main; the job checks out 500 commits (trees only); an unanswerable history falls back to the stamp.
- **What stops it returning:** `tests/a-merged-migration-must-be-live.law.test.ts`.
- **Live proof:** merged 2026-11-26T04:16Z (`895148a1`); pending the next held migration.

### 2026-11-26: The 01:00 CST Cycle Kept Serving Behind A Held Migration (O29)

- **Why it broke:** three commits merged within six minutes at 22:48 to 22:54 CST. `c951436a6ead` was the newest `server/` commit. `a5e971803865` (O27, a release-control change merged by this lane outside a post-seal slot) made it unselectable two minutes later: the selector requires the target's release-control projection to equal the control's. `6f062e8f0d1d` then added migration `20261126021630` inside the hold, which the dispatcher would not install before 04:15 CST. Every push Backup run moved to the newest push (O11) and handed the host back for that migration (O7, run `45758112198`). A hand-dispatched run (`45759269821`) certified `c951436a6ead`, which could no longer be selected. `a5e971803865` itself, control-current and carrying nothing uninstalled, was never certified. The 01:00 CST selection kept serving (`#11599`, 2026-11-26T06:30:48Z).
- **How it was fixed, that night:** Backup run `45769225374`, dispatched by hand with `sha=a5e971803865`, certified it at 01:34 CST. Stage selected it at 03:30 CST and it SEALED at 04:03 CST (`#11599`, 2026-11-26T10:03:04Z). Production `/health` read `releaseSha a5e971803865` at 04:02 CST.
- **How it was fixed, for good:** O29 (`#12070`, in batch `#12083`): before handing back, a Backup run asks once for the newest shippable commit below the held migration (`scripts/release/step-down-past-held-migration.py`: ahead of serving, same release-control projection as the control, nothing of its own uninstalled) and certifies that. An explicit `sha` is never stepped down. Any unreadable answer keeps the old hand-back.
- **What stops it returning:** `tests/a-held-migration-does-not-block-the-commit-below-it.law.test.ts`, `tests/operations/step-down-past-held-migration.test.py` (a real git repository in that night's shape).
- **Lesson for this lane:** a `CONTROL_INPUTS` merge outside the post-seal slot strands every engine commit below it. O27 was merged at 22:50 CST, not in a slot. Release-control changes now go in one batch at the start of a post-seal slot.
- **Live proof:** pending the first real step-down.

### 2026-11-26: O27 Certified Nothing (O27b)

- **Why it broke:** O27's Stage job dispatched `backup-engine.yml` with the job token. Every secret-holding Backup job refuses a job-token `workflow_dispatch`, so run `45775146770` ("Backup after keep-serving 2026-11-26T01") skipped `refresh` and `certify` and still concluded success in nine seconds. GitHub also creates no Stage `workflow_run` run for a Backup run the job token started (nine of nine job-token runs checked, including every post-seal Backup), so no election followed either.
- **How it was fixed:** O27b (`#12073`, in batch `#12083`): the Stage job records a dispatch intent and the Backup run proves it (`scripts/ci/dispatch-intent.mjs`, operation `backup-after-keep-serving`), so the run does its work. The sender then reads the Backup run's jobs and fails if `refresh` was skipped, and a last Backup job is red unless the run certified, planned nothing or was deferred.
- **What stops it returning:** `tests/a-cycle-that-did-not-seal-starts-the-next-one.law.test.ts`, `tests/unit/aJobTokenCannotStartTrustedWork.law.test.ts`, `tests/unit/dispatchIntent.test.ts`.
- **Still open:** the election. A cycle whose window sees no push, no delivered schedule and no person-started Backup has no owner, because a job-token run cannot create the Stage listener run. The same is true of the post-seal trigger from O25. See Open Items.
- **Live proof:** the Messenger note half is proven: the O27 job's note step succeeded at 01:25 CST; its function installed at 04:16 CST (`20261126031810`), so the first delivered note is pending the next cycle that does not seal. The certification half is pending the same.

### 2026-11-26: Shorter Certification With A Judged Memory Gate (#12055)

- **Why:** the soak was 30 of a median 53.7 certify minutes and nothing judged memory; `memoryStart` and `memoryEnd` were recorded and never compared. The hand-gap judge grades at most 15 minutes.
- **How:** soak 1800 s to 900 s on all three surfaces. `judge_soak_memory_growth` samples `/health` `memory.rssMb` and `docker stats` every loop pass and refuses only a sustained median pairwise slope over 141 MiB per minute in the whole soak and over half that in each half. The limit is (26,624 MiB container limit minus 1,243 MiB largest healthy start) over 180 minutes; it is 5.5 times the largest slope in 73 real certificates. Unreadable refuses only after nearly every read on both sources failed. Certificates without the check stay selectable at 1800 s.
- **What stops it returning:** `tests/a-shorter-soak-judges-memory-growth.law.test.ts` (the 73 real certificates are its fixtures).
- **Live proof:** pending the first certification after the merge. Check `memoryGrowthCheck.status`, `source` and a certify job near 39 minutes, then re-derive the limit from the first twenty recorded series.

### O28: A Hand Install Waits For The Same Windows As The Dispatcher (#12050)

- **Why it could break:** the applier enforced only the nightly freeze; a daytime hand dispatch inside `[cycle - 150 m, cycle + 10 m)` staled the certifying copy.
- **How it was fixed:** `scripts/ci/release-freeze-admission.mjs` refuses it with the nightly rule's exceptions; merged 2026-11-26 00:4x CST as `faaf56b81399`. This is the every-cycle hold, built at the applier and not as a database trigger, because World Hub shares the history and its migrations do not stale a copy (O23).
- **What stops it returning:** `tests/a-hand-install-respects-the-release-freeze.law.test.ts` (minute by minute against the dispatcher's predicates, 135 open minutes a day).
- **Live proof:** none expected in normal operation.

### Post-Deploy Portrait Check: A Short Page Keeps Its Own Floor (#12059)

- **Why it was red:** nothing shrank a portrait. The reconnect witness runs on a 390x664 viewport (1021 layout px tall). The full-ring felt is `min(88%, height * 0.725)` wide, so on a page shorter than 1060 layout px the whole felt, and every portrait as a fixed 0.2686 share of it, is narrower: 132.1 px against a 140 px floor measured at 1065.
- **How it was fixed:** `NINE_SEAT_PHONE_MIN_LAYOUT_HEIGHT_PX = 1060` and a measured 132 px floor below it, following the watched six-max precedent. No on-screen size changed and no existing number was lowered. Merged as `73243beb3933`.
- **What stops it returning:** `tests/a-short-phone-keeps-an-absolute-avatar-floor.law.test.ts`, `tests/mobile-avatars-never-ratchet-smaller.law.test.ts`, and a fixture case that fails with the production signature when the height class is removed.
- **Live proof:** pending the next Post-Deploy E2E run that finds a full-ring table. Separate, not addressed: one run (`45399317604`) read 88.4 px because `--sp-opponent-art-scale` had not been applied within the 15 s poll.

### 2026-11-26 Afternoon: Five Refusals, Two Stale Copies, Three Stranded Certificates

- **What happened:** after the 07:00 CST seal every candidate was refused with `rollback_rehearsal_failed_to_132ef19f0770` (runs 45827343954, 45827378798, 45845308550, 45864121079, 45873385564). Two of those (and the O30 run, `cause: from_never_dealt`) reused a copy left frozen by an earlier failed rehearsal. Then `beb889fee8a1`, which contains every Horse commit suspected that morning, passed on a fresh copy (run 45876595076, 13:32 CST). The rollback failure on fresh copies at 07:57 and 11:14 CST is therefore intermittent, not caused by one commit; its exact step is still unknown and O30/O30b will name it the next time it happens.
- **Why 13:00 kept serving:** the only certificate (`13bce958d4c3`) was refused because four Horse option-registry migrations installed at 07:15 CST after its copy was taken. Fixed by O33 (`#12118`).
- **Why 10:00 had no owner:** no eligible Stage run in its window. Narrowed by O32 (failed Backup completions elect) and announced by the O32 look-back, which posted `NO OWNER` and messaged the owner at 12:40 CST.
- **Custody mistakes recorded so they are not repeated:** the O31/O32 batch was merged at 12:40 CST outside a post-seal slot, which made the 13:32 certificate of `beb889fee8a1` unselectable; a 13bce958 recertification was dispatched although its projection could no longer match main, and held the host queue until cancelled. The Custodian Checklist in `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md` now forbids both.

### Fixed Cut-Off Per Cycle: Already Provided By O1 And O16

- **Question:** does every new engine merge restart the certification queue, so a busy hour leaves nothing certified?
- **Answer, read from the code on 2026-11-25:** no. `select-daily-engine.py` walks every first-parent commit from the cutoff control back to the serving build and ships the newest one with valid evidence, so an older certificate stays shippable when newer engine commits land. The mid-soak yield (O1, `backup-engine.yml`) fires only when the release-control projection (`read-engine-prequalification.py` `projection`, `CONTROL_INPUTS` only) diverged or production installed a migration the copy lacks (O16), inside 75 minutes of the cutoff: exactly the cases where the soaking candidate could not be selected. A server-only merge never stops a soak. A waiting run moves to the newest commit (O11), which contains everything older. No separate cut-off is built.
- **What a lane must still respect:** a `CONTROL_INPUTS` merge inside 75 minutes of a cutoff stops the soak in flight. Merge release-control changes in the post-seal slot or before the next election window opens.

## Open Items

| Item                                                                                                       | Owner Lane                               | State                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G: Messenger note to the owner for every keep-serving cycle                                                | Release custody                          | Merged and installed (`#12043`, `20261126031810`, 2026-11-26 04:16 CST); first delivered note pending                                                                                          |
| H: shorter certification                                                                                   | Release custody                          | Built (`#12055`, batch `#12083`); live proof pending the first 900 s certification                                                                                                             |
| I: migration hold per 3-hour cycle                                                                         | Release custody                          | Done at the applier as O28 (`#12050`); a database trigger was rejected, see the O28 record                                                                                                     |
| J: content-based staleness (catalog digest)                                                                | Release custody                          | Deferred; safe only for a narrow class of migrations                                                                                                                                           |
| K: rolling release `#11521`                                                                                | Release custody                          | Parked; six conditions in `DESIGN-GHJ.md`                                                                                                                                                      |
| Second Backup machine                                                                                      | Owner                                    | Declined for now; revisit only if cycles are still lost after O24                                                                                                                              |
| Unexplained engine restart 2026-11-24T03:38:11Z, outside any window                                        | Alert Root-Fix or C1                     | Cause unknown                                                                                                                                                                                  |
| 11 allowlisted wall-clock tests from `#11941`                                                              | Owners of each test file                 | Debt, listed in the pull request; the allowlist can only shrink                                                                                                                                |
| Hand-gap residual delay                                                                                    | Alert Root-Fix                           | OPEN, intermittent                                                                                                                                                                             |
| Hand-gap check soundness                                                                                   | PLO-OWNER, release custody               | Merged `#11959`; overflow hardening `#12029`                                                                                                                                                   |
| O25 `#11946`                                                                                               | Release custody                          | Merged 2026-11-24T22:03Z                                                                                                                                                                       |
| O21a `#11947` and O21b `#12027`                                                                            | Release custody                          | Both merged; helper installed (`20261124162837`)                                                                                                                                               |
| O24 live proof                                                                                             | Release custody                          | Pending the first seal after 2026-11-24T18:32:29Z                                                                                                                                              |
| O22 live proof                                                                                             | Release custody                          | Pending the freeze starting 2026-11-25T05:45Z                                                                                                                                                  |
| O17 live proof                                                                                             | Release custody                          | None recorded                                                                                                                                                                                  |
| O20 gap: no log when selection is blocked or no run owns the cycle                                         | Release custody                          | No-owner cycles closed by O27 (`#12038`); CR1 `#12049` records every outcome                                                                                                                   |
| No shadow-state writes from copy to verdict                                                                | Release custody, Horse SWITCH, PLO-OWNER | Posted rule; not enforced by code                                                                                                                                                              |
| Post-Deploy E2E live-table job (132 px against a 140 px floor)                                             | Client lane                              | Fixed (`#12059`); live proof pending                                                                                                                                                           |
| Election when no push lands in a window (job-token runs create no Stage listener run; affects O25 and O27) | Release custody                          | OPEN. Two designs recorded in `docs/changelog/2026-11-26-o27b-the-keep-serving-backup-proves-its-intent.md`: a job-token election class in the three readers, or dispatching as the estate App |
| Shallow shared clone detection                                                                             | Release custody                          | No guard                                                                                                                                                                                       |

## For The Next Agent

**Where things live (owner's Mac):**

- Lane checkpoint: `/Volumes/SmarterWork/agent-work/extreme-capacity/cutover-3h-25d08aab/CHECKPOINT.md`. Earlier handoff prompts are beside it.
- Work folder (worktrees, logs, `DESIGN-GHJ.md`): `/Volumes/SmarterWork/agent-work/extreme-capacity/cutover-3h-01BNt/`.
- Coordination inbox, canonical (SSD2): `/Volumes/SmarterArchives/agent-evidence/extreme-archive/COORDINATION-INBOX-FALLBACK-20261116.md`. Mirror (SSD1): `/Volumes/SmarterArchives 1/agent-evidence/COORDINATION-INBOX.md`. Read the canonical file. Post only with `node scripts/ops/coordination-inbox-post.mjs`; `node scripts/ops/coordination-inbox-post.mjs targets` prints both paths.
- Cycle log: GitHub issue `#11599`. Route documents: `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`, `docs/ENGINE-RELEASE-RUNBOOK.md`, `PUBLISHING.md`.
- Read-only status: `python3 -B scripts/release/three-hourly-readiness.py`.

**Per-cycle timetable.** A slot `S` is 01, 04, 07, 10, 13, 16, 19 or 22 Chicago time.

| When                    | What                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `[S - 130 m, S - 10 m)` | Stage election window; the first eligible run created inside it owns the cycle                 |
| `S - 105 m`             | Recommended start of the combined migration and release-control hold (cutoff minus 75 minutes) |
| `[S - 150 m, S + 10 m)` | O3/O21: ordinary merged migrations are deferred; they install only in `[S + 10 m, S + 30 m)`   |
| `S - 30 m`              | Preparation cutoff; the owner run selects one certified candidate or keeps serving             |
| `S` to `S + 5 m`        | Engine break and replacement; the SEALED post reaches `#11599` at about `S + 2 m`              |
| `[SEALED, S + 50 m)`    | Post-seal release-control slot: the only time a `CONTROL_INPUTS` change may merge              |
| `S + 25 m`              | O27: when the cycle did not seal, one `Backup after keep-serving` run starts the next election |
| 23:45 to 04:15 Chicago  | Nightly release schema freeze (enforced in the database since `#11906`)                        |

**No timer starts a release.** No timer, watcher or scheduled agent may initiate, advance, retry or certify a release. A cycle that cannot ship keeps serving, and the next cycle tries again. `tests/no-workflow-gains-a-new-timer.law.test.ts` guards the workflows.

**Handoffs.** Every handoff prompt repeats the six steps of the standing order and points to this file.
