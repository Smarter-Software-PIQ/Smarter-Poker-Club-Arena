# HANDOFF PROMPT: Dedicated Engine Cutover (every three hours), Club Arena

Paste this whole document as the first message of a new chat. It is written to you, the receiving agent.
Facts were last verified 2026-11-21 19:31Z (13:31 America/Chicago) unless a line says otherwise.
Re-verify anything time-sensitive with the commands in Part 9 before acting on it.

---

## PART 0. WHO YOU ARE AND WHAT YOU ARE PICKING UP

You are the successor to the "Dedicated Engine Cutover" chat (Claude session `session_01Gw7aDsC1z7GdpSYmDAM2kv`), working for Dan, the owner of Smarter.Poker. The product is Club Arena: a real-money-style poker platform with a game engine (Node/TypeScript, Docker, one Hetzner host), Supabase Postgres, a Vercel client, and AI players called Horses. Many AI agent chats (Claude, Antigravity, ChatGPT) work the same repo in parallel. They coordinate through one append-only file, the COORDINATION-INBOX, and through git.

What this programme is: the owner ordered (2026-11-21 02:22 Chicago) **a dedicated engine cutover every three hours** that works directly with four other chats: PLO Strategy, Horse On/Off Switches, Antigravity Coordinator and Horse Decisions. Before this, engine releases happened at most once a day (04:00 Chicago) or through hand-booked "owner windows" that one custodian chat had to book and dispatch manually. They kept lapsing.

The prior session ran 2026-11-21 08:22Z to 19:31Z. What shipped:
- PR #11609, the three-hourly scheduled cutover route: built, independently reviewed, four review defects fixed, merged as `c4c5d2efe50a`, and its migration installed. **It is NOT live yet.** The serving engine still runs the old daily schedule. The new schedule only activates when an engine release that carries it seals.
- PR #11618, the root fix for the defect that silently blocked every engine release all day. Merged as `5ef8e6cb5a55`.
- The custody fights and lapsed windows are documented below.

Where you land: window `2026-11-21-owner-no-notice-engine-1906z` (19:06Z to 22:06Z) is booked and carries everything. Another chat, **Alert Root-Fix (`session_01Gw7aDquR4z7yrveyhc3nEf`), is the SOLE custodian and dispatcher for it**, and this lane formally handed it custody at 18:25:55Z. At 19:31Z its Backup certification had not finished, so nothing had been dispatched.

Blunt facts about what went wrong: no engine release sealed on 2026-11-21 from 03:49Z through at least 19:31Z. Windows 0825z and 1135z lapsed or were refused. The root cause was a flaky law test (Part 7, D1), and the "success" signals in CI hid it (Part 8).

The owner's latest order (13:31 Chicago) adds a hardening phase: **after everything is verified live, go back through every fix, establish why it broke and how, and harden each one so it cannot break or regress again.** That is your main build task (Part 6, H1-H12).

---

## PART 1. STOP CONDITIONS. READ BEFORE ANY WORK.

### 1.1 The owner's binding words (verbatim, 2026-11-21, America/Chicago)

> 02:22 "CREATE A DEDICATED ENGINE CUT OFF SWITCH TO WORK DIRECTLY WITH THE PLO STRATEGY CHAT, HORSE ON OFF SWITCHES CHAT, ANTIGRAVITY COORDINATION CHAT AND THE HORSE DECISIONS CHAT."

> 02:23 "YOU OWN THIS CODE BASE AND MAKE ANY AND ALL DECISIONS AND CHOICES ON HOW THIS IS DONE.  LAUNCH A SWARM TO HELP WITH THIS.  I WANT A ENGINE CUT OVER EVERY 3 HOURS."

> 08:11 "Please pick up where you left off, complete the task in full and do not claim success until you have verified that everything is 100% accomplished for this task. Re launch the swarm or use multiple agents to get this done as quickly and efficiently as possible.  DO NOT DO ANY UN NECESSARY TESTS, OR WORK OUTSIDE OF THIS SCOPE. FINISH ANY AND ALL TASKS USING THE FASTEST, MOST EFFICiENT ROUTE.   LAUNCH A SWARM IF IT WILL HELP."

> 08:47 and 12:25 "FINISH UP ANY AND ALL UNFINISHED WORK, AND THEN GO AHEAD AND FULLY BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND TESTED BEFORE CLAIMING SUCCESS. YOU DECIDE THE BUILD ORDER.  LAUNCH A SWARM IF IT WILL HELP."

> 13:31 "once you are completed and verified that every single fix was hard coded and fixed (without patches) you need to go back through each one, figure out why it broke and how. then harden each and every one of the issues that you fixed so they can't break or regress again!"

Standing order of 2026-11-20 15:16 Chicago, the first paragraph of `CLAUDE.md` on main:
> "WE ARE SCHEDULING CUT OVERS EVER 3 HOURS MOVING FORWARD UNTIL ANY AND ALL CORRECTIONS ARE FINISHED.  NOT OCNES AT 4AM.  MAKE SURE YOU ARE COORDINATING AND SCHEDULING ENGINE UPDATES AND CUT OVERS EVERY 3 HOURS UNTIL FURTHER NOTICE."

Standing 2026-11-17 order: no player announcement for any engine cutover (book with `--no-advance-notice`). The engine's own 2-minute last-hand drain still applies.

### 1.2 The owner's standing preferences (apply to every action)

- Fix defects at the root in code or schema, then harden against regression. **Never add a cron, watcher, reconciler or repair loop to stand in for a fix.** He calls this "no watcher shall stand in place of a fix". It is also binding repo law: `CLAUDE.md` section 10.12.
- Pushed, tested, merged, installed, published and verified-live are separate states. Claim only the state a command proved.
- You may launch parallel subagents (a swarm) whenever useful.
- You decide what to do and in what order, as long as it is safe.
- He does not want frequent progress updates. Work in long uninterrupted stretches and carry things to completion.
- **Nothing is for the owner to do.** You push, merge, deploy, publish and verify. Never hand him a step.

### 1.3 Release custody: who may dispatch what, right now

- **Window 1906z: the ONLY dispatcher is Alert Root-Fix (`session_01Gw7aDquR4z7yrveyhc3nEf`).** This lane posted the hand-back at `2026-11-21T18:25:55Z` in the inbox. **You do NOT dispatch 1906z.** A second Stage `workflow_dispatch` for a claimed window is refused on the host, but it still fails a receiver run and raises a false release alert.
- You may take custody only under all of these conditions: the window is still open (before 22:06Z), it is certified and prequalified, there has been no DISPATCHED post from Alert Root-Fix for 20 or more minutes after both are green, and you post `TAKING CUSTODY` in the inbox first and then wait 5 minutes for an objection. Alert Root-Fix posted the mirror rule at 18:18:30Z. In practice, prefer to let it run.
- The old custodian `session_01UxDLnGdoaRhVERVLYrh2KF` went silent after 07:09Z. Ignore it unless it posts again.

### 1.4 Holds currently active (from the 1906z booking merge at 18:18Z, until SEALED, abandonment or 22:06Z)

- Apply Merged Migration is DISABLED (`disabled_manually`). Pause-start sha: `1a0a6047e1acb1a037cd43b36d9907a00103c5e4`. Re-enabling is the custodian's job, via `scripts/release/resume-migration-installs.sh 1a0a6047e1acb1a037cd43b36d9907a00103c5e4`, at SEALED, abandonment or expiry. If you become custodian, it becomes yours.
- **No merges touching release-control paths** until the hold ends: `server/release/**`, `server/scripts/**` (engine-release-* in particular), `server/src/maintenance/**`, `.github/workflows/{stage-engine-release,auto-deploy-hetzner,backup-engine,apply-merged-migration,dispatch-merged-migrations,engine-release-prequalification}.yml`, `scripts/release/**`, `scripts/ci/select-daily-engine.py`, `scripts/ci/read-engine-prequalification.py`, `scripts/ci/read-scoped-release-recovery.py`. A merge there stales the booking: Stage refuses with "control owner authorization differs".
- No database windows. **No Horse option switch writes** between a preparation opening and SEALED (the fleet-reset trap, Part 8).
- Ordinary engine and client merges are allowed. They miss this cutover and ride the next one.

### 1.5 What you must NOT do

1. Do not create anything on the Claude scheduler for release or critical work. Binding law: `CLAUDE.md` 10.85, owner verbatim: "IF YOU ARE SCHEDULING ANYTHING TO 'RUN ON CLAUDE SCHEDULER' IT WON'T WORK OR SAVE". Release timing lives in GitHub Actions. A one-shot reminder in your own conversation (send_later) is tolerated for your own follow-up only, never as a release mechanism.
2. Do not dispatch Stage twice for one window. Never "retry" a dispatch. Read the Stage run, the receiver run and the host journal first.
3. Do not edit, check out or commit in `~/Documents/club-arena` (the shared clone). Use your own worktree (Part 2.4). `CLAUDE.md` 10.87.
4. Do not kill other lanes' processes or cancel other lanes' Backup runs. Cancel only your own useless queued runs.
5. Do not lower a law test or delete an assertion to get green. Fix the cause. Do not "fix" a red check by rerunning it repeatedly.
6. Do not turn on any Horse option or write switch rows. Only the Horse SWITCH lane (`session_01Gw7aDsLdud3GnjZyZjuya9`) writes rows, with evidence.
7. Do not run `resume-migration-installs.sh` between minute :50 and :03 UTC. It refuses (database DDL refusal window). Run at :05 to :49.
8. Do not reintroduce `snapshot.debian.org` as a primary apt source (dropped 2026-11-05 for 504s). Lane #11613 uses it as a hash-checked per-file fallback. That is accepted and not yours to undo.
9. Do not do unnecessary tests or out-of-scope work (owner, 08:11). Run the tests that cover what you change.
10. Do not write "projected" anything, or announce to players.

---

## PART 2. ENVIRONMENT BOOTSTRAP. RUN THESE FIRST.

### 2.1 Which tool is the real machine

- **`mcp__remote-devices__counselors__host_terminal`** is a real bash on the owner's Mac Studio (user `smarter.poker`), with `gh`, `git`, `node 24`, `psql` and `supabase` authenticated. Load it with `ToolSearch select:mcp__remote-devices__counselors__host_terminal`. Default cwd: `/Users/smarter.poker/Documents/club-arena` (the shared clone, read-only for you). **Use this tool for everything.**
- `mcp__remote-devices__device_bash` is a Linux VM, not the Mac. Its git fails with "Too many open files" and its paths do not match the Mac's. Do not use it for git or releases.
- **Each host_terminal call is cut off at about 80 s**, and the result is "Device did not respond within 80s" or "Connection closed". Never `sleep` more than 70 s in one call. For long jobs, detach with setsid and a double fork, then poll. `nohup ... &` alone does NOT survive. A known-working helper exists at `/Users/smarter.poker/agent-worktrees/claude-cutover-3h/cut3h-logs/bg.py`; read it, or use:
  ```sh
  python3 - <<'EOF'
  import os,subprocess
  if os.fork()==0:
      os.setsid()
      if os.fork()==0:
          subprocess.Popen(["bash","-lc","<COMMAND> > /tmp/job.log 2>&1"]); os._exit(0)
      os._exit(0)
  EOF
  ```
- Subagents inherit the same tool limits. Tell each one about the 80 s cut-off and the detach recipe.

### 2.2 Confirm you are on the right machine and see the live state

```sh
date -u; hostname
curl -fsS https://engine.smarter.poker/health | jq -c '{releaseSha, s:.maintenance.schedule, phase:.maintenance.phase, rw:.maintenance.recoveryWindowReady}'
```
Healthy before the new engine seals: `releaseSha` is `bb21dc82673117a937f67c9498dec46b8c27522e` and `frequency` is `"daily"`.
Healthy after: `releaseSha` is the 1906z target (`1a0a6047e1acb1a037cd43b36d9907a00103c5e4`) or a later sealed sha, with `frequency` `"three-hourly"` and `startHours` `[1,4,7,10,13,16,19,22]`.

### 2.3 Repo, credentials, hosts

- GitHub repo: `Smarter-Software-PIQ/Smarter-Poker-Club-Arena`. For protected merges and workflow dispatches use `env -u GH_TOKEN -u GITHUB_TOKEN gh ...`, as the playbook does.
- Push only with `bash scripts/agent-push.sh` from your worktree, prefixed `TMPDIR=/private/tmp` (one python test fails on the Mac's default TMPDIR whatever the code is). It never force-pushes, so update branches by merging main, not by rebasing.
- **Read-only production DB URL**: built at run time from `~/.smarter-poker/ops/supabase/.temp/pooler-url` plus `SUPABASE_DB_PASSWORD` from `~/.zshenv`. The helper is at `/tmp/dburl.sh` (it may vanish on reboot; recreate it verbatim):
  ```sh
  cat > /tmp/dburl.sh <<'EOS'
  zsh -c 'source ~/.zshenv; python3 -c "
  import urllib.parse,os,re
  u=open(os.path.expanduser(\"~/.smarter-poker/ops/supabase/.temp/pooler-url\")).read().strip()
  p=urllib.parse.quote(os.environ[\"SUPABASE_DB_PASSWORD\"],safe=\"\")
  print(re.sub(r\"//([^:@]+)(:[^@]*)?@\",lambda m:\"//\"+m.group(1)+\":\"+p+\"@\",u,1)+\"?options=-c%20default_transaction_read_only%3Don\")"'
  EOS
  export DATABASE_URL=$(bash /tmp/dburl.sh 2>/dev/null)
  ```
  It is read-only, for preflight scripts and SELECTs. Never print the URL. Never write a credential into any file. Supabase project: `kuklfnapbkmacvwxktbh` (never `ydsaqnnuwyvtyxgvrnys`).
- Engine host SSH (read-only inspection only): `ssh -i ~/.ssh/hetzner_deploy_ed25519_new -o BatchMode=yes root@5.161.252.33`. Useful files: `/var/lib/club-arena/engine-release-seal.json`, `/var/lib/club-arena/engine-release-results/<run>-<attempt>.json`, `/var/lib/club-arena/engine-recovery-window-*.json`, journal `journalctl -u club-arena-engine-release-v1@<run>-1`. Never restart anything by hand (runbook section 7).
- COORDINATION-INBOX (append-only; read the tail at start and before every merge or release step): `/Volumes/SmarterArchives/agent-evidence/COORDINATION-INBOX.md`. Header format:
  `## <UTC ISO> FROM Dedicated Engine Cutover (Claude <your session id>; successor of session_01Gw7aDsC1z7GdpSYmDAM2kv) TO <lanes> - <subject>`
  Acknowledge others with a line under their entry: `ACK <UTC> <agent id>: <decision>`.

### 2.4 Worktrees

- Create yours with `git -C ~/Documents/club-arena fetch -q origin main && git -C ~/Documents/club-arena worktree add -b <branch> ~/agent-worktrees/<name> refs/remotes/origin/main`.
- `scripts/agent-workspace.sh` default roots are not writable: `~/Documents/.agent-trees` gives Permission denied, and `/Volumes/SmarterWork/agent-work` is read-only. Use `~/agent-worktrees/` or set `AGENT_WORKTREE_ROOT` under `/Volumes/SmarterWork/agent-work/shared-capacity/`.
- Worktrees left by the prior session (all safe to remove once their PRs are settled; `git worktree remove <path>`):

| Path | Branch / HEAD | State |
|---|---|---|
| `~/agent-worktrees/claude-cutover-3h` | `feat/engine-cutover-every-3-hours` @ 246c0d6c50b | PR #11609 MERGED. Holds the `cut3h-logs/` helper. Keep until H-phase starts, then remove |
| `~/agent-worktrees/claude-custodian-1` | `release/book-owner-engine-1906z-01Gw7aDs` @ fe6754ed52f | Booking branch, merged as #11640. Remove |
| `~/agent-worktrees/claude-fixture-pin` | `fix/fixture-postgres-pin` @ 09398e6ccec | PR #11617 CLOSED unmerged. Contains `operations/release/fixture/debian-pins.py` + `tests/operations/fixture-debian-pins.test.py`, which are useful for hardening H3. Harvest, then remove |
| `~/agent-worktrees/claude-priced-law` | `fix/priced-law-frozen-budget-clock` @ ccc833b8c81 | PR #11618 MERGED. Remove |
| `~/agent-worktrees/claude-target-1135z` | detached | Used for 1135z preflight. Remove |
| `~/agent-worktrees/review-11609` | detached @ 70b86211d9a | Reviewer scratch (`/tmp/r11609s`). Remove |
| `~/agent-worktrees/AUDIT-cutover-3h-surfaces.md` | file | The full surface audit of every 04:00-assuming place. Read it for H-phase |

---

## PART 3. HOW THE ENGINE CUTOVER ACTUALLY WORKS

### 3.1 Scheduled route (now three-hourly, once the new engine serves)

```
GitHub cron (stage-engine-release.yml, every hour at :31,:35,:39,:43 UTC)
  -> Stage job "Prove Whether The Server Tree Changed"
     reserves ONE cycle (keyed by cycle start; at most 100 min early),
     reads live /health: a non-04:00 cycle is refused unless the serving engine says three-hourly
  -> "Record the daily release evidence": scripts/ci/select-daily-engine.py
     picks the newest protected-main commit that has
       (a) backup-engine/certified=success (Backup host certified it, 1800 s soak),
       (b) engine-release-prequalification.yml success on that exact sha (read by scripts/ci/read-engine-prequalification.py),
       (c) Backup copy migrations == production installed migrations
     uploads artifact "owner-engine-selection-<window>" or the daily equivalent: JSON with outcome
     ("keep-serving" or a target) and deferredCandidates[].reason
  -> "Dispatch The Exact Main SHA": repository_dispatch -> auto-deploy-hetzner.yml (THE single receiver)
  -> receiver: preflight (protected main, Backup cert, 4-shard npm test, engine-doors), builds image
     club-arena-engine:<sha>, installs host unit club-arena-engine-release-v1@<run>-1
  -> host: server/scripts/engine-release-transaction.sh
     2 min last-hand drain -> fn_platform_frozen (Postgres zz_freeze_guard) -> 300 s break
     -> maintenance_certificate -> prove_rollback_readiness -> engine-up.sh
     -> DB leader proof -> engine-release-seal.py (seal) -> thaw in waves
     any failure before seal: recover_on_exit restores the previous engine in a 135 s reserve
  -> receipt /var/lib/club-arena/engine-release-results/<run>-1.json result=sealed
  -> receiver posts one report-only comment on issue #11599 "Engine cutover log"
```
Cycles (Chicago): 01, 04, 07, 10, 13, 16, 19, 22. Preparation opens at cycle minus 30 min (00:30, 03:30, ...), last-hand drain at :58, break :00-:05. The fall-back day's repeated 01:00 counts as ONE cycle (the first). Spring-forward invents nothing. Window migrations (`-- @install-window: daily-maintenance`), the 23:45-04:15 schema freeze, the Backup freeze baseline, the 03:00 readiness check and the 04:30 missed-cutover page stay on the **04:00 anchor only**, by design.

### 3.2 Owner-window route (hand-booked; still works)

`docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md` steps 1 to 10. In short:
1. Book with `scripts/release/book-owner-engine-window.py` (one protected PR editing about 14 files; exit 0 means booked; use `--dry-run` first and `--no-advance-notice`).
2. Merge it. That commit is the target.
3. Lock the inputs: `gh workflow disable apply-merged-migration.yml`, plus an inbox hold post.
4. Backup certifies the booking commit (its own push run, PRIORITY).
5. Prequalification passes on it.
6. Preflight: candidate-ready READY, switch-rows candidate OK.
7. Dispatch ONCE: `env -u GH_TOKEN -u GITHUB_TOKEN gh workflow run stage-engine-release.yml --repo Smarter-Software-PIQ/Smarter-Poker-Club-Arena --ref main -f owner_window_id=<id> -f request_engine_release=true -f request_database_break=false`.
8. Follow it.
9. Verify.
10. Resume installers, then post SEALED.

The seal keeps a booked window at least one hour from any three-hourly cycle (`scheduled_cycle_spacing` in `server/scripts/engine-release-seal.py`).

### 3.3 Horse option switches (no release needed)

Table `public.ca_horse_style_switch` and its audit table. SQL: `fn_ca_horse_option_switch_set/clear/effective`, service role only, with an evidence row first (`fn_ca_horse_option_switch_record_evidence`, `docs/horse-option-authority.d/`). The engine reads the table every 30 s and sends `STYLE_SWITCH_STATE` to workers. Registry: `server/src/engine/HorseOptionSwitch.ts`. A **new** option needs engine code plus a generated whitelist migration (`server/scripts/gen-horse-option-switch-sql.ts`) merged and installed before the cycle that carries it.

### 3.4 Lane contract (the "dedicated" part; in `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md` on main)

1. Engine work rides the next cycle if it is merged to protected main with green checks and installed migrations before that cycle's preparation opens, and Backup certifies it.
2. No switch writes from preparation-open to SEALED.
3. New options need their whitelist migration merged and installed before preparation.
4. What shipped is posted on issue #11599.
5. No release-control edits while a booked window is open.

The four lanes and their known sessions:

| Lane | Session |
|---|---|
| PLO Strategy (PLO-OWNER lead-3) | `session_01Gw7aDuHREYyRnFwNqVFJAe` |
| Horse On/Off Switches (Horse SWITCH lane) | `session_01Gw7aDsLdud3GnjZyZjuya9` |
| Antigravity Coordinator | `session_01Gw7aDtgw51ks82iZdeEMVr` (coordinates 7 Antigravity lanes: Hold'em Strategy, Limit Games, Human vs Horse, Lightning Games, Hand Analysis, Heads Up, PLO6) |
| Horse Decisions | session not recorded; addressed in the inbox as "HORSE DECISIONS" |

Other relevant chats:

| Chat | Session |
|---|---|
| Alert Root-Fix (current 1906z custodian) | `session_01Gw7aDquR4z7yrveyhc3nEf` |
| Live Now downline | `session_01Gw7aDryxTN1HDninBfUFm6` |
| Antigravity Incident-484c4cee | `c822bcd3-...` |
| Incident Hardening Swarm | Antigravity `1da45101` |
| Tournament & Hand-Delay owner | Antigravity `c7917055` |

---

## PART 4. COMPLETE STATE INVENTORY (verified 2026-11-21 19:31Z)

### 4.1 Live state

| Item | Value |
|---|---|
| Serving engine | `bb21dc82673117a937f67c9498dec46b8c27522e`, schedule daily, startHour 4, phase idle |
| Last successful receiver run | `44863049588` (03:49Z), none since |
| origin/main | `4f08d8ad4bbbb0f40c22527cdcebc0f92ba6cb09` |
| Booked window | `2026-11-21-owner-no-notice-engine-1906z`, notBefore 19:06Z, notAfter 22:06Z, contains `a8e9356d73`, booking merge (target) `1a0a6047e1acb1a037cd43b36d9907a00103c5e4` (#11640) |
| 1906z certification | Backup run `44934752464` in_progress since 18:18Z. Status `backup-engine/certified` pending since 18:44Z. **Not certified at 19:31Z.** Watch for its 75-min turn timeout (Part 8 T7) |
| 1906z prequalification | `engine-release-prequalification.yml` on `1a0a6047`: completed SUCCESS |
| Applier | `apply-merged-migration.yml` disabled_manually (hold). Dispatcher also paused |
| Policy on main | `server/src/maintenance/maintenanceSchedulePolicy.json` schema v2, policyId `three-hourly-01Gw7aDs`, frequency `three-hourly`, startHours `[1,4,7,10,13,16,19,22]` |

### 4.2 PRs

| PR | State | Commit on main | What |
|---|---|---|---|
| #11609 | MERGED | `c4c5d2efe50a` (merged ~16:48Z, author time 10:48 Chicago) | Dedicated engine cutover every three hours. 44 files, +1518/-205 |
| #11618 | MERGED | `5ef8e6cb5a55` | Frozen `performance.now` in `AHoldemTournamentAllInCallIsPriced.law.test.ts` (two comparisons). Unblocked prequalification |
| #11613 | MERGED (another lane) | `8d01508d3d4f` | Fixture image's PostgreSQL pin survives a Debian point release (7 checksum-pinned debs, snapshot fallback by hash) |
| #11617 | CLOSED unmerged (ours) | none | Our alternative re-pin to 17.12 + `debian-pins.py` fail-fast. Superseded by #11613. Code in worktree `claude-fixture-pin` |
| #11605 | MERGED (old custodian) | `2f5699adac29` | Booking 1135z. ABANDONED by us at 14:48Z |
| #11606 | CLOSED | none | Booking 1225z, never used |
| #11640 | MERGED | `1a0a6047e1ac` | Booking 1906z (generated by our release subagent; merged by Alert Root-Fix unchanged) |
| #11628 | OPEN (Alert Root-Fix) | none | "the daily selection says why a candidate's prequalification was unavailable". Release-control path; waits for SEALED. Directly hardens D1/T1 |
| #11627 | MERGED (Alert Root-Fix) | `a42341cdf98c` | Engine fix riding 1906z |
| #11635 | MERGED (Live Now) | `3328327e7aed` | Migration `20261121153607_live_now_lists_an_agent_only_their_own_downline.sql`, merged AFTER the booking. **Not installed** during the pause; the custodian must send it via resume-migration-installs at SEALED. Live proof: `pg_get_functiondef('public.ca_club_live_seats(uuid)')` contains `v_whole_club` |
| Issue #11599 | OPEN | n/a | "Engine cutover log"; the receiver posts one comment per cycle (on engines carrying #11609) |

### 4.3 What #11609 changed (all on main; read `git show c4c5d2efe50a --stat`)

| Area | Files |
|---|---|
| Policy and engine | `server/src/maintenance/maintenanceSchedule.ts`, `maintenanceSchedulePolicy.json` (v2), `MaintenanceBreak.ts` (/health exposes frequency + startHours), `server/src/GameServer.ts` (gauge `poker_maintenance_scheduled_breaks_per_day`) |
| Stage | `.github/workflows/stage-engine-release.yml`: hourly reservation crons in both CST/CDT offsets, reservation keyed by cycle start, LOOKBACK 100 min, non-04:00 cycles only when /health says three-hourly, window migrations 04:00 only |
| Receiver | `.github/workflows/auto-deploy-hetzner.yml`: admits the slot-30 to slot-10 preparation of any cycle, that cycle's selection cutoff, posts the #11599 comment (issues: write, continue-on-error, report only) |
| Prequalification | `.github/workflows/engine-release-prequalification.yml` |
| Release scripts | `server/scripts/engine-release-transaction.sh` (cycle clock, first-occurrence fall-back 01:00), `engine-release-seal.py` (next cycle, `scheduled_cycle_spacing`), `engine-release-activation-floor.py` (cutoffs), `scripts/ci/select-daily-engine.py`, `read-engine-prequalification.py`, `read-scoped-release-recovery.py` (new transaction digest; previous pair kept readable), `prestage-engine-image.sh` (closed windows derived from the target policy: daily means 03:30-04:05 only) |
| CI readers | `scripts/ci/await-engine-gameplay.mjs`, `daily-engine-provenance.mjs` |
| Client | `src/utils/maintenanceSchedule.ts`, `src/components/common/MaintenanceBreakBanner.tsx`, `src/components/lobby/lateRegCountdown.ts` (pause at every slot) |
| Alerts | `infra/monitoring/alert-rules.yml`: `EngineCannotBeReplaced` is 16 uncertified breaks (48 h) on three-hourly, 6 otherwise |
| DB | `supabase/migrations/20261121091106_freeze_marks_follow_every_three_hourly_engine_cycle.sql`, **INSTALLED in production** (verified in `supabase_migrations.schema_migrations`) |
| Laws and tests | NEW `tests/the-engine-cuts-over-every-three-hours.law.test.ts` (393 lines: eight hours on every surface, DST days, the 01:00 clock, prestage window). Updated: `the-break-clocks-agree`, `daily-preparation-does-not-wait-for-a-punctual-cron` (now runs the real v2 policy, winter 2026-12-15 and summer 2027-06-15, plus daily), `the-runbook-names-what-it-cites`, `the-deploy-can-always-ship`, `no-workflow-gains-a-new-timer`, `daily-engine-maintenance`, `lightning-is-held-for-the-engine-cutover`, and about 8 more, plus python tests in `tests/operations/` |
| Docs | `CLAUDE.md` (top order + section 13), `docs/ENGINE-RELEASE-RUNBOOK.md`, `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`, changelog `docs/changelog/2026-11-21-a-dedicated-engine-cutover-every-three-hours.md`, law registry entry `docs/laws.d/the-engine-cuts-over-every-three-hours.md` |

Rollback of the cadence: set `"frequency": "daily"` in the policy JSON, merge, and let the next 04:00 release seal.

---

## PART 5. THE TASK THAT BLOCKS EVERYTHING ELSE: GET 1906z SEALED AND THE THREE-HOURLY ROUTE LIVE

Until an engine carrying `c4c5d2efe50a` serves, the owner's order is NOT accomplished. Do not claim success before step 5 below passes.

**Already done:** booking merged (`1a0a6047`), inputs locked, prequalification SUCCESS on the target, custody assigned to Alert Root-Fix.
**Not done:** Backup certification of `1a0a6047` (run 44934752464 in progress at 19:31Z), dispatch, seal, post-seal verification, installer resume (with #11635's migration), and the first automatic slot.

Steps:
1. Read the inbox tail for posts since 19:18Z from Alert Root-Fix: TAKING CUSTODY, DISPATCHED, SEALED or abandoned.
   ```sh
   F=/Volumes/SmarterArchives/agent-evidence/COORDINATION-INBOX.md; grep -n '^## ' $F | tail -15 | cut -c1-220
   ```
2. Check the certificate, prequalification and dispatch state:
   ```sh
   R=Smarter-Software-PIQ/Smarter-Poker-Club-Arena
   gh run view 44934752464 --repo $R --json status,conclusion -q '"\(.status) \(.conclusion)"'
   gh api "repos/$R/commits/1a0a6047e1acb1a037cd43b36d9907a00103c5e4/statuses?per_page=50" -q '[.[]|select(.context=="backup-engine/certified")][0]|"\(.state) \(.created_at)"'
   gh run list --repo $R --workflow stage-engine-release.yml --event workflow_dispatch --limit 3 --json databaseId,status,conclusion,createdAt
   gh run list --repo $R --workflow auto-deploy-hetzner.yml --limit 3 --json databaseId,status,conclusion,createdAt
   ```
3. Branches:
   - **Sealed already** (health shows `1a0a6047...` and `three-hourly`): go to step 5.
   - **Certified, dispatched, in flight**: follow it read-only (playbook step 9). Do nothing else.
   - **Stage ran and kept serving**: download the artifact `gh run download <stageRun> --repo $R -n owner-engine-selection-2026-11-21-owner-no-notice-engine-1906z -D /tmp/sel` and read `deferredCandidates[].reason`. Post the reason in the inbox to Alert Root-Fix with the root cause you find. If the custodian is silent 20 min or more, take custody per 1.3, fix the root cause (never by weakening a gate), and dispatch once more only if the window was not consumed and it is before 22:06Z.
   - **Backup run 44934752464 timed out or failed** (75-min turn timeout; see T7): read why (`gh run view 44934752464 --log-failed`). The booking commit's push run is the only one allowed to certify it. Do not dispatch Backup by hand. If 1906z cannot be certified before 22:06Z, the custodian abandons it (resume installers with `resume-migration-installs.sh 1a0a6047e1acb1a037cd43b36d9907a00103c5e4` at :05-:49 UTC, then post) and books a successor using the same owner-order text (Part 1.1). Or rely on the 04:00 Chicago daily route (10:00Z), which will select the newest certified and prequalified main that carries #11609.
   - **Window expired with nothing dispatched and no custodian**: you become custodian (post first). Resume installers, then book a successor window per the playbook.
4. If you end up dispatching: playbook step 7 preflight, all must hold:
   ```sh
   cd ~/agent-worktrees/<yours> && git checkout --detach <TARGET_SHA>
   export DATABASE_URL=$(bash /tmp/dburl.sh 2>/dev/null)
   python3 -B server/scripts/engine-release-installed-migrations.py candidate-ready --repo . --serving bb21dc82673117a937f67c9498dec46b8c27522e --sha $(git rev-parse HEAD)   # must print READY (needs FULL sha; short sha gives "target SHA is invalid")
   python3 -B server/scripts/engine-release-switch-rows.py candidate --repo . --sha $(git rev-parse HEAD)   # must print "OK: every live row is accepted"
   git diff --name-only <TARGET> refs/remotes/origin/main -- server/release server/scripts scripts/release .github/workflows/stage-engine-release.yml .github/workflows/auto-deploy-hetzner.yml .github/workflows/backup-engine.yml scripts/ci/select-daily-engine.py scripts/ci/read-engine-prequalification.py   # must be empty
   ```
   Also check: no receiver running, no other workflow_dispatch since the window opened, engine idle with recoveryWindowReady true, and the last recovery reservation more than 3600 s old (host `ls -t /var/lib/club-arena/engine-recovery-window-*.json`).
   Then dispatch exactly once, per 3.2 step 7.
5. **Verify live (all required before any success claim):**
   ```sh
   curl -fsS https://engine.smarter.poker/health | jq -c '{releaseSha, f:.maintenance.schedule.frequency, h:.maintenance.schedule.startHours, phase:.maintenance.phase, stalled:.stalledTables}'
   ```
   Expect the target sha, `three-hourly`, `[1,4,7,10,13,16,19,22]`, phase idle and no stalled tables. Then:
   - Receipt on the host says `result=sealed` and its sha equals /health.
   - Run `engine-release-switch-rows.py post-seal --serving <sha> --since <SEALED time>`. It must exit 0.
   - Installers resumed, including `20261121153607` (check `select version from supabase_migrations.schema_migrations where version='20261121153607'`).
   - A comment exists on #11599 (only from receivers built after #11609; the 1906z receiver workflow is the main-branch one, so it should post): `gh issue view 11599 --repo $R --comments | tail -20`.
6. **Verify the first AUTOMATIC slot** (this proves the owner's order, not just the merge). After the seal, the next cycle is the next one of 01/04/07/10/13/16/19/22 Chicago at least about 1 h after the seal (the seal's spacing rule). At slot minus 30 min, a `schedule`-event Stage run must reserve and prepare that cycle with no human dispatch. Then a receiver run, a seal (or an explicit keep-serving reason if there were no new certified commits; keep-serving with outcome "no newer certified candidate" is HEALTHY), and a #11599 comment.
   ```sh
   gh run list --repo $R --workflow stage-engine-release.yml --event schedule --limit 5
   ```
   Report the cycle time, Stage run id, receiver run id and the /health sha.
7. Post SEALED or verification in the inbox to ALL LANES (the four lanes by name), saying the three-hourly slots now run on their own and lanes follow `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`. Update owner memory if your environment has it.

---

## PART 6. THE BACKLOG (prioritised): THE HARDENING PHASE THE OWNER ORDERED AT 13:31

The rule for every item: (a) prove the fix is in code or schema on main, with no patches, by FILE (`git cat-file -e origin/main:<path>` and grep the line). (b) Write down why it broke and how (mechanism, commit that introduced it, why no gate caught it). (c) Add the regression barrier: a law test, a type-level constraint or a structural change that makes the failure impossible or turns it red before merge. Never a watcher or cron (owner rule; `CLAUDE.md` 10.12).

Write one record per item into `docs/changelog/2026-11-2x-<slug>.md` (repo convention) and one combined index file `docs/hardening/2026-11-21-dedicated-cutover-hardening.md`. Each record has: Symptom (real output), Root cause, Fix (PR, sha), Why it broke, Barrier added (file plus the test that fails if it regresses), Verified (command plus output).

Release-control files can only merge outside a booked-window hold. Plan merges for just after a SEALED.

### HIGH

**H1. D1: the prequalification flake that blocked every release (fixed in #11618).**
- Why: `ea4030176aa` (Horse Decisions audit-fix batch 1, 08:33Z) added a law comparing two `decide()` receipts byte for byte (`withoutClocks` strips only keys ending in `Ms`). The engine's shadow joint sampling uses a 4 ms wall-clock budget (`server/src/engine/HorseLogic.ts:17025` `jointNow = ... performance.now()`, `JOINT_SAMPLE_WORK_BUDGET_MS = 4` in `server/src/engine/multiway/JointSampleAcquisition.ts:51`). On a loaded CI runner the second call reports `utilityOwner: "phase7_unavailable"`, `utilityUnavailableReason: "operation_budget"`, so the receipt differs though the action (fold) is identical. Shard 4 of `engine-release-prequalification.yml` failed deterministically on every main commit from 09:32Z to 14:54Z.
- Barrier to build (choose the strongest that is honest):
  1. A repo-wide law: every server test that compares two `decide()` outputs, or uses `withoutClocks`, must run under a frozen clock. Implement it as a shared helper (e.g. `server/src/engine/testing/frozenDecisionClock.ts`) plus a law that greps the engine tests for `withoutClocks(`/double-`decide(` comparisons lacking the helper.
  2. Make the budget clock injectable through `opts` (the engine already has `opts.phase13EvidenceMode` freezing it at 0) so tests can never accidentally depend on wall time. No engine behaviour change in production.
  3. Scan every existing law and test for the same pattern (`grep -rn "withoutClocks\|JSON.stringify(decide" server/src`) and freeze each one.

**H2. T1: "prequalification unavailable" was invisible.** Stage runs went green ("completed success") while the selection artifact said `outcome: keep-serving` with `deferredCandidates[].reason: "prequalification unavailable"`. Nobody saw the actual failing test for about 10 hours.
- PR #11628 (Alert Root-Fix, OPEN) makes the selection name the reason. After SEALED, review and merge it or push it through.
- Then harden structurally:
  - When the selection keeps serving because the newest candidate's prequalification FAILED (not pending), the Stage run should end with a visible error annotation naming the failing workflow run and test, the way the receiver does. This is not a new watcher; it is the existing run telling the truth.
  - Add a law pinning that a keep-serving outcome always carries a machine-readable reason, with the prequalification run id when relevant.

**H3. D2: the fixture image's Debian pins (fixed by another lane in #11613).**
- Why: deb.debian.org keeps only the current point release. An exact pin (`17.11-0+deb13u1`, wal2json `2.6-2+b1`) breaks at each Debian point release (17.12 arrived 2026-11-13 and 17.11 left the archive around 2026-11-21). Every PR's required "TypeScript Check" failed because it depends on the native fixture job (exit 100, "Version ... was not found").
- #11613 fixes it with checksum-pinned debs plus a snapshot fallback by hash.
- Harden: port the fail-fast guard from our closed #11617 (`operations/release/fixture/debian-pins.py` and `tests/operations/fixture-debian-pins.test.py` in worktree `claude-fixture-pin`, commit `09398e6ccec`) only if it still adds value under #11613's design: a cheap pre-step that names the missing version before the long build. Verify #11613's own tests cover "a pinned file is gone from the pool". Coordinate with the lane that owns #11613 (see its PR author) via the inbox before touching their design.

**H4. D3: windows lapsed because one custodian chat went silent** (0825z expired at 09:20Z undispatched; 1135z certified at 11:38Z, undispatched until 14:13Z).
- Why: owner windows need a live chat to dispatch. Sessions die, restart or go quiet.
- Fix: the three-hourly scheduled route (#11609) removes the dispatcher from the loop.
- Barrier: already the laws in `tests/the-engine-cuts-over-every-three-hours.law.test.ts`. After the first automatic slot seals, add evidence to the changelog.
- Also update `docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md` with a "custody liveness" rule: a booked window whose custodian posts nothing within N min of certification may be taken over by any named lane after a TAKING CUSTODY post and a 5-min wait. It was done ad hoc twice today; make it documented procedure.

**H5. D4: bookings went stale from release-control merges** (0700z to 0745z to 0825z rebooks; `02ec081a` changed `server/scripts/engine-release-switch-rows.py` three minutes before a freeze notice).
- Barrier idea: the booking script already refuses stale targets. Add a CI check on PRs touching release-control paths that turns red (informational today via `release-inputs-hold.yml`) while `server/release/owner-maintenance-windows.json` on main has a window whose notAfter is in the future and no SEALED. Today the check only colors PRs; decide whether to make it required. That is a branch-protection change, so record the decision in the changelog.

**H6. The 3-hourly route's remaining deliberate gaps** (from the review and the audit file):
- (a) the 03:00 readiness check and the 04:30 missed-cutover page judge the 04:00 anchor only;
- (b) the scorecard's "missing break" check cannot know the engine schedule, so the 7 extra breaks are graded only if they happen;
- (c) `fn_maintenance_week_report` note text still says daily;
- (d) Backup freeze baseline per cycle is intentionally NOT done;
- (e) old web clients show schedule "unknown" until refreshed.

For each, either close it (DB function reads the serving frequency from the latest `engine_maintenance_break` or `engine_maintenance_break_log` row) or document why it stays. (a) and (b) are the most valuable: a missed 3-hourly cycle should be detectable from data the break already writes, without a new watcher. Extend the existing functions; do not add a cron.

### MEDIUM

**H7. D5: review findings on #11609, all fixed in `199438df` and merged.**
1. Reservation crons were missing the CDT hour, so from 2027-03-14 every cycle depended on one punctual cron.
2. The punctual-cron law was pinned to the old v1 policy.
3. Prestage closed all 8 windows even on a daily engine.
4. The transaction accepted the repeated fall-back 01:00 by wall clock.

Each has a law now. Verify each assertion exists on main:
```sh
grep -n "2027-06-15\|2026-12-15" tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts
grep -n "prestage\|first occurrence\|fall-back" tests/the-engine-cuts-over-every-three-hours.law.test.ts
```

**H8. D6: booking PR stuck 40 min on the "Ownership map" check.** Its first event payload had no `Lane: release-custody` line, and re-runs replay the original payload. Fix: make `book-owner-engine-window.py` (or the PR-creation path it prints) include `Lane: release-custody` in the body at creation, and add a test.

**H9. T7: the Backup host lease is first-come, not FIFO.** A commit merged after a booking can take the Backup host for about 1 h ahead of the booking's PRIORITY run and push it toward its 75-min turn timeout. The custodian cancelled `44934907493` by hand. Harden in `scripts/ci/backup-candidate-priority.py` / `backup-engine.yml`: while a booked window is live, a post-booking push run yields (DEFERRED) instead of taking the host. Add a test with a post-booking commit.

**H10. D7: Backup refused `8c2ac388` with `rollback_rehearsal_failed_to_bb21dc826731`** (run 44887083680, 09:04Z). NOT investigated by the prior session. Read the run log and host evidence. If the rollback rehearsal to the serving engine is failing on Backup, it threatens every cutover's rollback guarantee. Root-cause it before calling the route hardened.

### LOW

**H11. T5: `resume-migration-installs.sh` refuses at :50-:03 UTC.** Correct by design, but it cost a cycle. Add one line to the playbook step 10 and the script's usage text saying "run at :05-:49 UTC".

**H12. Environment hygiene for future agents.** `scripts/agent-workspace.sh` default roots are not writable (`~/Documents/.agent-trees`, `/Volumes/SmarterWork/agent-work`). Make the script fall back to `~/agent-worktrees` or fail with a clear message naming `AGENT_WORKTREE_ROOT`. Also `release-recovery-read.test.py` fails under the Mac's default TMPDIR. Fix the test to use its own temp dir.

### DONE DIFFERENTLY THAN FIRST SPECIFIED (and why it was right)

- "Dedicated cut off switch" was built as a scheduled GitHub Actions route, not a Claude scheduled task or a new chat. Reason: `CLAUDE.md` 10.85 forbids the Claude scheduler for critical work (account-bound, silently dies), and Actions is the approved platform that already hosts the certified 04:00 route.
- We used #11613's fixture fix (another lane's) instead of our own #11617, to avoid undoing a merged design.
- Window migrations, the schema freeze and the Backup baseline stay at 04:00 only (a decision, documented in `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`).
- `hourlyCashFreeze` stays false. Each slot behaves exactly like the 04:00 break.

### DECLINED, DO NOT BUILD

- A watcher, cron, reconciler or "auto-retry dispatcher" that re-sends Stage when a window lapses. That is a repair loop standing in for a fix (owner rule, `CLAUDE.md` 10.12). If a future agent "fixes" lapses by building one, that is a mistake. The fix is the scheduled route.
- Anything on the Claude scheduler for releases (10.85).
- Player announcements for cutovers (Nov 17 order).

### BLOCKED ON A HUMAN

Nothing. The owner's rule is that nothing is for him to do. If something truly needs him (a GitHub org setting your token cannot change), say so in one line with the exact setting, and keep working on everything else.

---

## PART 7. EVERY DEFECT FOUND, AND ITS LESSON

| # | Symptom (real) | Cause | Fix | Lesson |
|---|---|---|---|---|
| D1 | Selection: `{"sha":"2f5699ad...","reason":"prequalification unavailable"}`; shard 4: `FAIL src/engine/AHoldemTournamentAllInCallIsPriced.law.test.ts > option off: nothing of it runs > absent and false give the same decision...`, `AssertionError: expected '{"action":"fold","thinkTime":2206,...' to be '{"action":"fold",...' // Object.is equality`; second receipt `"utilityOwner":"phase7_unavailable"...,"utilityUnavailableReason":"operation_budget"` | Byte-compare law plus a 4 ms wall-clock budget | #11618 freezes `performance.now` | A determinism law must control every clock the code reads, not only the fields it strips |
| D2 | `Version '17.11-0+deb13u1' for 'postgresql-17' was not found` (fixture build exit 100); TypeScript Check red on every PR | Debian main keeps only the current point release | #11613 (other lane) | Exact pins against a rolling archive are time bombs; pin by content hash |
| D3 | 0825z "expired 09:20Z with no dispatch"; 1135z certified 11:38Z, nothing dispatched until 14:13Z | One custodian chat went silent | #11609 scheduled route; custody handoffs | A release path that needs a live chat will lapse; schedule it in CI |
| D4 | "Booking #11574 (0700z) went stale ... Rebooked ... #11587 ... BOOKING STALE AGAIN; REBOOKED AS #11590" | Release-control merges after a booking change the authorization projection | Rebook; freeze posts | Inputs that must not move need a mechanical lock, not a notice |
| D5 | Review: "From March, no cycle has an early reservation run, the 04:00 anchor included" + 3 more | DST hour gap in crons; law pinned to the wrong policy; unconditional prestage closure; wall-clock fall-back | `199438df` | A law that pins a hand-written fixture instead of the real policy tests nothing |
| D6 | Booking PR stuck 40 min on Ownership map | Check reads the original event payload | Re-saved description | Required metadata must exist at PR creation |
| D7 | `Backup Engine refused: rollback_rehearsal_failed_to_bb21dc826731` | UNKNOWN | none yet | Open: investigate (H10) |

The shape most of them share: **an instrument reports success or neutral while the outcome is false.** Stage "completed success" while keeping the old engine; the 1906z booking "merged" while the window needed a dispatcher; CI's red came from a dependency nobody owned. Every barrier you add should make the true outcome the thing that turns red.

Own mistakes from the prior session (do not repeat):
- The first `resume-migration-installs.sh` ran at :48 UTC and was refused. The inbox post claimed "RESUMED" before checking and had to be corrected. Check the result before posting.
- `candidate-ready` was first run with a short sha and printed `UNKNOWN - target SHA is invalid`. Always pass the full 40-char sha.
- We dispatched 1135z after a full preflight that did not include "is prequalification green on the target?". The preflight list in the playbook does not include it, so the dispatch was wasted. Add `gh run list --workflow engine-release-prequalification.yml` for the exact target to your personal preflight (and consider adding it to the playbook in H2).
- `sleep 240` in one host call killed the call. Never sleep more than 70 s per call.
- Two of our subagents and the custodian subagent were killed by session restarts mid-work. After a restart, check reality (Part 9) before resuming anything, and never resume a stopped agent that might dispatch.

---

## PART 8. TRAPS AND INSTRUMENTS THAT LIE

- **T1. Stage "completed success" does not mean released.** Check the receiver. Detect: download the selection artifact and read `outcome`. `keep-serving` means nothing shipped. Run: `gh run download <stageRun> --repo $R -n owner-engine-selection-<window> -D /tmp/sel && jq '.outcome, .deferredCandidates' /tmp/sel/daily-selection.json`. For scheduled runs, list the artifacts with `gh run view <run> --json artifacts` or the API.
- **T2. "MERGED" does not mean live.** Live is /health `releaseSha`.
- **T3. Fleet-reset trap.** A Horse switch row the candidate does not accept makes every Horse option run at its release default after the swap. Always run `engine-release-switch-rows.py candidate` before dispatch and `post-seal` after.
- **T4. A second dispatch** is refused on the host but still fails a receiver and raises a false `EngineReleaseFailed` alert.
- **T5. `resume-migration-installs.sh` at :50-:03 UTC** prints `REFUSED: minute-of-hour ... inside the database's :50-:03 DDL refusal` and changes nothing.
- **T6. Claude scheduler tasks show `enabled: true` while never firing** across accounts (10.85).
- **T7. Backup host lease is first-come.** A post-booking push can starve the booking's PRIORITY run toward its 75-min turn timeout. Detect: `gh run list --workflow backup-engine.yml` shows a non-booking run `in_progress` while the booking run waits.
- **T8. `/health` `maintenance.schedule.policyId`** still says `phase1-hourly-01a1944f` on the old engine. That is the old engine's policy id, not a sign of the hourly exception.
- **T9. GitHub re-runs replay the ORIGINAL event payload.** Editing a PR body then re-running a check does nothing; re-save the body to emit a fresh `edited` event.
- **T10. The shared clone `~/Documents/club-arena`** was found on a broken branch with 71,915 files deleted (fixed by the Antigravity Coordinator 08:32Z). Do not trust files in it; read with `git show refs/remotes/origin/main:<path>`.
- **T11. The device VM (`device_bash`)** gives "Too many open files" on git and stale paths. Use host_terminal.
- **T12. "Process completed" in a subagent report is not proof.** Re-verify every claimed sha on GitHub.

---

## PART 9. VERIFICATION COMMANDS

Set once: `R=Smarter-Software-PIQ/Smarter-Poker-Club-Arena; cd ~/Documents/club-arena && git fetch -q origin main`

Previous work landed (files, not ticks); each must print OK:
```sh
for p in docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md tests/the-engine-cuts-over-every-three-hours.law.test.ts supabase/migrations/20261121091106_freeze_marks_follow_every_three_hourly_engine_cycle.sql; do git cat-file -e refs/remotes/origin/main:$p && echo "OK $p"; done
git show refs/remotes/origin/main:server/src/maintenance/maintenanceSchedulePolicy.json | jq -c '{frequency,startHours}'   # three-hourly [1,4,...,22]
git merge-base --is-ancestor c4c5d2efe50a refs/remotes/origin/main && echo "OK 11609 on main"
git merge-base --is-ancestor 5ef8e6cb5a55 refs/remotes/origin/main && echo "OK 11618 on main"
git show refs/remotes/origin/main:server/src/engine/AHoldemTournamentAllInCallIsPriced.law.test.ts | grep -n "performance, 'now'"
```

Production:
```sh
curl -fsS https://engine.smarter.poker/health | jq -c '{releaseSha,s:.maintenance.schedule,phase:.maintenance.phase}'
export DATABASE_URL=$(bash /tmp/dburl.sh 2>/dev/null)
psql "$DATABASE_URL" -Atc "select version from supabase_migrations.schema_migrations where version in ('20261121091106','20261121153607')"
gh api repos/$R/actions/workflows/apply-merged-migration.yml -q .state   # 'active' outside a hold
gh issue view 11599 --repo $R --comments | tail -30
```

Release pipeline health:
```sh
for w in stage-engine-release.yml auto-deploy-hetzner.yml backup-engine.yml engine-release-prequalification.yml; do gh run list --repo $R --workflow $w --limit 4 --json databaseId,event,status,conclusion,createdAt,headSha -q '.[]|"'$w' \(.databaseId) \(.event) \(.status) \(.conclusion) \(.createdAt[11:16]) \(.headSha[0:10])"'; done
```
Healthy: prequalification `success` on recent main commits (it was green again from 5ef8e6cb onward), a Stage `schedule` run each hour (it no-ops outside windows), and a receiver run after each cycle that has a new certified candidate.

Test gate for the files you touch (no full suites unless needed):
```sh
cd server && npx tsc --noEmit
npx vitest run <changed test files>
cd .. && npx vitest run tests/<changed law files>
TMPDIR=/private/tmp python3 -B tests/operations/<file>.py
```
For release-control changes, always run `tests/the-engine-cuts-over-every-three-hours.law.test.ts`, `tests/the-break-clocks-agree.law.test.ts`, `tests/the-runbook-names-what-it-cites.law.test.ts` and `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts`. The push hook runs about 465 law files itself.

---

## PART 10. FILE MAP

| Path | What | Status |
|---|---|---|
| `CLAUDE.md` (top paragraph, sections 10.12, 10.85, 10.87, 13) | Binding laws, standing orders | live |
| `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md` | Schedule, lane contract, rollback | live on main |
| `docs/ENGINE-RELEASE-RUNBOOK.md` | Release rules and decision tables | live |
| `docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md` | Owner-window steps 1-10 | live |
| `server/src/maintenance/maintenanceSchedulePolicy.json` | The cadence switch (`frequency`) | live on main, takes effect at seal |
| `server/src/maintenance/maintenanceSchedule.ts` | Window math (IANA, DST) | same |
| `server/src/maintenance/MaintenanceBreak.ts` | Break, `/health` schedule | same |
| `.github/workflows/stage-engine-release.yml` | Preparation and selection | live in Actions now |
| `.github/workflows/auto-deploy-hetzner.yml` | Single receiver, #11599 comment | live in Actions now |
| `.github/workflows/backup-engine.yml` | Backup certification | live |
| `.github/workflows/engine-release-prequalification.yml` | Prequalification | live |
| `server/scripts/engine-release-transaction.sh` | Host transaction | deployed with each release |
| `server/scripts/engine-release-seal.py` | Seal, cycle spacing | same |
| `server/scripts/engine-release-activation-floor.py` | Cutoffs | same |
| `server/scripts/engine-release-installed-migrations.py` | Preflight `candidate-ready` | tool |
| `server/scripts/engine-release-switch-rows.py` | Preflight `candidate` / `post-seal` | tool |
| `scripts/release/book-owner-engine-window.py` | Book a window | tool |
| `scripts/release/resume-migration-installs.sh` | Resume installers (:05-:49 UTC) | tool |
| `scripts/ci/select-daily-engine.py` | Selection and deferral reasons | live |
| `scripts/ci/read-engine-prequalification.py` | Prequalification reader | live |
| `scripts/ci/prestage-engine-image.sh` | Prestage closure | live |
| `server/release/owner-maintenance-windows.json` | Bookings | live |
| `server/release/activation-floor.json` | Activation control | live |
| `infra/monitoring/alert-rules.yml` | `EngineCannotBeReplaced` thresholds | live |
| `supabase/migrations/20261121091106_freeze_marks_follow_every_three_hourly_engine_cycle.sql` | Freeze marks per cycle | INSTALLED |
| `tests/the-engine-cuts-over-every-three-hours.law.test.ts` | The cadence law | live |
| `server/src/engine/AHoldemTournamentAllInCallIsPriced.law.test.ts` | D1 law (frozen clock) | live |
| `server/src/engine/HorseLogic.ts:17025`, `server/src/engine/multiway/JointSampleAcquisition.ts:51` | The 4 ms budget clock | live |
| `operations/release/fixture/Dockerfile` | Fixture image (#11613 design) | live |
| `/Volumes/SmarterArchives/agent-evidence/COORDINATION-INBOX.md` | Cross-chat channel | live |
| `~/agent-worktrees/AUDIT-cutover-3h-surfaces.md` | Full audit of every 04:00-assuming surface | reference |
| `.agent/handoffs/` | Handoff prompts (this file goes here) | repo convention |

---

## PART 11. HOW TO BEHAVE ON THIS WORK

- Read real output before believing a summary, including subagent reports. Verify shas on GitHub.
- Fix first at the root. Then harden with a law that would have caught it. Never a watcher.
- Write your own changelog file per change (`docs/changelog/YYYY-MM-DD-<slug>.md`); the repo expects it.
- Measure, don't assume. Suspect the instrument first (Part 8).
- Never pad a number or weaken a gate to meet a target.
- One custodian per window. Post in the inbox BEFORE any custody or release action, and read it before every merge.
- Use a swarm for independent work (each agent in its own worktree; tell each about the 80 s limit). Keep release dispatch in exactly one agent or in yourself.
- Report in plain words, briefly. The owner wants results, not narration.
- Commit trailers (the session's own attribution lines) and PR bodies follow the attribution instructions your environment gives you.

---

## PART 12. OPENING MOVES, IN ORDER

1. Load `mcp__remote-devices__counselors__host_terminal`. Run Part 2.2 and the Part 9 "previous work landed" block. Recreate `/tmp/dburl.sh` if missing.
2. Read the inbox tail since 19:18Z. Find out whether 1906z was certified, dispatched, sealed, refused or abandoned, and who holds custody.
3. Execute Part 5 down the matching branch, until /health shows `three-hourly` and the first AUTOMATIC slot has run (Part 5 step 6).
4. Post the verification to ALL LANES in the inbox, naming PLO Strategy, Horse SWITCH, Antigravity Coordinator and Horse Decisions.
5. Start the hardening phase (Part 6) with a swarm. Parallel and safe at any time: H1 (test-only plus helper), H8, H11, H12. Investigate H10. Then H2, H3, H9 and H6. The release-control ones (H2 partly, H5, H6, H9) merge only outside a booked-window hold, right after a SEALED.
6. For every H item, write the hardening record (Part 6 intro), merge, verify by file on main, and for engine-affecting ones verify it is live after the next automatic slot.
7. Remove the worktrees listed in 2.4 once their content is harvested.
8. Only then report to the owner: what is live (with /health), what each hardening record contains, and anything open.

While blocked on a hold or a certification, you may safely work on H1, H8, H10 (investigation), H11 and H12.

**Last line, the hardest rule: do NOT send a second Stage dispatch for a window someone else holds, and never build a watcher or retry loop in place of a fix.**
