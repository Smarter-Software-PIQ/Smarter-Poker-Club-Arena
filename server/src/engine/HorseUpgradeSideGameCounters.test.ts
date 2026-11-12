/**
 * Upgrade 08 evidence counters on the table engine: the run-it-twice answers a
 * Horse sends and the side-game context that reaches a Horse decision request.
 * Both drive the production method; nothing here calls noteFire itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HandController } from './HandController.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import type { HandConfig, SeatPlayer } from '../types.js';

const TABLE_ID = '11111111-2222-4333-8444-555555555555';
const HUMAN = 'human-seat';

const upgradeFires = (): Record<string, number> =>
  Object.fromEntries(
    drainFires()
      .filter((f) => f.feature.startsWith('upgrade08_'))
      .map((f) => [f.feature, f.fires])
  );

beforeEach(() => {
  enableBrainTelemetry();
  drainFires();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('upgrade 08: run-it-twice answers are counted where they are scheduled', () => {
  it('counts each Horse answer as respondToRIT later receives it, and no human', async () => {
    const proto = ServerTableEngine.prototype as any;
    const ids = ['horse-chooser', 'horse-b', 'horse-c', HUMAN];
    const calls: Array<{ pid: string; answer?: string; runs?: number }> = [];
    for (let handCount = 1; handCount <= 10; handCount++) {
      proto.scheduleHorseRITResponses.call(
        {
          tableId: TABLE_ID,
          running: true,
          handCount,
          seatedPlayers: ids.map((user_id) => ({ user_id, is_horse: user_id !== HUMAN })),
          isOwnClientControlling: () => false,
          setHandTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
          runItTwiceEngine: { hasPendingOffer: () => true, getState: () => ({ maxRuns: 3 }) },
          horseRitVerdict: proto.horseRitVerdict,
          respondToRIT: (pid: string, answer?: string, runs?: number) =>
            calls.push({ pid, answer, runs }),
        },
        ids[0],
        ids
      );
    }
    const counted = upgradeFires();
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);

    const count = (pick: (c: (typeof calls)[number]) => boolean) => calls.filter(pick).length;
    expect(counted).toEqual({
      upgrade08_rit_chooser_once_seen: count((c) => c.pid === ids[0] && c.runs === 1),
      upgrade08_rit_chooser_multi_seen: count((c) => c.pid === ids[0] && c.runs !== 1),
      upgrade08_rit_answer_accept_seen: count((c) => c.answer === 'accept'),
      upgrade08_rit_answer_decline_seen: count((c) => c.answer === 'decline'),
    });
    expect(Object.values(counted).every((n) => n > 0)).toBe(true);
    expect(calls).toHaveLength(30);
    expect(calls.some((c) => c.pid === HUMAN)).toBe(false);
  });
});

describe('upgrade 08: side-game context is counted at decision start', () => {
  /** A real engine and a real hand; the worker lane never answers. */
  async function decisionStart(side: { killPot?: boolean; sevenDeuce?: boolean }) {
    const engine = new ServerTableEngine(TABLE_ID) as any;
    engine.running = true;
    engine.lifecycleCanMutate = () => true;
    engine.getEngineLeaseAuthority = () => ({ verified: true, generation: 3 });
    engine.handCount = 5;
    engine.disconnectEngine = { isSittingOut: () => false };
    engine.tableInfo = {
      small_blind: 1,
      big_blind: 2,
      game_variant: 'nlh',
      action_time_seconds: 15,
      seven_deuce_enabled: side.sevenDeuce === true,
    };
    const hc = new HandController(
      {
        tableId: TABLE_ID,
        handNumber: 5,
        gameVariant: 'nlh',
        smallBlind: 1,
        bigBlind: 2,
        isTournament: false,
        rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
      } as HandConfig,
      [1, 2].map((seat) => ({
        seat,
        user_id: 'seat-' + seat,
        username: 'Seat' + seat,
        stack: 400,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      })) as SeatPlayer[],
      1
    );
    hc.start();
    if (side.killPot) (hc as any).state.killPot = { killerSeat: 2, multiplier: 2 };
    const state = hc.getState();
    const actor = state.players.find((p) => p.seat === state.currentPlayerSeat)!;
    const seated = { seat_number: actor.seat, user_id: actor.user_id, is_horse: true };
    engine.seatedPlayers = [seated];
    engine.handController = hc;
    const decideFast = vi.fn((_snap: any) => new Promise(() => {}));
    const laneMod = await import('./horseDecision/index.js');
    vi.spyOn(laneMod, 'getLiveHorseDecisionWorker').mockReturnValue({ decideFast } as any);

    engine.scheduleHorseAction(seated, actor.seat, actor, state);
    engine.cancelHorseDecisionWork();
    expect(decideFast).toHaveBeenCalledTimes(1);
    return { fires: upgradeFires(), gameState: decideFast.mock.calls[0][0].gameState };
  }

  it('counts nothing when the hand has neither a kill pot nor the seven-deuce game', async () => {
    const { fires, gameState } = await decisionStart({});
    expect(gameState.killPot).toBeUndefined();
    expect(gameState.sevenDeuceEnabled).toBeUndefined();
    expect(fires).toEqual({});
  });

  it('counts a kill pot once, and only the kill pot', async () => {
    const { fires, gameState } = await decisionStart({ killPot: true });
    expect(gameState.killPot).toMatchObject({ multiplier: 2 });
    expect(fires).toEqual({ upgrade08_kill_pot_seen: 1 });
  });

  it('counts the seven-deuce game once, and only the seven-deuce game', async () => {
    const { fires, gameState } = await decisionStart({ sevenDeuce: true });
    expect(gameState.sevenDeuceEnabled).toBe(true);
    expect(fires).toEqual({ upgrade08_seven_deuce_seen: 1 });
  });
});
