/**
 * omahaFoldModelFittedOnPeople (WooWoo audit FOLD-MODEL): a person's fold share to a v38 flop / turn bet
 * is the fold model fitted on people only, in place of mdfFold x foldMul. Off (or out of the spot) the
 * engine is exactly as before. Fixtures are anonymised (the Horse's own cards, the board, pot and stacks).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { evaluateSpot, mdfFold, type EvSpot } from './HorseEvEngine.js';
import { HorseMind, OMAHA_EV_FOLD_MODEL, OMAHA_EV_FOLD_PRIOR_STRENGTH } from './HorseMind.js';
import type { HorseDecideOpts } from './HorseLogic.js';
import {
  OMAHA_PERSON_FOLD_CELLS as CELLS,
  OMAHA_PERSON_FOLD_FIT as FIT,
  omahaFoldModelFittedOnPeopleOf,
  omahaOldFoldMul,
  omahaPersonFoldFactor,
  omahaPersonFoldPotTypeOf,
  omahaPersonFoldShare,
  omahaPersonFoldSizeBucketOf,
  type OmahaPersonFoldSpot,
} from './HorseOmahaFoldModelFittedOnPeople.js';
import { decideAt, LIVE_OPTIONS, pricedSpot } from './HorseOmahaPricedRules.test-support.js';

afterEach(() => {
  HorseMind.reset();
});

const ON = { omahaFoldModelFittedOnPeople: true } as HorseDecideOpts;
const spotOf = (o: Partial<OmahaPersonFoldSpot> = {}): OmahaPersonFoldSpot => ({
  variant: 'plo4',
  street: 'flop',
  potType: 'srp',
  counters: null,
  ...o,
});
const VARIANTS = ['plo4', 'plo5'] as const;
const STREETS = ['flop', 'turn'] as const;
const POTS = ['limped', 'srp', 'threeBet', 'fourBetPlus'] as const;
const SIZES: ReadonlyArray<[string, number]> = [
  ['le40', 0.33],
  ['b40to60', 0.5],
  ['b60to85', 0.75],
  ['gt85', 1],
];

describe('the engine hook: absent, declining, or the old fold share prices exactly as before', () => {
  const baseSpot = (
    o: Partial<EvSpot> & { pot: number; stack: number; equity: number }
  ): EvSpot => ({
    toCall: 0,
    effectiveStack: o.stack,
    street: 'flop',
    inPosition: true,
    opponents: 1,
    models: [{ foldMul: 1.4 }],
    realization: 0.8,
    rakeMarg: 0.05,
    minBet: 2,
    maxBet: o.pot,
    sizes: [0.33, 0.5, 0.75, 1],
    initiative: true,
    rand: () => 0.5,
    ...o,
  });
  it('candidates identical', () => {
    for (const equity of [0.15, 0.35, 0.55, 0.75, 0.92])
      for (const [pot, stack] of [
        [100, 1000],
        [315, 361.6],
        [50, 40],
      ]) {
        const s = baseSpot({ pot, stack, equity });
        const plain = evaluateSpot(s);
        expect(evaluateSpot({ ...s, foldShareOf: () => null }).candidates).toEqual(
          plain.candidates
        );
        expect(
          evaluateSpot({ ...s, foldShareOf: (_i, p, w) => mdfFold(p, w, 1.4) }).candidates
        ).toEqual(plain.candidates);
      }
  });
  it('a fitted share that is lower prices a pure bluff lower; facing a bet it is never read', () => {
    const s = baseSpot({ pot: 100, stack: 1000, equity: 0.05 });
    const hi = evaluateSpot(s);
    const lo = evaluateSpot({ ...s, foldShareOf: (_i, p, w) => mdfFold(p, w, 0.9) });
    for (const c of lo.candidates)
      if (c.kind === 'bet') {
        const h = hi.candidates.find((x) => x.kind === 'bet' && x.amount === c.amount)!;
        expect(c.ev).toBeLessThan(h.ev);
      }
    let reads = 0;
    evaluateSpot({
      ...baseSpot({ pot: 200, stack: 500, equity: 0.6 }),
      toCall: 50,
      foldShareOf: () => {
        reads++;
        return 0.5;
      },
    });
    expect(reads).toBe(0);
  });
});

describe('the fitted lookup', () => {
  it('the person read prior is the old model prior strength; a stranger is the person population', () => {
    expect(FIT.personalPriorStrength).toBe(OMAHA_EV_FOLD_PRIOR_STRENGTH);
    for (const variant of VARIANTS) {
      expect(omahaPersonFoldFactor(spotOf({ variant }))).toBeCloseTo(1, 12);
      expect(omahaPersonFoldFactor(spotOf({ variant, counters: { hit: 0, opp: 0 } }))).toBeCloseTo(
        1,
        12
      );
    }
  });
  it('every cell selects its own measured counts (closed form), an empty cell is the old model exactly', () => {
    let empty = 0;
    let measured = 0;
    for (const variant of VARIANTS)
      for (const street of STREETS)
        for (const potType of POTS)
          for (const [bucket, frac] of SIZES) {
            const sp = spotOf({ variant, street, potType });
            const P = 200;
            const s = P * frac;
            expect(omahaPersonFoldSizeBucketOf(P, s)).toBe(bucket);
            const got = omahaPersonFoldShare(sp, P, s)!;
            const mdf = s / (P + s);
            const old = omahaOldFoldMul(sp);
            const cell = CELLS[`${variant}|${street}|${potType}|${bucket}`];
            if (!cell) {
              empty++;
              expect(got).toBeCloseTo(mdfFold(P, s, old), 12);
            } else {
              measured++;
              const [folds, units] = cell;
              const R = (folds + FIT.shrinkToOldModel * old) / (units + FIT.shrinkToOldModel);
              expect(got).toBeCloseTo(Math.max(0.02, Math.min(0.92, mdf * R)), 12);
            }
          }
    expect(measured).toBe(Object.keys(CELLS).length);
    expect(empty + measured).toBe(64);
  });
  it('a long cell speaks for itself: the measured ratio, not the old model', () => {
    // plo4 flop SRP 40-60% pot: 70 folds of 199 answers (fit.json), ratio about 1.1 against the old 1.289.
    const [folds, units, n] = CELLS['plo4|flop|srp|b40to60'];
    expect(n).toBe(199);
    expect(folds).toBe(70);
    const sp = spotOf();
    const got = omahaPersonFoldShare(sp, 100, 50)!;
    const measuredOnly = (50 / 150) * (folds / units);
    const oldOnly = mdfFold(100, 50, omahaOldFoldMul(sp));
    expect(Math.abs(got - measuredOnly)).toBeLessThan(Math.abs(got - oldOnly));
    expect(got).toBeLessThan(oldOnly);
  });
  it('the measured gap: a stranger is credited fewer folds than OMAHA_EV_FOLD_MODEL in the long flop cells', () => {
    for (const [key, frac] of [
      ['plo4|flop|srp|b60to85', 0.75],
      ['plo5|flop|threeBet|le40', 0.33],
      ['plo5|flop|srp|b60to85', 0.75],
      ['plo5|turn|srp|b60to85', 0.75],
    ] as const) {
      const [variant, street, potType] = key.split('|') as [
        OmahaPersonFoldSpot['variant'],
        OmahaPersonFoldSpot['street'],
        OmahaPersonFoldSpot['potType'],
      ];
      const sp = spotOf({ variant, street, potType });
      expect(omahaPersonFoldShare(sp, 100, 100 * frac)!).toBeLessThan(
        mdfFold(100, 100 * frac, OMAHA_EV_FOLD_MODEL[variant].foldOverMdf)
      );
    }
  });
  it('his own record moves it, shrunk toward people', () => {
    const stranger = omahaPersonFoldShare(spotOf(), 100, 75)!;
    const folder = omahaPersonFoldShare(spotOf({ counters: { hit: 30, opp: 40 } }), 100, 75)!;
    const station = omahaPersonFoldShare(spotOf({ counters: { hit: 4, opp: 40 } }), 100, 75)!;
    const thin = omahaPersonFoldShare(spotOf({ counters: { hit: 3, opp: 4 } }), 100, 75)!;
    expect(folder).toBeGreaterThan(stranger);
    expect(station).toBeLessThan(stranger);
    expect(thin).toBeGreaterThan(stranger);
    expect(thin).toBeLessThan(folder);
    expect(omahaPersonFoldFactor(spotOf({ counters: { hit: 99, opp: 4 } }))).toBeCloseTo(
      omahaPersonFoldFactor(spotOf({ counters: { hit: 4, opp: 4 } })),
      12
    );
  });
  it('pot type from preflop raises; declines a wager it cannot price', () => {
    expect([0, 1, 2, 3, 5].map(omahaPersonFoldPotTypeOf)).toEqual([
      'limped',
      'srp',
      'threeBet',
      'fourBetPlus',
      'fourBetPlus',
    ]);
    expect(omahaPersonFoldShare(spotOf(), 0, 10)).toBeNull();
    expect(omahaPersonFoldShare(spotOf(), 100, 0)).toBeNull();
    expect(omahaPersonFoldShare(spotOf(), 100, Number.NaN)).toBeNull();
  });
});

const flop = () => pricedSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', bet: 0, inPosition: true });
type Gs = {
  stage?: string;
  humanUserIds?: string[];
  players: Array<{
    seat: number;
    user_id: string;
    is_horse?: boolean;
    stack: number;
    is_folded?: boolean;
  }>;
};
const oppsOf = (st: ReturnType<typeof flop>, gs: Gs) =>
  gs.players.filter((p) => p.seat !== (st.hero as { seat: number }).seat && !p.is_folded);
const asPerson = (st: ReturnType<typeof flop>): Gs => {
  const gs = structuredClone(st.gs) as Gs;
  const opp = gs.players.find((p) => p.seat === 1)!;
  gs.humanUserIds = [opp.user_id];
  return gs;
};
const build = (st: ReturnType<typeof flop>, gs: Gs, opts: HorseDecideOpts, toCall = 0) =>
  omahaFoldModelFittedOnPeopleOf(
    st.hero as never,
    gs as never,
    opts,
    oppsOf(st, gs) as never,
    toCall,
    () => ({ hit: 10, opp: 30 })
  );

describe('the option gate', () => {
  it('off: off', () => {
    const st = flop();
    expect(build(st, asPerson(st), {} as HorseDecideOpts).kind).toBe('off');
    expect(
      build(st, asPerson(st), { omahaFoldModelFittedOnPeople: false } as HorseDecideOpts).kind
    ).toBe('off');
  });
  it('on, heads-up against a person facing no bet (flop and turn): priced with his read', () => {
    for (const board of ['8s6c9s', '8s6c9s2h']) {
      const st = pricedSpot({ hole: 'AdAhKdJd4h', board, bet: 0, inPosition: true });
      const v = build(st, asPerson(st), ON);
      expect(v.kind).toBe('priced');
      if (v.kind !== 'priced') continue;
      expect(v.spot.street).toBe(board.length === 6 ? 'flop' : 'turn');
      expect(v.spot.counters).toEqual({ hit: 10, opp: 30 });
      expect(v.foldShareOf(v.opponentIndex, 315, 200)).toBeCloseTo(
        omahaPersonFoldShare(v.spot, 315, 200)!,
        12
      );
      expect(v.foldShareOf(v.opponentIndex + 1, 315, 200)).toBeNull();
    }
  });
  it('against a Horse: unpriced; facing a bet, on the river, multiway or at a tournament: off', () => {
    const st = flop();
    const gs = structuredClone(st.gs) as Gs;
    gs.humanUserIds = [];
    for (const p of gs.players) p.is_horse = true;
    expect(build(st, gs, ON).kind).toBe('unpriced');
    expect(build(st, asPerson(st), ON, 50).kind).toBe('off');
    const river = pricedSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s2h3d', bet: 0, inPosition: true });
    expect(build(river, asPerson(river), ON).kind).toBe('off');
    const t = { ...(asPerson(st) as object), gameMode: 'tournament' } as unknown as Gs;
    expect(build(st, t, ON).kind).toBe('off');
    const multi = asPerson(st);
    multi.players.push({ ...multi.players.find((p) => p.seat === 1)!, seat: 3, user_id: 'third' });
    expect(build(st, multi, ON).kind).toBe('off');
  });
  it('a whole decision: off equals the decision without the key (no receipt); on prices with a receipt', () => {
    enableBrainTelemetry();
    const raw = flop();
    // the engine names the seats a person plays (gs.humanUserIds); the fixture leaves it out
    const st = Object.assign(raw, {
      fresh: () => {
        const now = flop();
        (now.gs as unknown as Gs).humanUserIds = [asPerson(now).humanUserIds![0]];
        return now;
      },
    });
    const strip = (d: unknown) =>
      JSON.parse(
        JSON.stringify(d, (k, v) =>
          k === 'elapsedMs' || k === 'thinkTime' || k === 'latencyMs' ? undefined : v
        )
      );
    let priced = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const base = decideAt(st, { ...LIVE_OPTIONS, telemetry: true } as HorseDecideOpts, seed);
      drainFires();
      const off = decideAt(
        st,
        {
          ...LIVE_OPTIONS,
          telemetry: true,
          omahaFoldModelFittedOnPeople: false,
        } as HorseDecideOpts,
        seed
      );
      const offFires = drainFires().map((f) => f.feature);
      expect(strip(off)).toEqual(strip(base));
      expect(offFires.some((f) => f.startsWith('omaha_fold_model_fitted_on_people'))).toBe(false);
      const on = decideAt(st, { ...LIVE_OPTIONS, ...ON, telemetry: true } as HorseDecideOpts, seed);
      const onFires = drainFires().map((f) => f.feature);
      expect(['check', 'bet', 'all_in']).toContain(on.action);
      priced += onFires.filter((f) => f === 'omaha_fold_model_fitted_on_people_priced').length;
    }
    expect(priced).toBeGreaterThan(0);
  }, 300000);
});
