/**
 * PERMANENT ANTI-REGRESSION & CI-PARITY LAWS FOR HAND-GAP PERFORMANCE
 * (incident 1e532243, Phases 1–3).
 *
 * Pins every structural invariant that eliminated between-hands delay,
 * bulkhead queue starvation, sticky throttling, redundant brain-context /
 * pending-addon RTTs, lock-retry stampedes, and prequalification RNG flakes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EVENT_DB_HEALTHY_RECOVERY_MS,
  EVENT_DB_HIGH_PRIORITY_RPCS,
  EVENT_DB_IDLE_RESET_MS,
} from '../services/supabase/eventDatabaseBulkhead.js';
import { sliceMethod } from '../testHelpers/sourceWindow.js';

const SERVER_ROOT = process.cwd();
const REPO_ROOT = join(SERVER_ROOT, '..');
const readServer = (rel: string): string => readFileSync(join(SERVER_ROOT, rel), 'utf8');
const readRepo = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

describe('hand-gap performance & anti-regression laws (1e532243)', () => {
  it('keeps EventDatabaseBulkhead recovery bounded, critical boundary RPCs high-priority, and client.ts wired to priority overrides', () => {
    expect(EVENT_DB_HEALTHY_RECOVERY_MS).toBeGreaterThan(0);
    expect(EVENT_DB_HEALTHY_RECOVERY_MS).toBeLessThanOrEqual(60_000);
    expect(EVENT_DB_IDLE_RESET_MS).toBeGreaterThanOrEqual(EVENT_DB_HEALTHY_RECOVERY_MS);
    expect(EVENT_DB_IDLE_RESET_MS).toBeLessThanOrEqual(180_000);

    for (const rpc of [
      'fn_f06_allocate_hand_number',
      'fn_f06_begin_hand',
      'fn_f06_retain_hand_continuation',
      'fn_f06_claim_hand_continuation',
      'fn_f06_finish_hand',
      'fn_next_hand_number',
      'fn_time_bank_allowance_v2',
      'fn_time_bank_allowance',
      'fn_consume_time_bank',
      'fn_ca_operator_floor_state',
      'fn_ca_resolve_unbound_pending_addons',
      'fn_ca_process_hand_post_commit_obligations',
      'fn_move_tournament_player',
    ]) {
      expect(EVENT_DB_HIGH_PRIORITY_RPCS.has(rpc), `${rpc} must stay high priority`).toBe(true);
    }

    const clientSrc = readServer('src/services/supabase/client.ts');
    expect(clientSrc).toContain(
      'getEventDbPriorityOverride() ?? classifyEventDbPriority(attemptInput)'
    );
  });

  it('keeps TournamentManager boundary plan recovery, high-priority parked door reads, and batched multi-destination door prefetch wired', () => {
    const tmSrc = readServer('src/tournament/TournamentManager.ts');
    const drain = sliceMethod(tmSrc, 'private drainBoundaryBalance(');
    const sweepSettled = sliceMethod(tmSrc, 'protected override onEliminationSweepSettled(');
    const parkedBalance = sliceMethod(tmSrc, 'private async balanceParkedGapSources(');
    const doorChair = sliceMethod(tmSrc, 'private async chairFreeAtTheDoor(');
    const execMoves = sliceMethod(tmSrc, 'private async executePlayerMovesOwned(');

    expect(drain).toContain('this.boundaryPlanAwaitingPark.size > 0');
    expect(drain).toContain('this.prepareBoundaryBalancePlan()');
    expect(sweepSettled).toContain('this.prepareBoundaryBalancePlan()');
    expect(parkedBalance).toContain("runWithEventDbPriority('high'");
    expect(doorChair).toContain("runWithEventDbPriority('high'");
    expect(execMoves).toContain("loadBalancerTables(uniqueDestIds, 'moveChairAtTheDoor')");
    expect(execMoves).toContain(
      "this.finishGapBalancePark(sourceTableId, sourceMoved ? 'moved' : 'released')"
    );
  });

  it('keeps TournamentBrainContext root-bound, format-cached for repeat refreshes, and fail-closed on count-drift retry', () => {
    const tbcSrc = readServer('src/services/TournamentBrainContext.ts');
    const readRows = sliceMethod(tbcSrc, 'async function readTournamentContextRows<T>(');
    const refreshFn = sliceMethod(tbcSrc, 'async function refresh(');

    expect(tbcSrc).toContain('const refreshAtRoot = bindToProcessRoot(refresh);');
    expect(readRows).toContain('for (let fullAttempt = 1; fullAttempt <= 2; fullAttempt++)');
    expect(readRows).toContain('pageAttempts: 1');
    expect(refreshFn).toContain('e.knownFormat');
    expect(refreshFn).toContain('tournamentNeedsChestInventory');
    expect(refreshFn).toContain('tournamentNeedsSatelliteEntitlements');
  });

  it('keeps empty attempt-1 pending add-on RTT skip and jittered post-commit retry backoff intact', () => {
    const seatingSrc = readServer('src/engine/ServerTableEngineSeating.ts');
    const settlementSrc = readServer('src/engine/ServerTableEngineSettlement.ts');
    const postHand = sliceMethod(settlementSrc, 'protected async postHandTasks(');

    expect(seatingSrc).toContain('if (completedAttempt === 1 && rows.length === 0)');
    expect(postHand).toMatch(/this\.markProgress\(\);\s*const backoffMs = Math\.min\(/);
    expect(postHand).toContain('Math.random()');
    expect(postHand).toContain('5_000');
  });

  it('enforces PR CI <-> prequalification test parity, seeded Lightning fake-timer RNG, and live /health hand-gap/bulkhead SLO checks', () => {
    const prequalYml = readRepo('.github/workflows/engine-release-prequalification.yml');
    const ciYml = readRepo('.github/workflows/ci.yml');
    const lightningTest = readServer('src/lightning/LightningPhase6Remediation.test.ts');
    const postCutoverLib = readRepo('scripts/ops/post-cutover-audit-lib.mjs');

    // Every server test command executed in engine-release-prequalification must
    // also execute in PR CI's server engine shards (no post-merge-only server gate).
    expect(prequalYml).toContain('RetainedHistoricalCheckpointQualification.test.ts');
    expect(ciYml).toContain('RetainedHistoricalCheckpointQualification.test.ts');
    expect(prequalYml).toContain('--shard="$RELEASE_TEST_SHARD/4"');
    expect(ciYml).toContain('working-directory: server');

    // Fake-timer Lightning horse-lane tests must seed Math.random deterministically
    // so unseeded tank rolls cannot flake 27-minute engine prequalification shards.
    expect(lightningTest).toContain(
      "vi.spyOn(Math, 'random').mockImplementation(mulberry32(8900))"
    );
    expect(lightningTest).toContain(
      "vi.spyOn(Math, 'random').mockImplementation(mulberry32(9000))"
    );

    // Post-cutover live health audit must evaluate both nextHandGap and eventDbBulkhead SLOs.
    expect(postCutoverLib).toContain('health.nextHandGap');
    expect(postCutoverLib).toContain('health.eventDbBulkhead');
    expect(postCutoverLib).toContain('idleThrottledEvents');
  });

  it('pins main-thread saturation, bulkhead REST priority, F06 clone elimination, lazy hub publish, and hold-fenced plan seeding laws (1e532243 Phase 4)', () => {
    const dealingSrc = readServer('src/engine/ServerTableEngineDealing.ts');
    const settlementSrc = readServer('src/engine/ServerTableEngineSettlement.ts');
    const baseSrc = readServer('src/engine/ServerTableEngineBase.ts');
    const engineSrc = readServer('src/engine/ServerTableEngine.ts');
    const laneContinuationSrc = readServer('src/engine/HandContinuationLane.ts');
    const protocolSrc = readServer('src/engine/horseDecision/protocol.ts');
    const budgetSrc = readServer('src/engine/horseDecision/requestRetentionBudget.ts');
    const hdClientSrc = readServer('src/engine/horseDecision/client.ts');
    const hdLaneSrc = readServer('src/engine/horseDecision/lane.ts');
    const hubSrc = readServer('src/transport/TableStateHub.ts');
    const tmSrc = readServer('src/tournament/TournamentManager.ts');

    // RC #1: Live between-hands REST calls run under high EventDb priority override.
    expect(sliceMethod(dealingSrc, 'protected async readNextHandInputs(')).toContain(
      "runWithEventDbPriority('high'"
    );
    expect(sliceMethod(dealingSrc, 'private async refreshBlindsOwned(')).toContain(
      "runWithEventDbPriority('high'"
    );
    expect(settlementSrc).toContain(
      "runWithEventDbPriority('high', () =>\n              supabase\n                .from('table_seats')"
    );
    expect(settlementSrc).toContain(
      "runWithEventDbPriority('high', () =>\n        reconcileTableSeatCount("
    );

    // RC #2: F06 continuation skips redundant clones and uses getLifecyclePhase() instead of JSON.parse(serializeRecoveryState()).
    expect(baseSrc).toContain('private static cloneContinuationValue(');
    expect(baseSrc).toContain('protected captureContinuationAccounting(');
    expect(laneContinuationSrc).toContain('engineCaptureDetached');
    expect(laneContinuationSrc).toContain('captureAccounting');
    expect(dealingSrc).toContain('engineCaptureDetached: true');
    expect(sliceMethod(dealingSrc, 'override isPreparedOriginalHeldAtPauseGate(')).toContain(
      'controller.getLifecyclePhase().handStarted === false'
    );
    expect(sliceMethod(dealingSrc, 'override isPreparedOriginalParkedForSuccessor(')).toContain(
      'controller.getLifecyclePhase().handStarted === false'
    );

    // RC #3: horseDecision chunked SHA-256, parallel-stack allowance, prevalidated commit & single-clone mirror fan-out.
    expect(protocolSrc).toContain('CANONICAL_HASH_CHUNK_CHARS');
    expect(budgetSrc).toContain('pendingValues');
    expect(budgetSrc).toContain('pendingDepths');
    expect(budgetSrc).toContain('combineHorseRequestAllowanceMetrics');
    expect(hdClientSrc).toContain('mirrorCompletedHandDetached(');
    expect(hdClientSrc).toContain('prevalidatedCommitMetrics');
    expect(hdLaneSrc).toContain('mirrorCompletedHandDetached(');

    // RC #4: Unwatched-table lazy publish defers payload projection until a subscriber attaches.
    expect(hubSrc).toContain('publishLazy(');
    expect(hubSrc).toContain('materializeLazySnapshot(');
    expect(sliceMethod(engineSrc, 'protected broadcastCurrentState(')).toContain('publishLazy(');
    expect(sliceMethod(engineSrc, 'protected publishIdleState(')).toContain('publishLazy(');

    // RC #5: Hold-fenced sources in boundaryPlanAwaitingPark receive seeded balanced boards.
    expect(tmSrc).toContain(
      'this.hasParkedGapBalanceSource() || this.boundaryPlanAwaitingPark.size > 0'
    );
  });
});
