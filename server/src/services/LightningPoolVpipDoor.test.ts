import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  atomicCashout: vi.fn(),
  inLiveLightningHand: vi.fn(),
  frozen: vi.fn(() => false),
  readAnchor: vi.fn(),
}));

vi.mock('./supabase.js', async (original) => ({
  ...(await original<typeof import('./supabase.js')>()),
  atomicCashout: (...args: unknown[]) => mocks.atomicCashout(...args),
}));
vi.mock('./supabase/lightningAnchor.js', async (original) => ({
  ...(await original<typeof import('./supabase/lightningAnchor.js')>()),
  lightningAnchorSeat: (...args: unknown[]) => mocks.readAnchor(...args),
  lightningPlayerLiveHand: (...args: unknown[]) => mocks.inLiveLightningHand(...args),
}));
vi.mock('../maintenance/freezeState.js', async (original) => ({
  ...(await original<typeof import('../maintenance/freezeState.js')>()),
  isMaintenanceFrozen: () => mocks.frozen(),
}));
vi.mock('./errorReporter.js', () => ({ reportError: vi.fn() }));

const { executeLightningPoolVpipEviction, startLightningPoolVpipDoor, stopLightningPoolVpipDoor } =
  await import('./LightningPoolVpipDoor.js');
const { LightningPoolVpipJudge, DEFAULT_LIGHTNING_POOL_VPIP_POLICY } =
  await import('../lightning/LightningPoolVpipJudge.js');
const { ServerTableEngine } = await import('../engine/ServerTableEngine.js');
const { deadlineScheduler } = await import('../engine/DeadlineScheduler.js');

const CLUSTER = '11111111-1111-4111-8111-111111111111';
const ANCHOR_TABLE = '22222222-2222-4222-8222-222222222222';
const POOL_SESSION = '33333333-3333-4333-8333-333333333333';
const HUMAN_ID = '44444444-4444-4444-8444-444444444444';
const HORSE_ID = '55555555-5555-4555-8555-555555555555';
const OCCUPANCY = '66666666-6666-4666-8666-666666666666';

afterEach(() => {
  stopLightningPoolVpipDoor();
  deadlineScheduler.cancelAll(ANCHOR_TABLE);
  vi.clearAllMocks();
  mocks.frozen.mockImplementation(() => false);
});

const baseReq = (playerId = HUMAN_ID) => ({
  clusterId: CLUSTER,
  hostTableId: ANCHOR_TABLE,
  poolSessionId: POOL_SESSION,
  playerId,
  vpip: 10,
  required: 25,
  hands: 20,
  windowHands: 30,
  graceHands: 10,
});

describe('LightningPoolVpipDoor', () => {
  it('resolves the open anchor seat, evicts via engine, and emits seat_left (nit_game_vpip) to the room', async () => {
    const evictForLightningVpip = vi.fn(async () => 'evicted' as const);
    const emitRoomEvent = vi.fn();
    const outcome = await executeLightningPoolVpipEviction(baseReq(), {
      getEngine: (tid) => (tid === ANCHOR_TABLE ? { evictForLightningVpip } : undefined),
      readAnchorSeat: async () => ({
        anchorTableId: ANCHOR_TABLE,
        seatNumber: 4,
        occupancyId: OCCUPANCY,
        clusterId: CLUSTER,
      }),
      emitRoomEvent,
      now: () => 123456,
    });
    expect(outcome).toBe('evicted');
    expect(evictForLightningVpip).toHaveBeenCalledWith(HUMAN_ID, {
      occupancyId: OCCUPANCY,
      seatNumber: 4,
      vpip: 10,
      required: 25,
      hands: 20,
    });
    expect(emitRoomEvent).toHaveBeenCalledWith(
      POOL_SESSION,
      expect.objectContaining({
        type: 'seat_left',
        table_id: POOL_SESSION,
        seat: 4,
        user_id: HUMAN_ID,
        mid_hand: false,
        reason: 'nit_game_vpip',
      })
    );
  });

  it('defers during maintenance freeze and returns not_seated when anchor is already gone', async () => {
    const evictForLightningVpip = vi.fn();
    expect(
      await executeLightningPoolVpipEviction(baseReq(), {
        getEngine: () => ({ evictForLightningVpip }),
        readAnchorSeat: async () => ({
          anchorTableId: ANCHOR_TABLE,
          seatNumber: 4,
          occupancyId: OCCUPANCY,
          clusterId: CLUSTER,
        }),
        frozen: () => true,
      })
    ).toBe('deferred');
    expect(evictForLightningVpip).not.toHaveBeenCalled();

    expect(
      await executeLightningPoolVpipEviction(baseReq(), {
        getEngine: () => ({ evictForLightningVpip }),
        readAnchorSeat: async () => null,
      })
    ).toBe('not_seated');
  });

  it('verifies anchor state after an uncertain throw so a committed eviction is never retried', async () => {
    let reads = 0;
    const readAnchorSeat = vi.fn(async () =>
      ++reads === 1
        ? {
            anchorTableId: ANCHOR_TABLE,
            seatNumber: 4,
            occupancyId: OCCUPANCY,
            clusterId: CLUSTER,
          }
        : null
    );
    const outcome = await executeLightningPoolVpipEviction(baseReq(), {
      getEngine: () => ({
        evictForLightningVpip: async () => {
          throw new Error('network timeout');
        },
      }),
      readAnchorSeat,
    });
    expect(outcome).toBe('evicted');
    expect(readAnchorSeat).toHaveBeenCalledTimes(2);
  });

  it('startLightningPoolVpipDoor wires the global judge eviction handler cleanly', async () => {
    const evictForLightningVpip = vi.fn(async () => 'evicted' as const);
    mocks.readAnchor.mockResolvedValue({
      anchorTableId: ANCHOR_TABLE,
      seatNumber: 2,
      occupancyId: OCCUPANCY,
      clusterId: CLUSTER,
    });
    startLightningPoolVpipDoor((tid) =>
      tid === ANCHOR_TABLE ? { evictForLightningVpip } : undefined
    );
    const judge = new LightningPoolVpipJudge({ enabled: () => true });
    for (let h = 1; h <= 20; h++) {
      judge.recordHand({
        clusterId: CLUSTER,
        poolSessionId: POOL_SESSION,
        playerId: HORSE_ID,
        handNumber: h,
        hadOpportunity: true,
        entered: false,
        policy: DEFAULT_LIGHTNING_POOL_VPIP_POLICY,
      });
    }
    expect(await judge.requestEviction(baseReq(HORSE_ID))).toBe('evicted');
    expect(evictForLightningVpip).toHaveBeenCalledTimes(1);
  });
});

describe('ServerTableEngine.evictForLightningVpip (between-hands atomic cashout)', () => {
  function buildAnchorEngine(userId: string, isHorse: boolean, stack = 200) {
    const e = new ServerTableEngine(ANCHOR_TABLE) as any;
    e.tableInfo = { club_id: 'club-1', big_blind: 2, cluster_id: CLUSTER };
    e.seatedPlayers = [
      {
        user_id: userId,
        occupancy_id: OCCUPANCY,
        seat_number: 3,
        stack,
        username: isHorse ? 'horse_player' : 'human_player',
        is_horse: isHorse,
      },
    ];
    e.isTournamentTable = () => false;
    e.lifecycleCanMutate = () => true;
    e.broadcastCurrentState = vi.fn();
    e.wakeClusterGame = vi.fn();
    e.hub = { emitEvent: vi.fn() };
    return e;
  }

  it.each([
    ['human player', HUMAN_ID, false],
    ['Horse player', HORSE_ID, true],
  ])(
    'cashes out a %s between hands via atomicCashout (leaveMode vpip_evicted) with 100% chips preserved',
    async (_label, userId, isHorse) => {
      const e = buildAnchorEngine(userId, isHorse, 185.5);
      mocks.inLiveLightningHand.mockResolvedValue(null);
      mocks.atomicCashout.mockResolvedValue(185.5);

      const res = await e.evictForLightningVpip(userId, {
        occupancyId: OCCUPANCY,
        seatNumber: 3,
        vpip: 10,
        required: 25,
        hands: 20,
      });

      expect(res).toBe('evicted');
      expect(mocks.atomicCashout).toHaveBeenCalledWith(
        userId,
        ANCHOR_TABLE,
        3,
        expect.objectContaining({
          occupancyId: OCCUPANCY,
          leaveMode: 'vpip_evicted',
        })
      );
      expect(e.seatedPlayers).toHaveLength(0);
      expect(e.hub.emitEvent).toHaveBeenCalledWith(
        ANCHOR_TABLE,
        expect.objectContaining({
          type: 'seat_left',
          seat: 3,
          user_id: userId,
          mid_hand: false,
          reason: 'nit_game_vpip',
        })
      );
      expect(e.broadcastCurrentState).toHaveBeenCalledTimes(1);
    }
  );

  it('refuses mid-hand eviction when player is in a live Lightning hand (never loses chips)', async () => {
    const e = buildAnchorEngine(HUMAN_ID, false, 150);
    mocks.inLiveLightningHand.mockResolvedValue('77777777-7777-4777-8777-777777777777');

    const res = await e.evictForLightningVpip(HUMAN_ID, {
      occupancyId: OCCUPANCY,
      seatNumber: 3,
      vpip: 10,
      required: 25,
      hands: 20,
    });
    expect(res).toBe('deferred');
    expect(mocks.atomicCashout).not.toHaveBeenCalled();
    expect(e.seatedPlayers).toHaveLength(1);
    expect(e.seatedPlayers[0].stack).toBe(150);
  });

  it('defers cleanly when atomicCashout reports LIGHTNING_HAND_IN_PROGRESS', async () => {
    const e = buildAnchorEngine(HORSE_ID, true, 150);
    mocks.inLiveLightningHand.mockResolvedValue(null);
    mocks.atomicCashout.mockImplementation(
      async (
        _u: string,
        _t: string,
        _s: number,
        opts: { onLightningHandInProgress?: () => void }
      ) => {
        opts.onLightningHandInProgress?.();
        return 0;
      }
    );

    const res = await e.evictForLightningVpip(HORSE_ID, {
      occupancyId: OCCUPANCY,
      seatNumber: 3,
      vpip: 0,
      required: 25,
      hands: 20,
    });
    expect(res).toBe('deferred');
    expect(e.seatedPlayers).toHaveLength(1);
    expect(e.seatedPlayers[0].stack).toBe(150);
    expect(e.hub.emitEvent).not.toHaveBeenCalled();
  });

  it('refuses stale occupancy without touching a replacement seat', async () => {
    const e = buildAnchorEngine(HUMAN_ID, false, 150);
    const res = await e.evictForLightningVpip(HUMAN_ID, {
      occupancyId: '99999999-9999-4999-8999-999999999999',
      seatNumber: 3,
      vpip: 0,
      required: 25,
      hands: 20,
    });
    expect(res).toBe('not_seated');
    expect(mocks.atomicCashout).not.toHaveBeenCalled();
    expect(e.seatedPlayers).toHaveLength(1);
  });
});
