# Readiness Sees Every Install (2026-11-27)

Lane: release custody (engine cutover every three hours). O36b, a follow-up to O36 (`#12218`) and O36a (`#12249`).

## What The Review Found

An independent review of `scripts/release/three-hourly-readiness.py` compared it with the real selector (`scripts/ci/select-daily-engine.py` and `server/scripts/engine-release-installed-migrations.py`). Each finding was checked against the code and, where it applies, against GitHub's own record of the 04:00 window of 2026-11-27 (Stage run `45963036602`, window installer job `140421831827`). All eight were real, and one test gap beside them.

| #   | Severity | What Was Wrong                                                                                                                                                                                                        |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | Stage runs were listed from one hour before the copy. Run `45963036602` was created 02:05:43 CST and installed at 04:00:30 CST; a copy restored between the two read fresh while the selector refused it.             |
| 2   | High     | Only job logs were kept per report. Run lists, jobs reads and the certificate archive repeated for every judged certificate: 59 calls and about 35 s per stale candidate against the 120 s the readiness post allows. |
| 3   | Medium   | More runs than one page of 100 raised a read error. Stage holds about 156 runs in 24 h, so a copy older than about 15 h was UNKNOWN for as long as a stall lasted.                                                    |
| 4   | Medium   | A run that had not completed was skipped as if it had installed nothing. The window installer finished at 04:00:30 CST; its run stayed open until 04:25:25 CST.                                                       |
| 5   | Medium   | Only `[apply] APPLIED` counted. The applier prints `[apply] committed in <n>ms` first and can exit UNKNOWN before `[apply] APPLIED` when its history read-back fails: a durable install that readiness did not count. |
| 6   | Low      | The engine-inert carve-out judged the file alone. The selector uses `inert_versions(control, target)` and `bounded_inert`: never a version the candidate ships, and nothing above ten inert versions.                 |
| 7   | Low      | The certificate was the last artifact named `backup-certificate-<sha>-*`. The selector takes exactly `-<run_attempt>`.                                                                                                |
| 8   | Low      | "copy current as of" read as if contents had been compared. Readiness reads job logs only.                                                                                                                            |
| T   | Test     | `tests/the-pull-request-builds-what-ships.law.test.ts` did not notice a twin step that was present but disabled.                                                                                                      |

## Each Fix

1. **Lookback.** The Stage list reaches six hours behind the copy (`STAGE_RESERVATION_LOOKBACK`): the five-hour reservation bound of `stage-engine-release.yml` plus an hour. A test reads the bound from the workflow, so a longer reservation fails it. The Apply list reaches 48 hours behind the copy (`APPLY_RERUN_LOOKBACK`), because a re-run keeps its run's original creation time. The precise test is unchanged: a job counts when it completed at or after the copy's restore time.
2. **Cost.** Inside one report every copy-freshness read (run list, jobs, artifacts, job log, certificate archive) is made once per path, and the list of installs is kept per copy restore time. A second certificate on the same copy reads only its own certificate. A run last updated more than five minutes before the copy holds no job that completed after it, so it costs no jobs read. The attempt of a Backup run the report already listed is taken from that list.
3. **Pages.** `_runs_since` follows `&page=N` until every run of the first page's `total_count` is read, at most ten pages. More than that, or a list that ends early, is a read error (UNKNOWN).
4. **Job state.** A Stage run is no longer skipped for being open. Its window installer job is judged by its own state: completed is read, queued is not yet an install, running is a read error. Any Apply run in the list that has not finished is a read error.
5. **Markers.** A file line opens an attempt. `[apply] committed in <n>ms` (or `[apply] APPLIED`) commits it. `[apply] UNKNOWN...` or the window installer's `[window] result: UNKNOWN ...` before that is a read error naming the file. `[apply] REFUSED...` and `[apply] DRY RUN...` close it uncommitted. A test reads the applier and the installer source and fails when one of these strings is renamed.
6. **Carve-out.** Readiness calls the helper's own `inert_versions(repo, control, target)` and `bounded_inert`. It does not read production's set, so the bound counts every inert version of the tree, which is at least what production holds: the carve-out is never wider than the selector's. `load_engine_inert` is removed.
7. **Attempt.** The certificate read is the one unexpired artifact named `backup-certificate-<sha>-<run_attempt>`. None, or more than one, is a read error.
8. **Wording.** A fresh copy says `no install seen in the applier's job logs since the copy was restored <time>`, and the READY summary carries that sentence.

**Test gap.** The law now refuses `continue-on-error` on the `Server Engine` job and on every twin step, and an `if` on a twin other than `matrix.shard == 1`.

## Proof

- `python3 -B tests/operations/three-hourly-readiness.test.py`: 49 cases pass on the branch (33 before). With main's tool under the same file 21 fail and 28 pass. Because the judge's parameters changed, the count was taken again with only the call adapted to main's parameters: all 16 new cases fail against main, and 2 adapted cases with them.
- Fixtures are the two measured incidents: run `45963036602` with its real timestamps and the real lines of job `140421831827`, and the 156-run day.
- Law tests: `tests/the-three-hourly-readiness-cli-only-reads.law.test.ts` (pin moved to 49), `tests/the-pull-request-builds-what-ships.law.test.ts` (4 cases; the new one fails when the build step gains `continue-on-error: true` or `if: false`), `tests/law-registry.law.test.ts`, `tests/the-runbook-names-what-it-cites.law.test.ts`.
- Live read at about 17:00 CST on 2026-11-27, one fresh candidate (`57b9f3778397`): 35 `gh api` calls with main's tool and 35 with this one (17 of them copy-freshness reads on both). Both said READY.
- First live proof: the readiness posts on `#11599` after this merges; recorded in `docs/ops/cutover-fix-verification-and-hardening.md`.

## What Is Still Not Read

- A re-run of an Apply run created more than 48 hours before the copy.
- A copy so old that Stage or Apply hold more than 1,000 runs since it (about four days of Stage runs): UNKNOWN, by design.
- Contents. Readiness never compares the copy with production; the selector does.
