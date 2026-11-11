import { afterEach, describe, expect, it, vi } from 'vitest';

const published = vi.hoisted(() =>
  vi.fn(async (_tableId: string, _payload: Record<string, unknown>) => {})
);
vi.mock('../services/timeBankBroadcast.js', () => ({ broadcastTimeBankActivation: published }));
vi.mock('../services/supabase/client.js', () => ({ supabase: {}, maintenanceSupabase: {} }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));

import { ServerTableEngine } from './ServerTableEngine.js';
import { HandContinuationLane, type HandContinuationBatch } from './HandContinuationLane.js';

const engines: any[] = [];

afterEach(() => {
  for (const e of engines.splice(0)) {
    if (e.horseActionTimer) {
      clearTimeout(e.horseActionTimer);
      e.horseActionTimer = null;
    }
    e.handContinuation?.close();
    e.preciseTimer.dispose();
    e.engineTelemetry.dispose();
  }
  published.mockClear();
  vi.useRealTimers();
});

function createTournamentHorseFixture() {
  const e: any = new ServerTableEngine('f06-tournament-horse-tank');
  engines.push(e);
  const state = {
    currentPlayerSeat: 3,
    currentBet: 100,
    minRaise: 100,
    pot: 350,
    communityCards: [],
    stage: 'river',
    players: [{ user_id: 'horse-1', seat: 3, bet: 0, stack: 1500 }],
  };
  e.handController = {
    getState: () => state,
  };
  e.lifecycleCanMutate = () => true;
  e.isOwnClientControlling = () => false;
  e.seatedPlayers = [{ user_id: 'horse-1', seat_number: 3, is_horse: true }];
  e.timeBankEngine.configure(e.tableId, { secondsPerUse: 20 });
  e.timeBankEngine.initializePlayer(e.tableId, 'horse-1', {
    remainingSeconds: 40,
    usesRemaining: 2,
  });
  e.hub = { emitEvent: vi.fn() };
  const retained: HandContinuationBatch[] = [];
  const dispatch = (event: any) => e.dispatchContinuationTimeBank(event.event);
  e.handContinuation = new HandContinuationLane(
    0,
    () => JSON.stringify({ stage: 'river' }),
    () => e.captureContinuationEngine(),
    async (batch) => {
      retained.push(structuredClone(batch));
    },
    dispatch,
    () => true,
    (error) => {
      throw error;
    }
  );
  return { e, state, retained, dispatch };
}

describe('F06 tournament continuation time-bank preserves live Horse tank', () => {
  it('does NOT cancel or restart a live horseActionTimer tank when CONTINUATION_TIME_BANK publishes', async () => {
    vi.useFakeTimers();
    const { e } = createTournamentHorseFixture();
    const scheduleSpy = vi.spyOn(e, 'scheduleHorseAction');

    let tankCommitted = false;
    const abortController = new AbortController();
    e.horseDecisionAbortController = abortController;
    const liveTankTimer = setTimeout(() => {
      tankCommitted = true;
      e.horseActionTimer = null;
    }, 6_000);
    e.horseActionTimer = liveTankTimer;

    // Primary turn clock expires at 2s into the deliberate Hollywood tank, triggering durable time-bank continuation.
    await vi.advanceTimersByTimeAsync(2_000);
    e.timeBankEngine.onPrimaryTimerExpired(e.tableId, 'horse-1', () => {}, true);
    await e.handContinuation.join();

    // Paid time bank published, AND the live tank timer + abortController were preserved untouched.
    expect(published).toHaveBeenCalledTimes(1);
    expect(e.playerTurnDuration).toBe(20);
    expect(scheduleSpy).not.toHaveBeenCalled();
    expect(abortController.signal.aborted).toBe(false);
    expect(e.horseActionTimer).toBe(liveTankTimer);
    expect(tankCommitted).toBe(false);

    // Advance the remaining 4s of the deliberate tank: original decision commits on schedule.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(tankCommitted).toBe(true);
  });

  it('does NOT restart scheduleHorseAction while an in-flight worker decision (horseDecisionAbortController) is still active', async () => {
    const { e } = createTournamentHorseFixture();
    const scheduleSpy = vi.spyOn(e, 'scheduleHorseAction');

    const inFlightController = new AbortController();
    e.horseDecisionAbortController = inFlightController;
    e.horseActionTimer = null;

    e.timeBankEngine.onPrimaryTimerExpired(e.tableId, 'horse-1', () => {}, true);
    await e.handContinuation.join();

    expect(published).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).not.toHaveBeenCalled();
    expect(inFlightController.signal.aborted).toBe(false);
  });

  it('schedules scheduleHorseAction normally on recovery continuation when no live timer or active abortController exists', async () => {
    const { e, retained } = createTournamentHorseFixture();
    // Simulate durable retain before crash so we can replay onto a fresh recovery engine.
    e.handContinuation.close();
    let savedBatch: HandContinuationBatch | undefined;
    e.handContinuation = new HandContinuationLane(
      0,
      () => '{}',
      () => e.captureContinuationEngine(),
      async (batch) => {
        savedBatch = structuredClone(batch);
        throw new Error('Simulated crash after retain');
      },
      async () => {},
      () => true,
      () => {}
    );
    e.timeBankEngine.onPrimaryTimerExpired(e.tableId, 'horse-1', () => {}, true);
    await expect(e.handContinuation.join()).rejects.toThrow('Simulated crash after retain');
    expect(savedBatch).toBeDefined();
    void retained;

    const recovered = createTournamentHorseFixture();
    const scheduleSpy = vi.spyOn(recovered.e, 'scheduleHorseAction').mockImplementation(() => {});
    const bankCapture: any = (savedBatch!.engine.timeBanks as any[])[0];
    recovered.e.timeBankEngine.restorePlayerForRecovery(
      recovered.e.tableId,
      'horse-1',
      bankCapture.bank,
      Number(savedBatch!.engine.capturedAt)
    );

    expect(recovered.e.horseActionTimer).toBeNull();
    expect(recovered.e.horseDecisionAbortController).toBeNull();

    recovered.dispatch(savedBatch!.events[0]);

    expect(published).toHaveBeenCalledTimes(1);
    expect(recovered.e.playerTurnDuration).toBe(20);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).toHaveBeenCalledWith(
      recovered.e.seatedPlayers[0],
      3,
      recovered.state.players[0],
      recovered.state
    );
  });
});
