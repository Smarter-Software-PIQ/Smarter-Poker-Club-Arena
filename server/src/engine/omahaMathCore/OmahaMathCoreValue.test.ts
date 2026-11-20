/**
 * omahaMathCore made-hand offence (lane VALUE). Constructed spots only: no
 * hole cards anywhere, equities are stated curves, response curves are the
 * shapes measured in the 48h audit (persons vs Horse wagers, PLO4/PLO5 cash).
 */
import { describe, expect, it } from 'vitest';
import {
  equityCurveFromHoldings,
  equityCurvesOnSharedRunouts,
  geometricFraction,
  planRangeSize,
  planValue,
  VALUE_SIZE_MENU,
  type ValueResponse,
  type ValueSpot,
} from './OmahaMathCoreValue.js';

/** persons' measured heads-up continue shape vs Horse wagers (audit48: flop small .16 fold ... pot .45) */
const FLOP_HU: Array<[number, number, number]> = [
  // [frac upper bound, fold, raise]
  [0.4, 0.16, 0.13],
  [0.6, 0.36, 0.1],
  [0.8, 0.41, 0.03],
  [0.95, 0.43, 0.11],
  [10, 0.5, 0.03],
];
const RIVER_HU: Array<[number, number, number]> = [
  [0.4, 0.38, 0.17],
  [0.6, 0.67, 0.08],
  [0.8, 0.62, 0.04],
  [0.95, 0.61, 0.08],
  [10, 0.77, 0.02],
];
const curve =
  (rows: Array<[number, number, number]>) =>
  (frac: number, allIn: boolean): ValueResponse => {
    const row = allIn
      ? rows[rows.length - 1]
      : (rows.find((r) => frac < r[0]) ?? rows[rows.length - 1]);
    return { fold: row[1], raise: row[2], callers: 1, source: 'audit48 shape' };
  };
const flat =
  (fold: number, raise = 0) =>
  (): ValueResponse => ({ fold, raise, callers: 1, source: 'constructed' });

const base = (over: Partial<ValueSpot>): ValueSpot => ({
  variant: 'plo5',
  street: 'flop',
  pot: 20,
  toCall: 0,
  heroStack: 400,
  oppStack: 400,
  nOpp: 1,
  ip: true,
  checkCloses: true,
  rakeNet: (p) => p - Math.min(0.05 * p, 5),
  response: (f, a) => curve(FLOP_HU)(f, a),
  wagerWhenChecked: () => null,
  equityAtShare: () => 0.9,
  equitySe: 0.005,
  seed: 'spot-1',
  ...over,
});

describe('omahaMathCore value: scope', () => {
  it('answers null for PLO6 (owner 8:26 PM: PLO6 untouched)', () => {
    expect(planValue(base({ variant: 'plo6' }))).toBeNull();
  });
  it('is deterministic for a given spot', () => {
    expect(planValue(base({}))).toEqual(planValue(base({})));
  });
});

describe('omahaMathCore value: pot geometry', () => {
  it('the geometric share puts the stack in by the river', () => {
    const g = geometricFraction(20, 400, 3);
    let pot = 20;
    let stack = 400;
    for (let i = 0; i < 3; i++) {
      const b = g * pot;
      pot += 2 * b;
      stack -= b;
    }
    expect(stack).toBeCloseTo(0, 6);
  });
  it('a near-nut flop hand deep bets big and plans to be all-in by the river (not 0.43 pot)', () => {
    const r = planValue(base({ heroStack: 150, oppStack: 150, equityAtShare: () => 0.92 }))!;
    expect(r.choice.kind).toBe('wager');
    const check = r.candidates.find((c) => c.kind === 'check')!;
    expect(r.choice.ev).toBeGreaterThan(check.ev * 1.2);
    // every size from half pot up is planned to get the stack in by the river (pot geometry)
    for (const c of r.candidates.filter((x) => x.kind === 'wager' && (x.frac ?? 0) >= 0.5))
      expect(c.plan).toMatch(/all-in/);
    expect(r.indifferent).toContain(r.choice.frac);
  });
});

describe('omahaMathCore value: exploitation through measured curves', () => {
  it('a station gets a bigger value size than an over-folder', () => {
    const station = planValue(base({ response: flat(0.05), equityAtShare: () => 0.85 }))!;
    const folder = planValue(
      base({
        equityAtShare: () => 0.85,
        response: (f) => ({
          fold: Math.min(0.9, 0.2 + 0.7 * f),
          raise: 0,
          callers: 1,
          source: 'constructed',
        }),
      })
    )!;
    expect(station.choice.adds).toBeGreaterThan(folder.choice.adds);
  });
  it('out of position against a measured stabber who folds to bets: the trap (check, then raise) is worth more', () => {
    const spot = base({
      ip: false,
      checkCloses: false,
      equityAtShare: () => 0.95,
      response: flat(0.85),
      wagerWhenChecked: () => ({
        p: 0.9,
        frac: 0.6,
        valueShare: 0.2,
        source: 'constructed stabber',
      }),
    });
    const r = planValue(spot)!;
    expect(r.choice.kind).toBe('check');
    expect(r.candidates[0].plan).toMatch(/check-raise|check-call/);
  });
  it('the same hand against a passive opponent bets', () => {
    const r = planValue(
      base({
        ip: false,
        checkCloses: false,
        equityAtShare: () => 0.95,
        response: flat(0.3),
        wagerWhenChecked: () => ({ p: 0.05, frac: 0.5, source: 'constructed passive' }),
      })
    )!;
    expect(r.choice.kind).toBe('wager');
  });
});

describe('omahaMathCore value: raises and protection', () => {
  it('a vulnerable hand that is raised folds rather than stacking off against the raising share', () => {
    // strong vs the whole range, 5% vs its strongest fifth (the share that raises)
    const eq = (s: number) => (s <= 0.2 ? 0.05 : (0.05 * 0.2 + 0.8 * (s - 0.2)) / s);
    const r = planValue(base({ equityAtShare: eq, response: flat(0.3, 0.2) }))!;
    for (const c of r.candidates.filter((x) => x.kind === 'wager' && !x.allIn))
      expect(c.evRaise).toBeCloseTo(-c.raise * c.adds, 1);
  });
  it('the nuts facing a wager prices raises, and a raise is welcome (raised branch is positive)', () => {
    const r = planValue(
      base({ toCall: 10, pot: 30, equityAtShare: () => 0.97, response: flat(0.2, 0.2) })
    )!;
    const raises = r.candidates.filter((c) => c.kind === 'wager');
    expect(raises.length).toBeGreaterThan(0);
    expect(r.candidates.some((c) => c.kind === 'check')).toBe(false);
    expect(r.candidates.some((c) => c.kind === 'call')).toBe(true);
    for (const c of raises.filter((x) => !x.allIn)) expect(c.evRaise).toBeGreaterThan(0);
  });
});

describe('omahaMathCore value: facing a wager (XR-BLUFF review)', () => {
  it('a raise is never below the minimum raise (twice the wager faced)', () => {
    const r = planValue(
      base({ toCall: 10, pot: 30, equityAtShare: () => 0.9, response: flat(0.3, 0.05) })
    )!;
    for (const c of r.candidates.filter((x) => x.kind === 'wager'))
      expect(c.adds).toBeGreaterThanOrEqual(20 - 1e-9);
  });
  it('a weak hand facing a wager does not raise just because the raise alone priced later streets', () => {
    const r = planValue(
      base({ toCall: 10, pot: 30, equityAtShare: (s) => 0.1 + 0.2 * s, response: flat(0.2, 0.1) })
    )!;
    expect(r.choice.kind).not.toBe('wager');
  });
  it('a river bluff-catcher that is beaten by the betting range folds (fold priced at 0)', () => {
    const r = planValue(
      base({
        street: 'river',
        toCall: 30,
        pot: 60,
        equityAtShare: () => 0.1,
        response: flat(0.2, 0.1),
      })
    )!;
    expect(r.choice.kind).toBe('fold');
  });
});

describe('omahaMathCore value: raises without measured fold-to-raise (lead decision)', () => {
  it('the river nuts raise for value priced at the worse of called-by-all and the thin cell fold rate (COREWIRE-2: an unmeasured response never inflates a value raise)', () => {
    const r = planValue(
      base({
        street: 'river',
        toCall: 30,
        pot: 90,
        equityAtShare: () => 0.98,
        response: () => ({ fold: 0.8, raise: 0, callers: 1, n: 8, source: 'thin' }),
      })
    )!;
    expect(r.choice.kind).toBe('wager');
    // for the nuts the folded hypothesis is the worse one: every raise is priced with the thin cell's 0.8 folds
    for (const c of r.candidates.filter((x) => x.kind === 'wager'))
      expect(c.fold).toBeCloseTo(0.8, 6);
  });
  it('a bluff raise gets no fold equity below n 30 (it folds or calls instead)', () => {
    const r = planValue(
      base({
        street: 'river',
        toCall: 30,
        pot: 90,
        equityAtShare: () => 0.05,
        response: () => ({ fold: 0.8, raise: 0, callers: 1, n: 12, source: 'thin' }),
      })
    )!;
    expect(r.choice.kind).not.toBe('wager');
  });
  it('with n >= 30 measured fold-to-raise the fold credit counts', () => {
    const r = planValue(
      base({
        street: 'river',
        toCall: 30,
        pot: 90,
        equityAtShare: () => 0.05,
        response: () => ({ fold: 0.8, raise: 0, callers: 1, n: 200, source: 'measured' }),
      })
    )!;
    expect(r.candidates.filter((x) => x.kind === 'wager').some((c) => c.fold > 0.5)).toBe(true);
  });
  it('a value raise with no cell at all is still priced (called, showdown)', () => {
    const r = planValue(
      base({
        street: 'river',
        toCall: 30,
        pot: 90,
        equityAtShare: () => 0.98,
        response: (f, a, o, line) => (line === 'bet' ? curve(RIVER_HU)(f, a) : null),
      })
    )!;
    expect(r.candidates.some((c) => c.kind === 'wager')).toBe(true);
  });
});

describe('omahaMathCore value: river', () => {
  it('thin value: bets when the calling band is still beaten often enough, checks when it is not', () => {
    const thin = planValue(
      base({ street: 'river', response: flat(0.3), equityAtShare: (s) => 0.5 + 0.5 * s })
    )!;
    expect(thin.choice.kind).toBe('wager');
    const bad = planValue(
      base({ street: 'river', response: flat(0.05), equityAtShare: (s) => 0.05 + 0.4 * s })
    )!;
    expect(bad.choice.kind).toBe('check');
  });
  it('with the river curve the nuts prefers 80-95% over the full pot (value per pot .34 vs .23)', () => {
    const r = planValue(
      base({
        street: 'river',
        pot: 100,
        heroStack: 1000,
        oppStack: 1000,
        response: (f, a) => curve(RIVER_HU)(f, a),
        equityAtShare: () => 1,
        equitySe: 0,
      })
    )!;
    expect(r.choice.frac).toBeCloseTo(0.88, 2);
  });
});

describe('omahaMathCore value: sizes stay unreadable', () => {
  it('a thinly measured response cell widens the band of sizes the seed picks from', () => {
    const run = (n: number) =>
      planValue(
        base({
          street: 'river',
          pot: 100,
          heroStack: 5000,
          oppStack: 5000,
          response: (f) => ({
            fold: Math.min(0.9, 0.3 + 0.5 * f),
            raise: 0,
            callers: 1,
            n,
            source: 'constructed',
          }),
          equityAtShare: () => 1,
          equitySe: 0,
        })
      )!;
    expect(run(20).indifferent.length).toBeGreaterThan(run(100000).indifferent.length);
  });
  it('sizes the math cannot tell apart are picked by the seed, not by the hand', () => {
    const picks = new Set<number | null>();
    for (let i = 0; i < 40; i++) {
      const r = planValue(
        base({
          street: 'river',
          pot: 100,
          heroStack: 5000,
          oppStack: 5000,
          // continue rate inversely proportional to size: every size earns the same
          response: (f) => ({
            fold: 1 - 0.3 / f / 3,
            raise: 0,
            callers: 1,
            source: 'constructed flat value',
          }),
          equityAtShare: () => 1,
          equitySe: 0.01,
          seed: `seed-${i}`,
        })
      )!;
      expect(r.indifferent.length).toBeGreaterThan(1);
      picks.add(r.choice.frac);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
  it('every spot prices the same menu', () => {
    const a = planValue(base({ equityAtShare: () => 0.95 }))!;
    const b = planValue(base({ equityAtShare: () => 0.3 }))!;
    const fr = (r: typeof a) =>
      r.candidates.filter((c) => c.kind === 'wager' && !c.allIn).map((c) => c.frac);
    expect(fr(a)).toEqual(fr(b));
    expect(fr(a).length).toBe(VALUE_SIZE_MENU.length);
  });
});

describe('omahaMathCore value: equity curve from per-holding equities', () => {
  it('averages the strongest share by weight', () => {
    const order = [2, 0, 1, 3];
    const weight = [1, 1, 2, 0];
    const equity = [0.5, 0.9, 0.1, 0.7];
    const f = equityCurveFromHoldings(order, weight, equity);
    expect(f(0.5)).toBeCloseTo(0.1, 9); // the strongest half of the weight is holding 2
    expect(f(1)).toBeCloseTo((0.1 * 2 + 0.5 + 0.9) / 4, 9);
    expect(f(0.75)).toBeCloseTo((0.1 * 2 + 0.5) / 3, 9);
  });
});

describe('omahaMathCore value: range-level sizing (lead decision; owner 11-18: sizes must be unreadable)', () => {
  const nuts = { weight: 1, equityAtShare: () => 0.97, equitySe: 0.005 };
  const medium = { weight: 2, equityAtShare: (s: number) => 0.3 + 0.5 * s, equitySe: 0.005 };
  const air = { weight: 1, equityAtShare: () => 0.08, equitySe: 0.005 };
  const spot = {
    ...base({
      street: 'river',
      pot: 100,
      heroStack: 1000,
      oppStack: 1000,
      response: (f: number, a: boolean) => curve(RIVER_HU)(f, a),
    }),
  };
  it('every hand that wagers uses the node size: the nuts and a bluff bet the same size', () => {
    const range = [nuts, medium, air];
    const n = planRangeSize(spot, range, nuts)!;
    const b = planRangeSize(spot, range, air)!;
    const m = planRangeSize(spot, range, medium)!;
    expect(n.size).not.toBeNull();
    for (const r of [n, b, m]) if (r.hero.kind === 'wager') expect(r.hero.frac).toBe(n.size!.frac);
    expect(n.hero.kind).toBe('wager');
  });
  it('the size does not depend on which member is the hero (nut share is the same at every size)', () => {
    const range = [nuts, medium, air];
    const sizes = new Set(
      [nuts, medium, air].map((h) => JSON.stringify(planRangeSize(spot, range, h)!.size))
    );
    expect(sizes.size).toBe(1);
  });
  it('each hand still decides wager or check by its own EV at the node size', () => {
    const range = [nuts, medium, air];
    const weakShowdown = {
      weight: 1,
      equityAtShare: (s: number) => 0.1 + 0.5 * s,
      equitySe: 0.005,
    };
    const r = planRangeSize(spot, range, weakShowdown)!;
    const own = r.heroPlan.candidates.find((c) => c.kind === 'wager' && c.frac === r.size!.frac)!;
    expect(r.hero.kind).toBe(own.ev > r.hero.checkEv ? 'wager' : 'check');
  });
  it('the node size maximises the range EV, not the hero hand EV', () => {
    const range = [nuts, medium, air];
    const r = planRangeSize(spot, range, nuts)!;
    expect(r.rangeEv[0].frac).toBe(r.size!.frac);
    for (const x of r.rangeEv) expect(x.ev).toBeLessThanOrEqual(r.rangeEv[0].ev);
  });
  it('PLO6 answers null', () => {
    expect(planRangeSize({ ...spot, variant: 'plo6' }, [nuts], nuts)).toBeNull();
  });
  it('the receipt monitors the nut share of the wagering range at the node size', () => {
    const r = planRangeSize(
      spot,
      [
        { ...nuts, nut: true },
        { ...medium, nut: false },
        { ...air, nut: false },
      ],
      nuts
    )!;
    expect(r.monitor.nutShareOfRange).toBeCloseTo(0.25, 6);
    expect(r.monitor.nutShareOfWagersAtSize).not.toBeNull();
  });
  it('the trap follows the opponent tracker: a player who stops stabbing stops being trapped', () => {
    const trapSpot = (p: number) =>
      planValue(
        base({
          street: 'river',
          ip: false,
          checkCloses: false,
          pot: 100,
          heroStack: 1000,
          oppStack: 1000,
          equityAtShare: () => 0.97,
          response: (f: number, a: boolean) => curve(RIVER_HU)(f, a),
          wagerWhenChecked: () => ({ p, frac: 0.7, valueShare: 0.3, source: 'tracker' }),
        })
      )!;
    expect(trapSpot(0.9).choice.kind).toBe('check');
    expect(trapSpot(0.05).choice.kind).toBe('wager');
  });
  it('shared-runout equity curves: a holding that always wins has equity 1 against every share', () => {
    // constructed evaluator: holding [i] scores i on every runout
    const best = (h: readonly number[]) => h[0];
    const { curves } = equityCurvesOnSharedRunouts(
      [[50]],
      [[1], [2], [3]],
      [1, 1, 1],
      [[40, 41, 42, 43, 44]],
      best
    );
    expect(curves[0](0.3)).toBeCloseTo(1, 9);
    expect(curves[0](1)).toBeCloseTo(1, 9);
    const { curves: c2 } = equityCurvesOnSharedRunouts(
      [[2]],
      [[1], [2], [3]],
      [1, 1, 1],
      [[40, 41, 42, 43, 44]],
      best
    );
    expect(c2[0](1 / 3)).toBeCloseTo(0, 9); // the strongest third is holding 3: the hero loses
    expect(c2[0](1)).toBeCloseTo((0 + 0.5 + 1) / 3, 9);
  });
});

describe('omahaMathCore value: an unmeasured check-raise never outprices a measured value bet (COREWIRE-2, PROVE-2 c4)', () => {
  // PROVE-2 c4 bet->check losers (hand ids only): river 60054627 s1, 60060101 s1, 60035127 s4; turn 60128359 s3.
  // The trap check was priced as a check-raise called by the bettor's WHOLE wagering range (bluffs included)
  // because the check-raise response had no n >= 30 cell. An unmeasured response now takes the worse hypothesis.
  const spotOf = (street: 'turn' | 'river') =>
    base({
      street,
      pot: 300,
      heroStack: 800,
      oppStack: 800,
      ip: false,
      checkCloses: false,
      equityAtShare: () => 1,
      response: (f, allIn, _off, line) =>
        line === 'bet'
          ? {
              fold: Math.min(0.85, 0.43 + 0.3 * Math.min(1, f)),
              raise: 0.05,
              callers: 1,
              n: 120,
              source: 'measured bet',
            }
          : { fold: 0.6, raise: 0, callers: 1, n: 4, source: 'thin check-raise cell' },
      wagerWhenChecked: () => ({ p: 0.33, frac: 0.6, valueShare: 0.5, source: 'measured stab' }),
    });
  it('the river nuts bet rather than trap-check under the core selection (EV minus its standard error)', () => {
    const r = planValue(spotOf('river'))!;
    console.log('LAWPROBE', JSON.stringify(r.candidates.map((c) => [c.kind, c.frac, c.ev, c.se])));
    const top = [...r.candidates].sort((x, y) => y.ev - y.se - (x.ev - x.se))[0];
    expect(top.kind).toBe('wager');
  });
  it('the check line prices its check-raise with the thin cell fold rate, not called by every bettor', () => {
    const r = planValue(spotOf('river'))!;
    const check = r.candidates.find((c) => c.kind === 'check')!;
    // check = 0.33 x (best reply) + 0.67 x the pot; called-by-all would give the reply a full stack-off from bluffs too
    expect(check.ev).toBeLessThan(0.33 * (300 + 180 + 2 * 620) + 0.67 * 300);
  });
});
