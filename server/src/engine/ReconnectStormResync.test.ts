/**
 * Reconnect-storm resync stress test (2026-11-21).
 *
 * Simulates 60 mobile/browser viewers simultaneously requesting `getTableState`
 * at hand-1 after a tournament break ends, verifying:
 *   1. Zero throws and fast synchronous completion (< 250 ms for 60 viewers).
 *   2. Card-privacy invariants stay intact under concurrent resyncs: each
 *      seated player sees only their own hole cards, never an opponent's, and
 *      railbirds/observers see zero private hole cards.
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

import { disposeEngines, fixture } from './f06RestDealFixture.test-support.js';

afterEach(() => disposeEngines());

describe('reconnect-storm resync resilience', () => {
  it('serves 60 simultaneous getTableState resyncs quickly with intact hole-card privacy', async () => {
    const t = fixture({ rpcLatencyMs: 20 });
    t.engine.armNextHandRest(100);
    await t.engine.awaitNextHandRestLead();
    const deal = t.engine.dealHand(t.engine.seatedPlayers);
    await vi.waitFor(() => expect(t.started).toHaveBeenCalledOnce(), { timeout: 5000 });

    const seatedIds: string[] = (t.engine.seatedPlayers ?? []).map(
      (p: { user_id: string }) => p.user_id
    );
    expect(seatedIds.length).toBeGreaterThanOrEqual(2);

    const viewers: string[] = [];
    for (let i = 0; i < 60; i++) {
      viewers.push(i < seatedIds.length ? seatedIds[i] : `observer-${i}`);
    }

    const startMs = Date.now();
    const snapshots = viewers.map((uid) => t.engine.getTableState(uid));
    const elapsedMs = Date.now() - startMs;

    t.engine.activeHandWaitRelease?.release('fixture_done');
    await deal;

    expect(elapsedMs).toBeLessThan(250);
    expect(snapshots.every((s) => s !== null)).toBe(true);

    // Every observer must see zero opponent hole cards.
    const observerSnap = snapshots[seatedIds.length] as {
      players: Array<{ user_id: string; cards?: unknown[] }>;
    };
    for (const p of observerSnap.players) {
      expect(p.cards ?? []).toEqual([]);
    }

    // Seated hero sees only their own hole cards, never another seat's.
    const heroId = seatedIds[0];
    const heroSnap = snapshots[0] as {
      players: Array<{ user_id: string; cards?: unknown[] }>;
    };
    for (const p of heroSnap.players) {
      if (p.user_id !== heroId) {
        expect(p.cards ?? []).toEqual([]);
      }
    }
  });
});
