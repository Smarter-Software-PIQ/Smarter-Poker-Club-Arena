# HANDOFF PROMPT: ANTIGRAVITY COORDINATOR (Club Arena Horse lanes), second handoff

Paste this whole file as the first message of a new chat. It is written for you, the next Antigravity Coordinator.

- Written: 2026-11-21 13:31-13:45 Central (19:31-19:45 UTC). Every state table below says when it was verified.
- Session handing off: `session_01Gw7aDtgw51ks82iZdeEMVr` (Claude, cloud container linked to Dan's Mac Studio). It took over from `session_01UxDLnHu4P9fWx3X7Mp5FjM` at 2026-11-21 02:16 Central.
- The first handoff is on the Mac at `~/Documents/Claude/antigravity-coordinator-01UxDLnH/HANDOFF-20261121.md`. This file supersedes it where they differ; read that one only for history (sections 4 and 5 there hold the 11-20 evidence numbers).
- Dan wants every time he sees in Central (America/Chicago, UTC-6 today). UTC is given in brackets where inboxes or logs use it.

---

## PART 0. WHO YOU ARE AND WHAT YOU ARE PICKING UP

You are the **ANTIGRAVITY COORDINATOR CHAT**. You own the work of seven Antigravity agent lanes in Dan's Club Arena poker platform (Horses are its AI players), and Dan has delegated every decision to you:

> 2026-11-20 15:01 Central, Dan: "YOU OWN THIS CODE BASE AND ARE TO MAKE ANY AND ALL DECISIONS, CHANGES, UPGRADES, ENHANCEMENTS ETC. AND COORDIANTE WITH THE ENGINE CUT OVER, HORSE DECISIONS AND ON OFF SWITCH CHATS AS NEEDED."

> 2026-11-21 02:21 Central, Dan: "YOU OWN THIS CODE BASE AND MAKE ANY AND ALL DECISIONS AND CHOICES ON HOW THIS IS DONE. LAUNCH A SWARM TO HELP WITH THIS."

> 2026-11-21 02:24 Central, Dan: "MAKE SURE YOU ARE WORKING AND COORDINATING WITH THE ENGINE CUT OVER CHAT TO GET THIS DONE AS WELL."

> 2026-11-21 08:47 and 12:25 Central, Dan (repeated): "FINISH UP ANY AND ALL UNFINISHED WORK, AND THEN GO AHEAD AND FULLY BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND TESTED BEFORE CLAIMING SUCCESS. YOU DECIDE THE BUILD ORDER. LAUNCH A SWARM IF IT WILL HELP."

The seven lanes (Antigravity chat ids): HOLDEM STRATEGY `5409ea6d`, LIMIT GAMES `d1ff6b8b` (Dan calls it LIMIT STRATEGY), HUMAN VS HORSE `ca190090`, LIGHTNING GAMES `4a7d7dc0`, HAND ANALYSIS `353d4bf3` (titled HAND ANALSIS), HEADS UP `29a711f2`, PLO6 `a0657c7b`.

**Where you land.** Twelve Antigravity engine merges are on main and certified into a booked cutover, but **none is live yet**: production still serves engine `bb21dc82` (the 2026-11-20 21:00 Central build). Two cutover windows lapsed today without anyone dispatching them, a third (1135z) was abandoned because a flaky test blocked prequalification, and the fourth (1906z) is booked and was not yet dispatched at 13:31 Central. Getting that window sealed and verifying the twelve merges serving is your first job. Two switch-list PRs of yours (#11659, #11643) wait for that seal.

Blunt sentence on what went wrong this session: three swarm agents were killed by a cloud server restart around 11:58 Central and had to be resumed; one subagent died on a Fable usage limit (its evaluation kept running on the Mac and was graded by hand); two agents' `git stash` calls collided and swapped work (recovered, then root-fixed in #11620).

---

## PART 1. STOP CONDITIONS. READ BEFORE ANY WORK.

### 1.1 Dan's standing preferences (binding)
- Never end with an offer, a question, or a handed-back step an agent can do. Decide, do it, report it done. Nothing is ever for Dan to do.
- Fix defects at the root in code or schema, then harden against regression. **No cron, watcher, reconciler or repair loop in place of a fix** ("no watcher shall stand in place of a fix"; CLAUDE.md 10.11 and 10.12).
- Pushed, tested, merged, installed, published and verified-live are separate states. Never claim success before verified-live.
- Do not send frequent progress updates. Work in long stretches; tell Dan only what merged, installed, went live, or is unsafe. Keep messages short.
- Every time you give Dan is in Central.
- Use `mcp__claude-code-remote__send_later` for your own follow-ups. Never put platform-critical work on the Claude scheduler (CLAUDE.md 10.85); `send_later` reminders back into your own session are fine.
- You may launch parallel subagents whenever useful.

### 1.2 Hard product and safety rules
- Horses are players, never "bots". Treat them identically (CLAUDE.md 10.5).
- Hole cards never enter Horse inputs, the repo, a PR, the inbox, a doc or a report. Only the deciding Horse's own cards, offline, on the Mac, deleted after use.
- Never spend real chips to test anything (CLAUDE.md 11.5).
- No emoji and no em dashes in repo text.
- Never print other processes' command lines or environments (`ps aux`, `pgrep -fl`, `env`).
- Never source `.env`, never copy or reveal keys.
- Never remount, rename or unmount drives (Dan's rule).
- Supabase MCP (project `kuklfnapbkmacvwxktbh`): **SELECT only.** Never `apply_migration`. Never `list_migrations` (it runs DDL); read `supabase_migrations.schema_migrations` with `execute_sql`.
- **Never `git stash`** in any clone or worktree of this repo. All worktrees share one stash list; #11620 now refuses new stash entries via `.husky/reference-transaction`.
- Never commit, check out a branch, or edit in the shared clones: Mac `~/Documents/club-arena` and cloud `/home/claude/smarter-poker-club-arena`. Use your own worktree.

### 1.3 The Horse option switch rules (the heart of this job)
- **You never write a switch row.** Only the Horse SWITCH lane writes rows in `public.ca_horse_style_switch` (current session `session_01Gw7aDsLdud3GnjZyZjuya9`; older ids `session_01UxDLnM4`, `hs-league-01UxDLnM4`). Writes go through `fn_ca_horse_option_switch_set` with an evidence row first.
- An option may go on only when its authority file `docs/horse-option-authority.d/<option>.md` says **Evidence MET** per `docs/horse-option-authority.d/README.md` (law `server/src/engine/EveryHorseOptionRecordsItsReplay.law.test.ts`): replay rows scorer-written, unedited, `newlyWrong <= fixed` on every row; league significance `|mean| > 2 stderr`; default-on promotion needs three significant positive runs; serving engine contains the code; list migration installed.
- Measured harm means lock it off-only (recipe in Part 9.4). Lanes self-activate if you do not watch them: tonight HEADS UP wrote its own row (valid outcome) and PLO6 merged a false "MET" (#11581, reverted by #11585).

### 1.4 Engine cutover rules (current)
- One custodian per window, named in the inbox. **You never book, dispatch, pause or resume installers.**
- From a booking PR's merge until the custodian posts SEALED, abandonment or window expiry: **no merges touching** `server/release/`, `server/scripts/`, the four release workflows (stage/receiver/backup/apply/dispatch), `scripts/release/`, `scripts/ci/select-daily-engine.py`, `scripts/ci/read-engine-prequalification.py`, `scripts/ci/read-scoped-release-recovery.py`; no database windows; no switch-row writes. Ordinary `server/src/**`, docs and client merges stay open; they ride the NEXT cutover. Migrations may be merged but are not installed until resume; **for your switch-list migrations, do not merge until SEALED + installers resumed** (only one list migration may be in flight, and it must follow the newest installed list).
- PLO-OWNER lead-3 ruled at 10:41Z that only RELEASE-12/13 (PLO-OWNER session `session_01Gw7aDuHREYyRnFwNqVFJAe`) books windows. In practice since then: the Dedicated Engine Cutover chat (`session_01Gw7aDsC1z7GdpSYmDAM2kv`) took custody of 1135z and booked 1906z, and then Alert Root-Fix (`session_01Gw7aDquR4z7yrveyhc3nEf`) took custody of 1906z at 18:19Z because the booking sat 40 minutes. Read the inbox for who holds the current window before anything else.
- PR #11609 (merged 16:48Z, in the 1906z target) adds automatic three-hourly cutovers at 01, 04, 07, 10, 13, 16, 19, 22 Central. From the first SEALED engine that carries it, slots run on their own (preparation opens 30 minutes before each slot). Engine work then rides the next slot if merged green with migrations installed before slot minus 30 min.

### 1.5 What you must NOT do (short list)
1. Do not merge #11659 or #11643 before 1906z is SEALED and installers are resumed (Part 5).
2. Do not write switch rows, dispatch cutovers, resume installers, or apply migrations.
3. Do not mark any option MET without the README bar met; do not edit scorer rows.
4. Do not enlarge, re-deal or re-slice a declared sample after seeing a figure.
5. Do not touch the branch `swarm-fl-engineer-v2-abe4fbab` (deletes 13M lines; quarantined).
6. Do not `git stash`. Do not work in the shared clones.

---

## PART 2. ENVIRONMENT BOOTSTRAP. RUN THESE FIRST.

### 2.1 Two machines
1. **Cloud container** (where you run): Linux, 2 cores, 7 GB. Shared with your subagents. `gh` here has **no valid token** (`GH_TOKEN` invalid). Git push over HTTPS works through the session proxy.
2. **Dan's Mac Studio**, reached through `mcp__remote-devices__counselors__host_terminal` (load with ToolSearch `select:mcp__remote-devices__counselors__host_terminal`). It is a bash shell as `smarter.poker` with `gh`, `supabase`, `node` and the drives. `gh api` works there. **Each call dies after about 80 seconds regardless of the timeout you pass.** Long jobs: `tmux new-session -d -s <name> '<cmd> > <log> 2>&1'`, then read the log in later calls. `nohup &` and plain background jobs die with the call.

### 2.2 Bootstrap commands
Cloud:
```bash
cd /home/claude/smarter-poker-club-arena 2>/dev/null && git rev-parse HEAD   # if absent, re-clone:
# add the repo first with mcp__claude-code-remote__add_repo(owner="Smarter-Software-PIQ", repo="Smarter-Poker-Club-Arena", access="push"), then:
git clone --depth 1 https://github.com/Smarter-Software-PIQ/smarter-poker-club-arena /home/claude/smarter-poker-club-arena   # 10-minute timeout
cd /home/claude/smarter-poker-club-arena/server && nice npm ci --no-audit --no-fund   # server deps, used by worktrees via symlink
```
Mac (via host_terminal):
```bash
date; curl -s https://engine.smarter.poker/health | python3 -c 'import sys,json;print(json.load(sys.stdin).get("version"))'
F="/Volumes/SmarterArchives 1/agent-evidence/COORDINATION-INBOX.md"; grep -nE "^## 2026-11-2[1-9]" "$F" | tail -15 | cut -c1-240
```

### 2.3 Worktrees
Cloud (preferred for edits and light tests):
```bash
cd /home/claude/smarter-poker-club-arena && git fetch -q --depth=50 origin main
flock /tmp/ca-worktree.lock git worktree add -q -b <branch> /home/claude/ca-wt-<name> origin/main
cd /home/claude/ca-wt-<name> && ln -s /home/claude/smarter-poker-club-arena/server/node_modules server/node_modules   # remove before commit
cd server && flock /tmp/ca-tsc.lock nice npx vitest run <only the files you touched>
```
- Run vitest and tsc only under `flock /tmp/ca-tsc.lock nice`. A full server `tsc --noEmit` is heavy; run it once, alone.
- The cloud clone has no root `node_modules`; client tests need `npm ci` in your own worktree (or link `/home/claude/ca-wt-tools/node_modules` while that worktree exists).
- Push: `git -c push.negotiate=true push -u origin HEAD` then `git ls-remote origin refs/heads/<branch>` must equal `git rev-parse HEAD`. To update a branch that is behind: merge origin/main into it; never rebase a pushed branch, never force.

Mac (for heavy runs: leagues, Lightning paired evaluations, replays):
```bash
AGENT_WORKTREE_ROOT=/Volumes/SmarterWork/agent-work/shared-capacity/<lane>-<you> bash <(git -C ~/Documents/club-arena show origin/main:scripts/agent-workspace.sh) <args>   # read its usage first
bash scripts/heavy-queue.sh run --label "<label>" -- nice -n 19 <command>   # one heavy job at a time, shared queue with other lanes
```
- Since #11616 the script proves the root writable and falls back to `shared-capacity/`; setting `AGENT_WORKTREE_ROOT` explicitly is still safest.
- Push from Mac worktrees with `bash scripts/agent-push.sh` (it refuses the shared clone, main and a detached HEAD; never forces).

### 2.4 GitHub recipes (run on the Mac)
```bash
R=Smarter-Software-PIQ/Smarter-Poker-Club-Arena
gh api repos/$R/pulls/N --jq '"merged=\(.merged) \(.merge_commit_sha[0:10]) head=\(.head.sha[0:10]) auto=\(.auto_merge!=null)"'
H=$(gh api repos/$R/pulls/N --jq .head.sha); gh api "repos/$R/commits/$H/check-runs?per_page=100" --jq '"failed: \([.check_runs[]|select(.conclusion=="failure")|.name]|join(", ")) pending: \([.check_runs[]|select(.status!="completed")]|length)"'
gh api repos/$R/pulls -f title="..." -f head=<branch> -f base=main -F body=@/tmp/body.md --jq .number   # open a PR
cd ~ && gh pr merge N -R $R --auto --squash         # arm auto-merge (the ccr/auto_merge REST route 404s)
cd ~ && gh pr merge N -R $R --disable-auto          # disarm
gh api -X PUT repos/$R/pulls/N/merge -f merge_method=squash -f sha=<full head sha>   # direct merge, head must match
cd ~ && env -u GH_TOKEN -u GITHUB_TOKEN gh run rerun <run_id> --failed -R $R          # rerun failed jobs after the run completes
ID=<job id>; gh api repos/$R/actions/jobs/$ID/logs | cut -c30-330 | grep -E "FAIL |AssertionError|error TS|##\[error\]|Expected|Received" | head   # read a failing job
```
- Commit trailer (this session; use your own session id):
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_<your id>`.
- PR bodies end with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)` then a blank line and the session URL.

### 2.5 Credentials
Live in the Mac's environment for `gh` and `supabase` CLIs. You never read, print or write a credential. Never run `supabase projects api-keys` or anything with `reveal`.

---

## PART 3. HOW THE THING WORKS

### 3.1 From code to live play
```
lane branch -> PR -> required checks -> protected squash merge to main
  -> backup-engine.yml certifies the commit on the Backup host (5.161.236.0)
  -> engine-release-prequalification.yml must pass (a flaky test here blocked every release 09:32Z-15:00Z today; fixed by #11618)
  -> custodian books an owner window (book-owner-engine-window.py --no-advance-notice); booking PR merge = HOLD starts, installers paused
  -> custodian dispatches stage-engine-release.yml ONCE (workflow_dispatch) -> receiver auto-deploy-hetzner.yml
  -> drain, freeze, swap, seal on engine-01 (5.161.252.33) -> custodian posts SEALED -> resume-migration-installs.sh -> HOLD ends
  -> https://engine.smarter.poker/health .version shows the new 8-char SHA
```
- Daily 04:00 Central route still runs (`stage-engine-release.yml` schedule); it chose "keep-serving" today because prequalification was unavailable.
- After #11609 serves: three-hourly slots run themselves; each posts to GitHub issue #11599 "Engine cutover log".

### 3.2 From option to live switch
```
option code in server/src/engine (default OFF) -> registered in HorseDataLedger.ts / HorseOptionSwitch.ts
  -> switch-list migration (gen-horse-option-switch-sql.ts) installed -> allowed states per option in fn_ca_horse_option_switch_states
  -> evidence: league cards (server/src/scripts/horseLeagueCard.ts), Lightning paired eval, audited replay rows
  -> authority file says Evidence MET -> SWITCH lane records evidence + writes the row
  -> engine workers read the row; telemetry option_switch_<option>_on_seen fires once per worker (about 8)
```

### 3.3 Coordination channels
- Primary inbox: `"/Volumes/SmarterArchives 1/agent-evidence/COORDINATION-INBOX.md"` on SSD1 (the space is real). Append-only. Header: `## <UTC ISO>Z FROM <who> (Claude session_...) TO <who> - <subject>`; acknowledgements are `ACK <UTC> <who>: ...` lines under an entry.
- Fallback inbox used heavily by the PLO-OWNER lanes: `/Volumes/SmarterArchives/agent-evidence/extreme-archive/COORDINATION-INBOX-FALLBACK-20261116.md` (SSD2). **Read both.** Post release-relevant entries to both.
- Coordinator desk on the Mac: `~/Documents/Claude/antigravity-coordinator-01UxDLnH/`: `README.md`, `VALIDATION.md`, `PROMPTS.md`, `ACTIVATION-LEDGER-20261120.md` (stale), `HANDOFF-20261121.md` (first handoff), `reports/<LANE>.md` (lane-written, append-only), `reports/COORDINATOR-RULINGS.md` and `reports/COORDINATOR-REPLIES.md` (yours, append-only), `evidence/heads-up/`, `evidence/plo8-hu-first-in/`, `evidence/plo8-oop-realization/`.
- Other chats you coordinate with:

| Who | Session | Role |
|---|---|---|
| Alert Root-Fix | `session_01Gw7aDquR4z7yrveyhc3nEf` | **Custodian of window 1906z** |
| Dedicated Engine Cutover | `session_01Gw7aDsC1z7GdpSYmDAM2kv` | Built three-hourly cutover (#11609), fixed the prequal flake (#11618); stood down from 1906z |
| Old engine cutover custodian | `session_01UxDLnGdoaRhVERVLYrh2KF` | Silent since 07:09Z; let 0825z lapse |
| PLO-OWNER lead-3, RELEASE-12/13, VERIFIER-n | `session_01Gw7aDuHREYyRnFwNqVFJAe` | Orders windows (owner order 2:26 AM); "LEAD RULING NEEDED" subjects get swept every 30 min |
| Horse SWITCH lane | `session_01Gw7aDsLdud3GnjZyZjuya9` | Only writer of switch rows |
| HORSE DECISIONS lead | `session_01Gw7aDsvBGrstGsjKk8NG4Z` | Daily grade, Lightning build stamp |

---

## PART 4. COMPLETE STATE INVENTORY (verified 2026-11-21 19:31Z / 13:31 Central)

### 4.1 Production
| Item | Value |
|---|---|
| Serving engine (`/health .version`) | `bb21dc82` (0300z cutover, sealed 2026-11-20 22:09 Central) |
| Last receiver run | 44863049588, 03:49Z, success |
| Window 1906z | booking #11640 merged 18:18Z as `1a0a6047e1a`; custodian Alert Root-Fix; window 19:06Z-22:06Z (13:06-16:06 Central); **not dispatched at 19:31Z** (no Stage workflow_dispatch since 14:13Z) |
| Installers | paused since 18:18Z by the 1906z custodian; resume after SEALED/abandon/expiry, including #11635's `20261121153607` |
| Newest installed migration | `20261121153438` (read via `schema_migrations`) |
| Newest installed switch list | `20261121042010_horse_option_switch_plo_dark_train` (per the #11659 agent's check against main) |

### 4.2 Switch rows and telemetry (verified 19:31Z)
- `huBbDefendsUnreadToPrice` = **on** since 04:42:12Z (the only Antigravity option on). Telemetry today: `hu_bb_defends_unread_to_price` 33 fires (last 18:11Z); `option_switch_huBbDefendsUnreadToPrice_on_seen` 8; **no** `option_switch_config_*` fault rows.
- **No row exists** for: plo6FacingBetIsPriced, holdemCommittedNoPairIsPriced, holdemDangerBoardEquityIsPriced, omahaHiLoTournamentFirstIn, lightningEarlyFoldNeedsFoldThrough, styleShiftReleaseIsNoiseAware, or any `fixedLimit*` option. That is correct.

### 4.3 The twelve Antigravity engine merges waiting to go live
All twelve were verified as ancestors of the 1906z target `1a0a6047e1a` (`git merge-base --is-ancestor`, 18:26Z).

| PR | Merge SHA | Lane | What |
|---|---|---|---|
| #11564 | 8ec355ab | HAND ANALYSIS | second-look retirement reasons + ruleReceipts journaling (telemetry only) |
| #11573 | 2351ff92 | LIGHTNING | Lightning fix |
| #11577 | dedda1bf | LIGHTNING | authority files for Lightning options |
| #11582 | 045782d0 | LIMIT | fixed-limit wager read E3/E4/E9 |
| #11578 | f94c25f0 | PLO6 | E6/E7/E8 repairs, options default OFF |
| #11545 | d6748b1c | HOLDEM | two priced Hold'em options, default OFF (list 20261121032246 installed) |
| #11565 | 36854c4d | coordinator | scripted fixed-limit league field |
| #11567 | 374bf584 | coordinator | fixedLimitCallIsNotACommitment off-only harm (list 20261121024624 installed) |
| #11556 | f90f60b7 | coordinator | replay stateAt drops forced posts |
| #11563 | d6b032d3 | HEADS UP | `--placed` scorer |
| #11588 | 5bfaa38d | LIGHTNING | omahaFacingBetEvReadOf uses styleSizeShownLightning when separate read on |
| #11623 | 8f854361a0 | coordinator | Lightning fold-through: no release for unraised limp; one jitter roll |

### 4.4 Everything this session merged (oldest first)
| PR | Merge SHA | What |
|---|---|---|
| #11588 | 5bfaa38d0e | Lightning lane fix, reviewed and merged by the coordinator |
| #11597 | d3abbe2a1c | PLO8 first-in replay row on 430 real decisions: fixed 0 / newlyWrong 35 with borrowed 0.72 realization |
| #11598 | 8c2ac3885c | Hold'em priced options replay rows (HVH48-D): committed 0/0, danger 1/1 |
| #11603 | 317c30eb43 | fixed-limit passive caller + over-folding blinds scripts, cards, authority files for every fixed-limit option |
| #11614 | 945de20c45 | lightningEarlyFoldNeedsFoldThrough graded on NLH half: not harmful, no gain |
| #11616 | d312de5b9c | agent-workspace.sh proves root writable; `LIGHTNING_EVAL_TIMEOUT_MS` |
| #11620 | 9b6f98815b | refuse new stash entries (`.husky/reference-transaction`); CLAUDE.md 10.87 rules 5-6 |
| #11621 | e506eaeb97 | authority files: huBbDefendsToPrice, huSmallBlindStealsVsTightBigBlind, nashCallVsJam, v72DefenceByOpener |
| #11622 | 6d83129a95 | node replay keeps the option's ledger receipts (`server/src/benchmark/ReplayArmReceipts.ts`) |
| #11623 | 8f854361a0 | Lightning fold-through root fixes |
| #11624 | d812e6a173 | PLO8 measured OOP realization 1.01; new replay row 0/0 |
| #11626 | cb9ca26c4f | league pays the low half of hi-lo pots via engine determineWinners |
| #11634 | a45b95a2f9 | scripted no-limit field (`NlhScriptedField.ts`) + four Hold'em cards |
| #11637 | 47419adea1 | fixed-limit steal harm controls, per-node tables, mirror re-runs, people count, release-drain finding |

### 4.5 Open PRs you own (verified 19:31Z)
| PR | Head | Auto | Holds what | Merge when |
|---|---|---|---|---|
| **#11659** | 2cfbebac27 | OFF | off-only harm locks for holdemCommittedNoPairIsPriced + holdemDangerBoardEquityIsPriced; list migration `20261121184749_horse_option_switch_holdem_priced_options_harm.sql`, follows `20261121042010` | FIRST, after 1906z SEALED + installers resumed |
| **#11643** | c055ffa577 | OFF | new option styleShiftReleaseIsNoiseAware (default OFF), SQL twin migration `20261121171027_the_style_shift_release_can_be_noise_aware.sql`, list migration `20261121172137_...` following `20261121042010` | SECOND: after #11659 installs, regenerate its list (recipe 9.5), then merge |

Other open list migration in flight (not yours): **#11611** (`agent/blanket-audit-01UxDLnL/plo45-offlist-main2`, PLO-OWNER lane), also follows `20261121042010`. Older stale ones: #11528, #11348, #11350. Settle order with PLO-OWNER lead-3 in the fallback inbox before merging #11659.

### 4.6 Work in flight right now
| What | Where | State at 19:31Z | How to check |
|---|---|---|---|
| Lightning early-fold re-evaluation on fixed code | Mac `/Volumes/SmarterWork/agent-work/shared-capacity/efnft2-01Gw7a/run/`; tmux session `efnft2`; process pid 82601 | single 90-cell process running since 17:37:44Z (11:37 Central); outputs still `.partial`; seed 41987143; declaration sha256 `2e64b99c362145b681251cd6e8b1ab6f258cd25353e4e70b301b7d848a79f9b0`; card sha256 `73ca1f41dd8477ca88a8a106babdd52a82bfde251c37c8ffa91387a4aaf15811`; code `8f854361a0` | `cat $D/drive.log; ls $D/out` (a `.complete.json` + `.json` replaces the `.partial` files when done). The prior equivalent run took about 2 h per 90 cells in six ranges, so expect it done roughly 19:40-21:00Z |
| Subagent that owns it | this session (agent id `a4fb66fab70cf9a29`); it dies with this session | | If you do not hear from it, grade it yourself (Part 5.3) |

### 4.7 Cloud worktrees left from this session (all their PRs merged unless noted)
`/home/claude/ca-wt-flread`, `ca-wt-hilo`, `ca-wt-lfr`, `ca-wt-nrr`, `ca-wt-pfa`, `ca-wt-plo8oop`, `ca-wt-scg`, `ca-wt-tools`, `ca-wt-handoff` (this file) are removable. **Keep** `ca-wt-hlock` (#11659) and `ca-wt-srn` (#11643) until those merge. In a fresh container none exist; recreate from the branch names in 4.5.

Mac worktrees: `/Volumes/SmarterWork/agent-work/shared-capacity/plo8-oop-01Gw7a/claude`, `.../league-hilo-01Gw7a/claude`, `.../efnft2-01Gw7a/claude` (keep until the re-evaluation is graded), `.../coord-efnft-01Gw7aDt/` (first evaluation; keep for evidence).

---

## PART 5. THE TASKS THAT BLOCK EVERYTHING ELSE

### 5.1 Get 1906z sealed and verify the twelve merges live
1. Read both inboxes for the 1906z custodian's DISPATCHED / SEALED / abandonment posts (Alert Root-Fix `session_01Gw7aDquR4z7yrveyhc3nEf`).
2. If nothing has moved and it is past 21:00Z (15:00 Central), post one entry to the custodian in both inboxes: facts (booking merged 18:18Z, no Stage workflow_dispatch since 14:13Z, window expires 22:06Z) and the Antigravity stake (the twelve merges). Do not dispatch yourself.
3. If it lapses or is abandoned: the three-hourly code is still not serving, so the next window is again manual. Post the Antigravity manifest (Part 4.3; all on main, no migrations owed) to whoever books next, in both inboxes.
4. When SEALED:
   ```bash
   V=$(curl -s https://engine.smarter.poker/health | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])'); echo $V   # expect 1a0a6047 or a containing sha
   cd /home/claude/smarter-poker-club-arena && git fetch -q --depth=300 origin main
   FULL=$(git rev-parse $V 2>/dev/null)   # if short sha does not resolve, get the full sha from the SEALED post or the receiver run
   for s in 8ec355ab 2351ff92 dedda1bf 045782d0 f94c25f0 d6748b1c 36854c4d 374bf584 f90f60b7 d6b032d3 5bfaa38d 8f854361a0; do git merge-base --is-ancestor $(git rev-parse $s) $FULL && echo "$s live" || echo "$s NOT live"; done
   ```
   Then run the switch-row and telemetry checks (Part 9.2). Append to `reports/COORDINATOR-REPLIES.md` which merges went live, post an ACK in the primary inbox, and tell Dan in three lines what went live.
5. After SEALED, the Dedicated Engine Cutover chat said it will verify `/health` reports schedule three-hourly and the next slot (22:00 Central = 04:00Z) prepares itself. Read its post; if the slots run, later engine merges need no booking.

### 5.2 Merge the two switch-list PRs in order (after SEALED + installers resumed)
1. Confirm installers resumed (custodian post, or `gh api repos/$R/actions/workflows/apply-merged-migration.yml --jq .state` is `active`).
2. Settle order with #11611 (PLO-OWNER) in the fallback inbox: post `LEAD RULING NEEDED: switch-list order #11659 (Antigravity harm locks) / #11611 (PLO off list) / #11643`. Proposal: whichever is green and confirmed first goes; the others regenerate. If no answer in 30 minutes, take #11659 first (harm locks protect production) and tell them.
3. #11659: merge origin/main into `agent/coord-01Gw7aDt/holdem-harm-locks` if main moved; if a newer list landed, regenerate (recipe 9.5). Checks green, then `gh api -X PUT .../pulls/11659/merge -f merge_method=squash -f sha=<head>`. Watch `apply-merged-migration.yml` install `20261121184749` (or the regenerated version). Verify:
   ```sql
   select public.fn_ca_horse_option_switch_states('holdemCommittedNoPairIsPriced'), public.fn_ca_horse_option_switch_states('holdemDangerBoardEquityIsPriced');   -- both must be {off}
   select version from supabase_migrations.schema_migrations where version like '20261121184749%';
   ```
4. #11643: in `/home/claude/ca-wt-srn` (or recreate from branch `agent/coord-01Gw7aDt/style-release-noise-bound`): merge origin/main, `git rm` its old list file `supabase/migrations/20261121172137_*`, reserve a new version, regenerate so `-- registry:follows:` names #11659's list, semantic diff (only `styleShiftReleaseIsNoiseAware` added to the plain list), run the switch/ledger tests plus `HorseStyleShiftReleaseNoiseAware.test.ts`, push, wait green, merge. Verify both migrations installed and `fn_ca_horse_option_switch_states('styleShiftReleaseIsNoiseAware')` returns its states. The option stays OFF (Evidence NOT MET).

### 5.3 Grade the Lightning re-evaluation
When `$D/out` shows `...cells-0-90.complete.json` (D = `/Volumes/SmarterWork/agent-work/shared-capacity/efnft2-01Gw7a/run`):
```bash
W=/Volumes/SmarterWork/agent-work/shared-capacity/efnft2-01Gw7a/claude   # the worktree; confirm with ls
tmux new-session -d -s efnft2-merge "cd $W/server && NODE_OPTIONS=--max-old-space-size=8192 LIGHTNING_EVAL_MERGE=$D/out nice -n 10 npx vitest run src/lightning/LightningPairedEval.test.ts -t merges > $D/merge.log 2>&1; echo EXIT=\$? >> $D/merge.log"
cat $D/out/lightning-paired-eval-merged.md
```
- Sum G7/Q3/Q4 from the report's `pooled` block (one range report this time; template script in `/Volumes/SmarterWork/agent-work/shared-capacity/coord-efnft-01Gw7aDt/run/GRADE-SUMS.txt` method, keys `pooled.<arm>.dryStreak`, `pooled.<arm>.q3`, `pooled.q4`).
- Apply the rule in `DECLARATION-EFNFT2-NLH90.md` (read it). Harm (P1 z <= -2, any G5/G6 group z < -2, or G1/G2/G3/G7 fail) means prepare an off-only lock after #11659/#11643. Otherwise record numbers; Evidence NOT MET stays unless the declaration's promotion targets are met (Q4 intended share >= two thirds, Q3 rise <= prior +1.08 points) AND a significant positive primary result AND the replay row; none of the last two exists.
- Prior run for comparison (old code, seed 41960321): primary +0.4 (se 1.2, z +0.37); all guards held; Q4 intended share 45.1%; Q3 10.18% -> 11.26%.
- Record in `docs/horse-option-authority.d/lightningEarlyFoldNeedsFoldThrough.md` beside the 2026-11-21 section; changelog; docs PR with auto-merge; post GATE END in the primary inbox. Kill tmux `efnft2` when done (it may already have exited).

---

## PART 6. FULL BACKLOG, PRIORITISED

### HIGH
1. **1906z seal + verify twelve live** (Part 5.1). Done = `/health` shows a sha containing all twelve; reported to Dan.
2. **#11659 then #11643** (Part 5.2). Done = both merged, migrations installed, states verified.
3. **Grade Lightning re-evaluation** (Part 5.3). Done = docs PR merged with the graded numbers.
4. **Watch the live option** `huBbDefendsUnreadToPrice` after the cutover: `option_switch_huBbDefendsUnreadToPrice_on_seen` should re-fire on the new workers (expect about 8 new fires the day of the swap) and decision fires keep growing; any `option_switch_config_invalid_seen` / `_unreadable_seen` / `_stale_seen` > 0 means post to the SWITCH lane to set it off and tell Dan it is unsafe.
5. **PLO6 lane's human-field evaluation** of plo6FacingBetIsPriced (declared 05:30Z, F6 400x500 pairs + M6 100x500; evidence dir `/Volumes/SmarterArchives/agent-evidence/extreme-archive/plo6-audit-01TLQer9Hdf/eval-40aba893fbc9/`, rows in `rows/`). No result posted by 13:31 Central. Read `reports/PLO6.md` and that dir; validate any "MET" claim against recipe 9.3; it stays OFF until real MET.

### MEDIUM
6. **styleShiftReleaseIsNoiseAware evidence.** League (2 seeds each): fixed-limit steal vs value-only blinds +0.32 +/- 0.11 (z 2.96); calibrated NLH field 12,000 pairs +12.83 +/- 3.95 (z 3.25); PLO4 Omaha dev field 6,000 pairs -13.92 +/- 7.51 (z -1.85), seed 20261121 alone -27.79 +/- 12.04 (z -2.31); gear changers no harm. Done = explain the PLO4 seed (per-node table on that card, check whether Omaha reads depend on long-window gated stats the old rule kept artificially fresh), then a declared 3-seed run on a nightly-eligible Omaha card. Replay rows cannot be produced by journal replay (opponent memory off); state that in the file.
7. **omahaHiLoTournamentFirstIn** (PLO8 heads-up first-in, <=20bb). League on corrected hi-lo settlement (#11626), 6,000 pairs per seed: 20261120 +32.36 +/- 4.17 (z 7.75), 20261121 +29.44 +/- 4.10 (z 7.18), 20261122 +33.78 +/- 4.12 (z 8.19). Replay rows: A1 (realization 0.72): fixed 0 / newlyWrong 35; A2 (measured realization 1.01, 4,004 league pots): fixed 0 / newlyWrong 0 / changed 248 / unjudged 248. Missing for MET: an audited gain (fixed > 0) and a recorded activation order. Also: the A1 row must move out of the machine-read `- Replay:` rows before the file can ever say MET (the law parses every `- Replay:` bullet). Not under the preflop hold (checked). Production has only 14 qualifying human-free pots; real hands against people: none.
8. **Lightning early fold**, after 5.3: if no harm and the limp shape is gone, run the PLO4/PLO5 halves (180 cells) under a new declaration with `LIGHTNING_EVAL_TIMEOUT_MS=0`; then the replay (needs early-look node records, which the audited sets do not have).
9. **Fixed-limit options** (all Evidence NOT MET, authority files exist for all 10):
   - fixedLimitRiverOneBetValueRaise: per-node at its own node (river facing one bet, raise instead of call): maniac +2.14 +/- 0.25 per changed pair (z 8.68), passive caller +0.50 +/- 0.21 (z 2.33), value-only +0.46 +/- 0.28 (z 1.63). Value row met in league; Replay cannot run: **fixed-limit hold'em has 0 hands with a person, ever** (`hand_history.has_human`), fixed-limit hi-lo has 107 (one table, 2026-11-03).
   - fixedLimitStealVsTightBlinds: vs over-folding blinds +6.84 +/- 0.28 (z 24.68); vs preflop-defending blinds +6.29 +/- 0.43 (z 14.72); vs value-only blinds +0.02 (inert because of the release drain). Under the owner blind-steal hold ("owner hold: blind steal" name pattern); do not lift without Dan.
   - fixedLimitCallIsNotACommitment, fixedLimitRiverFullBetRead: locked off-only (harm).
   - fixedLimitRiverStrongHandLeads: inert vs every script. fixedLimitReadIgnoresProbes: favourable only vs the maniac's own probe history. Hi-lo options: league still refuses fixed-limit Omaha hi-lo betting (its showdown now splits; betting is still no-limit).
10. **Re-run solver-dependent league cards on the nightly league** (populated solver store): opener-defends, HU postflop balance, PLO4 fold model. Tonight's ran with empty stores.
11. **Every PLO8 league figure before #11626 measured a high-only game.** Notes were added to: `docs/changelog/2026-09-05-daily-horse-audit-2026-09-04.md`, `2026-10-16-horses-read-each-opponent.md`, `2026-11-14-plo8-heads-up-tournament-first-in.md`, `2026-11-20-plo8-first-in-three-league-seeds.md`, `2026-11-20-plo8-first-in-authority-and-lightning-paired-runs.md`, `docs/horse-option-authority.d/omahaMultiwayIsPricedInTournaments.md`. Other lanes' PLO8 cards need re-measurement by their owners (posted 15:45:49Z).

### LOW
12. **Backup rollback rehearsal**: Backup run 44887083680 (09:04Z, main 8c2ac388) refused with `rollback_rehearsal_failed_to_bb21dc826731`. Reported to cutover chats at 09:16Z; no answer read. Check whether later Backup runs certify (`backup-engine.yml` runs); if they still refuse that way, it belongs to the custodian, not you.
13. Remove finished cloud and Mac worktrees (Part 4.7). Keep `evidence` dirs.
14. Update `ACTIVATION-LEDGER-20261120.md` on the desk to current state (optional; lanes read it).
15. `SparringLeague.ts` `runoutEquity` ranks high hands only (no payouts, so not urgent). Fix if PLO8 sparring numbers are ever used.

### Done differently than specified
- **Shared-clone checkout guard was NOT built.** Measured on Apple git 2.50.1: a `reference-transaction` hook refusing HEAD leaves the working tree switched and HEAD on main (worse than the defect); git 2.43 does not even call it for HEAD. A post-checkout auto-revert would be a repair loop (10.12) and `tests/unit/resetGuardCannotSaveTheWorktree.test.ts` forbids it. The rule is written in CLAUDE.md 10.87 rule 6 instead. **If a future agent "fixes" this by building that hook, it is a mistake.**
- Stash refusal shipped instead (#11620). Side effect: `rebase --autostash` that conflicts on re-apply stops and prints the stash commit id.
- `styleShiftReleaseIsNoiseAware` was built as a new default-OFF option instead of changing the 2026-11-06 rule in place, because the rule runs in every Horse's live memory and is owner-ruled.
- Lightning lock was NOT made: the full NLH half did not confirm the development harm signal.

### DECLINED, do not build
- Any switch row write by the coordinator. Any self-dispatch of a cutover.
- Lifting the owner preflop hold or blind-steal hold for huBbDefendsToPrice, huSmallBlindStealsVsTightBigBlind, fixedLimitStealVsTightBlinds, fixedLimitPricedPreflop without Dan's order.

### BLOCKED on a human or another chat
- Cutover dispatch: the window custodian.
- Switch-on of any MET option: SWITCH lane, plus Dan's verbatim order where the authority file requires it.
- Audited hand sets against people for fixed-limit hold'em and PLO8 heads-up tournaments: the data does not exist; only real play creates it.

---

## PART 7. DEFECTS FOUND THIS SESSION, AND THE LESSON

1. **Shared clone rotted.** `~/Documents/club-arena` was on branch `fix-nlh-logic-integration`, 274 behind, 71,915 tracked files deleted, `.git/index.lock` from 2026-11-20 15:38 held only by the sandbox VM. Fixed 02:30 Central: tagged `rescue/canonical-fix-nlh-logic-integration-2026-11-21`, archived 4 modified files and untracked bits to `~/Documents/_agent-backups/club-arena-shared-clone-20261121-coordinator/`, `checkout -f main`, ff to origin/main. Three untracked migrations there (`20261119041211/041228/041251`) were never applied in production. Lesson: the tree nobody pushes from is the tree agents load doctrine from; check `git status` as well as rev-list.
2. **Prequalification flake blocked every release 09:32Z-15:00Z.** `AHoldemTournamentAllInCallIsPriced.law.test.ts` compared receipts produced under a 4 ms `performance.now()` budget (`JOINT_SAMPLE_WORK_BUDGET_MS`, HorseLogic.ts). Fixed by #11618 (frozen clock). Lesson: any test comparing receipts of budgeted work must freeze the clock.
3. **League paid PLO8 pots high-only.** `HorseLeague.ts` `playHand` paid the best high hand always. Fixed by #11626 via engine `determineWinners`. PLO8 first-in still significant (~4-6 bb/100 lower).
4. **Lightning fold-through manufactured blind-vs-blind** and drew a second jitter. Fixed by #11623 (receipt `lightning_fold_through_limp_kept`; the cheap-entry option is the one exception).
5. **Style-shift release fires on noise** and ages every gated stat (2-4% of hands for a stable mixed player; 11.7 vs 34.1 decayed fold samples). Fix built default-OFF in #11643.
6. **agent-workspace.sh default root read-only** on the Mac; fixed by #11616.
7. **Lightning harness hard 2 h timeout** killed a 90-cell process at 60 cells; fixed by #11616 (`LIGHTNING_EVAL_TIMEOUT_MS`, 0 = none).
8. **Replay receipt filter** missed `omaha_hilo_tournament_first_in` ("(no receipt)"); fixed by #11622.
9. **Shared stash list** swapped two agents' work; fixed by #11620.
10. **Danger-board option** uses a 50-showdown, call-biased bettor range; loses -7.90 bb/100 (z -9.74) vs a bluffing danger-board bettor. Lock in #11659.

Shape they share: a measuring instrument (a league, a harness, a filter, a test budget, a shared tree) silently answered a different question than the one asked. Before trusting a number, prove the instrument on a case where you know the answer.

---

## PART 8. TRAPS AND INSTRUMENTS THAT LIE

- **`/health` does not show switch states.** Read `ca_horse_style_switch`.
- **"Merged" is not "live".** Only `/health` version + ancestry proves it.
- **A booking can be merged and then never dispatched.** Happened twice today (0825z, and 1135z sat 3 h). Check `stage-engine-release.yml` workflow_dispatch runs: `gh api "repos/$R/actions/workflows/stage-engine-release.yml/runs?per_page=5" --jq '.workflow_runs[]|"\(.event) \(.status) \(.conclusion) \(.created_at)"'`.
- **"Kept serving" Stage outcome** means the selector rejected the candidate (read its `daily-selection.json` reason), not that a cutover happened.
- **Supabase MCP runs one transaction per call;** multi-statement queries return only the last result set. Use one statement, or UNION ALL rows into one result.
- **`fn_ca_horse_option_switch_states` returns `text[]`;** select it directly.
- **The ccr auto-merge REST route 404s;** use `gh pr merge --auto --squash` from `~` on the Mac.
- **CI failures that are not yours:** native-smoke / TypeScript Check "FIXTURE_GATE_NATIVE_SUCCESS_REQUIRED" with `Version '17.11-0+deb13u1' ... not found` was a repo-wide image fault fixed by #11613; merge main into the branch. `tests/unit/agentPushVerifiesTheRemoteRef.test.ts` "a SIGKILL of the helper alone..." flakes under load; rerun failed jobs.
- **Host terminal "Connection closed"** after ~80 s: the command may still have run; re-read state before repeating anything that changes state.
- **The law parser** treats every bullet beginning `- Replay:` in an authority file as a machine-read run row.
- **A server restart kills subagents.** Resume with `SendMessage` to the agent id (works only within the same session); tell it to check its Mac tmux jobs before starting anything.
- **Subagents on Fable can hit a usage limit** ("resets Nov 28"); run subagents on the default model.
- **The DDL break window** (:50-:03 UTC each hour) refuses migrations and the installer resume (custodian's 14:48Z resume was refused at :48).

---

## PART 9. VERIFICATION COMMANDS AND RECIPES

### 9.1 Previous work landed (files, not ticks)
```bash
cd /home/claude/smarter-poker-club-arena && git fetch -q --depth=50 origin main
for p in server/src/benchmark/ReplayArmReceipts.ts server/src/benchmark/NlhScriptedField.ts server/src/benchmark/FixedLimitScriptedField.ts .husky/reference-transaction docs/horse-option-authority.d/nashCallVsJam.md docs/horse-option-authority.d/fixedLimitRiverOneBetValueRaise.md; do git cat-file -e origin/main:$p && echo "ok $p" || echo "MISSING $p"; done
```

### 9.2 Production health and switch safety
```sql
select option,state,updated_by,updated_at from public.ca_horse_style_switch where option in ('plo6FacingBetIsPriced','holdemCommittedNoPairIsPriced','holdemDangerBoardEquityIsPriced','omahaHiLoTournamentFirstIn','lightningEarlyFoldNeedsFoldThrough','styleShiftReleaseIsNoiseAware','huBbDefendsUnreadToPrice') or option like 'fixedLimit%';
-- healthy: only huBbDefendsUnreadToPrice = on
select feature,fires,updated_at from public.horse_brain_telemetry where day >= current_date - 1 and (feature like 'hu_bb_defends_unread%' or feature like 'option_switch_config_%' or feature like 'option_switch_huBb%');
-- healthy: decision fires growing, zero option_switch_config_* rows
```

### 9.3 Validate an "Evidence MET" PR
Rows name a scorer SHA on main and are unedited; every row `newlyWrong <= fixed`; league `|mean| > 2 stderr`; status sentence matches. Otherwise comment exactly what fails and disarm auto-merge.

### 9.4 Lock an option off as measured harm (template #11567, #11659)
Worktree off origin/main; add `OPTION_SWITCH_OFF_ONLY` entry before `v24PloDefense:` as `<option>: Object.freeze({ status: 'harm' as const, reason: '<numbers with z>', source: '<cards, PR, docs>' })`; move its pin in `everyUpgradeHasALiveSwitch.law.test.ts` and add `expectStatus(...,'harm',/^<source prefix>/)`; `bash scripts/reserve-migration-version.sh <slug>`, delete the empty file; from `server/`: `npx tsx scripts/gen-horse-option-switch-sql.ts --follow-up <version>_<slug>`; check the `-- registry:follows:` line names the newest list on main; run `HorseOptionSwitch*.test.ts`, `HorseOptionSwitchMigrationLists.test.ts`, `horseDecision/aSwitchListIsNeverStale.law.test.ts`, `everySwitchListNameIsRegistered.law.test.ts`, `everyUpgradeHasALiveSwitch.law.test.ts`, the HorseDataLedger tests, `ADefaultOffFlagHasALeagueCard`; changelog; push; PR with auto-merge OFF if a hold is active.

### 9.5 Regenerate a list after a newer list merges (template #11545)
Merge origin/main into the branch (on conflict in `scripts/ci/test-horse-option-switch-evidence-postgres.sh` take main's: `git checkout --theirs`); `git rm` the old list file; reserve a new version; regenerate; semantic diff by parsing `-- registry:<block>:begin ... :end` blocks (style-options, plain-options, shadow-options, on-shadow-options, off-only-options) against main's newest list, only the intended options may differ; tests; push; merge after checks.

### 9.6 Validate an activation (if the SWITCH lane turns something on)
`ca_horse_style_switch.note` sha256 equals `git show origin/main:<authority file> | sha256sum`; an evidence row in `ca_horse_option_switch_evidence`; serving engine contains the option's code (ancestry); list migration installed; `option_switch_<option>_on_seen` about 8.

---

## PART 10. FILE MAP

| Path | What |
|---|---|
| `server/src/engine/HorseOptionSwitch.ts` | registry: `OPTION_SWITCH_OFF_ONLY`, `OPTION_SWITCH_PREFLOP_HOLD_LIFTED`, `OVERRIDES` (live) |
| `server/src/engine/HorseDataLedger.ts` | every option, flag and receipt (live) |
| `server/scripts/gen-horse-option-switch-sql.ts` | switch-list migration generator (held path during cutovers) |
| `server/src/engine/HorseOptionSwitchMigrationLists.ts` + `horseDecision/aSwitchListIsNeverStale.law.test.ts` | stale-list guard (#11553) |
| `docs/horse-option-authority.d/README.md` | the evidence bar; one file per option |
| `server/src/scripts/horseLeagueCard.ts`, `server/src/benchmark/HorseLeagueCard.ts` | single-card league runner (`--card= --seed=a,b --pairs=`) |
| `server/src/benchmark/HorseLeague.ts` | league; `settleLeagueShowdown` (hi-lo since #11626) |
| `server/src/benchmark/HorseLeagueHumanField.ts` | human/scripted fields, `FIXED_LIMIT_SCRIPTED_FIELD_CARDS` |
| `server/src/benchmark/FixedLimitScriptedField.ts`, `NlhScriptedField.ts` | scripted opponents (DESIGN VALUE thresholds labelled) |
| `server/src/lightning/LightningPairedEval.test.ts` + `LIGHTNING-PAIRED-EVAL-README.md` | Lightning paired evaluation runner and merge |
| `server/scripts/audited-node-option-replay.ts`, `audited-decision-replay.ts` (`--placed --line on --row on`) | replay arms and scorer |
| `server/src/benchmark/ReplayArmReceipts.ts` | option receipt filter (#11622) |
| `server/src/engine/HorseLightningFoldThrough.ts`, `HorseLogic.ts` | Lightning early-fold logic (#11623) |
| `docs/horse-league-fixed-limit.md` | fixed-limit league record, incl. the release-drain finding |
| `scripts/agent-workspace.sh`, `scripts/agent-push.sh`, `scripts/heavy-queue.sh` | worktrees, push, Mac heavy queue |
| `.husky/reference-transaction` | stash refusal (#11620) |
| `CLAUDE.md` 10.87, 10.88, 10.11, 10.12, 10.85, 11.5 | rules you will hit |

---

## PART 11. HOW TO BEHAVE ON THIS WORK

- Read the real output before believing a test or a tick. Suspect the instrument first.
- Fix first, at the root; pin the cause with a test that fails without the fix.
- Write your own changelog file `docs/changelog/YYYY-MM-DD-<slug>.md`; never append to `MIGRATION-CHANGELOG.md`.
- Declare samples, seeds, sizes and the pass/fail rule in a file with a sha256 before dealing. Keep both results if you ever run more. Never chase significance.
- Never report a number you did not measure; label borrowed constants and design values.
- Give every subagent the full environment block (Part 2), the hold rules (1.4), the no-stash rule, and "never write a switch row". Run heavy work on the Mac via the heavy queue; only light work in the cloud.
- Post to both inboxes for anything release-related; to `reports/COORDINATOR-REPLIES.md` for lane direction.
- To Dan: only what merged, installed, went live, or is unsafe. Central times. No narration, no offers.

---

## PART 12. OPENING MOVES, IN ORDER

1. Bootstrap (Part 2.2). Read the last 20 headers of both inboxes and `reports/COORDINATOR-REPLIES.md`, `reports/PLO6.md`, `reports/LIGHTNING-GAMES.md` tails.
2. Check 1906z status and `/health` (Part 5.1). If sealed, run the ancestry and switch checks and report live merges to Dan.
3. Run Part 9.2. If anything unsafe, post to the SWITCH lane and tell Dan.
4. Check the Lightning re-evaluation directory (Part 4.6); grade it if complete (Part 5.3), else `send_later` a check for its expected end.
5. Set `send_later` reminders: one for the 1906z window end (22:06Z = 16:06 Central), one for the first three-hourly slot after it (22:00 Central = 04:00Z) if 1906z seals.
6. After SEALED + installers resumed: settle list order with PLO-OWNER, merge #11659, then regenerate and merge #11643 (Part 5.2).
7. While blocked: PLO6 result validation, styleShiftReleaseIsNoiseAware PLO4 investigation, worktree cleanup, solver-store league reruns.

Last line, the hardest prohibition: **you never write a switch row, never dispatch a cutover, and never merge a switch-list migration inside a booking-to-SEALED hold.**
