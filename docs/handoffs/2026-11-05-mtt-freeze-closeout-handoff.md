# HANDOFF: MTT freeze sweep, stuck-event close-out, Sunday satellite deadlock (2026-11-05, 15:10 CT)

Written by the Claude session `session_01BbZPDjdLsH8coT5MmccVfg` at 21:11 UTC on 2026-11-05.
Every fact below was read from production, GitHub or the repository at that time unless marked
**UNVERIFIED** or **UNKNOWN, NEXT AGENT MUST INSPECT**.

---

## 1. Executive continuation brief

**What this is.** Club Arena (Smarter.Poker online poker). Dan asked for a deep audit and repair of
MTTs, Spins, Sit & Gos and satellites "so these stop failing, freezing and stalling", then approved
four concrete deliveries:

1. Ship the 50-second no-clock freeze fix (PR #9537).
2. Close out the **nine original horse-only stuck events** under his **Nov 2 ruling**: cancel each
   frozen hand (moving no chips), stop the tables, and retire the event. Chips go to the **Midway
   Main Bank** (Midway Union wallet) and diamond-event proceeds go to **KingFish**. There is **no
   even-split payout**.
3. Clear the stuck engine release (run 42052195767).
4. Fix the **Sunday Deep Stack Satellite 25** freeze (`fbb86b2a-889f-4439-a573-efc0c5ca7064`),
   recover it to normal play (do **NOT** retire it), and monitor one full hourly restart cycle.

**Where it stands.**

| Item                                                                  | State                                                                                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| #9537 50 s freeze fix                                                 | **Confirmed complete.** Merged and live in engine release `71087373d`.                                                                              |
| Stuck release 42052195767                                             | **Confirmed complete.** Cleared; the engine released `71087373d`.                                                                                   |
| PR #9551 DB fix (late-seated chair blocked cancellation)              | **Merged and applied.** It was then **superseded** by another agent's #9554 (see §16).                                                              |
| 8 of 9 stuck events                                                   | **Confirmed complete.** CANCELLED, all tables closed, nobody seated, no open hands, one transfer each (§9).                                         |
| Midnight Free Buy (9th event, `6429087f-a9d1-49a3-b7cf-85e1ee283ac9`) | **Quiesced. Frozen hand cancelled. NOT yet retired.** Retirement is refused by the database guard until the quiet window, **04:00–06:00 CT** (§19). |
| Satellite deadlock fix, PR #9562                                      | **Merged** (squash `2b98f67c40aa4a37f483e64a61b8c736fe0561ac`). **NOT deployed**: its release failed behind another queued release owner (§10).     |
| Sunday Satellite 25                                                   | **Still frozen.** No hand since 19:06:23 UTC on any of its 5 tables. Recovery needs the engine on a release containing `2b98f67c4`.                 |
| Hourly-cycle monitoring                                               | **Not started.** It depends on the deploy above.                                                                                                    |
| Website changes                                                       | None were made for this work. It is engine and database only.                                                                                       |

**The single most important thing.** The production engine is still on `71087373d`, which contains
**neither** #9562 (the satellite fix) **nor** #9557 (another agent's busy-lane retry). Release run
`42099609162` (head `57e0dd5b4`, which contains #9557 but not #9562) currently owns the release slot
and is expected to activate at the **22:00 UTC (16:00 CT)** break. A fresh release containing
`2b98f67c4` must then be staged and published, most likely for the **23:00 UTC** break.

**First action.** Run the Phase 0 commands in §22. Then check whether `42099609162` released at
22:00 and whether a release containing `2b98f67c4` is queued.

---

## 2. User requirements and working preferences (binding)

- Dan, verbatim: "finish all unfinished work associated with these issues and make sure every
  change is fully pushed, merged, deployed, and functional." Reserve "complete" for work that is
  deployed **and verified**.
- Latest message, verbatim: "GET THIS FINISHED, PUSHED AND PUBLISHED AND ARCHIVE THIS CHAT ONCE YOU
  ARE FINISHED WITH ANY AND ALL WORK, AND YOU HAVE VERIFIED ITS ACTUALLY PUSHED AND PUBLISHED."
- Retirement approval covers **only the original nine** events. The Sunday satellite must be
  **recovered to normal operation**. Retiring anything else needs separate authorization.
- Cancellation moves **no chips**. Retirement uses Main Bank / KingFish exactly as the Nov 2 intent
  rows record (`smarter_private.owner_tournament_deletion_intents`). There is **no even split**.
  Retries and overlapping workers must never pay twice.
- Monitoring must cover **at least one normal hourly restart cycle after the final relevant
  deployment**. Anything shorter is preliminary.
- Report in plain English with no SHA soup as the main content. Never ask Dan to do what the agent
  can do, including merging its own PRs. When Dan must unblock something, end the reply with the
  exact line he should send.
- Horses are players (CLAUDE.md 10.5). There are no repair crons or band-aids (10.11 / 10.12).
  Migrations reach production only from protected main (2.11). A probe never commits: use one
  self-aborting `DO` block over MCP (11.5).

## 3. Project and repository identity

- Repository: `Smarter-Software-PIQ/Smarter-Poker-Club-Arena` (GitHub; it reports it "moved" to that
  exact casing, and pushes still work).
- Cloud clone used here: `/home/claude/smarter-poker-club-arena` (ephemeral container). Dan's Mac
  clone: `~/Documents/club-arena` (**do not push from it**; 10.87).
- Branch used: `fix/retained-original-starts-through-unclaimed-move`. It is merged (squash
  `2b98f67c4`) and needs no further work.
- Engine: Node/TypeScript at `server/src`, released by `stage-engine-release.yml` and then
  `auto-deploy-hetzner.yml` to `https://engine.smarter.poker` (Hetzner).
- Database: Supabase project **PokerIQ-Production**, ref `kuklfnapbkmacvwxktbh`, reached through the
  `mcp__remote-devices__supabase__execute_sql` tool on Dan's Mac Studio, which can time out at 60 s.
  Retry read-only queries only.
- `gh` works over REST only. GraphQL is blocked, so `gh pr create`, `gh workflow run` and
  `gh pr merge` fail. Use `gh api` REST endpoints.

## 4. Repository map (only what matters here)

| Path                                                                                                                                                                                                                                      | Why it matters                                                                                       | Changed here                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `server/src/engine/ServerTableEngineDealing.ts` (~4040–4095)                                                                                                                                                                              | Retained-original start: the hand-for-hand park loop and the `retained_original_start_unproven` kill | Yes (#9562)                                                     |
| `server/src/engine/ServerTableEngineBase.ts` (`isNextHandPaused` ~8133, new `isNextHandPausedOnlyByUnclaimedTournamentMove` right after it, move-pause claim ~7890–7930, `isHandForHandReleaseBlocked` ~9285)                             | Pause owners and the move claim                                                                      | Yes (#9562)                                                     |
| `server/src/engine/OriginalControllerRuntime.test.ts`                                                                                                                                                                                     | 4 new regression cases                                                                               | Yes                                                             |
| `server/src/engine/aHandTornDownMidDealIsNotDealt.test.ts`                                                                                                                                                                                | Extracted-code harness stub, which needed the new predicate                                          | Yes                                                             |
| `server/src/engine/TimeBankEngine.ts`, `ServerTableEngineTurns.ts`                                                                                                                                                                        | 50 s freeze fix                                                                                      | Yes (#9537, live)                                               |
| `server/src/tournament/TournamentManagerBase.ts` (~9960–10070)                                                                                                                                                                            | Operator abort boundary, `prepareAcknowledgement`, the cancel RPC                                    | No. It is main's version with #9557's `throughCancellationLane` |
| `server/src/tournament/cancellationLane.ts`                                                                                                                                                                                               | #9557 busy-lane retry (50 × 200 ms)                                                                  | Other agent                                                     |
| `.github/workflows/tournament-original-recovery-control.yml` (workflow id 402961815) + `.github/scripts/tournament-original-recovery-control.mjs`                                                                                         | Operator `equal_*` actions                                                                           | No                                                              |
| `.github/scripts/owner-retirement-control.mjs`                                                                                                                                                                                            | `owner_request/owner_read/owner_ack`                                                                 | No                                                              |
| `supabase/migrations/20261105183850_a_chair_seated_after_a_frozen_hand_does_not_block_its_operat.sql`                                                                                                                                     | My DB fix (#9551)                                                                                    | Yes, merged and applied, then superseded                        |
| `supabase/migrations/20261105184721_late_seats_do_not_count_against_a_stopped_hand_original.sql`                                                                                                                                          | Other agent's #9554, the **current** function body                                                   | Other agent                                                     |
| `supabase/migrations/20261105181406_bulk_closure_stays_out_of_live_play.sql`                                                                                                                                                              | `smarter_private.bulk_closure_admission` guard (quiet hours, break window, cooldown)                 | Other agent                                                     |
| `docs/runbooks/original-tournament-recovery20.md`                                                                                                                                                                                         | Operator runbook for these closures                                                                  | No                                                              |
| `docs/changelog/2026-11-05-a-retained-original-plays-through-an-unclaimed-move.md`                                                                                                                                                        | Changelog for #9562                                                                                  | Yes                                                             |
| `docs/changelog/2026-11-05-a-chair-seated-after-a-frozen-hand-does-not-block-its-cancellation.md`                                                                                                                                         | Changelog for #9551                                                                                  | Yes                                                             |
| `docs/changelog/2026-11-05-a-finished-time-bank-leaves-no-pending-publication.md` + law `server/src/engine/AFinishedTimeBankLeavesNoPendingPublication.law.test.ts` + `docs/laws.d/a-finished-time-bank-leaves-no-pending-publication.md` | #9537                                                                                                | Yes (live)                                                      |
| `tests/unit/aChairSeatedAfterAFrozenHandDoesNotBlockCancellation.test.ts`                                                                                                                                                                 | Pins #9551 pre/post md5                                                                              | Yes; see the risk in §16                                        |

## 5. Applicable instructions

Reread `CLAUDE.md` (esp. 2 production DDL policy rules 8/10/11, 10.5, 10.9, 10.11, 10.12, 11.5 and
13), `AGENTS.md`, `AGENT-PLAYBOOK.md`, `PUBLISHING.md`, `docs/agent-policy/REFERENCE-INDEX.md` and
`docs/runbooks/original-tournament-recovery20.md`. The Phase 1 temporary policy means the engine
resets **hourly** (:58 notice, :00–:05 Chicago). A scheduled hour is **not** proof a reset happened;
verify it through `/health` `releaseSha` and `uptime`.

## 6. Discovery record

**Satellite deadlock (confirmed from rows and code).** The event is `fbb86b2a…`, and the stuck table
is `aed78e3f-850b-4929-bb1d-1503449b41ce` (9 seated). Its next hand, permit 55430351 (state
`reserved`), was privately retained as an F06 "original" (sequence 0, `handStarted:false`). Then the
table balancer's move probe added a `tournamentMovePauseOwners` entry. The two sides deadlocked:

- The move probe claims only when `isBetweenHands()` is true, and that is false while a
  prepared/pending original occupies the table.
- The original refused to start while any next-hand owner existed. The hand-for-hand loop parked it
  at `awaitPauseGate` because `isHandForHandReleaseBlocked()` counts move owners. The start check
  called `killForRestart('retained_original_start_unproven')` because `isNextHandPaused()` counts
  them too.
- The watchdog rebuilt the table (`engine_recovery_events`:
  `tournament_table_zombie:dealing:permit=attempted` at 18:39 and
  `…start_wait_for_players:permit=attempted` at 18:49 UTC). The successor reclaimed the same
  original and met the probe again.
- Since 19:06 UTC **all five** satellite tables have stopped (last hands 19:05:47–19:06:23). The
  likely mechanism is that the others are held behind the stuck balancing. That is **UNVERIFIED by
  engine logs**; this session had no engine log access.

**Cancellation lane starvation (confirmed by sampling).**
`smarter_private.cancellation_lane(uuid)` only `pg_try_advisory_xact_lock`s the global settlement
lock G (`ca:tournament-terminal-settlement:v1`) and the barrier B (`ca:hand-settlement-barrier:v1`).
Live traffic holds them in share mode almost continuously (sampled 74% and 47% of 100 × 50 ms ticks).
A single cancel call is therefore usually refused with `55P03 CANCELLATION_*_BUSY` before any write.
On engine `71087373d` the operator boundary makes one attempt, so `equal_ack` kept returning
`unknown`. Another agent fixed this in #9557 (`throughCancellationLane`, 50 × 200 ms), which is
merged but **not deployed** as of 21:11 UTC.

**Late-seated chair (confirmed).** Midnight's frozen hand on `fe4237f3-af01-4dba-b6f2-e182197d8027`
was captured with 8 chairs, and the balancer later seated a 9th. The cancel function refused any
live chair missing from the capsule. My #9551 narrowed that to chairs seated at or before the capsule
was created. Another agent shipped an equivalent clause (#9554, migration `20261105184721`), applied
after mine, and its body is what production runs now (md5 `b181f331ef7aed2e9ada496b518bb74a`).

**Bulk-closure guard (other agent, live).** `smarter_private.bulk_closure_admission` is the first
statement of `fn_ca_owner_retire_tournament`, `fn_ca_settle_tournament_abort*`,
`fn_ca_operator_cancel_tournament` and `fn_ca_request_tournament_abort`. It refuses with `55P03`
when the call falls in the break window (:53–:07 UTC), during maintenance, in the 180 s after a
thaw, as a large event outside **04:00–06:00 CT**, with `statement_timeout` = 0 or > 8 s, or inside
the 5 s cooldown. **Midnight's retirement is refused with `bulk_closure_large_outside_quiet_hours`**
(rolled-back probe, 21:1x UTC).

## 7. Work completed in this chat

1. **#9537: a finished time bank leaves no pending publication** (merged earlier, live in
   `71087373d`). `TimeBankEngine.playerActed()`/`onTimeBankExpired()` clear `pendingPublication`;
   recovery restores it as false when inactive; `ServerTableEngineTurns` requires
   `pendingBank.pendingPublication`. Pinned by a law test plus a `docs/laws.d` entry.
2. **Stuck release 42052195767 cleared**; the engine restarted to `71087373d`.
3. **8 of 9 stuck events closed and retired** (18:18–18:23 UTC; §9).
4. **#9551** (merged as `5e2d6a233ad345cf6ca86c30b420f58c27e49bc9`). Migration
   `20261105183850_…` was applied through `apply-merged-migration` repository_dispatch (run
   42091619575, success). It was verified at the time: md5 `9ec2ae80…`, service_role-only grants,
   and the `schema_migrations` row exists. It was later superseded by #9554.
5. **Midnight `equal_ack` attempts** (workflow 402961815; runs 42093107104, 42094000825,
   42094328594, 42094564787, 42095243265, 42095482570, 42095739837, 42095969044). All returned
   `unknown` because of the busy lane. Between 21:00 and 21:08 UTC the hand on `fe4237f3` was
   cancelled and the operation became `quiesced`, with no reserved permit and 4 dispositions. Who
   made the final successful cancel is **UNKNOWN, NEXT AGENT MUST INSPECT**: it was possibly one of
   my late acks or another agent's run.
6. **#9562** (merged as `2b98f67c40aa4a37f483e64a61b8c736fe0561ac`):
   - New `ServerTableEngineBase.isNextHandPausedOnlyByUnclaimedTournamentMove()`. It is true only
     when there are move owners, none of them is claimed, and none of admin, floor, maintenance,
     dealing halt, weekly payout, final-table, terminal close-out or hand-for-hand applies.
   - In `ServerTableEngineDealing`, that predicate stops the hand-for-hand loop from parking a
     retained original and stops the unstarted-original kill.
   - Claimed moves and every other owner still park or fence the original. The maintenance-freeze
     refusal, F06 permits and financial boundaries are unchanged.
   - Tests: 4 new cases in `OriginalControllerRuntime.test.ts`; the two positive cases fail on the
     old code. The harness stub was updated in `aHandTornDownMidDealIsNotDealt.test.ts`.
   - My own busy-lane retry was dropped in favour of main's identical #9557.
   - All required checks passed on head `19f0b52c0`. One infrastructure flake (SSL EOF while
     installing Postgres) was re-run and passed.

## 8. Visual decisions

None. No UI was touched.

## 9. Close-out ledger for the nine events (Nov 2 ruling)

Destinations:

- Diamonds go to **KingFish**, profile `47965354-0e56-43ef-931c-ddaab82af765`.
- Chips go to the **Midway Union main bank**: union `fade0000-0000-0000-0000-000000000001`, wallet
  `059bb325-6eeb-4bbd-957d-3a82e755bb0c`.

Uniqueness is enforced by the `owner_retirement_pool_transfers` primary key on `tournament_id`
(one row per event, verified).

| Event        | Name                           | Asset             | Amount                      | Journal                              | Dest before → after             | Event state                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------ | ----------------- | --------------------------- | ------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 928dc47d     | Nightly 10K Satellite 15       | diamonds          | 600.00 (540 prize + 60 fee) | 4f8fc2e0-59b6-4f4a-924d-659ed94a4051 | 2,673,358 → 2,673,958           | CANCELLED, 0 open tables/seats/permits/continuations                                                                                                                                                                                                                   |
| fe9145bb     | Sunday Deep Stack Satellite 25 | diamonds          | 6,100.00                    | abd7a2d9-b51e-46bb-bdbc-2b330d7cc28d | 2,673,958 → 2,680,058           | same                                                                                                                                                                                                                                                                   |
| 0640f029     | Sunday Deep Stack Satellite 30 | chips             | 396.00                      | 04d5e367-c01b-4d93-ad68-5508e1a2c05e | 146,629,967.45 → 146,630,363.45 | same                                                                                                                                                                                                                                                                   |
| 0d98f87e     | Sunday Deep Stack Satellite 30 | diamonds          | 2,400.00                    | 70c8cb3b-ca58-48d5-b56b-cf862007fd63 | 2,680,058 → 2,682,458           | same                                                                                                                                                                                                                                                                   |
| 26ebb662     | Prime Time Satellite 3         | diamonds          | 312.00                      | d549fd6f-1fe6-4d1b-b52e-955d42ce6a9b | 2,682,458 → 2,682,770           | same                                                                                                                                                                                                                                                                   |
| 369d46bd     | Prime Time Satellite 10        | diamonds          | 400.00                      | e7466b5d-0a45-4316-9209-76bf1a4a819c | 2,682,770 → 2,683,170           | same                                                                                                                                                                                                                                                                   |
| 644379fb     | Sunday Deep Stack Satellite 30 | chips             | 426.00                      | 78331a52-1e51-401e-8d55-5fb7abdf6605 | 146,630,363.45 → 146,630,789.45 | same                                                                                                                                                                                                                                                                   |
| eb82f8d7     | Funday PLO5 Satellite 5        | diamonds          | 320.00                      | 0c54adde-4bc2-47f6-9a7f-ddbe9cbcef7e | 2,683,170 → 2,683,490           | same                                                                                                                                                                                                                                                                   |
| **6429087f** | **Midnight Free Buy (NLH)**    | diamonds (intent) | **NOT YET**                 | none                                 | none                            | RUNNING status; operation `d44c4440-2911-430c-8ee7-376611ef3f38` is **quiesced**, money_hash `ce805b135d2fe1e40e5b3a22acd207b1`, generation `f68d3bc8-3761-4f2f-b434-a629d1fd4018`; 5 open tables, 37 seated (all horses), 1,588,000 chips on felt, 0 reserved permits |

Totals moved by the 8: diamonds 10,132.00 to KingFish; chips 822.00 to the Midway main bank. Each
transfer receipt drains the event's prize/fee custody per participant (e.g. 928dc47d: 4 horses ×
135 prize + 15 fee). A distinct operation id `28f18e0d-8342-5972-b75d-639450d43e26` appears on
`0640f029`'s receipt, i.e. it was closed by a different operation; this is **UNKNOWN whether it was
mine or another agent's**, and it is harmless.

## 10. Exact current state (21:11 UTC)

- `https://engine.smarter.poker/health`: `releaseSha` is `71087373d6ce7d1354146dbfe3963731c9b00597`,
  `instanceId` is `1-cb216098` (uptime ~10,600 s, so it started ~18:14 UTC), and maintenance is idle.
  **No hourly restart has happened at 19:00, 20:00 or 21:00 UTC.**
- `auto-deploy-hetzner.yml` runs:
  - `42099609162` (head `57e0dd5b4`) is **in_progress** and owns the runtime release slot; it
    contains #9557 but not #9562.
  - `42105230945` (head `2b98f67c4`, mine) **failed** at 21:03 with
    `fresh scheduled release cannot compete with active runtime owner 42099609162-1`.
  - `42103535706` (`2433d2cb7`, another agent) failed for the same reason.
- `stage-engine-release.yml`: every push to main stages successfully. Its next announcement
  (`nextAnnouncementAt`) is 21:58 UTC, for the 22:00 break.
- Database: production function `fn_ca_cancel_tournament_abort_unsettled_hand` md5 is `b181f331…`
  (#9554). Both `20261105183850` (mine) and `20261105184721` are in `schema_migrations`.
- Local clone: clean, on the merged branch, nothing unpushed. This handoff file is added on a docs
  branch (§24).

## 11. Changed-file ledger

| File                                                                             | Status       | Purpose                      | Verified                | Committed        |
| -------------------------------------------------------------------------------- | ------------ | ---------------------------- | ----------------------- | ---------------- |
| server/src/engine/ServerTableEngineBase.ts                                       | modified     | new unclaimed-move predicate | tsc + tests + CI        | main `2b98f67c4` |
| server/src/engine/ServerTableEngineDealing.ts                                    | modified     | park/kill exemption          | same                    | same             |
| server/src/engine/OriginalControllerRuntime.test.ts                              | modified     | 4 regression cases           | pass                    | same             |
| server/src/engine/aHandTornDownMidDealIsNotDealt.test.ts                         | modified     | harness stub                 | pass                    | same             |
| docs/changelog/2026-11-05-a-retained-original-plays-through-an-unclaimed-move.md | new          | changelog                    | n/a                     | same             |
| supabase/migrations/20261105183850\_…sql                                         | new          | late-chair cancel fix        | applied; now superseded | `5e2d6a233`      |
| tests/unit/aChairSeatedAfterAFrozenHandDoesNotBlockCancellation.test.ts          | new          | pins migration file          | pass                    | `5e2d6a233`      |
| docs/changelog/2026-11-05-a-chair-seated-after-…md                               | new          | changelog                    | n/a                     | `5e2d6a233`      |
| TimeBankEngine.ts, ServerTableEngineTurns.ts, law test, laws.d, changelog        | modified/new | 50 s freeze                  | live                    | #9537            |
| docs/handoffs/2026-11-05-mtt-freeze-closeout-handoff.md                          | new          | this document                | n/a                     | docs PR (§24)    |

## 12. Asset ledger

None.

## 13. Commands that matter (all from the repo root)

```bash
curl -s https://engine.smarter.poker/health | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['releaseSha'],d['instanceId'],d['uptime'],d['maintenance'].get('phase'))"
gh api "repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/workflows/auto-deploy-hetzner.yml/runs?per_page=5" --jq '.workflow_runs[]|"\(.id) \(.status) \(.conclusion) \(.created_at) \(.head_sha[0:9])"'
gh api "repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/workflows/stage-engine-release.yml/runs?per_page=5" --jq '.workflow_runs[]|"\(.id) \(.event) \(.status) \(.conclusion) \(.head_sha[0:9])"'
git fetch origin main && git merge-base --is-ancestor 2b98f67c4 <releaseSha> && echo contains-satellite-fix
# Apply a merged migration (REST door, cloud agents):
gh api -X POST repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/dispatches -f event_type=apply-merged-migration -f 'client_payload[migration]=<file>.sql'
# Operator control (REST; gh workflow run is blocked):
gh api -X POST repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/workflows/402961815/dispatches -f ref=main -f 'inputs[action]=equal_read' -f 'inputs[tournament_id]=6429087f-a9d1-49a3-b7cf-85e1ee283ac9' -f 'inputs[nonce]=a1cc0643-0af5-46e0-ba09-fa36ceaf3ea1' -f 'inputs[expected_engine_sha]=<current releaseSha>' -f 'inputs[expected_instance]=<current instanceId>' -f 'inputs[expected_generation]=<current lease generation>'
```

The receipt is the artifact whose name does **not** contain "intent"
(`gh run download <id> -D <dir>`, then read `receipt.json`).

## 14. Verification results

| Verification                   | Method                                                                                                                                                                                                                      | Result                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| #9562 typecheck                | `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p server`                                                                                                                                                         | pass                                                |
| #9562 targeted tests           | vitest OriginalControllerRuntime / aHandTornDownMidDealIsNotDealt / TournamentAbortOwnership / PrePermitPauseGate / MustMoveRestartBoundary / SeatMovePartialBatch / pause law / MaintenanceBreak / tournamentRakeAndBreaks | all pass                                            |
| Regression proof               | the new positive tests fail with the Dealing change reverted                                                                                                                                                                | confirmed                                           |
| Full local engine suite        | `npx vitest run src/engine`                                                                                                                                                                                                 | timed out at 25 min (exit 124); CI is the authority |
| #9562 CI                       | all required checks on `19f0b52c0`                                                                                                                                                                                          | green                                               |
| #9551 migration live           | md5 + grants + `schema_migrations`                                                                                                                                                                                          | verified, later superseded                          |
| Midnight cancel accepted by DB | rolled-back DO probe                                                                                                                                                                                                        | `aborted_unsettled`, stacks unchanged (86,028)      |
| Midnight retirement            | rolled-back DO probe                                                                                                                                                                                                        | refused `bulk_closure_large_outside_quiet_hours`    |
| 8 events terminal + ledger     | SQL                                                                                                                                                                                                                         | verified (§9)                                       |
| Satellite recovered            | n/a                                                                                                                                                                                                                         | **NOT DONE**: fix not deployed                      |
| Hourly cycle monitoring        | n/a                                                                                                                                                                                                                         | **NOT DONE**                                        |

## 15. Setbacks and lessons

- The MCP Supabase bridge on the Mac times out at 60 s now and then. Retry only read-only queries.
- `gh` GraphQL is blocked, so use REST for PR create, merge and workflow dispatch.
- Two other agents worked the same incident in parallel: #9554 duplicated #9551 and #9557
  duplicated my lane retry. **Check `git log origin/main` for today's closure work before writing
  anything.**
- Release slots serialize. A merge while another run owns the slot does **not** deploy; the newer
  run fails with "cannot compete with active runtime owner". Re-stage after the owner finishes.
- Midnight's `equal_ack` outcome `unknown` was the busy lane, not a refusal of the approach.
- Retirement of large events only runs 04:00–06:00 CT (guard), outside minutes :53–:07 UTC, with
  `statement_timeout` ≤ 8 s.

## 16. Known defects and holes

| Priority | Item                                                                                                    | Evidence                 | Fix                                                                                                                                                                                  | Status                               |
| -------- | ------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| P0       | Satellite 25 frozen (5 tables, 39 players)                                                              | no hands since 19:06 UTC | deploy a release containing `2b98f67c4`, then verify dealing and balancing                                                                                                           | fix merged, not deployed             |
| P0       | Engine has not restarted since ~18:14 UTC despite the hourly policy                                     | `/health` uptime         | inspect `42099609162`; expected to activate at 22:00 UTC                                                                                                                             | watch                                |
| P1       | Midnight retirement pending                                                                             | guard refusal            | run `fn_ca_owner_retire_tournament` in the 04:00–06:00 CT window (§21)                                                                                                               | blocked by time                      |
| P1       | `20261105183850` carries a `-- @live-proof` md5 `9ec2ae80…`, but production now has `b181f331…` (#9554) | SQL                      | if `check-migrations-are-live` / `an-installed-migration-and-its-file-agree` flags it, coordinate with the #9554 owner (session `01BbZPDjekhnLkPi4peu7Maz`); do **not** reapply mine | **UNKNOWN, NEXT AGENT MUST INSPECT** |
| P2       | Recurring `tournament_table_zombie:parked_for_pause` kills (hundreds on Nov 4)                          | `engine_recovery_events` | likely the same move/original class; re-measure after #9562                                                                                                                          | open                                 |
| P2       | Engine RSS ~8.2 GB vs 8 GB ceiling (observe mode)                                                       | `/health` memory         | separate investigation                                                                                                                                                               | open                                 |

## 17. Secrets

Names only: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (GitHub Actions secrets used by the
control workflows and the engine), and the GitHub token used by `gh` in the cloud session. No secret
was printed or read.

## 18. Database

- Applied today by this session: `20261105183850` only.
- Tables touched by reads: `smarter_private.f06_hand_permits`, `hand_continuations`,
  `hand_continuation_dispositions`, `tournament_abort_hand_dispositions`,
  `tournament_abort_boundaries`, `owner_tournament_deletion_intents`,
  `owner_retirement_pool_transfers`, `public.engine_tournament_leases`, `engine_recovery_events`,
  `tables`, `table_seats`, `hand_history`, `union_wallets`.
- No DDL probes were run. All probes were self-aborting `DO` blocks.

## 19. Blockers and decision points

1. **Satellite recovery depends on the release pipeline.** This is technical, with no user decision
   needed. Wait for owner run `42099609162` to finish, then make sure a release for current main
   (which contains `2b98f67c4`) stages and publishes. If no push lands to trigger staging, dispatch
   `stage-engine-release.yml` or `auto-deploy-hetzner.yml` per `PUBLISHING.md` with the exact
   current-main SHA. Never force, and never run a second publisher.
2. **Midnight retirement is time-gated** to 04:00–06:00 CT on 2026-11-06. Dan already approved it,
   so no new authority is needed.

## 20. Remaining work

- **Critical:**
  - Get `2b98f67c4` live and verify `/health` contains it.
  - Verify the satellite's 5 tables deal and the balancer moves players (new `hand_history` rows,
    permit 55430351 resolved, no `retained_original_start_unproven` / zombie kills).
  - If the satellite does not self-recover after the deploy, use the supported recovery
    (`tournament-original-recovery-control` `prepare`/`read` per the runbook). **Do not retire it.**
- **High:**
  - Retire Midnight in the quiet window.
  - Verify its transfer row, journal, KingFish before/after, CANCELLED status, closed tables,
    0 seated, no permits or continuations.
- **High:** monitor one full hourly restart after the final deploy. Report the window, active tables
  dealing, stall counts (`/health` `stalledTableCount`, `tableLivenessSummary`) and 50 s freeze
  absence (`nextHandGap.maxMs`, no turn > 50 s without a clock).
- **Medium:** resolve the live-proof mismatch question (§16) and re-measure zombie kill rates.
- **Low:** memory ceiling investigation.

## 21. Execution plan

- **Phase 0, recover state.** Run the §13 health and deploy queries. Determine whether `22:00 UTC`
  activated `57e0dd5b4`, and whether any later run targets a SHA containing `2b98f67c4`.
- **Phase 1, ship the satellite fix.** If no run is pending, trigger the release for exact current
  main through the supported route (`PUBLISHING.md`, `.claude/skills/deploy-hetzner/SKILL.md`). It
  activates at the next :00 CT break. Done when `/health.releaseSha` contains `2b98f67c4`.
- **Phase 2, verify satellite recovery.** Within 10 min after activation, check:
  - hands on all `fbb86b2a` tables;
  - aed78e3f dealing;
  - the permit 55430351 state (accepted or terminated);
  - seat moves happening;
  - no new `engine_recovery_events` for its tables.
- **Phase 3, Midnight retirement (04:00–06:00 CT, not in minutes :53–:07 UTC).**
  1. Re-read `fn_ca_tournament_abort_stop_state('d44c4440-…','6429087f-…')` under service_role, with
     data actor `tournament-manager`, the tournament id and the lease generation. It must be
     `quiesced`, and you need the current `money_hash`.
  2. Probe `fn_ca_owner_retire_tournament(op, t, money_hash)` in a self-aborting DO block with
     `statement_timeout` 8 s.
  3. If the probe says ok, call it for real, once.
  4. Verify the `owner_retirement_pool_transfers` row (asset diamonds, destination KingFish),
     CANCELLED status, closed tables and 0 seated.
  5. Expect possible `cooldown` / `lock` refusals (55P03). They are write-free, so retry spaced by
     more than 5 s.
- **Phase 4, monitoring.** Watch one full hourly cycle after the final deploy and record the
  evidence.
- **Phase 5, report** to Dan in plain English, ending with any line he must send.

## 22. Exact first actions

1. `cd` to a fresh clone of `Smarter-Software-PIQ/Smarter-Poker-Club-Arena`, then
   `git fetch origin main`.
2. Read `CLAUDE.md` §13 and §2, `PUBLISHING.md`, `docs/runbooks/original-tournament-recovery20.md`
   and this file.
3. Run the two §13 health and deploy queries.
4. Run `git log origin/main --since="12 hours ago" --oneline | grep -i "tourn\|closure\|release"` to
   see what other agents shipped.
5. Do **not** reapply any migration and do **not** touch Midnight money outside the quiet window.
6. Resume at Phase 1.

## 23. Acceptance criteria

- `/health.releaseSha` is a main SHA containing both `2b98f67c4` and `385ce4c9e`.
- Sunday Satellite 25 has new hands on every open table, balancing moves complete, and there is no
  table without a hand for more than 5 min while seated.
- Midnight is CANCELLED with exactly one transfer row (diamonds, KingFish), closed tables, 0 seated
  and no reserved permits.
- All nine events are verified as in §9.
- One full hourly restart after the final deploy is observed: the engine restarted (new instanceId),
  `stalledTableCount` is 0, and there are no 50 s no-clock freezes.

## 24. Commit strategy

This handoff is committed on branch `docs/handoff-2026-11-05-mtt-closeout` as a docs-only PR. No
other uncommitted work exists.

## 25. Final summary

**Stopping point.**

- Code is all merged.
- The satellite fix is waiting for a release slot.
- Midnight is quiesced and waiting for the 04:00 CT quiet window to retire.
- Eight of nine events are fully closed and verified.

**First:** get `2b98f67c4` released, then verify the satellite deals.

**Locked:** retire only the original nine, recover (never retire) the satellite, no even split, and
no double payment.

**Biggest technical risk:** the release queue stalling again behind a slot owner. **Biggest data
risk:** running Midnight's retirement twice or outside the guard. The primary key prevents a
duplicate, and the guard refuses unsafe timing.

No user decision is required. Continue from §21 Phase 0 without re-running discovery.
