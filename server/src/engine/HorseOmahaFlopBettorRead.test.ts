/**
 * THE FLOP VERDICT READS THE BETTOR (option omahaFlopVerdictReadsTheBettor,
 * default OFF; PLO Strategy lane 2026-11-19).
 *
 * The nodes are the public records of HorseOmahaFlopFacingBetEv.test-support.ts
 * (real PLO5 cash flop decisions facing one person's bet; no identities, no
 * person's cards). The street records are that bettor's record AS OF each
 * hand: his earlier production hands through the engine reducer
 * (streetReadHandIncrements + addStreetReadEvidence), public actions and
 * board cards only (archive plo-handoff-review-01a1cbbd/flopread-01TLQer7J).
 *
 *  - the read: nothing to read is null, no opportunity is exactly the
 *    population, it moves with every opportunity and has no step; a person
 *    and a Horse are read against their own kind; the line picks the cell;
 *  - the verdict: factors of 1 change no number; a narrower bettor lowers the
 *    value share, the non-value share and the EV of a bluff-catcher, a wider
 *    one raises them; a bettor who keeps betting lowers the realization;
 *  - HorseLogic.decide: off, and on with no record, are byte-identical to
 *    omahaFlopFacingBetEv alone; without omahaFlopFacingBetEv the option
 *    does nothing; the record is not asked for while the option is off;
 *  - the five flop folds of sets and nut straights the 48-hour audit named
 *    (59710501, 59727433, 59756252, 59806482, 59842423) against the bettor's
 *    record as of each hand;
 *  - two recorded folds the 48-hour audit accepted that omahaFlopFacingBetEv
 *    alone turns into calls (59868806 seat 4, 59872720 seat 2; archive
 *    flopev3-013U37/REGRESSIONS-63.csv): folds again against his record.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind, type OmahaStreetRead } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import {
  OMAHA_FLOP_BETTOR_LATER_FACTOR_MAX,
  OMAHA_FLOP_BETTOR_LATER_FACTOR_MIN,
  OMAHA_FLOP_BETTOR_PRIOR,
  OMAHA_FLOP_BETTOR_RANGE_FACTOR_MAX,
  OMAHA_FLOP_BETTOR_RANGE_FACTOR_MIN,
  omahaFlopBettorIsPreflopAggressor,
  omahaFlopBettorRangeFactor,
  omahaFlopBettorRate,
  omahaFlopBettorRead,
} from './HorseOmahaFlopBettorRead.js';
import {
  omahaFlopEvCountsResetCache,
  omahaFlopFacingBetEvSpot,
  omahaFlopFacingBetEvVerdict,
  type OmahaFlopBettorAdjustment,
} from './HorseOmahaFlopFacingBetEv.js';
import { omahaFlopFacingBetEvAnswer } from './HorseOmahaFlopFacingBetEvRule.js';
import {
  OMAHA_LIVE_OPTIONS_20261116,
  RECORDED_FLOP_FACING_BETS,
  expandFlop,
  type FlopEdit,
  type RecordedFlopFacingBet,
} from './HorseOmahaFlopFacingBetEv.test-support.js';
import {
  STREET_READ_DECAY,
  emptyStreetRead,
  streetReadFromRow,
  type StreetReadCounters,
} from './HorseOmahaStreetRead.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3, 4, 5, 6];
const EV: HorseDecideOpts = { omahaFlopFacingBetEv: true };
const READ: HorseDecideOpts = { omahaFlopFacingBetEv: true, omahaFlopVerdictReadsTheBettor: true };
const PACKAGE = OMAHA_LIVE_OPTIONS_20261116 as HorseDecideOpts;

/**
 * The bettor's street record as of each of the five hands: [hit, opp] for each cell in streetReadCells
 * order (bet flop/turn/river, foldToBet x3, foldToRaise x3, cbet paired/rainbow/twoTone/monotone,
 * flopBet x4), decayed, from the number of his earlier hands given.
 */
const RECORD_AS_OF: Record<number, { hands: number; row: number[] }> = {
  59710501: {
    hands: 855,
    row: [
      12.44, 43.78, 19.17, 43.77, 12.15, 43.5, 16.55, 43.73, 17.39, 43.7, 31.91, 41.8, 2.1, 16.83,
      2.23, 16.83, 1, 1.98, 8.79, 26.8, 13.55, 37.5, 22.23, 41.23, 1.91, 12.82, 6.31, 36.39, 12.07,
      43.33, 15.19, 43.66, 2.39, 23.36,
    ],
  },
  59727433: {
    hands: 984,
    row: [
      11.59, 43.78, 13.04, 43.78, 12.52, 43.66, 15.74, 43.76, 19.66, 43.74, 33.99, 42.32, 2.0,
      18.05, 2.23, 16.83, 1.98, 2.93, 9.18, 27.94, 13.33, 38.05, 21.02, 42.35, 1.91, 12.82, 7.29,
      38.31, 10.97, 43.47, 13.24, 43.74, 2.29, 24.28,
    ],
  },
  59756252: {
    hands: 1195,
    row: [
      11.1, 43.78, 13.59, 43.78, 14.56, 43.76, 16.0, 43.78, 18.06, 43.77, 34.97, 42.82, 1.83, 20.32,
      3.01, 19.21, 1.93, 3.87, 13.12, 32.58, 16.47, 40.85, 21.53, 43.07, 2.74, 15.56, 10.37, 40.85,
      13.07, 43.69, 14.34, 43.77, 2.81, 27.94,
    ],
  },
  59806482: {
    hands: 1536,
    row: [
      14.76, 43.78, 16.13, 43.78, 13.32, 43.78, 14.7, 43.78, 25.0, 43.78, 36.76, 43.2, 2.67, 22.39,
      4.79, 20.86, 2.89, 4.78, 16.72, 36.89, 19.1, 42.41, 19.4, 43.53, 2.28, 20.32, 14.13, 42.75,
      12.44, 43.76, 13.3, 43.78, 3.17, 30.92,
    ],
  },
  59842423: {
    hands: 1833,
    row: [
      13.65, 43.78, 12.56, 43.78, 14.82, 43.78, 15.25, 43.78, 19.99, 43.78, 39.17, 43.47, 2.12,
      26.8, 4.79, 20.86, 3.82, 5.67, 18.63, 38.91, 21.59, 43.23, 21.38, 43.7, 2.98, 23.36, 13.07,
      43.31, 16.64, 43.78, 13.21, 43.78, 4.38, 34.03,
    ],
  },
};
Object.assign(RECORD_AS_OF, {
  59868806: {
    hands: 2092,
    row: [
      11.3, 43.78, 13.92, 43.78, 14.56, 43.78, 19.98, 43.78, 21.7, 43.78, 39.1, 43.58, 4.68, 28.66,
      4.79, 20.86, 3.82, 5.67, 17.17, 40.0, 20.79, 43.5, 18.48, 43.76, 2.66, 25.59, 12.08, 43.44,
      18.42, 43.78, 10.67, 43.78, 4.39, 35.86,
    ],
  },
  59872720: {
    hands: 2156,
    row: [
      12.68, 43.78, 17.5, 43.78, 14.98, 43.78, 20.24, 43.78, 19.04, 43.78, 39.61, 43.6, 4.58, 29.0,
      6.55, 21.89, 3.82, 5.67, 17.56, 40.34, 19.98, 43.55, 17.27, 43.76, 2.54, 26.41, 12.63, 43.48,
      16.98, 43.78, 11.71, 43.78, 4.19, 36.22,
    ],
  },
});
const recordAsOf = (n: number): StreetReadCounters => streetReadFromRow(RECORD_AS_OF[n].row)!;

/**
 * Two flop folds the 48-hour audit accepted (acceptable_close) that omahaFlopFacingBetEv alone turns into
 * calls (archive plo-handoff-review-01a1cbbd/flopev3-013U37/REGRESSIONS-63.csv, rows 59868806:11 and
 * 59872720:6: weak draws, a few chips over the margin). Public actions, the Horse's own cards, stacks at the
 * decision (the journaled decision record).
 */
const AUDIT_RIGHT_FOLDS: RecordedFlopFacingBet[] = [
  {
    n: 59868806,
    group: 'auditRightFold',
    audit:
      'fold accepted by the 48-hour audit (acceptable_close); a weak draw out of position, two players behind, facing a stab of half the pot after the preflop raiser checked',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 2,
    a: '3|p|sb|1|f|0|0;4|p|bb|2|f|0|0;4|p|ante|2|f|0|1;5|p|raise|8|h|1|0;6|p|call|8|h|0|0;1|p|call|8|p|0|0;2|p|call|8|h|0|0;3|p|call|7|h|0|0;4|p|call|6|h|0|0;3|f|check|0|h|0|0;4|f|check|0|h|0|0;5|f|check|0|h|0|0;6|f|check|0|h|0|0;1|f|bet|25|p|1|0;2|f|fold|0|h|0|0;3|f|fold|0|h|0|0',
    board: 'Jc9d5c',
    seat: 4,
    hole: '8d9hQh6s3d',
    pot: 75,
    bet: 25,
    cur: 25,
    min: 50,
    max: 125,
    seats: [
      [1, 482.9, 25, 33, 0, 0, 0],
      [2, 372.69, 0, 8, 0, 0, 1],
      [3, 392, 0, 8, 0, 0, 1],
      [4, 716.8, 0, 8, 2, 0, 0],
      [5, 852.4, 0, 8, 0, 0, 0],
      [6, 397, 0, 8, 0, 0, 0],
    ],
  },
  {
    n: 59872720,
    group: 'auditRightFold',
    audit:
      'fold accepted by the 48-hour audit (acceptable_close); a weak flush draw in position, a player behind, facing a continuation bet of three quarters of the pot',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 2,
    a: '3|p|sb|1|f|0|0;4|p|bb|2|f|0|0;4|p|ante|2|f|0|1;5|p|fold|0|h|0|0;6|p|fold|0|h|0|0;1|p|raise|9|p|1|0;2|p|call|9|h|0|0;3|p|call|8|h|0|0;4|p|fold|0|h|0|0;3|f|check|0|h|0|0;1|f|bet|24|p|1|0',
    board: '7sThAs',
    seat: 2,
    hole: '2s4s3hJh9s',
    pot: 55,
    bet: 24,
    cur: 24,
    min: 48,
    max: 103,
    seats: [
      [1, 668.4, 24, 33, 0, 0, 0],
      [2, 470.43, 0, 9, 0, 0, 0],
      [3, 471.25, 0, 9, 0, 0, 0],
      [4, 666.5, 0, 2, 2, 0, 1],
      [5, 1041.9, 0, 0, 0, 0, 1],
      [6, 695.5, 0, 0, 0, 0, 1],
    ],
  },
];

const rec = (n: number, seat?: number): RecordedFlopFacingBet =>
  RECORDED_FLOP_FACING_BETS.find((r) => r.n === n && (seat === undefined || r.seat === seat))!;
function at(r: RecordedFlopFacingBet, edit: FlopEdit = {}) {
  const { fx, node } = expandFlop(r, edit);
  return stateAt(fx, node);
}
const bytesOf = (d: unknown): string => JSON.stringify(withoutMeasurements(d));
/**
 * The package holds horseActionTimeIsPublicOnly, whose think time is drawn from the timing stream, not the seeded
 * strategy stream: two identical decisions differ in thinkTime alone. With the package the comparison is every
 * byte but that number; without it, every byte (the same rule as HorseOmahaFlopFacingBetEv.test.ts).
 */
const timeless = (bytes: string[]): string[] =>
  bytes.map((b) => b.replace(/"thinkTime":[0-9.]+/g, '"thinkTime":0'));
const BASES = [
  [{} as HorseDecideOpts, (b: string[]) => b],
  [OMAHA_LIVE_OPTIONS_20261116 as HorseDecideOpts, timeless],
] as const;
const streetRead = (counters: StreetReadCounters): OmahaStreetRead => ({
  counters,
  flop: null,
  turn: null,
  river: null,
});
/** A record with one flop cell and the later-street cells set: rate x opp hits in opp opportunities. */
function recordOf(cells: {
  cbet?: [number, number];
  flopBet?: [number, number];
  turn?: [number, number];
  river?: [number, number];
}): StreetReadCounters {
  const r = emptyStreetRead();
  const put = (c: { hit: number; opp: number }, v?: [number, number]): void => {
    if (!v) return;
    c.opp = v[1];
    c.hit = v[0] * v[1];
  };
  for (const t of ['paired', 'rainbow', 'twoTone', 'monotone'] as const) {
    put(r.cbet[t], cells.cbet);
    put(r.flopBet[t], cells.flopBet);
  }
  put(r.bet.turn, cells.turn);
  put(r.bet.river, cells.river);
  return r;
}

interface Played {
  bytes: string[];
  actions: string[];
  fires: string[][];
}
/** The recorded decision through HorseLogic.decide on six seeds; `record` is what the mind answers for the bettor. */
function play(
  r: RecordedFlopFacingBet,
  opts: HorseDecideOpts,
  record: StreetReadCounters | null | undefined = undefined,
  edit: FlopEdit = {}
): Played & { asked: number } {
  enableBrainTelemetry();
  const out = { bytes: [] as string[], actions: [] as string[], fires: [] as string[][], asked: 0 };
  for (const seed of SEEDS) {
    HorseMind.reset();
    const spy =
      record === undefined
        ? vi.spyOn(HorseMind, 'omahaStreetReadOf')
        : vi
            .spyOn(HorseMind, 'omahaStreetReadOf')
            .mockImplementation(() => (record ? streetRead(record) : null));
    drainFires();
    seedFastRandom(seed);
    const st = at(r, edit);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    out.bytes.push(bytesOf(d));
    out.actions.push(d.action);
    // upgrade04_omaha_reservoir_*_seen fires once per process (the first decision builds the reservoir): not a
    // fact about the decision
    out.fires.push(
      drainFires()
        .map((f) => f.feature)
        .filter((f) => !f.startsWith('upgrade04_omaha_reservoir_'))
    );
    out.asked += spy.mock.calls.length;
    vi.restoreAllMocks();
  }
  return out;
}
function verdictOf(
  r: RecordedFlopFacingBet,
  bettor?: OmahaFlopBettorAdjustment,
  inPosition = false
) {
  const st = at(r);
  const spot = omahaFlopFacingBetEvSpot(st.hero, st.gs as never)!;
  return {
    spot,
    st,
    v: omahaFlopFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], null, {
      rake: 0,
      inPosition,
      ...(bettor ? { bettor } : {}),
    })!,
  };
}
/** The answer of the rule (spot, verdict, the bettor's read) with the mind answering `record` for the bettor. */
function answerOf(r: RecordedFlopFacingBet, record: StreetReadCounters | null, inPosition = false) {
  const st = at(r);
  vi.spyOn(HorseMind, 'omahaStreetReadOf').mockImplementation(() =>
    record ? streetRead(record) : null
  );
  const answer = omahaFlopFacingBetEvAnswer(st.hero, st.gs as never, {
    mind: true,
    telemetry: false,
    rake: 0,
    inPosition,
    bareOverpairContinuation: false,
    readsTheBettor: true,
  })!;
  vi.restoreAllMocks();
  return answer;
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  omahaFlopEvCountsResetCache();
});

// ───────────────────────────── the read ─────────────────────────────

describe('the read of one flop bettor from his street record', () => {
  const SHARES = 0.46 + 0.42;

  it('has nothing to read without a record, with a record that is not well-formed, or for a kind the decision does not know', () => {
    expect(omahaFlopBettorRead(null, 'person', 'twoTone', 'cbet', SHARES)).toBeNull();
    expect(omahaFlopBettorRead(undefined, 'horse', 'twoTone', 'cbet', SHARES)).toBeNull();
    expect(omahaFlopBettorRead(emptyStreetRead(), null, 'twoTone', 'cbet', SHARES)).toBeNull();
    const broken = emptyStreetRead();
    broken.cbet.twoTone = { hit: 5, opp: 2 };
    expect(omahaFlopBettorRead(broken, 'person', 'twoTone', 'cbet', SHARES)).toBeNull();
  });

  it('a record with no opportunity is exactly the population: both factors are 1', () => {
    for (const kind of ['person', 'horse'] as const)
      for (const line of ['cbet', 'flopBet', null] as const) {
        const r = omahaFlopBettorRead(emptyStreetRead(), kind, 'rainbow', line, SHARES)!;
        expect(r.rangeFactor).toBe(1);
        expect(r.laterBetFactor).toBe(1);
        expect(r.bet).toEqual({ ratio: 1, weight: 0, opportunities: 0 });
      }
  });

  it('moves with every opportunity and has no step: the weight is opp / (opp + K) and the factor is monotone in the sample', () => {
    const P = OMAHA_FLOP_BETTOR_PRIOR.person;
    const K = P.strength.cbet;
    let prev = 1;
    let largestStep = 0;
    // a player who makes a continuation bet on a quarter of two-tone flops (persons: 0.573), hand after hand
    for (let opp = 0; opp <= 44; opp += 0.5) {
      const r = omahaFlopBettorRead(
        recordOf({ cbet: [0.25, opp] }),
        'person',
        'twoTone',
        'cbet',
        SHARES
      )!;
      expect(r.bet.weight).toBeCloseTo(opp / (opp + K), 12);
      expect(r.rangeFactor).toBeLessThanOrEqual(prev);
      largestStep = Math.max(largestStep, prev - r.rangeFactor);
      prev = r.rangeFactor;
    }
    // half an opportunity never moves the factor by more than 1.5 percent; 44 opportunities move it well under half way
    expect(largestStep).toBeLessThan(0.015);
    expect(prev).toBeLessThan(0.85);
    expect(prev).toBeGreaterThan(OMAHA_FLOP_BETTOR_RANGE_FACTOR_MIN);
    // one hand of evidence is almost nothing
    const one = omahaFlopBettorRead(
      recordOf({ cbet: [0, 1] }),
      'person',
      'twoTone',
      'cbet',
      SHARES
    )!;
    expect(one.rangeFactor).toBeGreaterThan(0.975);
    expect(one.rangeFactor).toBeLessThan(1);
  });

  it('a decayed cell cannot hold more than about 44 opportunities, so no rate moves more than about two thirds of the way', () => {
    const cap = 1 / (1 - STREET_READ_DECAY);
    expect(cap).toBeGreaterThan(43);
    expect(cap).toBeLessThan(44);
    for (const kind of ['person', 'horse'] as const)
      for (const k of Object.values(OMAHA_FLOP_BETTOR_PRIOR[kind].strength))
        expect(cap / (cap + k)).toBeLessThan(0.65);
  });

  it('a narrower bettor has a factor under 1 and a wider one over 1, by the measured slope', () => {
    const P = OMAHA_FLOP_BETTOR_PRIOR.person;
    const narrow = omahaFlopBettorRead(
      recordOf({ cbet: [0.3, 40] }),
      'person',
      'rainbow',
      'cbet',
      SHARES
    )!;
    const wide = omahaFlopBettorRead(
      recordOf({ cbet: [0.9, 40] }),
      'person',
      'rainbow',
      'cbet',
      SHARES
    )!;
    expect(narrow.bet.ratio).toBeLessThan(1);
    expect(wide.bet.ratio).toBeGreaterThan(1);
    expect(narrow.rangeFactor).toBeCloseTo(
      1 + (2 * P.slope.cbet * Math.log(narrow.bet.ratio)) / SHARES,
      12
    );
    expect(wide.rangeFactor).toBeCloseTo(
      1 + (2 * P.slope.cbet * Math.log(wide.bet.ratio)) / SHARES,
      12
    );
    expect(omahaFlopBettorRangeFactor(1, P.slope.cbet, SHARES)).toBe(1);
    expect(omahaFlopBettorRangeFactor(1e-9, 5, SHARES)).toBe(OMAHA_FLOP_BETTOR_RANGE_FACTOR_MIN);
    expect(omahaFlopBettorRangeFactor(1e9, 5, SHARES)).toBe(OMAHA_FLOP_BETTOR_RANGE_FACTOR_MAX);
  });

  it('reads a person against persons and a Horse against Horses: the same record is not the same read', () => {
    // 60 percent continuation bets on rainbow flops: about a person's rate (0.586), under a Horse's (0.692)
    const record = recordOf({ cbet: [0.6, 40], turn: [0.45, 40], river: [0.45, 40] });
    const person = omahaFlopBettorRead(record, 'person', 'rainbow', 'cbet', SHARES)!;
    const horse = omahaFlopBettorRead(record, 'horse', 'rainbow', 'cbet', SHARES)!;
    expect(person.bet.ratio).toBeGreaterThan(1);
    expect(horse.bet.ratio).toBeLessThan(1);
    expect(person.rangeFactor).toBeGreaterThan(1);
    expect(horse.rangeFactor).toBeLessThan(1);
    // later streets: 45 percent is above a person's turn and river rates and below a Horse's
    expect(person.laterBetFactor).toBeGreaterThan(1);
    expect(horse.laterBetFactor).toBeLessThan(1);
    // a Horse's flop range moves less with its rate than a person's (measured slopes)
    expect(OMAHA_FLOP_BETTOR_PRIOR.horse.slope.cbet).toBeLessThan(
      OMAHA_FLOP_BETTOR_PRIOR.person.slope.cbet
    );
    const extreme = recordOf({ cbet: [0.1, 44] });
    const p = omahaFlopBettorRead(extreme, 'person', 'twoTone', 'cbet', SHARES)!;
    const h = omahaFlopBettorRead(extreme, 'horse', 'twoTone', 'cbet', SHARES)!;
    expect(1 - h.rangeFactor).toBeLessThan(1 - p.rangeFactor);
  });

  it('the line picks the cell: a continuation bet reads the continuation-bet cell, any other first bet the flop-bet cell, a raise none', () => {
    const record = recordOf({ cbet: [0.2, 40], flopBet: [0.6, 40], turn: [0.6, 40] });
    const cbet = omahaFlopBettorRead(record, 'person', 'paired', 'cbet', SHARES)!;
    const other = omahaFlopBettorRead(record, 'person', 'paired', 'flopBet', SHARES)!;
    const raise = omahaFlopBettorRead(record, 'person', 'paired', null, SHARES)!;
    expect(cbet.rangeFactor).toBeLessThan(1);
    expect(other.rangeFactor).toBeGreaterThan(1);
    expect(raise.rangeFactor).toBe(1);
    expect(raise.line).toBeNull();
    // the later streets are read on every line
    expect(raise.laterBetFactor).toBe(cbet.laterBetFactor);
    expect(raise.laterBetFactor).toBeGreaterThan(1);
    // a flop with no texture reads no flop cell
    expect(omahaFlopBettorRead(record, 'person', null, 'cbet', SHARES)!.rangeFactor).toBe(1);
  });

  it('the later-street factor is the geometric mean of his turn and river rates beside his kind, within its bounds', () => {
    const P = OMAHA_FLOP_BETTOR_PRIOR.person;
    const r = omahaFlopBettorRead(
      recordOf({ turn: [0.7, 40], river: [0.2, 30] }),
      'person',
      'twoTone',
      'cbet',
      SHARES
    )!;
    const turn = omahaFlopBettorRate({ hit: 28, opp: 40 }, P.turnBet, P.strength.turnBet);
    const river = omahaFlopBettorRate({ hit: 6, opp: 30 }, P.riverBet, P.strength.riverBet);
    expect(r.laterBetFactor).toBeCloseTo(Math.sqrt(turn.ratio * river.ratio), 12);
    expect(r.laterBetFactor).toBeGreaterThanOrEqual(OMAHA_FLOP_BETTOR_LATER_FACTOR_MIN);
    expect(r.laterBetFactor).toBeLessThanOrEqual(OMAHA_FLOP_BETTOR_LATER_FACTOR_MAX);
    expect(omahaFlopBettorRate({ hit: 3, opp: 2 }, 0.3, 40)).toEqual({
      ratio: 1,
      weight: 0,
      opportunities: 0,
    });
  });

  it('tells a continuation bet from another first bet on the real hands', () => {
    // 59710501: the person in seat 3 raised before the flop and bets the flop
    const cbet = at(rec(59710501));
    expect(omahaFlopBettorIsPreflopAggressor(cbet.gs.actionHistory as never, 3)).toBe(true);
    expect(omahaFlopBettorIsPreflopAggressor(cbet.gs.actionHistory as never, 5)).toBe(false);
    // a limped pot has no preflop raiser: the forced posts are not a raise
    expect(
      omahaFlopBettorIsPreflopAggressor(
        [
          { stage: 'preflop', seat: 1, action: 'sb', amount: 1 },
          { stage: 'preflop', seat: 2, action: 'bb', amount: 2 },
          { stage: 'preflop', seat: 3, action: 'call', amount: 2 },
          { stage: 'flop', seat: 3, action: 'bet', amount: 4 },
        ],
        3
      )
    ).toBe(false);
  });
});

// ───────────────────────────── the verdict ─────────────────────────────

describe('the flop verdict with a bettor read', () => {
  // 59806482 seat 5: a recorded fold the audit judged wrong (a weak hand out of position facing 30 into a multiway pot)
  const NODE = rec(59806482, 5);

  it('factors of exactly 1 change no number of the verdict', () => {
    for (const r of RECORDED_FLOP_FACING_BETS.filter((x) => x.group !== 'bareOverpair')) {
      const st = at(r);
      const spot = omahaFlopFacingBetEvSpot(st.hero, st.gs as never);
      if (!spot) continue;
      const plain = omahaFlopFacingBetEvVerdict(
        spot,
        st.hero.cards,
        st.gs.communityCards,
        [],
        null,
        {
          rake: 0.03,
          inPosition: false,
        }
      )!;
      const one = omahaFlopFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], null, {
        rake: 0.03,
        inPosition: false,
        bettor: { rangeFactor: 1, laterBetFactor: 1 },
      })!;
      const { bettorRangeFactor, bettorLaterBetFactor, ...rest } = one;
      expect(rest, `hand ${r.n}`).toEqual(plain);
      expect([bettorRangeFactor, bettorLaterBetFactor]).toEqual([1, 1]);
      expect('bettorRangeFactor' in plain).toBe(false);
    }
  });

  it('a narrower bettor lowers the value share, the non-value share and the EV of a call; a wider one raises them', () => {
    const base = verdictOf(NODE).v;
    const narrow = verdictOf(NODE, { rangeFactor: 0.8, laterBetFactor: 1 }).v;
    const wide = verdictOf(NODE, { rangeFactor: 1.2, laterBetFactor: 1 }).v;
    expect(narrow.valueShare).toBeLessThan(base.valueShare);
    expect(wide.valueShare).toBeGreaterThan(base.valueShare);
    expect(narrow.bluffShare).toBeCloseTo(base.bluffShare * 0.8, 10);
    expect(wide.bluffShare).toBeCloseTo(base.bluffShare * 1.2, 10);
    expect(narrow.ev).toBeLessThan(base.ev);
    expect(wide.ev).toBeGreaterThan(base.ev);
    // the price is the same public number in all three: only the range moved
    expect(narrow.price).toBe(base.price);
    expect(wide.margin).toBe(base.margin);
  });

  it('against a bettor who keeps betting the later streets a hand that cannot call again realizes less, against one who gives up more', () => {
    const base = verdictOf(NODE).v;
    const barrels = verdictOf(NODE, { rangeFactor: 1, laterBetFactor: 1.5 }).v;
    const givesUp = verdictOf(NODE, { rangeFactor: 1, laterBetFactor: 0.5 }).v;
    expect(barrels.modelRealization).toBeLessThanOrEqual(base.modelRealization);
    expect(givesUp.modelRealization).toBeGreaterThanOrEqual(base.modelRealization);
    expect(givesUp.modelRealization).toBeGreaterThan(barrels.modelRealization);
    expect(givesUp.ev).toBeGreaterThan(barrels.ev);
    // the range is untouched by the later-street factor
    expect(barrels.valueShare).toBe(base.valueShare);
    expect(barrels.bluffShare).toBe(base.bluffShare);
  });

  it('the bet size never enters the read: the same record gives the same rate ratios whatever the bet, and only the range it scales differs', () => {
    const record = recordAsOf(59806482);
    // the value share plus the non-value share of a bet under 40 percent of the pot, and of a bet over the pot
    const small = omahaFlopBettorRead(record, 'person', 'twoTone', 'cbet', 0.56 + 0.4)!;
    const large = omahaFlopBettorRead(record, 'person', 'twoTone', 'cbet', 0.26 + 0.28)!;
    expect(small.bet).toEqual(large.bet);
    expect(small.turn).toEqual(large.turn);
    expect(small.laterBetFactor).toBe(large.laterBetFactor);
    // the same measured move of the mean strength of his bet, as a share of each range
    expect((small.rangeFactor - 1) * (0.56 + 0.4)).toBeCloseTo(
      (large.rangeFactor - 1) * (0.26 + 0.28),
      12
    );
  });
});

// ───────────────────────── HorseLogic.decide: off and on ─────────────────────────

describe('omahaFlopVerdictReadsTheBettor through HorseLogic.decide', () => {
  const NODES = RECORDED_FLOP_FACING_BETS;

  it('on with no record for the bettor is byte-identical to omahaFlopFacingBetEv alone at every recorded node, receipts included', () => {
    for (const r of NODES)
      for (const [base, same] of BASES) {
        const ev = play(r, { ...base, ...EV }, null);
        const read = play(r, { ...base, ...READ }, null);
        expect(same(read.bytes), `hand ${r.n} seat ${r.seat}`).toEqual(same(ev.bytes));
        expect(read.fires, `hand ${r.n} seat ${r.seat}`).toEqual(ev.fires);
      }
  });

  it('unset, false and a truthy non-boolean are byte-identical, and the record is never asked for while the option is off', () => {
    const record = recordOf({ cbet: [0.1, 44], flopBet: [0.1, 44], turn: [0.9, 44] });
    for (const r of NODES)
      for (const [base, same] of BASES) {
        const unset = play(r, { ...base, ...EV }, record);
        const off = play(r, { ...base, ...EV, omahaFlopVerdictReadsTheBettor: false }, record);
        const truthy = play(
          r,
          { ...base, ...EV, omahaFlopVerdictReadsTheBettor: 'on' as never },
          record
        );
        expect(same(off.bytes), `hand ${r.n}`).toEqual(same(unset.bytes));
        expect(same(truthy.bytes), `hand ${r.n}`).toEqual(same(unset.bytes));
        expect(off.fires, `hand ${r.n}`).toEqual(unset.fires);
        expect(unset.asked + off.asked + truthy.asked, `hand ${r.n}`).toBe(0);
        expect(unset.fires.flat()).not.toContain('omaha_flop_verdict_read_the_bettor');
      }
  });

  it('without omahaFlopFacingBetEv the option changes nothing: it is an input of that verdict, not a rule', () => {
    const record = recordOf({ cbet: [0.1, 44], flopBet: [0.1, 44], turn: [0.9, 44] });
    for (const r of NODES)
      for (const [base, same] of BASES) {
        const without = play(r, base, record);
        const alone = play(r, { ...base, omahaFlopVerdictReadsTheBettor: true }, record);
        expect(same(alone.bytes), `hand ${r.n}`).toEqual(same(without.bytes));
        expect(alone.fires, `hand ${r.n}`).toEqual(without.fires);
        expect(alone.asked, `hand ${r.n}`).toBe(0);
      }
  });

  it('with a record it fires its receipt beside the verdict receipt, and only then', () => {
    const r = rec(59806482, 5);
    const withRecord = play(r, { ...PACKAGE, ...READ }, recordAsOf(59806482));
    const none = play(r, { ...PACKAGE, ...READ }, null);
    for (const fires of withRecord.fires) {
      expect(fires).toContain('omaha_flop_verdict_read_the_bettor');
      expect(
        fires.includes('omaha_flop_facing_bet_ev_call') ||
          fires.includes('omaha_flop_facing_bet_ev_fold')
      ).toBe(true);
    }
    expect(none.fires.flat()).not.toContain('omaha_flop_verdict_read_the_bettor');
  });

  it('with the mind off the record is not read', () => {
    const r = rec(59806482, 5);
    const record = recordOf({ cbet: [0.1, 44], turn: [0.9, 44] });
    for (const [base, same] of BASES) {
      const ev = play(r, { ...base, ...EV, mind: false } as never, record);
      const read = play(r, { ...base, ...READ, mind: false } as never, record);
      expect(same(read.bytes)).toEqual(same(ev.bytes));
      expect(read.asked).toBe(0);
    }
  });
});

// ───────────── the five flop folds of sets and nut straights (48-hour audit, RC-02a) ─────────────

describe('the five flop folds of sets and nut straights, against the bettor as his record stood at each hand', () => {
  const five = RECORDED_FLOP_FACING_BETS.filter((r) => r.group === 'rc02a');
  const IN_POSITION = new Set([59727433]);
  // 59710501 is the one of the five omahaFlopFacingBetEv does not call (a priced fold: bottom set out of
  // position, a caller in and a player behind, EV about a tenth of the pot under its margin).
  const THIN = 59710501;

  it('are the five hands, each a continuation bet by the person who raised before the flop, each with a record of well over 800 of his earlier hands', () => {
    expect(five.map((r) => r.n).sort()).toEqual([59710501, 59727433, 59756252, 59806482, 59842423]);
    for (const r of five) {
      const a = answerOf(r, recordAsOf(r.n), IN_POSITION.has(r.n));
      expect(a.bettor!.kind, `hand ${r.n}`).toBe('person');
      expect(a.bettor!.line, `hand ${r.n}`).toBe('cbet');
      expect(RECORD_AS_OF[r.n].hands).toBeGreaterThan(800);
      expect(a.bettor!.bet.opportunities, `hand ${r.n}`).toBeGreaterThan(30);
    }
  });

  it('his record reads him as a narrower continuation bettor than persons on every one of the five flops, and never by more than a fifth', () => {
    for (const r of five) {
      const { bettor } = answerOf(r, recordAsOf(r.n), IN_POSITION.has(r.n));
      expect(bettor!.bet.ratio, `hand ${r.n}`).toBeLessThan(1);
      expect(bettor!.rangeFactor, `hand ${r.n}`).toBeLessThan(1);
      expect(bettor!.rangeFactor, `hand ${r.n}`).toBeGreaterThan(0.8);
      // his turn and river bet rates are within a tenth of persons'
      expect(Math.abs(bettor!.laterBetFactor - 1), `hand ${r.n}`).toBeLessThan(0.1);
    }
  });

  it('the top set, the bottom set in position and both nut straights are still called with the read on, by the verdict and by HorseLogic.decide', () => {
    for (const r of five.filter((x) => x.n !== THIN)) {
      const { verdict } = answerOf(r, recordAsOf(r.n), IN_POSITION.has(r.n));
      expect(verdict.klass, `hand ${r.n}`).toBe('made');
      expect(verdict.call, `hand ${r.n}`).toBe(true);
      expect(verdict.ev, `hand ${r.n}`).toBeGreaterThan(2 * verdict.margin);
      const played = play(r, { ...PACKAGE, ...READ }, recordAsOf(r.n));
      expect(played.actions, `hand ${r.n}`).not.toContain('fold');
      // and the read changed no action of these four against omahaFlopFacingBetEv alone
      expect(played.actions, `hand ${r.n}`).toEqual(
        play(r, { ...PACKAGE, ...EV }, recordAsOf(r.n)).actions
      );
    }
  });

  it('NOT FIXED BY THE READ, stated: 59710501 stays a priced fold against this bettor (his two-tone continuation bets are slightly narrower than persons, so his range is not wider)', () => {
    const r = rec(THIN);
    const plain = answerOf(r, null);
    const read = answerOf(r, recordAsOf(THIN));
    expect(plain.verdict.call).toBe(false);
    expect(read.verdict.call).toBe(false);
    expect(read.bettor!.texture).toBe('twoTone');
    expect(read.bettor!.bet.ratio).toBeGreaterThan(0.9);
    expect(read.bettor!.bet.ratio).toBeLessThan(1);
    // still a thin spot, not a blanket fold: within 15 percent of the pot of its margin
    const short = (read.verdict.ev - read.verdict.margin) / (read.spot.winnable + read.spot.paid);
    expect(short).toBeLessThan(0);
    expect(short).toBeGreaterThan(-0.15);
    expect(play(r, { ...PACKAGE, ...READ }, recordAsOf(THIN)).actions).toEqual(
      play(r, { ...PACKAGE, ...EV }, recordAsOf(THIN)).actions
    );
  });

  it('the same hand is priced by who bets: against a player who bets nearly every two-tone flop and gives up later it is worth more, against one who rarely bets it and keeps betting it is worth less', () => {
    const r = rec(THIN);
    const population = answerOf(r, null).verdict.ev;
    const wide = answerOf(r, recordOf({ cbet: [0.95, 44], turn: [0.1, 44], river: [0.1, 44] }));
    const narrow = answerOf(r, recordOf({ cbet: [0.15, 44], turn: [0.8, 44], river: [0.8, 44] }));
    expect(wide.bettor!.rangeFactor).toBeGreaterThan(1);
    expect(wide.bettor!.laterBetFactor).toBeLessThan(1);
    expect(narrow.bettor!.rangeFactor).toBeLessThan(1);
    expect(narrow.bettor!.laterBetFactor).toBeGreaterThan(1);
    expect(wide.verdict.ev).toBeGreaterThan(population);
    expect(narrow.verdict.ev).toBeLessThan(population);
    // the same records with a tenth of the sample move it a fraction as far: no step
    const wideThin = answerOf(
      r,
      recordOf({ cbet: [0.95, 4.4], turn: [0.1, 4.4], river: [0.1, 4.4] })
    );
    expect(wideThin.verdict.ev).toBeGreaterThanOrEqual(Math.min(population, wide.verdict.ev));
    expect(wideThin.verdict.ev).toBeLessThanOrEqual(Math.max(population, wide.verdict.ev));
    expect(Math.abs(wideThin.bettor!.rangeFactor - 1)).toBeLessThan(
      Math.abs(wide.bettor!.rangeFactor - 1) / 3
    );
  });
});

// ─────────── two folds the 48-hour audit accepted that the verdict alone turned into calls ───────────

describe('two recorded folds the 48-hour audit accepted (59868806 seat 4, 59872720 seat 2): the verdict alone calls, the verdict that reads the bettor folds', () => {
  const IN_POSITION = new Set([59872720]);

  it('each is a weak draw a few chips over the margin for the population range, facing the person whose record is narrower than persons on that line', () => {
    for (const r of AUDIT_RIGHT_FOLDS) {
      const plain = answerOf(r, null, IN_POSITION.has(r.n));
      const read = answerOf(r, recordAsOf(r.n), IN_POSITION.has(r.n));
      expect(plain.verdict.klass, `hand ${r.n}`).toBe('draw');
      expect(plain.verdict.call, `hand ${r.n}`).toBe(true);
      // thin: under 4 percent of the pot over the margin
      expect(
        (plain.verdict.ev - plain.verdict.margin) / (plain.spot.winnable + plain.spot.paid),
        `hand ${r.n}`
      ).toBeLessThan(0.04);
      expect(read.bettor!.kind).toBe('person');
      expect(read.bettor!.bet.ratio, `hand ${r.n}`).toBeLessThan(0.9);
      expect(read.bettor!.rangeFactor, `hand ${r.n}`).toBeLessThan(0.95);
      expect(read.verdict.valueShare, `hand ${r.n}`).toBeLessThan(plain.verdict.valueShare);
      expect(read.verdict.bluffShare, `hand ${r.n}`).toBeLessThan(plain.verdict.bluffShare);
      expect(read.verdict.ev, `hand ${r.n}`).toBeLessThan(plain.verdict.ev);
      expect(read.verdict.call, `hand ${r.n}`).toBe(false);
    }
    // 59868806: he called before the flop and bets after the preflop raiser checked: the flop-bet cell
    expect(answerOf(AUDIT_RIGHT_FOLDS[0], recordAsOf(59868806)).bettor!.line).toBe('flopBet');
    // 59872720: he raised before the flop: the continuation-bet cell
    expect(answerOf(AUDIT_RIGHT_FOLDS[1], recordAsOf(59872720), true).bettor!.line).toBe('cbet');
  });

  it('through HorseLogic.decide on six seeds: today a fold, omahaFlopFacingBetEv alone a call, with the read a fold again', () => {
    for (const r of AUDIT_RIGHT_FOLDS) {
      const record = recordAsOf(r.n);
      expect(play(r, PACKAGE, record).actions, `hand ${r.n}`).toEqual(SEEDS.map(() => 'fold'));
      expect(play(r, { ...PACKAGE, ...EV }, record).actions, `hand ${r.n}`).toEqual(
        SEEDS.map(() => 'call')
      );
      const read = play(r, { ...PACKAGE, ...READ }, record);
      expect(read.actions, `hand ${r.n}`).toEqual(SEEDS.map(() => 'fold'));
      for (const fires of read.fires) {
        expect(fires).toContain('omaha_flop_verdict_read_the_bettor');
        expect(fires).toContain('omaha_flop_facing_bet_ev_fold');
      }
      // with no record for the bettor the option leaves the call of the verdict alone
      expect(play(r, { ...PACKAGE, ...READ }, null).actions, `hand ${r.n}`).toEqual(
        SEEDS.map(() => 'call')
      );
    }
  });

  it('it is the record, not the account: the same two hands against a bettor of the same kind with a wide record are calls', () => {
    const wide = recordOf({
      cbet: [0.9, 44],
      flopBet: [0.7, 44],
      turn: [0.2, 44],
      river: [0.2, 44],
    });
    for (const r of AUDIT_RIGHT_FOLDS) {
      const a = answerOf(r, wide, IN_POSITION.has(r.n));
      expect(a.bettor!.rangeFactor, `hand ${r.n}`).toBeGreaterThan(1);
      expect(a.verdict.call, `hand ${r.n}`).toBe(true);
    }
  });
});
