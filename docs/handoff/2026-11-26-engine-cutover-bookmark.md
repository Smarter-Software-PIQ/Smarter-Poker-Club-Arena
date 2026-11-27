# Engine Cutover Lane Bookmark: 2026-11-26 22:45 CST

Exact stopping point of the release custody (engine cutover every three hours) session `session_01TLQer85mFNQkwEPrZV8ZTq`. The next custodian starts here. Read `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md` (Custodian Checklist) and `docs/ops/cutover-fix-verification-and-hardening.md` first.

## Where It Stopped

- Production serves `396283f68a7f13ebd91006233c2817623ab1ff6f` (sealed 16:02 CST on 2026-11-26).
- In flight at the stop: Backup run `45938154669`, certify job `140306355263`, target `e21eb7d915ed` (main with O34), started 22:09 CST, due about 22:55 CST. If it passes, the 01:00 CST cycle on 2026-11-27 should select and seal it (cutoff 00:30 CST).
- First thing to read in that job log (strip the first 29 characters per line): the line `disk: removed N engine image(s) older than 24h; free X GiB` (first live proof of O34), the verdict, and any `backup_disk_low:`, `rehearsal failure detail`, `rehearsal engine:` or qualification `failure` text (which now ends with the failing step's log tail).

## Cycle Record 2026-11-26 (CST)

| Cycle          | Result                | Cause                                                                                                                                                      |
| -------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01:00          | KEEP-SERVING          | O27 (a release-control change) merged at 22:50 CST on 11-25, outside a post-seal slot, stranded `c951436a6ead`; the newer commits carried a held migration |
| 04:00          | SEALED `a5e971803865` | Certified by hand-dispatched run `45769225374`                                                                                                             |
| 07:00          | SEALED `132ef19f0770` |                                                                                                                                                            |
| 10:00          | NO OWNER              | No eligible Stage run in the election window (O32 now announces this)                                                                                      |
| 13:00          | KEEP-SERVING          | `13bce958` copy lacked four engine-inert Horse option-register migrations (O33 fixes this)                                                                 |
| 16:00          | SEALED `396283f68a7f` | First 900 s certificate                                                                                                                                    |
| 19:00          | KEEP-SERVING          | Uninstallable merged migration `20261126203947` (#12129) blocked certification; reverted by #12154 at 18:43 CST                                            |
| 22:00          | KEEP-SERVING          | Backup host disk full (`OSError: [Errno 28] No space left on device` in the tournament freeze qualification); O34 merged 22:08 CST                         |
| 01:00 on 11-27 | Pending               | Run `45938154669`                                                                                                                                          |

## Merged In This Lane (2026-11-25 to 2026-11-26)

#11959 and #12029 (hand-gap judge), #12027 (O21b), #12038 (O27), #12041, #12042, #12043 (Messenger note function, installed as `20261126031810`), #12050 (O28), #12059 (portrait floor), #12083 (batch: CR1 #12049, shorter certification #12055, O29 #12070, O27b #12073), #12086, #12094 (O30), #12103 (batch: O31 #12096, O32 #12097), #12110 (O30b), #12118 (O33), #12125 (Custodian Checklist), #12138 (crash drill is not an engine stall), #12152, #12136 (O27c, live-proven 19:36 CST), #12154 (revert of #12129), #12158, #12160 (O30c, live-proven 20:10 CST), #12165 (qualification log tail, live-proven), #12183 (O34, live proof pending).

## Open Work, In Order

1. **A. Backup host disk.** Verify the O34 log line. The 12 GiB floor and 24 h retention are unmeasured; re-derive them from the logged free space. What filled the disk is unknown (engine images per SHA, Docker build cache, qualification folders, or the standby database volume and dumps, which O34 does not touch). If space is still short, inspect read-only from the Mac (`ssh ca-backup`: `df -h`, `docker system df`) or add a read-only disk report to the Backup workflow (a release-control change: post-seal slot only).
2. **B. Election gap.** A window with no push, no delivered schedule and no push or person-started Backup still has no owner: GitHub creates no `workflow_run` for job-token-started Backups. Designs: a job-token election class (Stage admission, `verify_selection` in `scripts/ci/read-engine-prequalification.py`, `server/scripts/engine-release-window-doors.py`) or dispatching as the estate GitHub App. See `docs/changelog/2026-11-26-o27b-*.md` and `docs/changelog/2026-11-26-o32-*.md`.
3. **C. Engine thaw checkpoint cap (engine lane, flag on #11599).** In run `45918356098` the serving build made 12 `thaw_checkpointed` calls, threw a retryable `MaintenanceThawError` (`maintenanceThawV3.js:156`) and finished on retry. On a 207-seat copy the last-hand drain took 483 s.
4. **D. Records not yet written.**
   - Add records to `docs/ops/cutover-fix-verification-and-hardening.md` for O30c, #12165, O34, the 22:00 cycle (disk full), the O27c live proof and the 01:00 result.
   - Add Custodian Checklist rule 10 (read the failure tail before blaming code; the host may be out of disk) and rule 11 (O34).
   - Correct CLAUDE.md section 13, which still says only a successful push Backup elects.
5. **E. Live proofs pending.** O29 step-down, the O33 inert carve-out at selection, the CR1 refused-twice alarm, the O32 NO OUTCOME note, and an O27b keep-serving run that actually certifies. Re-derive the 141 MiB/min memory limit after about 20 certificates with the 900 s soak (today: 7 to 10 MiB/min).
6. **F. O33 minor gaps.** The O16 mid-soak `refresh-due` in `backup-engine.yml` (around line 1589) omits `--sha`. Classification reads control-tree text, not what production ran.
7. **G. Other lanes, report only.**
   - #12129 must be re-landed by the alerts lane with a proof that fits the applier budget. The new body measured 10.9 s; index `idx_rake_records_bbj_window_cover` stays in production.
   - Flaky tests:
     - `scripts/ci/test-weekly-payout-financial-phase-postgres.py` (random `clubs.club_id` collision);
     - `tests/unit/agentPushVerifiesTheRemoteRef.test.ts`;
     - `tests/components/playerCommandMetricScope.test.tsx`;
     - `tests/components/admin-dashboard-mint-scope.test.tsx`.
8. **H. Excluded by decision.** A second test machine (Dan excluded it); an every-cycle database freeze (covered by O21, O23 and O28).
9. **I. Cleanup.** Remove the cloud worktrees `/home/claude/wt-*` with `git worktree remove --force`, then `git worktree prune`.

## Rules That Bind The Next Custodian

- **Dan:** never ask him for approval or decisions, including merges; no interim updates; Chicago time; Title Case, no em dashes; root-cause fixes plus law tests; stay in this lane.
- **Release controls:** no CONTROL_INPUTS merge outside `[SEALED, S+50m)` unless no selectable certificate exists.
- **Every cycle:** run readiness at S-90 minutes (`python3 -B scripts/release/three-hourly-readiness.py`); never queue an unselectable certification; post every custody decision on #11599.
- **Security:** no secrets in output, no ssh from the cloud, read-only database access only, migrations only through the dispatcher from main.
