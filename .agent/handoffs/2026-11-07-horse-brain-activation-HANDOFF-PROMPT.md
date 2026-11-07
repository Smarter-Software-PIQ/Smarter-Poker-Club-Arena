# Horse Brain Activation: handoff prompt for the next agent

Written 2026-11-07, about 20:30 UTC, by the Horse Brain activation lane (Claude session
https://claude.ai/code/session_01Gw7aDserGpHsqPic7DpgcS, picked up from
session_01UxDLnKoiUAZihKkw4hbBiw). Paste this whole file as the first message of a fresh chat.
Every number below says when it was measured. Everything else is a command you run.

---

## Part 0: who you are and what you are picking up

You are the Horse Brain activation lane for Smarter.Poker Club Arena. The owner (Dan) runs a
poker platform where 1,000 house AI players ("horses") sit in real games. Players are told at
sign-up, on the Terms page and in the scroll-to-accept ToS modal that tables may include AI
opponents run by Smarter.Poker under ordinary player names (`src/components/legal/aiOpponentsDisclosure.ts`,
PR #8103). That disclosure is why this is ordinary engine work; do not re-litigate it, and do not
remove it.

The programme: every intended production brain capability (Hybrid style, Hold'em ranges and sizing
V60 to V83, Omaha brain, maniac pressure, long-term memory, forced phases 8 and 10 to 14, Decision
Readiness layers, river/flop/turn bluff ranges) must be packaged, configured, reachable, evaluated,
permitted to influence decisions, and observed on the serving engine, for all 1,000 horses, with a
joined evidence chain from expected turn to committed action. The owner's full completion standard
is reproduced in Part 13; read it once.

Where you land: almost everything is merged and serving. The serving engine 40bc2467 (booted
2026-11-07T16:31:19Z, certified cutover via PR #9877) carries every horse PR merged up to #9871.
This session closed the last open work (Part 4) and found ONE live regression on 40bc2467
(own public history no longer loads, Part 7 defect 1) plus one receipt gap; the fix PR is in
Part 5. What went wrong before you: the Nov 7 04:00 engine release failed certification four
times, so the previous engine 92e26a9f served until 16:29Z; and SSD1's archive volume mounted at
the wrong path at 03:02Z (Part 2), which broke the daily scorecard and the proof-kit paths.

Prior sessions: October 22 to November 7. Shipped in the last 48 hours: #9628 #9629 #9632 #9633
#9624 #9646 #9660 #9661 #9663 #9693 #9771 #9780 #9787 #9803 #9821 #9837 #9838 #9841 #9842 #9845
#9859 #9863 #9866 #9867 #9871 #9895 #9896 (all MERGED, verified with `gh pr view` at 18:30Z).

---

## Part 1: STOP CONDITIONS. Read before any work.

Binding owner instructions, verbatim:

> "no watcher shall stand in place of a fix"

> "NO HOT FIXES ALLOWED — 100% HARD-CODED SOURCE FIXES ONLY" (/Users/smarter.poker/.claude/CLAUDE.md, Nov 1 section)

> "A task is NEVER 'DONE' or 'COMPLETED' until the deployment has finished and been verified live."

> "Do not reopen the stopped horses-versus-humans, Free Buy tuning, or general fold-to-3-bet investigations unless a specific reproducible defect directly prevents an approved capability from working."

> "If you want the seven unqualified feature-authority skills forced on the way phases 8 and 10 to 14 were, send: Force activate the seven feature authority skills without qualifying." (the owner has NOT sent this; the seven skills stay unselected until he does)

> "DO NOT DO ANY UN NECESSARY TESTS, OR WORK OUTSIDE OF THIS SCOPE. FINISH ANY AND ALL TASKS USING THE FASTEST, MOST EFFICiENT ROUTE."

Things currently gated or paused:

- Engine activation happens ONLY at the daily 04:00 America/Chicago certified release
  (`stage-engine-release.yml` then `auto-deploy-hetzner.yml`, gated by `backup-engine/certified`
  on the exact main SHA). You never dispatch, cancel, retry or certify an engine release. You never
  restart the engine. Merged engine code is "merged, pending the next engine release" until
  `https://engine.smarter.poker/health` reports a `releaseSha` that contains it.
- `/Users/smarter.poker/.claude/CLAUDE.md` (SHA-256 5682e93629cda44a04605905e13a8c558c246ff117d938d13b6be22db9735869,
  policy 2.9) plus `/Users/smarter.poker/Documents/AGENTS.md`, `AGENT-OPERATING-LAW.md`,
  `AGENT-HARDENING-STANDARD.md`, `AGENT-REFERENCE-INDEX.md` govern you. Read them at start.
- The seven feature-authority skills (Part 6) are OFF by design until qualified or until the owner
  sends the exact force sentence above.
- Phase 8 catastrophe guard: selector `PHASE8_GUARD_PROTECTED_RELEASE_SELECTION` is null; stays
  null until a strength run passes every seed gate (Part 6).
- Migrations are installed only by the `Apply Merged Migration` workflow (dispatch only) or the
  03:30 daily maintenance window; a merged .sql file is not an installation.

What you must NOT do:

- No cron, watcher, reconciler, repair loop, hot fix, runtime patch, manual DB repair, or threshold
  loosening to make a number look better. No law-pin moves except to follow a deliberate behaviour
  change.
- No writes to production tables from this lane except through merged migrations via the workflow.
  All proof is read-only SELECT (`supabase db query --linked --agent=no -o json -f FILE`).
- No forcing of seating, no artificial production hands, no disturbing live games to get a sample.
- No work on the internal drive: worktrees and scratch go under
  `/Volumes/SmarterWork/agent-work/extreme-capacity/<task>/`, evidence under
  `/Volumes/SmarterArchives/agent-evidence/extreme-archive/<name>/`.
- Do not touch `/Users/smarter.poker/Documents/club-arena` working tree (stale at 2306c71185 and
  holding another task's uncommitted `src/pages/TablePage.tsx` edit). Use your own worktree.
- Do not relabel shadow execution as active authority, accept a null policy digest, or fabricate an
  artifact.
- Do not credit Democracy Works, Twilio, or anything irrelevant; this is not the alerts lane.

---

## Part 2: environment bootstrap. Run these first.

You are in a Claude cloud session linked to the owner's Mac Studio (smarterpokers-mac-studio-local).
Two shells exist:

1. `mcp__remote-devices__counselors__host_terminal`: a REAL macOS shell as smarter.poker, with
   Homebrew, node 24, git, `gh` (authenticated as Smarter-Poker), `supabase` CLI (linked to project
   kuklfnapbkmacvwxktbh), `vercel`, and SSH keys. Use it for everything git/gh/supabase/ssh. Default
   cwd `/Users/smarter.poker/Documents/club-arena`. If it is not in your tool list:
   `ToolSearch "select:mcp__remote-devices__counselors__host_terminal"`.
   QUIRK: a call that takes more than about 55 s is cut off ("did not respond within 60s"). Keep
   every call short; run long steps detached:
   `nohup perl -e 'use POSIX qw(setsid); setsid(); exec "sh", "SCRIPT", @ARGV' -- ARGS >/dev/null 2>&1 </dev/null &`
   (the `--` is required) and poll a log/STATUS file. Plain `sleep 60` inside a call will time out.
2. `mcp__remote-devices__device_bash`: a Linux VM with the two connected folders mounted at
   `$HOME/mnt/club-arena` and `$HOME/mnt/Smarter-Poker-World-Hub`. It cannot fetch from GitHub
   (SSH remote) and cannot delete files, so git there leaves `.lock` files. Use it only for reading.
   Request folders with `mcp__remote-devices__device_request_folder_access` (paths
   `~/Documents/club-arena`, `~/Documents/Smarter-Poker-World-Hub`).

GitHub token quirk: the `GH_TOKEN` fine-grained PAT in the host shell cannot run GraphQL
mutations (`gh pr ready`, `gh pr merge`, `gh workflow run` answer "Resource not accessible by
personal access token"). Prefix those with `env -u GH_TOKEN -u GITHUB_TOKEN` to use the keyring
account, which works. Reads work with either. The repo is now
`Smarter-Software-PIQ/Smarter-Poker-Club-Arena` (id 1132369872); `gh` resolves the old
`Smarter-Poker/...` name too. origin remote is `git@github.com:Smarter-Poker/Smarter-Poker-Club-Arena.git`.

Storage state (verified 18:40Z): SSD2 is healthy and mounted inside the authorized roots
(`df /Volumes/SmarterWork/agent-work/extreme-capacity` shows /dev/disk7s1 1.8 Ti, 835 Gi free;
`/Volumes/SmarterArchives/agent-evidence/extreme-archive` /dev/disk7s2). SSD1's archive volume is
NOT at its canonical path: since 03:02Z Nov 7 `/Volumes/SmarterArchives` is a root-owned empty mount
point (mode 000) and SSD1 remounted as `/Volumes/SmarterArchives 1` (/dev/disk9s3) and
`/Volumes/SmarterWork 1` (/dev/disk9s4). Everything under
`/Volumes/SmarterArchives/agent-evidence/hybrid-release-20261105/` and `/horse-scorecard/` is really
at `/Volumes/SmarterArchives 1/agent-evidence/...`. Every script with the canonical path hard-coded
(the proof kit `run-all.sh`, `horse-scorecard/run-scorecard.sh`) fails there. This session worked
around it with symlinks in its own folder (below); the real fix is the owner's storage guide
`/Users/smarter.poker/Documents/MAC-STORAGE.md` and `/Users/smarter.poker/Documents/ssd-tools/`
(remount SSD1 at its canonical point after removing the stale mount dir). Report it; do not `sudo`.

This session's work folder (keep using it, it is on SSD2):
```
W=/Volumes/SmarterWork/agent-work/extreme-capacity/horse-brain-pickup-20261107
$W/kit        -> symlink to "/Volumes/SmarterArchives 1/agent-evidence/hybrid-release-20261105/post-release-kit"
$W/evidence   -> symlink to "/Volumes/SmarterArchives 1/agent-evidence/hybrid-release-20261105"
$W/scorecard  -> symlink to "/Volumes/SmarterArchives 1/agent-evidence/horse-scorecard"
$W/run-all.sh        the proof kit runner with KIT=$W/kit (otherwise identical to kit/run-all.sh)
$W/run-scorecard.sh  the scorecard runner with HERE=$W/scorecard
(wt-memory was removed after #9921 merged)
```

Bootstrap commands (host_terminal):
```
cat /Users/smarter.poker/.claude/CLAUDE.md | shasum -a 256      # expect 5682e936...
cd /Users/smarter.poker/Documents/club-arena && git fetch -q origin main && git log -1 --oneline origin/main
curl -s https://engine.smarter.poker/health | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['releaseSha'],d['bootPhases']['processStartedAt'],d['liveHorseDecision']['phase'])"
df /Volumes/SmarterWork/agent-work/extreme-capacity "/Volumes/SmarterArchives 1" | tail -2
ssh -o BatchMode=yes -o ConnectTimeout=8 -i ~/.ssh/hetzner_deploy_ed25519_new root@5.161.252.33 'docker ps --format "{{.Names}} {{.Status}}" | head -2'
```
Create your worktree: `git worktree add $W/wt-<name> -b <branch> origin/main` from the main repo.

Credentials: never read `.env`, remote URLs or secrets. `gh`, `supabase --linked`, the SSH key
above and the Supabase MCP are the authenticated routes. Supabase project: kuklfnapbkmacvwxktbh.

---

## Part 3: how the thing works (call path)

Decision path (one horse turn):
1. `server/src/engine/ServerTableEngineTurns.ts` builds the live decision snapshot (fence
   `table:hand:seat:lease:turn`, observer read context version 2 carrying `publicMemoryDomain`
   since #9693) and calls the horse decision client (`server/src/engine/horseDecision/client.ts`),
   which attaches `ownPublicHistory` (via `HorseOwnPublicHistoryCache`, loader in
   `server/src/services/HorseOwnPublicHistory.ts`) and enqueues `DECIDE_FAST`/`DECIDE_DEEP` to one
   of 8 worker shards (`server/src/engine/horseDecision/workerRuntime.ts`).
2. The worker runs canonical state, Hybrid profile (`HorseLogic.ts`, `HorseMind.ts`), the policy
   graph, phase admissions (phase 8 ledger, phases 10 to 14 under the forced-authority policy digest
   `HorsePhase1xPolicyDigest`, digest inputs listed in `HorseReferenceDecisionSources.ts`, files
   shipped in the image per #9628 with a CI test), feature authority
   (`HorseFeatureAuthority.ts`, seven skills gated by `docs/evidence/feature-activation/selection.json`
   which does not exist), the bluff ranges (`HorseRiverBluffRange`, flop/turn gates from #9845),
   exploit reads (`HorseOpponentExploit.ts`, Item 12 decay), and emits telemetry via
   `noteFire(feature)` (`server/src/engine/BrainTelemetry.ts`).
3. The result is validated (receipt validators, #9572 class) and committed by the engine; a refused
   receipt becomes `origin = horse_fallback` (fold/check), a clock expiry is receipted
   (`horse_turn_resolved_without_decision*`, `time_bank_activation_retired_turn_ended`, #9603).
4. After the hand commits, `server/src/services/supabase/handHistory.ts` reads durable opponent
   profiles (legacy `readHorseOpponentProfiles` or, when the hand carries a `publicMemoryDomain`,
   `services/HorseExactOpponentMemory.ts` `readExactHorseOpponentProfiles` ->
   RPC `fn_horse_exact_profiles_read`) and calls `observeCompletedHand` so every shard learns;
   long-term memory persists through `services/HorseMindPersistence.ts` into `horse_mind_stats`,
   `horse_mind_pairs`, `horse_mind_stats_scoped`; durable exploit profiles into
   `horse_exploit_profiles` (legacy) and `horse_exact_profiles` (domain-partitioned) via
   `fn_horse_exploit_add` (now Item-12 decay, #9821).
5. Telemetry per worker flushes to `horse_brain_flush_receipts(source_release, collected_at, fires jsonb)`
   and day totals land in `horse_brain_telemetry(day, feature, fires)`. Hand actions with
   `origin`, `stage`, `publicNode` are in `hand_history.actions` (jsonb).

Volume (measured 17:30 to 18:30Z Nov 7 on 40bc2467): about 116,000 brain decisions per hour, 180
active tables, 83 active tournaments, 8 of 8 decision workers ready, 14 of 14 equity workers.
A healthy hour has 0 `horse_fallback` actions, 0 clock-forced turns, memory tables advancing every
minute.

Release path: protected squash merge to main (branch protection; required checks) ->
`stage-engine-release.yml` builds the immutable image at 03:30 CT -> `backup-engine/certified` on
the exact SHA -> `auto-deploy-hetzner.yml` "Engine Release <sha>" cutover at 04:00 CT ->
`/health` `releaseSha` and container labels `sp.release.sha` equal the SHA. Client (Vercel) and
repo tooling need no engine release.

---

## Part 4: complete state inventory (verified 18:30 to 19:20Z, 2026-11-07)

Serving engine: `releaseSha 40bc24676be48aed14155380502ba20c225bfbe6`, image
`sha256:0a1056322818e2752419d560d11ea1139f789bef16f5645cf652886d6b710e0f`, container started
16:30:20Z, process 16:31:19.310Z, source tree f3b56476fd92, labels equal releaseSha, 0 restarts,
horse decision lane ready 8/8, journal publishers 8/8 ready, equity pool 14/14, solver policy
service 1.0.1 with 240 charts. main is 22+ commits ahead of the serving SHA (18:40Z); those commits
are listed per PR below.

Proof kit run against 40bc2467 (`$W/kit/runs/20261107T183530Z/SUMMARY.md`, window 16:31 to 18:35Z):

| Proof | Kit verdict | Real reading |
|---|---|---|
| 1 Manifest | PASS, 31 ancestry lines pass (all held PRs 9628/9629/9632/9624/9633 plus 9646 9660 9661 9663 9780 9787 9792 9803 9822 9771 9837 9841 9842 9838 9845 9859 9871 9693) | PASS |
| 2 Memory | FAIL | Writes PASS: horse_mind_stats 688 -> 696 rows after boot+15, max updated_at 18:31:21 -> 18:41:21; pairs 10,936 -> 12,292; scoped 2,502 -> 2,604; completion_learned 391,234; reads_independent 14,442; reads_pooled_public 219,906; pooled bootstrap 8/8. The FAIL is `own_history_loaded 0` and `opp_memory_read_ok 0`: Part 7 defect 1 (real regression) and defect 2 (receipt gap). `horse_exact_profiles` 3,668 rows, all written since boot, last write 18:49Z; `horse_exploit_profiles` 3,242 rows updated since boot. |
| 3 #9572 | PASS: 0 jam-to-call fallbacks, 0 other fallbacks, 0 illegal, 0 wrong actor over 225,252 actions; docker log shows no `invalid policy receipt` line since boot | PASS |
| 4 Forced phases | FAIL (kit) | Authority RESTORED: phase10_applied 109, phase11 33, phase12 303, phase13 114, phase14_execution_intended 12, digest_unavailable 0, source_unreadable 0, `phase8_authority_worker_usable 8`, `phase14_authority_worker_<variant>-cash_usable 8` for every variant. The kit FAIL is `phase8_applied 0` and "unusable 8": phase8_applied is the catastrophe-guard selection (`phase8_selection_none 219,993`, selector null by design, Part 6) and the kit's "unusable" column reads the guard. Phase 14 is `unselected` for mtt/sng/spin/hu_sng domains by its selection (cash only); that is the selection, not a defect. |
| 5 Time bank | PASS: 0 forced voluntary actions, 0 turn_resolved_without_decision | PASS |
| 6 V82 | FAIL (kit counts prior jams as opens) | Sized opens only (toCall <= 3bb), 16:31 to 18:31Z: tournament 2-handed 1,551 spots, call/raise 41.9% (spec 37 to 66): PASS. 3-handed 257 spots, 14.0%: BELOW spec on this all-seat cut; the previous lane's BB-only 15-18bb cut read 71% (n 83) on 92e26a9f. Pending: re-cut BB-only (Part 6). |
| 7 New receipts | FAIL: 2 WIRING DEFECT rows `horse_history_cache_entry_bound_evicted`, `horse_history_retention_refused` | Both live in the own-history cache and are 0 because of Part 7 defect 1. 36 FIRING, 4 GUARD CLEAR, 10 NO OPPORTUNITY YET, 11 NOT BOUND (V31 store empty, no serving binding; documented). |
| 8 Readiness | PASS: 1,000/1,000 horses on all 18 readiness keys on 40bc2467; coverage 116,483 of 116,483 expected turns from the brain in 60 min, 0 clock, 0 duplicates | PASS |

River bluff baseline (#9803) on 40bc2467, 17:30 to 18:30Z, checked-to river bet % (Query A in
`$W/evidence/NOV7-POST-ADOPTION-RUNBOOK.md`): nlh 34.0% of 2,001 (pre-cutover 29.5), plo4 28.4% of
1,610 (27.0), plo5 29.1% of 368, plo6 37.3% of 126, flo8 34.9% of 218, plo8 27.0% of 89, flh 50.8% of
63. Receipts today: `river_bluff_baseline_*` firing (check 1,552, blockerAndDraw 97, missedDraw 176,
skip_multiway 1,224), `river_bluff_multiway_*` firing, `plan_fingerprint_*` firing (recorded 1,742,
continued_on_blank 424), `opponent_exploit_preflop 117,305`, `calldown 55,793`, `postflop 639`,
`exploit_hydrator_boot_replayed 8`.

Refusals since boot: 0 worker refusals on 40bc2467 (the day total `horse_decision_refused_isolated 8`
is from 92e26a9f before 16:29Z). `reference_shape` refusals (#9787 check): 0 in the docker log.

Scheduled scorecard: it did NOT run for 2026-11-06 at its 01:17Z slot (SSD1 path, Part 2). This
session ran it by hand: `$W/scorecard/scorecard-2026-11-06.md` (13/13 statements, liveness alive,
kit commit 3f0cb3358967). Many receipts show SILENT for Nov 6 because 92e26a9f did not carry them;
the 2026-11-07 scorecard (run it tomorrow for day 2026-11-07) is the first that can show them.

PR ledger, this session (merge commits on main; verify each with `git merge-base --is-ancestor <sha> origin/main`):

| PR | Head merged | Merge commit | What | Deployment |
|---|---|---|---|---|
| #9821 | 1486812307 | 3f0cb3358967408f1895b6b560eafb8d04ff630d | `fn_horse_exploit_add` decays by the Item 12 rule (follow-up to #9780); migration `20261107022913_horse_exploit_decay_is_opportunity_scoped.sql` | INSTALLED LIVE: Apply Merged Migration run 42402356247 success; `schema_migrations` has 20261107022913; `pg_get_functiondef` mentions style shift. No engine release needed. |
| #9916 | 7234eecc01 | ff2d7f6f21448d18688d9ec0e862947d42d6b3d3 | fast call-down read (`HorseFastCalldownRead.ts`, law test), cuts river bluffs into a player who adapted; measured nlh HU bluff rate after 6 calls 0.079 vs 0.546 ablated | engine change: pending next 04:00 CT release |
| #9904 | 21e2908922 | 39d9e27fced848d0cde487de795ac456fbb592c4 | release-window doors are what the engine can call; window install asks for its lock in a quiet moment (`engine-release-window-doors.py`, `maintenance-window-migrations.mjs`, 3 law tests) | release tooling: takes effect on the next engine release / window run |
| #9921 | 4f1de21247 | 9adf5b7f622d64f636cdc65e94b5e388fbc83fbb | exact public-memory read receipts + own public history loads under its speed/ante domain (Part 7 defects 1 and 2) | engine change: pending next 04:00 CT release |

Prior PRs merged Nov 6 to 7 and IN 40bc2467 (one line each): #9628 image ships every hashed policy
source, loud boot failure, CI test (forced phases restored); #9629 every live layer carries a
receipt; #9632 dormant readiness layers wired (plan fingerprint, donor staleness); #9633 V62
stratum repair, V15 boats on in PLO5 cash, opt-in dispositions; #9624 tournament flag cards bind
the transferred repo, near-nut histories fit the packet bound; #9646 PLO current nuts raise,
suited aces 4-bet, paired-turn river; #9660 HU league button, V33, V55 (migration 20261106052532
applied); #9661 replay keeps live rules; #9663 every built skill reaches the decision; #9693 shared
public memory partitioned by speed/ante (introduced Part 7 defects); #9771 V83 aggression read
needs bluffs; #9780 Item 12 opportunity-scoped decay with style-shift release; #9787 maniac cent
call is a reference return, refusals carry journal keys; #9803 baseline river bluff range; #9822
journal start_failed recovery; #9837 river bluff other games; #9838 river lead and hi-lo bluff;
#9841 river bluff league measure (+0.75 six-handed, +1.29 HU bb/100, no cell below zero); #9842
multiway river bluff; #9845 flop/turn bluff and semi-bluff range; #9859 live river bluff EV report
tooling; #9871 value and bubble findings.

Merged after 40bc2467, NOT serving (pending next 04:00 CT release): #9895 (batch bounded accepted
shared-memory witnesses), #9896 (exclude automatic actions from shared opponent reads), #9866 and
#9867 (measurement records only, no engine behaviour), plus this session's #9916, #9904, #9921.

Open PR on the horse side: none after this session (verify: `gh pr list --state open --search "horse"`).
Unpushed horse branches: none. The previous session's worktrees `ca-wt-fca`, `ca-wt-rwr`,
`ca-wt-phase3-v2`, `ca-wt-qrbs`, `ca-wt-qrvd` were all delivered or already merged and have been
removed (`git worktree list | grep ca-wt-` prints nothing).

---

## Part 5: the task that blocks everything else

Verify the next 04:00 CT engine release (2026-11-08, 10:00Z) carries and activates: #9895, #9896,
#9916, #9904, #9921. Done so far: merged (see Part 4). NOT done: not in any image, not serving.

Steps:
1. At about 10:20Z on 2026-11-08 (or whenever `/health` `bootPhases.processStartedAt` is later than
   2026-11-07T16:31Z): record releaseSha; `git merge-base --is-ancestor <merge commit> <releaseSha>`
   for each of the five merge commits.
2. Append `pr:<n>` lines for the five PRs to `$W/kit/required-shas.txt` (same format as the
   existing lines), then run the kit detached:
   `nohup perl -e 'use POSIX qw(setsid); setsid(); exec "sh", "/Volumes/SmarterWork/agent-work/extreme-capacity/horse-brain-pickup-20261107/run-all.sh", @ARGV' -- >/dev/null 2>&1 </dev/null &`
   and read `$W/kit/runs/<stamp>/SUMMARY.md` after about 15 minutes.
   New receipt names from #9921 to add to the kit CASE lists: `horse_exact_memory_read_ok`,
   `horse_exact_memory_read_failed`, `_timeout`, `_busy`, `_invalid`, `horse_exact_memory_read_ms_*`,
   `horse_observer_history_domain_complete`, `horse_observer_history_domain_partitioned` (the
   partitioned counter is expected non-zero until about 2026-11-14 while pre-Nov-6 hands sit in
   the 8-day window). #9916 adds control `riverFastCalldown` and read frame `horse-decision-reads-v10`.
3. Pass criteria beyond Part 4: Proof 2 must show `own_history_loaded > 0`, `own_history_refused`
   bounded, and the new `horse_exact_memory_read_ok > 0` (the kit's `sql/02c-memory-telemetry-per-release.sql`
   still sums the legacy `horse_opponent_memory_read_ok`; add the exact-memory receipt names #9921
   introduced to that CASE list before judging, and to `sql/07-new-receipts-activation.sql`).
   Proof 7 must show `horse_history_cache_entry_bound_evicted` / `horse_history_retention_refused`
   no longer classified WIRING DEFECT (they may legitimately be 0 with FIRING siblings once own
   history loads; read `horse_observer_history_loaded` on the new release as the control).
4. If the release fails certification again (it did four times on Nov 7: runs 42360536751,
   42376964094, 42381322372, 42389189340 under `auto-deploy-hetzner.yml`), record "BLOCKED: no
   certified candidate", read the failing step with `gh run view <id> --log-failed`, and report it;
   the release owner's gate is `backup-engine/certified` (#9690 family). Do not retry it yourself.
5. If #9921 is still open when you start (check `gh pr view <n> --json state`), finish it first:
   read its checks, fix root causes in that branch, merge with
   `env -u GH_TOKEN -u GITHUB_TOKEN gh pr merge <n> --squash --match-head-commit <head> --delete-branch`.

No owner decision is needed for any of this; it is authorized work.

---

## Part 6: the full backlog, prioritised

HIGH
- H1. Post-release proof of the five pending PRs (Part 5).
- H2. V82 3-handed natural coverage. Spec: 37 to 66% call/raise facing one sized open, BB,
  15 to 22bb. All-seat cut on 40bc2467 read 14.0% (n 257). Re-cut BB-only by extending
  `/tmp/v82.sql` style query (base: `$W/kit/runs/20261107T183530Z/sql/06-v82-001.sql` with the
  toCall <= 3bb clause) with a hero-position filter from `act->'publicNode'` (seat tuple
  `[seat, behind, street wager, invested, dead, ante, flags]`; BB is the seat whose preflop `invested`
  equals bigBlind before action). Done means: n >= 200 per cell and the value sits in spec, or a
  reproducible defect with a hand id. Owner of the pending coverage: this lane.
- H3. 2026-11-07 daily scorecard: run `sh $W/run-scorecard.sh 2026-11-07` after 00:05Z Nov 8
  (detached). Done: `$W/scorecard/scorecard-2026-11-07.md` shows the Nov 7 receipts FIRING. Then
  fix the schedule: the installed daily task points at `/Volumes/SmarterArchives/agent-evidence/horse-scorecard/run-scorecard.sh`,
  which is empty until SSD1 remounts (Part 2). Report the mount to the owner's storage route; do
  not add a second scheduler.
- H4. Phase 8 catastrophe guard: strength-league run 42134144996 (number 8, dispatched 2026-11-06
  00:04Z on 5c1aaaef76c6) completed SUCCESS. Read its artifacts (`gh run download 42134144996`
  into `$W/phase8-run8/`), determine whether it is the guard family (`catastrophe_guard_v1`) and
  whether every seed (8101101/8102203/8103307) passes the positive CI99 lower bound in all 6
  objectives with 5 ms latency and integrity. If yes AND the 37-file digest closure is unchanged at
  adoption, write the protected selection `PHASE8_GUARD_PROTECTED_RELEASE_SELECTION` through a PR;
  otherwise record the exact failing seed/objective in
  `$W/evidence/FEATURE-AUTHORITY-QUALIFICATION.md` and leave the selector null. Unverified by this
  session: the run's contents.
- H5. `riverPositionDefense` is the right first feature-authority target (+11.89 bb/100 stderr
  3.60 development; +180.96 +/- 64.92 NLH 2-dealt physical pairs in #9866). Done means the full
  admission chain in `$W/evidence/FEATURE-AUTHORITY-QUALIFICATION.md` "What Admission Requires":
  development pilot per profile -> registered `heldout_locked` plan in
  `IncrementalPressureQualificationPlans.json` + CRN family in `IncrementalPressureQualificationFamilies.json`
  (protected merge) -> provider run `horse-feature-ablation-qualification.yml` -> assembly
  `feature-ablation-assemble.mjs` qualified:true -> protected `docs/evidence/feature-activation/selection.json`.
  Blocker to design around: admission re-hashes `runtimeSourceFiles` including `HorseLogic.ts`,
  which changes many times a day; the plan must be registered and admitted inside one quiet window
  or the closure must be narrowed by a code change (that is an engineering task, not a measurement).

MEDIUM
- M1. Remaining six feature-authority skills, all UNRESOLVED with recorded reasons
  (`$W/evidence/FEATURE-AUTHORITY-QUALIFICATION.md`, #9863, #9866, #9867): `comboDrawPressure`
  (inert: 2 changed pairs in 11,520, never fires without a measured maniac in the pool),
  `v54RiverBluff` (subsumed by the baseline range; -0.98 overall, -16.80 PLO4), `riverBluffCheckRaise`
  (inert, harness cannot reach it), `barrelContinuationOutlook` (implementation defect: 18 accepted
  outlooks, 0 changed actions), `smallPotNearNutRiverValue` (never evaluated: its only call site is
  the legacy HorseLogic river raise branch while PLO cash rivers are owned by the variant policy),
  `multiwayRiverBluffCheckRaise` (+7.10 +/- 2.87, sparse). Each needs either a strategy repair PR
  (barrel outlook, near-nut call site) or a registered held-out plan.
- M2. `v53PloTourneyIcm`: plan `awaiting_protected_source_lock`; six-card route
  `horse-tournament-flag-cards.yml` (3 reserved seeds x 1,024 pairs, one-shot cards); AND no
  production code sets `v53PloTourneyIcm`, so a winning card still needs a new protected
  tournament-flag authority. Not dispatched. Do not dispatch a card until the lock digest is
  satisfiable (exact main tip with no other server change).
- M3. V31 value models: 11 receipts NOT BOUND because `gto_v31_serving_bindings` has no row for the
  engine commit (R7 lost, documented). A binding needs the certification lane
  (`/Volumes/SmarterArchives 1/agent-evidence/v31-certification-01a17e88/`, active Nov 7 12:25).
  Coordinate; do not fabricate a binding.
- M4. Opt-in arms with recorded negative/inconclusive league results, dispositions in
  `$W/evidence/OPT-IN-DISPOSITIONS.md` and #9633: V62 river polarity (-3.67 bb/100 200bb 6-max;
  stratum repaired, still off), PLO6 cash V24 (-2.34 over 84,000 hands), tournamentFlatBump (-1.11),
  v16Hu, v16Ratio, v17RiverProbe, v23ShortDeck, v32FacingDefense, v33DepthCeiling (explained),
  v46ShortDeck, v55OmahaRiverTripsFlat (spot-conditioned evaluation), v15Boats (ON in PLO5 cash
  only since #9633). Re-run only against a changed baseline.
- M5. Value-side PLO4 audit (c-bets and barrels with made hands above solved ranges) and the Q-J
  flush draw folding to 0.7-pot turn bets (bluff-catching). The previous session's "wave 1/2"
  agents (bluff-catching calibration, river overbet sizing, turn-to-river bluff planning, tournament
  bubble/final-table bluffing) left NO code, branch or worktree; they were stopped before producing
  anything. Start from `docs/changelog/2026-11-07-turn-flop-bluff-gates.md` and
  `scripts/horse-measure/TUNING.md`; measure with the #9841 duplicate-deal league before shipping.
- M6. League measurement of the new river layers against humans-calibrated pools for PLO5, PLO6
  and tournaments (the Nov 7 runs were CPU-shared and skipped them; #9841 covered nlh/plo4 cash and
  40bb MTT only).

LOW
- L1. Clean up the older merged worktrees in the main repo (`hb-handoff5`, `hb-select2/3/4`, `horse-audit-*`, `club-arena-wt/*` under ~/Documents and ~/agent-work): `git worktree list`, confirm each branch is merged with `gh pr list --head <branch> --state merged`, then `git worktree remove <path>`.
- L2. Update `$W/evidence/MASTER-CAPABILITY-INVENTORY.csv` (220 rows, totals in
  `MASTER-CAPABILITY-INVENTORY.md` section 2) with the Nov 6 to 7 PRs: the inventory was cut at
  71087373; a regenerated totals table is what the owner's "reconciled inventory" asks for.

Done differently than specified
- The owner asked for the seven feature skills to be "enabled and proved". They were measured
  (#9863, #9866, #9867) and left unselected because none qualifies; the measurement records are
  merged. Enabling an unqualified skill is forbidden by the repository's admission mechanics and by
  the owner's own "do not reclassify" standard. Not a mistake to leave them off.
- The proof kit and scorecard were run from SSD2 via symlinked copies of their runners instead of
  repairing the SSD1 mount, because `sudo` and mount changes are the owner's storage route.

- The 3 follow-up commits inside #9916 (v10 read frame, ledger/digest registration, mirror compose) and the 4th commit in #9904 (fixture versions 15/16 after #9902) were root-cause fixes surfaced by main's contracts, not scope creep; do not revert them.

DECLINED, do not build
- Any watcher/cron/repair loop for memory, refusals, scorecard or release retries.
- A "Phase 14 for tournaments" selection or any relabeling of `phase14 ... unselected` as a defect:
  those domains are unselected by the certified selection, not broken.
- Forcing the seven feature skills without the owner's exact sentence.

BLOCKED on a human
- SSD1 remount at `/Volumes/SmarterArchives` (owner's storage route, Part 2).
- Engine release certification failures (release owner / `backup-engine/certified`).

---

## Part 7: every defect found this session, and its lesson

1. Own public history stopped loading on 40bc2467. Symptom: flush receipts for release 40bc2467
   show `horse_observer_history_loaded` 0 and `horse_observer_history_refused` 0 for 2 hours, while
   92e26a9f emitted 37,696 and 26,703 the same day; proof 7 flagged
   `horse_history_cache_entry_bound_evicted` and `horse_history_retention_refused` as wiring
   defects. Cause: #9693 made `validWindow` in
   `server/src/engine/horseDecision/ownPublicHistory.ts` require `context.version === 1`
   ("Legacy historical packets do not prove speed/ante"), but since the same PR every live context
   is version 2 (carries `publicMemoryDomain`), so `forSnapshot` never yields a packet and
   `request.ownPublicHistory` is always undefined. Fix (#9921): the loader selects
   `hand_history.public_memory_domain` (populated on 57,278 of 58,016 hands since boot), tags each
   hand, and a v2 context accepts a window whose hands all match the context domain key. Lesson:
   when a PR changes a context version, grep every validator that pins the old version; a validator
   that silently returns undefined leaves both the success AND the refusal counter at 0, so the
   proof must treat "both zero" as a defect, never as "no opportunity".
2. Exact public-memory read has no receipt. Symptom: `horse_opponent_memory_read_ok` 0 on
   40bc2467 while `horse_exact_profiles` fills (3,668 rows since boot). Cause:
   `readExactHorseOpponentProfiles` (#9693) never calls `noteFire`. Fix (#9921): own receipt
   family. Lesson: a new read path must inherit the old path's receipts or the proof kit lies.
3. Proof kit mis-verdicts (not engine defects): proof 4 reads the guard's `phase8_applied` as the
   forced-phase authority; proof 6 counts a prior all-in as an open. Read the raw columns, not the
   verdict word. Lesson: the kit's PASS/FAIL words encode Nov 6 assumptions; the runbook
   (`$W/evidence/NOV7-POST-ADOPTION-RUNBOOK.md` sections 2 and 4) is the correct reading.
4. `gh` PAT cannot mutate PRs. Symptom: "Resource not accessible by personal access token
   (markPullRequestReadyForReview)". Fix: `env -u GH_TOKEN -u GITHUB_TOKEN gh ...`. Lesson: two
   accounts are logged in; mutations need the keyring one.
5. Host shell 60 s cutoff (and the Mac was at load 30 to 60 from other agents' suites, so pre-push hooks timed out twice on #9916; tests passed in isolation). Symptom: "Device ... did not respond within 60s" on a `sleep 60`.
   Lesson: detach anything longer than 50 s.
6. Scorecard silently skipped a day. Symptom: no `scorecard-2026-11-06.*` at 01:17Z. Cause: its
   hard-coded path is on the unmounted SSD1 point. Lesson: a scheduled report that writes nowhere
   is indistinguishable from one that never ran; check the output file, not the schedule.

Shared shape: three of six are "a silent zero that looks like no opportunity". Always pair a
success counter with its refusal counter and a control; if all three are zero while the control
fires, it is a wiring defect.

---

## Part 8: traps and instruments that lie

- Kit proof 2 "FAIL" with advancing max(updated_at) in all three tables is a receipt problem, not a
  persistence problem. Detection: `select max(updated_at) from horse_mind_pairs` twice, 10 min apart.
- `horse_brain_telemetry` day totals mix every release that served that day. Detection: group
  `horse_brain_flush_receipts` by `source_release` with `collected_at >= boot`.
- `gh pr merge` printing "could not determine current branch" still merged. Detection:
  `gh pr view <n> --json state,mergeCommit`.
- "Engine Release <sha>" workflow runs show `failure` even for the SHA that is serving (40bc2467's
  run 42389189340 failed yet the engine serves it via the certified cutover #9877). Detection:
  `/health` releaseSha and the container labels, never the workflow conclusion.
- The main checkout at `/Users/smarter.poker/Documents/club-arena` is days old. Detection:
  `git log -1 --oneline` vs `origin/main`; read source with `git show origin/main:<path>` or in your
  worktree.
- `supabase db query` prints a CLI-update banner on stderr; pipe only stdout into JSON parsers.
- `horse_decision_refused_isolated 8` for the day came from the previous engine; docker log since
  boot had zero `horse_decision_worker_failed` lines.
- Apply Merged Migration is dispatch-only; merging a migration PR does not run it. Detection:
  `gh run list --workflow apply-merged-migration.yml` and `supabase_migrations.schema_migrations`.

---

## Part 9: verification commands

Previous work landed (files, not ticks):
```
cd /Users/smarter.poker/Documents/club-arena && git fetch -q origin main
for s in 3f0cb3358967408f1895b6b560eafb8d04ff630d ff2d7f6f21448d18688d9ec0e862947d42d6b3d3 39d9e27fced848d0cde487de795ac456fbb592c4 9adf5b7f622d64f636cdc65e94b5e388fbc83fbb; do git merge-base --is-ancestor $s origin/main && echo "$s on main"; done
git cat-file -e origin/main:server/src/engine/HorseFastCalldownRead.ts && echo fca-file-ok
git cat-file -e origin/main:supabase/migrations/20261107022913_horse_exploit_decay_is_opportunity_scoped.sql && echo mig-file-ok
```
Migration installed:
```
printf "select count(*) from supabase_migrations.schema_migrations where version='20261107022913'" > /tmp/m.sql
timeout 45 supabase db query --linked --agent=no -o json -f /tmp/m.sql     # expect 1
```
Production health (healthy: liveness ok, phase ready, 8/8 workers, 0 expiredJobs):
```
curl -s https://engine.smarter.poker/health | python3 -c "import json,sys;d=json.load(sys.stdin);h=d['liveHorseDecision'];print(d['releaseSha'],d['bootPhases']['processStartedAt'],h['phase'],h['expiredJobs'],h['requestCapacityRefusals'])"
```
Serving-release receipts (healthy on a release with #9921: history_loaded > 0, exact_read_ok > 0):
```
cat > /tmp/r.sql <<'EOF'
select f.value->>'feature' feature, sum((f.value->>'fires')::bigint) fires
from public.horse_brain_flush_receipts r cross join lateral jsonb_array_elements(r.fires) f
where r.collected_at > '<BOOT ISO>' and r.source_release like '<REL8>%'
 and (f.value->>'feature' like 'horse_observer_history%' or f.value->>'feature' like 'horse_exact_memory%' or f.value->>'feature' like 'horse_opponent_memory_read_ok' or f.value->>'feature' like 'phase1%_applied' or f.value->>'feature' like 'phase14_execution_intended' or f.value->>'feature' like 'horse_turn_resolved%')
group by 1 order by 1
EOF
timeout 50 supabase db query --linked --agent=no -o json -f /tmp/r.sql
```
Fallbacks since boot (healthy: no rows):
```
cat > /tmp/f.sql <<'EOF'
select count(*) from hand_history h, jsonb_array_elements(h.actions) x where h.created_at > '<BOOT ISO>' and x->>'origin'='horse_fallback'
EOF
timeout 50 supabase db query --linked --agent=no -o json -f /tmp/f.sql
```
Full kit: Part 5 step 2. Daily scorecard: `sh $W/run-scorecard.sh YYYY-MM-DD` detached; healthy
output ends with `DONE ... coverage 13/13 ... liveness=alive`.
Build gate for an engine PR (from `server/` in your worktree): `npx tsc --noEmit -p .` then
`npx vitest run <affected test files>`; the required GitHub checks are what `gh pr checks <n>`
lists (Server Engine, Client Unit, Accounting transactions, CSS Beat, Whole-hand attribution, etc.;
all must be pass or skipping, none failing).

---

## Part 10: file map

| Path | Role | State |
|---|---|---|
| `server/src/engine/horseDecision/workerRuntime.ts` | worker decision lifecycle, phase admissions, receipts | live |
| `server/src/engine/horseDecision/client.ts` | main-process client, attaches ownPublicHistory | live |
| `server/src/engine/horseDecision/ownPublicHistory.ts` | own-history packet validation/cache | live; v2-context fix in #9921 |
| `server/src/services/HorseOwnPublicHistory.ts` | own-history loader from hand_history | live; domain column added in #9921 |
| `server/src/services/HorseOpponentMemory.ts` | legacy durable profile reads, receipts, admission | live |
| `server/src/services/HorseExactOpponentMemory.ts` | domain-partitioned exact reads (#9693) | live; receipts added in #9921 |
| `server/src/services/supabase/handHistory.ts` | hand commit + completed-hand observation | live |
| `server/src/engine/HorsePublicMemoryDomain.ts` | speed/ante domain key | live |
| `server/src/engine/HorseOpponentExploit.ts` | Item 12 decay, style shift | live (#9780) |
| `supabase/migrations/20261107022913_...sql` | durable `fn_horse_exploit_add` Item 12 | installed |
| `server/src/engine/HorseFastCalldownRead.ts` | fast call-down read | merged, pending release |
| `server/src/engine/HorseFeatureAuthority.ts` | seven skills, admission | live, all unselected |
| `docs/evidence/feature-activation/selection.json` | feature admission bytes | does not exist (by design) |
| `server/src/engine/HorseReferenceDecisionSources.ts` | policy digest inputs | live (#9628 CI test keeps image in step) |
| `server/scripts/engine-release-window-doors.py`, `scripts/ci/maintenance-window-migrations.mjs` | release window doors / window installer | #9904 |
| `scripts/horse-measure/` (`horse-release-verify.py`, `sql/activation.sql`, `sql/scorecard-core.sql`, `river-bluff-ev.ts`, `TUNING.md`) | read-only measurement kit | live tooling |
| `$W/kit/` (post-release-kit: `run-all.sh`, `sql/*.sql`, `scripts/*.sh`, `required-shas.txt`, `runs/`) | post-release proof kit | tooling, SSD1 via symlink |
| `$W/evidence/` (`NOV7-POST-ADOPTION-RUNBOOK.md`, `HORSE-ACTIVATION-UPDATE-2026-11-06.md`, `MASTER-CAPABILITY-INVENTORY.{md,csv}`, `FEATURE-AUTHORITY-QUALIFICATION.md`, `OPT-IN-DISPOSITIONS.md`, `DORMANT-LAYERS-ACTIVATION.md`, `FORCED-PHASES-RESTORED.md`, `LAYER-RECEIPTS-ADDED.md`, `CONTROLLED-COVERAGE.md`) | the activation evidence set | reference |
| `/Volumes/SmarterArchives/agent-evidence/extreme-archive/hybrid-release-20261105-cont/` | SSD2 continuation of the runbook + this session's checkpoint `NOV7-PICKUP-1930Z.md` | checkpoint |
| `src/components/legal/aiOpponentsDisclosure.ts` (+ `TOSAcceptanceModal.tsx`, `TermsOfServicePage.tsx`) | AI-opponent disclosure | live, keep |

---

## Part 11: how to behave on this work

Read the real receipts before believing a verdict word. Fix at the root in source, then harden with
a law test; never widen a timeout or mute a counter. Measure on the serving release by
`source_release`, never by day totals. Keep every proof read-only. Pair every success counter with
its refusal counter and a control. Do not pad coverage: 208 horses that have not played cannot
inherit proof from the others; report readiness (1,000/1,000) separately from live use. Write your
own changelog under `docs/changelog/` with every PR. Record preparation, checks, merge and live
verification as separate states in the checkpoint file. Report to the owner only a material
blocker, a required decision, or verified completion.

---

## Part 12: opening moves, in order

1. Run Part 2 bootstrap; confirm CLAUDE.md hash, serving releaseSha, SSD2 df.
2. `gh pr view 9921 --json state,mergeCommit` (and 9916, 9904). If any is OPEN, finish it
   (Part 5 step 5).
3. If `/health` processStartedAt is still 2026-11-07T16:31Z: nothing to activate yet. Do H2 (V82
   BB-only cut) and H4 (read Phase 8 run 8 artifacts) while you wait.
4. After 00:05Z Nov 8: run the 2026-11-07 scorecard (H3).
5. After the 04:00 CT release boots: Part 5 steps 1 to 3; write the results into
   `/Volumes/SmarterArchives/agent-evidence/extreme-archive/hybrid-release-20261105-cont/` as a
   dated file, and update `HORSE-ACTIVATION-UPDATE-2026-11-06.md` with a Nov 8 section.
6. Then H5 (riverPositionDefense admission design), then M1 to M6 in order.
7. At every stop, update the checkpoint file and report verified completion or the blocker.

While blocked on the release: H2, H4, L1, L2.

Last line, the hardest prohibition: you never start, retry, cancel or certify an engine release,
and no watcher, cron or repair loop may stand in place of a fix.

---

## Part 13: the owner's completion standard (verbatim scope of work)

(The ten numbered sections the owner supplied are reproduced verbatim beside this file:
`.agent/handoffs/2026-11-07-horse-brain-OWNER-SCOPE-2026-11-05.md`; read them in full. Headline: "Are all 1,000 horses configured to access every intended applicable
production capability, and what live evidence proves those capabilities are being used?" must lead
every report, with completed activation, pending natural live coverage, and unresolved defects
kept separate.)
