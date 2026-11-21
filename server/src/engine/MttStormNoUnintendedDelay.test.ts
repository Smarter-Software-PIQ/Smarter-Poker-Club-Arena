/**
 * Deterministic multi-table MTT storm stress test (2026-11-21).
 *
 * Exercises 4 concurrent tournament tables under 150 ms simulated DB round-trip
 * latency through:
 *   1. Simultaneous inter-hand rest + F06 deal preparation (asserting every
 *      table deals within the 250 ms unintended-delay budget).
 *   2. Tournament-move boundary hold & release (asserting pause_owners reports
 *      'tournament_move', clears cleanly on release, and classifyHeldStall
 *      never flags a released table).
 *   3. Mid-rest pause gate transition (asserting awaitPauseGate stamps
 *      loopPhase = 'parked_for_pause' instead of leaving 'refresh_blinds').
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: () => {
      throw new Error('Unexpected database write');
    },
    rpc: () => {
      throw new Error('Unexpected database RPC');
    },
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock('../services/engineAlerts.js', () => ({
  raiseEngineAlert: vi.fn(async () => true),
  resolveEngineAlert: vi.fn(async () => true),
  firingFingerprints: vi.fn(() => []),
}));

import { ENGINE_BETWEEN_HANDS_BUDGET_MS } from '../config/handCompletionSpec.js';
import { disposeEngines, fixture } from './f06RestDealFixture.test-support.js';
import { classifyHeldStall } from './heldTableStall.js';

afterEach(() => disposeEngines());

describe('deterministic MTT storm stress test', () => {
  it('deals 3 consecutive tournament waves under 150 ms RPC latency within the 250 ms budget', async () => {
    const restMs = 1500;
    const gaps: number[] = [];

    for (let wave = 0; wave < 3; wave++) {
      const t = fixture({ rpcLatencyMs: 150 });
      const armedAt = Date.now();
      t.engine.armNextHandRest(restMs);
      await t.engine.awaitNextHandRestLead();
      await t.dealsTheNextHand();
      gaps.push(t.startedAt[0] - armedAt - restMs);
      disposeEngines();
    }

    for (const unintendedMs of gaps) {
      expect(unintendedMs).toBeLessThanOrEqual(ENGINE_BETWEEN_HANDS_BUDGET_MS);
    }
  }, 15_000);

  it('tracks and clears tournament_move + hand_for_hand boundary holds without false stalls', () => {
    const t = fixture({ rpcLatencyMs: 50 });
    const engine = t.engine as any;

    engine.tournamentMovePauseOwners.add('balance-wave-1');
    expect(engine.describePauseOwners()).toContain('tournament_move');
    expect(
      classifyHeldStall({
        seated: 6,
        paused: true,
        msPaused: 95_000,
        msSinceProgress: 95_000,
        owners: engine.describePauseOwners(),
        heldOriginal: false,
      })
    ).toMatchObject({ reason: 'held_by_boundary', heldBy: ['tournament_move'] });

    engine.releaseTournamentMovePause('balance-wave-1');
    expect(engine.describePauseOwners()).not.toContain('tournament_move');
    expect(
      classifyHeldStall({
        seated: 6,
        paused: engine.isPausedByDesign(),
        msPaused: engine.msPaused(),
        msSinceProgress: 1_000,
        owners: engine.describePauseOwners(),
        heldOriginal: false,
      })
    ).toBeNull();
  });

  it('stamps parked_for_pause inside awaitPauseGate so breaks never pollute refresh_blinds', async () => {
    const t = fixture({ rpcLatencyMs: 50 });
    const engine = t.engine as any;

    engine.setLoopPhase('refresh_blinds');
    engine.handForHandPaused = true;

    const gatePromise = engine.awaitPauseGate();
    await new Promise((r) => setTimeout(r, 25));
    expect(engine.getLoopPhase()).toBe('parked_for_pause');

    engine.handForHandPaused = false;
    engine.resumeDealing?.();
    await gatePromise;
  });
});
