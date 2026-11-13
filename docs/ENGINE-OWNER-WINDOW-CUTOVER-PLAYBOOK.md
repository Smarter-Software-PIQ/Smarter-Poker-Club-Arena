# Engine Owner-Window Cutover Playbook

Written November 13, 2026 by the release custodian (Claude session `session_01TLQer6CUX4ykkbdyPE9d8M`) after the owner-ordered cutover that sealed `533608409f2b05e702c9fbd097bcab48b9e59dad` at 08:08:27 UTC. Read `docs/ENGINE-RELEASE-RUNBOOK.md` first: it owns the rules. This file is the order of work an agent follows when the owner orders an engine replacement outside the routine 04:00 Chicago window, and the traps that cost three attempts that night.

## Is Every Cutover Different?

No. The mechanism is fixed: one protected booking, one Backup certificate for one exact commit, one Stage dispatch, one host transaction, one seal. Per cutover only four values change: the window id and times, the serving predecessor SHA, the minimum content commit, and the notice time.

What makes a cutover fail is not the procedure. It is something changing one of the release's inputs between certification and dispatch. On November 12 to 13 three bookings were needed for that reason alone (see Failure Modes). Treat input stability as the job.

## The Five Inputs That Must Not Move

| Input                    | Why it matters                                                                                                      | Who can move it                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target commit            | The certificate is for one exact SHA                                                                                | Any merge, if you retarget                                                                                                                                                                         |
| Release controls         | Stage refuses a target whose release-authority files differ from main ("control owner authorization differs")       | Any merge touching `server/release/`, `server/scripts/`, the four release workflows or the selector scripts. Another lane's database booking edits `server/release/owner-maintenance-windows.json` |
| Production migration set | The selector requires the certified Backup copy to EQUAL production's installed list exactly, window files included | Apply Merged Migration after any merge with a migration; another lane's database window                                                                                                            |
| Backup copy              | Taken at the refresh step; everything after it must leave production equal to it                                    | Same as above                                                                                                                                                                                      |
| Rolling hour             | Only one off-cycle announcement per 3600 s                                                                          | Another lane's database or engine window                                                                                                                                                           |

## Step By Step

### 1. Recover State (Read Only)

```sh
curl -fsS https://engine.smarter.poker/health | jq '{releaseSha,instanceId,status,maintenance}'
gh run list --workflow stage-engine-release.yml -L 10
gh run list --workflow auto-deploy-hetzner.yml -L 5
gh run list --workflow backup-engine.yml -L 8
```

On the host (existing `ca-engine` SSH access): `/var/lib/club-arena/engine-release-seal.json` must show `pending` None and `finalization` None, and `desired.sha` equal to the serving SHA. List `/var/lib/club-arena/engine-recovery-window-*.json` to see the last announcement (rolling hour).

Production schema baseline (Supabase `execute_sql`, never `list_migrations`):

```sql
select count(*), md5(string_agg(version||':'||coalesce(name,''), ',' order by version collate "C"))
from supabase_migrations.schema_migrations;
```

Read `server/release/owner-maintenance-windows.json` for unexpired engine and database windows. Read COORDINATION-INBOX for other lanes' pending bookings and merges.

### 2. Make Sure Backup Can Certify

Walk `backup-engine/certified` statuses from main (runbook section 8). If recent commits show `database_refresh_failed`, fix that first (November 12: production gained role `daily_content_reporter`, which the standby restore did not create; fixed by #10665 in `server/standby/standby-engine.sh`). A Backup that cannot refresh blocks every cutover.

### 3. Pick The Content Minimum

Name the oldest commit that must be in the release and confirm by reading the tree, not only ancestry (for example `opts.vpipFloorDeepStackOff === true` in `server/src/engine/HorseLogic.ts` keeps the rejected #10628 rule off). Never select a certified older commit that re-enables a rejected rule.

### 4. Book The Window (One Protected PR)

Copy the shape of #10691 exactly. It changes 14 files:

- `server/release/activation-floor.json`: new owner window id, `activationAt` = `notBefore`, `expiresAt` = `notAfter`.
- `server/release/owner-maintenance-windows.json`: append one entry with the owner's verbatim words in `ownerOrder`, `contains` (content minimum), `playerNoticeAt`, `notBefore`, `notAfter`, `announcementPolicy: earliest-certified`, `supersedesPhase1Schedule: true`, `migrations: []`, and `releaseWitness.sha256` = sha256 of the floor file bytes.
- `server/scripts/engine-release-activation-floor.py`: `NOV7_OWNER_ID`, `NOV7_MANIFEST_DIGEST` (floor sha256), `NOV7_ORDER_DIGEST` (sha256 of `json.dumps(entry, sort_keys=True, separators=(',', ':'))`).
- `server/scripts/engine-release-seal.py`: `NOV7_OWNER_CLAIM`, `NOV7_PREDECESSOR` (the serving SHA) and the hardcoded expiry.
- `server/scripts/engine-release-transaction.sh`: the window id (4 places) and predecessor (2 places).
- `scripts/ci/read-scoped-release-recovery.py`: `RETAINED_REFUSAL_SOURCES` = sha256 of the new seal and transaction files; append the old pair to `RETAINED_REFUSAL_PRIOR_SOURCES`.
- `src/utils/ownerMaintenanceNotices.json`: the player notice.
- `PUBLISHING.md`, `docs/ENGINE-RELEASE-RUNBOOK.md`: one dated paragraph; a changelog file.
- Tests: `tests/operations/engine-activation-floor.test.py` (new test, previous window's test pins its literal digests, index shifts), `tests/an-engine-activation-floor-precedes-runtime-writes.law.test.ts` (case count), `tests/daily-engine-maintenance.law.test.ts`, `tests/a-booked-window-gives-players-notice.law.test.ts`.

Timing rules for the booking:

- `playerNoticeAt` at least 20 minutes before `notBefore`, and after the PR's merge time.
- `notBefore` no earlier than the certificate can exist: booking merge plus about 65 minutes (Backup refresh about 8, certify about 55 including the 1800 s soak). The booking merge commit IS the target, because it carries the release controls, so it must be certified itself.
- `notAfter` before 03:30 Chicago (routine preparation).
- An announcement is admitted only at 330 to 2940 seconds past the hour (:05:30 to :49:00) and only if announcement plus 420 s fits before `notAfter`; the break runs from announcement plus 120 s to announcement plus 420 s. An engine break can never cover :55 to :00; a stamp after :48:00 ends inside the tournament break.

Get an independent fresh-context review of the exact head, then protected squash merge.

### 5. Lock The Inputs At The Booking Merge

- Disable the applier: `env -u GH_TOKEN -u GITHUB_TOKEN gh workflow disable apply-merged-migration.yml` (owner-authorized pause; record start, end condition and expiry in COORDINATION-INBOX).
- Post a hold on release-control paths in COORDINATION-INBOX, naming the paths and the end condition (SEALED, abandonment or expiry). Do not freeze ordinary merges.
- Any other lane with a database window in the same span: get its written acknowledgement in the inbox that it will not dispatch before your SEALED. Posting is not acknowledgement. If you cannot reach that chat, ask the owner to paste the stand-down into it.
- Check `git diff --name-only <target> origin/main -- supabase/migrations`: any ordinary migration in the target that production lacks must be installed BEFORE the Backup copy (the selector requires every migration the candidate adds). Dispatch it through Apply Merged Migration, then disable again.

### 6. Certify One Candidate

- Cancel only your own useless queued Backup runs (for example a commit you know cannot be selected); never another lane's. Push runs are serialized and a newer push run supersedes older queued ones.
- The push run on the target refreshes only if production differs from the last copy.
- While it runs: confirm the candidate image is resident on the host with the target revision label (`docker image inspect club-arena-engine:<sha>`), and run the protected validator locally against the target with simulated clocks (`policy` and `check_window` from `server/scripts/engine-release-activation-floor.py`).

### 7. Preflight Immediately Before Dispatch

All must hold:

1. `backup-engine/certified` = success on the target.
2. Release-authority projection of target equals main (`projection(sha, release_authority=True)` in `scripts/ci/read-engine-prequalification.py`).
3. Production migration md5 equals the certificate copy's.
4. Applier disabled; no receiver run active; no other Stage `workflow_dispatch` since the window opened.
5. Served client (`https://smarter.poker/hub/club-arena/build-info.json`) carries the booked notice.
6. Engine healthy: status ok, maintenance idle, 0 stalled, settlement ok, `recoveryWindowReady` true, no weekly payout.
7. Host seal state clean; last recovery reservation more than 3600 s before your planned announcement.

### 8. Dispatch Once

```sh
env -u GH_TOKEN -u GITHUB_TOKEN gh workflow run stage-engine-release.yml --ref main \
  -f owner_window_id=<window-id> -f request_engine_release=true -f request_database_break=false
```

Never retry. If the result is uncertain, read the Stage run, receiver run and host journal first.

### 9. Follow It

- Stage logs "Receiver run N accepted exact engine component <sha>".
- Receiver jobs: request verified, production doors proved, staged, image prepared, floor wait, then the host unit `club-arena-engine-release-v1@<run>-1`.
- Host journal (`journalctl -u club-arena-engine-release-v1@<run>-1`): before :49 the announcement is reserved at once; after :49 it logs "owner window announcement would overlap the hourly break; nothing reserved, re-evaluate at <epoch>" (:05:30 next hour). Repeated "activation floor refused ... engine-recovery-window-<run>.json" lines are the poll before that reservation exists. "FORWARD TARGET BEHIND MAIN" is informational.
- Then: "fixed recovery announcement ... accepted", rollback source proved live, `[engine-up] started <container> from <image>`, database leader proof on the new SHA, `ENGINE_RELEASE_RESULT=sealed`.

### 10. Verify, Release, Hand Off

- Receipt `/var/lib/club-arena/engine-release-results/<run>-1.json`: sha, image, container and instance equal public `/health` and `docker inspect`.
- After the break end: `/health` maintenance idle, `resumeWaves` done, 0 stalled, settlement ok, all decision workers on the target revision; `engine_maintenance_break_log` newest row `thaw_ok` true; `hand_history` rows since the thaw for cash and tournaments; `fn_platform_frozen()` false.
- Exclusions on the live manifest: held-out packs `enabled: false`, V31 store empty, no Pillar 2 entry.
- Re-enable the applier, post SEALED with exact identities in COORDINATION-INBOX, tell waiting lanes they are clear, archive evidence, remove your worktrees.

## Failure Modes Seen On November 12 To 13

| What happened                                                                | Effect                                                  | Prevention                                                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup restore missed a new production role                                  | Every commit failed `database_refresh_failed` for hours | Fix the restore role list first (#10665)                                                                                                     |
| Another lane's ordinary migration installed 20 minutes after the Backup copy | Certificate unusable, window lapsed                     | Disable the applier from the booking merge to SEALED                                                                                         |
| Another lane merged a database booking 4 minutes before dispatch             | Target lost main's release controls, window lapsed      | Hold release-control paths and get acknowledgement from any lane with an open booking PR                                                     |
| A merged migration was defective (stale function pin) and refused            | Target required a migration that cannot install         | Install required migrations before the Backup copy; if refused, revert the never-installed file (precedent #10430) and let its owner re-land |
| Own useless Backup run queued ahead of the real candidate                    | About 55 minutes lost                                   | Cancel your own unusable queued run                                                                                                          |
| Window booked for an announcement after :49                                  | Refused or deferred to :05:30                           | Plan the announcement between :05:30 and :48:00                                                                                              |

## Reference Timeline (November 13, 2026, UTC)

Booking #10691 merged 06:17:00; bounty revert #10692 merged 06:50:52 (candidate `533608409f`); certificate 07:48:57; dispatch 07:49:21; receiver accepted 07:50:24; host deferred to 08:05:30; announcement 08:05:34; freeze 08:07:34; new container 08:07:59; sealed 08:08:27; thaw 08:12:34; 46 of 46 tables resumed; first 70 s after thaw 81 cash and 23 tournament hands. Evidence: `/Volumes/SmarterArchives/agent-evidence/extreme-archive/engine-cutover-01TLQer6/`.
