/**
 * LIGHTNING EARLY FOLD NEEDS THE FOLD-THROUGH (2026-11-15, default OFF): the public-state reading
 * of "seats still to act before the Horse", the fold-through frame, and the HorseLogic.decide rule
 * (asked with an inner policy scripted through decideCaptured, so no card decides the outcome).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import {
  lightningFoldThroughFrame,
  lightningFoldThroughFrameIsUnraisedLimp,
  lightningFoldThroughSeats,
} from './HorseLightningFoldThrough.js';
import { drainFires, enableBrainTelemetry, noteFire } from './BrainTelemetry.js';
import { fastRandom, restoreFastRandom, saveFastRandom, seedFastRandom } from './HorseEval.js';
import {
  clearStyleOptionsApplied,
  clearStyleShadowEngaged,
  noteStyleEngaged,
  noteStyleOptionApplied,
  takeStyleLiveEngaged,
  takeStyleOptionsApplied,
  takeStyleShadowEngaged,
} from './HorseStyleShadow.js';

/** Every reportError context, in order (the reporter itself is not run). */
const reported = vi.hoisted(() => [] as string[]);
vi.mock('../services/errorReporter.js', async (original) => ({
  ...(await original<typeof import('../services/errorReporter.js')>()),
  reportError: (_error: unknown, context: string) => {
    reported.push(context);
  },
}));

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

describe('the frame ask is a side ask (independent review of L-019, notes 2 and 3)', () => {
  const hero = { seat: 6, user_id: id(6), cards: [], stack: 200, bet: 0 } as any;
  const on = { lightningEarlyFoldNeedsFoldThrough: true, telemetry: true };
  const isFrame = (gs: any) =>
    gs.actionHistory.some((a: any) => a.action === 'fold' && a.timestamp === 0);
  function fresh() {
    reported.length = 0;
    clearStyleShadowEngaged();
    clearStyleOptionsApplied();
    enableBrainTelemetry();
    drainFires();
  }
  const firedNow = () => Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));

  it('the frame ask fires no brain receipt and leaves no style record; only the fold-through receipt is added', () => {
    fresh();
    // An inner policy that fires an ungated receipt and records style engagement on EVERY ask.
    const spy = vi
      .spyOn(HorseLogic as any, 'decideCaptured')
      .mockImplementation((_p: any, gs: any, _s: any, _m: any, o: any) => {
        const frame = isFrame(gs);
        noteFire('probe_ungated_receipt');
        if (o.telemetry === true) noteFire('probe_gated_receipt');
        noteStyleEngaged(frame ? 'styleFoldBluff' : 'styleRaiseRespect', 1, 'on');
        noteStyleEngaged(frame ? 'styleValueExtraction' : 'styleBigBetHonesty', 1, 'shadow');
        noteStyleOptionApplied(frame ? 'styleFoldBluff' : 'styleRaiseRespect');
        return { action: frame ? 'raise' : 'fold', amount: frame ? 5 : undefined, thinkTime: 1 };
      });
    const d = HorseLogic.decide(hero, state({ hero: 6 }), 'balanced', {}, on);
    expect(d.action).toBe('raise');
    expect(spy).toHaveBeenCalledTimes(2);
    expect((spy.mock.calls[1]![4] as any).telemetry).toBe(false);
    // exactly the first ask's receipts plus the fold-through's own
    expect(firedNow()).toEqual({
      probe_ungated_receipt: 1,
      probe_gated_receipt: 1,
      lightning_fold_through_released: 1,
    });
    // the decision reports the first ask's style records, none of the frame's
    expect(takeStyleLiveEngaged().map((e) => e.option)).toEqual(['styleRaiseRespect']);
    expect(takeStyleShadowEngaged().map((e) => e.option)).toEqual(['styleBigBetHonesty']);
    expect(takeStyleOptionsApplied()).toEqual(['styleRaiseRespect']);
    expect(reported).toEqual([]);
    // telemetry is counting again after the frame ask
    noteFire('probe_after');
    expect(firedNow()).toEqual({ probe_after: 1 });
  });

  it('a frame ask that throws inside the brain keeps the early fold and is not a decide_threw', () => {
    fresh();
    const real = (HorseLogic as any).decideCaptured as (...a: any[]) => any;
    const first = { action: 'fold', thinkTime: 1 };
    const spy = vi
      .spyOn(HorseLogic as any, 'decideCaptured')
      .mockImplementation((...a: any[]) => (isFrame(a[1]) ? real.apply(HorseLogic, a) : first));
    vi.spyOn(HorseLogic, 'prepareOriginalReads').mockImplementation(() => {
      throw new Error('frame brain failure');
    });
    const gs = { ...state({ hero: 6 }), gameVariant: 'nlh', stateSchemaVersion: 1 } as any;
    const d = HorseLogic.decide(hero, gs, 'balanced', {}, on);
    expect(d).toBe(first);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(reported).toEqual(['HorseLogic.lightning_fold_through_frame_threw']);
    expect(firedNow()).toEqual({});
    // Control (the same failure on a committed decision IS a decide_threw, counted).
    reported.length = 0;
    spy.mockImplementation((...a: any[]) => real.apply(HorseLogic, a));
    const net = HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true });
    expect(net.policyFallback).toBe('brain_exception');
    expect(reported).toEqual(['HorseLogic.decide_threw']);
    expect(firedNow().phase15_brain_exception).toBe(1);
  });

  it('a frame ask that throws outright keeps the early fold', () => {
    fresh();
    const first = { action: 'fold', thinkTime: 1 };
    const spy = vi
      .spyOn(HorseLogic as any, 'decideCaptured')
      .mockImplementation((_p: any, gs: any) => {
        if (isFrame(gs)) throw new Error('frame ask failure');
        return first;
      });
    expect(HorseLogic.decide(hero, state({ hero: 6 }), 'balanced', {}, on)).toBe(first);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(reported).toEqual(['HorseLogic.lightning_fold_through_frame_threw']);
    expect(firedNow()).toEqual({});
  });

  it('a malformed state keeps the early fold, as with the option off (no second ask)', () => {
    for (const breakIt of [
      (gs: any) => (gs.pots = [{ amount: 5 }]), // a pot with no eligible list
      (gs: any) => (gs.players = undefined), // no players array
    ]) {
      fresh();
      const first = { action: 'fold', thinkTime: 1 };
      const spy = vi.spyOn(HorseLogic as any, 'decideCaptured').mockImplementation(() => first);
      const gs = state({ hero: 6 }) as any;
      breakIt(gs);
      expect(HorseLogic.decide(hero, gs, 'balanced', {}, on)).toBe(first);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(HorseLogic.decide(hero, gs, 'balanced', {}, {})).toBe(first);
      expect(reported).toEqual(['HorseLogic.lightning_fold_through_frame_threw']);
      expect(firedNow()).toEqual({});
      spy.mockRestore();
    }
  });
});

describe('the root fixes of 2026-11-21 (authority file, "Why those limps and weaker entries occur in NLH")', () => {
  const on = { lightningEarlyFoldNeedsFoldThrough: true, telemetry: true };
  const firedNow = () => Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
  const sb = { seat: 1, user_id: id(1), cards: [], stack: 200, bet: 1 } as any;
  const btn = { seat: 6, user_id: id(6), cards: [], stack: 200, bet: 0 } as any;
  /** The inner policy: fold on the table as it stands; on the frame, `answer`. */
  function frameAnswers(answer: { action: string; preflopAuthority?: unknown }) {
    return vi.spyOn(HorseLogic as any, 'decideCaptured').mockImplementation((_p: any, gs: any) => {
      const isFrame = gs.players.some((p: any) => p.is_folded);
      return (isFrame ? { ...answer, thinkTime: 1 } : { action: 'fold', thinkTime: 1 }) as any;
    });
  }

  it('mechanism 1: an unopened small blind whose frame answer is only a complete keeps the early fold', () => {
    frameAnswers({ action: 'call' });
    enableBrainTelemetry();
    drainFires();
    const d = HorseLogic.decide(sb, state({ hero: 1 }), 'balanced', {}, on);
    expect(d.action).toBe('fold');
    expect(firedNow()).toEqual({ lightning_fold_through_limp_kept: 1 });
  });

  it('mechanism 1: a first-in limp from the button keeps the early fold too; a raise still releases it', () => {
    const spy = frameAnswers({ action: 'call' });
    enableBrainTelemetry();
    drainFires();
    expect(HorseLogic.decide(btn, state({ hero: 6 }), 'balanced', {}, on).action).toBe('fold');
    expect(firedNow()).toEqual({ lightning_fold_through_limp_kept: 1 });
    spy.mockRestore();
    frameAnswers({ action: 'raise' });
    expect(HorseLogic.decide(btn, state({ hero: 6 }), 'balanced', {}, on).action).toBe('raise');
    expect(firedNow()).toEqual({ lightning_fold_through_released: 1 });
  });

  it('mechanism 1: a call facing a raise, and a strength-gated cheap entry complete, still release', () => {
    const raised = state({
      hero: 1,
      history: [act(3, 'raise', 'preflop', { isFullRaise: true })],
    });
    let spy = frameAnswers({ action: 'call' });
    enableBrainTelemetry();
    drainFires();
    expect(HorseLogic.decide(sb, raised, 'balanced', {}, on).action).toBe('call');
    expect(firedNow()).toEqual({ lightning_fold_through_released: 1 });
    spy.mockRestore();
    spy = frameAnswers({
      action: 'call',
      preflopAuthority: { events: [{ branch: 'lightning_cheap_entry_sb_complete' }] },
    });
    expect(HorseLogic.decide(sb, state({ hero: 1 }), 'balanced', {}, on).action).toBe('call');
    expect(firedNow()).toEqual({ lightning_fold_through_released: 1 });
  });

  it('the predicate: preflop unraised calls only; never postflop, a raise, or a forced blind', () => {
    const limp = { action: 'call' };
    expect(lightningFoldThroughFrameIsUnraisedLimp(state({ hero: 1 }), limp)).toBe(true);
    expect(lightningFoldThroughFrameIsUnraisedLimp(state({ hero: 1 }), { action: 'raise' })).toBe(
      false
    );
    expect(lightningFoldThroughFrameIsUnraisedLimp(state({ hero: 1 }), { action: 'all_in' })).toBe(
      false
    );
    const flop = state({ hero: 2, stage: 'flop', history: [act(3, 'bet', 'flop')] });
    expect(lightningFoldThroughFrameIsUnraisedLimp(flop, limp)).toBe(false);
    // a limp before the Horse is not aggression: an over-limp is still an unraised limp
    expect(
      lightningFoldThroughFrameIsUnraisedLimp(state({ hero: 6, history: [act(3, 'call')] }), limp)
    ).toBe(true);
    expect(
      lightningFoldThroughFrameIsUnraisedLimp(state({ hero: 6, history: [act(3, 'call')] }), {
        action: 'call',
        preflopAuthority: { events: [{ branch: 'lightning_cheap_entry_over_limp' }] },
      })
    ).toBe(false);
  });

  it('mechanism 2: the frame ask replays the first ask\'s draws (one roll), and the stream ends where the option-off ask leaves it', () => {
    const draws: Array<{ frame: boolean; r: number }> = [];
    vi.spyOn(HorseLogic as any, 'decideCaptured').mockImplementation((_p: any, gs: any) => {
      const frame = gs.players.some((p: any) => p.is_folded);
      // a border hand: one jitter draw, the same draw the preflop glue takes for strengthJitter
      const r = fastRandom();
      fastRandom();
      draws.push({ frame, r });
      return { action: frame ? 'raise' : 'fold', amount: frame ? 5 : undefined, thinkTime: 1 } as any;
    });
    const saved = saveFastRandom();
    try {
      for (const seed of [1, 2, 3, 20261121]) {
        draws.length = 0;
        seedFastRandom(seed);
        HorseLogic.decide(btn, state({ hero: 6 }), 'balanced', {}, {});
        const offEnd = saveFastRandom();
        const offDraw = draws[0]!.r;
        draws.length = 0;
        seedFastRandom(seed);
        const d = HorseLogic.decide(btn, state({ hero: 6 }), 'balanced', {}, on);
        expect(d.action).toBe('raise');
        expect(draws.map((x) => x.frame)).toEqual([false, true]);
        expect(draws[0]!.r).toBe(offDraw);
        expect(draws[1]!.r, `seed ${seed}: the frame rolls the first ask's jitter again`).toBe(
          draws[0]!.r
        );
        expect(saveFastRandom(), `seed ${seed}: no extra draws consumed`).toBe(offEnd);
      }
    } finally {
      restoreFastRandom(saved);
    }
  });

  it('mechanism 2: a frame ask that throws still puts the stream back', () => {
    vi.spyOn(HorseLogic as any, 'decideCaptured').mockImplementation((_p: any, gs: any) => {
      fastRandom();
      if (gs.players.some((p: any) => p.is_folded)) {
        fastRandom();
        throw new Error('frame ask failure');
      }
      return { action: 'fold', thinkTime: 1 } as any;
    });
    const saved = saveFastRandom();
    try {
      seedFastRandom(99);
      HorseLogic.decide(btn, state({ hero: 6 }), 'balanced', {}, {});
      const offEnd = saveFastRandom();
      seedFastRandom(99);
      expect(HorseLogic.decide(btn, state({ hero: 6 }), 'balanced', {}, on).action).toBe('fold');
      expect(saveFastRandom()).toBe(offEnd);
    } finally {
      restoreFastRandom(saved);
      reported.length = 0;
    }
  });
});
