/**
 * LAW: out-of-position river leads and hi-lo river bluffs are played, in
 * Hold'em and in PLO, and nothing shuts them off for a qualified candidate.
 *
 * Dan, 2026-11-06 20:52 Chicago: "MAKE SURE THAT YOU FULLY UPGRADE ENHANCE,
 * OPTIMIZE AND IMPROVE THE RIVER BLUFFING RANGE AND ACTIVATION FOR BOTH
 * HOLDEM AND PLO. ITS IMPORTANT TO ALSO CHECK THAT THERE IS NOTHING THAT IS
 * EVER BLOCKING OR PRENENTING, OR 'SHUTTING OFF' RIVER BLUFFS FOR QUALIFIED
 * CANDITATES OR SITUATIONS."
 *
 * Every rate below drives the real HorseLogic.decide (fixtures in
 * HorseRiverLeadHiLo.test-support.ts: 1/2 cash, 100bb, heads-up). It pins:
 *  A1. Out of position into the turn bettor, a river that completed the
 *      caller's flush or straight is bluff-led, blockers most, junk least.
 *  A2. A blank river is led rarely, never zero for a missed draw.
 *  A3. A credible station is never bluff-led into.
 *  A4. The caller's made hand leads the completing river for value; a blank
 *      river keeps the value check (the check-raise line).
 *  A5. Omaha on a paired board does not lead (Dan's paired-board rulings).
 *  B1. Hi-lo, low possible: the nut low with no high bets the freeroll.
 *  B2. Hi-lo, low possible: air with no low checks (the half-pot giveaway).
 *  B3. A low that is not the nut is showdown value, not a bluff.
 *  B4. The arithmetic: the opponent's low chance, the nut low, the scoop
 *      eligibility and its frequency.
 * A red law means a river lead or a hi-lo bluff is again shut off, or a
 * horse again bluffs into a likely low.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { seedOpponentRiverRead } from './HorseV54RiverBluff.test-support.js';
import { c, decideLeadSpot, type LeadSpot } from './HorseRiverLeadHiLo.test-support.js';
import type { HorseDecideOpts } from './HorseLogic.js';
import {
  riverBluffEligibility,
  riverBluffProbability,
  riverBluffBalancedProbability,
  riverCompletedDraw,
  riverHeroNutLow,
  riverOpponentLowChance,
  RIVER_BLUFF_HILO_FREEROLL,
  RIVER_BLUFF_HILO_MAX_OPP_LOW,
  RIVER_BLUFF_LINE,
  RIVER_BLUFF_MAX_PROBABILITY,
  RIVER_BLUFF_WEIGHTS,
  type RiverBluffSpot,
} from './HorseRiverBluffRange.js';

const TIMEOUT = 240_000 * (process.env.RUNNER_ENVIRONMENT === 'self-hosted' ? 3 : 1);
const SEEDS = Array.from({ length: 300 }, (_, i) => 104_729 + i * 15_485_863);
const H = 'hearts';
const D = 'diamonds';
const S = 'spades';
const C = 'clubs';

enableBrainTelemetry();
afterEach(() => {
  HorseMind.reset();
  drainFires();
});

interface Run {
  rate: number;
  bets: number;
  fires: Record<string, number>;
}

function run(
  spot: LeadSpot,
  opts: HorseDecideOpts = {},
  prepare: () => void = () => HorseMind.reset()
): Run {
  prepare();
  drainFires();
  let bets = 0;
  for (const seed of SEEDS) {
    const d = decideLeadSpot(spot, seed, { telemetry: true, ...opts });
    if (d.action === 'bet' || d.action === 'all_in' || d.action === 'raise') bets++;
  }
  const fires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
  return { rate: bets / SEEDS.length, bets, fires };
}

/** K-9-6-2 with two hearts on the turn; the 7h completes the flush. */
const FLUSH_RIVER = [c('K', H), c('9', H), c('6', D), c('2', C), c('7', H)];
/** The same turn, the Ac river completes nothing. */
const BLANK_RIVER = [c('K', H), c('9', H), c('6', D), c('2', C), c('A', C)];

const NLH_LEAD_BLOCKER: LeadSpot = {
  name: 'nlh_lead_nut_flush_blocker',
  variant: 'nlh',
  hole: [c('A', H), c('4', C)],
  board: FLUSH_RIVER,
  behind: 166,
  line: 'lead',
};
const NLH_LEAD_JUNK: LeadSpot = {
  ...NLH_LEAD_BLOCKER,
  name: 'nlh_lead_junk',
  hole: [c('Q', C), c('4', C)],
};
const NLH_LEAD_MADE_FLUSH: LeadSpot = {
  ...NLH_LEAD_BLOCKER,
  name: 'nlh_lead_made_flush',
  hole: [c('Q', H), c('T', H)],
};
/** Q-J of clubs: a missed straight draw on K-9-x, the ace bricks it. */
const NLH_LEAD_BLANK_MISSED: LeadSpot = {
  ...NLH_LEAD_BLOCKER,
  name: 'nlh_lead_blank_missed_draw',
  hole: [c('Q', C), c('J', C)],
  board: BLANK_RIVER,
};
const NLH_LEAD_BLANK_TWO_PAIR: LeadSpot = {
  ...NLH_LEAD_BLOCKER,
  name: 'nlh_lead_blank_two_pair',
  hole: [c('K', C), c('9', C)],
  board: BLANK_RIVER,
};
const PLO4_LEAD_BLOCKER: LeadSpot = {
  name: 'plo4_lead_nut_flush_blocker',
  variant: 'plo4',
  hole: [c('A', H), c('Q', C), c('8', S), c('4', D)],
  board: FLUSH_RIVER,
  behind: 166,
  line: 'lead',
};
const PLO4_LEAD_MADE_NUT_FLUSH: LeadSpot = {
  ...PLO4_LEAD_BLOCKER,
  name: 'plo4_lead_made_nut_flush',
  hole: [c('A', H), c('Q', H), c('8', S), c('4', D)],
};
const PLO4_LEAD_BLANK_MISSED: LeadSpot = {
  ...PLO4_LEAD_BLOCKER,
  name: 'plo4_lead_blank_missed_draw',
  hole: [c('Q', C), c('J', D), c('8', S), c('4', D)],
  board: BLANK_RIVER,
};
/** The board pairs on the river: K-9-6-2-9. */
const PLO4_LEAD_PAIRED: LeadSpot = {
  ...PLO4_LEAD_BLOCKER,
  name: 'plo4_lead_paired_board',
  board: [c('K', H), c('9', H), c('6', D), c('2', C), c('9', C)],
};

/** PLO8, low possible (6-3-2 and the 9 and K), hero's A-4 is the nut low. */
const PLO8_BOARD = [c('K', H), c('9', H), c('6', D), c('2', C), c('3', S)];
const PLO8_FREEROLL: LeadSpot = {
  name: 'plo8_nut_low_no_high',
  variant: 'plo8',
  hole: [c('A', C), c('4', D), c('J', S), c('Q', D)],
  board: PLO8_BOARD,
  behind: 166,
  line: 'barrel',
};
/** K-8-6-2-3: four low ranks; Q-J-T-9 holds neither half. */
const PLO8_GIVEAWAY: LeadSpot = {
  ...PLO8_FREEROLL,
  name: 'plo8_air_into_a_low',
  hole: [c('Q', C), c('J', D), c('T', S), c('9', D)],
  board: [c('K', H), c('8', H), c('6', D), c('2', C), c('3', S)],
};
/** 7-5 makes 7-6-5-3-2: a low, not the nut (A-4 is). */
const PLO8_SECOND_LOW: LeadSpot = {
  ...PLO8_FREEROLL,
  name: 'plo8_non_nut_low',
  hole: [c('7', C), c('5', D), c('J', S), c('Q', D)],
};

describe('LAW A: out-of-position river leads', () => {
  it('the completing-river helper reads only the public board', () => {
    expect(riverCompletedDraw(FLUSH_RIVER, false)).toBe('flush');
    expect(riverCompletedDraw(BLANK_RIVER, false)).toBe(null);
    expect(riverCompletedDraw(BLANK_RIVER, true)).toBe(null);
    // K-9-6-2 then 3: five-four now makes a straight.
    expect(riverCompletedDraw([...FLUSH_RIVER.slice(0, 4), c('3', S)], false)).toBe('straight');
  });

  it(
    'a river that completes the caller draws is bluff-led, blockers most, junk least, never zero',
    () => {
      for (const spot of [NLH_LEAD_BLOCKER, PLO4_LEAD_BLOCKER]) {
        const r = run(spot);
        expect(r.rate, spot.name).toBeGreaterThan(0.15);
        expect(r.rate, spot.name).toBeLessThanOrEqual(RIVER_BLUFF_MAX_PROBABILITY + 0.08);
        expect(r.fires.river_lead_bluff_leadDraw ?? 0, spot.name).toBe(r.bets);
      }
      const junk = run(NLH_LEAD_JUNK).rate;
      expect(junk).toBeGreaterThan(0.02);
      expect(run(NLH_LEAD_BLOCKER).rate).toBeGreaterThan(junk * 1.6);
    },
    TIMEOUT
  );

  it(
    'a blank river is led rarely, but a missed draw still leads it sometimes',
    () => {
      for (const [blank, draw] of [
        [NLH_LEAD_BLANK_MISSED, NLH_LEAD_BLOCKER],
        [PLO4_LEAD_BLANK_MISSED, PLO4_LEAD_BLOCKER],
      ] as const) {
        const b = run(blank);
        expect(b.rate, blank.name).toBeGreaterThan(0.01);
        expect(b.rate, blank.name).toBeLessThan(0.15);
        expect(b.rate, blank.name).toBeLessThan(run(draw).rate * 0.5);
        expect(b.fires.river_lead_bluff_leadBlank ?? 0, blank.name).toBe(b.bets);
      }
      expect(RIVER_BLUFF_LINE.leadBlank).toBeLessThan(RIVER_BLUFF_LINE.leadDraw / 3);
    },
    TIMEOUT
  );

  it(
    'a credible station is never bluff-led into; a river folder is led into more',
    () => {
      const station = run(NLH_LEAD_BLOCKER, {}, () => seedOpponentRiverRead(3, 30));
      expect(station.bets).toBe(0);
      expect(station.fires.river_lead_skip_station ?? 0).toBe(SEEDS.length);
      const unknown = run(NLH_LEAD_BLOCKER).rate;
      const folder = run(NLH_LEAD_BLOCKER, {}, () => seedOpponentRiverRead(21, 30)).rate;
      expect(folder).toBeGreaterThan(unknown);
    },
    TIMEOUT
  );

  it(
    'the made draw leads the completing river for value; a blank river keeps the value check',
    () => {
      for (const spot of [NLH_LEAD_MADE_FLUSH, PLO4_LEAD_MADE_NUT_FLUSH]) {
        const on = run(spot);
        const off = run(spot, { riverLeadRange: false });
        expect(on.rate, spot.name).toBeGreaterThan(0.5);
        expect(on.rate, spot.name).toBeGreaterThan(off.rate + 0.2);
        expect(on.fires.river_lead_value_pass ?? 0, spot.name).toBeGreaterThan(0);
      }
      expect(run(NLH_LEAD_BLANK_TWO_PAIR).rate).toBeLessThan(0.35);
    },
    TIMEOUT
  );

  it(
    'Omaha on a paired board does not lead (Dan 2026-10-25 and 2026-11-06 rulings)',
    () => {
      const r = run(PLO4_LEAD_PAIRED);
      expect(r.bets).toBe(0);
      expect(r.fires.river_lead_bluff_leadDraw ?? 0).toBe(0);
      expect(r.fires.river_lead_bluff_leadBlank ?? 0).toBe(0);
    },
    TIMEOUT
  );

  it(
    'riverLeadRange: false restores the pre-lead check on a blank river',
    () => {
      const r = run(NLH_LEAD_BLANK_MISSED, { riverLeadRange: false });
      expect(r.bets).toBe(0);
    },
    TIMEOUT
  );
});

describe('LAW B: hi-lo river bluffs with a low possible', () => {
  it(
    'the nut low with no high bets the freeroll at a bounded rate',
    () => {
      const r = run(PLO8_FREEROLL);
      expect(r.rate).toBeGreaterThan(0.3);
      expect(r.rate).toBeLessThanOrEqual(RIVER_BLUFF_HILO_FREEROLL + 0.08);
      expect(r.fires.river_bluff_hilo_freeroll ?? 0).toBe(r.bets);
      // Ablated, the old domain gate leaves it to the layers below.
      expect(
        run(PLO8_FREEROLL, { riverBluffHiLo: false }).fires.river_bluff_hilo_freeroll ?? 0
      ).toBe(0);
    },
    TIMEOUT
  );

  it(
    'air with no low checks: the opponent likely low makes the bet a half-pot giveaway',
    () => {
      const r = run(PLO8_GIVEAWAY);
      expect(r.bets).toBe(0);
      expect(r.fires.river_bluff_baseline_skip_low_giveaway ?? 0).toBe(SEEDS.length);
    },
    TIMEOUT
  );

  it(
    'a low that is not the nut is showdown value, never the baseline bluff',
    () => {
      const r = run(PLO8_SECOND_LOW);
      expect(r.fires.river_bluff_hilo_freeroll ?? 0).toBe(0);
      expect(r.fires.river_bluff_hilo_scoop ?? 0).toBe(0);
      expect(r.fires.river_bluff_baseline_skip_low_giveaway ?? 0).toBe(0);
    },
    TIMEOUT
  );

  it('the arithmetic: low chance, nut low, scoop eligibility and frequency', () => {
    const qjt9 = [c('Q', C), c('J', D), c('T', S), c('9', D)];
    const aatj = [c('A', C), c('A', D), c('T', S), c('J', D)];
    // Three low ranks (8-3-2): a random holding has a low more often than not.
    const threeLow = [c('K', H), c('8', H), c('Q', D), c('2', C), c('3', S)];
    const pRandom = riverOpponentLowChance(qjt9, threeLow, 4);
    expect(pRandom).toBeGreaterThan(0.5);
    expect(pRandom).toBeLessThan(0.65);
    // Two aces in hero's hand remove the ace lows.
    expect(riverOpponentLowChance(aatj, threeLow, 4)).toBeLessThan(pRandom);
    // No low possible (one low rank on K-Q-9-T-2): zero.
    const noLow = [c('K', H), c('Q', H), c('9', D), c('T', C), c('2', S)];
    expect(riverOpponentLowChance(qjt9, noLow, 4)).toBe(0);
    expect(riverHeroNutLow(PLO8_FREEROLL.hole, PLO8_BOARD)).toBe(true);
    expect(riverHeroNutLow(PLO8_SECOND_LOW.hole, PLO8_BOARD)).toBe(false);

    const spot: RiverBluffSpot = {
      omaha: true,
      potLimit: true,
      hiLo: true,
      lowPossible: true,
      fixedLimit: false,
      shortDeck: false,
      multiBoard: false,
      bombPot: false,
      holeCount: 4,
      hole: aatj,
      board: threeLow,
      history: [
        { seat: 1, userId: 'hero', action: 'bet', amount: 20, timestamp: 1, stage: 'turn' },
        { seat: 3, userId: 'opp3', action: 'call', amount: 20, timestamp: 2, stage: 'turn' },
        { seat: 3, userId: 'opp3', action: 'check', amount: 0, timestamp: 3, stage: 'river' },
      ] as RiverBluffSpot['history'],
      heroId: 'hero',
      opponentId: 'opp3',
      opponentsLive: 1,
      opponentCanRespond: true,
      equity: 0.1,
      inPosition: true,
      initiative: 'hero',
      scareCard: false,
      nutBlocker: false,
      riverHelpsHero: false,
      rangesFavorOpponent: false,
      barrelPlan: false,
      calledBarrels: 1,
      hiShare: 0.1,
      quarterShare: 0,
    };
    const scoop = riverBluffEligibility(spot);
    expect(scoop.eligible).toBe(true);
    expect(scoop.hiLo?.kind).toBe('scoop');
    // J-T on K-Q-8-2 was an open-ended straight draw that bricked.
    expect(scoop.selection).toBe('missedDraw');
    expect(scoop.hiLo!.oppLowChance).toBeLessThanOrEqual(RIVER_BLUFF_HILO_MAX_OPP_LOW);
    const reads = { station: false, riverFoldRate: null, overFolderFrequency: 0, bluffMod: 1 };
    const p = riverBluffProbability({
      eligibility: scoop,
      sizeFrac: 1,
      valueShare: 0.6,
      airShare: 1,
      reads,
      icmRisk: 0,
      omahaThirdBarrel: false,
    });
    // The whole-pot bluff is the barrel share times the chance of no low.
    expect(p).toBeCloseTo(
      riverBluffBalancedProbability(1, 0.6, 1) *
        RIVER_BLUFF_WEIGHTS[scoop.selection as 'missedDraw'] *
        RIVER_BLUFF_LINE.barrel *
        (1 - scoop.hiLo!.oppLowChance),
      6
    );
    // The same air without the aces is a giveaway.
    expect(riverBluffEligibility({ ...spot, hole: qjt9 }).reason).toBe('low_giveaway');
    // A high share of a quarter or more is showdown value.
    expect(riverBluffEligibility({ ...spot, hiShare: 0.3 }).reason).toBe('showdown_value');
    // Ablated: the old domain gate.
    expect(riverBluffEligibility({ ...spot, hiLoRange: false }).reason).toBe('domain');
    // The freeroll is priced by the quarter risk, not by a read.
    const free = riverBluffEligibility({ ...spot, hole: PLO8_FREEROLL.hole, board: PLO8_BOARD });
    expect(free.selection).toBe('freeroll');
    const pf = (quarterShare: number, station: boolean) =>
      riverBluffProbability({
        eligibility: { ...free, hiLo: { kind: 'freeroll', oppLowChance: 0, quarterShare } },
        sizeFrac: 1,
        valueShare: 0.6,
        airShare: 1,
        reads: { ...reads, station },
        icmRisk: 0,
        omahaThirdBarrel: false,
      });
    expect(pf(0, false)).toBeCloseTo(RIVER_BLUFF_HILO_FREEROLL, 6);
    expect(pf(0, true)).toBeCloseTo(RIVER_BLUFF_HILO_FREEROLL, 6);
    expect(pf(0.25, false)).toBeCloseTo(RIVER_BLUFF_HILO_FREEROLL * 0.5, 6);
    expect(pf(0.5, false)).toBe(0);
  });
});
