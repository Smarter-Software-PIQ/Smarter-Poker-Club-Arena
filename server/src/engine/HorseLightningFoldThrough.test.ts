/**
 * LIGHTNING EARLY FOLD NEEDS THE FOLD-THROUGH (2026-11-15, default OFF): the public-state reading
 * of "seats still to act before the Horse", the fold-through frame, and the HorseLogic.decide rule
 * (asked with an inner policy scripted through decideCaptured, so no card decides the outcome).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import {
  lightningFoldThroughFrame,
  lightningFoldThroughSeats,
} from './HorseLightningFoldThrough.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';

const id = (seat: number) => `00000000-0000-4000-8000-00000000000${seat}`;
const forced = (seat: number, amount: number) => ({
  seat,
  userId: id(seat),
  action: seat === 1 ? 'small_blind' : 'big_blind',
  amount,
  timestamp: 0,
  stage: 'preflop',
  origin: 'forced',
});
const act = (seat: number, action: string, stage = 'preflop', extra: object = {}) => ({
  seat,
  userId: id(seat),
  action,
  amount: 0,
  timestamp: 1,
  stage,
  origin: 'player',
  ...extra,
});

/** Six seats (1 SB, 2 BB, 3 UTG, 4 HJ, 5 CO, 6 BTN), Lightning cash, hero `hero` owing chips. */
function state(opts: {
  hero: number;
  stage?: string;
  history?: object[];
  folded?: number[];
  allIn?: number[];
  speed?: string;
  legal?: string[];
}): HorseGameStateV2 {
  const players = [1, 2, 3, 4, 5, 6].map((seat) => ({
    seat,
    user_id: id(seat),
    stack: 200,
    bet: seat === 2 ? 2 : seat === 1 ? 1 : 0,
    is_folded: (opts.folded ?? []).includes(seat),
    is_all_in: (opts.allIn ?? []).includes(seat),
    cards: [],
  }));
  return {
    heroSeat: opts.hero,
    currentPlayerSeat: opts.hero,
    stage: opts.stage ?? 'preflop',
    toCall: 2,
    currentBet: 2,
    pot: 5,
    legalActions: opts.legal ?? ['fold', 'call', 'raise'],
    players,
    pots: [
      { amount: 5, eligiblePlayers: players.filter((p) => !p.is_folded).map((p) => p.user_id) },
    ],
    actionHistory: [forced(1, 1), forced(2, 2), ...(opts.history ?? [])],
    blindSeats: { smallBlind: 1, bigBlind: 2 },
    dealerSeat: 6,
    gameMode: 'cash',
    publicMemoryDomain: { speed: opts.speed ?? 'lightning' },
    communityCards: [],
  } as unknown as HorseGameStateV2;
}

afterEach(() => vi.restoreAllMocks());

describe('the seats still to act before the Horse (public state only)', () => {
  it('at the deal: every seat after the big blind up to the Horse', () => {
    expect(lightningFoldThroughSeats(state({ hero: 6 }), 6)).toEqual([3, 4, 5]);
    expect(lightningFoldThroughSeats(state({ hero: 1 }), 1)).toEqual([3, 4, 5, 6]);
  });
  it('a seat that has folded or acted since the last raise is not before it; the raiser restarts the count', () => {
    const h = [act(3, 'fold'), act(4, 'raise', 'preflop', { isFullRaise: true })];
    expect(lightningFoldThroughSeats(state({ hero: 1, history: h, folded: [3] }), 1)).toEqual([
      5, 6,
    ]);
    expect(lightningFoldThroughSeats(state({ hero: 6, history: h, folded: [3] }), 6)).toEqual([5]);
  });
  it('at the Horse’s own turn nobody is before it', () => {
    const h = [act(3, 'fold'), act(4, 'call'), act(5, 'fold')];
    expect(lightningFoldThroughSeats(state({ hero: 6, history: h, folded: [3, 5] }), 6)).toEqual(
      []
    );
  });
  it('an all-in seat does not act again', () => {
    expect(lightningFoldThroughSeats(state({ hero: 6, allIn: [4] }), 6)).toEqual([3, 5]);
  });
  it('flop: the seats between the bettor and the Horse', () => {
    const h = [
      act(3, 'raise', 'preflop', { isFullRaise: true }),
      act(4, 'call'),
      act(5, 'fold'),
      act(6, 'fold'),
      act(1, 'fold'),
      act(2, 'call'),
      act(2, 'check', 'flop'),
      act(3, 'bet', 'flop'),
    ];
    expect(
      lightningFoldThroughSeats(state({ hero: 2, stage: 'flop', history: h, folded: [1, 5, 6] }), 2)
    ).toEqual([4]);
  });
  it('outside the rule: the river, a table-speed hand, a free check', () => {
    expect(lightningFoldThroughSeats(state({ hero: 6, stage: 'river' }), 6)).toEqual([]);
    expect(lightningFoldThroughSeats(state({ hero: 6, speed: 'table' }), 6)).toEqual([]);
    expect(lightningFoldThroughSeats(state({ hero: 6, legal: ['check', 'raise'] }), 6)).toEqual([]);
  });
});

describe('the fold-through frame', () => {
  it('folds exactly those seats, in public state, and leaves the input unchanged', () => {
    const gs = state({ hero: 6 });
    const before = JSON.stringify(gs);
    const frame = lightningFoldThroughFrame(gs, [3, 4, 5], 7) as any;
    expect(JSON.stringify(gs)).toBe(before);
    expect(frame.players.filter((p: any) => p.is_folded).map((p: any) => p.seat)).toEqual([
      3, 4, 5,
    ]);
    expect(frame.actionHistory.slice(-3).map((a: any) => [a.seat, a.action, a.stage])).toEqual([
      [3, 'fold', 'preflop'],
      [4, 'fold', 'preflop'],
      [5, 'fold', 'preflop'],
    ]);
    expect(frame.pots[0].eligiblePlayers).toEqual([id(1), id(2), id(6)]);
    expect(frame.pots[0].amount).toBe(5);
    expect([frame.toCall, frame.legalActions, frame.heroSeat]).toEqual([
      2,
      ['fold', 'call', 'raise'],
      6,
    ]);
    expect(frame.players.every((p: any) => p.cards.length === 0)).toBe(true);
  });
  it('refuses a seat that cannot fold, and a pot it would empty', () => {
    expect(lightningFoldThroughFrame(state({ hero: 6, allIn: [4] }), [4], 0)).toBeNull();
    const gs = state({ hero: 6 }) as any;
    gs.pots.push({ amount: 3, eligiblePlayers: [id(3)] });
    expect(lightningFoldThroughFrame(gs, [3], 0)).toBeNull();
  });
});

describe('HorseLogic.decide with lightningEarlyFoldNeedsFoldThrough', () => {
  /** The inner policy: fold on the table as it stands; `frame` on the fold-through frame. */
  function script(frame: 'raise' | 'fold') {
    return vi.spyOn(HorseLogic as any, 'decideCaptured').mockImplementation((_p: any, gs: any) => {
      const isFrame = gs.players.some((p: any) => p.is_folded);
      const action = isFrame ? frame : 'fold';
      return { action, amount: action === 'raise' ? 5 : undefined, thinkTime: 1 } as any;
    });
  }
  const hero = { seat: 6, user_id: id(6), cards: [], stack: 200, bet: 0 } as any;

  it('a fold the frame does not make is replaced by the frame answer (the host then waits for the turn)', () => {
    const spy = script('raise');
    enableBrainTelemetry();
    drainFires();
    const d = HorseLogic.decide(
      hero,
      state({ hero: 6 }),
      'balanced',
      {},
      {
        lightningEarlyFoldNeedsFoldThrough: true,
        telemetry: true,
      }
    );
    expect(d.action).toBe('raise');
    expect(spy).toHaveBeenCalledTimes(2);
    // the frame is never learned
    expect((spy.mock.calls[1]![4] as any).observeMind).toBe(false);
    expect((spy.mock.calls[0]![4] as any).observeMind).toBeUndefined();
    const fired = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(fired.lightning_fold_through_released).toBe(1);
  });
  it('a trash fold stands when the frame folds too (the first answer is returned)', () => {
    const spy = script('fold');
    enableBrainTelemetry();
    drainFires();
    const d = HorseLogic.decide(
      hero,
      state({ hero: 6 }),
      'balanced',
      {},
      {
        lightningEarlyFoldNeedsFoldThrough: true,
        telemetry: true,
      }
    );
    expect(d.action).toBe('fold');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.results[0]!.value).toBe(d);
    const fired = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(fired.lightning_fold_through_kept).toBe(1);
  });
  it('no second ask: option off, the Horse’s own turn, the river, outside Lightning', () => {
    const spy = script('raise');
    const own = state({
      hero: 6,
      history: [act(3, 'fold'), act(4, 'fold'), act(5, 'fold')],
      folded: [3, 4, 5],
    });
    const cases: Array<[HorseGameStateV2, boolean]> = [
      [state({ hero: 6 }), false],
      [own, true],
      [state({ hero: 6, stage: 'river' }), true],
      [state({ hero: 6, speed: 'table' }), true],
    ];
    for (const [gs, on] of cases) {
      spy.mockClear();
      const d = HorseLogic.decide(
        hero,
        gs,
        'balanced',
        {},
        { lightningEarlyFoldNeedsFoldThrough: on }
      );
      expect(d.action).toBe(on && gs === own ? 'raise' : 'fold');
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });
});
