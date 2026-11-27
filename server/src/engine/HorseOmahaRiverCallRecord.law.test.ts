/**
 * LAW (omahaRiverCallRangeIsHisRecord, default OFF; PLO-OWNER lead-7 lane river-call 2026-11-26). The range model of
 * the two river bet rules reads each flop and turn CALL of his through his own lifetime PUBLIC heads-up first-wager
 * fold record against PEOPLE's fold for his own mix (people-only generated table): one multiplier for every opponent;
 * no record = the read itself (the same object) and the same verdict; no cliff in n; a calling-station record widens
 * his range after a call (the Horse's equity against it rises) and turns a checked thin river value bet into the bet;
 * a nit record narrows it (the equity falls); on the real audited heads-up river nodes with each opponent's own
 * record every changed decision is the audit's bet; nothing but the rules' own check -> bet changes; off (and on
 * without a record or without the river rules) decides as today; PLO6 untouched; no identity is read; the read costs
 * a bounded multiple of the rules it feeds.
 * Spots: the anonymised journaled river requests of HorseOmahaCheckedToBet.fixture.json and the real audited nodes of
 * HorseOmahaRiverOpeningBet.realHands.fixture.json (PLO hand audits daily 2026-11-25T230000Z and 2026-11-20..24).
 */
import { readFileSync } from 'node:fs';
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
  omahaRiverFirstToActSpot,
} from './HorseOmahaRiverFirstToActBet.js';
import { omahaRiverCheckedToBet, omahaRiverCheckedToSpot } from './HorseOmahaRiverCheckedToBet.js';
import {
  omahaRiverBetCheckRead,
  omahaRiverBetFoldRecordCurve,
} from './HorseOmahaRiverBetFoldRecord.js';
import {
  omahaCallStepKeep,
  omahaFirstWagerFoldRatio,
  omahaRiverCallRead,
  type OmahaFirstWagerFoldRecord,
} from './HorseOmahaRiverCallRecord.js';
import {
  OMAHA_PEOPLE_FIRST_WAGER_FOLD_HU,
  OMAHA_PEOPLE_FIRST_WAGER_FOLD_PRIOR_OPPS,
} from './HorseOmahaRiverCallRecordPeople.data.js';
import type { OmahaCardImpactRead } from './HorseOmahaCardImpact.js';
import {
  RIVER_OPENING_FIXTURE,
  cards,
  type RiverOpeningFixtureNode,
} from './HorseOmahaRiverOpeningBet.test-support.js';
import RECORDED from './HorseOmahaCheckedToBet.fixture.json';

interface Spot {
  set: string;
  hero: SeatPlayer;
  gs: HorseGameStateV2;
  options: Record<string, string>;
}
const SPOTS = (RECORDED as unknown as { spots: Spot[] }).spots;
const NODES = RIVER_OPENING_FIXTURE.nodes;
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const K = OMAHA_PEOPLE_FIRST_WAGER_FOLD_PRIOR_OPPS;
const READ: OmahaCardImpactRead = {
  measured: false,
  continueRate: null,
  riverCallRate: null,
  betCheckedTo: 0.4771,
  bluffShare: 0.3,
};
const cell = (opps: number, fold: number) => ({ folds: opps * fold, opps });
const street = (opps: number, fold: number): OmahaFirstWagerFoldRecord => ({
  foldSmall: cell(opps, fold),
  foldBig: cell(opps, fold),
});
const STATION = { turn: street(1000, 0), river: street(1000, 0) };
const NIT = { turn: street(1000, 0.9), river: street(1000, 0.9) };
/** people's own fold in every cell: his record looks exactly like people's */
const PEOPLE5 = {
  turn: {
    foldSmall: { ...OMAHA_PEOPLE_FIRST_WAGER_FOLD_HU.plo5.turn.small },
    foldBig: { ...OMAHA_PEOPLE_FIRST_WAGER_FOLD_HU.plo5.turn.big },
  },
  river: {
    foldSmall: { ...OMAHA_PEOPLE_FIRST_WAGER_FOLD_HU.plo5.river.small },
    foldBig: { ...OMAHA_PEOPLE_FIRST_WAGER_FOLD_HU.plo5.river.big },
  },
};
const stationCurve =
  (variant: string) =>
  <P extends { share: number; cont: number; raise: number; foldSe: number; n: number }>(
    _o: SeatPlayer,
    population: readonly P[]
  ): readonly P[] =>
    omahaRiverBetFoldRecordCurve(variant, population, {
      foldSmall: { folds: 0, opps: 1000 },
      foldBig: { folds: 0, opps: 1000 },
    }).curve;
/** his checks read through a never-bets record (omahaRiverBetCheckIsHisRecord), and optionally his calls */
const readOf =
  (variant: string, calls: typeof STATION | null) =>
  (_o: SeatPlayer, read: OmahaCardImpactRead): OmahaCardImpactRead => {
    const checked = omahaRiverBetCheckRead(variant, read, [{ bets: 0, opps: 2000 }]);
    return calls ? omahaRiverCallRead(variant, checked, calls) : checked;
  };

afterEach(() => {
  HorseMind.setOmahaLifetimeStreetRecordProvider(null);
  HorseMind.reset();
});

describe('omahaRiverCallRangeIsHisRecord: people only, the multiplier', () => {
  it("people's table is generated by the people-only fit (responders who are people; no card, no HUD '*' row)", () => {
    // the fit's code, its comments removed
    const fit = readFileSync(
      new URL('../../scripts/omaha-river-call-record-people-fit.ts', import.meta.url),
      'utf8'
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // the one person test, and every counted answer passes it
    expect(fit).toMatch(/return !horses\.has\(responder\);/);
    expect(fit).toMatch(/if \(isPersonAnswer\(HORSES, u\)\) \{\s*const c = T\[game\]/);
    expect(fit.match(/c\.opps\+\+/g)?.length).toBe(1);
    // public actions only: the pull's hole cards and shown hands are never read; no HUD population row
    expect(fit).not.toMatch(/\bh\.hc\b|\.shown\b|'\*'/);
    const data = readFileSync(
      new URL('./HorseOmahaRiverCallRecordPeople.data.ts', import.meta.url),
      'utf8'
    );
    expect(data).toMatch(/GENERATED by server\/scripts\/omaha-river-call-record-people-fit\.ts/);
    expect(OMAHA_PEOPLE_FIRST_WAGER_FOLD_HU.plo5.river.big).toEqual({ folds: 185, opps: 269 });
    expect(OMAHA_PEOPLE_FIRST_WAGER_FOLD_HU.plo4.turn.small).toEqual({ folds: 47, opps: 186 });
    expect(K).toBeCloseTo(134.2, 9);
  });

  it('no record, an empty record, or another game is the read itself', () => {
    expect(omahaRiverCallRead('plo5', READ, {})).toBe(READ);
    expect(omahaRiverCallRead('plo5', READ, { turn: null, river: undefined })).toBe(READ);
    expect(omahaRiverCallRead('plo5', READ, { river: { foldSmall: { folds: 0, opps: 0 } } })).toBe(
      READ
    );
    expect(omahaRiverCallRead('plo6', READ, STATION)).toBe(READ);
    expect(omahaRiverCallRead('nlh', READ, STATION)).toBe(READ);
    expect(omahaCallStepKeep(0.6, undefined)).toBe(0.6);
    expect(omahaCallStepKeep(0.6, NaN)).toBe(0.6);
    expect(omahaCallStepKeep(0.6, 1)).toBeCloseTo(0.6, 12);
  });

  it("a record at people's rate keeps the model's keep; shrinkage n / (n + k), no cliff; both directions", () => {
    expect(omahaFirstWagerFoldRatio('plo5', PEOPLE5).m).toBeCloseTo(1, 9);
    let prev = 1;
    for (const n of [1, 2, 5, 10, 25, 50, 100, 400, 4000]) {
      const f = omahaFirstWagerFoldRatio('plo5', { river: { foldBig: cell(n, 0) } });
      expect(f.weight).toBeCloseTo(n / (n + K), 9);
      expect(f.m).toBeLessThan(prev);
      expect(f.m).toBeGreaterThan(0);
      prev = f.m;
    }
    expect(1 - omahaFirstWagerFoldRatio('plo5', { river: { foldBig: cell(1, 0) } }).m).toBeLessThan(
      0.02
    );
    const station = omahaFirstWagerFoldRatio('plo5', STATION).m;
    const nit = omahaFirstWagerFoldRatio('plo5', NIT).m;
    expect(station).toBeLessThan(0.1);
    expect(nit).toBeGreaterThan(1.5);
    // a call keeps more of a station's range, less of a nit's; always a share
    for (const keep of [0.05, 0.4, 0.5, 0.62, 0.9, 0.97]) {
      expect(omahaCallStepKeep(keep, station)).toBeGreaterThanOrEqual(keep);
      expect(omahaCallStepKeep(keep, nit)).toBeLessThanOrEqual(keep);
      for (const m of [0, station, 1, nit, 50]) {
        expect(omahaCallStepKeep(keep, m)).toBeGreaterThanOrEqual(0.05);
        expect(omahaCallStepKeep(keep, m)).toBeLessThanOrEqual(0.97);
      }
    }
  });
});

type Bet = typeof omahaRiverFirstToActBet;
const RULES: Array<[string, (h: SeatPlayer, gs: HorseGameStateV2) => unknown, Bet]> = [
  ['first', omahaRiverFirstToActSpot as never, omahaRiverFirstToActBet],
  ['checked', omahaRiverCheckedToSpot as never, omahaRiverCheckedToBet as never],
];
const priced = (hero: SeatPlayer, gs: HorseGameStateV2, calls: typeof STATION | null) => {
  const v = String(gs.gameVariant);
  const out: Array<ReturnType<Bet>> = [];
  for (const [, spotOf, bet] of RULES) {
    const spot = spotOf(hero, gs);
    if (!spot) continue;
    out.push(bet(hero, gs, spot as never, 0.05, undefined, stationCurve(v), readOf(v, calls)));
  }
  return out;
};

describe('omahaRiverCallRangeIsHisRecord: the two river rules', () => {
  const ALL = [
    ...SPOTS.filter((s) => s.set.startsWith('river_hu')).map((s) => ({ hero: s.hero, gs: s.gs })),
    ...NODES.map((n) => ({ hero: n.player, gs: n.gs })),
  ];

  it('without a record the verdict is the same; a station record widens his called range, a nit record narrows it', () => {
    let n = 0;
    let up = 0;
    let down = 0;
    let station = 0;
    let nit = 0;
    for (const s of ALL) {
      const v = String(s.gs.gameVariant);
      const base = priced(s.hero, s.gs, null);
      const none = priced(s.hero, s.gs, { turn: null, river: null } as never);
      expect(none).toEqual(base);
      void v;
      const st = priced(s.hero, s.gs, STATION);
      const ni = priced(s.hero, s.gs, NIT);
      base.forEach((b, i) => {
        if (!b || !st[i] || !ni[i]) return;
        b.rows.forEach((row, j) => {
          expect(st[i]!.rows[j].amount).toBe(row.amount);
          n++;
          station += st[i]!.rows[j].equity - row.equity;
          nit += ni[i]!.rows[j].equity - row.equity;
          if (st[i]!.rows[j].equity > row.equity + 0.005) up++;
          if (ni[i]!.rows[j].equity < row.equity - 0.005) down++;
        });
      });
    }
    console.info(
      `[omahaRiverCallRangeIsHisRecord] ${n} priced sizes: station mean equity ${(station / n).toFixed(3)} (${up} up), nit ${(nit / n).toFixed(3)} (${down} down)`
    );
    expect(n).toBeGreaterThanOrEqual(100);
    expect(station / n).toBeGreaterThan(0.02);
    expect(nit / n).toBeLessThan(-0.02);
    expect(up).toBeGreaterThan(n / 4);
    expect(down).toBeGreaterThan(n / 4);
  });

  it('against a calling station a river value bet the rules checked becomes the bet; against a nit it stays a check', () => {
    // Real audited public river state (node b9041a1a, PLO5, checked to the Horse heads-up, board 9c 4h Jc 5h 8h) with a
    // substituted holding: the ace-high flush, a strong hand that is NOT the nuts (6h 7h is a straight flush). With
    // the population's calling ranges the rules check it; read through a calling station's record his flop and turn
    // calls keep his weak hands, the called equity rises and the bet clears its own error. A nit's
    // calls keep only strong hands and the check stays. (A search of 400 substituted holdings on each of the 57
    // audited nodes found no MEDIUM hand that flips: the rules' calibrated called equity and the population raise
    // share in their answer curve, which this option does not change, keep thin value out; see the authority doc.)
    const node = NODES.find((x) => x.hand === 'b9041a1a')!;
    const hero = { ...copy(node.player), cards: cards('TcAh4s3dQh') };
    const spot = omahaRiverCheckedToSpot(hero, node.gs)!;
    expect(spot).toBeTruthy();
    const v = String(node.gs.gameVariant);
    const at = (calls: typeof STATION | null) =>
      omahaRiverCheckedToBet(
        hero,
        node.gs,
        spot,
        0.05,
        undefined,
        stationCurve(v),
        readOf(v, calls)
      )!;
    const a = at(null);
    const b = at(STATION);
    const c = at(NIT);
    expect(a.best).toBeNull();
    expect(b.best).not.toBeNull();
    // value, not a bluff: he folds almost never and the called equity is the Horse's
    expect(b.best!.fold).toBeLessThan(0.1);
    expect(b.best!.equity).toBeGreaterThan(a.rows.find((r) => r.amount === b.best!.amount)!.equity);
    expect(b.best!.equity).toBeGreaterThan(0.6);
    expect(b.best!.ev - b.evCheck).toBeGreaterThan(b.best!.error);
    expect(c.best).toBeNull();
  });
});

describe('omahaRiverCallRangeIsHisRecord: the decision', () => {
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
  const provider = (fold: number | null): OmahaLifetimeStreetRecordProvider => ({
    unopenedWagerRecord: (_id, _g, _st, players) =>
      players === 'hu' && fold !== null ? { bets: 0, opps: 2000 } : null,
    firstWagerFoldRecord: (_id, _g, _st, players) =>
      players === 'hu' && fold !== null ? cell(1000, fold) : null,
    stabSizeRecord: () => null,
  });
  const RIVER_ON = {
    omahaRiverFirstToActBetIsPriced: true,
    omahaRiverCheckedToBetIsMeasured: true,
    omahaRiverBetFoldIsHisRecord: true,
    omahaRiverBetFoldIsPeopleMeasured: true,
    omahaRiverBetCheckIsHisRecord: true,
  };
  const ON = { ...RIVER_ON, omahaRiverCallRangeIsHisRecord: true };
  const ALL = SPOTS.filter((s) => s.set.startsWith('river_hu'));

  it('off is byte-identical to the option absent, with a record on file and the river rules on or off', () => {
    HorseMind.setOmahaLifetimeStreetRecordProvider(provider(0));
    for (const s of ALL)
      for (const rules of [{}, RIVER_ON])
        expect(strip(decide(s, { ...rules, omahaRiverCallRangeIsHisRecord: false }, 1))).toEqual(
          strip(decide(s, { ...rules }, 1))
        );
  });

  it('on with no provider, no record, or the river rules off: decides as with the option off', () => {
    for (const s of ALL) {
      const a = decide(s, RIVER_ON, 1);
      expect(strip(decide(s, ON, 1))).toEqual(strip(a));
      HorseMind.setOmahaLifetimeStreetRecordProvider(provider(null));
      expect(strip(decide(s, ON, 1))).toEqual(strip(a));
      HorseMind.setOmahaLifetimeStreetRecordProvider(provider(0));
      expect(strip(decide(s, { omahaRiverCallRangeIsHisRecord: true }, 1))).toEqual(
        strip(decide(s, {}, 1))
      );
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
    }
  });

  it('on against a station or a nit record: never a fold, and nothing but a check into a bet changes', () => {
    const wager = (d: HorseDecision) => d.action === 'bet' || d.action === 'all_in';
    for (const fold of [0, 0.9])
      for (const s of ALL) {
        HorseMind.setOmahaLifetimeStreetRecordProvider(provider(fold));
        const off = decide(s, RIVER_ON, 1);
        const on = decide(s, ON, 1);
        expect(on.action).not.toBe('fold');
        if (strip(on).action !== strip(off).action || on.amount !== off.amount) {
          // the only move: the rules' own check <-> bet
          expect(
            [off.action, on.action].every((a) => a === 'check' || wager({ action: a } as never))
          ).toBe(true);
        }
      }
  });

  it("on the real audited heads-up river nodes, each with his own record, every changed decision is the audit's bet", () => {
    const run = (n: RiverOpeningFixtureNode, on: Record<string, boolean>): HorseDecision => {
      HorseMind.reset();
      HorseMind.setOmahaLifetimeStreetRecordProvider({
        unopenedWagerRecord: (_u: string, _g: string, _st: string, players: string) =>
          players === 'hu' && n.bet && n.bet.opps > 0 ? n.bet : null,
        stabSizeRecord: () => null,
        firstWagerFoldRecord: (
          _u: string,
          _g: string,
          st: string,
          players: string,
          size: string
        ) =>
          st === 'river' && players === 'hu'
            ? size === 'big'
              ? n.record.foldBig.opps > 0
                ? n.record.foldBig
                : null
              : n.record.foldSmall.opps > 0
                ? n.record.foldSmall
                : null
            : null,
      } as never);
      seedFastRandom(1);
      return HorseLogic.decide(structuredClone(n.player), structuredClone(n.gs), n.style, n.mods, {
        ...RIVER_OPENING_FIXTURE.opts,
        ...on,
        mind: false,
        telemetry: false,
      } as never) as HorseDecision;
    };
    const kind = (a: string) => (a === 'all_in' || a === 'raise' ? 'bet' : a);
    const want = (n: RiverOpeningFixtureNode) => {
      const b = String(n.audit.best ?? '').toLowerCase();
      return /bet|raise|all/.test(b) ? 'bet' : /check/.test(b) ? 'check' : b;
    };
    let fixed = 0;
    let wrong = 0;
    let lost = 0;
    for (const n of NODES) {
      const a = kind(run(n, RIVER_ON).action);
      const b = kind(run(n, ON).action);
      if (a === b) continue;
      if (b === 'bet') {
        if (want(n) === 'bet') fixed++;
        else wrong++;
      } else if (want(n) === 'bet') lost++;
    }
    console.info(
      `[omahaRiverCallRangeIsHisRecord] ${NODES.length} audited nodes: ${fixed} fixed, ${wrong} newly wrong, ${lost} audit bets lost`
    );
    expect(fixed).toBeGreaterThanOrEqual(1);
    expect(wrong).toBe(0);
    expect(lost).toBe(0);
  }, 120_000);

  it('PLO6 is untouched and no identity is read', () => {
    HorseMind.setOmahaLifetimeStreetRecordProvider(provider(0));
    for (const s of ALL.slice(0, 6)) {
      const six = (c: Spot) => void (c.gs.gameVariant = 'plo6');
      expect(strip(decide(s, ON, 1, six))).toEqual(strip(decide(s, RIVER_ON, 1, six)));
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
    HorseMind.setOmahaLifetimeStreetRecordProvider(provider(0));
    // on (the river rules, his records, his check read + his call read) against the same set without the call read
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
      `[omahaRiverCallRangeIsHisRecord] ${ALL.length} decisions: on ${(cost.subjectMs / ALL.length).toFixed(2)} ms, off ${(cost.referenceMs / ALL.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)}`
    );
    // the read is four record lookups and a multiplication per call step; the rules' model dominates both sides
    expect(cost.ratio).toBeLessThan(2);
  });
});
