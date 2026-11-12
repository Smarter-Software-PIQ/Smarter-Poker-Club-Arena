/**
 * V38 — the EV engine: the arithmetic behind every choice (2026-09-03).
 * Closed-form pins first, then the wiring into decide() for the games with
 * no solver export and for the river line of every game.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as EvEngine from './HorseEvEngine.js';
import {
  evaluateSpot,
  mdfFold,
  continuingEquity,
  riverCallVerdict,
  type EvSpot,
} from './HorseEvEngine.js';
import { HorseLogic } from './HorseLogic.js';
import { resolveHorseHybridProfile } from './HorseHybridProfile.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import * as HorseEval from './HorseEval.js';
import { enableBrainTelemetry, drainFires } from './BrainTelemetry.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}
const fires = () => Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));

function spot(o: Partial<EvSpot>): EvSpot {
  return {
    equity: 0.5,
    pot: 100,
    toCall: 0,
    stack: 1000,
    effectiveStack: 1000,
    street: 'flop',
    inPosition: true,
    opponents: 1,
    realization: 1,
    minBet: 2,
    maxBet: Infinity,
    rand: () => 0.99, // deterministic: the best action wins every mix
    ...o,
  };
}

describe('V38 the arithmetic', () => {
  it('an all-in holding cannot fold out of an otherwise foldable pot', () => {
    const v = evaluateSpot(
      spot({ opponents: 2, models: [{ foldMul: 1.6 }, { foldMul: 1.8, canRespond: false }] })
    );
    const bets = v.candidates.filter((c) => c.kind === 'bet');
    expect(bets.length).toBeGreaterThan(0);
    for (const bet of bets) expect('foldEquity' in bet && bet.foldEquity).toBe(0);
  });

  it.each([0, 50])(
    'does not invent new wagers when all opponents have committed (%s to call)',
    (toCall) => {
      const v = evaluateSpot(spot({ toCall, models: [{ foldMul: 1, canRespond: false }] }));
      expect(v.candidates.map((c) => c.kind).sort()).toEqual(toCall ? ['call', 'fold'] : ['check']);
    }
  );
  it('a solver opponent folds by minimum defence frequency', () => {
    expect(mdfFold(100, 100)).toBeCloseTo(0.5, 6); // pot bet: half the range
    expect(mdfFold(100, 50)).toBeCloseTo(1 / 3, 6); // half pot: a third
    expect(mdfFold(100, 100, 1.5)).toBeCloseTo(0.75, 6); // a folder folds more
    expect(mdfFold(100, 0)).toBe(0);
  });

  it('the folds come out of the hands hero was beating', () => {
    expect(continuingEquity(0.5, 0)).toBe(0.5);
    expect(continuingEquity(0.5, 0.5)).toBeLessThan(0.5);
    expect(continuingEquity(0.9, 0.5)).toBeGreaterThan(0.9); // a monster gets stronger vs the callers
  });

  it('EV(call) is realized equity times the pot after the call, minus the call', () => {
    const v = evaluateSpot(spot({ equity: 0.4, pot: 150, toCall: 50, street: 'river' }));
    const call = v.candidates.find((c) => c.kind === 'call')!;
    expect(call.ev).toBeCloseTo(0.4 * 200 - 50, 6); // +30
    expect(v.best.kind).not.toBe('fold');
  });

  it('a hand below the price folds, at the price is indifferent', () => {
    const under = evaluateSpot(spot({ equity: 0.2, pot: 150, toCall: 50, street: 'river' }));
    expect(under.best.kind).toBe('fold');
    const at = evaluateSpot(spot({ equity: 0.25, pot: 150, toCall: 50, street: 'river' }));
    const call = at.candidates.find((c) => c.kind === 'call')!;
    expect(Math.abs(call.ev)).toBeLessThan(1e-6);
  });

  it('air checks, a monster bets, and the monster prefers a bigger size', () => {
    const air = evaluateSpot(spot({ equity: 0.15 }));
    expect(air.best.kind).toBe('check');
    const nuts = evaluateSpot(spot({ equity: 0.95 }));
    expect(nuts.best.kind).toBe('bet');
    const sizes = nuts.candidates.filter((c) => c.kind === 'bet') as Array<{
      sizeFrac: number;
      ev: number;
    }>;
    const biggest = sizes.reduce((a, b) => (a.sizeFrac > b.sizeFrac ? a : b));
    const smallest = sizes.reduce((a, b) => (a.sizeFrac < b.sizeFrac ? a : b));
    expect(biggest.ev).toBeGreaterThan(smallest.ev);
  });

  it('a draw with the lead bets more often than the same draw without it', () => {
    let withLead = 0;
    let without = 0;
    for (let i = 0; i < 200; i++) {
      const r = i / 200;
      if (evaluateSpot(spot({ equity: 0.42, initiative: true, rand: () => r })).pick.kind === 'bet')
        withLead++;
      if (
        evaluateSpot(spot({ equity: 0.42, initiative: false, rand: () => r })).pick.kind === 'bet'
      )
        without++;
    }
    expect(withLead).toBeGreaterThanOrEqual(without);
  });

  it('a folder makes a bluff worth more', () => {
    const solver = evaluateSpot(spot({ equity: 0.25, sizes: [0.75] }));
    const folder = evaluateSpot(spot({ equity: 0.25, sizes: [0.75], models: [{ foldMul: 1.6 }] }));
    const bet = (v: ReturnType<typeof evaluateSpot>) =>
      v.candidates.find((c) => c.kind === 'bet')!.ev;
    expect(bet(folder)).toBeGreaterThan(bet(solver));
  });

  it('a bluff into three players is worth less than the same bluff into one', () => {
    const hu = evaluateSpot(spot({ equity: 0.25, sizes: [0.75], opponents: 1 }));
    const mw = evaluateSpot(spot({ equity: 0.25, sizes: [0.75], opponents: 3 }));
    const bet = (v: ReturnType<typeof evaluateSpot>) =>
      v.candidates.find((c) => c.kind === 'bet')!.ev;
    expect(bet(mw)).toBeLessThan(bet(hu));
  });

  it('pot limit caps the ladder at the pot; a jam is always on the menu when legal', () => {
    const pl = evaluateSpot(spot({ equity: 0.9, maxBet: 100, sizes: [0.5, 1.0, 1.5] }));
    const amounts = pl.candidates
      .filter((c) => c.kind === 'bet')
      .map((c) => (c as { amount: number }).amount);
    expect(Math.max(...amounts)).toBeLessThanOrEqual(100);
    const nl = evaluateSpot(spot({ equity: 0.9, stack: 300, effectiveStack: 300, sizes: [0.5] }));
    const nlAmounts = nl.candidates
      .filter((c) => c.kind === 'bet')
      .map((c) => (c as { amount: number }).amount);
    expect(nlAmounts).toContain(300);
  });

  it('the river line: required = raked pot odds + the survival premium on the share at risk', () => {
    const v = riverCallVerdict({ equity: 0.3, pot: 150, toCall: 50, stack: 1000, rand: () => 0.5 });
    expect(v.required).toBeCloseTo(0.25, 6);
    expect(v.call).toBe(true);
    const raked = riverCallVerdict({
      equity: 0.26,
      pot: 150,
      toCall: 50,
      stack: 1000,
      rakeMarg: 0.1,
      rand: () => 0.5,
    });
    expect(raked.required).toBeCloseTo(0.25 / 0.9, 6);
    expect(raked.call).toBe(false);
    const icm = riverCallVerdict({
      equity: 0.3,
      pot: 150,
      toCall: 50,
      stack: 100,
      riskPremium: 0.1,
      rand: () => 0.5,
    });
    expect(icm.required).toBeCloseTo(0.25 + 0.1 * Math.sqrt(0.5), 6);
    expect(icm.call).toBe(false);
  });

  it('at indifference the river line mixes', () => {
    let calls = 0;
    for (let i = 0; i < 100; i++) {
      const v = riverCallVerdict({
        equity: 0.25,
        pot: 150,
        toCall: 50,
        stack: 1000,
        rand: () => i / 100,
      });
      if (v.call) calls++;
    }
    expect(calls).toBeGreaterThan(30);
    expect(calls).toBeLessThan(70);
  });

  it.each([undefined, 0.1])(
    'reports river call EV using the same partial-stack risk as its action (deduction %s)',
    (callDeductionFraction) => {
      // Half the stack is at risk, so the established policy charges the
      // square root of that share, not the full stack-off premium.
      const award = 200 * (1 - (callDeductionFraction ?? 0));
      const premium = 0.1 * Math.sqrt(0.5);
      const required = 50 / award + premium;
      for (const gap of [-0.02, 0.02]) {
        const verdict = riverCallVerdict({
          equity: required + gap,
          pot: 150,
          toCall: 50,
          stack: 100,
          riskPremium: 0.1,
          callDeductionFraction,
          rand: () => 0.5,
        });
        expect(verdict.required).toBeCloseTo(required, 10);
        expect(verdict.call).toBe(gap > 0);
        expect(verdict.evCall).toBeCloseTo(gap * award, 10);
      }
    }
  );
});

describe('Hybrid estimated-EV indifference selection', () => {
  const context = (horseId = 'horse-1', bigBlind = 1, mode: 'cash' | 'tournament' = 'cash') => ({
    horseId,
    bigBlind,
    mode,
  });
  const callSpot = (ev: number, bigBlind = 1) =>
    spot({
      equity: (50 + ev) / 200,
      pot: 150,
      toCall: 50,
      street: 'river',
      sizes: [],
      maxBet: 0,
      indifference: context('horse-1', bigBlind),
    });

  it.each([-2, -0.120001, 0.120001, 2])('never selects a call/fold %s BB below the best', (ev) => {
    for (let id = 0; id < 40; id++) {
      const rand = vi.fn(() => 0.999);
      const v = evaluateSpot({ ...callSpot(ev), indifference: context(`horse-${id}`), rand });
      expect(v.pick.kind).toBe(ev > 0 ? 'call' : 'fold');
      expect(v.best.ev - v.pick.ev).toBe(0);
      expect(rand).toHaveBeenCalledTimes(1); // old pot-relative pool still required one draw
    }
  });

  it('uses stable identity, explicit mode, and the existing draw only inside the band', () => {
    const select = (horseId: string, mode: 'cash' | 'tournament') =>
      evaluateSpot({
        ...callSpot(-0.025),
        indifference: context(horseId, 1, mode),
        rand: () => 0.999,
      }).pick.kind;
    const cash = Array.from({ length: 80 }, (_, i) => select(`horse-${i}`, 'cash'));
    const tournament = Array.from({ length: 80 }, (_, i) => select(`horse-${i}`, 'tournament'));
    expect(new Set(cash)).toEqual(new Set(['call', 'fold']));
    expect(cash).not.toEqual(tournament);
    expect(cash).toEqual(Array.from({ length: 80 }, (_, i) => select(`horse-${i}`, 'cash')));
  });

  it.each([0.02, 2, 100])(
    'converts chips to BB at stake %s without widening the loss cap',
    (bb) => {
      for (const gapBB of [-0.03, -0.13, 0.03, 0.13]) {
        const v = evaluateSpot(
          spot({
            equity: (50 + gapBB) / 200,
            pot: 150 * bb,
            toCall: 50 * bb,
            stack: 1000 * bb,
            effectiveStack: 1000 * bb,
            minBet: 0.01,
            maxBet: 0,
            sizes: [],
            street: 'river',
            indifference: context('horse-1', bb),
            rand: () => 0.999,
          })
        );
        expect((v.best.ev - v.pick.ev) / bb).toBeLessThanOrEqual(0.12 + 1e-10);
        if (Math.abs(gapBB) > 0.12) expect(v.pick).toBe(v.best);
      }
    }
  );

  it.each([0, -1, NaN, Infinity])(
    'fails closed to highest estimated EV with invalid BB %s',
    (bb) => {
      const v = evaluateSpot({ ...callSpot(-0.025), indifference: context('horse-1', bb) });
      expect(v.pick).toBe(v.best);
    }
  );

  it('tightens the tournament band using trusted bubble factor without changing cash', () => {
    for (let id = 0; id < 40; id++) {
      const v = evaluateSpot({
        ...callSpot(-0.07),
        indifference: { ...context(`horse-${id}`, 1, 'tournament'), bubbleFactor: 4 },
      });
      expect(v.pick).toBe(v.best); // 0.12 / sqrt(4) = 0.06 BB
    }
    const cash = evaluateSpot({ ...callSpot(-0.025), indifference: context() });
    const withIgnoredIcm = evaluateSpot({
      ...callSpot(-0.025),
      indifference: { ...context(), bubbleFactor: 4 },
    });
    expect(cash.pick).toEqual(withIgnoredIcm.pick);
  });

  it('prices normalized wager amounts once, deduplicating or refusing unexecutable sizes', () => {
    const v = evaluateSpot(
      spot({
        equity: 0.7,
        sizes: [0.33, 0.5, 0.75],
        maxBet: 100,
        normalizeWager: (amount) => (amount <= 50 ? 30 : null),
      })
    );
    const actual = evaluateSpot(spot({ equity: 0.7, sizes: [0.3], maxBet: 100 }));
    expect(v.candidates).toEqual(actual.candidates);
    expect(v.candidates.filter((a) => 'amount' in a).map((a) => 'amount' in a && a.amount)).toEqual(
      [30]
    );
  });

  it('the river uses priced EV rather than its broader legacy equity window', () => {
    for (const ev of [-2, -0.13, 0.13, 2]) {
      const rand = vi.fn(() => (ev > 0 ? 0.999 : 0));
      const v = riverCallVerdict({
        equity: (50 + ev) / 200,
        pot: 150,
        toCall: 50,
        stack: 1000,
        indifference: context(),
        rand,
      });
      expect(v.call).toBe(ev > 0);
      expect(rand).toHaveBeenCalledTimes(1);
    }
    const rand = vi.fn(() => 0);
    riverCallVerdict({
      equity: 0.8,
      pot: 150,
      toCall: 50,
      stack: 1000,
      indifference: context(),
      rand,
    });
    expect(rand).not.toHaveBeenCalled();
  });

  it('river identities personalize near-indifferent choices without extra random draws', () => {
    const choices = new Set<boolean>();
    for (let id = 0; id < 80; id++) {
      const rand = vi.fn(() => 0);
      const v = riverCallVerdict({
        equity: (50 - 0.025) / 200,
        pot: 150,
        toCall: 50,
        stack: 1000,
        indifference: context(`horse-${id}`),
        rand,
      });
      choices.add(v.call);
      expect(rand).toHaveBeenCalledTimes(1);
    }
    expect(choices).toEqual(new Set([true, false]));
  });

  it('does not consume an extra draw where only one candidate was eligible', () => {
    const rand = vi.fn(() => 0);
    evaluateSpot({ ...callSpot(40), rand });
    expect(rand).not.toHaveBeenCalled();
  });
});

describe('V38 wiring: the engine reaches decide()', () => {
  beforeEach(() => {
    seedFastRandom(0x5eed38);
    HorseMind.reset();
    enableBrainTelemetry();
    drainFires();
  });

  function state(
    variant: string,
    hole: string,
    board: string,
    stage: 'flop' | 'river',
    bet: number
  ) {
    const players: SeatPlayer[] = [
      {
        seat: 1,
        user_id: 'hero',
        username: 'h',
        stack: 400,
        bet: 0,
        totalInvested: 10,
        cards: cards(hole),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      },
      {
        seat: 2,
        user_id: 'villain',
        username: 'v',
        stack: 400 - bet,
        bet,
        totalInvested: 10 + bet,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      },
    ];
    const history = [
      { stage: 'preflop', seat: 2, userId: 'villain', action: 'raise', amount: 6, timestamp: 1 },
      { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 4, timestamp: 2 },
    ];
    if (stage === 'river') {
      for (const st of ['flop', 'turn']) {
        history.push({
          stage: st,
          seat: 1,
          userId: 'hero',
          action: 'check',
          amount: 0,
          timestamp: history.length + 1,
        });
        history.push({
          stage: st,
          seat: 2,
          userId: 'villain',
          action: 'check',
          amount: 0,
          timestamp: history.length + 1,
        });
      }
    }
    if (bet > 0)
      history.push({
        stage,
        seat: 2,
        userId: 'villain',
        action: 'bet',
        amount: bet,
        timestamp: history.length + 1,
      });
    else
      history.push({
        stage,
        seat: 2,
        userId: 'villain',
        action: 'check',
        amount: 0,
        timestamp: history.length + 1,
      });
    return {
      hero: players[0],
      gs: {
        players,
        communityCards: cards(board),
        pot: 20 + bet,
        currentBet: bet,
        minRaise: Math.max(2, bet),
        stage,
        gameVariant: variant,
        gameMode: 'cash',
        bigBlind: 2,
        dealerSeat: 1,
        actionHistory: history,
      },
    };
  }

  it.each(['cash', 'tournament'] as const)(
    'the live Hybrid profile reaches the river EV selector with identity and BB units (%s)',
    (mode) => {
      const s = state('nlh', 'AhKh', 'Qh9d3s7c2c', 'river', 15);
      const profile = resolveHorseHybridProfile({ style: 'hybrid' }, s.hero.user_id, mode);
      const spy = vi.spyOn(EvEngine, 'riverCallVerdict');
      try {
        const decision = HorseLogic.decide(
          s.hero,
          { ...s.gs, gameMode: mode } as never,
          profile.style,
          profile.mods,
          { telemetry: true, mind: false }
        );
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toMatchObject({
          indifference: { horseId: 'hero', mode, bigBlind: 2 },
        });
        const verdict = spy.mock.results[0].value as ReturnType<typeof riverCallVerdict>;
        expect(decision.action).toBe(verdict.call ? 'call' : 'fold');
      } finally {
        spy.mockRestore();
      }
    }
  );

  it('prices the real Hybrid probe ladder after legal sizing', () => {
    const s = state('plo4', '9c8d4h2s', 'AhKd7c', 'flop', 0);
    const profile = resolveHorseHybridProfile({ style: 'hybrid' }, s.hero.user_id, 'cash');
    const spy = vi.spyOn(EvEngine, 'evaluateSpot');
    try {
      const decision = HorseLogic.decide(s.hero, s.gs as never, profile.style, profile.mods, {
        mind: false,
        v86PloOverhaul: false,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const input = spy.mock.calls[0][0];
      const result = spy.mock.results[0].value as ReturnType<typeof evaluateSpot>;
      expect(input.indifference).toMatchObject({ horseId: 'hero', mode: 'cash', bigBlind: 2 });
      expect(input.normalizeWager).toBeTypeOf('function');
      expect(
        result.candidates.filter((a) => a.kind === 'bet').map((a) => 'amount' in a && a.amount)
      ).toEqual([16, 13, 8, 5]);
      expect(decision.action).toBe(result.pick.kind);
    } finally {
      spy.mockRestore();
    }
  });

  it('consumes the real near-indifferent call pick instead of replacing it with the sign of call EV', () => {
    const evaluate = EvEngine.evaluateSpot;
    // Hold the existing mixing draw fixed; equity, pricing and the caller are real.
    const spy = vi
      .spyOn(EvEngine, 'evaluateSpot')
      .mockImplementation((input) => evaluate({ ...input, rand: () => 0.999999 }));
    try {
      const s = state('plo4', '9c8d4h3s', 'Kh7c6d', 'flop', 25.06);
      s.hero.user_id = 'horse-0';
      for (const a of s.gs.actionHistory) if (a.userId === 'hero') a.userId = 'horse-0';
      const profile = resolveHorseHybridProfile({ style: 'hybrid' }, s.hero.user_id, 'cash');
      const decision = HorseLogic.decide(s.hero, s.gs as never, profile.style, profile.mods, {
        mind: false,
        v86PloOverhaul: false,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const result = spy.mock.results[0].value as ReturnType<typeof evaluateSpot>;
      expect(result.pick.kind).toBe('call');
      expect(result.pick.ev).toBeLessThan(0);
      expect(result.best.ev - result.pick.ev).toBeLessThanOrEqual(0.24);
      expect(decision.action).toBe('call');
    } finally {
      spy.mockRestore();
    }
  });

  it('executes the exact normalized EV probe without applying the sizing multiplier twice', () => {
    const evaluate = EvEngine.evaluateSpot;
    // Control only which priced candidate reaches the bet consumer. The real
    // caller, legalizer and EV arithmetic generate that candidate and its size.
    const spy = vi.spyOn(EvEngine, 'evaluateSpot').mockImplementation((input) => {
      const verdict = evaluate(input);
      const bet = verdict.candidates.find((a) => a.kind === 'bet');
      expect(bet).toBeDefined();
      return { ...verdict, pick: bet! };
    });
    try {
      const s = state('plo4', '9c8d4h2s', 'AhKd7c', 'flop', 0);
      const profile = resolveHorseHybridProfile({ style: 'hybrid' }, s.hero.user_id, 'cash');
      const decision = HorseLogic.decide(s.hero, s.gs as never, profile.style, profile.mods, {
        mind: false,
        v86PloOverhaul: false,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const result = spy.mock.results[0].value as ReturnType<typeof evaluateSpot>;
      expect(result.pick.kind).toBe('bet');
      expect(decision.action).toBe('bet');
      expect(decision.amount).toBe('amount' in result.pick ? result.pick.amount : undefined);
      expect(decision.amount).toBe(16);
    } finally {
      spy.mockRestore();
    }
  });

  it('a PLO flop facing a bet is priced by the EV engine', () => {
    const s = state('plo4', 'AhKh7c2d', 'Qh9h3s', 'flop', 15);
    HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, { telemetry: true, mind: false });
    const f = fires();
    expect((f['v38_ev_call'] ?? 0) + (f['v38_ev_fold'] ?? 0)).toBe(1);
  });

  it('a PLO flop checked to hero below the value bars is decided by the EV engine', () => {
    let hits = 0;
    for (let i = 0; i < 20; i++) {
      const s = state('plo4', '9c8d4h2s', 'AhKd7c', 'flop', 0);
      HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, { telemetry: true, mind: false });
      const f = fires();
      hits += (f['v38_ev_bet'] ?? 0) + (f['v38_ev_check'] ?? 0);
    }
    expect(hits).toBe(20);
  });

  it.each([false, true])(
    'wires the all-in response restriction into the actual PLO bet calculation (%s)',
    (away) => {
      const s = state('plo4', '9c8d4h2s', 'AhKd7c', 'flop', 0);
      const allin = {
        ...s.gs.players[1],
        seat: 3,
        user_id: 'allin',
        stack: 0,
        totalInvested: 10,
        is_all_in: true,
        is_sitting_out: away,
      };
      const gs = { ...s.gs, players: [...s.gs.players, allin], dealtSeatIds: [1, 2, 3], pot: 30 };
      const spy = vi.spyOn(EvEngine, 'evaluateSpot');
      try {
        HorseLogic.decide(
          s.hero,
          gs as never,
          'balanced',
          {},
          { telemetry: true, mind: false, phase13Joint: 'off' }
        );
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0].models).toEqual([
          { foldMul: 1, canRespond: true },
          { foldMul: 1, canRespond: false },
        ]);
        const verdict = spy.mock.results[0].value as ReturnType<typeof evaluateSpot>;
        const bets = verdict.candidates.filter((c) => c.kind === 'bet');
        expect(bets.length).toBeGreaterThan(0);
        for (const bet of bets) expect('foldEquity' in bet && bet.foldEquity).toBe(0);
      } finally {
        spy.mockRestore();
      }
    }
  );

  it('a hold em river facing a bet is the MDF line, not a flat margin', () => {
    const s = state('nlh', 'AhKh', 'Qh9d3s7c2c', 'river', 15);
    HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, { telemetry: true, mind: false });
    const f = fires();
    expect((f['v38_river_call'] ?? 0) + (f['v38_river_fold'] ?? 0)).toBe(1);
  });

  it.each([true, false])(
    'prices the actual river call using the deal population (away seat dealt=%s)',
    (dealt) => {
      const s = state('nlh', 'AhKh', 'Qh9d3s7c2c', 'river', 15);
      const away = {
        ...s.hero,
        seat: 3,
        user_id: 'away',
        cards: [],
        is_folded: true,
        is_sitting_out: true,
      };
      const gs = {
        ...s.gs,
        players: [...s.gs.players, away],
        dealtSeatIds: dealt ? [1, 2, 3] : [1, 2],
        rakeConfig: {
          percent: 10,
          cap: 8,
          noFlopNoDrop: true,
          playerCountCaps: [
            { players: 2, cap: 2.5 },
            { players: 3, cap: 8 },
          ],
        },
      };
      const spy = vi.spyOn(EvEngine, 'riverCallVerdict');
      let inputs: Parameters<typeof riverCallVerdict>[0][];
      try {
        HorseLogic.decide(s.hero, gs as never, 'balanced', {}, { telemetry: true, mind: false });
        inputs = spy.mock.calls.map(([input]) => input);
      } finally {
        spy.mockRestore();
      }
      expect(inputs!).toHaveLength(1);
      expect(inputs![0].rakeMarg).toBe(dealt ? 0.1 : 0.05);
    }
  );

  it('ablated, the river falls back to the heuristic line', () => {
    const s = state('nlh', 'AhKh', 'Qh9d3s7c2c', 'river', 15);
    HorseLogic.decide(
      s.hero,
      s.gs as never,
      'balanced',
      {},
      { telemetry: true, mind: false, v38Ev: false }
    );
    const f = fires();
    expect((f['v38_river_call'] ?? 0) + (f['v38_river_fold'] ?? 0)).toBe(0);
  });

  it.each(
    ['plo4', 'plo5', 'plo6', 'plo8', 'flo8', 'flh', 'pineapple', 'short_deck'].flatMap((variant) =>
      [false, true].map((away) => ({ variant, away }))
    )
  )('samples every committed opponent with that exact range in %j', ({ variant, away }) => {
    const hole =
      variant === 'plo5'
        ? 'AhAdKhKdQh'
        : variant === 'plo6'
          ? 'AhAdKhKdQhQd'
          : variant.startsWith('plo') || variant === 'flo8'
            ? 'AhAdKhKd'
            : variant === 'pineapple'
              ? 'AhAdKh'
              : 'AhAd';
    const s = state(variant, hole, '', 'flop', 0);
    const hero = { ...s.hero, stack: 60, bet: 2, totalInvested: 2 };
    const waiting = { ...s.gs.players[1], user_id: 'waiting', seat: 2, bet: 2, totalInvested: 2 };
    const committed = Array.from({ length: 4 }, (_, i) => ({
      ...waiting,
      user_id: `committed-${i}`,
      seat: i + 3,
      stack: 0,
      bet: 50,
      totalInvested: 50,
      is_all_in: true,
      is_sitting_out: away,
    }));
    const gs = {
      ...s.gs,
      stage: 'preflop',
      players: [hero, waiting, ...committed],
      dealtSeatIds: [1, 2, 3, 4, 5, 6],
      pot: 204,
      currentBet: 50,
      minRaise: 48,
      actionHistory: [
        { seat: 2, userId: 'waiting', stage: 'preflop', action: 'call', amount: 2, timestamp: 1 },
        ...committed.map((p, i) => ({
          seat: p.seat,
          userId: p.user_id,
          stage: 'preflop',
          action: 'all_in',
          amount: 50,
          timestamp: i + 2,
          isFullRaise: i === 0 ? true : undefined,
        })),
      ],
    };
    const bandSpy = vi.spyOn(HorseMind, 'bandsForOpponents');
    const sampleSpy = vi.spyOn(HorseEval, 'simulateEquity');
    let calls: typeof sampleSpy.mock.calls;
    let sampledBands: ReturnType<typeof HorseMind.bandsForOpponents>[];
    let rosters: string[][];
    try {
      HorseLogic.decide(
        hero,
        gs as never,
        'balanced',
        {},
        { telemetry: true, mind: true, phase13Joint: 'off' }
      );
      calls = [...sampleSpy.mock.calls];
      rosters = bandSpy.mock.calls.map(([, players]) =>
        players.filter((p) => p.seat !== hero.seat).map((p) => p.user_id)
      );
      sampledBands = bandSpy.mock.results.map((r) => r.value);
    } finally {
      bandSpy.mockRestore();
      sampleSpy.mockRestore();
    }
    expect(fires()['v38_preflop_allin_price']).toBe(1);
    expect(calls!).toHaveLength(1);
    expect(calls![0][2]).toBe(4);
    expect(rosters!).toEqual([committed.map((p) => p.user_id)]);
    expect(sampledBands![0]).toHaveLength(4);
    expect(calls![0][5]).toEqual(sampledBands![0]);
  });

  it('a PLO preflop jam is called or folded on equity against the jammer', () => {
    const players: SeatPlayer[] = [
      {
        seat: 1,
        user_id: 'hero',
        username: 'h',
        stack: 60,
        bet: 2,
        totalInvested: 2,
        cards: cards('AhAdKhKd'),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      },
      {
        seat: 2,
        user_id: 'villain',
        username: 'v',
        stack: 0,
        bet: 50,
        totalInvested: 50,
        cards: [],
        is_folded: false,
        is_all_in: true,
        is_sitting_out: false,
      },
    ];
    const gs = {
      players,
      communityCards: [],
      pot: 53,
      currentBet: 50,
      minRaise: 48,
      stage: 'preflop',
      gameVariant: 'plo4',
      gameMode: 'cash',
      bigBlind: 2,
      dealerSeat: 2,
      actionHistory: [
        {
          stage: 'preflop',
          seat: 2,
          userId: 'villain',
          action: 'all_in',
          amount: 50,
          timestamp: 1,
          isFullRaise: true,
        },
      ],
    };
    const d = HorseLogic.decide(
      players[0],
      gs as never,
      'balanced',
      {},
      { telemetry: true, mind: false }
    );
    expect(['call', 'all_in']).toContain(d.action);
    expect(fires()['v38_preflop_allin_price']).toBe(1);
    // four napkins fold the same jam
    players[0].cards = cards('9c4d2h7s');
    const d2 = HorseLogic.decide(
      players[0],
      gs as never,
      'balanced',
      {},
      { telemetry: true, mind: false }
    );
    expect(d2.action).toBe('fold');
  });

  it.each([false, true])(
    'only tries to isolate a positive-EV call when another opponent can respond (%s)',
    (responds) => {
      const s = state('plo4', 'AhAdKhKd', '', 'flop', 0);
      const hero = { ...s.hero, bet: 2, totalInvested: 2 };
      const committed = [2, 3].map((seat) => ({
        ...s.gs.players[1],
        seat,
        user_id: `allin-${seat}`,
        stack: 0,
        bet: 50,
        totalInvested: 50,
        is_all_in: true,
      }));
      const waiter = { ...s.gs.players[1], seat: 4, user_id: 'waiter', bet: 2, totalInvested: 2 };
      const gs = {
        ...s.gs,
        stage: 'preflop',
        players: [hero, ...committed, ...(responds ? [waiter] : [])],
        currentBet: 50,
        minRaise: 48,
        pot: responds ? 104 : 102,
        actionHistory: committed.map((p, i) => ({
          seat: p.seat,
          userId: p.user_id,
          action: 'all_in',
          amount: 50,
          stage: 'preflop',
          timestamp: i + 1,
          isFullRaise: i === 0 ? true : undefined,
        })),
      };
      // Fix only the equity input to exercise the isolation branch itself.
      const spy = vi.spyOn(HorseEval, 'simulateEquity').mockReturnValue(0.99);
      try {
        const decision = HorseLogic.decide(
          hero,
          gs as never,
          'balanced',
          {},
          { mind: false, phase13Joint: 'off' }
        );
        // The isolation intent must still respect the actual pot-limit cap.
        expect(decision.action).toBe(responds ? 'raise' : 'call');
        expect(decision.amount).toBe(responds ? 202 : 48);
      } finally {
        spy.mockRestore();
      }
    }
  );

  it('refuses a preflop price with more committed holdings than the physical deck allows', () => {
    const s = state('plo6', 'AhAdKhKdQhQd', '', 'flop', 0);
    const hero = { ...s.hero, bet: 2, totalInvested: 2 };
    const committed = Array.from({ length: 9 }, (_, i) => ({
      ...s.gs.players[1],
      seat: i + 2,
      user_id: `allin-${i}`,
      stack: 0,
      bet: 50,
      totalInvested: 50,
      is_all_in: true,
    }));
    const gs = {
      ...s.gs,
      stage: 'preflop',
      players: [hero, ...committed],
      currentBet: 50,
      minRaise: 48,
      pot: 452,
      actionHistory: committed.map((p, i) => ({
        seat: p.seat,
        userId: p.user_id,
        action: 'all_in',
        amount: 50,
        stage: 'preflop',
        timestamp: i + 1,
        isFullRaise: i === 0 ? true : undefined,
      })),
    };
    const spy = vi.spyOn(HorseEval, 'simulateEquity');
    let count = 0;
    try {
      HorseLogic.decide(
        hero,
        gs as never,
        'balanced',
        {},
        { telemetry: true, mind: false, phase13Joint: 'off' }
      );
      count = spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
    expect(count).toBe(0);
    const signals = fires();
    expect(signals.v38_preflop_price_unavailable).toBe(1);
    expect(signals.v38_preflop_allin_price).toBeUndefined();
  });
});
