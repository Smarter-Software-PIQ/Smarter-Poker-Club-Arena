/**
 * omahaFlopBetUsesMeasuredFoldShare (WooWoo audit FOLD-SHARE): a person's fold share to the v38 flop
 * bet is the fitted person model in place of mdfFold x foldMul. Off (or out of the spot) the engine is
 * exactly as before. Fixtures are anonymised (the Horse's own cards, the board, pot and stacks; no ids).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { evaluateSpot, mdfFold, type EvSpot } from './HorseEvEngine.js';
import { HorseMind } from './HorseMind.js';
import type { HorseDecideOpts } from './HorseLogic.js';
import {
  OMAHA_FLOP_BET_PERSON_FOLD_FIT as F,
  omahaFlopBetMeasuredFoldShareOf,
  omahaFlopMeasuredFoldShare,
  omahaFlopPersonRead,
  omahaFlopPotTypeOf,
  omahaFlopSprBandOf,
  type OmahaFlopFoldCell,
} from './HorseOmahaFlopBetMeasuredFoldShare.js';
import { decideAt, LIVE_OPTIONS, pricedSpot } from './HorseOmahaPricedRules.test-support.js';

afterEach(() => {
  HorseMind.reset();
});

const ON = { omahaFlopBetUsesMeasuredFoldShare: true } as HorseDecideOpts;
const sig = (z: number) => 1 / (1 + Math.exp(-z));
const lg = (p: number) => Math.log(p / (1 - p));

const baseSpot = (o: Partial<EvSpot> & { pot: number; stack: number; equity: number }): EvSpot => ({
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
const GRID: Array<[number, number, number, boolean]> = [];
for (const equity of [0.15, 0.35, 0.55, 0.75, 0.92])
  for (const [pot, stack] of [
    [100, 1000],
    [315, 361.6],
    [50, 40],
  ])
    for (const ip of [true, false]) GRID.push([equity, pot, stack, ip]);

describe('the engine: no fold share, or one that declines, prices exactly as before', () => {
  it('candidates identical (absent, null, and mdfFold itself)', () => {
    for (const [equity, pot, stack, inPosition] of GRID) {
      const s = baseSpot({ pot, stack, equity, inPosition });
      const plain = evaluateSpot(s);
      expect(evaluateSpot({ ...s, foldShareOf: () => null }).candidates).toEqual(plain.candidates);
      expect(
        evaluateSpot({ ...s, foldShareOf: (_i, p, w) => mdfFold(p, w, 1.4) }).candidates
      ).toEqual(plain.candidates);
    }
  });
  it('facing a bet the fold share is never read', () => {
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
  it('a lower fold share never moves the check, and prices a bluff (called EV below the pot) lower', () => {
    for (const [equity, pot, stack, inPosition] of GRID) {
      const s = baseSpot({ pot, stack, equity, inPosition });
      const hi = evaluateSpot({ ...s, foldShareOf: (_i, p, w) => mdfFold(p, w, 1.4) });
      const lo = evaluateSpot({ ...s, foldShareOf: (_i, p, w) => mdfFold(p, w, 0.9) });
      const check = (v: typeof hi) => v.candidates.find((c) => c.kind === 'check')?.ev;
      expect(check(lo)).toBe(check(hi));
      for (const c of lo.candidates)
        if (c.kind === 'bet' && equity <= 0.15) {
          const h = hi.candidates.find((x) => x.kind === 'bet' && x.amount === c.amount)!;
          expect(c.ev).toBeLessThanOrEqual(h.ev + 1e-9);
        }
    }
  });
});

const cell = (o: Partial<OmahaFlopFoldCell> = {}): OmahaFlopFoldCell => ({
  variant: 'plo4',
  potType: 'srp',
  sprBand: 'ge8',
  horseInPosition: true,
  counters: null,
  ...o,
});

describe('the fitted person model', () => {
  it('a stranger in the reference cell is the fitted intercept and size slope exactly', () => {
    for (const frac of [0.33, 0.5, 0.75, 1]) {
      const mdf = frac / (1 + frac);
      expect(omahaFlopMeasuredFoldShare(cell(), 100, 100 * frac)).toBeCloseTo(
        sig(F.intercept + F.logitMdf * lg(mdf)),
        12
      );
    }
    expect(omahaFlopPersonRead(cell())).toBeCloseTo(F.personPopulation.plo4, 12);
    expect(omahaFlopPersonRead(cell({ counters: { hit: 0, opp: 0 } }))).toBeCloseTo(
      F.personPopulation.plo4,
      12
    );
  });
  it('rises with the size, continuously (no step)', () => {
    let prev = 0;
    for (let s = 5; s <= 100; s += 5) {
      const f = omahaFlopMeasuredFoldShare(cell(), 100, s)!;
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });
  it('his own record moves it, shrunk toward the person population', () => {
    const stranger = omahaFlopMeasuredFoldShare(cell(), 100, 75)!;
    const folder = omahaFlopMeasuredFoldShare(cell({ counters: { hit: 30, opp: 40 } }), 100, 75)!;
    const station = omahaFlopMeasuredFoldShare(cell({ counters: { hit: 4, opp: 40 } }), 100, 75)!;
    const thin = omahaFlopMeasuredFoldShare(cell({ counters: { hit: 3, opp: 4 } }), 100, 75)!;
    expect(folder).toBeGreaterThan(stranger);
    expect(station).toBeLessThan(stranger);
    expect(thin).toBeGreaterThan(stranger);
    expect(thin).toBeLessThan(folder);
    // hit is bounded by opp
    expect(omahaFlopPersonRead(cell({ counters: { hit: 99, opp: 4 } }))).toBeCloseTo(
      omahaFlopPersonRead(cell({ counters: { hit: 4, opp: 4 } })),
      12
    );
  });
  it('the measured gap: a stranger is credited fewer folds than the engine base model at 75% pot', () => {
    // FOLD-SHARE MEASUREMENT: persons fold 0.433 to 0.60-0.85 pot bets, the base model 0.596.
    for (const [variant, foldOverMdf] of [
      ['plo4', 1.289],
      ['plo5', 1.458],
    ] as const)
      for (const potType of ['srp', 'threeBet', 'fourBetPlus'] as const)
        for (const horseInPosition of [true, false]) {
          const m = omahaFlopMeasuredFoldShare(
            cell({ variant, potType, sprBand: 'b4to8', horseInPosition }),
            100,
            75
          )!;
          expect(m).toBeLessThan(mdfFold(100, 75, foldOverMdf));
        }
  });
  it('pot type and SPR band from the public state', () => {
    expect([0, 1, 2, 3, 5].map(omahaFlopPotTypeOf)).toEqual([
      'limped',
      'srp',
      'threeBet',
      'fourBetPlus',
      'fourBetPlus',
    ]);
    expect([0.5, 2, 3.9, 4, 7.99, 8, 30].map(omahaFlopSprBandOf)).toEqual([
      'lt2',
      'b2to4',
      'b2to4',
      'b4to8',
      'b4to8',
      'ge8',
      'ge8',
    ]);
  });
  it('declines a wager it cannot price', () => {
    expect(omahaFlopMeasuredFoldShare(cell(), 0, 10)).toBeNull();
    expect(omahaFlopMeasuredFoldShare(cell(), 100, 0)).toBeNull();
    expect(omahaFlopMeasuredFoldShare(cell(), 100, Number.NaN)).toBeNull();
  });
});

const flop = () => pricedSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', bet: 0, inPosition: true });
type Gs = {
  humanUserIds?: string[];
  players: Array<{ seat: number; user_id: string; is_horse?: boolean; stack: number }>;
};
const oppsOf = (st: ReturnType<typeof flop>, gs: Gs) =>
  gs.players.filter((p) => p.seat !== (st.hero as { seat: number }).seat);
const asPerson = (st: ReturnType<typeof flop>): Gs => {
  const gs = structuredClone(st.gs) as Gs;
  const opp = gs.players.find((p) => p.seat === 1)!;
  gs.humanUserIds = [opp.user_id];
  return gs;
};
const build = (st: ReturnType<typeof flop>, gs: Gs, opts: HorseDecideOpts, toCall = 0) =>
  omahaFlopBetMeasuredFoldShareOf(
    st.hero as never,
    gs as never,
    opts,
    oppsOf(st, gs) as never,
    315,
    toCall,
    361.6,
    true,
    () => ({ hit: 10, opp: 30 })
  );

describe('the builder: scope', () => {
  it('off: off', () => {
    const st = flop();
    expect(build(st, asPerson(st), {} as HorseDecideOpts).kind).toBe('off');
  });
  it('on, heads-up against a person on the flop facing no bet: priced, his read in the cell', () => {
    const st = flop();
    const v = build(st, asPerson(st), ON);
    expect(v.kind).toBe('priced');
    if (v.kind !== 'priced') return;
    expect(v.cell.counters).toEqual({ hit: 10, opp: 30 });
    expect(v.cell.sprBand).toBe(omahaFlopSprBandOf(361.6 / 315));
    expect(v.foldShareOf(v.opponentIndex, 315, 200)).toBeCloseTo(
      omahaFlopMeasuredFoldShare(v.cell, 315, 200)!,
      12
    );
    expect(v.foldShareOf(v.opponentIndex + 1, 315, 200)).toBeNull();
  });
  it('against a Horse: unpriced (the model is a person measurement)', () => {
    const st = flop();
    const gs = structuredClone(st.gs) as Gs;
    gs.humanUserIds = [];
    for (const p of gs.players) p.is_horse = true;
    expect(build(st, gs, ON).kind).toBe('unpriced');
  });
  it('facing a bet, on the turn, or at a tournament: off', () => {
    const st = flop();
    expect(build(st, asPerson(st), ON, 50).kind).toBe('off');
    const turn = pricedSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s2h', bet: 0, inPosition: true });
    expect(build(turn, asPerson(turn), ON).kind).toBe('off');
    const t = { ...(asPerson(st) as object), gameMode: 'tournament' } as unknown as Gs;
    expect(build(st, t, ON).kind).toBe('off');
  });
});

describe('a whole decision', () => {
  it('option off: the decision equals the decision without the option key; on: legal, with a receipt', () => {
    enableBrainTelemetry();
    const st = pricedSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', bet: 0, inPosition: true });
    const strip = (d: unknown) =>
      JSON.parse(
        JSON.stringify(d, (k, v) =>
          k === 'elapsedMs' || k === 'thinkTime' || k === 'latencyMs' ? undefined : v
        )
      );
    let receipts = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const base = decideAt(st, { ...LIVE_OPTIONS, telemetry: true } as HorseDecideOpts, seed);
      drainFires();
      const off = decideAt(
        st,
        {
          ...LIVE_OPTIONS,
          telemetry: true,
          omahaFlopBetUsesMeasuredFoldShare: false,
        } as HorseDecideOpts,
        seed
      );
      const offFires = drainFires().map((f) => f.feature);
      expect(strip(off)).toEqual(strip(base));
      expect(offFires.some((f) => f.startsWith('omaha_flop_bet_measured_fold_share'))).toBe(false);
      const on = decideAt(st, { ...LIVE_OPTIONS, ...ON, telemetry: true } as HorseDecideOpts, seed);
      const onFires = drainFires().map((f) => f.feature);
      expect(['check', 'bet', 'all_in']).toContain(on.action);
      receipts += onFires.filter((f) => f.startsWith('omaha_flop_bet_measured_fold_share')).length;
      // eslint-disable-next-line no-console
      console.log(
        `[decision seed ${seed}] base ${base.action} ${base.amount ?? ''} | on ${on.action} ${on.amount ?? ''} | ${onFires
          .filter((f) => f.startsWith('omaha_flop_bet_measured_fold_share') || f === 'v38_ev_bet')
          .join(',')}`
      );
    }
    // eslint-disable-next-line no-console
    console.log(`[receipts] ${receipts}`);
  }, 300000);
});
