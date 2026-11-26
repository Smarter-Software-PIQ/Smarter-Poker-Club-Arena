/**
 * LAW (omahaRiverBetCheckIsHisRecord, default OFF; PLO-OWNER lead-7 lane river-station 2026-11-26). The range model of
 * the two river bet rules reads his checks through his own lifetime PUBLIC heads-up unopened bet record shrunk to
 * PEOPLE's rate: one ratio for every opponent; no record = the read itself (the same object); no cliff in n; a player
 * who never bets unopened has checks that cap nothing, so the Horse's equity against his range can only fall and the
 * rules bet no more often into him; nothing but the rules' own check -> bet changes; off (and on without a record or
 * without the river rules) decides as today; PLO6 untouched; no identity is read; the read costs nothing measurable.
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
import { measureRelativeCost } from '../testing/relativeCost.js';
import {
  omahaRiverFirstToActBet,
  omahaRiverFirstToActBetRule,
  omahaRiverFirstToActSpot,
} from './HorseOmahaRiverFirstToActBet.js';
import { omahaRiverCheckedToBet, omahaRiverCheckedToSpot } from './HorseOmahaRiverCheckedToBet.js';
import {
  OMAHA_PEOPLE_UNOPENED_BET_HU,
  OMAHA_PEOPLE_UNOPENED_BET_PRIOR_OPPS,
  omahaRiverBetCheckRead,
  omahaRiverBetFoldRecordCurve,
  omahaUnopenedBetRatio,
  type OmahaUnopenedBetRecord,
} from './HorseOmahaRiverBetFoldRecord.js';
import type { OmahaCardImpactRead } from './HorseOmahaCardImpact.js';
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
const FIRST = CLOSES.map((s) => {
  const c = copy(s);
  c.gs.actionHistory = (c.gs.actionHistory ?? []).filter(
    (a) => !(String(a.stage) === 'river' && a.seat !== c.hero.seat)
  );
  return c;
});
const K = OMAHA_PEOPLE_UNOPENED_BET_PRIOR_OPPS;
const P5 = OMAHA_PEOPLE_UNOPENED_BET_HU.plo5.bets / OMAHA_PEOPLE_UNOPENED_BET_HU.plo5.opps;
const READ: OmahaCardImpactRead = {
  measured: false,
  continueRate: null,
  riverCallRate: null,
  betCheckedTo: 0.4771,
  bluffShare: 0.3,
};
const rec = (opps: number, rate: number): OmahaUnopenedBetRecord => ({ bets: opps * rate, opps });
const neverBets = [rec(2000, 0), rec(2000, 0)];
const readOf =
  (variant: string, records: Array<OmahaUnopenedBetRecord | null>) =>
  (_o: SeatPlayer, read: OmahaCardImpactRead) =>
    omahaRiverBetCheckRead(variant, read, records);
const provider = (r: OmahaUnopenedBetRecord | null): OmahaLifetimeStreetRecordProvider => ({
  unopenedWagerRecord: (_id, _game, _street, players) => (players === 'hu' ? r : null),
  firstWagerFoldRecord: () => null,
  stabSizeRecord: () => null,
});

afterEach(() => {
  HorseMind.setOmahaLifetimeStreetRecordProvider(null);
  HorseMind.reset();
});

describe('omahaRiverBetCheckIsHisRecord: the ratio', () => {
  it('people only, and no record / an empty record / another game is the read itself', () => {
    expect(OMAHA_PEOPLE_UNOPENED_BET_HU.plo4).toEqual({ bets: 212, opps: 713 });
    expect(OMAHA_PEOPLE_UNOPENED_BET_HU.plo5).toEqual({ bets: 989, opps: 2684 });
    expect(omahaRiverBetCheckRead('plo5', READ, [])).toBe(READ);
    expect(omahaRiverBetCheckRead('plo5', READ, [null, undefined])).toBe(READ);
    expect(omahaRiverBetCheckRead('plo5', READ, [{ bets: 0, opps: 0 }])).toBe(READ);
    expect(omahaRiverBetCheckRead('plo6', READ, neverBets)).toBe(READ);
    expect(omahaRiverBetCheckRead('nlh', READ, neverBets)).toBe(READ);
  });

  it("a record at people's rate keeps the read's share; shrinkage n / (n + k) with no cliff", () => {
    expect(omahaUnopenedBetRatio('plo5', [rec(600, P5)]).ratio).toBeCloseTo(1, 9);
    let prev = 1;
    for (const n of [1, 2, 5, 10, 25, 50, 100, 400, 4000]) {
      const f = omahaUnopenedBetRatio('plo5', [rec(n, 0)]);
      expect(f.weight).toBeCloseTo(n / (n + K), 9);
      expect(f.ratio).toBeLessThan(prev);
      expect(f.ratio).toBeGreaterThan(0);
      prev = f.ratio;
    }
    expect(1 - omahaUnopenedBetRatio('plo5', [rec(1, 0)]).ratio).toBeLessThan(0.05);
    // turn and river pooled
    expect(omahaUnopenedBetRatio('plo5', [rec(30, 0), rec(70, 0)]).weight).toBeCloseTo(
      100 / (100 + K),
      9
    );
    // a player who bets every time: the share rises and stays a share
    const hi = omahaRiverBetCheckRead('plo5', READ, [rec(5000, 1)]);
    expect(hi.checkBetShare!).toBeGreaterThan(READ.betCheckedTo);
    expect(hi.checkBetShare!).toBeLessThanOrEqual(1);
    const never = omahaRiverBetCheckRead('plo5', READ, neverBets);
    expect(never.checkBetShare!).toBeLessThan(0.01);
    // his bets are still read with the rules' own share
    expect(never.betCheckedTo).toBe(READ.betCheckedTo);
  });
});

describe('omahaRiverBetCheckIsHisRecord: the two river rules', () => {
  it('against a calling station (never bets unopened, never folds) the priced equity can only fall and no more bets are made', () => {
    const neverFolds = { foldSmall: { folds: 0, opps: 4000 }, foldBig: { folds: 0, opps: 4000 } };
    const calls = <
      P extends { share: number; cont: number; raise: number; foldSe: number; n: number },
    >(
      _o: SeatPlayer,
      population: readonly P[]
    ): readonly P[] => omahaRiverBetFoldRecordCurve('plo5', population, neverFolds).curve;
    let priced = 0;
    let base = 0;
    let mine = 0;
    for (const s of CLOSES) {
      const spot = omahaRiverCheckedToSpot(s.hero, s.gs);
      if (!spot) continue;
      const a = omahaRiverCheckedToBet(s.hero, s.gs, spot, 0.05, undefined, calls);
      const b = omahaRiverCheckedToBet(
        s.hero,
        s.gs,
        spot,
        0.05,
        undefined,
        calls,
        readOf('plo5', neverBets)
      );
      if (!a || !b) continue;
      priced++;
      a.rows.forEach((row, i) => {
        expect(b.rows[i].amount).toBe(row.amount);
        // the measured curve is unchanged; the fold share moves only by the range's weighting at the quantile
        expect(Math.abs(b.rows[i].fold - row.fold)).toBeLessThanOrEqual(0.03);
        expect(b.rows[i].equity).toBeLessThanOrEqual(row.equity + 1e-9);
      });
      if (a.best) base++;
      if (b.best) mine++;
    }
    expect(priced).toBeGreaterThanOrEqual(5);
    expect(mine).toBeLessThanOrEqual(base);
  });

  it('a record at the read rate, or a reader that throws or returns junk, decides as without it', () => {
    for (const s of FIRST) {
      const spot = omahaRiverFirstToActSpot(s.hero, s.gs);
      if (!spot) continue;
      const a = omahaRiverFirstToActBet(s.hero, s.gs, spot, 0.05);
      const none = omahaRiverFirstToActBet(
        s.hero,
        s.gs,
        spot,
        0.05,
        undefined,
        undefined,
        readOf('plo5', [null])
      );
      expect(none).toEqual(a);
      const base = omahaRiverFirstToActBetRule(check, s.hero, s.gs, true, 0.05, same);
      const thrown = omahaRiverFirstToActBetRule(
        check,
        s.hero,
        s.gs,
        true,
        0.05,
        same,
        undefined,
        () => {
          throw new Error('reader');
        }
      );
      const junk = omahaRiverFirstToActBetRule(
        check,
        s.hero,
        s.gs,
        true,
        0.05,
        same,
        undefined,
        () => ({ ...READ, betCheckedTo: NaN })
      );
      expect(thrown.decision).toEqual(base.decision);
      expect(junk.decision).toEqual(base.decision);
      const bet: HorseDecision = { action: 'bet', amount: 10, thinkTime: 1 };
      expect(
        omahaRiverFirstToActBetRule(
          bet,
          s.hero,
          s.gs,
          true,
          0.05,
          same,
          undefined,
          readOf('plo5', neverBets)
        ).decision
      ).toBe(bet);
    }
  });
});

describe('omahaRiverBetCheckIsHisRecord: the decision', () => {
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
  const ON = { ...RIVER_ON, omahaRiverBetCheckIsHisRecord: true };
  const ALL = [...FIRST, ...CLOSES];

  it('off is byte-identical to the option absent, with a record on file and the river rules on or off', () => {
    HorseMind.setOmahaLifetimeStreetRecordProvider(provider(rec(4000, 0)));
    for (const s of ALL)
      for (const rules of [{}, RIVER_ON])
        expect(strip(decide(s, { ...rules, omahaRiverBetCheckIsHisRecord: false }, 1))).toEqual(
          strip(decide(s, { ...rules }, 1))
        );
  });

  it('on with no provider, no record, or the river rules off: decides as with the option off', () => {
    for (const s of ALL) {
      const a = decide(s, { ...RIVER_ON }, 1);
      expect(strip(decide(s, ON, 1))).toEqual(strip(a));
      HorseMind.setOmahaLifetimeStreetRecordProvider(provider(null));
      expect(strip(decide(s, ON, 1))).toEqual(strip(a));
      HorseMind.setOmahaLifetimeStreetRecordProvider(provider(rec(4000, 0)));
      expect(strip(decide(s, { omahaRiverBetCheckIsHisRecord: true }, 1))).toEqual(
        strip(decide(s, {}, 1))
      );
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
    }
  });

  it('on against a never-bets record: never a fold, never a third action, no more river bets than without it', () => {
    let pop = 0;
    let his = 0;
    const wager = (d: HorseDecision) => d.action === 'bet' || d.action === 'all_in';
    for (const s of ALL) {
      HorseMind.setOmahaLifetimeStreetRecordProvider(provider(rec(4000, 0)));
      const base = decide(s, {}, 1);
      const p = decide(s, { ...RIVER_ON }, 1);
      const m = decide(s, ON, 1);
      expect(m.action).not.toBe('fold');
      if (wager(p) && !wager(base)) pop++;
      if (wager(m) && !wager(base)) his++;
      if (!wager(m)) expect(strip(m)).toEqual(strip(base));
    }
    expect(his).toBeLessThanOrEqual(pop);
  });

  it('PLO6 is untouched and no identity is read', () => {
    HorseMind.setOmahaLifetimeStreetRecordProvider(provider(rec(4000, 0)));
    for (const s of ALL.slice(0, 6)) {
      const six = (c: Spot) => void (c.gs.gameVariant = 'plo6');
      expect(strip(decide(s, ON, 1, six))).toEqual(strip(decide(s, { ...RIVER_ON }, 1, six)));
      const horses = (c: Spot) => {
        for (const p of c.gs.players) (p as { is_horse?: boolean }).is_horse = true;
      };
      const persons = (c: Spot) => {
        for (const p of c.gs.players) (p as { is_horse?: boolean }).is_horse = false;
      };
      expect(strip(decide(s, ON, 1, horses))).toEqual(strip(decide(s, ON, 1, persons)));
    }
  });

  it('the read costs a bounded multiple of the rules it feeds (relative cost, src/testing/relativeCost.ts)', () => {
    HorseMind.setOmahaLifetimeStreetRecordProvider(provider(rec(4000, 0)));
    // on (the two river rules + his check read) against the same decisions with the river rules alone
    const cost = measureRelativeCost(
      () => {
        for (const s of ALL) decide(s, ON, 1);
      },
      () => {
        for (const s of ALL) decide(s, RIVER_ON, 1);
      },
      { warmupRounds: 1, rounds: 5 }
    );
    console.info(
      `[omahaRiverBetCheckIsHisRecord] ${ALL.length} decisions: on ${(cost.subjectMs / ALL.length).toFixed(2)} ms, off ${(cost.referenceMs / ALL.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)}`
    );
    // the read is two record lookups and a multiplication; the rules' model dominates both sides
    expect(cost.ratio).toBeLessThan(2);
  });
});
