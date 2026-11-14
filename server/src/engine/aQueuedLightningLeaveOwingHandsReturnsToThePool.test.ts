/**
 * #10740 (2026-11-13): a leave queued behind a live Lightning hand that then
 * owes hit-and-run hands was sat out and pending for ever - the pool never
 * deals such a seat, so the owed hands could never be played. Now the held
 * leave is returned to the pool as a blind off (the owner's rule for a leave
 * with hands owed), and an anchor judges the count at the database's stack,
 * not the roster's stale one. People and horses alike: every spec has twins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cashout = vi.fn();
const departure = vi.fn();
const cashoutVoluntary = vi.fn();
const evaluate = vi.fn(async () => []);
const blindOff = vi.fn(async (..._args: unknown[]) => true);
const returnToPool = vi.fn();

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
});
afterEach(() => deadlineScheduler.cancelAll(TABLE));

for (const [who, id, occ, seat] of [
  ['human', HUMAN, OCC_HUMAN, 1],
  ['horse', HORSE, OCC_HORSE, 2],
] as const) {
  describe(`${who}: a queued Lightning leave that owes hands`, () => {
    it('is returned to the pool as a blind off, played out, then cashed out', async () => {
      const e = makeEngine();
      expect(e.isLightningAnchorNow()).toBe(true);
      const sitBack = vi.spyOn(e.disconnectEngine, 'sitBack');
      // The queued leave's cash-out was refused by the count after its hand.
      e.onLeaveRefusedAtSettlement(id, 0, occ);
      expect(e.leaveHeldByClock.get(id)).toBe(occ);
      evaluate.mockResolvedValue([row(id)] as never);
      returnToPool.mockResolvedValue({ returned: true, handsRemaining: 7, reason: null });

      await e.releaseLeavesHeldByClock();

      expect(returnToPool).toHaveBeenCalledWith(id, TABLE, seat, occ);
      expect(cashoutVoluntary).not.toHaveBeenCalled();
      const seated = e.seatedPlayers.find((p: { user_id: string }) => p.user_id === id);
      expect(seated.leave_pending).toBe(false);
      expect(sitBack).toHaveBeenCalledWith(TABLE, id);
      expect(e.leaveHeldByClock.get(id)).toBe(occ);
      expect(blindOff).toHaveBeenCalledWith(TABLE, id, true);
      expect(e.hub.emitEvent).toHaveBeenCalledWith(
        TABLE,
        expect.objectContaining({ type: 'leave_blind_off', user_id: id, hands_remaining: 7 })
      );

      // Not pending any more: the next pass does not ask the door again.
      returnToPool.mockClear();
      await e.releaseLeavesHeldByClock();
      expect(returnToPool).not.toHaveBeenCalled();
      expect(cashoutVoluntary).not.toHaveBeenCalled();

      // The pool played the owed hands; the held leave cashes out.
      evaluate.mockResolvedValue([
        row(id, { hands_played: 10, hands_remaining: 0, hit_run_completed: true }),
      ] as never);
      cashoutVoluntary.mockResolvedValue({ ok: true, stack: 180 });
      await e.releaseLeavesHeldByClock();
      expect(cashoutVoluntary).toHaveBeenCalledWith(id, TABLE, seat, occ);
      expect(e.seatedPlayers.some((p: { user_id: string }) => p.user_id === id)).toBe(false);
    });

    it('is judged at the database stack when the roster stack is stale', async () => {
      // The roster still shows the buy-in; the pool has the seat at 180.
      const e = makeEngine({ rosterStack: 100 });
      e.onLeaveRefusedAtSettlement(id, 0, occ);
      evaluate.mockResolvedValue([row(id, { stack: 180 })] as never);
      returnToPool.mockResolvedValue({ returned: true, handsRemaining: 7, reason: null });
      await e.releaseLeavesHeldByClock();
      expect(returnToPool).toHaveBeenCalledTimes(1);
      expect(cashoutVoluntary).not.toHaveBeenCalled();
      expect(e.hitRunHandsOwed(id)).toBe(7);
    });

    it('keeps everything as it was and asks again when the database refuses or fails', async () => {
      const e = makeEngine();
      e.onLeaveRefusedAtSettlement(id, 0, occ);
      evaluate.mockResolvedValue([row(id)] as never);
      returnToPool.mockResolvedValueOnce({ returned: false, handsRemaining: 0, reason: 'in_hand' });
      returnToPool.mockResolvedValueOnce(null);
      await e.releaseLeavesHeldByClock();
      await e.releaseLeavesHeldByClock();
      const seated = e.seatedPlayers.find((p: { user_id: string }) => p.user_id === id);
      expect(returnToPool).toHaveBeenCalledTimes(2);
      expect(seated.leave_pending).toBe(true);
      expect(blindOff).not.toHaveBeenCalled();
      expect(e.leaveHeldByClock.get(id)).toBe(occ);
    });

    it('never touches a classic table: its own deal plays the blind off', async () => {
      const e = makeEngine({ anchor: false });
      e.onLeaveRefusedAtSettlement(id, 0, occ);
      e.chipContinuity.rows.set(id, row(id));
      await e.releaseLeavesHeldByClock();
      expect(returnToPool).not.toHaveBeenCalled();
    });

    it('a leave asked at an anchor is judged at the database stack, so it asks first instead of queuing', async () => {
      const e = makeEngine({ rosterStack: 100 });
      for (const p of e.seatedPlayers) p.leave_pending = false;
      evaluate.mockResolvedValue([row(id, { stack: 180 })] as never);
      const answer = await e.leaveTable(id);
      expect(answer).toMatchObject({
        success: false,
        code: 'LEAVE_LOCKED',
        needs_confirmation: true,
        hands_remaining: 7,
      });
      expect(departure).not.toHaveBeenCalled();
      expect(cashoutVoluntary).not.toHaveBeenCalled();
    });
  });
}

/**
 * 2026-11-13: an anchor re-reads every seat's hand count, so a horse (or a
 * person) whose debt was paid in the pool is no longer reported as owing it.
 * Off-duty horses at anchors sat on a stale "owes" answer for hours.
 */
describe('an anchor re-reads every seat hand count', () => {
  it('asks the database for every seat, at most every 30 seconds, and adopts the answer', async () => {
    const e = makeEngine();
    e.seatedPlayers.forEach((p: { leave_pending: boolean }) => (p.leave_pending = false));
    evaluate.mockResolvedValue([
      row(HUMAN, { hands_remaining: 0, leave_locked: false }),
      row(HORSE, { hands_remaining: 0, leave_locked: false }),
    ] as never);
    await e.refreshAnchorContinuity();
    expect(evaluate).toHaveBeenCalledTimes(1);
    const entries = (evaluate.mock.calls[0] as unknown[])[1] as Array<{ user_id: string }>;
    expect(entries.map((x) => x.user_id).sort()).toEqual([HUMAN, HORSE].sort());
    for (const id of [HUMAN, HORSE])
      expect(Number(e.chipContinuity.row(id)?.hands_remaining)).toBe(0);
    await e.refreshAnchorContinuity();
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('never asks at a classic table', async () => {
    const e = makeEngine({ anchor: false });
    await e.refreshAnchorContinuity();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('is called from the halted loop before held leaves are released', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./ServerTableEngineBase.ts', import.meta.url), 'utf8');
    const i = src.indexOf('await this.refreshAnchorContinuity();');
    expect(i).toBeGreaterThan(0);
    expect(src.indexOf('await this.releaseLeavesHeldByClock();', i)).toBeGreaterThan(i);
  });
});
