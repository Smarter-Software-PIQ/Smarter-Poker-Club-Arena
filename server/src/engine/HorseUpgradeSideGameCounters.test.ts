/**
 * Upgrade 08 evidence counters on the table engine: the run-it-twice answers a
 * Horse sends and the side-game context that reaches a Horse decision request.
 * Both drive the production method; nothing here calls noteFire itself.
 *
 * 2026-11-14: the opportunity/invocation pairs. An insurance offer to a Horse
 * leader is counted where the answer is scheduled (the answers are a subset),
 * and the brain counts the kill-pot and seven-deuce reads it actually made in
 * a decision, so a zero separates "no table offered it" from "it never ran".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HandController } from './HandController.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import type { Card, HandConfig, SeatPlayer } from '../types.js';

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
  async function decisionStart(side: {
    killPot?: boolean;
    /** A full KillHandState, as the dealer writes it. */
    killState?: Record<string, unknown>;
    sevenDeuce?: boolean;
  }) {
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
    if (side.killState) (hc as any).state.killPot = side.killState;
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
    const snapshot = decideFast.mock.calls[0][0];
    return { fires: upgradeFires(), gameState: snapshot.gameState, snapshot };
  }

  it('hands the brain what it reads: the request the engine built makes the brain count its read', async () => {
    const brainReads = (snapshot: any) => {
      HorseMind.reset();
      seedFastRandom(20261114);
      HorseLogic.decide(
        snapshot.player,
        snapshot.gameState,
        'grinder',
        {},
        {
          telemetry: true,
          mind: false,
        }
      );
      return upgradeFires();
    };
    const sevenDeuce = await decisionStart({ sevenDeuce: true });
    expect(sevenDeuce.fires).toEqual({ upgrade08_seven_deuce_seen: 1 });
    expect(brainReads(sevenDeuce.snapshot).upgrade08_seven_deuce_overlay_seen).toBe(1);

    const kill = await decisionStart({
      killState: {
        multiplier: { num: 2, den: 1 },
        baseBigBlind: 2,
        killBlind: 4,
        killerSeat: 2,
        killerBlindSlot: 'bb',
      },
    });
    expect(kill.fires).toEqual({ upgrade08_kill_pot_seen: 1 });
    expect(brainReads(kill.snapshot).upgrade08_kill_pot_orbit_seen).toBe(1);

    // Neither game: the brain counts no side-game read on the same request shape.
    const plain = await decisionStart({});
    expect(brainReads(plain.snapshot)).toEqual({});
  });

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

describe('upgrade 08: an insurance offer to a Horse leader is counted once, where it is scheduled', () => {
  const LEADER = 'leader-seat';
  const ANSWERS = ['decline', 'accept', 'cashout'].map((a) => `upgrade08_insurance_${a}_seen`);
  /** The production scheduler on a minimal engine; `offers` is what the timer finds. */
  async function offer(o: { horse: boolean; ownClient?: boolean; offers?: unknown[] }) {
    const answers: string[] = [];
    (ServerTableEngine.prototype as any).scheduleHorseInsuranceResponse.call(
      {
        tableId: TABLE_ID,
        running: true,
        handCount: 9,
        seatedPlayers: [{ user_id: LEADER, is_horse: o.horse }],
        isOwnClientControlling: () => o.ownClient === true,
        lifecycleCanMutate: () => true,
        setHandTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        insuranceEngine: {
          getOffers: () => o.offers ?? [{ playerId: LEADER, status: 'offered' }],
        },
        respondToInsurance: (_pid: string, decision: string) => answers.push(decision),
      },
      LEADER
    );
    const atSchedule = upgradeFires();
    await vi.advanceTimersByTimeAsync(1_500);
    return { atSchedule, afterTimer: upgradeFires(), answers };
  }

  it('counts the offer at scheduling, before any answer, and the answer after it', async () => {
    const r = await offer({ horse: true });
    expect(r.atSchedule).toEqual({ upgrade08_insurance_offered_seen: 1 });
    expect(r.answers).toEqual(['decline']);
    expect(r.afterTimer).toEqual({ upgrade08_insurance_decline_seen: 1 });
  });

  it('counts nothing for a person, or for a Horse seat its own client is driving', async () => {
    for (const who of [{ horse: false }, { horse: true, ownClient: true }]) {
      const r = await offer(who);
      expect(r.atSchedule).toEqual({});
      expect(r.afterTimer).toEqual({});
      expect(r.answers).toEqual([]);
    }
  });

  it('keeps answers a subset: an offer retired before the timer is offered and never answered', async () => {
    const r = await offer({ horse: true, offers: [] });
    expect(r.atSchedule).toEqual({ upgrade08_insurance_offered_seen: 1 });
    expect(r.answers).toEqual([]);
    expect(ANSWERS.filter((k) => k in r.afterTimer)).toEqual([]);
  });
});

describe('upgrade 08: the brain counts the kill-pot and seven-deuce reads it made', () => {
  const suit = (c: string) =>
    ({ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' })[c] as Card['suit'];
  const cards = (list: string[]): Card[] =>
    list.map((t) => ({ rank: t[0] === 'T' ? '10' : t[0], suit: suit(t[1]) }) as Card);
  const seat = (n: number, hole: Card[], bet = 0): SeatPlayer =>
    ({
      seat: n,
      user_id: 'seat-' + n,
      username: 'Seat' + n,
      stack: 400 - bet,
      bet,
      totalInvested: bet,
      cards: hole,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    }) as unknown as SeatPlayer;
  /** A 2x kill hand at 1/2: seat 4 killed, posted 4 outside the blinds. */
  const KILL = {
    ruleVersion: 1,
    mode: 'full',
    multiplier: { num: 2, den: 1 },
    baseBigBlind: 2,
    smallBet: 4,
    bigBet: 8,
    killBlind: 4,
    killerUserId: 'seat-4',
    killerSeat: 4,
    killerBlindSlot: 'none',
    triggerHandId: null,
    triggerHandNumber: 4,
    chained: false,
    thresholdBb: 10,
  };

  /** One real HorseLogic decision for seat 1 (the button), telemetry on or off. */
  function decide(
    o: {
      hole: string[];
      board?: string[];
      kill?: boolean;
      /** A raise to 12 over the kill blind before the Horse acts. */
      raised?: boolean;
      sevenDeuce?: boolean;
      tournament?: boolean;
    },
    telemetry: boolean
  ) {
    HorseMind.reset();
    seedFastRandom(20261114);
    drainFires();
    const postflop = (o.board?.length ?? 0) >= 3;
    const hero = seat(1, cards(o.hole), postflop ? 0 : 0);
    const players = [
      hero,
      seat(2, [], postflop ? 0 : 1),
      seat(3, [], postflop ? 20 : 2),
      seat(4, [], postflop ? 0 : o.raised ? 12 : o.kill ? 4 : 0),
    ];
    const currentBet = postflop ? 20 : o.raised ? 12 : o.kill ? 4 : 2;
    const gs = {
      stateSchemaVersion: 1,
      players,
      communityCards: cards(o.board ?? []),
      pot: postflop ? 60 : players.reduce((sum, p) => sum + p.bet, 0),
      currentBet,
      minRaise: postflop ? 20 : o.raised ? 8 : currentBet,
      stage: postflop ? 'flop' : 'preflop',
      gameVariant: 'nlh',
      smallBlind: 1,
      bigBlind: 2,
      dealerSeat: 1,
      heroSeat: 1,
      currentPlayerSeat: 1,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      toCall: currentBet,
      minRaiseTo: currentBet * 2,
      maxRaiseTo: 400,
      gameMode: o.tournament ? 'tournament' : 'cash',
      format: o.tournament ? 'tournament' : 'cash',
      dealtSeatIds: [1, 2, 3, 4],
      actionHistory: postflop
        ? [
            { seat: 3, action: 'raise', amount: 6, stage: 'preflop' },
            { seat: 1, action: 'call', amount: 6, stage: 'preflop' },
            { seat: 3, action: 'bet', amount: 20, stage: 'flop' },
          ]
        : o.raised
          ? [{ seat: 4, action: 'raise', amount: 12, stage: 'preflop' }]
          : [],
      ...(o.kill ? { killPot: KILL } : {}),
      ...(o.sevenDeuce ? { sevenDeuceEnabled: true, sevenDeuceBountyBB: 2 } : {}),
    } as unknown as HorseGameStateV2;
    const decision = HorseLogic.decide(hero, gs, 'grinder', {}, { telemetry, mind: false });
    return {
      fires: upgradeFires(),
      decision: {
        action: decision.action,
        amount: decision.amount,
        thinkTime: decision.thinkTime,
      },
    };
  }

  it('kill pot, unopened: the orbit read and the unopened adjustment are each counted once', () => {
    expect(decide({ hole: ['Ah', 'Kh'], kill: true }, true).fires).toEqual({
      upgrade08_kill_pot_orbit_seen: 1,
      upgrade08_kill_pot_unopened_seen: 1,
    });
  });

  it('kill pot, raised: the orbit read is counted and the unopened adjustment is not', () => {
    expect(decide({ hole: ['Ah', 'Kh'], kill: true, raised: true }, true).fires).toEqual({
      upgrade08_kill_pot_orbit_seen: 1,
    });
  });

  it('seven-deuce, preflop: the overlay read always, the bounty only when the Horse holds 7-2', () => {
    expect(decide({ hole: ['7h', '2c'], sevenDeuce: true }, true).fires).toEqual({
      upgrade08_seven_deuce_overlay_seen: 1,
      upgrade08_seven_deuce_bounty_seen: 1,
    });
    expect(decide({ hole: ['Ah', 'Kh'], sevenDeuce: true }, true).fires).toEqual({
      upgrade08_seven_deuce_overlay_seen: 1,
    });
  });

  it('seven-deuce, postflop: the overlay read always, the bounty only when the Horse holds 7-2', () => {
    const board = ['7s', '9d', '3c'];
    expect(decide({ hole: ['7h', '2c'], board, sevenDeuce: true }, true).fires).toEqual({
      upgrade08_seven_deuce_overlay_seen: 1,
      upgrade08_seven_deuce_bounty_seen: 1,
    });
    expect(decide({ hole: ['Ah', 'Kh'], board, sevenDeuce: true }, true).fires).toEqual({
      upgrade08_seven_deuce_overlay_seen: 1,
    });
  });

  it('counts nothing when the game is off, or in a tournament where seven-deuce does not apply', () => {
    expect(decide({ hole: ['7h', '2c'] }, true).fires).toEqual({});
    expect(decide({ hole: ['7h', '2c'], board: ['7s', '9d', '3c'] }, true).fires).toEqual({});
    expect(decide({ hole: ['7h', '2c'], sevenDeuce: true, tournament: true }, true).fires).toEqual(
      {}
    );
  });

  it('is silent with telemetry off, and the action, amount and think time are the same', () => {
    const spots = [
      { hole: ['Ah', 'Kh'], kill: true },
      { hole: ['Ah', 'Kh'], kill: true, raised: true },
      { hole: ['7h', '2c'], sevenDeuce: true },
      { hole: ['7h', '2c'], board: ['7s', '9d', '3c'], sevenDeuce: true },
      { hole: ['Ah', 'Kh'], board: ['7s', '9d', '3c'], sevenDeuce: true },
    ];
    for (const spot of spots) {
      const on = decide(spot, true);
      const off = decide(spot, false);
      expect(Object.keys(on.fires).length, JSON.stringify(spot)).toBeGreaterThan(0);
      expect(off.fires).toEqual({});
      expect(off.decision).toEqual(on.decision);
    }
  });
});
