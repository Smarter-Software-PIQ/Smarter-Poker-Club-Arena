# Tournament Freezes, Crashes & Inter-Hand Delay Root-Cause Fix — 2026-11-01

## Scope & Authorization

- **Assignment**: Audit and fix at the root cause all MTT, Spin, SNG, and Satellite crashes/freezes from the last week (`2026-10-25` to `2026-11-01`) and eliminate the extra delay between hands.
- **Exclusions**: No tournament start holds (Owner Policy Oct 31, 2026). No crons, watchdogs, or background repair loops (`AGENT-HARDENING-STANDARD.md`).
- **Owned Worktree**: `/Volumes/SmarterWork/agent-work/shared-capacity/tournament-freeze-and-delay-fix/club-arena`
- **Branch**: `fix/tournament-freezes-and-interhand-delay-20261101`
- **Operation Owner**: Conversation `4a41c574-f384-4cb7-98a3-baf3285df051`

## Policy Reading Receipt

- Emitted at: `2026-11-01T18:28:52.295Z`
- `policyVersion`: `2.9`
- `manifestSHA256`: `7c7f308e580f0e2b9170085bb3a454c89ff7234627570c74ab68f5e7846b5b52`
- `OWNER-POLICY.md`: `73c17bed0bc531031283fa33c0b45d4546869166beef9d714bcfe76cfcdb9fdb`
- `OPERATING-LAW.md`: `a8bc3c04dce3354ebdd51a89c0b7d715af3344edcc794d33f6b3ad64506961d5`
- `HARDENING.md`: `d5fc451ce5caf6d6b5e64597a13883e1246581678fe53c962339d0a66136993e`
- `REFERENCE-INDEX.md`: `adce89c3f838f2f373cd504a00329d53906404d1dd42a647f672af6c16f95555`
- Storage verified: `/Volumes/SmarterWork` mounted (`/dev/disk5s4`, 79 GiB available).

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

## Local Precheck Results

- `cd server && npx tsc --noEmit`: Passed (0 errors).
- Server Vitest suites (`TerminalCloseoutBoundary.test.ts`, `OriginalControllerRuntime.test.ts`, `FreshPreparedOriginalCustody.test.ts`, `StreetIntegrityEventTime.test.ts`, `PreparedOriginalSuccessorDrain.test.ts`, `TerminalWinnerSequence.test.ts`, `FinalTableDealBetweenHands.guard.test.ts`, `aPauseAManagerArmedIsAPauseItGivesBack.law.test.ts`, `LeaveVacatesInRealTime.law.test.ts`): 135 passed (0 failed).
- Root source-contract Vitest suites (45 test files, 1,116 tests): 45 passed (0 failed).
