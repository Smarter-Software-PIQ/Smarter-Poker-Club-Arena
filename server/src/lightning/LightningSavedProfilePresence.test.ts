import { afterEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../services/supabase/client.js', () => ({
  supabase: { rpc, from: vi.fn() },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
const { buildHost, formedHand, flush, uid } = await import('../testing/lightningHostTestKit.js');
const { horseSavedProfilePresence } = await import('../services/HorseSavedProfilePresence.js');

afterEach(() => vi.useRealTimers());

it('the original Lightning host reads the saved store once for the actual dealt humans before FAST', async () => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  const hand = formedHand(6, 6123);
  const humans = hand.players.slice(2, 4).sort();
  rpc.mockImplementation((name, args) => {
    expect(name).toBe('fn_horse_saved_profile_presence');
    expect(args.p_user_ids).toEqual(humans);
    return {
      abortSignal: async () => ({
        error: null,
        data: [
          { user_id: humans[0], presence: 'other_context' },
          { user_id: humans[1], presence: 'no_saved_row' },
        ],
      }),
    };
  });
  const { LightningTimeBankLedger } = await import('./LightningHandHost.js');
  let finishBanks!: () => void;
  const originalWait = new Promise<void>((resolve) => {
    finishBanks = resolve;
  });
  const banks = vi
    .spyOn(LightningTimeBankLedger.prototype, 'ensure')
    .mockImplementationOnce(async () => originalWait);
  const t = buildHost(hand, [100, 100, 100, 100, 100, 100], {
    horses: new Set(hand.players.slice(0, 2)),
  });
  // Drive the actual loader: one completely absent profile and one nullable
  // is_horse retain the gameplay fallback, but neither can qualify for evidence.
  const { loadLightningParticipants } = await import('./LightningHandBackend.js');
  const seatRows = t.participants.map((p) => ({
    player_id: p.playerId,
    seat: p.seat,
    position: p.position,
    blind_role: p.blindRole,
    stack_before: p.stackBefore,
    slot: { pool_session_id: p.poolSessionId },
  }));
  const profileRows = hand.players
    .slice(0, 5)
    .map((id, i) => ({ id, is_horse: i < 2 ? true : i === 4 ? null : false }));
  const from = (table: string) => ({
    select: () => ({
      eq: async () => ({ data: seatRows, error: null }),
      in: async (_key: string, ids: string[]) => ({
        data: profileRows.filter((p) => ids.includes(p.id)),
        error: null,
      }),
    }),
  });
  t.backend.loadParticipants = (_hand, ids) =>
    loadLightningParticipants(_hand, ids, { from } as never);
  try {
    const starting = t.host.start();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());
    await flush(4);
    await vi.advanceTimersByTimeAsync(5);
    finishBanks();
    await starting;
    for (let i = 0; i < 10 && !t.horseLane.calls.length; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      await flush(3);
    }
    const snapshot = t.horseLane.calls.at(-1);
    expect(snapshot).toBeDefined();
    expect(snapshot!.savedProfileHumanIds?.slice().sort()).toEqual(humans);
    expect(snapshot!.gameState.humanUserIds?.slice().sort()).toEqual(hand.players.slice(2).sort());
    const receipt = horseSavedProfilePresence.forSnapshot(snapshot!);
    expect(receipt).toMatchObject({
      status: 'available',
      rows: [
        {
          user_id: humans[0],
          presence: 'other_context',
          priorParticipation: 'unresolved',
        },
        { user_id: humans[1], presence: 'no_saved_row', priorParticipation: 'unresolved' },
      ],
    });
    expect(
      horseSavedProfilePresence.forSnapshot({
        ...snapshot!,
        decisionTimeMs: receipt!.availableAtMs! - 1,
      })?.status
    ).toBe('unavailable');
    const switched = structuredClone(snapshot!);
    switched.gameState.publicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
    expect(horseSavedProfilePresence.forSnapshot(switched)?.status).toBe('unavailable');
    const moved = structuredClone(snapshot!);
    moved.savedProfileHumanIds = [uid(9999)];
    expect(horseSavedProfilePresence.forSnapshot(moved)?.status).toBe('unavailable');
    expect(rpc).toHaveBeenCalledTimes(1);
  } finally {
    finishBanks();
    banks.mockRestore();
    await t.host.abort('test_complete');
  }
});
