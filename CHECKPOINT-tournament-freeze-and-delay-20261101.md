# Tournament Freezes, Crashes & Inter-Hand Delay Root-Cause Fix — 2026-11-01

## Scope & Authorization

- **Assignment**: Audit and fix at the root cause all MTT, Spin, SNG, and Satellite crashes/freezes from the last week (`2026-10-25` to `2026-11-01`) and eliminate the extra delay between hands.
- **Exclusions**: No tournament start holds (Owner Policy Oct 31, 2026). No crons, watchdogs, or background repair loops (`AGENT-HARDENING-STANDARD.md`).
- **Owned Worktree**: `/Volumes/SmarterWork/agent-work/shared-capacity/tournament-freeze-and-delay-fix/club-arena`
- **Branch**: `fix/tournament-freezes-and-interhand-delay-20261101`
- **Candidate Commit**: `109a5c156fe30929bba2d953bcf0ab06e8e46715`
- **Pull Request**: `https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pull/9183` (**MERGED** into `main` as `c0895aeb93f468c0613867fa662470787a715f97` at `2026-11-01T19:09:19Z` after all 35 CI jobs in run `41337265400` and all 8 auxiliary workflows completed `SUCCESS`)
- **Operation Owner**: Conversation `4a41c574-f384-4cb7-98a3-baf3285df051`

## Policy Reading Receipt

- Emitted at: `2026-11-01T23:01:58.162Z` (previous: `2026-11-01T22:58:04.704Z`, `2026-11-01T22:46:30.572Z`, `2026-11-01T22:40:26.056Z`, `2026-11-01T22:36:08.915Z`, `2026-11-01T22:25:12.075Z`, `2026-11-01T22:13:51.662Z`, `2026-11-01T22:01:45.568Z`, `2026-11-01T21:46:32.963Z`, `2026-11-01T21:33:36.371Z`, `2026-11-01T21:25:51.222Z`, `2026-11-01T21:21:51.091Z`, `2026-11-01T21:09:50.155Z`, `2026-11-01T20:37:25.374Z`, `2026-11-01T20:19:48.346Z`, `2026-11-01T20:12:58.632Z`, `2026-11-01T20:02:30.648Z`, `2026-11-01T19:56:17.392Z`, `2026-11-01T19:37:34.611Z`, `2026-11-01T19:26:17.351Z`, `2026-11-01T19:20:53.160Z`, `2026-11-01T19:12:51.395Z`, `2026-11-01T18:50:28.750Z`, `2026-11-01T18:45:25.669Z`, `2026-11-01T18:41:33.350Z`, `2026-11-01T18:28:52.295Z`)
- `policyVersion`: `2.9`
- `manifestSHA256`: `7c7f308e580f0e2b9170085bb3a454c89ff7234627570c74ab68f5e7846b5b52`
- `OWNER-POLICY.md`: `73c17bed0bc531031283fa33c0b45d4546869166beef9d714bcfe76cfcdb9fdb`
- `OPERATING-LAW.md`: `a8bc3c04dce3354ebdd51a89c0b7d715af3344edcc794d33f6b3ad64506961d5`
- `HARDENING.md`: `d5fc451ce5caf6d6b5e64597a13883e1246581678fe53c962339d0a66136993e`
- `REFERENCE-INDEX.md`: `adce89c3f838f2f373cd504a00329d53906404d1dd42a647f672af6c16f95555`
- Storage verified: `/Volumes/SmarterWork` mounted (`/dev/disk5s4`, 79 GiB available), `/Volumes/SmarterWork/agent-work/shared-capacity` mounted (`/dev/disk5s1`, 700 GiB available), `/Volumes/SmarterArchives` mounted (`/dev/disk5s3`, 46 GiB available).
- Adopted handoff read completely: `/Volumes/SmarterArchives/agent-evidence/tournament-audit-01a193b0/HANDOFF-PROMPT-20261101T1833Z.md` (lines 1–2289, SHA256 `0d94e522b3955699d203b8d69ecb6a47a60ca723547b6910bb5640d0989a1e19`).

## Root Causes & Fixes

1. **Root Cause #1 (`tournament_table_zombie:parked_for_pause:permit=attempted` — 24,504 recovery events; 70+ SNGs and 30+ Satellites frozen)**:
   - `ServerTableEngineBase.ts` (`start()` wait loop): Guarded the `parked_for_pause` gate (`await this.awaitPauseGate()`) and `passOperatorFloorBoundary()` with `!this.pendingOriginalContinuation` so an engine starting with an unfinished retained original hand loads `this.seatedPlayers` and breaks into `dealingLoop()` -> `resumeOriginalController()` instead of parking before loading seats.
   - `ServerTableEngineBase.ts` (`parkForTerminalCloseout`): Accepted `(this.isBetweenHands() || this.isPreparedOriginalParkedForSuccessor())` so a durably prepared `sequence = 0` (`handStarted === false`) original parked at the pause gate satisfies `parkForTerminalCloseout`.
2. **Root Cause #2 (`stalled_no_seat` / missing turn clock after continuation replay — 4,221 recovery events)**:
   - `ServerTableEngineDealing.ts` (`runOriginalController`) & `HandContinuationLane.ts`: Deferred `new HandContinuationLane(...)` construction into `openHandContinuation()` after `this.pendingOriginalContinuation = null`, `persistenceGeneration`, and `controllerForHand.onEvent` are wired, and invoked `if (!this.isUnretained()) await this.retainedInputReady?.();` immediately after `this.replayingOriginal = false` in `HandContinuationLane.ts` so `TURN_CHANGE` deferred into `retainedTurnActivation` during `initialReplay` always activates its turn clock and broadcasts readiness as soon as `initialReplay` finishes.
3. **Root Cause #3 (`ServerTableEngine.street_integrity_violation` where `drift === pot` at `stage: 'showdown'` — 216 critical financial alerts)**:
   - `ServerTableEngineDealing.ts` (`captureStreetIntegrityEvent`) & `ServerTableEngineHandEvents.ts` (`verifyStreetIntegrity`): When a `COMMUNITY_CARDS` event is measured or verified after synchronous runout completion has already distributed `state.pot` into `player.stack`s (`live.stage === 'showdown'`), verify with `phase: 'hand_complete'` and `initialChipTotal: expectedTotal - rakeTaken` so the already-distributed pot is not double-counted.
4. **Root Cause #4 (Inter-hand delay — 1,400ms duplicate showdown wait before `HAND_COMPLETE` on every retained/tournament hand)**:
   - `ServerTableEngineDealing.ts` (`dispatchOriginalEvent`): Changed `if (original) await handled;` to `if (original && event.type !== 'WINNERS') await handled;` so `HandContinuationLane` does not block `HAND_COMPLETE` dispatch, DB stack settlement, and `post_hand_hold` behind `WINNERS`'s 1,400ms `showdownSettleMs` sleep (which `post_hand_hold` already budgets via `SHOWDOWN_READ_BASE_MS = 1,400ms`).
5. **Root Cause #5A (`TournamentManagerBase.ts` — `requestSuccessorDrain`, `handUnprovedOriginalToSuccessorGeneration`, and `performManagedTableEngineRecovery` wedged successor drain on multi-table MTTs such as `Sunday 200 Deep Stack`)**:
   - When `this.successorDrainRequested` is already `true` (armed earlier when one table's `attempted` permit could not be resolved in-process), `requestSuccessorDrain()` re-applies `pauseAfterHand(undefined, { beforeNextHand: true, untilResumed: true })` to running tables, re-evaluates `this.completeSuccessorDrain()`, and returns `!alreadyRequested` (preserving the single handoff allowance contract).
   - `handUnprovedOriginalToSuccessorGeneration()` returns `this.successorDrainRequested` after calling `this.requestSuccessorDrain()` so a second table hitting an unproved `attempted` permit while `successorDrainRequested` is already `true` does not fall through to futile 15s `scheduleManagedTableEngineRecovery` loops.
   - `performManagedTableEngineRecovery()` checks `if (this.successorDrainRequested && this.completeSuccessorDrain()) return;` after `await engine.stop()`, `await this.recoverStoppedOriginalAdmission(tableId, engine)`, and `await this.resolveTournamentSeatMoveQuarantine(tableId, engine)` so stopping the last blocking running table immediately completes the successor drain instead of stranding the remaining parked tables for 10+ minutes.
6. **Root Cause #5B (`ServerTableEngineBase.ts` — `notifyParkedPauseReadyIfDrained` & `pauseAfterHand(untilResumed)` on already-parked tables)**:
   - Added `notifyParkedPauseReadyIfDrained()` to re-notify `boundaryPauseWaiters` and `offerExistingPauseReadyEdge()` whenever a table is already parked at `awaitPauseGate()` (`this.handForHandResolve !== null`) and either `pauseAfterHand(..., { untilResumed: true })` upgrades the parked table or an in-flight writer (`settlementInFlight`, `postHandTasksPromise`, `readContinuationTasks`, `tournamentMoveOperations`, `weeklyPayoutOriginalWork`, `timeBankAccountingPending`, `timeBankAccountingUnconfirmed`, `snapshotFlushPromise`, `entryHoldWriteChains`) finishes so `hasWeeklyPayoutMutationInFlight()` transitions to `false`.
7. **Root Cause #7 (`ServerTableEngineSettlement.ts` — `postHandTasks` clobbering `loopPhase` to `'settlement_post_commit_obligations'` after `dealingLoop` has already parked or entered `post_hand_hold`)**:
   - Restored `this.loopPhase` after `finishObligationsTiming(...)` to `'parked_for_pause'` if `this.handForHandResolve !== null` or to `phaseBeforeObligations` otherwise.

## Local Precheck Results

- `cd server && npx tsc --noEmit`: Passed (0 errors).
- Server Vitest suites (`TerminalCloseoutBoundary.test.ts`, `OriginalControllerRuntime.test.ts`, `FreshPreparedOriginalCustody.test.ts`, `StreetIntegrityEventTime.test.ts`, `PreparedOriginalSuccessorDrain.test.ts`, `TerminalWinnerSequence.test.ts`, `FinalTableDealBetweenHands.guard.test.ts`, `aPauseAManagerArmedIsAPauseItGivesBack.law.test.ts`, `LeaveVacatesInRealTime.law.test.ts`): 135 passed (0 failed).
- Root source-contract Vitest suites (45 test files, 1,116 tests): 45 passed (0 failed).
- Full server Vitest pre-push suite (340 test files): 339 passed, 1 skipped (4,589 tests passed, 0 failed).
- Pre-push policy preflight report: `/Users/smarter.poker/Documents/club-arena/.git/worktrees/club-arena/agent-policy-preflight.json` (`passed`).

## Adopted Audit Handoff (`01a193b0-a5bb-7f61-af41-efded60127f2`) & Coordination State

- **Adopted Handoff Record**: `/Volumes/SmarterArchives/agent-evidence/tournament-audit-01a193b0/HANDOFF-PROMPT-20261101T1833Z.md` and `/Volumes/SmarterWork/agent-work/shared-capacity/tournament-audit-01a193b0/creation-status-race/docs/changelog/2026-10-31-independent-four-format-audit.md` (all 998 lines read).
- **Separate Engine Runtime & Window-Migration Owner**: Chat `01a190a0-8fe0-7ef0-9fe5-6c4eb3b7e40f` (`/Volumes/SmarterArchives/agent-evidence/consolidation-01a190a0/CHECKPOINT.md`), owning engine release staging/activation (`auto-deploy-hetzner.yml` run `41349091113` on `3e3c6d4752cd587fad0db521ebd262f1b485514c`, which contains our merged PR #9183 commit `c0895aeb93f468c0613867fa662470787a715f97`, currently in job `124980135938` step `Dispatch the staged SHA through the durable Hetzner intake` waiting for the reserved `22:00:00Z` Phase 1 cycle) and the two window migrations `20261101004247` + `20261101005048` (`owner_window_id: 2026-11-01-two-migration-database-continuation` merged in PR #9198 as `f661351121f2a662c03cc2ca95f7fc4ee46ed879`).
- **Fresh Production DB Verification (`2026-11-01T21:27:44Z`)**:
  - `supabase_migrations.schema_migrations` for `20261101004247`, `20261101005048`, `20261101174851`: `[]` (none installed yet).
  - Fixed 170 cohort: all 115 unfinished tournaments remain `RUNNING` (0 additional natural completions since `17:58:29Z`; 55 completed tournaments remain excluded and never repaid).
  - `smarter_private.tournament_abort_targets`: 89 rows under `d44c4440-2911-430c-8ee7-376611ef3f38` (`stop_requested`); 26 remaining events have precomputed UUIDv5 operation IDs in `/Volumes/SmarterArchives/agent-evidence/tournament-audit-01a193b0/equal-share-private-preparation-20261101T172945Z/manifest.json`.
  - `public.tournament_cancellation_receipts`: 0 `receipt_version = 4` (`started_operator_equal_share`) rows.
  - Pre-split disjoint swarm manifests (`other26_b1..5.json` and `all115_b1..10.json`) and `run_control_step.py` prepared under `/Volumes/SmarterWork/agent-work/shared-capacity/tournament-freeze-and-delay-fix/swarm-batches/`.
- **Ordered Remaining Execution Steps**:
  1. [DONE] Wait for PR #9175 (`031c9dbb2403975f81aab821fa955004ee1762c9`) and PR #9183 (`109a5c156fe30929bba2d953bcf0ab06e8e46715`) required CI checks to complete and complete protected squash merge of PR #9183 (`c0895aeb93f468c0613867fa662470787a715f97` at `2026-11-01T19:09:19Z`).
  2. Track `01a190a0` PR #9191 / PR #9192 merge, installation of `20261101004247` + `20261101005048`, and engine cutover without competing.
  3. Immediately after `20261101004247` is verified installed (`fn_ca_settle_tournament_abort_equal_share` MD5 `b88bcee008774d5e9eab175bc87d3b04`), dispatch `apply-merged-migration` for `20261101174851_equal_share_retirement_preserves_preactivation_mystery_bount.sql` and verify postimage MD5 `ef3c8122a5fccc4f90630c1672080240`.
  4. Once the corrected engine and all three migrations are active, execute the canonical per-event equal-share settlement and runtime retirement sequence for the 115 unfinished cohort tournaments (`equal_request` for the 26 -> `equal_ack` -> `equal_read` -> private SQL query + `review_allocation.py` -> `equal_preview` -> `equal_settle` -> v4 receipt readback -> final `equal_ack` runtime retirement).
  5. Run the justified `tournament_only: true` post-deploy live verification and clean up owned worktree/scratch.
