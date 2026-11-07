/**
 * LAW: a qualified MULTIWAY river bluff candidate bluffs, in Hold'em and in
 * PLO, at a bounded rate that falls steeply with every extra opponent, and
 * never without a blocker and a story.
 *
 * Dan, 2026-11-06 20:52 Chicago: "MAKE SURE THAT YOU FULLY UPGRADE ENHANCE,
 * OPTIMIZE AND IMPROVE THE RIVER BLUFFING RANGE AND ACTIVATION FOR BOTH
 * HOLDEM AND PLO. ITS IMPORTANT TO ALSO CHECK THAT THERE IS NOTHING THAT IS
 * EVER BLOCKING OR PRENENTING, OR 'SHUTTING OFF' RIVER BLUFFS FOR QUALIFIED
 * CANDITATES OR SITUATIONS."
 *
 * Before HorseMultiwayRiverBluff.ts every one of these three- and four-way
 * spots bet 0 of 200 seeds. Every assertion drives the real
 * HorseLogic.decide on a river checked to hero (the HorseV54RiverBluff
 * fixture: 1/2 cash, 100bb, hero on the button, every opponent calls and
 * checks to hero) against opponents memory has never seen. It pins:
 *  1. Air with a nut blocker on a story line bets at a bounded, non-zero
 *     rate in nlh and plo4, three-way and four-way.
 *  2. The rate is lower than heads-up, and lower four-way than three-way.
 *  3. Without a blocker, or without a story (an opponent raised the turn),
 *     the layer never bluffs.
 *  4. Showdown value is never bluffed by the layer and its decision is the
 *     ablated brain's.
 *  5. One credible station in the field takes it to near zero.
 *  6. Pot limit is respected; the flag ablates the layer.
 * A red law means a multiway river bluff is shut off for a qualified
 * candidate, bluffs too often for the field, or bluffs a hand that should
 * check.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  DECISION_TIME_MS,
  NLH_AIR_BLOCKER,
  PLO4_NUT_BLOCKER_AIR,
  c,
  seedOpponentRiverRead,
  spotState,
  type V54Spot,
} from './HorseV54RiverBluff.test-support.js';
import type { ActionRecord } from '../types.js';
import {
  MULTIWAY_RIVER_BLUFF_CAP,
  MULTIWAY_RIVER_BLUFF_DECAY,
  multiwayRiverAirBar,
  multiwayRiverBluffEligibility,
  multiwayRiverBluffReadFactor,
} from './HorseMultiwayRiverBluff.js';

const TIMEOUT = 300_000 * (process.env.RUNNER_ENVIRONMENT === 'self-hosted' ? 3 : 1);
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

type Mutate = (history: ActionRecord[]) => ActionRecord[];

interface Run {
  rate: number;
  selected: number;
  evaluated: number;
  bets: Array<{ action: string; amount?: number }>;
  actions: string[];
  fires: Record<string, number>;
  pot: number;
}

function run(
  spot: V54Spot,
  opts: HorseDecideOpts = {},
  prepare: () => void = () => HorseMind.reset(),
  mutate?: Mutate
): Run {
  prepare();
  drainFires();
  const bets: Run['bets'] = [];
  const actions: string[] = [];
  let pot = 0;
  for (const seed of SEEDS) {
    const { hero, gs } = spotState(spot);
    if (mutate) gs.actionHistory = mutate([...(gs.actionHistory ?? [])]);
    pot = gs.pot;
    seedFastRandom(seed);
    const d = HorseLogic.decide(
      hero,
      gs,
      'balanced',
      {},
      { observeMind: false, decisionTimeMs: DECISION_TIME_MS, telemetry: true, ...opts }
    );
    actions.push(`${d.action}:${d.amount ?? 0}`);
    if (d.action === 'bet' || d.action === 'all_in' || d.action === 'raise')
      bets.push({ action: d.action, amount: d.amount });
  }
  const fires = Object.fromEntries(
    drainFires()
      .filter((r) => r.feature.startsWith('river_bluff_'))
      .map((r) => [r.feature, r.fires])
  );
  const selected = Object.entries(fires)
    .filter(([k]) => k.startsWith('river_bluff_multiway_selected_'))
    .reduce((n, [, v]) => n + v, 0);
  return {
    rate: bets.length / SEEDS.length,
    selected,
    evaluated: fires.river_bluff_multiway_evaluated ?? 0,
    bets,
    actions,
    fires,
    pot,
  };
}

const way = (spot: V54Spot, n: 2 | 3 | 4): V54Spot => ({
  ...spot,
  name: `${spot.name}_${n}way`,
  extraOpponents: n - 2,
});

/** nlh: 6-3 on 9-8-5-K-2, the six blocks the only straight (7-6). */
const NLH_STRAIGHT_BLOCKER: V54Spot = { ...NLH_AIR_BLOCKER, name: 'nlh_straight_blocker' };
/** nlh: the ace of hearts on a three-heart river, ace high and nothing else. */
const NLH_NUT_FLUSH_BLOCKER: V54Spot = {
  ...NLH_AIR_BLOCKER,
  name: 'nlh_nut_flush_blocker',
  board: [c('9', H), c('8', S), c('5', H), c('K', C), c('2', H)],
  hole: [c('A', H), c('3', D)],
};
const NLH_JUNK: V54Spot = { ...NLH_AIR_BLOCKER, name: 'nlh_junk', hole: [c('Q', C), c('3', D)] };
const NLH_MIDDLE_PAIR: V54Spot = {
  ...NLH_AIR_BLOCKER,
  name: 'nlh_middle_pair',
  hole: [c('9', C), c('6', D)],
};
const PLO4_BLOCKER: V54Spot = { ...PLO4_NUT_BLOCKER_AIR, name: 'plo4_nut_flush_blocker' };
const PLO4_NO_BLOCKER: V54Spot = {
  ...PLO4_NUT_BLOCKER_AIR,
  name: 'plo4_no_blocker',
  hole: [c('Q', S), c('8', H), c('4', C), c('3', D)],
};
const PLO4_TOP_TWO: V54Spot = {
  ...PLO4_NUT_BLOCKER_AIR,
  name: 'plo4_top_two',
  hole: [c('K', H), c('J', D), c('4', C), c('3', D)],
};
const PLO5_BLOCKER: V54Spot = {
  ...PLO4_NUT_BLOCKER_AIR,
  name: 'plo5_nut_flush_blocker',
  variant: 'plo5',
  hole: [c('A', S), c('Q', H), c('4', C), c('3', D), c('7', H)],
};
const PLO6_BLOCKER: V54Spot = {
  ...PLO4_NUT_BLOCKER_AIR,
  name: 'plo6_nut_flush_blocker',
  variant: 'plo6',
  hole: [c('A', S), c('Q', H), c('4', C), c('3', D), c('7', H), c('8', C)],
};
const LINES = ['barrel', 'turn', 'passive'] as const;
const BLOCKER_SPOTS = [NLH_STRAIGHT_BLOCKER, NLH_NUT_FLUSH_BLOCKER, PLO4_BLOCKER];

/** The first opponent RAISES hero's turn bet; everyone calls. */
const turnRaised: Mutate = (h) => {
  const out: ActionRecord[] = [];
  let raised = false;
  for (const a of h) {
    if (!raised && a.stage === 'turn' && a.userId === 'opp3' && a.action === 'call') {
      out.push({ ...a, action: 'raise', amount: (a.amount ?? 0) * 3 });
      raised = true;
      continue;
    }
    out.push(a);
  }
  const lastTurn = out.map((a) => a.stage).lastIndexOf('turn');
  out.splice(lastTurn + 1, 0, {
    seat: 1,
    userId: 'hero',
    action: 'call',
    amount: 60,
    timestamp: 999,
    stage: 'turn',
  } as ActionRecord);
  return out;
};

describe('LAW: a multiway river with a blocker and a story is bluffed', () => {
  it(
    'nlh and plo4, three-way and four-way: bounded and non-zero',
    () => {
      for (const base of BLOCKER_SPOTS) {
        for (const line of LINES) {
          const spot = { ...base, line };
          const r3 = run(way(spot, 3));
          const r4 = run(way(spot, 4));
          const tag = `${base.name}/${line}`;
          expect(r3.rate, `${tag} 3-way`).toBeGreaterThan(0.03);
          expect(r3.rate, `${tag} 3-way`).toBeLessThanOrEqual(MULTIWAY_RIVER_BLUFF_CAP[2] + 0.05);
          expect(r4.rate, `${tag} 4-way`).toBeGreaterThan(0.005);
          expect(r4.rate, `${tag} 4-way`).toBeLessThanOrEqual(MULTIWAY_RIVER_BLUFF_CAP[3] + 0.05);
          expect(r3.selected, tag).toBe(r3.bets.length);
          expect(r4.selected, tag).toBe(r4.bets.length);
          expect(r3.evaluated, tag).toBe(SEEDS.length);
        }
      }
    },
    TIMEOUT
  );

  it(
    'plo5 and plo6: the nut-flush blocker bluffs a capped three-way field',
    () => {
      for (const base of [PLO5_BLOCKER, PLO6_BLOCKER]) {
        const r = run(way({ ...base, line: 'passive' }, 3));
        expect(r.rate, base.name).toBeGreaterThan(0.03);
        expect(r.rate, base.name).toBeLessThanOrEqual(MULTIWAY_RIVER_BLUFF_CAP[2] + 0.05);
        expect(r.selected, base.name).toBe(r.bets.length);
        for (const b of r.bets) expect(b.amount ?? 0).toBeLessThanOrEqual(r.pot + 0.005);
      }
    },
    TIMEOUT
  );

  it(
    'the rate falls with every opponent: heads-up > three-way > four-way',
    () => {
      for (const base of BLOCKER_SPOTS) {
        let hu = 0;
        let w3 = 0;
        let w4 = 0;
        for (const line of LINES) {
          const spot = { ...base, line };
          hu += run(way(spot, 2)).rate;
          w3 += run(way(spot, 3)).rate;
          w4 += run(way(spot, 4)).rate;
        }
        expect(w3, base.name).toBeLessThan(hu * 0.75);
        expect(w4, base.name).toBeLessThan(w3);
        expect(w4, base.name).toBeLessThan(hu * 0.4);
      }
    },
    TIMEOUT
  );
});

describe('LAW: no blocker or no story, no multiway bluff', () => {
  it(
    'air without a nut blocker never takes the multiway bluff',
    () => {
      for (const base of [NLH_JUNK, PLO4_NO_BLOCKER]) {
        for (const n of [3, 4] as const) {
          const r = run(way({ ...base, line: 'passive' }, n));
          expect(r.selected, `${base.name} ${n}`).toBe(0);
          expect(r.rate, `${base.name} ${n}`).toBeLessThanOrEqual(0.02);
          expect(r.fires.river_bluff_multiway_skip_no_blocker, base.name).toBe(SEEDS.length);
        }
      }
    },
    TIMEOUT
  );

  it(
    'an opponent who raised the turn uncaps the field: no story, no bluff',
    () => {
      for (const base of [NLH_NUT_FLUSH_BLOCKER, PLO4_BLOCKER]) {
        const r = run(way({ ...base, line: 'barrel' }, 3), {}, undefined, turnRaised);
        expect(r.selected, base.name).toBe(0);
        expect(r.rate, base.name).toBeLessThanOrEqual(0.02);
        expect(r.fires.river_bluff_multiway_skip_no_story, base.name).toBe(SEEDS.length);
      }
    },
    TIMEOUT
  );
});

describe('LAW: showdown value is not bluffed multiway', () => {
  it(
    'nlh middle pair and plo4 top two: the layer never fires and changes nothing',
    () => {
      for (const base of [NLH_MIDDLE_PAIR, PLO4_TOP_TWO]) {
        for (const n of [3, 4] as const) {
          const spot = way({ ...base, line: 'passive' }, n);
          const on = run(spot);
          const off = run(spot, { riverBluffMultiway: false });
          expect(on.selected, spot.name).toBe(0);
          expect(on.evaluated, spot.name).toBe(0);
          expect(on.actions, spot.name).toEqual(off.actions);
        }
      }
    },
    TIMEOUT
  );

  it('the air bar is half a fair share of the field', () => {
    expect(multiwayRiverAirBar(2)).toBeCloseTo(0.5 / 3, 6);
    expect(multiwayRiverAirBar(3)).toBeCloseTo(0.5 / 4, 6);
    const { hero, gs } = spotState(way(NLH_NUT_FLUSH_BLOCKER, 3));
    const base = {
      omaha: false,
      potLimit: false,
      hiLo: false,
      lowPossible: false,
      fixedLimit: false,
      shortDeck: false,
      multiBoard: false,
      bombPot: false,
      holeCount: 2,
      hole: hero.cards,
      board: gs.communityCards,
      history: gs.actionHistory ?? [],
      heroId: 'hero',
      opponentIds: ['opp3', 'opp5'],
      allCanRespond: true,
      madeCategory: 1,
      inPosition: true,
      initiative: 'hero' as const,
      scareCard: true,
      nutBlocker: true,
    };
    expect(multiwayRiverBluffEligibility({ ...base, equity: 0.1 }).eligible).toBe(true);
    expect(multiwayRiverBluffEligibility({ ...base, equity: 0.2 }).reason).toBe('showdown_value');
    expect(
      multiwayRiverBluffEligibility({ ...base, equity: 0.1, opponentIds: ['a', 'b', 'c', 'd'] })
        .reason
    ).toBe('too_many');
    expect(
      multiwayRiverBluffEligibility({ ...base, equity: 0.1, allCanRespond: false }).reason
    ).toBe('cannot_respond');
  });
});

describe('LAW: every read in the field multiplies', () => {
  it(
    'one credible station in the field takes the multiway bluff to near zero',
    () => {
      const spot = way({ ...NLH_STRAIGHT_BLOCKER, line: 'passive' }, 3);
      const unknown = run(spot).rate;
      const station = run(spot, {}, () => seedOpponentRiverRead(3, 30)).rate;
      expect(station).toBeLessThanOrEqual(0.03);
      expect(station).toBeLessThan(unknown * 0.35);
      expect(multiwayRiverBluffReadFactor([{ station: true, riverFoldRate: null }])).toBe(0.05);
      expect(
        multiwayRiverBluffReadFactor([
          { station: false, riverFoldRate: 0.3 },
          { station: false, riverFoldRate: 0.3 },
        ])
      ).toBeLessThan(multiwayRiverBluffReadFactor([{ station: false, riverFoldRate: 0.3 }]));
    },
    TIMEOUT
  );
});

describe('LAW: limits and ablation', () => {
  it(
    'a multiway PLO bluff never exceeds the pot',
    () => {
      for (const n of [3, 4] as const) {
        const r = run(way({ ...PLO4_BLOCKER, line: 'passive' }, n));
        expect(r.bets.length).toBeGreaterThan(0);
        for (const b of r.bets) expect(b.amount ?? 0).toBeLessThanOrEqual(r.pot + 0.005);
      }
    },
    TIMEOUT
  );

  it(
    'riverBluffMultiway: false ablates the layer',
    () => {
      const r = run(way({ ...NLH_STRAIGHT_BLOCKER, line: 'passive' }, 3), {
        riverBluffMultiway: false,
      });
      expect(r.selected).toBe(0);
      expect(r.evaluated).toBe(0);
    },
    TIMEOUT
  );

  it('the decay is steep and monotonic', () => {
    expect(MULTIWAY_RIVER_BLUFF_DECAY[2]).toBeLessThan(0.5);
    expect(MULTIWAY_RIVER_BLUFF_DECAY[3]).toBeLessThan(MULTIWAY_RIVER_BLUFF_DECAY[2] * 0.5);
    expect(MULTIWAY_RIVER_BLUFF_CAP[3]).toBeLessThan(MULTIWAY_RIVER_BLUFF_CAP[2]);
  });
});
