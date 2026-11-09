# HANDOFF: Horse Style Brain Activation lane: military-grade continuation

Written 2026-11-09 about 15:55Z (09:55 CST, America/Chicago is UTC-6 on this date) by the lane session
`session_01BbZPDm3wWQZGupszrXj81G` (Claude, cloud container). It supersedes nothing: the 2026-11-07
handoff and the lane checkpoint stay authoritative history. Every fact below was re-read from GitHub,
production `/health`, the repository or the evidence folder within the last hour, unless it is marked
**UNVERIFIED** or **UNKNOWN, NEXT AGENT MUST INSPECT**.

Durable copies of this file:
- `/Volumes/SmarterArchives/agent-evidence/extreme-archive/hybrid-release-20261105-cont/2026-11-09-horse-brain-activation-HANDOFF-PROMPT.md`
  (Mac Studio SSD; the evidence folder this lane has always used)
- `.agent/handoffs/2026-11-09-horse-brain-activation-HANDOFF-PROMPT.md` in the repository, through a docs-only PR
  (section 10 gives its state)

---

## 1. Executive Continuation Brief

**What this is.** Club Arena is the online-poker product of Smarter.Poker (owner and CEO Dan Bekavac). Its
AI players are called **horses**; never call them bots. A horse's decisions come from the "horse brain"
(`server/src/engine/HorseLogic.ts`, `HorseMind.ts`, the `horseDecision/` worker pool and many layers),
running inside the Hetzner poker engine. This lane is **Horse Style Brain Activation**. It ships
horse-brain fixes, proves them on the live engine, and runs the held-out qualification that can activate
one gated brain feature, **riverPositionDefense**.

**Original assignment.** "PICK UP WHERE THE OTHER AGENT LEFT OFF WITH HORSE STYLE BRAIN ACTIVATION",
starting from `.agent/handoffs/2026-11-07-horse-brain-activation-HANDOFF-PROMPT.md`.

**Owner's current assignment** (Dan, Nov 8 18:57 CT, narrowed by his Nov 9 08:44, 08:55 and 09:18 CST
directions). The lane owns:
- **D5:** register family 283 ONCE, for `riverPositionDefense` only, and run its single held-out
  qualification; activate only if it qualifies.
- **D6:** after a sealed release, verify the eight assigned brain fixes live.
- vs3BetShortStack stays disabled.
- One checkpoint, kept current; clean up owned resources.

D1 to D4 (merging the five decision-code PRs, the 3-bet/4-bet audit, the near-nut fixture,
vs3BetShortStack) are DONE.

**Where it stands right now (15:55Z):**
- Production engine: `releaseSha 391f7bc0d57c71637bd4af5181f70520661e3593`, booted
  2026-11-07T21:20:16Z, maintenance idle. It contains NONE of the eight assigned fixes.
- The release owner is running a one-off owner-authorized "ASAP" engine release, window
  `2026-11-09-owner-asap-engine-1530z` (open 15:30Z to 21:30Z):
  - candidate `e366fab1398cd9d10f0b11228d41329c7a54b1ea`;
  - **all eight assigned fixes are in it** (verified with the GitHub compare API);
  - its Backup certification started 15:35:45Z and was expected to finish around 16:35Z;
  - then the release owner dispatches Stage by hand, and the engine seals and thaws.
- This lane holds three green, reviewed PRs: **#10140** (assemble CLI always exits), **#10145**
  (qualification reads ride out transient GitHub errors) and **#10132** (the family 283 registration).
  They must NOT merge until that release has SEALED and thawed, or the window has ended. The release
  owner named `server/**` pushes as candidate-invalidating.

**The single most important thing to understand.** The qualification is IRREVERSIBLE. One dispatch spends
held-out family 283 for ever:
- a failed run burns the partition;
- a rerun is refused once a cell's Execute step has started;
- a second dispatch is refused because the partition is reserved.

Every check in section 21 exists to make that one dispatch succeed. Never dispatch until all of them pass.

**Second most important (found today).** Even a qualified result can only ACTIVATE on a sealed engine whose
336 decision-closure files and `server/package-lock.json` are byte-identical to the registered plan
(`admitHorseFeatureAuthority` re-hashes them). The redrafted plan will include #10145's change to
`server/src/benchmark/IncrementalPressureQualification.ts`, which the candidate `e366fab1` lacks. So
activation can never happen on `e366fab1`. It needs a LATER release, and no decision-closure file may
change on main between the redraft and that release's seal.

**First action for the next agent:** section 22.

---

## 2. User Requirements And Working Preferences

The owner's words, verbatim where it matters, in time order.

- Nov 8 18:57 CT (assignment):
  - merge #10102, #10103, #10038, #10048 and #10095;
  - register family 283 once, for riverPositionDefense only, and complete its qualification;
  - verify live receipts for #10031, #10033, #9921, #9916 and the new fixes on a sealed engine;
  - keep vs3BetShortStack disabled;
  - finish the near-nut fixture.
- Nov 8 14:18 CT: register family 283 for riverPositionDefense ONLY. combo_draw_pressure,
  targeted_river_bluff and river_bluff_checkraise are permanently excluded from family 283 and stay
  unqualified; any future qualification for them needs its own approved held-out family.
- Nov 9 00:15 CST:
  - Use actual release receipts and thaw state to decide readiness, never the clock.
  - Before merging #10132, revalidate the plan against the resulting protected main.
  - Complete the serving-engine checks before dispatch: exact SHA, protected provenance, decision-code
    compatibility, SEALED receipt and complete thaw.
  - Record which fixes are present and which have live decision evidence.
  - "A quiet CI hour reduces contention but does not resolve the identified GitHub API failure risk",
    hence #10145.
  - Verify that the process-exit fix preserves failures and completes all writes (done in #10140).
  - Immediately before dispatch, confirm plan and tool fingerprints, unused held-out allocation, durable
    claims and the absence of another active qualification.
  - Dispatch once. Preserve every result. No retries that violate the contract.
  - Retain ownership through the outcome, any permitted activation and live verification.
- Nov 9 07:55 / 08:01 / 08:06 / 08:23 CST:
  - Use a durable cursor in the thread waiter (done: `since=` plus a seen-versions file).
  - Keep one clear request naming the three PRs, their heads and the release inputs they change.
  - Stop sending unchanged waiting updates.
- Nov 9 08:44 CST, scope reset: return to the original authorized scope. Do not adopt other lanes' work.
  Treat shared dependencies as coordination points. One checkpoint. Check ownership and active writers
  before any write.
- Nov 9 08:55 CST:
  - Resolve family 283's duplicate ownership (DONE for the release owner; Horse study root still open).
  - Coordinate #10140 and #10145 with the cutover owner, then rebuild and independently review #10132 on
    the final source, and confirm both dispatch fixes are present, the family unused and no competing run.
  - Any stability control must be narrowly scoped to qualification compatibility and bounded in
    duration, "without imposing a blanket freeze".
  - Leave out of this assignment: the proposed registry, new retry semantics, the broader backlog and
    other-chat resets.
  - Report when ready to archive.
- Nov 9 09:18 CST:
  - Distinguish historical snapshots from current facts.
  - Keep release-system repairs, financial recovery, R8 and the separate Horse study with their owners.
  - Attach to the ASAP cutover under #10063 comment 6741660924 through its sole owner.
  - In live checks, distinguish availability, evaluation, supersession, fallback and committed action.
  - Correct scare-abort expectations: a receipt can legitimately record an evaluation without changing
    the action (DONE).
  - Report only material blockers or verified milestones.
- Stored standing preferences (owner memory):
  - plain English to the owner, no SHAs or jargon as the main content;
  - autonomous execution; never ask the owner to do a job the agent can do, including merging its own PRs;
  - no unverified data; do not claim success until verified;
  - stay in scope;
  - agent work trees go on the external SSD and are deleted when finished;
  - when a line from the owner is needed, end the message with the exact line to send.
- Repository laws that bind this work: section 5.

---

## 3. Project And Repository Identity

| Item | Value | Status |
| --- | --- | --- |
| Project | Smarter.Poker Club Arena (Vite + React SPA client, Node/TypeScript Hetzner engine under `server/`) | confirmed |
| GitHub repo | `Smarter-Software-PIQ/Smarter-Poker-Club-Arena` (the old owner path `Smarter-Poker/...` redirects; use the new one) | confirmed |
| Default branch | `main`; protected ruleset: squash only, 0 required approvals, strict false | confirmed (read Nov 9 01:05Z) |
| Required checks | TypeScript Check; Client Unit Tests (vitest); Server Engine (typecheck + tests); Production Build; CSS Beat E2E (multi-table + animations); Money trigger declaration authority. "Skipped" counts as pass. | confirmed |
| origin/main tip | `64d01106191cec1ed1bd81e7e492b71c46c06fbe` (15:46:42Z Nov 9) | confirmed 15:50Z |
| Mac shared clone | `/Users/smarter.poker/Documents/club-arena` (NEVER push or commit from it; read-only use only) | confirmed |
| Cloud worktrees (THIS container, ephemeral) | `/home/claude/wt-reg`, `wt-exit`, `wt-read`, `wt-rpd`, plus a shallow clone `/home/claude/smarter-poker-club-arena` | confirmed; a new chat in a new container will NOT have them |
| Runtime | Node 22 in CI (`actions/setup-node` node-version 22); Mac has Node v22.23.3 under nvm and v24 on PATH | confirmed |
| Package manager | npm (`npm ci` in `server/`) | confirmed |
| Database | Supabase Postgres, project `kuklfnapbkmacvwxktbh` | confirmed |
| Engine host | Hetzner engine-01 `5.161.252.33` (`engine.smarter.poker`); Backup host `5.161.236.0`. This lane never SSHes there. | confirmed (CLAUDE.md) |
| Live health | `https://engine.smarter.poker/health` (releaseSha, bootPhases.processStartedAt, maintenance.*) | confirmed |
| Prettier | the repo pins `^3.8.1`; use `npx prettier@3.8.1`. A local 3.9.x reflows files differently and creates churn. | confirmed |
| Typecheck | `cd server && NODE_OPTIONS=--max-old-space-size=14000 npx tsc --noEmit` (the default heap runs out) | confirmed |
| GitHub API | REST works (`gh api`). GraphQL was refused in this container. Merge with REST `PUT /repos/.../pulls/N/merge` and `merge_method=squash`, `sha=<head>`. | confirmed this session |
| Push | `bash scripts/agent-push.sh` from an owned worktree (never `git push` by hand; never from the shared clone; never `--no-verify`) | confirmed (CLAUDE.md 1.2.5) |

Lane identity and the other lanes this one coordinates with:

| Who | ID | Owns |
| --- | --- | --- |
| This lane | `session_01BbZPDm3wWQZGupszrXj81G` ("Horse Style Brain Activation", "horse-brain-activation") | D5 and D6 above |
| Release owner (ASAP window, candidate, Stage, seal, thaw) | session `01BbZPDjeNdeckeaEd3XTkrj` | the engine release; signs posts "Release owner, HH:MMZ" on #10063 |
| Owner's engine-policy chat | `01a1b095-8bd5-7d42-afcf-1a0843448274` | Nov 6 engine release policy (CLAUDE.md top) |
| Horse study root (Codex) | `01a1af6b` | Horse study acceptance, tournament timing fixes f21499f / debe1ef, add-on, tickets, satellites |
| Overlay / Backup evidence | `01a1b950` | Backup evidence |
| V31 certification lane | `01a17e88` | V31 serving bindings (handoff item M3) |
| R8 owner ("V31 solver audit") | `01BbZPDkcmv76YQUE8HB9Grj` | R8 solver work |
| Split-return / Midway financial lane | `01a1bbdd` | migration 20261109132114, #10179, split-return money source |
| Independent reviewer (subagent of THIS session) | `afb2750d0d705938b` | gave GO/NO-GO on #10132, #10134, #10140, #10145. **A new chat cannot reach it**: start a fresh independent reviewer subagent. |

---

## 4. Repository Map

Paths are relative to the repository root unless absolute.

**Qualification machinery** (this lane's D5 surface):
- `.github/workflows/horse-feature-ablation-qualification.yml`: workflow id **398426971**.
  - `workflow_dispatch` inputs: `target` (choice; use `river_position_defense`) and `source_sha` (exactly
    40 hex characters, an ancestor of main).
  - Concurrency group `horse-strength-hosted-capacity` (queue max, no cancel-in-progress).
  - Jobs:
    - `plan` (20 min): runs the operations tests `tests/operations/feature-ablation-assemble.test.mjs` and
      `feature-ablation-artifact-custody.test.mjs`, then
      `npx tsx src/scripts/featureAblationQualify.ts --plan --target --source-sha --output`, and emits
      the matrix.
    - `cell` (240 min, max-parallel 64, one per matrix key): `--prepare` (binds the provider job BEFORE
      any held-out deal), "Execute the one registered cell without retry"
      (`featureAblationQualify.ts --cell`), `--finish`, gzip, then upload of artifact
      `fa-<target>-<key>-a<attempt>`.
    - `assemble` (30 min): downloads every cell artifact, runs
      `feature-ablation-assemble.mjs --assemble`, uploads `fa-assembly-<target>-a<attempt>`.
  - Do not edit it.
- `server/src/benchmark/IncrementalPressureQualification.ts`:
  - the provider and lineage rules: `assertIncrementalFamilyRuns`, `assertIncrementalUnconsumedRecovery`,
    `assertIncrementalProviderLineage` (about lines 254-294), `authenticateIncrementalPlan`;
  - #10134 added `QUALIFICATION_GIT_MAX_BUFFER` / `qualificationGit`;
  - #10145 adds `QUALIFICATION_READ_BUDGET_MS`, `qualificationReadDeadline`, `qualificationTransientWait`,
    `readGithubWithRetry` and `readGithubJsonWithRetry`;
  - **it is one of the 336 decision-closure files**, so any edit changes the plan's digests.
- `server/src/benchmark/IncrementalPressureQualificationPlans.json` and
  `IncrementalPressureQualificationFamilies.json`: the held-out registries. Both are `{}` on main today.
  #10132 adds `river_position_defense` and family `283`. **Registering is a one-time, permanent act**
  (`assertIncrementalFamilyHistory` forbids resetting, replacing or re-introducing a family).
- `server/src/benchmark/FeatureAblationQualification.ts`: the plan validator
  (`validateLockedFeatureAblationPlan`; `heldout_plan_not_locked` at about line 452).
- `server/scripts/feature-ablation-assemble.mjs`: `--prepare`, `--finish` and `--assemble`. #10140 adds
  `finishCli`; #10145 routes `providerState` reads through the retry reader.
  **`server/scripts` is a release CONTROL_INPUT** (`scripts/ci/read-engine-prequalification.py`).
- `server/scripts/feature-ablation-artifact-custody.mjs`: artifact inventory and zip download (#10145
  routes both reads through the reader).
- `server/scripts/feature-ablation-github-read.mjs`: NEW in #10145, the ESM twin of the TypeScript
  reader. It must classify identically; `server/src/benchmark/QualificationGithubRead.test.ts` runs both
  twins on one table.
- `server/src/scripts/featureAblationDraftPlan.ts`: NEW in #10132, the plan drafter.
  - Usage: `npx tsx src/scripts/featureAblationDraftPlan.ts --design=<design.json> --output=<plan.json>`,
    run from `server/`.
  - It never registers anything; its output is a review artifact. It recomputes every binding from the
    bytes in the checkout, so run it in a CLEAN checkout of the exact main commit.
  - Its test is `featureAblationDraftPlan.test.ts`.
- `docs/horse-measure/2026-11-08/river-position-defense-heldout.design.json`: NEW in #10132, the design
  input (profile, pairs, cell size, coverage minimums), reviewed as data.
- `server/src/engine/HorseFeatureAuthority.ts`: `admitHorseFeatureAuthority`, the ACTIVATION gate (about
  lines 200-300). Its refusals include `evidence_mismatch`, `not_qualified`, `policy_digest_mismatch` and
  `policy_digest_unavailable`. It re-hashes package-lock and every bound file, and recomputes the closure
  (`featureAuthorityClosure`) when `sourceBinding` is `horse-decision-closure-v1`.
- `server/src/engine/HorseDecisionClosure.ts` (#10048): the closure walker, `INDIRECT_LOADS` and the AST
  law against undeclared computed loads.
- `docs/evidence/feature-activation/selection.json`: does NOT exist on main. It is created only by a
  protected PR after `qualified:true`.
- `server/src/engine/HorsePhase14Authority.test.ts`: an importer-guard law. #10132 adds the drafter to its
  importers and its CLI loop (this fixed a real Server shard 4 failure, commit 37ede0011).
- `server/src/benchmark/IncrementalPressureQualification.test.ts` and
  `IncrementalPressureDevelopment.test.ts`: they pin the empty registries. #10132 updates them in the same
  commit.

**Brain fixes** (D6 surface; merged; touch only if a live check proves a defect):

| PR | What |
| --- | --- |
| #9916 | fast call-down read (`riverFastCalldown`) |
| #9921 | exact public-memory read receipts; own history loads under its speed/ante domain |
| #10031 | the V82 facing-open zone reads the hand-start stack |
| #10033 | forced phases keep authority when an owner rule speaks last; scoped disables |
| #10095 | an all-in 3-bet is called on its price; flag `facingClosedAllIn`; `facingClosedAllInRaise` is pure |
| #10102 | a declared feature domain admits the live engine snapshot |
| #10038 | `HorseMind.blendDurableRead` donor borrowing on the pooled path; receipt `opponent_memory_donor_staleness_unknown`; receipt v2 |
| #10048 | `HorseDecisionClosure`, `policy_digest_unavailable`, closure-bound plans |
| #10103 | near-nut fixture (benchmark only; no runtime receipt) |

**Evidence folder** (Mac SSD; durable; this lane's home):
`/Volumes/SmarterArchives/agent-evidence/extreme-archive/hybrid-release-20261105-cont/`
- `NOV8-0400Z-CHECKPOINT.md`: **the lane's single checkpoint**; read it in full. Backup copy
  `NOV8-0400Z-CHECKPOINT.md.bak-20261109T1525Z`. Its sections carry times through 15:50Z Nov 9.
- `2026-11-07-horse-brain-activation-HANDOFF-PROMPT.md`: the original handoff (items H1-H5, M1-M6, L1-L2).
- `RIVER-POSITION-DEFENSE-QUALIFICATION.md`: why riverPositionDefense was hard to admit (closure churn,
  the all-variant gate later fixed by #10048, the freeze design).
- `DONOR-AND-SCARE-ABORT.md`, `V82-ROOT-CAUSE.md`, `v82-bb-only/`, `PHASE8-RUN8-INSPECTION.md`,
  `MASTER-CAPABILITY-INVENTORY-20261108.{md,csv}` (276 rows), `census-391f7bc0/`, `census-40bc2467/`,
  `FORCED-PHASE-AUTHORITY-WITHDRAWAL.md`.
- `mutation-10038-cef21c09/`: mutation evidence for #10038 (M0 unmutated, then M1 to M4 mutants with
  diffs and logs). Preserve it.
- `rpd-heldout-plan-rehearsal/`: an earlier lane's rehearsal (`register-plan.mts`, `rehearse.sh`, logs).
- `lane-tools-20261109/`: NEW today. This session's tools, copied off the ephemeral cloud scratchpad
  (`lane-tools.tgz` md5 `8b656250a21cfb5e4fffec4180b40949`):
  - `closure-vs-serving.sh`: compares the plan's 336 fingerprints with any revision. **Edit its
    hard-coded `cd /home/claude/wt-reg` and the default plan path** to your checkout.
  - `waitthreads.sh`: the read-only #10063/#10171 waiter. **Edit `D=`** to a scratch directory of yours.
  - `request.md`: the single open request text (#10063 comment 6741931121).
  - `overlap.md`: the family 283 overlap post.
  - `c.txt`: the release owner's family 283 ACK text.
  - `threads.log`, `thread10063.seen`, `thread10171.seen`: waiter cursors.

**Proof kit** (read-only live checks):
`/Volumes/SmarterArchives/agent-evidence/hybrid-release-20261105/post-release-kit/`
- `README.md`: how to run, and what each proof means.
- `run-all.sh`: run it detached, exactly as the README says:
  `nohup perl -e 'use POSIX qw(setsid); setsid(); exec "sh", "<kit>/run-all.sh", @ARGV' -- [--boot ISO] [--release SHA] [--end ISO] [--no-wait] >/dev/null 2>&1 </dev/null &`.
  - The Mac shell limit is about 55 s per call.
  - SQL goes through `supabase db query --linked --agent=no -o json -f FILE` from the Mac shared clone
    directory. Every file is one SELECT.
- `required-shas.txt`: the ancestry list for proof 1. It already includes `pr:10095 10102 10038 10048 10103`.
  Backup `required-shas.txt.bak-20261108b`.
- `sql/` files 02a to 11:
  - `07-new-receipts-activation.sql`: edited today; backup `.bak-20261109`.
  - `10-nov9-fix-receipts.sql`: donor and feature-authority receipts.
  - `11-opener-facing-allin-3bet.sql`: the #10095 live evidence query.
- `baselines/11-opener-facing-allin-3bet-391f7bc0-20261109T0420-0620Z.txt`: the #10095 pre-release
  baseline. Tournament NLH heads-up, 12-25bb, all-in 3-bet: fold 323, call 7, raise 10 (95.0% fold,
  n 340).
- `runs/`: earlier runs, including `20261107T183530Z` and `20261108-readiness-391f7bc0`.
- `scripts/`: `01-release-manifest.sh`, `08a-readiness.sh`, `readiness.mts`, `summarize.py`.

**Coordination**:
- `/Volumes/SmarterArchives/agent-evidence/COORDINATION-INBOX.md`: append-only.
  - Acknowledgement format: `ACK <UTC> <agent id>:` directly under an entry.
  - Never edit or delete existing entries.
  - This lane's open entry is `## 2026-11-09T15:00Z FROM horse-brain-activation ...` (about line 853).
- GitHub PR #10063 (closed, merged Nov 8): its comment thread is the **release coordination thread**.
  The release owner posts there.

---

## 5. Applicable Instructions And Constraints

Reread before any write: `CLAUDE.md` (root; long, binding), `AGENTS.md`, `AGENT-PLAYBOOK.md`,
`docs/agent-policy/REFERENCE-INDEX.md`, `PUBLISHING.md` ("Push and protected merge"; "Backup and daily
engine launch") and `docs/ENGINE-RELEASE-RUNBOOK.md`.

The rules that shaped this lane:
- **Engine releases** (CLAUDE.md top and section 13):
  - Production engine replacement happens only at 04:00-04:05 America/Chicago after certification,
    except the owner-authorized ASAP window now in progress.
  - Agents never edit the live engine or a shared Backup.
  - Non-engine delivery never waits.
  - This lane NEVER dispatches, retries or certifies a release; it only reads the release owner's receipts.
- **Never push a red test** (section 5 rule 8). Update a pinning test in the same commit.
- **Horses are players** (10.5): never filter horses out of anything. riverPositionDefense applies the same
  rules to every opponent.
- **No band-aids** (10.11 / 10.12): fix at the root. A detector is not a fix.
- **A signal that answers when it does not know** (10.86): "could not tell" is its own outcome. Check
  `res.ok` before reading a body. #10145 follows this; a bare non-OK answer is returned unchanged for the
  caller to refuse.
- **Never schedule on the Claude scheduler** (10.85). This lane resumes only on background-command exits
  (at most 2 h each), PR notifications and subagent hand-backs.
- **Never spend real chips to test a rule** (11.5). Over the Supabase MCP a probe is one call with one
  `DO` block that ends in `RAISE EXCEPTION`. This lane only ran SELECTs.
- **Database checks use workflow identity, never a copied key**. Never reveal or copy a Supabase key or
  source `.env`. The kit uses the Mac's linked Supabase CLI, read-only.
- **Engine and Backup hosts**: only `ssh ca-engine` / `ssh ca-backup`, never retried. A second refused
  login can trigger a 24 h fail2ban ban. This lane never needed SSH.
- **Migrations**: none in this lane. If one is ever needed: `node scripts/new-migration.mjs`, merged
  first, never applied from a branch.
- **Commit identity**: `scripts/guard-commit-identity.sh` refuses any author but
  `254329056+Smarter-Poker@users.noreply.github.com`. Do not re-author published commits; that needs a
  force-push, which is forbidden.
- **Laws registry**: every `*.law.test.*` needs a file in `docs/laws.d/` (`tests/law-registry.law.test.ts`).
- **No emoji in source. Popups Title Case, no em dashes** (not relevant here, but CI enforces both).
- **The file-URL law**: `tests/a-file-url-is-decoded-before-it-is-a-path.law.test.ts` refused a
  hand-built `file://` URL in the drafter (fixed with `pathToFileURL(process.argv[1]).href`).
- **Owner direction of Nov 9**: stay in scope, adopt nothing, keep one checkpoint, report only material
  milestones, no blanket freeze.

---

## 6. Complete Discovery Record

1. **The held-out partition is single-use.**
   - The workflow's first run ever is **42447773710, run #1** (2026-11-08T04:40:44Z,
     "Held-out river_position_defense at 2b9a2351"). It failed in `plan` with
     `Feature-ablation plan refused: heldout_plan_not_locked`; Cell and assemble were skipped. **No
     held-out hand was dealt.**
   - `assertIncrementalFamilyRuns` / `assertIncrementalProviderLineage` count only runs with
     `run_number > providerAnchor.baselineRunNumber`.
   - So family 283's anchor is `{workflowId 398426971, baselineRunId 42447773710, baselineRunNumber 1}`.
     An anchor below #1 would read that failed run as "partition already reserved".
   - The inventory (`GET /repos/.../actions/workflows/398426971/runs`) must show `total_count` = **1**
     right before dispatch. It read 1 at 15:50Z.
2. **Three certain dispatch failures were found and fixed before any dispatch.** Each would have burned
   family 283.
   - **ENOBUFS.** The closure binding reads `git ls-files server` (1,534,341 bytes) through Node's 1 MiB
     default buffer. Fixed in #10134 (merged, `a6bc7f920`): `qualificationGit` with a 256 MiB buffer.
   - **The assemble CLI never exits.**
     - Cause: the contract import chain FeatureAblationQualification.ts -> IncrementalPressureDevelopment.ts
       -> ChannelHub.ts starts a ref'd 30 s `setInterval`.
     - Effect: `--prepare` and `--assemble` hang; all 21 cells would sit until their 240 min timeout
       with the partition reserved.
     - Fixed in #10140 (held). `finishCli(run)` settles the run, prints
       `Feature ablation assembly refused: ...` and exits 2 on rejection, flushes stdout and stderr, then
       calls `process.exit(process.exitCode ?? 0)`.
   - **One transient GitHub answer fails the job.** Any 5xx, 429, rate-limited 403, dropped connection or
     truncated JSON body in a provider, assemble or custody read failed a job that cannot be rerun.
     - Fixed in #10145 (held). One policy in two twins waits out network errors and timeouts, 5xx, 429,
       and 403s with a rate-limit signal (`retry-after`; `x-ratelimit-remaining: 0` plus a reset;
       "rate limit" or "abuse detection" text). It also waits out a JSON body that breaks after the
       headers.
     - Backoff is 2 s doubling to 60 s; secondary limits wait at least 60 s.
     - Deadlines run from process start: plan 10 min, cell 75 min (prepare and Execute each get it inside
       one 240 min job), assemble 20 min. They sit inside the job limits, and a test pins that.
     - Every other answer is returned unchanged to the existing refusal.
     - The shared test table caught a real bug: `Number(null)` is 0, so an absent `Retry-After` read as 0.
     - Residual risk, not removable in code: a GitHub outage longer than the budget, or a primary
       rate-limit reset more than 10 min away during the plan job (which makes about 6 reads).
3. **The closure-churn blocker was solved by #10048.**
   - Before it, admission re-hashed every non-test `.ts`/`.json` under `server/src` (1,052 files), and
     the validator demanded all 4 variants x 5 shapes (20 profiles).
   - #10048 made qualification domain-scoped (one profile: NLH, 2 dealt, 100bb) and closure-bound: only
     the 336 files reachable from the decision entry points, `horse-decision-closure-v1`.
4. **Plan facts (#10132 head `1434a37fc`, drafted at `a6bc7f920`):**
   - schema `horse-incremental-ablation-plan-v2`, version
     `river-position-defense-nlh-2dealt-100bb-heldout-v1`, state `heldout_locked`;
   - `sourceBinding` `horse-decision-closure-v1`, 336 `runtimeSourceFiles`;
   - `runtimeSourceDigest` 8af7eb14c16bc8efa7a3fbcb2b5e443794c941dc67b54054ee3663bcb11e3341;
   - plan digest 1eb057b7ea9874e73cd2fd5674764026ee4fe9b6eb1b4458e9e896255ad17b79;
   - `policyDigestsDigest` eb9f274a...c6e0; `dependencyDigest` b9b88b01...0b74; `maxAttempts` 2;
   - flags: candidate `{riverPositionDefense:true}`, reference `{riverPositionDefense:false}`;
   - profile `river_position_defense-nlh-6max-2dealt-100bb` (nlh, 2 seats, 100bb, weight 1);
   - held-out seeds 28301109, 28302231, 28303347;
   - matrix of 21 cells of 1,152 pairs each, 24,192 pairs in total;
   - interval: two-sided 99% Wald, z 2.5758293035489004, at least 10,000 pairs per profile in a cell;
   - thresholds:
     - primary lower bound > 0 bb/100;
     - each seed's point estimate > 0;
     - every critical cell's lower bound >= -10 bb/100 (critical cells: profile, relative_position, depth);
   - coverage per profile:
     - candidate and reference hero decisions >= 50,000 each;
     - accepted hero contrasts >= 700;
     - evaluation counter `river_position_defense_accepted` >= 700;
   - `liveAdmission` domain: NLH cash, chips, 2 dealt, 2 remaining, effective stack 0-100bb, blinds 1/2,
     no ante, no-limit, chip unit 0.01, rake 10% capped 5 (player-count caps 2:2.5, 3:5, 4:5) with
     no-flop-no-drop, BBJ enabled (fee 0.25bb, min pot 10bb, min players 3), no side pots.
   - Family 283: schema `horse-incremental-crn-family-v1`; members
     `[{target river_position_defense, planDigest 1eb057b7...}]`; the providerAnchor above; the same
     `runtimeSourceDigest`.
   - Development evidence behind the choice: +11.89 bb/100 (stderr 3.60); NLH 2-dealt physical pairs
     +180.96 +/- 64.92 (#9866); 44 to 50 accepted contrasts per 576 pairs on nlh 2:100.
5. **Redraft drift, measured.**
   - A rehearsal redraft at 14:08Z Nov 9 on main `490c72a3` plus #10140 plus #10145 was registrable, with
     0 refusals and 336 closure files. Only the hashes of `src/benchmark/IncrementalPressureQualification.ts`
     and `src/config/RakeConfig.ts` changed (RakeConfig from #10142, comment-only), plus the derived
     `baselineReferenceRevision` and `runtimeSourceDigest`, the plan digest and the family digests.
     Seeds, matrix, policies and domain were byte-identical.
   - At 15:50Z, `closure-vs-serving.sh` on origin/main `64d01106` and on candidate `e366fab1`: 335 of 336
     identical; only `RakeConfig.ts` differs. Main has been closure-quiet since `a6bc7f920` apart from that.
6. **The activation constraint** (see section 1): `admitHorseFeatureAuthority` re-hashes package-lock and
   every bound file from the shipped engine, and recomputes the closure. Any byte difference gives
   `policy_digest_mismatch`. Activation therefore needs a sealed engine byte-equal to the redrafted plan
   on all 336 files, and that cannot be `e366fab1`.
7. **The release machinery and the lane's holds.**
   - `server/scripts` is in `CONTROL_INPUTS` of `scripts/ci/read-engine-prequalification.py`;
     `projection()` is the `git ls-tree` of those paths. So #10140 and #10145, merged after a booking,
     change main's control projection relative to the candidate.
   - Any `server/**` push queues a push Backup, which supersedes the candidate's pending Backup. All three
     PRs touch `server/**`.
   - None of the three touches migrations, `server/standby`, `server/src/maintenance`, `server/release/**`,
     `.github/workflows` or `scripts/ci`, and none changes serving-path decision code.
8. **The thread API.**
   - Issue comments list in ascending id and created order. All of #10063's comments fit in one page; no
     Link header.
   - An edit changes `updated_at` but not the id, so an id-only cursor misses edited answers.
   - `?since=` returns comments created OR edited after the timestamp.
9. **The local clones are shallow.** `git merge-base --is-ancestor` gave FALSE "missing" answers for #9916
   and #9921 against `e366fab1`. Use the GitHub compare API
   (`gh api repos/.../compare/<fix>...<release> --jq '.status,.behind_by'`; contained means status
   `ahead` or `identical` with `behind_by` 0), or `git fetch --deepen`/`--unshallow` first.
10. **Scare-abort semantics** (#10038, HB-CAP-124).
    - `plan_fingerprint_aborted_scare_under_pressure` fires when a scare card reaches the planner and the
      plan is withdrawn. The committed action is unchanged by design, so it is an EVALUATION receipt, not
      an action change.
    - Kit SQL 07 now grades it as evaluation-only.
    - On 391f7bc0 from 14:20Z to 15:20Z: aborted_scare 7, checked_scare 21, recorded 506.
11. **Defect 1 (own public history) on the old release.**
    - On 391f7bc0, `horse_observer_history_loaded` and `_refused` are both 0 while
      `horse_history_cache_entry_bound_evicted` fires. That is a wiring-defect signature ("both zero is a
      defect, never no opportunity").
    - It is expected, because #9921 is not in 391f7bc0. Pass criteria after the release:
      `own_history_loaded > 0`, `horse_exact_memory_read_ok > 0`, and kit 07 no longer reading WIRING
      DEFECT for those rows.
12. **Phase 8 catastrophe guard (H4).** Run 42134144996 is the guard family `catastrophe_guard_v1`. The
    CI99 lower bound fails in all 18 of its jobs, so `PHASE8_GUARD_PROTECTED_RELEASE_SELECTION` stays null
    by design (`PHASE8-RUN8-INSPECTION.md`, `evidence/PHASE8-RUN8-VERDICT-20261108.md`).
13. **vs3BetShortStack** stays OFF. Its gap is in
    `docs/changelog/2026-11-07-horse-preflop-defence-leaks.md`: a league card and one human-calibrated
    seed below -2 se.

---

## 7. Work Completed During This Chat (Nov 8 to Nov 9)

Merged through protected checks with independent agent review (each review is recorded on its PR):

| PR | Squash commit | Merged (UTC) | Notes |
| --- | --- | --- | --- |
| #10102 | adb48443b4bc45dc27ea11ec2dd06d7692736ec1 | Nov 9 01:48 | review round 1 REQUEST_CHANGES (cap games), round 2 APPROVE (comment 6730141357) |
| #10095 | f36f7f6fc60bac6ca56315005fc821c3edf9fa51 | 02:02 | multiway-safe pure `facingClosedAllInRaise`; 40bb depth bound, NLH only, sitting-out fix |
| #10103 | 0710837ae4ecbc51983d2761beae47b9a582ae65 | 02:17 | near-nut fixture through the production worker |
| #10038 | 03081c41775cbb3a938f1c99a2f6993eae0a5285 | 03:25 | donor blends only with the pooled exact row; undated donor -> `staleness_unknown`; receipt v2; mutation-proven |
| #10048 | 075a81c3caba073c77487a2592cb35fc52781901 | 03:25 | worker.ts in the closure; AST law; `.mjs` only for closure-bound plans |
| #10134 | a6bc7f92050707840a10d76e3cac97ff301f7504 | 04:39 | 256 MiB git buffer for qualification reads; 3 mutation-checked tests |

Already merged before this chat and assigned here for live proof:
- #9916 ff2d7f6f21448d18688d9ec0e862947d42d6b3d3
- #9921 9adf5b7f622d64f636cdc65e94b5e388fbc83fbb
- #10031 63e3b6f8be2b47ac30373ac7c4c2fddcfb0b3201 (built by another lane; its live check is this lane's)
- #10033 ca9686faf3bccd663544a1491e965935895fe7d3

Open, green, reviewed and HELD (this lane's):

| PR | Branch | Head | Checks | Review |
| --- | --- | --- | --- | --- |
| #10140 fix(horse): the feature-ablation assemble CLI always ends | `horse/assemble-cli-exits` | 01334fbf2d8d4b7012c438fc419666689bc5441c | 35 success, 10 skipped, 0 failed | reviewer GO |
| #10145 fix(horse): held-out qualification reads ride out transient GitHub answers | `horse/qualification-reads-ride-out-transients` | 989779ae01d9538dbd3db3eeb9cdddd9e71dd41f | 36 success, 9 skipped, 0 failed | GO on fd63b8e24; the follow-ups 6e466e43d and 989779ae0 (no-headers guard) were re-checked by the reviewer (**UNVERIFIED whether a written GO exists for 989779ae0 specifically**; get one from the new reviewer before merging) |
| #10132 feat(horse-features): register the riverPositionDefense held-out plan and seed family 283 | `horse/register-rpd-family-283` | 1434a37fcc6f7b534f4e6747623df243ff107551 | 36 success, 9 skipped, 0 failed | NO-GO only because of the #10140 hang; the registration bytes were verified. **MUST be redrafted** after #10140 and #10145 merge (new head), then reviewed again. |

Files in each held PR:
- **#10140:**
  - `server/scripts/feature-ablation-assemble.mjs` (+19/-4)
  - `server/src/scripts/featureAblationAssembleExit.test.ts` (+128): 7 child-process cases (control hang,
    ok, refuse, write-then-refuse, async 4 MiB write, 2 MiB stdout, exitCode kept); mutation-checked
  - `docs/changelog/2026-11-09-feature-ablation-assemble-always-ends.md`
- **#10145:**
  - `server/scripts/feature-ablation-github-read.mjs` (new, 129 lines)
  - `server/scripts/feature-ablation-assemble.mjs` (+18/-10)
  - `server/scripts/feature-ablation-artifact-custody.mjs` (+13/-5)
  - `server/src/benchmark/IncrementalPressureQualification.ts` (+145/-13)
  - `server/src/benchmark/QualificationGithubRead.test.ts` (new, 250 lines): both twins; budgets fit the
    workflow job limits; no raw `fetch(` left on the qualification path (1 allowed in the TS file, 0 in
    the scripts)
  - `docs/changelog/2026-11-09-qualification-reads-ride-out-transient-github-answers.md`
- **#10132:**
  - `server/src/benchmark/IncrementalPressureQualificationPlans.json` (+681), `...Families.json` (+17)
  - `IncrementalPressureQualification.test.ts`, `IncrementalPressureDevelopment.test.ts`
  - `server/src/engine/HorsePhase14Authority.test.ts`
  - `server/src/scripts/featureAblationDraftPlan.ts` (new) and its `.test.ts`
  - `docs/changelog/2026-11-08-heldout-plan-drafter.md`
  - `docs/changelog/2026-11-09-river-position-defense-registers-family-283.md`
  - `docs/horse-measure/2026-11-08/river-position-defense-heldout-draft.md`
  - `docs/horse-measure/2026-11-08/river-position-defense-heldout.design.json`

Closed by this lane: **#10080** (draft/rpd-heldout-plan, head 69cbd06b5), superseded by #10132. Branch kept.

Resolved with other lanes:
- **#10171** (the release owner's duplicate family 283 registration) closed unmerged at 15:10:21Z. Branch
  `horse/rpd-heldout-registration-20261109` preserved at fb4494a24632bc16c74ab3ae3770d4771d40a03a, with
  `register-plan.mts --bind/--verify`, a closure freeze bound to `8242357a` and a read-only verify that
  came back ok.
- Release-owner ACK that #10132 owns family 283: #10132 comment **6743489948** (15:10:23Z).

Proof kit (D6 preparation):
- added required-shas lines;
- added SQL 10 and 11 and the baseline 11 on 391f7bc0;
- corrected the SQL 07 scare-abort expectation (evaluation only);
- ran SQL 07 and 11 against production read-only.

Checkpoint: kept current. Sections at 15:25Z (backlog reconciliation), 15:40Z (candidate inclusion) and
15:50Z (corrections and the activation constraint).

Worktree cleanup already done: wt-10038, wt-10048, wt-domain, wt-f3b, wt-nearnut, wt-buf, wt-draft were
removed (each HEAD equalled its merged PR head).

---

## 8. Visual And Product Decisions

None. This lane changed no UI, page, popup or asset. The Club Arena console visual rules do not apply.

---

## 9. Functional And Architectural Decisions (locked)

| Decision | State |
| --- | --- |
| Family 283 = riverPositionDefense ONLY; three other targets permanently excluded from it | locked (owner); implemented in #10132 (members list) |
| One registration (#10132), one dispatch, no retry outside the contract | locked |
| Activation only if `qualified:true`, through a reviewed protected PR writing `docs/evidence/feature-activation/selection.json` | locked; not started |
| vs3BetShortStack OFF | implemented (default OFF) |
| facingClosedAllIn: an opener facing a closed all-in 3-bet/4-bet calls on price, <= 40bb, NLH only; never fires while another player can still bet | merged #10095 |
| Donor borrowing only on the pooled path with its pooled exact row; undated donor -> staleness_unknown | merged #10038 |
| Scare-abort receipt = evaluation, not action change | recorded; kit corrected |
| Qualification reads: wait only on transient answers, never past the deadline; everything else refused unchanged | in #10145 (held) |
| Any stability control: narrow, qualification-compatibility only, time-bounded; no blanket freeze | owner rule; nothing built |
| This lane never dispatches, retries or certifies an engine release | locked |
| Horses treated like humans everywhere (no is_horse exclusion) | law 10.5 |

---

## 10. Exact Current State (read 15:46Z to 15:55Z Nov 9)

- **Production engine** (`/health`):
  - releaseSha `391f7bc0d57c71637bd4af5181f70520661e3593`, processStartedAt 2026-11-07T21:20:16Z;
  - maintenance `active:false`, phase idle;
  - schedule daily 04:00 America/Chicago, `hourlyCashFreeze:false`;
  - last resumeWaves 3/3, 58 of 58 tables.
- **Release operation** (release owner, #10063):
  - window `2026-11-09-owner-asap-engine-1530z`: notice 15:10Z, notBefore 15:30Z, notAfter 21:30Z;
  - booking #10173, merged 14:55:07Z as `8d5aeb7bdbf9e2638fadb162a6a3e57363781318`;
  - served notice live since 15:01:29Z (Publish Club Arena run 42639373614);
  - required fixes `debe1ef` (contains `f21499f`).
  - Blocker cleared: migration `20261109132114` was retired by #10179 (`e366fab1`, merged 15:17:51Z, by
    the split-return lane 01a1bbdd).
  - Owner ruling (09:23 CT) noted by the release owner: whether the
    `app.cash_original_debit_ledger` save/restore is needed must be proven in an isolated fixture; if it
    is, it ships as a new migration AFTER this cutover seals, unless it shows live money risk. NOT this
    lane's.
  - **Candidate `e366fab1398cd9d10f0b11228d41329c7a54b1ea`**:
    - exact prequalification 42643233932 was in progress;
    - Backup 42643233827 refreshed 15:28-15:35Z, certify started 15:35:45Z, expected about 16:35Z;
    - next: a read-only selector check, then one hand Stage dispatch inside the :05:30-:49 band.
  - Latest release-owner posts: #10063 comments 6744131946 (15:37:11Z) and 6744163614 (15:38:30Z, not
    lane-relevant).
  - **UNKNOWN, NEXT AGENT MUST INSPECT:** whether it has sealed by the time you read this.
- **All eight assigned fixes are in the candidate** (compare API, status `ahead`, `behind_by` 0) and none
  is in 391f7bc0:

  | Fix | Commits ahead of the merge in e366fab1 | Commits ahead of the merge in 391f7bc0 |
  | --- | --- | --- |
  | #9916 | 0 | 15 |
  | #9921 | 0 | 20 |
  | #10031 | 0 | 127 |
  | #10033 | 0 | 133 |
  | #10095 | 0 | 198 |
  | #10102 | 0 | 195 |
  | #10038 | 0 | 209 |
  | #10048 | 0 | 210 |

- **Qualification inventory:** workflow 398426971 `total_count` 1 (the anchor only). No competing run.
- **Registries on main:** `{}` and `{}` (family 283 unregistered).
- **Held PRs:** open; heads as in section 7; `mergeable_state` was "unknown" (GitHub recomputing).
  - A local `git merge-tree` check: main+#10140 is clean, and (main+#10140)+#10145 is clean, even though
    both PRs edit `feature-ablation-assemble.mjs`.
  - Base SHAs: #10140 `df48d6064`, #10145 `f05683577`, #10132 `a6bc7f920`. The ruleset is not strict, so
    no update-branch is required, but #10132 must be redrafted anyway.
- **Ownership ACKs:**
  - release owner: DONE (#10132 comment 6743489948);
  - Horse study root 01a1af6b: **NOT received**. Requested in #10063 comment 6742972590 (14:47:44Z) and in
    the inbox entry `2026-11-09T15:00Z`.
- **Cloud worktrees** (all clean, every head pushed and equal to its PR head):

  | Worktree | Branch | Head |
  | --- | --- | --- |
  | wt-reg | horse/register-rpd-family-283 | 1434a37fc |
  | wt-exit | horse/assemble-cli-exits | 01334fbf2 |
  | wt-read | horse/qualification-reads-ride-out-transients | 989779ae0 |
  | wt-rpd | draft/rpd-heldout-plan | 69cbd06b5; provides `node_modules` symlinks to wt-reg |

- **Running processes:** one read-only background waiter in THIS container, task `bkaxo8y1u`
  (`waitthreads.sh 2026-11-09T21:45:00Z`). It exits on a relevant #10063/#10171 post. It dies with this
  container; a new chat must start its own.
- **Repository handoff PR:** see the PR line at the end of section 25. **UNVERIFIED whether it has merged.**
- No database writes, migrations, dispatches, payouts or SSH were performed by this lane, ever.

---

## 11. Changed-File Ledger (this chat)

| File | Status | Purpose | What changed | Verified | Committed |
| --- | --- | --- | --- | --- | --- |
| server/scripts/feature-ablation-assemble.mjs | modified in #10140 and #10145 | assemble/prepare/finish CLI | finishCli; reads via the retry reader; `providerState(readKind)` | tests + operations suite 20/20 | PR branches, not main |
| server/src/scripts/featureAblationAssembleExit.test.ts | new (#10140) | exit regression | 7 cases | pass; mutation fails it | #10140 branch |
| server/scripts/feature-ablation-github-read.mjs | new (#10145) | ESM reader | retry policy | 55/55 | #10145 branch |
| server/scripts/feature-ablation-artifact-custody.mjs | modified (#10145) | custody reads | uses the reader | pass | #10145 branch |
| server/src/benchmark/IncrementalPressureQualification.ts | modified (#10145); #10134 merged | provider reads | TS reader twin | pass; tsc clean | #10145 branch / main (#10134) |
| server/src/benchmark/QualificationGithubRead.test.ts | new (#10145) | twin table | 23+ cases per twin | pass | #10145 branch |
| server/src/benchmark/IncrementalPressureQualificationPlans.json / Families.json | modified (#10132) | registration | plan + family 283 | redraft verified; 89 local tests | #10132 branch |
| server/src/scripts/featureAblationDraftPlan.ts (+test) | new (#10132) | drafter | - | 3/3 | #10132 branch |
| server/src/engine/HorsePhase14Authority.test.ts | modified (#10132) | importer guard | drafter added | pass | #10132 branch |
| IncrementalPressure{Qualification,Development}.test.ts | modified (#10132) | registry pins | updated | pass | #10132 branch |
| docs/changelog/2026-11-08-heldout-plan-drafter.md, 2026-11-09-*.md (3), docs/horse-measure/2026-11-08/* (2) | new | records | - | - | PR branches |
| kit required-shas.txt, sql/07, sql/10, sql/11, baselines/11-* | edited / new | live proofs | see section 7 | 07 and 11 run read-only | SSD only (not git) |
| NOV8-0400Z-CHECKPOINT.md | appended | checkpoint | sections through 15:50Z | - | SSD only |
| lane-tools-20261109/* | new | persisted tools | - | md5 matched | SSD only |
| this handoff | new | continuation | - | - | SSD + docs PR |

Earlier merged PR files (#10102, #10095, #10103, #10038, #10048, #10134) are on main; their file lists
are on the PRs.

User-owned and other lanes' changes: none of this lane's files overlap them. Do not touch #10171's
branch, the BBJ files (#10142, #10148, #10150, #10158), split-return migrations, the release files or the
Horse study files.

---

## 12. Asset Ledger

No visual assets. The evidence assets that are the authority for their claims:

| Asset | Path | Purpose | Final authority for |
| --- | --- | --- | --- |
| Checkpoint | evidence folder /NOV8-0400Z-CHECKPOINT.md | lane state | everything this lane did |
| Mutation evidence | evidence folder /mutation-10038-cef21c09/ | #10038 proof | the donor fix mechanism |
| #10095 baseline | kit /baselines/11-...-391f7bc0-*.txt | pre-release comparison | fold rate before the release |
| Plan design | docs/horse-measure/2026-11-08/river-position-defense-heldout.design.json (in #10132) | drafter input | scientific choices |
| Lane tools | evidence folder /lane-tools-20261109/ | closure check and waiter | reproducible checks |

Risk: the cloud scratchpad (`/tmp/claude-0/.../scratchpad/`) holds more scratch files: draft JSONs,
`q/*.sql`, `review-reg/`. They are ephemeral. Anything needed was persisted; the drafts are reproducible
with the drafter.

---

## 13. Commands And Tools Used (important ones)

| Where | Command | Purpose | Changes files? |
| --- | --- | --- | --- |
| any | `curl -s https://engine.smarter.poker/health` | serving SHA, boot, maintenance | no |
| any | `gh api repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/<n>` | PR state and head | no |
| any | `gh api ".../compare/<fixSHA>...<releaseSHA>" --jq '"\(.status)/\(.behind_by)"'` | ancestry without a deep clone | no |
| any | `gh api ".../actions/workflows/398426971/runs?per_page=1" --jq .total_count` | held-out inventory (must be 1) | no |
| any | `gh api ".../commits/<sha>/check-runs?per_page=100"` | required checks | no |
| any | `gh api ".../issues/10063/comments?since=<ISO>&per_page=100"` | release thread | no |
| worktree | `bash closure-vs-serving.sh <rev> [plan.json]` | 336-file closure compatibility | no |
| worktree/server | `npx tsx src/scripts/featureAblationDraftPlan.ts --design=../docs/horse-measure/2026-11-08/river-position-defense-heldout.design.json --output=/tmp/plan.json` | redraft | writes output only |
| worktree/server | `NODE_OPTIONS=--max-old-space-size=14000 npx tsc --noEmit` | typecheck | no |
| worktree/server | `npx vitest run src/benchmark/IncrementalPressureQualification.test.ts src/benchmark/QualificationGithubRead.test.ts src/scripts/featureAblationAssembleExit.test.ts src/scripts/featureAblationDraftPlan.test.ts src/engine/HorsePhase14Authority.test.ts src/benchmark/IncrementalPressureDevelopment.test.ts` | lane tests | no |
| repo root | `node --test tests/operations/feature-ablation-assemble.test.mjs tests/operations/feature-ablation-artifact-custody.test.mjs` | operations suite (the workflow's plan job runs it) | no |
| worktree | `bash scripts/agent-push.sh` | push | pushes a branch |
| any | `gh api -X PUT ".../pulls/<n>/merge" -f merge_method=squash -f sha=<head>` | protected merge | merges |
| Mac | kit `run-all.sh`, detached | live proofs | writes runs/ only |
| any | `gh workflow run horse-feature-ablation-qualification.yml --ref main -f target=river_position_defense -f source_sha=<40hex>` (or REST `POST .../actions/workflows/398426971/dispatches`) | **THE ONE DISPATCH: run ONLY after section 21 phase 5** | irreversible |

---

## 14. Verification And Test Results

| Verification | Method | Result | When | Follow-up |
| --- | --- | --- | --- | --- |
| #10140 exit behaviour | featureAblationAssembleExit.test.ts, 7 cases | pass; the mutation fails the refuse and write cases | Nov 9 06:35Z | none |
| #10140 / #10145 / #10132 CI | required checks | all green (counts in section 7) | heads as listed | rerun not needed if the heads are unchanged |
| #10145 reader | QualificationGithubRead.test.ts plus provider tests | 55/55; operations 20/20; tsc clean | 06:35Z, then the guard follow-up | none |
| Simulated provider run #2 (main df48d6064 + #10140 + #10132) | reviewer harness | plan exit 0 in about 6 s, digest 1eb057b7...; --prepare exit 0 in about 2 s (hung over 10 min before); --finish exit 0 | 05:12Z | repeat on the final redraft |
| Rehearsal redraft on 490c72a3 + #10140 + #10145 | drafter | registrable, 0 refusals, 336 files | 14:08Z | redo on the real post-merge main |
| Closure compatibility | closure-vs-serving.sh | 391f7bc0: 288/336 identical; e366fab1: 335/336; main 64d01106: 335/336 (RakeConfig) | 06:35Z / 15:50Z | rerun on the sealed SHA and on the redraft |
| Ancestry of 8 fixes in e366fab1 | compare API | all contained | 15:40Z | rerun on the actually sealed SHA |
| Kit SQL 07 scare-abort row | read-only SELECT on 391f7bc0 | aborted 7 / checked 21 / recorded 506 | 14:20-15:20Z | rerun after the seal |
| #10095 baseline | kit SQL 11 on 391f7bc0 | fold 95.0% (323/340) | 04:20-06:20Z | compare after the seal |
| Merge cleanliness of #10140 then #10145 | git merge-tree | clean | 15:50Z | none |
| #10038 donor law | vitest + mutation | 14/14; the mutation fails | Nov 8 19:50Z | live receipts pending |

**NOT run:**
- any live receipt check on a release containing the fixes (none has sealed);
- the final redraft and its review;
- the held-out qualification;
- activation;
- the full kit `run-all.sh` since Nov 7;
- the Production Build and CSS Beat E2E on these PRs (skipped by path, which counts as pass).

**Failures encountered** (all resolved): see section 15.

---

## 15. Setbacks, Failed Approaches, And Lessons

1. **#10132's first head 70f252eda** failed the file-URL law: the drafter built a `file://` URL by hand.
   Fixed in 7ce467f33.
2. **The reviewer's NO-GO for ENOBUFS** stopped a dispatch that would have burned family 283. Lesson: get
   an independent pre-dispatch review EVERY time, and simulate run #2 end to end.
3. **The reviewer's NO-GO for the assemble hang** (a ChannelHub interval). Lesson: a CLI that imports
   engine modules must exit explicitly.
4. **A real Server shard 4 failure** on #10132 (the HorsePhase14Authority importer guard). Fixed in 37ede0011.
5. **#10145's stub without `headers`** crashed FeatureAblationProviderAttempt.test.ts ("refuses unreadable
   original provider responses"). Fixed in 989779ae0 with typeof guards; a bare non-OK answer is returned
   for the caller to refuse.
6. **Number(null) is 0.** An absent Retry-After header read as 0 s. Caught by the shared twin table.
7. **The session merge guard** once refused `gh pr merge` ("Merge Without Review"). The REST PUT merge with
   recorded independent reviews works, and the ruleset needs 0 approvals.
8. **Timing error.** On Nov 9, 04:00 CT is 10:00Z; seal and thaw is about 10:05Z, i.e. 04:05 CST, not
   "5:05". Decide by receipts, never the clock.
9. **The Nov 9 04:00 release did not happen.** Stage 42562159686 failed: a missing
   `server/standby/schema-evidence.py` in the sparse checkout, a defect in the release owner's #10114.
   That is the release owner's to fix, not this lane's.
10. **The waiter cursor.** A time filter can miss posts, and an id cursor misses edits. The fix is
    `since=` with a 10-minute overlap plus a seen file of "id updated_at" pairs.
11. **Shallow clone false negatives** in ancestry checks. Use the compare API.
12. **Cancelled CI runs on superseded heads** are not verdicts; do not chase them.
13. **The checkpoint's 15:25Z section wrongly cited a "15:12Z inbox ACK".** The ACK is on GitHub only.
    Corrected at 15:50Z.
14. **A `git checkout --detach` in wt-reg was run by mistake.** It was restored to its branch; always check
    `git status` and the branch before writing.
15. **The prettier version.** 3.9.x reflowed HorseDataLedger; the bytes were reverted to 3.8.1 output.
16. **The commit-identity hook** forbids re-authoring. Do not attempt it.

---

## 16. Known Defects And Architectural Holes

| Priority | Defect or hole | Evidence | Impact | Recommended fix | Status |
| --- | --- | --- | --- | --- | --- |
| P0 | Dispatching before #10140 and #10145 are on main | sections 6.2 and 15 | burns family 283 for ever | merge both, redraft, review, then dispatch | open (held by design) |
| P0 | Closure drift between redraft and dispatch, or between redraft and the activation release | `admitHorseFeatureAuthority` re-hash; `authenticateIncrementalPlan` | plan refused at dispatch (partition possibly reserved), or a qualified result that can never activate | re-run closure-vs-serving immediately before dispatch; consider a narrow, time-bounded closure freeze (prior art: #10171 branch, `wt-freeze` design in RIVER-POSITION-DEFENSE-QUALIFICATION.md). The owner allows it only if narrow and bounded. | open; nothing built |
| P1 | Activation impossible on e366fab1 | section 6.6 | a qualified selection waits for a later release | plan the activation release (the next 04:00 CT daily after the redraft) and keep the closure quiet until it seals | open |
| P1 | A GitHub outage longer than the read budgets | #10145 residual | one cell or the assemble unrecoverable | dispatch at a quiet hour with hosted capacity idle; nobody bulk-cancels queued runs | accepted residual |
| P1 | Horse study root ACK missing | section 10 | overlap risk if it dispatches or registers | wait for the ACK, or confirm read-only that no competing PR or run exists right before merging #10132 | open |
| P2 | #10145 follow-up GO for exactly 989779ae0 not separately recorded | section 7 | review gap | fresh reviewer GO on the final heads | open |
| P2 | Defect 1 (own public history) unproven | section 6.11 | memory not loading own history | live check after the seal (kit 02c/07) | waiting on release |
| P3 | Kit README still describes the 2026-11-06 release in places | kit README | confusion | read the proof definitions, not the dates | known |

---

## 17. Security, Secrets, And Credentials (names only)

- GitHub: the `gh` CLI login (the cloud container has `GH_TOKEN`; the Mac's `gh` has its own login). The
  fine-grained `GH_TOKEN` on the Mac is refused merge and rerun. There, use
  `env -u GH_TOKEN -u GITHUB_TOKEN gh ...` (CLAUDE.md 11).
- Supabase: the Mac's linked CLI (`supabase db query --linked`); the Supabase MCP `execute_sql` (read-only
  use). Never reveal or copy keys (`projects api-keys`, `?reveal=true`), never source `.env`.
- The workflow uses `GITHUB_TOKEN` (`github.token`) and placeholder `SUPABASE_URL=https://supabase.invalid`
  / `SUPABASE_SERVICE_ROLE_KEY=feature-ablation-offline-placeholder` (not secrets).
- No secret was printed or exposed by this lane.

---

## 18. Database, Migration, And Seed Status

- No migrations, writes or seeds by this lane.
- Read-only tables used:
  - `public.horse_brain_flush_receipts` (per `source_release`; receipts by name);
  - `hand_history` (kit slices);
  - `horse_mind_stats`, `horse_mind_pairs`, `horse_mind_stats_scoped` (kit proof 2);
  - `ca_engine_deploy_attempts` (the SEALED receipt row);
  - `supabase_migrations.schema_migrations` (read via `execute_sql`; never `list_migrations`).
- Not this lane's: the split-return migrations (`20261109132114` retired by #10179; any new migration
  belongs to the financial owner, installed after this cutover seals); the BBJ migrations
  (`20261109010948`, `20261109064934` retired to `supabase/retired-unapplied/`).

---

## 19. Current Blockers And Decision Points

1. **The release seal and thaw** (technical; the release owner's).
   - Blocks: merging #10140, #10145 and #10132; all D6 live checks.
   - Options: wait for the seal (recommended). If the window ends at 21:30Z without a seal, read its
     terminal outcome on #10063. Then:
     - the hold lapses when the operation has ended. Merge #10140 and #10145, but NOT inside the next
       reservation. The next daily Stage reserves as early as 5 h before 03:30 CT, so about 04:30Z Nov 10
       (22:30 CST Nov 9). Confirm on #10063 first.
     - the live checks then wait for the next seal.
2. **The Horse study root ACK** (coordination).
   - Recommended: before merging #10132, read-only confirm:
     - no open PR touches `IncrementalPressureQualification{Plans,Families}.json`
       (`gh api "repos/.../pulls?state=open&per_page=100"`, then the files of each candidate);
     - the inventory `total_count` is 1;
     - no inbox entry from 01a1af6b claims family 283.
   - If those hold, proceed and record that the ACK was requested but never given.
   - **UNVERIFIED** whether the owner would want an explicit ACK first. The owner's 08:55 direction said
     "Obtain explicit acknowledgment from the release owner and Horse study root". So prefer to wait for
     it, and if it is still missing when everything else is ready, ask the owner with the line in
     section 25.
3. **The activation timing** (technical). A qualified result needs a release byte-equal to the plan.
   Decide whether to request a narrow closure freeze; the owner allows only narrow and bounded.
4. **No business decision is pending with the owner**, apart from the possible ACK escalation above.

---

## 20. Remaining Work

Critical:
- **C1.** After the seal and thaw, verify the release: the exact releaseSha on `/health` equals the release
  owner's posted SHA; protected provenance (ancestor of main, from the Stage/receiver records); the SEALED
  receipt plus its `ca_engine_deploy_attempts` row; full thaw (`maintenance.active false`, all tables
  resumed). Reuse the release owner's posted receipts; do not repeat their work.
- **C2.** Merge #10140, then #10145 (protected REST squash, using the heads above, if they are unchanged
  and their checks are green).
- **C3.** Redraft #10132 on the resulting main, push the new head, and get a fresh independent reviewer
  GO, including a simulated run #2. Then merge.
- **C4.** The pre-dispatch checklist (section 21 phase 5), then ONE dispatch.
- **C5.** Watch the run to terminal. Download every artifact (`fa-registered-plan-a1`, `fa-*-a1` cells,
  `fa-assembly-*`) into the evidence folder. Record the verdict.

High:
- **H-a.** D6 live checks on the sealed engine.
  - Run the kit detached with `--release <sealed SHA>`, and re-run 1 to 3 h later for traffic-heavy proofs.
  - Run closure-vs-serving on the sealed SHA.
  - Per fix, report separately: available (code on the serving SHA), evaluated (a receipt fired),
    superseded (a later layer owned the decision), fallback (degraded path) and committed action
    (the action differed).
  - Specifics:
    - #9921: own_history_loaded > 0, exact_memory_read_ok > 0;
    - #9916: riverFastCalldown receipts;
    - #10031 (V82 BB 15-22bb, kit SQL 06 plus `v82-bb-only/`; the H2 target is 37-66% call/raise,
      n >= 200 per cell);
    - #10033: forced-phase scoped receipts (kit SQL 09);
    - #10095: kit SQL 11 against baseline 11;
    - #10102: feature-domain admission receipts;
    - #10038: `opponent_memory_donor_*` non-zero (kit SQL 10);
    - #10048: `horse_feature_authority_*` expected 0 with no selection; `policy_digest_*` refusals 0;
    - scare-abort counted as evaluation.
- **H-b.** If `qualified:true`:
  - write `docs/evidence/feature-activation/selection.json` through a reviewed protected PR (read its
    schema in `HorseFeatureAuthority.ts`: qualificationPath, qualificationSha256, approvalGeneration,
    issuedAt, expiresAt);
  - make sure the release that ships it is byte-equal to the plan;
  - verify live `horse_feature_authority_*` acceptance receipts.
  - If not qualified: record the verdict; riverPositionDefense stays unselected; family 283 is spent;
    stop.
- **H-c.** Update the checkpoint at each milestone.

Medium:
- **M-a.** Clean up the worktrees after the outcome (section 21 phase 8). The owner wants worktrees on the
  external SSD and deleted when finished.
- **M-b.** Merge or close the docs-only handoff PR (section 10).

Outside this assignment (owner direction, Nov 9 08:55): handoff items M1 (the six other feature skills),
M2 (v53PloTourneyIcm), M3 (V31 bindings; the certification lane), M4 (opt-in arms), M5 (PLO4 value
audit), M6 (river-layer leagues), L1 (old main-repo worktrees). Also: the registry proposal, new retry
semantics, other-chat resets.

---

## 21. Prioritized Next-Phase Execution Plan

**Phase 0: Recover and verify state** (first 15 minutes)
1. Read this file, then the checkpoint `NOV8-0400Z-CHECKPOINT.md` (at least from "## 2026-11-09 01:20Z" to
   the end), then CLAUDE.md, PUBLISHING.md and docs/ENGINE-RELEASE-RUNBOOK.md.
2. Check the engine: `curl -s https://engine.smarter.poker/health`. Note releaseSha,
   bootPhases.processStartedAt and maintenance.
3. Read the #10063 thread since 15:30Z Nov 9:
   `gh api "repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/issues/10063/comments?since=2026-11-09T15:30:00Z&per_page=100" --jq '.[]|"\(.id) \(.created_at) \(.body[0:400])"'`.
   Find the release owner's SEALED / thaw / ended post.
4. Re-read the three PR heads and their states, the inventory `total_count` (must be 1) and the
   registries on main (must be `{}`).
5. Read COORDINATION-INBOX.md from line 850 for an `ACK` from 01a1af6b.
6. Post a one-line acceptance on #10063 ("Horse Style Brain Activation lane: successor session <id>
   accepts this lane from session_01BbZPDm3wWQZGupszrXj81G; holds unchanged.") BEFORE acting. That keeps
   ownership explicit.

**Phase 1: Protect completed work.** Create fresh worktrees from origin on the external SSD, if you work on
the Mac (`/Volumes/SmarterWork/agent-work/...`), or in your container. Check out the three branches. Never
use the shared clone. `npm ci` in `server/`.

**Phase 2: Release gate (C1).** Only when the release owner reports SEALED and the thaw is complete, or the
window has ended:
- verify releaseSha equals the posted SHA;
- SEALED receipt and its `ca_engine_deploy_attempts` row;
- `maintenance.active false`, all tables resumed;
- the eight fixes contained, by compare API;
- `closure-vs-serving.sh <sealed SHA>`.

Record all of it in the checkpoint.

**Phase 3: Merge the tooling fixes (C2).**
- Confirm the heads are still 01334fbf2 and 989779ae0 with green required checks.
- Confirm no new reservation is active (#10063).
- `gh api -X PUT .../pulls/10140/merge -f merge_method=squash -f sha=01334fbf2d8d4b7012c438fc419666689bc5441c`.
- Then #10145 with sha 989779ae01d9538dbd3db3eeb9cdddd9e71dd41f.
- If #10145 reports a conflict after #10140, merge main into its branch in the worktree, run the twin and
  operations tests, push with `agent-push.sh`, and wait for the checks.

Record both squash SHAs.

**Phase 4: Redraft and review (C3).**
1. In a CLEAN detached checkout of the new main tip, run the drafter with the design file. Check: 0
   refusals, 336 files, `heldout_locked`.
2. Diff against the plan in #10132. Expected changes: only `baselineReferenceRevision`, the hashes of
   `src/benchmark/IncrementalPressureQualification.ts` and `src/config/RakeConfig.ts`, and
   `runtimeSourceDigest`, the plan digest and the family digests. Anything else means STOP and investigate.
3. On the #10132 branch, merge main, replace the plan entry and the family 283 digests, keep the anchor
   `{398426971, 42447773710, 1}`, and update any pinned digests in tests. Run the lane tests, tsc and
   prettier 3.8.1. Push with `agent-push.sh`.
4. Launch a fresh independent reviewer subagent with this section and section 6. It must simulate provider
   run #2 (plan job, `--prepare`, `--finish`) on main + #10132 and give GO or NO-GO.
5. Once the required checks are green and the reviewer says GO, squash-merge #10132.

**Phase 5: Pre-dispatch checklist** (every item, within minutes of dispatch)
- [ ] `gh api .../commits/<#10132 squash SHA>/pulls` lists #10132. Wait about 1 min after the merge.
- [ ] Registries on main contain exactly `river_position_defense` and family `283`, and the digests equal
      the reviewed redraft.
- [ ] `closure-vs-serving.sh origin/main <plan>`: 336/336 identical. No closure, lockfile or control-path
      commit since the redraft.
- [ ] The tool fingerprints on main equal what was reviewed: `feature-ablation-assemble.mjs`,
      `feature-ablation-artifact-custody.mjs`, `feature-ablation-github-read.mjs`, the workflow file.
      `git log` since the #10132 merge shows none changed.
- [ ] Inventory `total_count` is 1 (anchor only); no queued or in-progress run of 398426971.
- [ ] Concurrency group `horse-strength-hosted-capacity` idle: no in-progress runs of the strength or
      league workflows.
- [ ] No competing family 283 PR; the 01a1af6b ACK received, or the escalation handled.
- [ ] A quiet CI hour, and nobody bulk-cancelling runs.

**Phase 6: Dispatch once (C4)** and watch (C5).
- `gh workflow run horse-feature-ablation-qualification.yml --ref main -f target=river_position_defense -f source_sha=<full 40-hex #10132 squash SHA>`.
- Record the run id. Never rerun, never re-dispatch.
- Watch with a read-only poller (`gh api .../actions/runs/<id>`; cells take up to about 75 min of Execute
  each, with 64 in parallel), using a background command at most 2 h long, re-armed.
- On the terminal state, download all artifacts, read the `fa-assembly` verdict (`qualified`, reasons),
  and record every loss and refusal.

**Phase 7: Outcome.**
- If `qualified:true`:
  - a reviewed protected PR for `selection.json`;
  - make sure the shipping release is byte-equal to the plan (a narrow freeze if needed; the owner allows
    narrow and bounded only);
  - after that release seals, verify the live acceptance receipts.
- If not: record it and stop. riverPositionDefense stays off.
- In both cases, D6 live checks (High H-a) run in parallel after the C1 seal.

**Phase 8: Close.**
- Update the checkpoint with the final state.
- Remove owned worktrees after confirming each HEAD equals its merged or closed PR head and nothing is
  uncommitted. Remove the four cloud ones if you still have this container, and any you created.
- Report to the owner in plain English, ready to archive.

---

## 22. Exact First Actions For The Next Agent

1. Read this file, then `/Volumes/SmarterArchives/agent-evidence/extreme-archive/hybrid-release-20261105-cont/NOV8-0400Z-CHECKPOINT.md`.
2. Read `CLAUDE.md`, `PUBLISHING.md` and `docs/ENGINE-RELEASE-RUNBOOK.md` on current origin/main.
3. Run:
   - `curl -s https://engine.smarter.poker/health | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["releaseSha"],d["bootPhases"]["processStartedAt"],d["maintenance"]["active"],d["maintenance"]["phase"])'`
   - `gh api "repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/issues/10063/comments?since=2026-11-09T15:30:00Z&per_page=100" --jq '.[]|"\(.id) \(.created_at)\n\(.body[0:600])\n---"'`
   - `for n in 10140 10145 10132; do gh api repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/$n --jq '"#\(.number) \(.state) merged=\(.merged) head=\(.head.sha)"'; done`
   - `gh api "repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/workflows/398426971/runs?per_page=5" --jq '.total_count'` (must be 1)
4. Grep the inbox for `ACK` lines after line 850 that name 01a1af6b.
5. Do NOT merge anything, dispatch anything, edit #10171 or another lane's files, or touch the engine,
   Backup, migrations or money.
6. Post your acceptance line on #10063 (phase 0 step 6).
7. Resume at **phase 2** if the release has sealed and thawed, or ended. Otherwise start a read-only
   waiter (adapt `lane-tools-20261109/waitthreads.sh`) and wait.

---

## 23. Acceptance Criteria

- D5:
  - #10140, #10145 and the redrafted #10132 merged through protected checks with recorded independent
    GO reviews;
  - exactly ONE run of workflow 398426971 after the anchor (`total_count` 2), at the #10132 squash SHA;
  - every artifact retained in the evidence folder;
  - the assembly verdict recorded with every loss and refusal;
  - if `qualified:true`, a reviewed `selection.json` merged and live acceptance receipts on a release
    byte-equal to the plan; if false, riverPositionDefense left unselected.
- D6: for the sealed release:
  - exact SHA, provenance, SEALED receipt and thaw recorded;
  - all eight fixes contained;
  - per-fix live evidence classified as available / evaluated / superseded / fallback / committed action,
    with the counts and the window;
  - the #10095 fold rate compared with baseline 11;
  - defect 1 pass criteria met or the defect reproduced with a hand id.
- vs3BetShortStack still OFF.
- No horse excluded from anything. No database writes, no money movement, no engine or Backup action by
  this lane.
- The checkpoint updated. Owned worktrees removed. The owner told in plain English.

---

## 24. Recommended Commit Strategy

- #10140 and #10145: already committed. Merge as they are (squash; the PR titles become the messages).
- #10132 redraft: one commit,
  `feat(horse-features): redraft the riverPositionDefense plan on <new main short SHA> for family 283`.
  It contains the Plans.json entry, the Families.json digests and any digest pins in tests. Before
  committing, run the lane tests, tsc, prettier 3.8.1 and the drafter test.
- The selection (only if qualified):
  `feat(horse-features): select riverPositionDefense on its held-out qualification (run <id>)`. It
  contains `selection.json` only, plus a changelog in `docs/changelog/`.
- The handoff doc PR: docs-only (`.agent/handoffs/`). Never mix it with code.

---

## 25. Final Continuation Summary

- **Stopping point.** Everything is prepared and held, waiting for the release owner's ASAP engine release
  (candidate e366fab1, which contains all eight assigned fixes) to seal and thaw. A read-only waiter in the
  old container watches #10063.
- **First work for the next agent:** phase 0, then phase 2 once the seal is confirmed.
- **Locked requirements:**
  - one family 283 registration (riverPositionDefense only) and one dispatch;
  - activate only if qualified;
  - vs3BetShortStack OFF;
  - horses are players;
  - this lane never runs releases, writes money or adopts other lanes' work.
- **Greatest technical risk:** dispatching with drift or without the two tooling fixes. That burns family
  283 permanently.
- **Greatest data-integrity risk:** none from this lane (read-only), provided no database writes are ever
  added.
- **Greatest product risk:** a qualified result that cannot activate, because the decision closure changed
  before the shipping release.
- **Decision possibly needed from the owner:** only if the Horse study root never acknowledges. The owner
  line to send in that case:
  `Proceed with the family 283 registration and dispatch without the Horse study root ACK, after confirming no competing registration or run exists.`
- **How to continue without restarting discovery:** read sections 6 and 21 and the checkpoint tail, verify
  section 10's state with the four commands in section 22, then execute phases 2 to 8 in order. Every
  fact needed is here or in the files this document names.

Files created or modified while preparing this handoff:
- this file (SSD and repository copies);
- `NOV8-0400Z-CHECKPOINT.md` (a 15:50Z section appended);
- `lane-tools-20261109/` (new).
