import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerTableEngine } from './ServerTableEngine.js';
import * as hourly from '../services/supabase/cashHourlyTables.js';
import * as freeze from '../maintenance/freezeState.js';
const id = '11111111-1111-4111-8111-111111111111';
const engines: any[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) e.preciseTimer.dispose();
  vi.restoreAllMocks();
});
function engine() {
  const e = new ServerTableEngine(id) as any;
  engines.push(e);
  e.running = true;
  e.lifecycleCanMutate = () => true;
  e.isBetweenHands = () => true;
  e.isTournamentTable = () => false;
  e.getEngineLeaseAuthority = () => ({ scope: 'cash', verified: true, generation: id });
  e.acquireSeatBoundary = vi.fn(async () => vi.fn());
  e.releaseDepartedSeats = vi.fn();
  e.broadcastCurrentState = vi.fn();
  e.hub = { emitEvent: vi.fn() };
  e.stop = vi.fn(() => new Promise(() => {}));
  vi.spyOn(freeze, 'isMaintenanceFrozen').mockReturnValue(false);
  return e;
}
describe('hourly cash closure uses the original hand boundary', () => {
  it.each(['tournament', 'live hand', 'settlement', 'maintenance', 'unverified owner'])(
    'never submits a closure during %s',
    async (condition) => {
      const e = engine();
      if (condition === 'tournament') e.isTournamentTable = () => true;
      if (condition === 'live hand') e.isBetweenHands = () => false;
      if (condition === 'settlement') e.postHandTasksPromise = Promise.resolve();
      if (condition === 'maintenance') vi.mocked(freeze.isMaintenanceFrozen).mockReturnValue(true);
      if (condition === 'unverified owner')
        e.getEngineLeaseAuthority = () => ({ scope: 'cash', verified: false });
      const close = vi.spyOn(hourly, 'closeHourlyCashTable');
      expect(await e.passHourlyCashBoundary()).toBe(false);
      expect(close).not.toHaveBeenCalled();
    }
  );
  it('continues human games and tables waiting on the gradual-close cadence', async () => {
    const e = engine();
    vi.spyOn(hourly, 'closeHourlyCashTable').mockResolvedValue({
      closed: false,
      reason: 'within_cap_or_human',
    });
    expect(await e.passHourlyCashBoundary()).toBe(false);
    expect(e.stop).not.toHaveBeenCalled();
  });
  it('retains the same operation after a lost response and never deals ahead', async () => {
    const e = engine();
    const close = vi
      .spyOn(hourly, 'closeHourlyCashTable')
      .mockRejectedValueOnce(new Error('transport timeout'))
      .mockResolvedValueOnce({ closed: false, reason: 'within_cap_or_human' });
    expect(await e.passHourlyCashBoundary()).toBe(true);
    expect(await e.passHourlyCashBoundary()).toBe(false);
    expect(close.mock.calls[0][1]).toBe(close.mock.calls[1][1]);
    expect(e.hourlyCashOperationId).toBe(null);
  });
  it('waits for a live Lightning hand without removing seats', async () => {
    const e = engine();
    vi.spyOn(hourly, 'closeHourlyCashTable').mockRejectedValue(
      new Error('LIGHTNING_HAND_IN_PROGRESS')
    );
    expect(await e.passHourlyCashBoundary()).toBe(false);
    expect(e.releaseDepartedSeats).not.toHaveBeenCalled();
    expect(e.stop).not.toHaveBeenCalled();
  });
  it('announces committed occupancies and stops without awaiting its own loop', async () => {
    const e = engine();
    vi.spyOn(hourly, 'closeHourlyCashTable').mockResolvedValue({
      closed: true,
      departures: [
        {
          ok: true,
          stack: 100,
          credited: true,
          seat_number: 2,
          occupancy_id: id,
          user_id: id,
          table_id: id,
          idempotency_key: 'cashout:occupancy:' + id,
          tournament_table: false,
        },
      ],
    });
    expect(await e.passHourlyCashBoundary()).toBe(true);
    expect(e.releaseDepartedSeats).toHaveBeenCalledWith([{ userId: id, occupancyId: id }]);
    expect(e.hub.emitEvent).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ type: 'seat_left', mid_hand: false })
    );
    expect(e.stop).toHaveBeenCalledOnce();
  });
});
