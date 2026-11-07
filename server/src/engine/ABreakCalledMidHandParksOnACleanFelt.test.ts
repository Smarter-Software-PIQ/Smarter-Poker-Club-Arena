import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerTableEngine } from './ServerTableEngine.js';

const checkpoint = vi.hoisted(() => ({ row: null as any, error: null as Error | null }));

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'engine_presence_parked')
        return {
          upsert: async (row: unknown) => {
            if (!checkpoint.error) checkpoint.row = row;
            return { error: checkpoint.error };
          },
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: checkpoint.row, error: null }) }),
          }),
        };
      throw new Error('Unexpected database read in pause fixture');
    }),
    rpc: vi.fn((name: string) => {
      if (name === 'fn_ca_operator_floor_state')
        return Promise.resolve({ data: { hold: null, close: null }, error: null });
      throw new Error('Unexpected database RPC in pause fixture');
    }),
  },
  maintenanceSupabase: {},
}));

beforeEach(() => {
  checkpoint.row = null;
  checkpoint.error = null;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * A BREAK CALLED MID-HAND PARKS ON A CLEAN FELT (Dan 2026-11-06/07).
 *
 * "ANY AND ALL SCHEDULED BREAKS OR MAINTENANCE BREAKS MUST FINISH THE CURRENT
 * HAND THEY ARE ON, BEFORE THE BREAK STARTS."
 *
 * The source-order law (tests/a-break-never-starts-in-the-middle-of-a-hand)
 * pins where the park sits. This drives the real dealing loop: a break is
 * called while a hand is being dealt, and the table must run the completion
 * hold and the hand-free broadcast BEFORE it reports itself parked, and must
 * never deal another hand.
 */
function loopWithBreakCalledMidHand(callBreak: (engine: any) => void) {
  const engine = new ServerTableEngine('71717171-7171-4171-8171-717171717171') as any;
  const players = [1, 2, 3].map((n) => ({
    user_id: `33333333-3333-4333-8333-33333333333${n}`,
    occupancy_id: `44444444-4444-4444-8444-44444444444${n}`,
    seat_number: n,
    stack: 100,
  }));
  const order: string[] = [];
  engine.running = true;
  engine.isCurrentEngine = () => true;
  engine.tableInfo = {
    id: engine.tableId,
    tournament_id: 'event',
    game_type: 'NLH',
    max_players: 6,
  };
  engine.seatedPlayers = players;
  engine.knownPlayerIds = new Set(players.map((p) => p.user_id));
  engine.dealingLoopFirstIteration = false;
  engine.prepareNextHand = vi.fn(async () => players);
  engine.adoptMovedPresence = vi.fn().mockResolvedValue(true);
  engine.restoreSitOutsFromSeats = vi.fn();
  engine.evictExpiredSitOuts = vi.fn(async () => {});
  engine.announcePendingSeatMoves = vi.fn(async () => true);
  engine.persistPresenceForRestart = vi.fn(async () => {});
  engine.hasOpenBountyReveal = () => false;
  engine.awaitNextHandRest = vi.fn(async () => {});
  engine.dealHand = vi.fn(async () => {
    order.push('deal');
    // The break is called while this hand is in the air.
    callBreak(engine);
  });
  engine.awaitHandCompletionDisplay = vi.fn(async () => {
    order.push('completion_display');
  });
  engine.broadcastCurrentState = vi.fn(() => {
    order.push('clean_felt');
  });
  engine.sleep = vi.fn(async () => {
    engine.running = false;
  });
  engine.onPauseReady(() => {
    order.push('parked');
    engine.running = false;
    engine.handForHandResolve?.();
  });
  return { engine, order };
}

describe('a break called mid-hand parks on a clean felt', () => {
  it.each([
    [
      'synchronized tournament break',
      (e: any) => e.pauseAfterHand(420_000, { beforeNextHand: true }),
    ],
    ['maintenance break', (e: any) => e.pauseForMaintenance(300_000)],
    ['hand-for-hand', (e: any) => e.pauseAfterHand()],
  ] as const)('%s: completion display, then clean felt, then parked', async (_name, callBreak) => {
    const { engine, order } = loopWithBreakCalledMidHand(callBreak);
    await engine.dealingLoop();
    expect(order).toEqual(['deal', 'completion_display', 'clean_felt', 'parked']);
    expect(engine.dealHand).toHaveBeenCalledOnce();
  });
});
