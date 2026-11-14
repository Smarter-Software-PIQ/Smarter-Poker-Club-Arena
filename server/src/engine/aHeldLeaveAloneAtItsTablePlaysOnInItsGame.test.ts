/**
 * 2026-11-14: when Lightning NLH .25/.50 switched off at 03:33 Chicago, nine
 * held leaves each sat alone at a former anchor and were released as "nobody
 * else left to play the owed hands" with 0-3 of 10 played, while the same game
 * dealt at another table. Alone at the table is not alone in the game: the
 * engine now asks the database first, and only an answer that the game has no
 * other dealing table (or no answer at all) releases the seat. Person and
 * horse twins in every spec.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cashout = vi.fn();
const departure = vi.fn();
const cashoutVoluntary = vi.fn();
const evaluate = vi.fn(async () => []);
const blindOff = vi.fn(async (..._args: unknown[]) => true);
const returnToPool = vi.fn();
const playsOn = vi.fn();

vi.mock('../services/supabase/seats.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/supabase/seats.js')>();
  return { ...actual, requestSeatDeparture: (...args: unknown[]) => departure(...args) };
});
vi.mock('../services/supabase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/supabase.js')>();
  return {
    ...actual,
    atomicCashout: (...args: unknown[]) => cashout(...args),
    atomicCashoutVoluntary: (...args: unknown[]) => cashoutVoluntary(...args),
  };
});
vi.mock('../services/supabase/cashSessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/supabase/cashSessions.js')>();
  return {
    ...actual,
    evaluateCashSessions: (...args: unknown[]) => evaluate(...(args as [])),
    atomicCashoutVoluntary: (...args: unknown[]) => cashoutVoluntary(...args),
    setCashSessionBlindOff: (...args: unknown[]) => blindOff(...args),
    returnOwedLightningLeaveToPool: (...args: unknown[]) => returnToPool(...args),
    owedLeavePlaysOnInGame: (...args: unknown[]) => playsOn(...args),
  };
});

const { ServerTableEngine } = await import('./ServerTableEngine.js');
const { deadlineScheduler } = await import('./DeadlineScheduler.js');

const TABLE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLUSTER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OCC_HUMAN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const OCC_HORSE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const HUMAN = 'aaaaaaaa-0000-0000-0000-000000000001';
const HORSE = 'aaaaaaaa-0000-0000-0000-000000000002';

const row = (user_id: string, over: Record<string, unknown> = {}) => ({
  user_id,
  baseline: 100,
  stack: 180,
  stay_remaining_ms: 0,
  stay_running: false,
  stay_last_tick_at: new Date().toISOString(),
  stay_clock_ms: 600_000,
  leave_locked: true,
  hands_required: 10,
  hands_played: 3,
  hands_remaining: 7,
  ...over,
});

function makeEngine({ anchor = true, rosterStack = 180 } = {}) {
  const e = new ServerTableEngine(TABLE) as any;
  e.tableInfo = {
    id: TABLE,
    club_id: 'club',
    cluster_id: CLUSTER,
    small_blind: 0.25,
    big_blind: 0.5,
    game_variant: 'nlh',
    max_players: 6,
    game_type: 'cash',
    min_buy_in: 40,
    max_buy_in: 100,
  };
  e.running = true;
  e.handController = null;
  e.dealingHaltLock = anchor;
  e.dealingHaltReason = anchor ? 'lightning' : null;
  e.lifecycleCanMutate = () => true;
  e.seatedPlayers = [
    {
      user_id: HUMAN,
      username: 'human',
      stack: rosterStack,
      seat_number: 1,
      is_horse: false,
      occupancy_id: OCC_HUMAN,
      leave_pending: true,
    },
    {
      user_id: HORSE,
      username: 'horse',
      stack: rosterStack,
      seat_number: 2,
      is_horse: true,
      occupancy_id: OCC_HORSE,
      leave_pending: true,
    },
  ];
  e.hub = { emitEvent: vi.fn(), publish: vi.fn() };
  e.broadcastCurrentState = vi.fn(async () => undefined);
  return e;
}

beforeEach(() => {
  cashout.mockReset();
  departure.mockReset().mockResolvedValue(undefined);
  cashoutVoluntary.mockReset();
  evaluate.mockReset();
  blindOff.mockClear();
  returnToPool.mockReset();
  playsOn.mockReset();
});
afterEach(() => deadlineScheduler.cancelAll(TABLE));

for (const [who, id, occ, seat] of [
  ['human', HUMAN, OCC_HUMAN, 1],
  ['horse', HORSE, OCC_HORSE, 2],
] as const) {
  const alone = () => {
    const e = makeEngine({ anchor: false });
    e.seatedPlayers = e.seatedPlayers.filter((p: { user_id: string }) => p.user_id === id);
    e.onLeaveRefusedAtSettlement(id, 0, occ);
    e.chipContinuity.rows.set(id, row(id));
    return e;
  };

  describe(`${who}: a held leave alone at its table`, () => {
    it('plays on in its game while another table of the game deals', async () => {
      const e = alone();
      const sitBack = vi.spyOn(e.disconnectEngine, 'sitBack');
      playsOn.mockResolvedValue({ keep: true, returned: true, handsRemaining: 7, reason: null });
      await e.releaseLeavesHeldByClock();
      expect(playsOn).toHaveBeenCalledWith(id, TABLE, seat, occ);
      expect(cashout).not.toHaveBeenCalled();
      expect(cashoutVoluntary).not.toHaveBeenCalled();
      const seated = e.seatedPlayers.find((p: { user_id: string }) => p.user_id === id);
      expect(seated.leave_pending).toBe(false);
      // The blind off at a Classic table is the sit-out: it stays.
      expect(sitBack).not.toHaveBeenCalled();
      expect(e.leaveHeldByClock.get(id)).toBe(occ);

      // Still held and waiting for the move: asked again, not released.
      playsOn.mockResolvedValue({
        keep: true,
        returned: false,
        handsRemaining: 7,
        reason: 'awaiting_move',
      });
      await e.releaseLeavesHeldByClock();
      expect(cashout).not.toHaveBeenCalled();
      expect(e.leaveHeldByClock.get(id)).toBe(occ);
    });

    it('is released as before when the game has no other dealing table', async () => {
      const e = alone();
      playsOn.mockResolvedValue({
        keep: false,
        returned: false,
        handsRemaining: 7,
        reason: 'nobody_in_game',
      });
      cashout.mockResolvedValue(180);
      await e.releaseLeavesHeldByClock();
      expect(cashout).toHaveBeenCalledWith(
        id,
        TABLE,
        seat,
        expect.objectContaining({ occupancyId: occ })
      );
      expect(e.seatedPlayers.some((p: { user_id: string }) => p.user_id === id)).toBe(false);
    });

    it('is released as before when the database cannot answer', async () => {
      const e = alone();
      playsOn.mockResolvedValue(null);
      cashout.mockResolvedValue(180);
      await e.releaseLeavesHeldByClock();
      expect(cashout).toHaveBeenCalledTimes(1);
    });

    it('is never asked at a Lightning anchor or when someone else is at the table', async () => {
      const anchor = makeEngine();
      anchor.onLeaveRefusedAtSettlement(id, 0, occ);
      evaluate.mockResolvedValue([row(id)] as never);
      returnToPool.mockResolvedValue({ returned: false, handsRemaining: 0, reason: 'in_hand' });
      await anchor.releaseLeavesHeldByClock();
      expect(playsOn).not.toHaveBeenCalled();

      const shared = makeEngine({ anchor: false });
      shared.onLeaveRefusedAtSettlement(id, 0, occ);
      shared.chipContinuity.rows.set(id, row(id));
      await shared.releaseLeavesHeldByClock();
      expect(playsOn).not.toHaveBeenCalled();
    });
  });
}
