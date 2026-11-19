/**
 * THE F06 PERMIT IS RESERVED UNDER THE REST (hand delay, 2026-11-18).
 *
 * Dan 2026-11-17: finish a hand, move the button and start the next in under
 * a second, two at most; 2026-11-18: "i just don't want any 'un intended
 * delays'". A tournament table spent about 0.54 s after the 1.5 s rest on the
 * F06 state read and fn_f06_begin_hand. It now reserves inside the last
 * F06_RESERVE_LEAD_MS of the rest, then finishes the rest, re-applies the last
 * look and only then builds, retains and starts the hand.
 *
 * Pinned here, on the real dealHand, the real F06HandPermit and an RPC fake
 * that keeps SQL's one-reserved-permit-per-table rule:
 *   - the reservation happens before the rest ends, the hand never before it;
 *   - every hold that can arrive inside the remaining rest (maintenance,
 *     hand-for-hand, balancing move, final-table deal, terminal close-out,
 *     weekly payout, admin, Cluster halt, a stop) leaves no hand and releases
 *     the permit exactly once, through fn_f06_cancel_prepared_hand;
 *   - a lost release is finished by the next attempt, never a second permit;
 *   - a begin refused for a named reason (source_excluded) frees the slot,
 *     and the next attempt begins fresh instead of replaying the refusal;
 *   - a table without F06 admission (cash) is untouched.
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

const HOLDS: Array<[string, (engine: any) => void]> = [
  ['the maintenance break', (e) => e.pauseForMaintenance(300_000)],
  [
    'a hand-for-hand round',
    (e) => {
      e.handForHandPaused = true;
      e.holdBeforeNextHand = true;
    },
  ],
  ['a balancing move', (e) => e.tournamentMovePauseOwners.add('move-1')],
  ['a final-table deal', (e) => (e.finalTableDealPaused = true)],
  ['a terminal close-out', (e) => (e.terminalCloseoutPaused = true)],
  ['a weekly payout', (e) => e.weeklyPayoutPauseOwners.add('weekly-1')],
  ['an admin pause', (e) => (e.adminPauseLock = true)],
  ['a Cluster dealing halt', (e) => (e.dealingHaltLock = true)],
  ['an engine stop', (e) => (e.running = false)],
];

describe('the F06 permit is reserved under the rest', () => {
  it('only a tournament table with F06 admission reserves under the rest', () => {
    const f = fixture();
    expect(f.engine.reservesPermitUnderTheRest()).toBe(true);
    f.engine.tableInfo = { ...f.engine.tableInfo, game_type: 'cash', tournament_id: null };
    expect(f.engine.reservesPermitUnderTheRest()).toBe(false);
  });

  it('reserves before the rest ends and starts the hand only after it', async () => {
    const f = fixture();
    const restEndsAt = await f.armRestAndLead(1300);
    // The lead stopped about F06_RESERVE_LEAD_MS short of the rest.
    expect(restEndsAt - Date.now()).toBeGreaterThan(800);
    await f.dealsTheNextHand();
    expect(f.beginAt).toHaveLength(1);
    expect(f.beginAt[0]).toBeLessThan(restEndsAt - 500);
    expect(f.startedAt[0]).toBeGreaterThanOrEqual(restEndsAt);
    // The blind read rode the lead and was awaited before the controller.
    expect(f.engine.refreshBlinds).toHaveBeenCalledOnce();
    expect(f.engine.restBlindRead).toBeNull();
    expect(f.cancels()).toBe(0);
    expect(f.engine.dealAbandonedAtRestEnd).toBe(false);
  });

  it.each(HOLDS)(
    '%s arriving inside the remaining rest deals nothing and releases the permit exactly once',
    async (_name, hold) => {
      // Applied after the reservation, while dealHand waits out the rest.
      const f = fixture({ onBegin: () => void setTimeout(() => hold(f.engine), 100) });
      await f.armRestAndLead(1100);
      await f.engine.dealHand(f.seats);
      expect(f.started).not.toHaveBeenCalled();
      expect(f.engine.dealAbandonedAtRestEnd).toBe(true);
      expect(f.cancels()).toBe(1);
      expect([...f.db.values()].map((row) => row.state)).toEqual(['never_started']);
      expect(f.reserved()).toEqual([]);
      expect(f.engine.f06PermitPhase()).toBe('none');
      // A planned stop, not a recovery event.
      expect(f.recorded).not.toHaveBeenCalledWith(
        'unstarted_hand_permit_released',
        expect.anything()
      );
      // The hand number rewinds to the last completed hand.
      expect(f.engine.handCount).toBe(0);
    }
  );

  it('a release whose reply is lost is finished by the next attempt before any new permit', async () => {
    const f = fixture({
      loseCancelReply: 1,
      onBegin: (n) => {
        if (n === 1) setTimeout(() => (f.engine.adminPauseLock = true), 100);
      },
    });
    await f.armRestAndLead(1100);
    // The same pause path as a hold that arrives after the reservation always
    // had: the lost receipt surfaces to the loop's error handling, and the
    // permit stays held as a positive cancellation intent - never re-begun.
    await expect(f.engine.dealHand(f.seats)).rejects.toThrow(
      'f06_prepared_cancellation_unknown'
    );
    expect(f.started).not.toHaveBeenCalled();
    expect(f.engine.f06PermitPhase()).toBe('terminated');
    expect(f.engine.hasUnresolvedF06Preparation()).toBe(true);
    f.engine.adminPauseLock = false;
    await f.dealsTheNextHand();
    const names = f.rpc.mock.calls.map(([name]) => name);
    expect(names).toEqual([
      'fn_f06_begin_hand',
      'fn_f06_cancel_prepared_hand', // committed, reply lost
      'fn_f06_cancel_prepared_hand', // the exact replay, at the top of the next attempt
      'fn_f06_begin_hand',
    ]);
    const [first, replay] = f.rpc.mock.calls.filter(([n]) => n === 'fn_f06_cancel_prepared_hand');
    expect(replay[1]).toEqual(first[1]);
    expect([...f.db.values()].map((row) => row.state)).toEqual(['never_started', 'reserved']);
  });

  it('a begin refused for a named reason frees the slot and the next attempt begins fresh', async () => {
    const f = fixture({ refuseBegin: { 1: 'source_excluded' } });
    await f.armRestAndLead(1100);
    await expect(f.engine.dealHand(f.seats)).rejects.toThrow('f06_begin_refused:source_excluded');
    expect(f.engine.f06PermitPhase()).toBe('none');
    expect(f.cancels()).toBe(0); // Nothing was reserved; nothing to release.
    // The armed rest the attempt never finished stays for the loop; its blind
    // read is dropped so the next rest reads the level fresh.
    expect(f.engine.restFinishesInsideDeal).toBe(false);
    expect(f.engine.restBlindRead).toBeNull();
    await f.dealsTheNextHand();
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual([
      'fn_f06_begin_hand', // refused: source_excluded, no row
      'fn_f06_begin_hand', // a fresh permit, not a replay of the refused one
    ]);
    const [a, b] = f.rpc.mock.calls.map(([, input]) => input.p_permit_id);
    expect(a).not.toBe(b);
  });

  it('a table that does not reserve under the rest is dealt exactly as before', async () => {
    const f = fixture();
    f.engine.nextHandNotBeforeMs = Date.now() + 400;
    await f.engine.awaitNextHandRest();
    const restWaitedTo = Date.now();
    await f.dealsTheNextHand();
    expect(f.beginAt[0]).toBeGreaterThanOrEqual(restWaitedTo);
    expect(f.engine.dealAbandonedAtRestEnd).toBe(false);
  });
});
