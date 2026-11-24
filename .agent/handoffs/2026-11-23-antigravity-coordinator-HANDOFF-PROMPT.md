# MILITARY-GRADE HANDOFF PROMPT - ANTIGRAVITY COORDINATOR (SMARTER POKER CLUB ARENA), 2026-11-23 02:15 AM CST

You are taking over as the **Antigravity Coordinator** for Smarter Poker Club Arena. You own the seven Antigravity Horse strategy and evaluation lanes: `HOLDEM STRATEGY`, `LIMIT GAMES`, `HUMAN VS HORSE`, `LIGHTNING GAMES`, `HAND ANALYSIS`, `HEADS UP`, `PLO6`.

- **Handoff written:** 2026-11-23 02:15 AM CST (2026-11-23T08:15Z) by Claude session `session_01BbZPDkMAK1Sd5jRZWYKkG6`.
- **That session itself continued** session `c6ec33ca-91a8-4c8b-9ba5-a3fa583e2087` (handoff file `.agent/handoffs/2026-11-21-antigravity-coordinator-HANDOFF-PROMPT.md` lineage; the 2026-11-22 3:30 PM CST handoff prompt is reproduced in substance in section 2 and section 7.0).
- **Owner:** Dan Bekavac (Smarter Software Inc., dba Smarter.Poker). Report to Dan in plain English, in Central time (America/Chicago), never with commit SHAs or internal identifiers as the main content.
- **All times below:** Central (CST, UTC-6) first, UTC in parentheses or backticks.

Everything in this document was verified against the live repo, GitHub, the production database (read-only) and `https://engine.smarter.poker/health` between 2026-11-23 02:13 and 02:15 AM CST unless it is marked **UNVERIFIED** or **UNKNOWN, NEXT AGENT MUST INSPECT**.

---

## 1. Executive Continuation Brief

**What is being built.** Club Arena is the Smarter.Poker online poker product: real-money-free poker with AI players called **horses** (never "bots"). The Horse program improves how horses play against real people. Every new horse behaviour is an **option** that is pre-built into the engine, default OFF, and turned on or off live through the switch table `public.ca_horse_style_switch` (owner rule 2026-11-15: options must be "PRE BUILT IN" and switchable without a cutover).

**This lane's job.** Build and measure options for the seven Antigravity lanes, register them in the engine through "switch-list train" migrations, prove them (replays, real-card grading, league runs), and hand verified activation "packets" to the **Horse SWITCH** lane, which is the only writer of `ca_horse_style_switch` for non-PLO4/5 options. This lane never writes the switch table and never runs engine cutovers.

**Current phase.** Close-out of the 2026-11-22 cycle: Turn 5 is merged and waiting to install; Packet 3 is waiting for Turn 5's engine code to go live; two cross-lane hardening items are waiting for an owner.

**Major work completed in this chat (2026-11-22 3:43 PM to 2026-11-23 2:15 AM CST):**

1. Audited the prior session's 24 merged PRs: all 24 are ancestors of `origin/main`, of the serving engine `735299cd5fda`, and of both 4:00 AM candidates; zero reverts.
2. Fixed the Packet 1 authority doc after its rollback (#11782).
3. Merged the dark `nashCallVsTightJammerRespect` prototype (#11741).
4. Verified Packet 2 live and recorded it (#11791).
5. Built and merged a new read-only "people vs horses before and after each live change" report (#11823).
6. Found and fixed a hidden test failure in Turn 5, re-synced it four times, and merged **Turn 5** (#11820, 1:14:36 AM CST).
7. Ran the PLO6 V2 committed-SHA parity replay and a V3 trial (V3 not adopted) and recorded both (#11835).
8. Coordinated an SSD1 drive disconnect with a temporary SSD2 push lock, then retired it.

**Immediate unfinished objective.** Prove Turn 5's migration `20261122181616` installed in production after the nightly freeze ends at **4:15 AM CST (10:15Z)**, post the receipt, remove the Turn 5 worktree, then hand **Packet 3 (`cashDefenceTrimColdCalls`)** to Horse SWITCH once an engine build that contains Turn 5 is live.

**Most important thing to understand.** Engine code only reaches players at three-hourly cutovers (1, 4, 7, 10 AM and PM CST), run by the separate **Dedicated Engine Cutover** lane. Migrations install through `dispatch-merged-migrations.yml` -> `apply-merged-migration.yml` only, never by hand. The 10 PM and 1 AM CST cycles on 2026-11-22/23 both kept serving the old engine `735299cd5fda` because of two release-workflow bugs (O1 soak stop, Stage election timing). Turn 5's engine code is NOT in either 4:00 AM candidate, so it rides the 7:00 AM CST cycle at the earliest.

**First action.** Run section 22 step by step. The first real check is the 4:00 AM CST seal and the Turn 5 install proof at or after 4:25 AM CST (10:25Z).

---

## 2. User Requirements And Working Preferences

### 2.1 Dan's standing preferences (from memory and this chat)

- Claude operates as lead project manager with full autonomous authority: announce the plan and execute; surface only genuinely irreversible product decisions.
- **"DON'T EVER ASK THE HUMAN TO DO A JOB YOU CAN DO AND SHOULD DO"**, including merging your own PRs and finishing delivery to live.
- **"do not ask me to send you texts for approval, you own this code base"** (Nov 2026).
- **"DO NOT ASK ME TO TELL YOU THINGS, IF YOU KNOW WHAT TO DO AND FIX IT, JUST DO IT!"** (2026-11-22).
- If Dan must say something to unblock you, end the reply with the exact line he should send back, word for word.
- Report progress in plain English. No commit SHAs, statistics or internal identifiers as the main content ("i have no clue what your talking about or what you worked on").
- No unverified data. Never fabricate multi-agent analysis. Never default to stale dates.
- Mandatory coverage reporting before recommendations (say what the recommendation is based on).
- Large builds: run work in parallel (swarm or multiple agents) where it helps, take the fastest efficient route, stay inside the stated scope, no unnecessary tests or side work, and **do not claim success until everything is verified finished**.
- Large backlogs: numbered phases, Claude chooses the build order; after each, "Phase N of X is done" plus summary, then "ready to start Phase N+1".
- Agent work trees belong on the external SSD, never the Mac's boot drive; delete your own worktree and scratch when finished.

### 2.2 Dan's messages in this chat (verbatim where it matters)

- 3:43 PM: "I NEED YOU TO PICK UP WHERE THE OTHER AGENT LEFT OFF WITH BRAIN COORDINATION" (with the 3:30 PM handoff attached).
- 3:45 PM: "YOU OWN THIS CODE BASE AND EVERYTHING INSIDE OF THIS CHAT, YOU CAN MAKE ANY AND ALL CHOICES AND DECISIONS AND COORDINATE WITH THE OTHER PINED CHATS TO WORK TOGETHER WHEN NEEDED. MAKE SURE YOU ARE COORDINATING YOUR ENGINE CUT OVERS EVERY 3 HOURS. REQUEST ANY AND ALL FILES OR DOCUMENTS YOU NEED ACCESS TO NOW."
- 3:57 PM, 4:44 PM, 12:58 AM: "FINISH UP ANY AND ALL UNFINISHED WORK, AND THEN GO AHEAD AND FULLY BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND TESTED BEFORE CLAIMING SUCCESS. YOU DECIDE THE BUILD ORDER. LAUNCH A SWARM IF IT WILL HELP."
- 8:18 PM: "WHAT IS LEFT TO DO? HOW ELSE CAN THIS BE IMPROVED, ENHANCED OR OPTIMIZED STILL?"
- 2:13 AM: this handoff request.

### 2.3 Non-negotiable owner directives from the 2026-11-22 3:30 PM handoff (still in force)

1. You own this codebase; make engineering, prioritization and coordination decisions autonomously; never ask for human approval on authorized work.
2. Launch a parallel swarm when it accelerates delivery; keep agents productive; zero redundant or unnecessary tests.
3. **NEVER claim done until deployed, installed and verified live.**
4. **100% hard-coded permanent root-cause source fixes only.** Zero hot fixes, workarounds or band-aids.
5. Report all times to Dan in Central (America/Chicago).
6. Coordinate continuously with Dedicated Engine Cutover, PLO-OWNER, Horse SWITCH, HORSE DECISIONS and VERIFIER-10 through **both** coordination inboxes.
7. First audit the previous session's work for regressions, then finish every remaining phase through verified live production.

### 2.4 Hard prohibitions (from the handoff and policy; all still apply)

1. **NEVER write `public.ca_horse_style_switch`.** Horse SWITCH (lane `151f9a34`, currently Claude `session_01BbZPDiC45HuJ242Fr9vk7w`) is the sole writer for non-PLO4/5 options; PLO-OWNER owns PLO4/5 (currently lead-5, Claude `session_01BbZPDipUpWwL1vAd1KRRiF`). Deliver packets: authority file path + 64-hex sha256 + rollback command, via both inboxes.
2. **NEVER dispatch, book, pause or resume engine cutovers or migration installers.** The cutover owner is the Dedicated Engine Cutover successor, Claude `session_01BbZPDhXdXDpg2o2kKZWmd1`.
3. **NEVER edit, commit or check out inside `/Users/smarter.poker/Documents/club-arena`** (shared clone; use it only for `git -C ... worktree add/remove` and read-only `git show`, `git log`, `git fetch`).
4. **NEVER run `git stash` anywhere** (`.husky/reference-transaction` refuses it; #11833 also refuses `stash clear`).
5. **NEVER source `.env`, print or copy secrets, or run `ps aux`, `pgrep -fl` or `env`.** (This session used `pgrep -f` and `ps -o args= -p <pid>` only for its own push wrappers.)
6. **NEVER store or print hole cards or player hand IDs** in repo files, PRs, inboxes or reports. Delete scratch hole-card exports with `trap 'rm -rf "$SCR"' EXIT`.
7. **NEVER use `gh run watch`** (it polls every 3 s and exhausts the shared REST quota). Use single-shot `gh` calls only.
8. **No emoji, no em dashes, no en dashes in repo files.** Run `npx prettier --check` and `node scripts/ci/check-no-emoji.mjs` before pushing.
9. **Rule 11 lane boundaries:** do not touch PLO4/PLO5 Omaha math core code or docs (PLO-OWNER); do not touch `horseRunItTwiceIsPriced` (HORSE DECISIONS).
10. Merge and DDL holds: see section 5.3.
11. Never SSH to `ca-engine` or `ca-backup`. Use `https://engine.smarter.poker/health` plus read-only DB queries.
12. Never use the `schedule` tool or timers to initiate, advance, retry or certify a release (scheduled check-ins for your own lane work are fine).
13. Do not change the 60-minute push cap or bypass `shepherd.lock`; other lanes rely on both.
14. Omaha decisions must not treat people and horses differently (no person-keyed rules); Dan's Horse rulings are in memory file `/areas/club-arena.md`.

---

## 3. Project And Repository Identity

| Item                             | Value                                                                                                                                                                                                    | Status    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Project                          | Smarter Poker Club Arena (online poker with AI horses)                                                                                                                                                   | confirmed |
| GitHub repo                      | `Smarter-Software-PIQ/Smarter-Poker-Club-Arena` (public repo record; default branch `main`, no classic branch protection: the protection API returns 404; rulesets and required checks apply through CI) | confirmed |
| Shared clone (read-only for you) | `/Users/smarter.poker/Documents/club-arena`                                                                                                                                                              | confirmed |
| Mac                              | `smarterpokers-mac-studio-local` (macOS, arm64), user `smarter.poker`                                                                                                                                    | confirmed |
| Work root (SSD2)                 | `/Volumes/SmarterWork/agent-work/extreme-capacity` (disk7s1 `SSD2-Work`, 80 GiB free at 02:14 AM)                                                                                                        | confirmed |
| Archive root (SSD2)              | `/Volumes/SmarterArchives/agent-evidence/extreme-archive` (disk7s2 `SSD2-Archives`, 80 GiB free)                                                                                                         | confirmed |
| SSD1                             | mounted again since ~7:40 PM CST 2026-11-22 (`/Volumes/SmarterWork/agent-work/shared-capacity`, `/Volumes/SmarterArchives 1`, `/Volumes/SmarterWork 1`); disconnected 7:12:16 PM to ~7:40 PM CST         | confirmed |
| Server                           | Node + TypeScript engine in `server/` (vitest 2.1.9, `npx tsx` scripts)                                                                                                                                  | confirmed |
| Client                           | Vite/React app in `src/`, published by `publish-club-arena.yml` to `ca-static.smarter.poker` and `smarter.poker/hub/club-arena`                                                                          | confirmed |
| Database                         | Supabase Postgres 17, project `PokerIQ-Production` ref `kuklfnapbkmacvwxktbh` (us-west-2)                                                                                                                | confirmed |
| Engine host                      | Hetzner `ca-engine` (reach only through `/health`), Backup host `ca-backup`                                                                                                                              | confirmed |
| Package manager                  | npm (`npm ci --ignore-scripts --no-audit --no-fund` in root and `server/`)                                                                                                                               | confirmed |
| Push helper                      | `bash scripts/agent-push.sh` from the worktree (HTTPS with gh credentials, verifies the remote ref)                                                                                                      | confirmed |
| Live engine at 02:14 AM          | `735299cd5fda6b59c43d1379371d1a3dfb1a050f` (`/health`: liveness ok, settlement ok, stalled 0, liveHorseDecision phase ready, recoverableRequestErrors 0, 24 dealable)                                    | confirmed |
| Live client at 02:14 AM          | `7215515e36c2391e0513b62e4ea58b0cb40b68f9` (run `45136047424`, built 08:12:03Z), same on both hosts                                                                                                      | confirmed |
| `origin/main` at 02:14 AM        | `608f33c506b812200af2231ee07796f8edf13b77` (#11841, promo fix)                                                                                                                                           | confirmed |

---

## 4. Repository Map (relevant paths only)

| Path                                                                                                                        | What it is                                                                                                                                   | Modified by this chat?                                                                             | Edit?                                             |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `server/src/engine/HorseLogic.ts`                                                                                           | the main Horse decision file (huge; any change makes `vitest related` select nearly the whole server suite, so locked pushes take 50-55 min) | via Turn 5 (V2 rule, `cashDefenceTrimColdCalls` wiring) and #11741                                 | only inside your lane's options                   |
| `server/src/engine/HorseOptionSwitch.ts`                                                                                    | option registry: owners, scopes, `OPTION_SWITCH_REFUSED`, off-only list                                                                      | Turn 5 (+2 options), #11741 (+1 refused)                                                           | yes, through switch-list trains                   |
| `server/src/engine/HorseDataLedger.ts`                                                                                      | receipt registry (every telemetry receipt an option emits must be listed; `unattributed: []`)                                                | Turn 5, #11741                                                                                     | yes                                               |
| `server/src/engine/HorsePlo6FacingBetPricedV2.ts`                                                                           | PLO6 V2 facing-bet pricing (1,377 lines, added by Turn 5)                                                                                    | Turn 5                                                                                             | PLO6 lane                                         |
| `server/src/engine/HorseCashDefenceTrimColdCalls.law.test.ts`                                                               | Packet 3 option law tests (676 lines)                                                                                                        | Turn 5                                                                                             | yes                                               |
| `server/src/engine/SecondLookIsNotLive.test.ts`                                                                             | source law: every `telemetryOn(opts)` local is counting-only and listed with its site count                                                  | this chat: 48 -> 50                                                                                | only to list a new counting-only site             |
| `server/src/services/horseDecisionJournal/holdCannotStarve.test.ts`                                                         | load-sensitive journal test; yardstick fix (min of 5 scans) carried into Turn 5 from HORSE DECISIONS commit `51c77fbab7ca`                   | via Turn 5                                                                                         | HORSE DECISIONS owns it                           |
| `server/scripts/gen-horse-option-switch-sql.ts`                                                                             | generator; `--check` proves the newest switch-list migration and the proof script equal the registry                                         | no                                                                                                 | run before every switch-list merge                |
| `server/scripts/switch-list-fresh-at-merge.ts <head sha>`                                                                   | refuses a head whose switch-list migration does not follow main's newest                                                                     | no                                                                                                 | run immediately before merging any switch-list PR |
| `scripts/ci/test-horse-option-switch-evidence-postgres.sh`                                                                  | PG17 proof script; holds `style= plain= offonly= shadow= onshadow= refused=` lists that must equal the registry                              | Turn 5 and #11741 (conflict resolved here)                                                         | through trains only                               |
| `scripts/ci/check-new-migration-version-collisions.mjs`                                                                     | refuses an older-versioned migration that overwrites a newer definition; migrations install in **merge order**, not version order            | no                                                                                                 | run on any migration PR                           |
| `scripts/ci/merged-migration-dispatch.mjs`                                                                                  | dispatcher logic; `RELEASE_SCHEMA_FREEZE_CHICAGO = { from: [23, 45], until: [4, 15] }`; freeze wait budget 285 min                           | no                                                                                                 | do not edit (release control)                     |
| `supabase/migrations/20261122181616_horse_option_switch_turn5_antigravity_train.sql`                                        | Turn 5 switch-list migration, sha256 `df13d3f6d2df6ee317e541da3f01b17ffff9151a5784da604c9a0d791b3bc76a`                                      | merged 1:14:36 AM CST, **not yet installed**                                                       | no                                                |
| `docs/horse-option-authority.d/*.md`                                                                                        | authority docs per option; machine-read fields (`State:`, `Evidence MET/NOT MET`, `- Replay:` rows, `## Rollback`)                           | 4 docs this chat                                                                                   | yes, but see section 6.6                          |
| `docs/horse-option-switch-state.json` (from #11828)                                                                         | **UNKNOWN, NEXT AGENT MUST INSPECT**: lead-5's 07:16Z note says activations now also update this file under the #11828 rule                  | no                                                                                                 | read before any activation packet                 |
| `scripts/ops/option-people-impact.mjs`, `scripts/ops/option-people-impact-lib.mjs`, `tests/unit/optionPeopleImpact.test.ts` | new read-only report (#11823)                                                                                                                | created this chat                                                                                  | yes                                               |
| `scripts/ops/person-vs-horse-results*.mjs`, `docs/ops/person-vs-horse-results.md` (#11832, lead-5, merged 2:07 AM CST)      | a second, overlapping person-vs-horse report with a "luck-aware gate"                                                                        | no                                                                                                 | consolidation candidate (section 16)              |
| `scripts/ops/holdem-blanket-scoreboard-lib.mjs`                                                                             | Horse SWITCH scoreboard; parses `Evidence\s+NOT\s+MET` / `Evidence\s+MET` from authority docs                                                | no                                                                                                 | read only                                         |
| `tests/unit/holdemBlanketScoreboard.test.ts`                                                                                | expects `holdemValueAndCallsArePriced` evidenceStatus `NOT_MET`                                                                              | no (this chat broke it, #11800 fixed it)                                                           | read only                                         |
| `tests/an-authority-doc-states-the-live-switch.law.test.ts` (#11828)                                                        | law: an authority doc's State must match the live switch                                                                                     | no                                                                                                 | obey it                                           |
| `tests/a-docs-change-runs-the-tests-that-read-it.law.test.ts` (#11800)                                                      | docs changes now run the tests that read them in pre-push                                                                                    | no                                                                                                 | obey it                                           |
| `.agent/handoffs/`                                                                                                          | coordinator handoff prompts (#11665 added the 2026-11-21 one)                                                                                | this handoff is proposed at `.agent/handoffs/2026-11-23-antigravity-coordinator-HANDOFF-PROMPT.md` | yes (docs PR)                                     |

---

## 5. Applicable Instructions And Constraints

### 5.1 Files to read before editing

1. `node /Users/smarter.poker/Documents/agent-policy.mjs read` (Policy 2.9; expected manifest sha256 `e78254a8d7b401b5e9f8fdcefa1f6f36088fa1a7128e1c2d18622c2a952ac2cb`). It prints `/Users/smarter.poker/Documents/AGENTS.md` (owner policy: authority, credentials, storage on SSD, SSD auto-selection, tournament-start holds need an explicit owner instruction).
2. `/Users/smarter.poker/Documents/club-arena/AGENTS.md` (push with `scripts/agent-push.sh`; owned worktrees; reach `ca-engine` only as `ssh ca-engine`, never retry a refused connection; never reset shared checkouts or bypass a failing required check).
3. `/Users/smarter.poker/Documents/club-arena/PUBLISHING.md` (release history and owner windows) and `/Users/smarter.poker/Documents/MAC-STORAGE.md`.
4. `python3 /Users/smarter.poker/Documents/ssd-tools/ssd-paths.py work`, `... archives`, `... json` (UUID-based SSD discovery; prefer SSD2).

### 5.2 Storage rules

- Work only under `/Volumes/SmarterWork/agent-work/extreme-capacity` (SSD2). Evidence under `/Volumes/SmarterArchives/agent-evidence/extreme-archive`.
- When SSD1 is missing, `/Volumes/SmarterWork/agent-work/shared-capacity` resolves to the **internal-disk scaffold**: never write there while SSD1 is absent.
- Remove your own worktrees and scratch when done; never touch other lanes' directories.

### 5.3 Release, merge and install windows

- Three-hourly cutovers: 1, 4, 7, 10 AM and PM CST. Each has a **combined hold** for migration and release-control merges that the cutover lane posts (on 2026-11-22 the hold moved earlier, for example "no migration or release-control merges from 23:05Z until the 01:00Z seal").
- **Release-control paths** (never merge during a hold): `.github/workflows/{backup-engine,stage-engine-release,auto-deploy-hetzner,engine-release-prequalification}.yml`, `scripts/ci/read-engine-prequalification.py`, `scripts/ci/select-daily-engine.py`, `scripts/ci/recorded-migrations.manifest.json`, `server/scripts/**`, `server/src/maintenance/**`.
- **Current rule (cutover lane 07:53:40Z):** until the 4:00 AM CST SEALED post (~10:10Z) no merges touching release controls; migrations stay frozen until 10:15Z; no switch or settings writes from 09:30Z until SEALED.
- **DDL refusal window:** never merge a migration during `:50` to `:03` UTC; merge migrations only inside `:04` to `:49` UTC.
- **Nightly release schema freeze:** 11:45 PM to 4:15 AM Chicago (`05:45Z` to `10:15Z`). A migration merged inside it waits in its `dispatch-merged-migrations.yml` run (budget 285 min) and installs automatically when it ends.
- A hand-written `schema_migrations` row stales every Backup copy; never write one.
- Zero-migration `server/**`, client and docs merges are allowed during migration holds; they ride the next certified cutover.
- Pure `docs/` (and `scripts/ops` + `tests/unit` only) pushes take the fast pre-push path and do not need `shepherd.lock`. Anything touching `server/` or `supabase/` must use the locked wrapper.

### 5.4 Push lock

- The only lock: `/Volumes/SmarterWork/agent-work/shared-capacity/hs-locks-01UxDLnM4/shepherd.lock` (owner line in `shepherd.lock/owner`). At 02:14 AM it was held by `hd-lead-01BbZPDk session_01BbZPDkhfr4sF9yWVkTwna3 pid=57223 push of agent/hd-combo-01BbZPDk/multiboard-hardening-and-v78-priced-v2 bfd1c195e`.
- This lane's wrapper: `/Volumes/SmarterWork/agent-work/extreme-capacity/coord-c6ec33ca/coord-push-locked.sh <worktree> <label>` (waits for `shepherd.lock` absent, load1m < 35 and `core-gate-running.py` not running; `nice -n 10`; 60-minute cap; releases on exit). Its `ME` string is still `antigravity-coordinator-c6ec33ca session_c6ec33ca-91a8-4c8b-9ba5-a3fa583e2087`; update it to your session if you use it.
- Detach long jobs with `python3 /Volumes/SmarterWork/agent-work/extreme-capacity/coord-c6ec33ca/detach.py <logfile> <cmd...>` (double-fork + setsid; `nohup ... &` from the host terminal died when the call returned).
- The SSD2 fallback lock (`extreme-capacity/shared-locks-fallback-ssd1-down-20261123/`) was **deleted at 9:21 PM CST**; do not recreate it unless SSD1 disappears again, and announce it if you do.

### 5.5 Coordination inboxes (append to BOTH, pure ASCII, each post ends with `GATE END`)

- Primary (SSD1): `/Volumes/SmarterArchives 1/agent-evidence/COORDINATION-INBOX.md` (13,409 lines at 02:14 AM).
- Fallback (SSD2): `/Volumes/SmarterArchives/agent-evidence/extreme-archive/COORDINATION-INBOX-FALLBACK-20261116.md`.
- Header format used: `## <UTC ISO>Z FROM Antigravity Coordinator successor (Claude <session>) TO <lanes> - SUBJECT: <...>`. This session posted with a small Python appender that asserts the message is ASCII before writing.

### 5.6 Coordinator ledgers (keep byte-identical, `cmp` exit 0)

- `/Users/smarter.poker/Documents/Claude/antigravity-coordinator-01UxDLnH/ACTIVATION-LEDGER-20261121.md`
- `/Volumes/SmarterArchives/agent-evidence/extreme-archive/antigravity-coordinator-20261121/ACTIVATION-LEDGER-20261121.md`
- sha256 at 02:14 AM: `9a49213ae7a4c8ea8c19edfdf581951991a25850bae98f7ffb46a4b4f184755e` (two "Successor session update" sections added by this chat, inserted before the first `## Live Antigravity-lane options` section).

---

## 6. Complete Discovery Record

### 6.1 Release mechanics (observed tonight)

- The cutover lane certifies a commit with a Backup run (clone production, stage, soak ~55 min), a prequalification run and a Stage run that owns the cycle's reservation window, then seals at the cutover. `/health` field `horseUpgradeManifest.sourceRevision` is the serving commit (`sourceRevision` at top level is null).
- **10 PM CST cycle skipped (kept `735299cd5fda`):** the Backup O1 safeguard stopped a soak because main gained a migration file inside the O3 deferral, plus a hand-written `schema_migrations` row (`20261123002808`, promo lane) at 02:49Z staled every earlier copy. Fix O16 (#11816) merged after 04:10Z.
- **1 AM CST cycle skipped:** Stage election bug. Candidate `c0706e2b3563` was pushed at 04:49:59Z, its Stage run created 04:50:01Z; one run judged itself by push time and later runs by creation time, so nobody owned the cycle. Fix O18 (#11829, draft) merges after the 4 AM seal.
- **4:00 AM CST plan:** Stage run `45134198393` owns the cycle; candidates `c0706e2b3563` (certified 06:11Z) and freeze baseline `8d4a7ef726d9` (certified 07:27:38Z); cutoff 09:30Z; SEALED expected ~10:10Z.
- Candidate contents (verified): both contain all 24 prior coordinator PRs, #11782, #11791 and **#11741**; neither contains #11823, #11820 (Turn 5) or #11835.

### 6.2 Migration mechanics

- `dispatch-merged-migrations.yml` (trigger `pull_request_target: closed`) dispatches each added or modified migration to `apply-merged-migration.yml` (`workflow_dispatch`, input `migration`). Turn 5's dispatcher run is **`45129670715`** (started 07:14:39Z, in_progress at 08:14Z, waiting out the freeze).
- Migrations install in merge order. An older version number is fine unless it redefines an object a newer migration owns (`check-new-migration-version-collisions.mjs` checks that; Turn 5 passed).
- One migration that fails to install blocks every newer one (seen 22:10Z with `20261122192807` until #11785 made it verify-only).
- Other migrations queued for the 10:15Z freeze end (other lanes): `20261123000830` (#11796), `20261123072039` (#11841), `20261123073141` (#11842, if merged), window migration `20261123013136` (installs in the 04:00 break by design).

### 6.3 Switch system (production read 08:14Z)

- `ca_horse_style_switch`: 71 rows, **53 on / 18 off / 0 shadow**. `ca_horse_style_switch_audit` max id **190**.
- Audit rows 178-190: 178 `holdemTournamentAllInCallIsPriced` null->on 14:07:49Z (11-22); 179 `omahaMathCorePlo5Flop` shadow->off; 180 `omahaStabDefenceIsPriced` null->shadow; **181 `holdemTournamentAllInCallIsPriced` on->off 19:51:28Z**; 182 `omahaStabDefenceIsPriced` shadow->off; 183 `omahaBluffCatcherFoldVsValueLeader` on->off 22:24:45Z (lead-5); 184 `omahaUnderpairNoMultiwayFlopContinue` on->off 23:07:17Z (lead-5); **185 `holdemValueAndCallsArePriced` null->on 23:25:25Z**; **186 `holdemTournamentAllInCallIsPriced` off->on 01:25:29Z (11-23)**; 187 `v79TopPairWeakKicker` null->off 02:26:33Z; 188 `v79TopPairWeakKicker` off->default 04:17:47Z; 189 `omahaMathCorePlo5Flop` off->shadow 04:33:19Z; 190 `omahaMathCorePlo5Flop` shadow->off 08:06:52Z.
- Evidence table `ca_horse_option_switch_evidence`: #75 Packet 1 (original), #76 Packet 2, **#77 Packet 1 re-activation** ("Behaviour evidence unchanged from evidence #75").
- Key rows ON at 08:14Z: `holdemRiverFullHouseValueIsPriced`, `holdemTournamentAllInCallIsPriced`, `holdemValueAndCallsArePriced`, `horseActionTimeIsPublicOnly`, `huBbDefendsUnreadToPrice`, `styleTightPlayerExploit`, `vpipFloorLimpOnly`. `omahaMathCorePlo5Flop` off.
- Installed switch-list migrations since 11-21: `20261121024624, 20261121032246, 20261121042010, 20261121143225, 20261121214238, 20261122011559, 20261122035000, 20261122131322` (Turn 4B is the newest installed). `fn_ca_horse_option_switch_states` stamp `20261122131322`.
- `ca_engine_runtime_settings_active.version = 13` (lead-5 rolled 12 -> copy of 2 at 22:12:30Z 11-22; PLO4/5 blanket off-list emptied).
- `horse_error_log` 24h = 0; refusal, config, fallback and illegal telemetry today = none.

### 6.4 Horse-decision telemetry names that matter

- Packet 2 receipts: `holdem_priced_changed`, `holdem_priced_bet`, `holdem_priced_call`, `holdem_priced_fold`, `holdem_priced_check`, `holdem_priced_raise`, `holdem_priced_not_value_kept`, `holdem_priced_unpriced_multiway`, `holdem_priced_value_raise_deferred`, `holdem_priced_bluff_raise_kept` (114 changed in the first 12 minutes; 1,095 repriced cash decisions by 7:43 PM CST per Horse SWITCH).
- Packet 1 failure signal: `horse_decision_refused_isolated` (156 at 13:45 CST 11-22 before the rollback) and `/health liveHorseDecision.recoverableRequestErrors` (39 then). Now 0 and 0.
- `horse_brain_telemetry` columns: `day, feature, fires, updated_at` (daily aggregates, not per hand). `horse_error_log` columns: `id, horse_id, error_type, error_message, context, stack_trace, resolved, created_at`.

### 6.5 Measurement facts

- People-with-horse hands are scarce: 37,343 in 15 days, mostly NLH tournaments. PLO4/5 cash swings about +/-200 bb/100 per 24 h window; most switch changes overlap 20+ others in the same games.
- Verdict-only replay and real-card EV disagree in PLO6 (see 7.7). Packet 2 was activated by Horse SWITCH as a "lane decision under owner full-ownership orders" with REPLAY-6 not met.
- PLO6 river bettor ranges measured from 8,588 production heads-up river first bets called to showdown: big bets (0.7-1.1 pot) 42% top 2%, 85% top 10%; only 16 of those bets were made by people.

### 6.6 Authority-doc parsing traps (learned the hard way)

- `holdem-blanket-scoreboard-lib.mjs` reads evidence only from the literal phrases `Evidence NOT MET` / `Evidence MET` (status paragraph first, whole text second). Rewording them breaks `tests/unit/holdemBlanketScoreboard.test.ts`.
- `an-authority-doc-states-the-live-switch.law.test.ts` (#11828) now requires each doc's State to match the live switch.
- Changing a doc changes its sha256; a live row's evidence note keeps the old sha; a later re-activation records a new evidence row with the new sha.
- Current sha256 on `origin/main`: `cashDefenceTrimColdCalls.md` `f888c88ea441f6d9691ded85b5226bfa18ef069080c79d416826ec1c2ee9cde3`; `holdemTournamentAllInCallIsPriced.md` `70f931329e6352fe9b4106c721183d703321fd7d705c88e4f63b51ba6c35ec3d` (changed by #11828 after this session's 775c2af5... value); `holdemValueAndCallsArePriced.md` `9e53cdff65a68f0f0cdeaaacd66fa99b3f9c1e96c1218a9150491cc5c10d0912`; `plo6FacingBetIsPricedV2.md` `9d1f4630aebfba901e21abf48709c01b1106c55654a27f1492ff57836357674c`.

### 6.7 Test-suite facts

- `vitest related` on `HorseLogic.ts` runs ~1,500-2,500 server files; a full locked pre-push took 49-54 min tonight against the 60-min cap.
- Known flakes: `holdCannotStarve.test.ts` negative control under load (fixed on main via Turn 5's carried commit; `SCAN_YARDSTICK_SAMPLES` present); `server/src/engine/horseDecision/ruleReceiptsAreJournaledWithTheirHand.test.ts` ("journals the set pound on the record of the turn decision it sized"), CI-only, not reproducible on the Mac, owned by PLO-OWNER.
- The local pre-push hook keeps running other stages after the first BLOCKED test; stop your own wrapper early if a failure is certain so the lock frees.

---

## 7. Work Completed During This Chat

### 7.0 Starting bookmark (state when this chat began, 2026-11-22 3:43 PM CST / 21:43Z)

- `origin/main`: `7a54cc2c17464c58f81e7863f62dd45629a544e4` (#11771, 21:35:11Z); the 3:30 PM handoff said `a0a85b117bed`, and two PRs (#11775, #11771) had merged since.
- Live engine: `ea92b56f01770105b2ccdcc49a5e245c8c7f204d`, recoverableRequestErrors 39 (frozen since the Packet 1 rollback).
- Live client: `7a54cc2c...` (run `45072932942`, 21:39:31Z).
- Switch: 70 rows, 53 on / 17 off; newest installed switch list `20261122131322`.
- Worktrees: `coord-plo6-harm-lock-20261121` (Turn 5, HEAD `f9cc40e1ce3f`, never pushed) and `coord-nash-tight-jammer-only-20261121` (#11741, local `b6a00893a723`, remote `519f7c78b7c6`).
- The prior session's 24 merged PRs, all verified ancestors of `origin/main` and of every later engine:

|   # | PR     | Merge SHA    | Scope                                                                                                                                                                                                          |
| --: | ------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | #11665 | 7eeac4f3029c | coordinator handoff doc                                                                                                                                                                                        |
|   2 | #11670 | 64a9d8b8ba96 | huSmallBlindStealsVsTightBigBlind fold-share law tests                                                                                                                                                         |
|   3 | #11682 | 2418d77b86b1 | 13-file authority sync (plo6FacingBetIsPriced F6 FAIL z -5.84, etc.)                                                                                                                                           |
|   4 | #11659 | ab3b12dbb5b3 | Turn 2 harm locks + migration 20261121214238                                                                                                                                                                   |
|   5 | #11684 | 756498773cc9 | 8 root-cause fixes (Lightning maniacBehindWidth, RIT pollMs, REPLAY-V2 styleMaps, all-in-call placement, 6 value-and-calls math fixes, hydrated league card, 12 ledger receipts, migration-version stale lock) |
|   6 | #11643 | 01919ce6e496 | Turn 3 styleShiftReleaseIsNoiseAware + migrations 20261121171027, 20261122011559                                                                                                                               |
|   7 | #11698 | 89a5c6eb6651 | Heads Up authority docs                                                                                                                                                                                        |
|   8 | #11706 | 6495906063a6 | tournament all-in-call card + Evidence MET                                                                                                                                                                     |
|   9 | #11707 | 8eee4dd7c43b | horse-league-card-hydrated.yml                                                                                                                                                                                 |
|  10 | #11708 | f89365c4950e | styleShiftReleaseIsNoiseAware 168k eval + v72 receipt fix                                                                                                                                                      |
|  11 | #11711 | 6336dcf6c90d | holdemValueAndCallsArePriced replay/league sync                                                                                                                                                                |
|  12 | #11712 | 5e106e164787 | HorsePlayStyles law test + 4 docs                                                                                                                                                                              |
|  13 | #11714 | 3b54b071664e | Status/Owner authority enforcement on default-on docs                                                                                                                                                          |
|  14 | #11715 | 4f009352aa83 | Partition A: flo8 betting, FLO8 personas and cards, hi-lo runout equity fix                                                                                                                                    |
|  15 | #11718 | 31a4532be9b5 | readBreakEvenBluff replay (OFF)                                                                                                                                                                                |
|  16 | #11719 | 52e9b89300fb | styleTightMethodLine replay (OFF)                                                                                                                                                                              |
|  17 | #11721 | 84386569d53a | value-and-calls 6-max and 9-max league cards                                                                                                                                                                   |
|  18 | #11723 | ec21275d2efe | flh_defending_postflop_blinds_v1                                                                                                                                                                               |
|  19 | #11735 | e8f8607f26f9 | 15-file docs sync                                                                                                                                                                                              |
|  20 | #11726 | 489ade338383 | river no-blocker bet card                                                                                                                                                                                      |
|  21 | #11739 | 27dc68ab40b8 | value-and-calls M1/M2 root-cause fix                                                                                                                                                                           |
|  22 | #11738 | ec883ebb3f8f | PLO8 HU scripted field + omahaHiLoTournamentFirstIn doc                                                                                                                                                        |
|  23 | #11744 | 478765c7ecd6 | Packet 2 authority doc                                                                                                                                                                                         |
|  24 | #11768 | a095c2dd86af | 15-file docs polish (wrongly said Packet 1 LIVE ON; fixed by #11782)                                                                                                                                           |

### 7.1 Workstream A: bootstrap, access and audit (3:43-4:00 PM CST)

- Read the handoff; folder access first denied by the app classifier, then granted after Dan's 3:45 PM message: `/Users/smarter.poker/Documents`, `/Volumes/SmarterWork/agent-work`, `/Volumes/SmarterArchives/agent-evidence`, `/Volumes/SmarterArchives 1/agent-evidence`. Used the `counselors__host_terminal` tool (real Mac shell with gh, supabase and git credentials) for all Mac work.
- Policy read OK (Policy 2.9). SSD2 paths verified with `ssd-paths.py`.
- Found: neither push had landed (#11741 origin still `519f7c78`; Turn 5 not on origin). The old Turn 5 wrapper (started 14:09 CST by Antigravity's language server) was still waiting for the lock.
- Read-only DB audit: no competing switch-list migration ahead of Turn 5; `horse_error_log` 24h 0; fault telemetry none.
- Verified all 24 prior PRs are ancestors of main (21 were in `ea92b56f`, all 24 in candidate `88b8dac0`).

### 7.2 Workstream B: Packet 1 doc correction (#11782)

- **Problem:** `holdemTournamentAllInCallIsPriced.md` said LIVE ON (from #11768) after `audit #181` rolled it back.
- **Change:** State line rewritten to OFF since audit #181 with history; the activation section gained a second prerequisite (engine must carry #11779); `## Rollback` rewritten.
- **Files:** `docs/horse-option-authority.d/holdemTournamentAllInCallIsPriced.md` (1 file).
- **Branch/worktree:** `agent/coord-01BbZPDk/docs/allin-call-audit-181-rollback`, worktree `coord-allin-call-audit181-doc-20261122` (removed).
- **Result:** PR **#11782** merged **2026-11-22 4:06:20 PM CST** as `bbf068c0dab133a28e95b5c306c1ab544e988796`. First push failed (no `node_modules` in the fresh worktree); fixed by `npm ci` in root and `server/`.
- **Later:** #11779 (Horse SWITCH's permanent `reference_owner` fix) merged 4:08:18 PM CST (`2e3cfd5638e9`), shipped in `735299cd5fda` at the 7 PM cutover; Horse SWITCH re-activated Packet 1 at 7:25:29 PM CST (audit #186, evidence #77), clean afterwards. #11828 later rewrote the doc to LIVE ON.

### 7.3 Workstream C: PR #11741 `nashCallVsTightJammerRespect` (dark, default OFF in `OPTION_SWITCH_REFUSED`, 0 migrations)

- Merged `origin/main` into the branch twice (`e3df8037ed45`, then `0b6d2cba3216`); `gen --check` OK.
- Push attempt 1 (lock 22:07Z) failed only on the `holdCannotStarve` load flake (expected 2755.2 > 6132.2); stopped by this session to free the lock.
- Push attempt 2: lock 22:46:07Z, PUSH DONE rc=0 23:39:48Z (53.7 min of the 60-min cap).
- CI 44/44 required checks pass; merged **2026-11-22 6:31:23 PM CST** as `3811538b62a8351640424c54932bc2b2d0b9ee9a`, during the 23:05Z-01:10Z migration hold (allowed: zero-migration server change). Worktree and branch removed.
- **Live status:** in both 4:00 AM candidates; not live at 02:14 AM (engine still `735299cd5fda`).
- **What it does** (from PR body, not re-measured): dark option + ledger receipt + league card + 21 tests; `+4.98 +/- 1.20 bb/100` (z +4.15) vs a 15 bb tight jammer, 0/8,000 false positives vs Nash jammers.

### 7.4 Workstream D: Packet 2 live verification and doc (#11791), plus a regression this caused

- Horse SWITCH turned `holdemValueAndCallsArePriced` on at **5:25:25 PM CST** (audit #185, evidence #76) on `88b8dac0ebdc`.
- Verified read-only at 5:37 PM: 114 changed decisions, 0 errors, 0 faults, 0 refusals, recoverableRequestErrors 0.
- Doc PR **#11791** merged **5:47:51 PM CST** (`33411ce5ad2e`). **Regression:** the new State line said "the REPLAY-6 verdict-only bar is not met" instead of the parsed phrase "Evidence NOT MET", which broke `tests/unit/holdemBlanketScoreboard.test.ts` on main. Another lane fixed it in **#11800** (`58ad3c790aed`, 7:10:56 PM CST), which also made docs changes run the tests that read them. Lesson recorded in 6.6.

### 7.5 Workstream E: Turn 5 switch-list train (#11820)

- **Branch:** `agent/coord-c6ec33ca/horses/plo6-facing-bet-off-only-harm`; worktree `/Volumes/SmarterWork/agent-work/extreme-capacity/coord-plo6-harm-lock-20261121` (still present, clean, at `86c1f933da32`; remove after the install proof).
- **Contents:**
  - `plo6FacingBetIsPriced` moved to `OPTION_SWITCH_OFF_ONLY` (harm: F6 `-15.510 +/- 2.655 bb/100`, z -5.84; doc sha `a390b9db...`).
  - `cashDefenceTrimColdCalls` registered switchable default OFF, Evidence MET (doc sha `f888c88e...`).
  - `plo6FacingBetIsPricedV2` registered switchable default OFF, Evidence NOT MET (doc sha `eb08e473...` at merge; `9d1f4630...` after #11835).
  - Migration `20261122181616`, sha256 `df13d3f6d2df6ee317e541da3f01b17ffff9151a5784da604c9a0d791b3bc76a`: 7 style / 358 other / 75 off-only; 0 switch writes; token diff vs Turn 4B is exactly +`cashDefenceTrimColdCalls`, +`plo6FacingBetIsPricedV2` (no omaha/plo4/plo5 change).
  - 24 files, +4,679/-49 at the time of the scope proof.
- **Commits this chat added on the branch (in order):**
  1. `0b5e0a8bb96e`: merged origin/main (#11771).
  2. `7580de03aad4`: `SecondLookIsNotLive.test.ts` telemetry-site count 48 -> 50. Root cause: the new `plo6FacingBetIsPricedV2Rule` adds one counting-only `const tele = telemetryOn(opts);` (the law counts two uses per declaration). The branch had failed this law since before this chat (`f9cc40e1ce3f` also had 25 sites with 48 listed).
  3. `f686c9b3a876`: merged origin/main (#11765, #11782 and others).
  4. `e793b7b4ef6e`: merged origin/main after #11741. Conflict in `scripts/ci/test-horse-option-switch-evidence-postgres.sh` resolved as Turn 5's four list lines plus main's `refused=` line (main changed only that line).
  5. `db98e581b9d6`: cherry-pick `-x` of HORSE DECISIONS' `51c77fbab7ca` "holdCannotStarve takes its scan yardstick as the cheapest of five scans" (author kept).
  6. `86c1f933da32`: merged origin/main (#11800, #11801).
- **Pushes:**
  - `f686c9b` blocked on the 48->50 law (stopped).
  - `e793b7b` blocked on the scoreboard regression plus `holdCannotStarve` (stopped at 8:02 PM CST, while SSD1 was down and the SSD2 fallback lock was in use).
  - **`86c1f93` lock 02:56:27Z, PUSH DONE rc=0 03:45:40Z.**
- **Local verification:** 107 server test files / 1,597 tests (source-pin laws over every changed file plus Turn 5's 5 own suites plus `holdCannotStarve`); `tests/unit/holdemBlanketScoreboard.test.ts` + `tests/a-docs-change-runs-the-tests-that-read-it.law.test.ts` 21/21; `gen --check`; `switch-list-fresh-at-merge`; `check-new-migration-version-collisions` OK; prettier OK.
- **CI:** 65 pass / 0 fail. Re-checked at 1:02 AM CST against main (22 commits newer, none touching switch files, clean merge).
- **Merged 2026-11-23 1:14:36 AM CST as `67768652003d5bcd6d7703ff3c047f305bc8c84a`.** Dispatcher run `45129670715` waiting for the freeze.
- **NOT YET VERIFIED:** install, DB proof, engine code live.

### 7.6 Workstream F: people vs horses report (#11823)

- **Built by a background fork:** `scripts/ops/option-people-impact-lib.mjs` (442 lines), `scripts/ops/option-people-impact.mjs` (154), `tests/unit/optionPeopleImpact.test.ts` (275, 13 tests).
- **Design:**
  - Events are every switch audit state change and every runtime-settings version in the lookback (settings scoped to PLO4/5 cash).
  - Scope per option: an explicit table, then `HorseOptionSwitch.ts` scope text, then the option name.
  - Statistic: people's net bb summed per hand in hands with at least one person and one horse, 24 h before vs up to 24 h after; bb/100, SE, z; verdict needs 200 hands per side and |z| >= 2; overlapping changes counted.
  - One read-only `WITH` query (uses `assertReadOnlySql`, `querySupabaseReadOnly`); per-minute aggregates only.
- **First report:** `/Volumes/SmarterArchives/agent-evidence/extreme-archive/antigravity-coordinator-20261121/OPTION-PEOPLE-IMPACT-20261123.md` (sha256 `17d8bff0d280f4d960478abd665b5f3faff88b3dd1bdda6ce4cf5b80bcb19d87`).
  - No live change measurably hurting horses.
  - Packet 2 had too few hands to judge.
  - Packet 1 showed no clear change at any of its three switch points.
  - Since lead-5's reset: people -815 +/- 510 bb/100 over 238 hands (z -1.58).
  - One self-caught bug (Short Deck read as hold'em) was fixed before commit.
- **Merged 2026-11-22 11:10:56 PM CST** as `0d547e25332a135a58ea751013f56a1fd32f0569`. Worktree removed.
- **Overlap:** lead-5's #11832 (merged 2:07 AM CST) is a second person-vs-horse report; see section 16.

### 7.7 Workstream G: PLO6 V2 parity and V3 trial (#11835)

- **Parity fork** (on `0b5e0a8bb96e`, set `HVH48-C`, seeds 1,7,42, snapshot `prod-switch-20261122T0336Z.json`, scorer `5302af2ab3e`, nodes from HORSE DECISIONS replay6 `C.job.json`):
  - Verdict-only reproduced exactly (25 / 30 / 68 / 10,110 unchanged / 8 unjudged).
  - Real-card `+809.56 bb` (official `+799.49`).
  - Split: HU flop 7/1 +218.44; HU turn 4/0 +24.58; HU river 8/8 +178.43; MW flop 3/15 +54.23; MW turn 1/6 +152.37; MW river 2/0 +181.50.
  - A multiway exclusion is not supported by real-card EV, so no code change. The REPLAY-6 bar fails (25 < 60).
- **V3 fork:** priced heads-up river first bets on the measured range.
  - V3 vs V2: verdict-only 31/30/77 vs 25/30/68; real-card +646.60 vs +813.09.
  - Human-like league (100 sessions): +6.50 +/- 3.68 vs +9.59 +/- 3.43 against off.
  - Mirror (40 sessions): +4.23 +/- 1.52 vs +3.62 +/- 1.26.
  - Paired V3 minus V2: -3.10 +/- 2.62 human-like, +0.61 +/- 1.07 mirror.
  - **Not adopted; nothing committed.** Artifacts (no cards, no IDs) are in `/Volumes/SmarterWork/agent-work/extreme-capacity/coord-c6ec33ca/v3tools/`, including the uncommitted patch `plo6-v3-measured-river-range.UNCOMMITTED.patch`, `density-fit-full.json`, `river-measure-all.json` and `league/`.
- **Doc PR #11835** merged **2026-11-23 1:51:56 AM CST** as `69dcf25b1f2220da19bc33a53792a05f25826efa` (V2 doc: parity section + V3 trial section). Worktree removed.

### 7.8 Workstream H: SSD1 disconnect (7:12 PM CST)

- SSD1 disappeared from `diskutil` at 7:12:16 PM CST (all three SSD1 UUIDs "Could not find disk").
- With it went the shared lock, `core-gate-running.py`, the primary inbox and every `shared-capacity` worktree. Horse SWITCH reported that `.git/worktrees` entries for some `shared-capacity` trees were pruned while it was gone.
- This session created an SSD2 fallback lock (7:15 PM), ran Turn 5's push under it, posted to the SSD2 inbox only, told Dan, and declared the SSD1 lock authoritative again when SSD1 returned (~7:40 PM). The fallback folder was deleted at 9:21 PM.
- HORSE DECISIONS temporarily held both locks; Horse SWITCH pushed under the SSD1 lock while Turn 5 held the fallback, so two pre-pushes ran at once (load 15-17).

### 7.9 Workstream I: coordination posts by this session (both inboxes unless noted)

All times are UTC.

- 21:48:52Z: takeover.
- 22:06:12Z: seal verified + Turn 5 scope proof for lead-5. Lead-5 replied at 22:07:50Z with no objection to Turn 5.
- 22:40:46Z: queue, holdCannotStarve flake and V2 parity.
- 23:40:56Z: Packet 2 live, Turn 5 law fix and merge order.
- 00:37:32Z: #11741 merged.
- 01:16:05Z: SSD2 inbox only. SSD1 down, fallback lock, 7 PM seal, Packet 1 prerequisite met with note sha `775c2af5...`.
- 02:04:40Z: SSD1 lock authoritative again; Turn 5 re-sync.
- 03:21:21Z: fallback folder removed.
- 04:14:06Z: ACK of the migration hold and the Turn 5 plan.
- 04:14:29Z: four hardening items with claim window to 14:00Z.
- 05:11:28Z: #11823 merged and first report.
- 05:33:01Z: V3 not adopted.
- 07:00:04Z: Turn 5 merges at or after 07:15Z.
- 07:20:21Z: Turn 5 merged.

### 7.10 Workstream J: cleanup done

- Worktrees removed: `coord-allin-call-audit181-doc-20261122`, `coord-nash-tight-jammer-only-20261121`, `coord-packet2-live-doc-20261122`, `coord-packet2-evidence-phrase-20261123` (duplicate, never pushed), `coord-option-people-impact-20261123`, `coord-plo6-v2-hu-scope-20261122` (fork), `coord-plo6-v3-real-card-20261123` (fork), `coord-v2-parity-doc-20261123`.
- Branches deleted: each of the above.
- `coord-c6ec33ca/tmp` cleaned from 848 MB to 7.3 MB. Kept: `prod-switch-20261121T2000Z.json`, `prod-switch-20261122T0336Z.json`, `diag-srn-plo4*.mts`, `turn5-push-86c1f93.log`, `turn5-srclaw.log`, `turn5-srclaw-files.txt`, `v2-doc-patch.py`.
- Obsolete helper scripts deleted: `coord-push-locked-ssd2.sh`, `docs-packet2-chain.sh`, `ops-impact-chain.sh`, `v2doc-chain.sh`.
- Scheduled check-ins: this chat's remaining two (4:25 AM install proof, 7:15 AM Packet 3) were **deleted at 2:15 AM CST** so this chat and you do not both act. **You must run those steps yourself** (section 22).

---

## 8. Visual And Product Decisions

No visual or UI work in this lane during this chat. Club Arena visual rulings live in memory `/areas/club-arena.md` and `/areas/design-system.md`; read them only if you touch UI (you should not need to).

---

## 9. Functional And Architectural Decisions

| Decision                                                                                                                                                                                                                                                                                  | Status                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Options are pre-built, default OFF, switched live; never require a cutover to toggle                                                                                                                                                                                                      | implemented system-wide                                                                                          |
| This lane never writes the switch table; Horse SWITCH activates non-PLO4/5 options from packets (path + sha256 + rollback + evidence)                                                                                                                                                     | in force                                                                                                         |
| Packet 1 `holdemTournamentAllInCallIsPriced`                                                                                                                                                                                                                                              | LIVE ON (audit #186, evidence #77)                                                                               |
| Packet 2 `holdemValueAndCallsArePriced`                                                                                                                                                                                                                                                   | LIVE ON (audit #185, evidence #76)                                                                               |
| Packet 3 `cashDefenceTrimColdCalls`                                                                                                                                                                                                                                                       | registered by Turn 5 (merged, not installed); handoff to Horse SWITCH pending a live engine that contains Turn 5 |
| `v72DefenceByOpener` must stay release-default ON (`cashDefenceTrimColdCalls` works inside `gtoDefend72`)                                                                                                                                                                                 | in force                                                                                                         |
| `nashCallVsJam` release-default ON                                                                                                                                                                                                                                                        | in force                                                                                                         |
| `plo6FacingBetIsPriced` off-only (measured harm)                                                                                                                                                                                                                                          | in Turn 5 (not yet installed)                                                                                    |
| `plo6FacingBetIsPricedV2` stays OFF, Evidence NOT MET; V3 measured-range trial rejected                                                                                                                                                                                                   | recorded (#11835)                                                                                                |
| `nashCallVsTightJammerRespect` dark in `OPTION_SWITCH_REFUSED`                                                                                                                                                                                                                            | merged (#11741), not live                                                                                        |
| `styleShiftReleaseIsNoiseAware` installed `["off","on"]`, awaiting owner ruling or multi-hand replay                                                                                                                                                                                      | unchanged                                                                                                        |
| Owner-held OFF (do not lift without Dan): `huOpenerDefendsToPrice`, `huLimpDefendsToPrice`, `huBbDefendsToPrice`, `huSmallBlindStealsVsTightBigBlind`, `fixedLimitPricedPreflop`, `fixedLimitStealVsTightBlinds`, `lightningCheapEntryHoldem`, `lightningCheapEntryOmaha`                 | unchanged                                                                                                        |
| Blocked on 0 live human hands: `omahaHiLoTournamentFirstIn`, 5 Fixed-Limit/FLO8 options, `lightningStyleReadSeparate`, `lightningVpipFloorLimpOnly`                                                                                                                                       | unchanged                                                                                                        |
| Closed OFF (Evidence NOT MET, do not re-litigate): `readBreakEvenBluff`, `styleTightMethodLine`, `horseRiverNoBlockerBet`, `lightningEarlyFoldNeedsFoldThrough`, `holdemHeadsUpPostflopBalance`, `horsePlayStyles`, `plo6ManiacPriceRefusalToRangePlay`, `vpipFloorLimpOnlyTenHandWindow` | unchanged                                                                                                        |
| `plo6MultiwayBetIsPriced` retired (F6 bleed); its early-exit speedup patch went to PLO-OWNER                                                                                                                                                                                              | unchanged                                                                                                        |
| `horseRunItTwiceIsPriced` belongs to HORSE DECISIONS (Turn 6)                                                                                                                                                                                                                             | unchanged                                                                                                        |

---

## 10. Exact Current State (2026-11-23 02:14 AM CST / 08:14Z)

- **Engine:** `735299cd5fda` healthy (above). 4:00 AM CST candidates `c0706e2b3563` / `8d4a7ef726d9`.
- **Client:** `7215515e36c2`.
- **origin/main:** `608f33c506b8`.
- **Turn 5 worktree:** `coord-plo6-harm-lock-20261121`, branch `agent/coord-c6ec33ca/horses/plo6-facing-bet-off-only-harm` at `86c1f933da32`, clean, branch already squash-merged (remote branch status **UNKNOWN, NEXT AGENT MUST INSPECT**; `git ls-remote` showed none for the local branch list check).
- **Turn 5 dispatcher:** run `45129670715` in_progress.
- **Open PRs from this lane:** none. #11824 (HORSE DECISIONS, five dark priced replacements, re-stacked on Turn 5's squash, pushing), #11812 (Horse SWITCH, stacked dark Hold'em bundle) and #11814 (Turn 5b) are other lanes' and OPEN.
- **Push lock:** held by HORSE DECISIONS combopush4 (since 07:28:55Z per their trigger).
- **Load:** 15.0.
- **Running processes of this lane:** none.
- **Ledgers:** cmp 0, sha above.
- **Leftover local branches** (`git -C /Users/smarter.poker/Documents/club-arena branch --list 'agent/coord-*'`): 22 `agent/coord-c6ec33ca/*` branches plus 2 `agent/coord-01Gw7aDt/*` and 2 `agent/coord-efnft-01Gw7aDt/*`. None has a remote branch. All `agent/coord-c6ec33ca/*` ones are "not-ancestor" (squash-merged), so verify each with `gh pr list --head <branch> --state merged` before deleting. Example names: `docs/holdem-post11556-replays`, `feat/flo8-fixed-limit-league`, `feat/plo6-multiway-bet-is-priced` (retired, never merged), `feat/rit-priced-wire` (handed to HORSE DECISIONS), `feat/nash-call-vs-tight-jammer-respect` (`46380582c262`, superseded by `feat/nash-tight-jammer-only`).

---

## 11. Changed-File Ledger (this chat)

| File                                                               | Status            | Purpose                                     | What changed                                                                | Verified                                      | Committed                          |
| ------------------------------------------------------------------ | ----------------- | ------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------- |
| docs/horse-option-authority.d/holdemTournamentAllInCallIsPriced.md | modified          | Packet 1 authority                          | OFF since audit #181, #11779 prerequisite, rollback text                    | prettier, emoji, pre-push, CI                 | #11782 (later rewritten by #11828) |
| docs/horse-option-authority.d/holdemValueAndCallsArePriced.md      | modified          | Packet 2 authority                          | LIVE ON audit #185 + pickup proof (broke scoreboard parse; #11800 repaired) | CI passed at the time; regression found later | #11791                             |
| server/src/engine/SecondLookIsNotLive.test.ts                      | modified          | source law                                  | site count 48 -> 50                                                         | 30/30 locally, CI                             | #11820                             |
| scripts/ci/test-horse-option-switch-evidence-postgres.sh           | conflict-resolved | proof lists                                 | Turn 5 lists + #11741 refused                                               | bash -n, gen --check, CI                      | #11820                             |
| server/src/services/horseDecisionJournal/holdCannotStarve.test.ts  | cherry-picked     | flake fix (HD's)                            | min of 5 scans yardstick                                                    | 12/12 locally, CI                             | #11820                             |
| (Turn 5's own 24 files, authored by the previous session)          | merged            | Turn 5                                      | see 7.5                                                                     | CI 65/65                                      | #11820                             |
| (#11741's 9 files, previous session)                               | merged            | dark jammer option                          | see 7.3                                                                     | CI 44/44                                      | #11741                             |
| scripts/ops/option-people-impact-lib.mjs                           | new               | report library                              | read-only query + statistics                                                | 13/13 unit tests                              | #11823                             |
| scripts/ops/option-people-impact.mjs                               | new               | report CLI                                  | CLI wrapper                                                                 | same                                          | #11823                             |
| tests/unit/optionPeopleImpact.test.ts                              | new               | unit tests                                  | fixtures, no DB                                                             | 13/13                                         | #11823                             |
| docs/horse-option-authority.d/plo6FacingBetIsPricedV2.md           | modified          | PLO6 V2 authority                           | parity section + V3 trial section                                           | prettier, emoji, pre-push, CI                 | #11835                             |
| ACTIVATION-LEDGER-20261121.md (x2 mirrors)                         | modified          | coordinator ledger                          | 2 successor update sections                                                 | cmp 0                                         | not in repo                        |
| both coordination inboxes                                          | appended          | coordination                                | 14 posts (one SSD2-only)                                                    | ASCII-asserted                                | not in repo                        |
| OPTION-PEOPLE-IMPACT-20261123.md (archive)                         | new               | first report                                | aggregate only                                                              | reviewed                                      | not in repo                        |
| coord-c6ec33ca/detach.py, turn5-srclaw.sh, docs-audit181-chain.sh  | new helpers       | detach jobs, local law run, docs push chain |                                                                             | used successfully                             | not in repo                        |
| coord-c6ec33ca/v3tools/\*                                          | new (fork)        | V3 trial artifacts, no cards                |                                                                             |                                               | not in repo                        |

No unrelated user changes were found in this lane's worktrees. The shared clone has other agents' state; do not touch it.

---

## 12. Asset Ledger

No visual assets. Data artifacts:

| Asset                               | Path                                                                                                                                                              | Purpose                       | Tracked   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------- |
| prod switch snapshot (11-22 03:36Z) | `coord-c6ec33ca/tmp/prod-switch-20261122T0336Z.json`                                                                                                              | replay base arm for V2 parity | no (keep) |
| prod switch snapshot (11-21 20:00Z) | `coord-c6ec33ca/tmp/prod-switch-20261121T2000Z.json`                                                                                                              | older replay base             | no        |
| V3 trial artifacts                  | `coord-c6ec33ca/v3tools/` (1.3 MB, 22 files; checked: no `hole`, `hand_id`, `user_id` or `username` keys in the JSON files)                                       | future PLO6 work              | no        |
| People-impact first report          | archive `OPTION-PEOPLE-IMPACT-20261123.md`                                                                                                                        | baseline                      | no        |
| Horse SWITCH packets                | archive `HORSE-SWITCH-HANDOFF-PACKETS-20261121.md` (sha256 `eab910ab...3011d`, unchanged this chat; **not updated** with Packet 1 re-activation or Packet 2 live) | packet record                 | no        |

---

## 13. Commands And Tools Used (patterns to reuse)

- **Health:** `curl -s https://engine.smarter.poker/health | python3 -c "import json,sys; d=json.load(sys.stdin); h=d.get('liveHorseDecision',{}); print(d.get('horseUpgradeManifest',{}).get('sourceRevision'), d.get('liveness'), d.get('settlementStatus'), d.get('stalledTableCount'), h.get('phase'), h.get('recoverableRequestErrors'))"`
- **Client build:** `curl -s https://ca-static.smarter.poker/build-info.json` and `https://smarter.poker/hub/club-arena/build-info.json`.
- **Read-only DB:** Supabase MCP `execute_sql` on project `kuklfnapbkmacvwxktbh` with SELECT only, or `supabase db query --linked -o json "BEGIN READ ONLY; <SELECT>; COMMIT;"` from a worktree. The switch table column is `option` (not `option_name`).
- **Ancestry:** `git merge-base --is-ancestor <sha> <live sha>`.
- **Switch checks** (from `<worktree>/server`): `npx tsx scripts/gen-horse-option-switch-sql.ts --check`; `npx tsx scripts/switch-list-fresh-at-merge.ts <full head sha>`; then from the worktree root `node scripts/ci/check-new-migration-version-collisions.mjs origin/main`.
- **Conflict preview:** `git merge-tree --write-tree --name-only origin/main <head>`.
- **Worktree:** `git -C /Users/smarter.poker/Documents/club-arena worktree add -b <branch> /Volumes/SmarterWork/agent-work/extreme-capacity/<dir> origin/main`, then `npm ci --ignore-scripts --no-audit --no-fund` in root and `server` (with `TMPDIR=/Volumes/SmarterWork/agent-work/extreme-capacity/coord-c6ec33ca/tmp`).
- **Locked push:** `python3 .../coord-c6ec33ca/detach.py <log> .../coord-c6ec33ca/coord-push-locked.sh <worktree> <label>`; poll `grep -a -E "lock acquired|PUSH DONE|CAPPED|agent-push\] (FAILED|VERIFIED)" <log>` (and grep the log for the vitest failure marker, a multiplication sign at the start of a test line).
- **Docs push chain:** `sed "s#coord-allin-call-audit181-doc-20261122#<your-worktree-dir>#" .../docs-audit181-chain.sh > <new>.sh`, then detach it (it runs `npm ci` twice, then `agent-push.sh`, then prints `CHAIN_RC=`).
- **PR and merge:** `gh pr create --base main --head <branch> --title ... --body-file ...` (the push helper sometimes opens the PR itself; then `gh pr edit`); `gh pr checks <n>` (single shot); `gh pr view <n> --json mergeStateStatus`; `gh pr merge <n> --squash --match-head-commit <full sha>`.
- **Local source-law run:** `turn5-srclaw.sh` runs `npx vitest run --pool=forks --poolOptions.forks.maxForks=3 $(cat turn5-srclaw-files.txt)` under `nice -n 15`.
- **Inbox append:** a Python snippet that builds the header with `datetime.now(datetime.UTC)`, asserts every character is ASCII, appends to both paths, and ends with `GATE END`.

---

## 14. Verification And Test Results

| Verification           | Method                                                                                      | Result                                                                                                                                                                                                                                                                                  | When          | Follow-up                                           |
| ---------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------- |
| Prior 24 PRs present   | merge-base ancestry vs main, `735299cd5fda`, `c0706e2b3563`, `8d4a7ef726d9`                 | 24/24 in all                                                                                                                                                                                                                                                                            | 02:14 AM      | none                                                |
| Packet 2 live pickup   | telemetry + /health + error log                                                             | 114 changed, 0 errors/faults                                                                                                                                                                                                                                                            | 5:37 PM       | ongoing watch is Horse SWITCH's                     |
| Packet 1 re-activation | Horse SWITCH posts (+18 min: 453 priced, 0 refusals)                                        | clean                                                                                                                                                                                                                                                                                   | 7:43 PM       | **UNVERIFIED by this lane beyond 0 refusals today** |
| #11782                 | CI                                                                                          | green                                                                                                                                                                                                                                                                                   | 4:06 PM       | none                                                |
| #11741                 | pre-push rc=0; CI 44/44                                                                     | green                                                                                                                                                                                                                                                                                   | 6:31 PM       | live after 4 AM seal                                |
| #11791                 | CI at the time                                                                              | green, but later broke a scoreboard test (fixed by #11800)                                                                                                                                                                                                                              | 5:47 PM       | none                                                |
| #11823                 | unit 13/13; neighbouring ops tests 94 (before the last scoping fix); CI                     | green                                                                                                                                                                                                                                                                                   | 11:10 PM      | consolidate with #11832                             |
| #11820 Turn 5          | 107 files / 1,597 tests local; pre-push rc=0; CI 65/65                                      | green                                                                                                                                                                                                                                                                                   | 1:14 AM merge | **install + DB proof + live engine NOT YET**        |
| #11835                 | pre-push (docs readers ran); CI                                                             | green                                                                                                                                                                                                                                                                                   | 1:51 AM       | none                                                |
| Main CI health         | `gh run list --branch main`                                                                 | **Schema Integrity Audit failing on every run since at least 11-22 02:37Z** (ledger anchor 35 days behind, bound 14); **Club Create Certification failing on every run since at least 11-22 10:18 PM CST** (`POST_RESET_CERTIFICATION_CLUB_STATE_REFUSED`); neither caused by this lane | 02:14 AM      | report to their owners (UNKNOWN who)                |
| Not run                | full server suite locally, PG17 evidence script locally, hosted league runs, browser checks | n/a                                                                                                                                                                                                                                                                                     |               | not needed for docs; CI covers PG17                 |

---

## 15. Setbacks, Failed Approaches And Lessons

1. Folder access was denied once by the app classifier; it was granted after Dan explicitly asked. Ask exactly once, with a reason.
2. `nohup cmd &` from the host terminal died when the call returned. Use `detach.py`.
3. Fresh worktrees have no `node_modules`; the first docs push failed. Always `npm ci` both trees.
4. **Turn 5 had always failed `SecondLookIsNotLive`** (48 vs 50 sites). Run the source-pin laws over the changed files locally before a 50-minute locked push.
5. The `holdCannotStarve` flake cost one locked push; a test that fails mid-push dooms the push, so stop it to free the lock.
6. A docs rewording (#11791) broke a parser on main. Keep the literal machine-read phrases.
7. The 60-minute cap nearly cut two pushes (53.7 and 49.2 min). Push when load is low.
8. SSD1 dropped off the bus; the fallback lock worked but split the lanes onto two locks for 30 minutes. Announce lock changes immediately and retire fallbacks as soon as the primary returns.
9. The "Turn 5 first vs jammer first" order flipped three times as the cutover timing changed. Decide from the current cutover post, not the plan.
10. `send_later` calls sometimes failed with "did not run"; retry once. Scheduled check-ins arrive late (up to tens of minutes) and fire into this session only.
11. A V3 fit on production river showdowns mostly measured horses (16 of 8,588 bets were by people) and hurt against a human-like field. Check who generated a training sample before fitting.
12. Two lanes built near-identical person-vs-horse reports (#11823 and #11832) within three hours. Claim work in the inbox before building.

---

## 16. Known Defects And Architectural Holes

| Priority | Defect or hole                                                                                                                                                           | Evidence                               | Impact                                                | Recommended fix                                                                                                                                                           | Status                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| P0       | Turn 5 migration not yet installed                                                                                                                                       | dispatcher `45129670715` in_progress   | Packet 3 and Turn 6 / list-once are blocked           | prove the install after 10:15Z; if it fails, root-fix through a new PR                                                                                                    | open                                       |
| P1       | Two release-workflow bugs skipped the 10 PM and 1 AM cycles                                                                                                              | cutover posts 02:50Z, 03:16Z, 06:35Z   | engine code merged after 7 PM has not reached players | cutover lane: O16 (#11816, merged), O18 (#11829, after the 4 AM seal)                                                                                                     | cutover lane                               |
| P1       | Pre-existing failing main workflows: Schema Integrity Audit (ledger anchor 35 days behind) and Club Create Certification (`POST_RESET_CERTIFICATION_CLUB_STATE_REFUSED`) | `gh run list --branch main`            | red main checks hide new failures                     | find the owners; root-fix                                                                                                                                                 | **UNKNOWN owner, NEXT AGENT MUST INSPECT** |
| P1       | Push pipeline: locked pre-push of any `HorseLogic.ts` change runs ~50-55 min against a 60-min cap; lanes queue 40-70 min each                                            | logs tonight                           | slow delivery, missed cutovers                        | hardening item #2 (unclaimed): let hosted CI own the full related crawl for engine pushes, or split `HorseLogic.ts`                                                       | unclaimed; window ends 8:00 AM CST         |
| P1       | Single-drive failure: SSD1 loss removed the lock, inbox and worktrees; `.git/worktrees` entries were pruned                                                              | 7:12 PM incident                       | lost coordination, stranded worktrees                 | hardening item #3 (unclaimed): automatic SSD2 failover for lock and inbox, refuse `git worktree prune` while a registered tree's drive is missing, alert on SSD UUID loss | unclaimed; window ends 8:00 AM CST         |
| P2       | Duplicate person-vs-horse tools (#11823 per change; #11832 per results with a luck-aware gate)                                                                           | merged 05:10Z and 08:07Z               | confusion, drift                                      | agree with lead-5 on one tool (keep the per-change view as a mode of the other, or link them in docs)                                                                     | open                                       |
| P2       | Flaky `ruleReceiptsAreJournaledWithTheirHand.test.ts` (CI only)                                                                                                          | cutover 05:26Z, HORSE DECISIONS 07:07Z | fails candidates' prequal                             | PLO-OWNER: print `policyGraph.transitions` on failure, then fix                                                                                                           | PLO-OWNER                                  |
| P2       | `HORSE-SWITCH-HANDOFF-PACKETS-20261121.md` not updated with Packet 1 re-activation, Packet 2 live or Packet 3                                                            | archive file unchanged                 | stale record                                          | update it with the Packet 3 post                                                                                                                                          | open                                       |
| P3       | 26 stale local `agent/coord-*` branches in the shared clone                                                                                                              | branch list                            | clutter only                                          | verify each merged or retired via gh, then `git branch -D`                                                                                                                | open                                       |
| P3       | 4 `coord-*-20261117` scratch dirs (360 MB) belong to session `01BNteGYXUmHpokgqTdUPGbx`                                                                                  | pr-body.md lines                       | disk                                                  | leave them; that session owns them                                                                                                                                        | not ours                                   |
| P3       | Coordinator wrapper `ME` string still names `c6ec33ca`                                                                                                                   | `coord-push-locked.sh`                 | owner line misattributes                              | edit `ME=` to your session before use                                                                                                                                     | open                                       |

---

## 17. Security, Secrets And Credentials

- No secrets were printed or stored by this chat.
- The Mac host terminal (`counselors__host_terminal`) has gh, supabase and vercel tokens pre-loaded; this chat used them only through `gh` and `supabase --linked`.
- The Supabase MCP connector reaches project `kuklfnapbkmacvwxktbh`; use SELECT only.
- Never read `.env` or print environment values. No credential exposure suspected.

## 18. Database, Migration And Seed Status

- **Provider:** Supabase Postgres 17 (`kuklfnapbkmacvwxktbh`).
- **This lane's migration:** `20261122181616_horse_option_switch_turn5_antigravity_train.sql`. Merged, queued, not installed. It rewrites the switch-list functions (`fn_ca_horse_option_switch_states` and the list functions it stamps); it writes no switch rows.
- **Expected after install:**
  - `supabase_migrations.schema_migrations` contains `20261122181616`.
  - The `fn_ca_horse_option_switch_states` definition carries stamp `20261122181616` and names `cashDefenceTrimColdCalls` and `plo6FacingBetIsPricedV2`.
  - `plo6FacingBetIsPriced` is in the off-only list.
  - `ca_horse_style_switch` row counts change only through audited writes by other lanes.
- **Rollback:** a migration rollback is never done by hand. A follow-up train would restore Turn 4B lists if ever needed (not expected).
- **No seeds.** Newest installed migration at 02:14 AM: `20261123025756`.

## 19. Current Blockers And Decision Points

1. **Turn 5 install:** blocked by the freeze until 4:15 AM CST (technical, self-resolving). Action: verify.
2. **Packet 3:** blocked until a live engine contains Turn 5 (cutover lane timing; expected the 7:00 AM CST cycle if it certifies on a copy taken after the 10:15Z installs, otherwise 10:00 AM). Action: verify ancestry, then post the packet. Activation is Horse SWITCH's decision.
3. **Hardening #2 and #3:** waiting for owners until 8:00 AM CST (14:00Z). Unclaimed means you build the smallest permanent fix; changing `.husky/pre-push` or the storage policy touches every lane, so post the design first and coordinate with release custody and storage owners. Weakening any required check is not allowed.
4. **Decisions that require Dan:** lifting any owner-held OFF option (section 9).

## 20. Remaining Work

- **Critical:**
  - Turn 5 install proof and receipt.
  - Remove the Turn 5 worktree and branch afterwards.
  - Confirm the 4:00 AM seal includes #11741 and stays healthy.
- **High:**
  - Packet 3 handoff after Turn 5's code is live, with the activation watch including the people-impact report. Then update `cashDefenceTrimColdCalls.md` State per #11828 once Horse SWITCH activates it.
  - Hardening #2 and #3 if unclaimed at 8:00 AM CST.
- **Medium:**
  - Consolidate #11823 with #11832.
  - Update the HORSE-SWITCH-HANDOFF-PACKETS file.
  - Final ledger update.
  - Report the two red main workflows to their owners.
- **Low:**
  - Delete stale local `agent/coord-*` branches after verification.
  - Fix the wrapper `ME` string.
- **Optional:** a per-bettor adaptive PLO6 river range (needs people's own river data); a daily run of `option-people-impact.mjs`.

## 21. Prioritized Next-Phase Execution Plan

**Phase 0: Recover and verify state (now).** Do section 22 steps 1-6.

- Done when health, inboxes, the lock and the dispatcher state are read and nothing regressed.

**Phase 1: 4:00 AM CST seal (~4:10 AM CST / 10:10Z).**

- Read the cutover lane's SEALED post.
- Check that `/health` `horseUpgradeManifest.sourceRevision` is `c0706e2b3563` or `8d4a7ef726d9`.
- Confirm `git merge-base --is-ancestor 3811538b62a8 <sealed>` (#11741 live), 0 stalled, phase ready, recoverableRequestErrors 0, `horse_error_log` 0.
- Post to both inboxes.

**Phase 2: Turn 5 install proof (>= 4:25 AM CST / 10:25Z).**

- `gh run view 45129670715 --json status,conclusion`; find the `Apply Merged Migration 20261122181616...` run (`gh run list --workflow apply-merged-migration.yml --limit 10`).
- Run the read-only SQL in section 18.
- Post "TURN 5 INSTALLED & DB-VERIFIED" to both inboxes (this unblocks HORSE DECISIONS list-once and Turn 6).
- Remove the worktree: `git -C /Users/smarter.poker/Documents/club-arena worktree remove --force /Volumes/SmarterWork/agent-work/extreme-capacity/coord-plo6-harm-lock-20261121`, then delete the local branch.
- If the install failed: read the applier log, root-fix in a new PR (never by hand), and coordinate with the cutover lane before merging.

**Phase 3: Packet 3 (after the cycle carrying Turn 5 seals; expected 7:00 AM CST / 13:00Z).**

- Verify `git merge-base --is-ancestor 67768652003d <sealed>` and that the migration is installed.
- Read #11828's rule (`tests/an-authority-doc-states-the-live-switch.law.test.ts`, `docs/horse-option-switch-state.json`).
- Recompute the doc sha: `git show origin/main:docs/horse-option-authority.d/cashDefenceTrimColdCalls.md | shasum -a 256` (expected `f888c88ea441f6d9691ded85b5226bfa18ef069080c79d416826ec1c2ee9cde3`).
- Post the packet to Horse SWITCH:
  - Evidence note text: `authority: cashDefenceTrimColdCalls docs/horse-option-authority.d/cashDefenceTrimColdCalls.md sha256 <sha>`.
  - Evidence summary: HVH48-D 36 fixed / 3 newly wrong (12:1), HVH48-E 0 changed, 9-max mirror +3.01 z +2.44.
  - Scope: NLH cash cold-call defence inside `gtoDefend72`; `v72DefenceByOpener` must stay ON.
  - Rollback: `horse-option-switch.mjs set cashDefenceTrimColdCalls off --rollback`.
  - Watch: `/health` errors, refusals, `horse_error_log`, and `node scripts/ops/option-people-impact.mjs`.
- After activation: verify pickup (new receipts firing, 0 errors), then update the doc State in a docs PR if #11828 requires it.

**Phase 4: Hardening #2 and #3 (8:00 AM CST / 14:00Z).**

- Read the inbox for claims. If unclaimed, post a design, coordinate with the cutover lane (release custody) and the storage owner, build in a fresh SSD2 worktree, test and merge outside holds.

**Phase 5: Consolidation and records.**

- Agree #11823 vs #11832 with lead-5.
- Update `HORSE-SWITCH-HANDOFF-PACKETS-20261121.md` and both ledgers (cmp 0).
- Delete verified stale branches.
- Report the two red main workflows.

**Phase 6: Report to Dan** in plain English, Central time: "Phase N of X is done".

## 22. Exact First Actions For The Next Agent

1. Get access to the Mac. Request folders `/Users/smarter.poker/Documents`, `/Volumes/SmarterWork/agent-work`, `/Volumes/SmarterArchives/agent-evidence` and `/Volumes/SmarterArchives 1/agent-evidence` if your session needs them. Prefer the `counselors__host_terminal` tool if present.
2. `node /Users/smarter.poker/Documents/agent-policy.mjs read`; `python3 /Users/smarter.poker/Documents/ssd-tools/ssd-paths.py json`.
3. `cat /Volumes/SmarterWork/agent-work/shared-capacity/hs-locks-01UxDLnM4/shepherd.lock/owner`; `diskutil list external` (expect 2 physical disks).
4. Read the last 80 lines of both inboxes (paths in 5.5). Look for: the cutover lane's 4:00 AM SEALED post, HORSE DECISIONS' #11824 / list-once posts, Horse SWITCH's Packet 1 and 2 watch posts, and any claim of hardening #2 or #3.
5. Health check (section 13). Then run the section 18 SQL to see whether `20261122181616` installed.
6. `git -C /Users/smarter.poker/Documents/club-arena fetch -q origin main && git -C /Users/smarter.poker/Documents/club-arena log --oneline -15 origin/main`.
7. Do NOT modify: the shared clone, other lanes' worktrees, the `coord-*-20261117` folders, the switch table, release-control files, or PLO4/5 math core.
8. Resume at Phase 1 or Phase 2 of section 21, depending on the time.
9. Recreate your own scheduled check-ins for Phase 2 (>= 10:25Z), Phase 3 (~13:15Z) and Phase 4 (14:00Z) in YOUR session (this chat's were deleted).

## 23. Acceptance Criteria

- `20261122181616` is present in production `schema_migrations`; the switch-states stamp is `20261122181616` and names both new options; `plo6FacingBetIsPriced` is off-only; `horse_error_log` is 0 since the install.
- The serving engine contains #11741 and #11820 (ancestry proven), with health ok, 0 stalled, recoverableRequestErrors 0.
- The Packet 3 post is in both inboxes with the exact sha256 note and the rollback command. If Horse SWITCH activates it: pickup verified, doc State matches the switch (#11828 law green), and the people-impact report shows no harm signal.
- No `coord-*` worktree of this lane remains; both ledgers cmp 0; the packets file is updated.
- Hardening #2 and #3 are each claimed by an owner or shipped by you (merged, tests green, nothing weakened).
- Dan gets a plain-English Central-time report.

## 24. Recommended Commit Strategy

- One PR per concern; docs-only PRs separate from code.
  - `docs(horses): record cashDefenceTrimColdCalls LIVE ON (audit #<n>) and its pickup` (1 doc; only after activation).
  - `feat(ops): fold option-people-impact into person-vs-horse-results` (only if agreed with lead-5; scripts/ops + tests/unit).
  - Hardening #2 or #3: one PR each, with law tests. Never merge release-control files during holds.
- Before any push touching `server/` or `supabase/`, run the relevant source-pin laws locally (see `turn5-srclaw.sh`), then use the locked wrapper.

## 25. Final Continuation Summary

- **Stopping point:** Turn 5 merged at 1:14 AM CST and waiting in the installer for the 4:15 AM freeze end; #11741 in the 4:00 AM candidates; Packet 1 and Packet 2 live and clean; no open PR or running process in this lane; one worktree left (Turn 5); this chat's scheduled check-ins deleted.
- **Work on first:** the 4:00 AM seal check, then the Turn 5 install proof at or after 4:25 AM CST.
- **Locked requirements:** never write the switch table; no hand installs; no cutover actions; no hole cards; ASCII docs; root-cause fixes only; never claim done until live.
- **Greatest technical risk:** the 7:00 AM cycle not certifying (two cycles have already skipped), which would keep Turn 5's engine code and Packet 3 waiting.
- **Greatest data-integrity risk:** any hand-written migration-ledger row or out-of-window migration merge staling a Backup copy.
- **Visual risk:** none.
- **Needs Dan:** only lifting owner-held OFF options.
- **How to continue:** read sections 5, 10 and 22, run the Phase 1-3 checks in order, and you are exactly where this session stopped, with no rediscovery needed.
