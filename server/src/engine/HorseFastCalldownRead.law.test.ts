/**
 * LAW: the horses see a player start calling rivers within a few river
 * opportunities, cut the river bluffs against him, and give them back when he
 * folds rivers again.
 *
 * Task (2026-11-07): "a FAST adaptive read on a player who starts calling
 * rivers lighter, so the horses' increased river bluffing does not keep
 * firing into someone who has adapted."
 *
 * Measured before the read (HorseFastCalldownRead.test-support.ts, heads-up
 * hold'em, 30 river folds then every river bet called): the station read never
 * engaged in 40 calls (28 with blank hands between river spots), and the
 * lifetime river fold rate kept the 1.6x folder boost for 6 calls; the real
 * HorseLogic.decide bluff rate was still above the unknown-player rate after
 * 8 calls.
 *
 * Every assertion below drives the real HorseLogic.decide on the
 * HorseV54RiverBluff river (checked to hero, heads-up air with a blocker),
 * the HorseRiverLeadHiLo out-of-position lead, and the three-way multiway
 * river, after the opponent's hands were observed exactly as production
 * observes a completed hand. It pins:
 *  1. Within FAST_CALLDOWN_OPPS river opportunities of the switch, the
 *     heads-up bluff rate is under half the unknown-player rate in nlh and
 *     plo4, with or without blank hands between river spots; the ablated
 *     brain at the same point still bluffs at least the unknown rate.
 *  2. The out-of-position lead and the multiway bluff take the same read.
 *  3. Within RECOVERY_OPPS river folds the rate is back to at least twice
 *     the call-down rate.
 *  4. An opponent memory has never seen is unaffected (decision for
 *     decision), and the read is null without recent river evidence: it
 *     never removes a bluff on absence of data, and the call-down cut is a
 *     fifth of the bluffs heads-up, never zero.
 *  5. A stable half-and-half river caller is never read as calling down.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import {
  DECISION_TIME_MS,
  NLH_AIR_BLOCKER,
  PLO4_NUT_BLOCKER_AIR,
  c,
  spotState,
  type V54Spot,
} from './HorseV54RiverBluff.test-support.js';
import { decideLeadSpot, type LeadSpot } from './HorseRiverLeadHiLo.test-support.js';
import { FCA_OPP, observeFcaHand, playFcaPhase } from './HorseFastCalldownRead.test-support.js';
import { fastCalldownRead, FAST_CALLDOWN_MIN_OPPS } from './HorseFastCalldownRead.js';
import { RIVER_BLUFF_STATION_FACTOR } from './HorseRiverBluffRange.js';

const TIMEOUT = 300_000 * (process.env.RUNNER_ENVIRONMENT === 'self-hosted' ? 3 : 1);
const SEEDS = Array.from({ length: 240 }, (_, i) => 104_729 + i * 15_485_863);
/** River opportunities after the switch by which the cut must be in place. */
const FAST_CALLDOWN_OPPS = 6;
/** River folds after switching back by which the bluffs must return. */
const RECOVERY_OPPS = 6;
const OFF: HorseDecideOpts = { riverFastCalldown: false };

afterEach(() => HorseMind.reset());

function rateOf(decide: (seed: number) => { action: string }): number {
  let bets = 0;
  for (const seed of SEEDS) {
    const d = decide(seed);
    if (d.action === 'bet' || d.action === 'all_in' || d.action === 'raise') bets++;
  }
  return bets / SEEDS.length;
}

function decideV54(spot: V54Spot, seed: number, opts: HorseDecideOpts = {}) {
  const { hero, gs } = spotState(spot);
  seedFastRandom(seed);
  return HorseLogic.decide(
    hero,
    gs,
    'balanced',
    {},
    { observeMind: false, decisionTimeMs: DECISION_TIME_MS, ...opts }
  );
}

const v54Rate = (spot: V54Spot, opts: HorseDecideOpts = {}) =>
  rateOf((seed) => decideV54(spot, seed, opts));

/** The HorseRiverLeadHiLo lead: the Ah river-flush blocker, out of position. */
const NLH_LEAD_BLOCKER: LeadSpot = {
  name: 'nlh_lead_nut_flush_blocker',
  variant: 'nlh',
  hole: [c('A', 'hearts'), c('4', 'clubs')],
  board: [
    c('K', 'hearts'),
    c('9', 'hearts'),
    c('6', 'diamonds'),
    c('2', 'clubs'),
    c('7', 'hearts'),
  ],
  behind: 166,
  line: 'lead',
};
/** Three-way: opp3 is the adapting player, opp5 is unknown. */
const NLH_MULTIWAY: V54Spot = {
  ...NLH_AIR_BLOCKER,
  name: 'nlh_straight_blocker_3way',
  line: 'passive',
  extraOpponents: 1,
};

describe('LAW: a player who starts calling rivers is read within a few river spots', () => {
  for (const [variant, spot] of [
    ['nlh', NLH_AIR_BLOCKER],
    ['plo4', PLO4_NUT_BLOCKER_AIR],
  ] as const) {
    for (const blanks of [0, 3]) {
      it(
        `${variant}, ${blanks} blank hands between river spots: the bluffs drop, then return`,
        () => {
          HorseMind.reset();
          const unknown = v54Rate(spot);
          expect(unknown).toBeGreaterThan(0.1);
          playFcaPhase('fold', 30, blanks, () => {}, variant);
          const folder = v54Rate(spot);
          // The over-folder is bluffed more than an unknown player.
          expect(folder).toBeGreaterThan(unknown);
          playFcaPhase('call', FAST_CALLDOWN_OPPS, blanks, () => {}, variant);
          const adapted = v54Rate(spot);
          const ablated = v54Rate(spot, OFF);
          expect(adapted).toBeLessThan(unknown * 0.5);
          // The slow reads alone still bluff him at least as an unknown.
          expect(ablated).toBeGreaterThanOrEqual(unknown);
          // A fifth, never zero.
          expect(adapted).toBeGreaterThan(0);
          playFcaPhase('call', 10, blanks, () => {}, variant);
          const station = v54Rate(spot);
          playFcaPhase('fold', RECOVERY_OPPS, blanks, () => {}, variant);
          const recovered = v54Rate(spot);
          expect(recovered).toBeGreaterThanOrEqual(Math.max(station, 0.02) * 2);
        },
        TIMEOUT
      );
    }
  }

  it(
    'the out-of-position lead and the multiway bluff take the same read',
    () => {
      HorseMind.reset();
      const leadUnknown = rateOf((seed) => decideLeadSpot(NLH_LEAD_BLOCKER, seed));
      const mwUnknown = v54Rate(NLH_MULTIWAY);
      expect(leadUnknown).toBeGreaterThan(0.05);
      expect(mwUnknown).toBeGreaterThan(0.05);
      playFcaPhase('fold', 30);
      playFcaPhase('call', FAST_CALLDOWN_OPPS);
      const leadAdapted = rateOf((seed) => decideLeadSpot(NLH_LEAD_BLOCKER, seed));
      const leadAblated = rateOf((seed) => decideLeadSpot(NLH_LEAD_BLOCKER, seed, OFF));
      const mwAdapted = v54Rate(NLH_MULTIWAY);
      const mwAblated = v54Rate(NLH_MULTIWAY, OFF);
      // A player calling rivers is never bluff-led into (the station rule).
      expect(leadAdapted).toBeLessThanOrEqual(0.02);
      expect(leadAblated).toBeGreaterThan(leadAdapted + 0.05);
      // Multiway: the station factor, near zero.
      expect(mwAdapted).toBeLessThanOrEqual(0.03);
      expect(mwAdapted).toBeLessThan(mwUnknown * 0.35);
      expect(mwAblated).toBeGreaterThan(mwAdapted);
    },
    TIMEOUT
  );
});

describe('LAW: no data, no change', () => {
  it(
    'an opponent memory has never seen gets the same decisions with the read on or off',
    () => {
      HorseMind.reset();
      for (const spot of [NLH_AIR_BLOCKER, PLO4_NUT_BLOCKER_AIR, NLH_MULTIWAY]) {
        for (const seed of SEEDS.slice(0, 80)) {
          const on = decideV54(spot, seed);
          const off = decideV54(spot, seed, OFF);
          expect(`${on.action}:${on.amount ?? 0}`).toBe(`${off.action}:${off.amount ?? 0}`);
        }
      }
      for (const seed of SEEDS.slice(0, 80)) {
        const on = decideLeadSpot(NLH_LEAD_BLOCKER, seed);
        const off = decideLeadSpot(NLH_LEAD_BLOCKER, seed, OFF);
        expect(`${on.action}:${on.amount ?? 0}`).toBe(`${off.action}:${off.amount ?? 0}`);
      }
    },
    TIMEOUT
  );

  it('the read is null without recent river evidence, and a call-down keeps a fifth', () => {
    const empty = {
      recentRiverOpps: 0,
      recentRiverCalls: 0,
      fastOpps: 0,
      fastCalls: 0,
      longOpps: 0,
      longCalls: 0,
      lifetimeOpps: 0,
      lifetimeFolds: 0,
    };
    expect(fastCalldownRead(empty)).toBeNull();
    // Two straight calls are not yet evidence.
    expect(
      fastCalldownRead({
        ...empty,
        recentRiverOpps: 2,
        recentRiverCalls: 2,
        fastOpps: 2,
        fastCalls: 2,
      })
    ).toBeNull();
    expect(FAST_CALLDOWN_MIN_OPPS).toBeGreaterThan(2);
    // Blank hands alone never build a read.
    HorseMind.reset();
    for (let i = 0; i < 40; i++) observeFcaHand(null);
    HorseMind.setDecisionScope('holdem:hu', 'nlh');
    try {
      expect(HorseMind.fastCalldownRead(FCA_OPP)).toBeNull();
    } finally {
      HorseMind.setDecisionScope(null);
    }
    expect(RIVER_BLUFF_STATION_FACTOR).toBeGreaterThan(0);
  });

  it('a stable half-and-half river caller is never read as calling down', () => {
    HorseMind.reset();
    let engaged = 0;
    for (let i = 0; i < 60; i++) {
      observeFcaHand(i % 2 === 0 ? 'call' : 'fold');
      HorseMind.setDecisionScope('holdem:hu', 'nlh');
      try {
        if (HorseMind.fastCalldownRead(FCA_OPP)?.callingDown) engaged++;
      } finally {
        HorseMind.setDecisionScope(null);
      }
    }
    expect(engaged).toBe(0);
  });
});
