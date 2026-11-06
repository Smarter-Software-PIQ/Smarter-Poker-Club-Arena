/**
 * A CLOCK EXPIRY BELONGS TO ITS TURN (2026-11-05).
 *
 * WHAT WAS SEEN, READ FROM PRODUCTION
 *
 * Engine 71087373, 2026-11-05. Hand 039c0140 (NLH final table, horse
 * 6471a019, seat 5) and hand 8d98aeb8 (PLO4 heads-up, horse d7b99137, seat 1):
 *   - the horse's preflop action landed at 17.0 s into its turn, the same
 *     instant its 15 s clock plus 2 s grace ran out ("Auto-activated time
 *     bank" logged 11 ms and 60 ms after the action);
 *   - the same seat was first to act on the flop, so the expiry's seat check
 *     passed and the automatic bank was spent for a turn that had ended;
 *   - the activation is published through the durable hand lane 0.7 s later,
 *     and "this player is the current seat" was still true on the flop, so
 *     the 20 s countdown was armed on the FLOP turn, after which the flop's
 *     own TURN_CHANGE reset timeBankActivatedThisTurn and the FSM, so the
 *     horse's flop action released nothing (no TIME_BANK_STOPPED in the log);
 *   - 20 s later, on the TURN street, the orphaned countdown fired: "Time bank
 *     expiry: FSM in 'timer_running' but seat N is still current - resolving
 *     anyway", forceResolveSeat cancelled the brain's turn decision and
 *     recorded a forced check that reads exactly like a blind post.
 *
 * THE RULES THIS FILE PINS
 *
 *   1. A clock expiry acts only on the turn it was armed for. The same seat
 *      on the next street is a different turn: nothing is spent, nothing is
 *      forced.
 *   2. A deferred bank activation is published only onto the turn that spent
 *      it. Any other turn retires it and keeps its own ordinary clock.
 *   3. A seat's action ends any bank it holds, whatever this turn's flag says.
 *   4. A horse turn the engine resolves leaves horse_turn_resolved_without_decision
 *      with its reason, never a silent 'forced' row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
const published = vi.hoisted(() =>
  vi.fn(async (_tableId: string, _payload: Record<string, unknown>) => {})
);
vi.mock('../services/timeBankBroadcast.js', () => ({ broadcastTimeBankActivation: published }));
vi.mock('../services/supabase/client.js', () => ({ supabase: {}, maintenanceSupabase: {} }));
import { ServerTableEngine } from './ServerTableEngine.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';

const TABLE = 'cccccccc-1105-4000-8000-0000000c10c5';
const HORSE = 'horse-5';
const engines: any[] = [];

function fires(): Map<string, number> {
  return new Map(drainFires().map((r) => [r.feature, r.fires]));
}

function harness() {
  enableBrainTelemetry();
  drainFires();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  const engine = new ServerTableEngine(TABLE) as any;
  engines.push(engine);
  engine.running = true;
  engine.isCurrentEngine = () => true;
  engine.lifecycleCanMutate = () => true;
  engine.tableInfo = { action_time_seconds: 15 };
  const state = {
    stage: 'preflop',
    currentPlayerSeat: 5,
    currentBet: 0,
    actionHistory: [{}, {}, {}] as object[],
    players: [{ user_id: HORSE, seat: 5, bet: 0, stack: 100 }],
  };
  const performAction = vi.fn(() => true);
  engine.handController = { getState: () => state, performAction };
  engine.seatedPlayers = [{ user_id: HORSE, seat_number: 5, is_horse: true }];
  engine.hub = { emitEvent: vi.fn() };
  engine.markProgress = vi.fn();
  const recovery = vi.spyOn(engine, 'recordRecoveryEvent');
  // The durable hand lane: activations are retained and published later.
  const lane: any[] = [];
  engine.handContinuation = {
    enqueue: (event: any) => lane.push(structuredClone(event)),
    isUnretained: () => false,
    checkpoint: () => {},
  };
  engine.timeBankEngine.configure(TABLE, { secondsPerUse: 20, autoActivate: true });
  engine.timeBankEngine.initializePlayer(TABLE, HORSE, { remainingSeconds: 40, usesRemaining: 2 });
  vi.spyOn(engine.disconnectEngine, 'isConnected').mockReturnValue(true);
  const clocks = vi.spyOn(engine.preciseTimer, 'startTimer');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  /** Fire the most recently armed clock for a key the way the scheduler does. */
  const expire = (key: string) => {
    const call = clocks.mock.calls.filter((args) => args[1] === key).at(-1);
    expect(call, `a clock for ${key} must have been armed`).toBeDefined();
    engine.preciseTimer.cancelTimer(TABLE, key);
    (call![3] as () => void)();
  };
  /** The seat acts and the street closes with the same seat first to act. */
  const seatActsAndStreetAdvances = (nextStage: string) => {
    state.actionHistory.push({});
    state.stage = nextStage;
    engine.settleHorseSeatActed(HORSE);
  };
  /** What handleTurnChange does to the clock state for a genuinely new turn. */
  const newTurn = () => {
    engine.timeBankActivatedThisTurn = false;
    engine.timeBankSuppressedThisTurn = false;
    if (engine.turnFSM.state !== 'waiting') engine.turnFSM.reset('waiting');
    engine.turnFSM.transition('timer_running');
    engine.startTurnTimer(HORSE, 5, 15);
  };
  const bank = () => engine.timeBankEngine.getPlayerBank(TABLE, HORSE);
  return {
    engine,
    state,
    now,
    lane,
    expire,
    performAction,
    recovery,
    newTurn,
    seatActsAndStreetAdvances,
    bank,
  };
}

afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.timeBankEngine.dispose(TABLE);
    engine.preciseTimer.dispose();
    engine.engineTelemetry?.dispose?.();
  }
  drainFires();
  vi.restoreAllMocks();
});

describe('a clock expiry belongs to its turn', () => {
  it('the production shape: an activation spent in the same instant as the action never becomes a countdown on a later turn', () => {
    const h = harness();
    h.newTurn(); // preflop, seat 5 on the clock
    const preflopIdentity = h.engine.turnClockIdentity;
    expect(preflopIdentity).toBe('preflop:3:5');

    // 17.0 s: the clock runs out and the automatic bank is spent, deferred
    // to the lane. In production the horse's own action landed in the same
    // instant; here it lands right after, before the lane publishes.
    h.now.mockReturnValue(Date.now() + 17_000);
    h.expire(HORSE);
    expect(h.lane).toHaveLength(1);
    expect(h.lane[0].event).toMatchObject({ type: 'TIME_BANK_ACTIVATED', seat: 5 });
    expect(h.lane[0].event.turnIdentity).toBe(preflopIdentity);
    expect(h.engine.timeBankEngine.getUsesRemaining(TABLE, HORSE)).toBe(1);

    // The seat acts; the flop is dealt; the same seat is first to act again.
    h.seatActsAndStreetAdvances('flop');
    expect(h.state.currentPlayerSeat).toBe(5);

    // 0.7 s later the lane publishes the activation. The turn it was spent
    // for is over: it is retired, not armed on the flop turn.
    h.now.mockReturnValue(Date.now() + 700);
    h.engine.dispatchContinuationTimeBank(h.lane[0].event);
    expect(h.engine.preciseTimer.hasTimer(TABLE, `timebank:${HORSE}`)).toBe(false);
    expect(h.bank()?.isActive).toBe(false);
    expect(h.bank()?.pendingPublication).toBe(false);
    const after = fires();
    expect(after.get('time_bank_activation_retired_turn_ended')).toBe(1);

    // The flop turn starts on its ordinary clock, the horse acts, the turn
    // street starts, and nothing is left over to fire 20 s after the bank.
    h.newTurn();
    expect(h.engine.turnFSM.state).toBe('timer_running');
    h.now.mockReturnValue(Date.now() + 8_600);
    h.seatActsAndStreetAdvances('turn');
    h.newTurn();
    h.now.mockReturnValue(Date.now() + 11_000);
    expect(h.engine.preciseTimer.hasTimer(TABLE, `timebank:${HORSE}`)).toBe(false);
    expect(h.performAction).not.toHaveBeenCalled();
    expect(fires().get('horse_turn_resolved_without_decision')).toBeUndefined();
  });

  it('a primary clock that outlives its turn spends no bank and forces nothing on the next street', () => {
    const h = harness();
    h.newTurn();
    // The seat acted and the street advanced, but the deadline was not
    // cancelled (whatever the ordering inside the tick that let that happen).
    h.state.actionHistory.push({});
    h.state.stage = 'flop';
    h.now.mockReturnValue(Date.now() + 17_000);
    h.expire(HORSE);
    expect(h.lane).toHaveLength(0);
    expect(h.engine.timeBankEngine.getUsesRemaining(TABLE, HORSE)).toBe(2);
    expect(h.performAction).not.toHaveBeenCalled();
    expect(h.engine.turnFSM.state).toBe('timer_running');
    expect(fires().get('stale_turn_clock_expiry_ignored')).toBe(1);
  });

  it('a bank countdown that outlives its turn forces nothing on the next street', () => {
    const h = harness();
    h.engine.handContinuation = null; // the cash path arms the countdown at once
    h.newTurn();
    h.now.mockReturnValue(Date.now() + 17_000);
    h.expire(HORSE);
    expect(h.engine.turnFSM.state).toBe('time_bank_active');
    expect(h.engine.preciseTimer.hasTimer(TABLE, `timebank:${HORSE}`)).toBe(true);
    // The street closes with the same seat current, and the countdown is
    // somehow still armed when it runs out.
    h.state.actionHistory.push({});
    h.state.stage = 'flop';
    h.now.mockReturnValue(Date.now() + 20_000);
    h.expire(`timebank:${HORSE}`);
    expect(h.performAction).not.toHaveBeenCalled();
    expect(fires().get('stale_turn_clock_expiry_ignored')).toBe(1);
  });

  it("a seat's action ends an active bank even when this turn's flag is off", () => {
    const h = harness();
    h.engine.handContinuation = null;
    h.newTurn();
    h.now.mockReturnValue(Date.now() + 17_000);
    h.expire(HORSE);
    expect(h.bank()?.isActive).toBe(true);
    // What the production sequence left behind: an active countdown and a
    // turn flag that a later handleTurnChange had reset.
    h.engine.timeBankActivatedThisTurn = false;
    h.engine.settleHorseSeatActed(HORSE);
    expect(h.bank()?.isActive).toBe(false);
    expect(h.engine.preciseTimer.hasTimer(TABLE, `timebank:${HORSE}`)).toBe(false);
  });

  it('a horse turn the clock resolves leaves its receipt with the reason, and says the brain was cut off', () => {
    const h = harness();
    h.engine.handContinuation = null;
    h.newTurn();
    h.engine.horseDecisionAbortController = new AbortController();
    h.now.mockReturnValue(Date.now() + 17_000);
    h.expire(HORSE);
    h.now.mockReturnValue(Date.now() + 20_000);
    h.expire(`timebank:${HORSE}`);
    expect(h.performAction).toHaveBeenCalledWith(5, 'check', undefined, 'forced');
    const f = fires();
    expect(f.get('horse_turn_resolved_without_decision')).toBe(1);
    expect(f.get('horse_turn_resolved_without_decision_timebank_expired')).toBe(1);
    expect(f.get('horse_turn_resolved_without_decision_brain_pending')).toBe(1);
    expect(h.recovery).toHaveBeenCalledWith(
      'horse_turn_resolved_without_decision',
      expect.stringContaining('reason timebank_expired')
    );
  });

  it('a human seat the clock resolves leaves no horse receipt', () => {
    const h = harness();
    h.engine.seatedPlayers = [{ user_id: HORSE, seat_number: 5, is_horse: false }];
    h.engine.handContinuation = null;
    h.newTurn();
    h.now.mockReturnValue(Date.now() + 17_000);
    h.expire(HORSE);
    h.now.mockReturnValue(Date.now() + 20_000);
    h.expire(`timebank:${HORSE}`);
    expect(h.performAction).toHaveBeenCalledTimes(1);
    expect(fires().get('horse_turn_resolved_without_decision')).toBeUndefined();
    expect(h.recovery).not.toHaveBeenCalledWith(
      'horse_turn_resolved_without_decision',
      expect.anything()
    );
  });
});
