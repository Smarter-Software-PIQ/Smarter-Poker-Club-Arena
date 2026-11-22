/**
 * LAW (omahaRiverBetFoldIsHisRecord, default OFF; EMERG lane STAB-DEFENCE-5 2026-11-21). The two river bet rules price
 * the opponent's answer with the population curve moved by his own lifetime PUBLIC river fold record, shrunk by
 * n / (n + k). One multiplier for every opponent; no record = the population curve exactly; no cliff in n; an opponent
 * who does not fold is not bluffed and an opponent who folds more is bet into more; nothing but the two rules' own
 * check -> bet changes; off (and on without a record) decides as today; PLO6 untouched; no identity is read.
 * Spots: the anonymised journaled river requests of HorseOmahaCheckedToBet.fixture.json.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, type OmahaLifetimeStreetRecordProvider } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { replayProfiles } from './HorseComplaintReplay.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import {
  OMAHA_RIVER_FIRST_TO_ACT_RESPONSE,
  omahaRiverFirstToActBet,
  omahaRiverFirstToActBetRule,
  omahaRiverFirstToActSpot,
} from './HorseOmahaRiverFirstToActBet.js';
import {
  OMAHA_RIVER_CHECKED_TO_RESPONSE,
  omahaRiverCheckedToBet,
  omahaRiverCheckedToBetRule,
  omahaRiverCheckedToSpot,
} from './HorseOmahaRiverCheckedToBet.js';
import {
  OMAHA_STRONG_HAND_CHECK_FOLD_POPULATION,
  OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS,
  type OmahaStrongHandCheckRecords,
} from './HorseOmahaStrongHandCheck.js';
import { omahaRiverBetFoldRecordCurve } from './HorseOmahaRiverBetFoldRecord.js';
import RECORDED from './HorseOmahaCheckedToBet.fixture.json';

interface Spot {
  set: string;
  hero: SeatPlayer;
  gs: HorseGameStateV2;
  options: Record<string, string>;
}
const SPOTS = (RECORDED as unknown as { spots: Spot[] }).spots;
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const same = (d: HorseDecision) => d;
const check: HorseDecision = { action: 'check', thinkTime: 1 };
const CLOSES = SPOTS.filter((s) => s.set === 'river_hu_checkback_air_weak');
/** The Horse acts first: the recorded spot with the opponent's river check removed. */
const FIRST = CLOSES.map((s) => {
  const c = copy(s);
  c.gs.actionHistory = (c.gs.actionHistory ?? []).filter(
    (a) => !(String(a.stage) === 'river' && a.seat !== c.hero.seat)
  );
  return c;
});
const K = OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS.river;
const POP5 = OMAHA_STRONG_HAND_CHECK_FOLD_POPULATION['plo5|river'];
const CURVE = OMAHA_RIVER_FIRST_TO_ACT_RESPONSE.plo5;

/** n river answers at each size with the given fold share. */
const record = (n: number, foldShare: number): OmahaStrongHandCheckRecords => ({
  foldSmall: { folds: n * foldShare, opps: n },
  foldBig: { folds: n * foldShare, opps: n },
});
const provider = (r: OmahaStrongHandCheckRecords | null): OmahaLifetimeStreetRecordProvider => ({
  unopenedWagerRecord: () => null,
  firstWagerFoldRecord: (_id, _game, street, players, size) =>
    !r || street !== 'river' || players !== 'hu'
      ? null
      : ((size === 'big' ? r.foldBig : r.foldSmall) ?? null),
  stabSizeRecord: () => null,
});
const his =
  (variant: string, r: OmahaStrongHandCheckRecords | null) =>
  <P extends (typeof CURVE)[number]>(_o: SeatPlayer, population: readonly P[]): readonly P[] =>
    omahaRiverBetFoldRecordCurve(variant, population, r).curve;

afterEach(() => {
  HorseMind.setOmahaLifetimeStreetRecordProvider(null);
  HorseMind.reset();
});

describe('omahaRiverBetFoldIsHisRecord: the curve', () => {
  it('no record, an empty record, another game: the population curve itself (the same array)', () => {
    expect(omahaRiverBetFoldRecordCurve('plo5', CURVE, null).curve).toBe(CURVE);
    expect(omahaRiverBetFoldRecordCurve('plo5', CURVE, {}).curve).toBe(CURVE);
    expect(omahaRiverBetFoldRecordCurve('plo5', CURVE, record(0, 0)).curve).toBe(CURVE);
    expect(omahaRiverBetFoldRecordCurve('plo6', CURVE, record(500, 0)).curve).toBe(CURVE);
    expect(omahaRiverBetFoldRecordCurve('nlh', CURVE, record(500, 0)).curve).toBe(CURVE);
  });

  it('a record at the population rate changes no share', () => {
    const r: OmahaStrongHandCheckRecords = {
      foldSmall: { folds: 300 * POP5.small, opps: 300 },
      foldBig: { folds: 300 * POP5.big, opps: 300 },
    };
    const c = omahaRiverBetFoldRecordCurve('plo5', CURVE, r);
    expect(c.m).toBeCloseTo(1, 9);
    c.curve.forEach((p, i) => {
      expect(p.cont).toBeCloseTo(CURVE[i].cont, 9);
      expect(p.raise).toBeCloseTo(CURVE[i].raise, 9);
      expect(p.foldSe).toBeGreaterThanOrEqual(CURVE[i].foldSe);
    });
  });

  it('shrinkage n / (n + k): the weight, no cliff, and the limits', () => {
    let prev = 1;
    for (const n of [1, 2, 5, 10, 25, 50, 100, 250, 1000, 10000]) {
      const c = omahaRiverBetFoldRecordCurve('plo5', CURVE, record(n, 0));
      expect(c.weight).toBeCloseTo((2 * n) / (2 * n + K), 9);
      expect(c.m).toBeLessThan(prev);
      expect(c.m).toBeGreaterThan(0);
      prev = c.m;
    }
    // One answer moves the fold share by under two points of the pot bet's fold share: no cliff at the first hand.
    const one = omahaRiverBetFoldRecordCurve('plo5', CURVE, { foldBig: { folds: 0, opps: 1 } });
    expect(1 - one.m).toBeLessThan(0.02);
    expect(prev).toBeLessThan(0.01);
    // A man who folds everything: the fold share rises and stays a share.
    const over = omahaRiverBetFoldRecordCurve('plo5', CURVE, record(5000, 1));
    expect(over.m).toBeGreaterThan(1);
    for (const p of over.curve) {
      expect(p.cont).toBeGreaterThanOrEqual(0);
      expect(p.cont).toBeLessThanOrEqual(1);
      expect(p.raise).toBeGreaterThanOrEqual(0);
      expect(p.raise).toBeLessThanOrEqual(p.cont + 1e-12);
    }
  });

  it('fewer folds on record = more continues at every size; the raise share of his continues is kept', () => {
    const a = omahaRiverBetFoldRecordCurve('plo5', CURVE, record(40, 0)).curve;
    const b = omahaRiverBetFoldRecordCurve('plo5', CURVE, record(400, 0)).curve;
    CURVE.forEach((p, i) => {
      expect(a[i].cont).toBeGreaterThan(p.cont);
      expect(b[i].cont).toBeGreaterThan(a[i].cont);
      expect(b[i].raise / b[i].cont).toBeCloseTo(p.raise / p.cont, 9);
      expect(b[i].share).toBe(p.share);
    });
  });
});

describe('omahaRiverBetFoldIsHisRecord: the two river rules', () => {
  const never = record(4000, 0);
  it('an opponent on record as not folding the river is not bluffed, first to act or closing', () => {
    let priced = 0;
    let populationBets = 0;
    for (const s of FIRST) {
      const spot = omahaRiverFirstToActSpot(s.hero, s.gs)!;
      const pop = omahaRiverFirstToActBet(s.hero, s.gs, spot, 0.05);
      const v = omahaRiverFirstToActBet(s.hero, s.gs, spot, 0.05, undefined, his('plo5', never));
      if (!pop || !v) continue;
      priced++;
      if (pop.best) populationBets++;
      for (const row of v.rows) {
        expect(row.fold).toBeLessThanOrEqual(0.05);
        if (row.equity < 0.3) expect(row.ev).toBeLessThan(v.evCheck + row.error);
      }
      expect(v.action === 'check' || v.best!.equity >= 0.3).toBe(true);
    }
    for (const s of CLOSES) {
      const spot = omahaRiverCheckedToSpot(s.hero, s.gs);
      if (!spot) continue;
      const v = omahaRiverCheckedToBet(s.hero, s.gs, spot, 0.05, undefined, his('plo5', never));
      if (!v) continue;
      priced++;
      for (const row of v.rows)
        if (row.equity < 0.3) expect(row.ev).toBeLessThan(v.evCheck + row.error);
      expect(v.action === 'check' || v.best!.equity >= 0.3).toBe(true);
    }
    expect(priced).toBeGreaterThanOrEqual(5);
    // The fixture is air and weak hands the population price bets: the law above is not vacuous.
    expect(populationBets).toBeGreaterThan(0);
  });

  it('the fold share a bet is priced with moves with his record and with nothing else', () => {
    const s = FIRST[0];
    const spot = omahaRiverFirstToActSpot(s.hero, s.gs)!;
    const pop = omahaRiverFirstToActBet(s.hero, s.gs, spot, 0.05)!;
    const none = omahaRiverFirstToActBet(s.hero, s.gs, spot, 0.05, undefined, his('plo5', null))!;
    expect(none).toEqual(pop);
    const few = omahaRiverFirstToActBet(
      s.hero,
      s.gs,
      spot,
      0.05,
      undefined,
      his('plo5', record(30, 0))
    )!;
    const many = omahaRiverFirstToActBet(
      s.hero,
      s.gs,
      spot,
      0.05,
      undefined,
      his('plo5', record(600, 0))
    )!;
    pop.rows.forEach((row, i) => {
      expect(few.rows[i].amount).toBe(row.amount);
      expect(few.rows[i].fold).toBeLessThanOrEqual(row.fold);
      expect(many.rows[i].fold).toBeLessThanOrEqual(few.rows[i].fold);
    });
    expect(many.rows[many.rows.length - 1].fold).toBeLessThan(pop.rows[pop.rows.length - 1].fold);
  });

  it('a reader that throws or returns a wrong curve is the population curve; only a check ever changes', () => {
    for (const s of FIRST) {
      const base = omahaRiverFirstToActBetRule(check, s.hero, s.gs, true, 0.05, same);
      const thrown = omahaRiverFirstToActBetRule(check, s.hero, s.gs, true, 0.05, same, () => {
        throw new Error('reader');
      });
      const short = omahaRiverFirstToActBetRule(check, s.hero, s.gs, true, 0.05, same, () => []);
      expect(thrown.decision).toEqual(base.decision);
      expect(short.decision).toEqual(base.decision);
      const bet: HorseDecision = { action: 'bet', amount: 10, thinkTime: 1 };
      expect(
        omahaRiverFirstToActBetRule(bet, s.hero, s.gs, true, 0.05, same, his('plo5', never))
          .decision
      ).toBe(bet);
      const r = omahaRiverFirstToActBetRule(
        check,
        s.hero,
        s.gs,
        true,
        0.05,
        same,
        his('plo5', never)
      );
      expect(['check', 'bet', 'all_in']).toContain(r.decision.action);
    }
    for (const s of CLOSES) {
      const base = omahaRiverCheckedToBetRule(check, s.hero, s.gs, true, 0.05, same);
      const thrown = omahaRiverCheckedToBetRule(check, s.hero, s.gs, true, 0.05, same, () => {
        throw new Error('reader');
      });
      expect(thrown.decision).toEqual(base.decision);
    }
  });
});

describe('omahaRiverBetFoldIsHisRecord: the decision', () => {
  const recorded = (s: Spot): HorseDecideOpts => {
    const o: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(s.options))
      if (v === 'on' || v === 'off') o[k] = v === 'on';
    return o as HorseDecideOpts;
  };
  const decide = (
    s: Spot,
    extra: Record<string, unknown>,
    seed: number,
    mutate?: (c: Spot) => void
  ) => {
    const c = copy(s);
    mutate?.(c);
    HorseMind.reset();
    seedFastRandom(seed);
    seedHorseTimingRandom(seed);
    return HorseLogic.decide(c.hero, c.gs, LIVE.style, LIVE.mods, {
      observeMind: false,
      ...recorded(s),
      ...extra,
    } as never);
  };
  const strip = (d: HorseDecision) => {
    const x = withoutMeasurements(d) as Record<string, unknown>;
    delete x.thinkTime;
    return x;
  };
  const RIVER_ON = {
    omahaRiverFirstToActBetIsPriced: true,
    omahaRiverCheckedToBetIsMeasured: true,
  };
  const ALL = [...FIRST, ...CLOSES];

  it('off is byte-identical to the option absent, with a record on file and the river rules on or off', () => {
    HorseMind.setOmahaLifetimeStreetRecordProvider(provider(record(4000, 0)));
    for (const s of ALL)
      for (const rules of [{}, RIVER_ON]) {
        const a = decide(s, { ...rules }, 1);
        const b = decide(s, { ...rules, omahaRiverBetFoldIsHisRecord: false }, 1);
        expect(strip(b)).toEqual(strip(a));
      }
  });

  it('on with no provider, with no record, or with the river rules off: decides as with the option off', () => {
    for (const s of ALL) {
      const a = decide(s, { ...RIVER_ON }, 1);
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
      expect(strip(decide(s, { ...RIVER_ON, omahaRiverBetFoldIsHisRecord: true }, 1))).toEqual(
        strip(a)
      );
      HorseMind.setOmahaLifetimeStreetRecordProvider(provider(null));
      expect(strip(decide(s, { ...RIVER_ON, omahaRiverBetFoldIsHisRecord: true }, 1))).toEqual(
        strip(a)
      );
      HorseMind.setOmahaLifetimeStreetRecordProvider(provider(record(4000, 0)));
      const off = decide(s, {}, 1);
      expect(strip(decide(s, { omahaRiverBetFoldIsHisRecord: true }, 1))).toEqual(strip(off));
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
    }
  });

  it('on with a never-folds record: the river rules bet no more often than on the population price, and never fold', () => {
    let popBets = 0;
    let hisBets = 0;
    for (const s of ALL) {
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
      const base = decide(s, {}, 1);
      const pop = decide(s, { ...RIVER_ON }, 1);
      HorseMind.setOmahaLifetimeStreetRecordProvider(provider(record(4000, 0)));
      const mine = decide(s, { ...RIVER_ON, omahaRiverBetFoldIsHisRecord: true }, 1);
      expect(mine.action).not.toBe('fold');
      const wager = (d: HorseDecision) => d.action === 'bet' || d.action === 'all_in';
      if (wager(pop) && !wager(base)) popBets++;
      if (wager(mine) && !wager(base)) hisBets++;
      // It can only keep the node's check or make the rules' bet: never a third action.
      if (!wager(mine)) expect(strip(mine)).toEqual(strip(base));
    }
    expect(popBets).toBeGreaterThan(0);
    expect(hisBets).toBeLessThan(popBets);
  });

  it('PLO6 is untouched and no identity is read', () => {
    HorseMind.setOmahaLifetimeStreetRecordProvider(provider(record(4000, 0)));
    for (const s of ALL.slice(0, 6)) {
      const six = (c: Spot) => void (c.gs.gameVariant = 'plo6');
      expect(strip(decide(s, { ...RIVER_ON, omahaRiverBetFoldIsHisRecord: true }, 1, six))).toEqual(
        strip(decide(s, { ...RIVER_ON }, 1, six))
      );
      const horses = (c: Spot) => {
        for (const p of c.gs.players) (p as { is_horse?: boolean }).is_horse = true;
      };
      const persons = (c: Spot) => {
        for (const p of c.gs.players) (p as { is_horse?: boolean }).is_horse = false;
      };
      const on = { ...RIVER_ON, omahaRiverBetFoldIsHisRecord: true };
      expect(strip(decide(s, on, 1, horses))).toEqual(strip(decide(s, on, 1, persons)));
    }
  });
});
