/**
 * omahaReadIsByStreetAndTexture (2026-11-18): the per-street, per-texture opponent read of #11215 is USED,
 * and with no street record (production until migration 20261117175407 is installed and cells fill) or with the
 * option off every decision is byte-identical.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import {
  RECORDED_FACING_BETS,
  expand,
  type RecordedFacingBet,
} from './HorseOmahaFacingBetEv.test-support.js';
import {
  addStreetReadEvidence,
  emptyStreetRead,
  type StreetReadCounters,
} from './HorseOmahaStreetRead.js';
import { opponentMemoryKey } from './HorseOpponentMemory.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  OMAHA_READ_BY_STREET_OFF,
  omahaReadByStreetModeOf,
  omahaReadConditionalByStreet,
  omahaStreetBetRate,
  omahaStreetRatesOf,
  omahaStreetScale,
  omahaStreetValueLeader,
} from './HorseOmahaReadByStreet.js';
import { omahaPricedKindPrior } from './HorseOmahaPricedMode.js';
import { omahaPricedStreetRatesSourceNow } from './HorseOmahaPricedWiring.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const MEANS = { bet: 0.3, foldToBet: 0.45, riverCall: 0.35 };
const card = (rank: string, suit: string) => ({ rank, suit }) as never;
const FLOP_RAINBOW = [card('K', 'spades'), card('8', 'hearts'), card('3', 'clubs')];
const FLOP_PAIRED = [card('8', 'spades'), card('8', 'hearts'), card('3', 'clubs')];

/** `n` hands: on `street` (and, on the flop, `texture`) he bets with probability `bet` and folds to bets with `fold`. */
function rowOf(
  n: number,
  shape: Partial<Record<'flop' | 'turn' | 'river', { bet: number; fold: number }>>,
  texture: 'paired' | 'rainbow' | 'twoTone' | 'monotone' = 'rainbow'
): StreetReadCounters {
  let r: StreetReadCounters | null = null;
  for (let i = 0; i < n; i++) {
    const inc = emptyStreetRead();
    for (const street of ['flop', 'turn', 'river'] as const) {
      const s = shape[street];
      if (!s) continue;
      const b = (i % 10) / 10 < s.bet ? 1 : 0;
      const f = ((i * 7) % 10) / 10 < s.fold ? 1 : 0;
      inc.bet[street] = { hit: b, opp: 1 };
      inc.foldToBet[street] = { hit: f, opp: 1 };
      inc.foldToRaise[street] = { hit: f, opp: 1 };
      if (street === 'flop') inc.flopBet[texture] = { hit: b, opp: 1 };
    }
    r = addStreetReadEvidence(r, inc);
  }
  return r ?? emptyStreetRead();
}
const stat = (mean: number, n: number) => ({ mean, n, engaged: null, excess: 0 }) as never;
function pooled(valueLeader: boolean): OmahaReadConditional {
  return {
    hands: 40,
    measured: true,
    tightReRaiser: false,
    wideReRaiser: false,
    valueLeader,
    postflopAggressor: false,
    threeBet: stat(0.1, 20),
    betCheckedTo: stat(valueLeader ? 0.25 : 0.4, 30),
    foldToBet: stat(valueLeader ? 0.5 : 0.4, 30),
    riverCall: stat(0.3, 10),
  } as OmahaReadConditional;
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the mode of one decision', () => {
  const gs = (over: Record<string, unknown>) => ({
    gameVariant: 'plo5',
    gameMode: 'cash',
    stage: 'flop',
    communityCards: FLOP_RAINBOW,
    ...over,
  });
  it('is on only for PLO4/PLO5 cash postflop, one board, no bomb pot, with the option', () => {
    expect(omahaReadByStreetModeOf(true, gs({}))).toMatchObject({
      on: true,
      street: 'flop',
      texture: 'rainbow',
    });
    expect(omahaReadByStreetModeOf(true, gs({ communityCards: FLOP_PAIRED })).texture).toBe(
      'paired'
    );
    expect(omahaReadByStreetModeOf(true, gs({ gameVariant: 'plo4', stage: 'river' })).street).toBe(
      'river'
    );
    for (const off of [
      omahaReadByStreetModeOf(false, gs({})),
      omahaReadByStreetModeOf(true, gs({ gameVariant: 'plo6' })),
      omahaReadByStreetModeOf(true, gs({ gameVariant: 'nlh' })),
      omahaReadByStreetModeOf(true, gs({ gameMode: 'tournament' })),
      omahaReadByStreetModeOf(true, gs({ stage: 'preflop' })),
      omahaReadByStreetModeOf(true, gs({ boardCount: 2 })),
      omahaReadByStreetModeOf(true, gs({ communityCards2: FLOP_RAINBOW })),
      omahaReadByStreetModeOf(true, gs({ bombPot: true })),
    ])
      expect(off).toBe(OMAHA_READ_BY_STREET_OFF);
  });
});

describe('the value-leader quantity by street', () => {
  it('with no street evidence it is the pooled label exactly (both ways)', () => {
    for (const label of [true, false]) {
      const p = pooled(label);
      for (const row of [null, emptyStreetRead(), rowOf(40, { turn: { bet: 0.9, fold: 0.1 } })]) {
        const v = omahaStreetValueLeader(p, row, 'flop', 'rainbow', MEANS)!;
        expect(v.valueLeader).toBe(label);
        expect(v.weight).toBe(label ? 1 : 0);
        expect(v.opportunities).toBe(0);
      }
    }
    expect(
      omahaStreetValueLeader(
        null,
        rowOf(40, { flop: { bet: 0.1, fold: 0.9 } }),
        'flop',
        'rainbow',
        MEANS
      )
    ).toBeNull();
  });

  it('the WooWoo shape: value leader by the pooled read, a wide flop bettor on unpaired flops, value on the turn', () => {
    // bets 80% of unpaired flops and folds 20% to flop bets; turn: bets 10%, folds 60%
    const row = rowOf(60, { flop: { bet: 0.8, fold: 0.2 }, turn: { bet: 0.1, fold: 0.6 } });
    const p = pooled(true);
    const flop = omahaStreetValueLeader(p, row, 'flop', 'rainbow', MEANS)!;
    const turn = omahaStreetValueLeader(p, row, 'turn', null, MEANS)!;
    expect(flop.valueLeader).toBe(false);
    expect(turn.valueLeader).toBe(true);
    // the texture cell is read on the flop: no paired-flop evidence keeps the pooled label there
    expect(omahaStreetValueLeader(p, row, 'flop', 'paired', MEANS)!.valueLeader).toBe(true);
  });

  it('is continuous in the evidence: the weight moves monotonically toward the street evidence', () => {
    const p = pooled(true);
    let last = 1;
    for (const n of [1, 2, 4, 8, 16, 32, 64]) {
      const w = omahaStreetValueLeader(
        p,
        rowOf(n, { river: { bet: 0.9, fold: 0.1 } }),
        'river',
        null,
        MEANS
      )!.weight;
      expect(w).toBeLessThanOrEqual(last + 1e-12);
      expect(w).toBeGreaterThanOrEqual(0);
      last = w;
    }
    expect(last).toBeLessThan(0.2);
  });

  it('the pooled read is returned as is when the street does not move the label', () => {
    const p = pooled(true);
    const mode = omahaReadByStreetModeOf(true, {
      gameVariant: 'plo5',
      gameMode: 'cash',
      stage: 'turn',
      communityCards: FLOP_RAINBOW,
    });
    expect(omahaReadConditionalByStreet(p, null, mode, MEANS)).toBe(p);
    expect(
      omahaReadConditionalByStreet(p, rowOf(60, { turn: { bet: 0.1, fold: 0.6 } }), mode, MEANS)
    ).toBe(p);
    const moved = omahaReadConditionalByStreet(
      p,
      rowOf(60, { turn: { bet: 0.9, fold: 0.1 } }),
      mode,
      MEANS
    )!;
    expect(moved.valueLeader).toBe(false);
    expect({ ...moved, valueLeader: true }).toEqual(p);
    expect(
      omahaReadConditionalByStreet(
        p,
        rowOf(60, { turn: { bet: 0.9, fold: 0.1 } }),
        OMAHA_READ_BY_STREET_OFF,
        MEANS
      )
    ).toBe(p);
  });
});

describe('the bet rate and the priced cells by street', () => {
  const mode = (stage: string, flop = FLOP_RAINBOW) =>
    omahaReadByStreetModeOf(true, {
      gameVariant: 'plo4',
      gameMode: 'cash',
      stage,
      communityCards: flop,
    });
  it('the bet rate is the pooled rate with no cell, the street rate with a deep one', () => {
    expect(omahaStreetBetRate(null, mode('turn'), 0.31)).toBe(0.31);
    expect(omahaStreetBetRate(emptyStreetRead(), mode('turn'), 0.31)).toBe(0.31);
    expect(
      omahaStreetBetRate(rowOf(60, { turn: { bet: 0.9, fold: 0 } }), OMAHA_READ_BY_STREET_OFF, 0.31)
    ).toBe(0.31);
    const deep = omahaStreetBetRate(
      rowOf(200, { turn: { bet: 0.9, fold: 0 } }),
      mode('turn'),
      0.31
    );
    // the rate is returned on the pooled scale (read beside the all-street mean): times the street's
    // population ratio it is his turn rate (review R2 B1)
    expect(deep * omahaStreetScale('bet', 'turn')).toBeGreaterThan(0.8);
    const thin = omahaStreetBetRate(rowOf(2, { turn: { bet: 0.9, fold: 0 } }), mode('turn'), 0.31);
    expect(thin).toBeGreaterThan(0.31);
    expect(thin).toBeLessThan(deep);
  });
  it('the priced cells are the street cells, the texture cell for the flop bet', () => {
    const row = rowOf(
      20,
      { flop: { bet: 0.5, fold: 0.5 }, river: { bet: 0.2, fold: 0.7 } },
      'rainbow'
    );
    const flop = omahaStreetRatesOf(row, 'flop', 'rainbow')!;
    expect(flop.bet).toEqual(row.flopBet.rainbow);
    expect(flop.foldToBet).toEqual(row.foldToBet.flop);
    expect(omahaStreetRatesOf(row, 'flop', null)!.bet).toEqual(row.bet.flop);
    expect(omahaStreetRatesOf(row, 'flop', 'paired')!.bet).toBeNull();
    const river = omahaStreetRatesOf(row, 'river', 'rainbow')!;
    expect(river.foldToRaise).toEqual(row.foldToRaise.river);
    expect(omahaStreetRatesOf(row, 'turn', 'rainbow')).toBeNull();
    expect(omahaStreetRatesOf(null, 'turn', null)).toBeNull();
  });
});

// ───────────────────── through HorseLogic.decide on recorded decisions ─────────────────────

const SEEDS = [1, 2];
/** The consumers this option feeds: the facing-bet verdict, the value-leader rules and the priced comparisons. */
const CONSUMERS: HorseDecideOpts = {
  omahaFacingBetEv: true,
  omahaMadeHandDefenseVsValueLeader: true,
  omahaBluffCatcherFoldVsValueLeader: true,
  omahaTurnRiverRaiseIsPriced: true,
  omahaPressureIsPriced: true,
} as HorseDecideOpts;

function decide(
  r: RecordedFacingBet,
  seed: number,
  row: StreetReadCounters | null,
  opts: HorseDecideOpts
) {
  HorseMind.reset();
  const { fx, node } = expand(JSON.parse(JSON.stringify(r)) as RecordedFacingBet);
  const st = stateAt(fx, node);
  const variant = r.variant ?? 'plo5';
  const sandbox = HorseMind.createSandbox();
  if (row) {
    sandbox.pooledStreetRead = new Map();
    for (const p of st.gs.players.filter((q) => q.user_id !== st.hero.user_id))
      for (const size of ['hu', 'short', 'full'] as const)
        sandbox.pooledStreetRead.set(opponentMemoryKey(p.user_id, variant, 'cash', size), row);
  }
  return HorseMind.runInSandbox(sandbox, () => {
    const asked = vi.spyOn(HorseMind, 'omahaStreetReadOf');
    seedFastRandom(seed);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    const calls = asked.mock.calls.length;
    asked.mockRestore();
    return { bytes: JSON.stringify(withoutMeasurements(d)), calls };
  });
}
/** A player who folds to almost every bet and raise and bets rarely, on every street. */
const FOLDER = rowOf(120, {
  flop: { bet: 0.1, fold: 0.9 },
  turn: { bet: 0.1, fold: 0.9 },
  river: { bet: 0.1, fold: 0.9 },
});

describe('through HorseLogic.decide', () => {
  it('byte-identical: option on with no street record, and option off with one', () => {
    expect(RECORDED_FACING_BETS.length).toBeGreaterThanOrEqual(20);
    for (const r of RECORDED_FACING_BETS)
      for (const seed of SEEDS) {
        const base = decide(r, seed, null, CONSUMERS);
        const onNoRecord = decide(r, seed, null, {
          ...CONSUMERS,
          omahaReadIsByStreetAndTexture: true,
        });
        const offWithRecord = decide(r, seed, FOLDER, CONSUMERS);
        expect(onNoRecord.bytes, `hand ${r.n} seed ${seed} (on, no record)`).toBe(base.bytes);
        expect(offWithRecord.bytes, `hand ${r.n} seed ${seed} (off, record)`).toBe(base.bytes);
        expect(offWithRecord.calls).toBe(0);
        expect(onNoRecord.calls).toBeGreaterThan(0);
      }
    expect(omahaPricedStreetRatesSourceNow()).toBeNull();
  }, 600000);

  it('USED: with the option on and a street record, the read is asked and moves recorded decisions', () => {
    let moved = 0;
    for (const r of RECORDED_FACING_BETS)
      for (const seed of SEEDS) {
        const off = decide(r, seed, FOLDER, CONSUMERS);
        const on = decide(r, seed, FOLDER, { ...CONSUMERS, omahaReadIsByStreetAndTexture: true });
        expect(on.calls).toBeGreaterThan(0);
        if (on.bytes !== off.bytes) moved++;
      }
    expect(moved).toBeGreaterThan(0);
    // the priced street source is a decision's own: nothing is left registered after it
    expect(omahaPricedStreetRatesSourceNow()).toBeNull();
  }, 600000);
});

describe('a population-average player reads the same on every street (review R2 B1 of readwire 6f5d5ff8dcf)', () => {
  const K = omahaPricedKindPrior('horse');
  // the Horse envelope means are all-street figures: the population's pooled rates
  const POP = { bet: K.betCheckedTo.pooled, foldToBet: K.foldToBet.pooled, riverCall: 0.35 };
  const OPP = 4000;
  /** cells exactly at the population's own rate on each street (texture cell on the flop) */
  function populationRow(): StreetReadCounters {
    const r = emptyStreetRead();
    for (const street of ['flop', 'turn', 'river'] as const) {
      r.bet[street] = { hit: K.betCheckedTo[street] * OPP, opp: OPP };
      r.foldToBet[street] = { hit: K.foldToBet[street] * OPP, opp: OPP };
      r.foldToRaise[street] = { hit: 0.3 * OPP, opp: OPP };
    }
    r.flopBet.rainbow = { hit: K.betCheckedTo.flop * OPP, opp: OPP };
    return r;
  }
  const average = {
    ...pooled(false),
    betCheckedTo: stat(POP.bet, 400),
    foldToBet: stat(POP.foldToBet, 400),
    riverCall: stat(0.3, 100),
  } as OmahaReadConditional;
  it('the street scale is the population ratio and 1 where the street is the pooled rate', () => {
    for (const street of ['flop', 'turn', 'river'] as const) {
      expect(omahaStreetScale('bet', street)).toBeCloseTo(
        K.betCheckedTo[street] / K.betCheckedTo.pooled,
        12
      );
      expect(omahaStreetScale('foldToBet', street)).toBeCloseTo(
        K.foldToBet[street] / K.foldToBet.pooled,
        12
      );
    }
  });
  it('the value-leader evidence is the same on every street and keeps the pooled label', () => {
    const row = populationRow();
    const w = (['flop', 'turn', 'river'] as const).map(
      (street) =>
        omahaStreetValueLeader(average, row, street, street === 'flop' ? 'rainbow' : null, POP)!
    );
    for (const v of w) expect(v.valueLeader).toBe(false);
    // each street's posterior sits at its own population rate: P(<= bar) about one half on both
    // stats on every street, so the evidence does not move with the street
    for (const v of w) expect(Math.abs(v.weight - w[0].weight)).toBeLessThan(0.05);
  });
  it('the bet rate beside the all-street mean is ratio 1 on every street', () => {
    const row = populationRow();
    for (const street of ['flop', 'turn', 'river'] as const) {
      const mode = { on: true, street, texture: street === 'flop' ? 'rainbow' : null } as never;
      expect(omahaStreetBetRate(row, mode, POP.bet) / POP.bet).toBeCloseTo(1, 3);
    }
  });
});
