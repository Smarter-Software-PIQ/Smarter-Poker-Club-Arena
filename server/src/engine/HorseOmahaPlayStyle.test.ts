/**
 * THE OMAHA MAPPING of the Horse's playing style (HorseOmahaPlayStyle.ts;
 * owner 2026-11-15 16:40 and 16:42; option horsePlayStyles, default OFF).
 *
 *  - unset, false, a truthy non-boolean and the 'current' style decide
 *    byte-identically to today, at the decision and in the league;
 *  - the dials are bounded and monotone: tight enters fewer hands than
 *    current everywhere, pressure enters more on the cutoff and the button
 *    and is the current style exactly out of position;
 *  - the table rule: a floored table, a short stack, a tournament and
 *    Lightning play current;
 *  - the owner rulings stay final for every style (the VPIP floor is met by a
 *    limp, the cold 4-bet call needs a premium); the turn and river rulings
 *    are in HorseOmahaStrategyPrecedence, HorseOmahaTurnRiverRaiseNeedsNuts
 *    and HorseOmahaBigDrawAggression tests;
 *  - no illegal action, and the worker receipt validator admits every
 *    styled decision.
 *
 * The table is the recorded PLO5 cash hand of HorseOmahaUnderpair.fixture
 * (six seats, 1/2, the hero 200 bb deep, a 50% VPIP floor unless removed).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintFixture,
  type ComplaintPublicNode,
} from './HorseComplaintReplay.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { runMatchup } from '../benchmark/HorseLeague.js';
import { HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID } from '../benchmark/HorseLeagueHumanField.js';
import {
  HORSE_INDIFFERENCE_EV_BAND_BB,
  ploArchetypeFor,
  ploPersonaFor,
  ploPersonaOfArchetype,
} from './HorsePersona.js';
import { HORSE_PLAY_STYLES, type HorsePlayStyle } from './HorsePlayStyle.js';
import {
  OMAHA_PLAY_STYLE_MUL_MAX,
  OMAHA_PLAY_STYLE_MUL_MIN,
  OMAHA_PLAY_STYLE_NEUTRAL,
  OMAHA_PRESSURE_POSTFLOP_IP,
  OMAHA_PRESSURE_PREFLOP_IP,
  OMAHA_TIGHT_EXPECTED_VPIP_PCT,
  OMAHA_TIGHT_POSTFLOP,
  OMAHA_TIGHT_PREFLOP,
  omahaPlayStyleArchetype,
  omahaPlayStyleIndifferenceAggressionBias,
  omahaPlayStyleMapped,
  omahaPlayStylePersona,
  omahaPlayStylePostflopDials,
  omahaPlayStylePreflopDials,
} from './HorseOmahaPlayStyle.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import RECORDED from './HorseOmahaUnderpair.fixture.json';

const FX = RECORDED as unknown as ComplaintFixture;
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [6000, 6001, 6002, 6003];
const style = (s: HorsePlayStyle): HorseDecideOpts => ({
  horsePlayStyles: true,
  horsePlayStyleForce: s,
});

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

// ─── the mapping itself ──────────────────────────────────────────────────────

describe('the dials', () => {
  it('every multiplier lies in 0.75 to 1.25', () => {
    for (const d of [
      OMAHA_PLAY_STYLE_NEUTRAL,
      OMAHA_TIGHT_PREFLOP,
      OMAHA_TIGHT_POSTFLOP,
      OMAHA_PRESSURE_PREFLOP_IP,
      OMAHA_PRESSURE_POSTFLOP_IP,
    ])
      for (const x of Object.values(d)) {
        expect(x).toBeGreaterThanOrEqual(OMAHA_PLAY_STYLE_MUL_MIN);
        expect(x).toBeLessThanOrEqual(OMAHA_PLAY_STYLE_MUL_MAX);
      }
    expect([OMAHA_PLAY_STYLE_MUL_MIN, OMAHA_PLAY_STYLE_MUL_MAX]).toEqual([0.75, 1.25]);
  });

  it('current is no scale at all; pressure out of position is no scale at all', () => {
    for (const pos of [true, false]) {
      expect(omahaPlayStylePreflopDials('current', pos)).toBe(OMAHA_PLAY_STYLE_NEUTRAL);
      expect(omahaPlayStylePostflopDials('current', pos)).toBe(OMAHA_PLAY_STYLE_NEUTRAL);
    }
    expect(omahaPlayStylePreflopDials('pressure', false)).toBe(OMAHA_PLAY_STYLE_NEUTRAL);
    expect(omahaPlayStylePostflopDials('pressure', false)).toBe(OMAHA_PLAY_STYLE_NEUTRAL);
    expect(Object.values(OMAHA_PLAY_STYLE_NEUTRAL).every((x) => x === 1)).toBe(true);
  });

  it('the direction: tight raises the bars and lowers the bluffs; pressure in position the reverse', () => {
    const tight = omahaPlayStylePreflopDials('tight', true);
    expect(tight).toEqual(omahaPlayStylePreflopDials('tight', false));
    expect(tight.tightnessMul).toBeGreaterThan(1);
    expect(tight.bluffFreqMul).toBeLessThan(1);
    // Tight-AGGRESSIVE: the value re-raise bars are today's.
    expect(tight.valueRaiseTightnessMul).toBe(1);
    expect(tight.aggressionMul).toBe(1);
    expect(omahaPlayStylePostflopDials('tight', false).bluffFreqMul).toBeLessThan(1);
    expect(omahaPlayStylePostflopDials('tight', true).aggressionMul).toBe(1);
    const pre = omahaPlayStylePreflopDials('pressure', true);
    expect(pre.tightnessMul).toBeLessThan(1);
    expect(pre.bluffFreqMul).toBeGreaterThan(1);
    expect(pre.aggressionMul).toBeGreaterThan(1);
    const post = omahaPlayStylePostflopDials('pressure', true);
    expect(post.tightnessMul).toBe(1);
    expect(post.bluffFreqMul).toBeGreaterThan(1);
    expect(post.aggressionMul).toBeGreaterThan(1);
    expect(post.cbetFreqMul).toBeGreaterThan(1);
    // The EV engine's aggression tie-break: the top of the seed's own range, in position only.
    expect(omahaPlayStyleIndifferenceAggressionBias('pressure', true)).toBe(0.12);
    expect(omahaPlayStyleIndifferenceAggressionBias('pressure', true)).toBeLessThanOrEqual(
      HORSE_INDIFFERENCE_EV_BAND_BB
    );
    for (const [st, pos] of [
      ['pressure', false],
      ['tight', true],
      ['tight', false],
      ['current', true],
      ['current', false],
    ] as const)
      expect(omahaPlayStyleIndifferenceAggressionBias(st, pos)).toBeUndefined();
    expect(omahaPlayStylePostflopDials('tight', true).cbetFreqMul).toBe(1);
  });

  it('the archetype follows the style: never tight by style and LAG by archetype', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const id = `horse-${i}`;
      const own = ploArchetypeFor(id);
      seen.add(own);
      for (const pos of [true, false]) {
        expect(omahaPlayStylePersona(id, 'current', pos)).toEqual(ploPersonaFor(id));
        const tight = omahaPlayStyleArchetype(id, 'tight', pos);
        expect(['tag_crusher', 'nit_hunter']).toContain(tight);
        if (own === 'tag_crusher' || own === 'nit_hunter') expect(tight).toBe(own);
        else expect(tight).toBe('tag_crusher');
      }
      expect(omahaPlayStyleArchetype(id, 'pressure', true)).toBe('lag_shark');
      expect(omahaPlayStylePersona(id, 'pressure', false)).toEqual(ploPersonaFor(id));
      // The gears are today's bands: the named archetype's own, the Horse's own draws.
      expect(omahaPlayStylePersona(id, 'pressure', true)).toEqual(
        ploPersonaOfArchetype(id, 'lag_shark')
      );
      expect(ploPersonaOfArchetype(id, own)).toEqual(ploPersonaFor(id));
      // Fewer non-premium 3-bets and river bluffs tight than under pressure in position.
      const t = omahaPlayStylePersona(id, 'tight', true);
      const p = omahaPlayStylePersona(id, 'pressure', true);
      expect(t.plo3BetMix).toBeLessThanOrEqual(p.plo3BetMix);
      // The strong coordinated hands re-raise at least as often tight as today.
      expect(t.plo3BetMix).toBeGreaterThanOrEqual(ploPersonaFor(id).plo3BetMix);
      expect(t.riverBluffGear).toBeLessThan(p.riverBluffGear);
    }
    expect(seen.size).toBe(4);
  });

  it('the games: PLO4 and PLO5 with three seats or more; nothing else', () => {
    const t = { gameVariant: 'plo5', isOmaha: true, isHiLo: false, dealtSeats: 6 };
    expect(omahaPlayStyleMapped(t)).toBe(true);
    expect(omahaPlayStyleMapped({ ...t, gameVariant: 'plo4', dealtSeats: 3 })).toBe(true);
    expect(omahaPlayStyleMapped({ ...t, gameVariant: 'plo6' })).toBe(false);
    expect(omahaPlayStyleMapped({ ...t, gameVariant: 'plo8', isHiLo: true })).toBe(false);
    expect(omahaPlayStyleMapped({ ...t, gameVariant: 'nlh', isOmaha: false })).toBe(false);
    expect(omahaPlayStyleMapped({ ...t, dealtSeats: 2 })).toBe(false);
    expect(omahaPlayStyleMapped({ ...t, bombPot: true })).toBe(false);
    expect(omahaPlayStyleMapped({ ...t, allInOrFold: true })).toBe(false);
  });

  it('the tight expected VPIP is under the lowest table floor (30)', () => {
    for (const v of ['plo4', 'plo5']) {
      expect(OMAHA_TIGHT_EXPECTED_VPIP_PCT[v]).toBeGreaterThan(15);
      expect(OMAHA_TIGHT_EXPECTED_VPIP_PCT[v]).toBeLessThan(30);
    }
  });
});

// ─── at the decision ─────────────────────────────────────────────────────────

const noFloor = (pn: ComplaintPublicNode): void => {
  delete pn.vpipFloor;
  delete pn.vpipWindowHands;
};
interface Variation {
  hole?: string;
  node?: (pn: ComplaintPublicNode) => void;
  gs?: (gs: HorseGameStateV2) => void;
}
/**
 * The recorded table (button seat 4, blinds 5 and 6) folded to `seat`, which
 * is first in for 2: seat 1 under the gun, 2 the middle seat, 3 the cutoff,
 * 4 the button.
 */
function firstIn(seat: 1 | 2 | 3 | 4, v: Variation = {}) {
  const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  const pn = JSON.parse(
    JSON.stringify(fx.actions.find((a) => a.ord === 7)!.publicNode)
  ) as ComplaintPublicNode;
  const acts = fx.actions.slice(0, 3);
  const add = (s: number, action: string, amount: number) =>
    acts.push({
      ord: acts.length + 1,
      seat: s,
      stage: 'preflop',
      action,
      amount,
      origin: 'horse_policy',
      isFullRaise: false,
      dead: false,
    });
  for (let s = 1; s < seat; s++) add(s, 'fold', 0);
  pn.seats = [
    [1, 1426.9, 0, 0, 0, 0, seat > 1 ? 1 : 0],
    [2, 1172.95, 0, 0, 0, 0, seat > 2 ? 1 : 0],
    [3, 400, 0, 0, 0, 0, seat > 3 ? 1 : 0],
    [4, 400.4, 0, 0, 0, 0, 0],
    [5, 379.65, 1, 1, 0, 0, 0],
    [6, 795.5, 2, 4, 2, 0, 0],
  ];
  Object.assign(pn, {
    pot: 5,
    toCall: 2,
    currentBet: 2,
    minRaiseTo: 4,
    maxRaiseTo: 9,
    actorSeat: seat,
  });
  add(seat, 'call', 2);
  const node = acts[acts.length - 1];
  node.publicNode = pn;
  fx.actions = acts;
  fx.hole[String(seat)] = cards(v.hole ?? 'KhQhJsTs9c');
  v.node?.(pn);
  const st = stateAt(fx, node);
  v.gs?.(st.gs);
  return st;
}
function recorded(ord: number, v: Variation = {}) {
  const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  const node = fx.actions.find((a) => a.ord === ord)!;
  if (v.hole) fx.hole[String(node.seat)] = cards(v.hole);
  v.node?.(node.publicNode!);
  const st = stateAt(fx, node);
  v.gs?.(st.gs);
  return st;
}
type St = ReturnType<typeof firstIn>;

interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
}
const ENTER = new Set(['call', 'raise', 'bet', 'all_in']);
function play(
  build: () => St,
  opts: HorseDecideOpts,
  seeds: number[] = SEEDS,
  mods: typeof LIVE.mods = LIVE.mods
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [] };
  for (const s of seeds) {
    HorseMind.reset();
    drainFires();
    seedFastRandom(s);
    const st = build();
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, mods, {
      mind: false,
      telemetry: true,
      ...opts,
    });
    // No illegal action, whatever the style.
    expect(st.gs.legalActions).toContain(d.action);
    if (d.action === 'raise' || d.action === 'bet') {
      expect(d.amount).toBeGreaterThanOrEqual((st.gs.minRaiseTo as number) - 1e-9);
      expect(d.amount).toBeLessThanOrEqual((st.gs.maxRaiseTo as number) + 1e-9);
    }
    // The worker receipt validator admits the styled decision.
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), String(st.gs.gameVariant), {
        player: st.hero,
        gameState: st.gs,
      })
    ).toBeNull();
    out.bytes.push(JSON.stringify(withoutMeasurements(d)));
    out.actions.push(d.action);
    out.fires.push(
      drainFires()
        .map((f) => f.feature)
        .filter((f) => !f.startsWith('horse_play_style_'))
    );
  }
  return out;
}
const styleFires = (build: () => St, opts: HorseDecideOpts): string[] => {
  enableBrainTelemetry();
  HorseMind.reset();
  drainFires();
  seedFastRandom(SEEDS[0]);
  const st = build();
  HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
    mind: false,
    telemetry: true,
    ...opts,
  });
  return drainFires()
    .map((f) => f.feature)
    .filter((f) => f.startsWith('horse_play_style_'));
};
const entries = (o: Outcome): number => o.actions.filter((a) => ENTER.has(a)).length;

/** A fixed sample of five-card hands (a linear congruential shuffle; no Math.random). */
const HANDS: string[] = (() => {
  const ranks = '23456789TJQKA';
  const suits = 'cdhs';
  let x = 20261115;
  const next = (n: number): number => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return Math.floor((x / 0x100000000) * n);
  };
  const out: string[] = [];
  while (out.length < 160) {
    const picked = new Set<number>();
    while (picked.size < 5) picked.add(next(52));
    out.push([...picked].map((c) => ranks[c % 13] + suits[Math.floor(c / 13)]).join(''));
  }
  return out;
})();

describe('off, and the current style: today exactly', () => {
  it('unset, false, a truthy non-boolean and current decide byte-identically, floored or not', () => {
    for (const seat of [1, 4] as const)
      for (const node of [undefined, noFloor])
        for (const hole of HANDS.slice(0, 24)) {
          const unset = play(() => firstIn(seat, { hole, node }), {});
          for (const opts of [
            { horsePlayStyles: false },
            { horsePlayStyles: 1 as unknown as boolean },
            { horsePlayStyles: false, horsePlayStyleForce: 'tight' as const },
            { horsePlayStyleForce: 'pressure' as const },
            style('current'),
          ]) {
            const o = play(() => firstIn(seat, { hole, node }), opts);
            expect(o.bytes).toEqual(unset.bytes);
          }
        }
  });

  it('the recorded later decisions (13 preflop, 16 flop, 19 turn) are unchanged by current', () => {
    for (const ord of [7, 13, 16, 19]) {
      const unset = play(() => recorded(ord, { node: noFloor }), {});
      expect(play(() => recorded(ord, { node: noFloor }), style('current')).bytes).toEqual(
        unset.bytes
      );
    }
  });
});

describe('monotone: tight enters fewer hands, pressure more in position, the same out of position', () => {
  const count = (seat: 1 | 2 | 3 | 4, opts: HorseDecideOpts): number =>
    HANDS.reduce(
      (n, hole) => n + entries(play(() => firstIn(seat, { hole, node: noFloor }), opts)),
      0
    );

  it.each([
    [4, 'the button'],
    [3, 'the cutoff'],
  ] as const)('seat %s (%s): tight < current < pressure', (seat, _name) => {
    const tight = count(seat, style('tight'));
    const current = count(seat, {});
    const pressure = count(seat, style('pressure'));
    // eslint-disable-next-line no-console
    console.log(
      `[first in, seat ${seat}] entries of ${HANDS.length * SEEDS.length}: tight ${tight}, current ${current}, pressure ${pressure}`
    );
    expect(tight).toBeLessThan(current);
    expect(current).toBeLessThan(pressure);
  });

  it.each([
    [1, 'under the gun'],
    [2, 'the middle seat'],
  ] as const)(
    'seat %s (%s): tight < current, and pressure is current byte for byte',
    (seat, _name) => {
      let tight = 0;
      let current = 0;
      for (const hole of HANDS) {
        const base = play(() => firstIn(seat, { hole, node: noFloor }), {});
        const p = play(() => firstIn(seat, { hole, node: noFloor }), style('pressure'));
        expect(p.bytes).toEqual(base.bytes);
        current += entries(base);
        tight += entries(play(() => firstIn(seat, { hole, node: noFloor }), style('tight')));
      }
      expect(tight).toBeLessThan(current);
    }
  );

  it('a hand the tight style enters first in, the current style enters too', () => {
    for (const seat of [1, 4] as const)
      for (const hole of HANDS) {
        const t = play(() => firstIn(seat, { hole, node: noFloor }), style('tight'));
        const c = play(() => firstIn(seat, { hole, node: noFloor }), {});
        t.actions.forEach((a, i) => {
          if (ENTER.has(a)) expect([hole, ENTER.has(c.actions[i])]).toEqual([hole, true]);
        });
      }
  });

  it('out of position after the flop the pressure style is current byte for byte (decisions 16 and 19 moved off the button)', () => {
    const oop = (pn: ComplaintPublicNode): void => {
      noFloor(pn);
      pn.dealerSeat = 3;
    };
    for (const ord of [16, 19]) {
      const base = play(() => recorded(ord, { node: oop }), {});
      expect(play(() => recorded(ord, { node: oop }), style('pressure')).bytes).toEqual(base.bytes);
    }
  });
});

describe('tight is tight-aggressive: it enters fewer hands and re-raises its strong hands as today', () => {
  const RAISE = new Set(['raise', 'bet', 'all_in']);
  /** Decision 7: the button facing an open to 9 and two callers. */
  const facingOpen = (hole: string) => () => recorded(7, { hole, node: noFloor });

  it('with the bluffs off, every hand the current style re-raises the tight style re-raises too', () => {
    const noBluff = { ...LIVE.mods, bluffFreq: 0 };
    let current = 0;
    let tight = 0;
    for (const hole of HANDS) {
      const c = play(facingOpen(hole), {}, SEEDS, noBluff);
      const t = play(facingOpen(hole), style('tight'), SEEDS, noBluff);
      c.actions.forEach((a, i) => {
        if (RAISE.has(a)) expect([hole, i, RAISE.has(t.actions[i])]).toEqual([hole, i, true]);
      });
      current += c.actions.filter((a) => RAISE.has(a)).length;
      tight += t.actions.filter((a) => RAISE.has(a)).length;
    }
    expect(current).toBeGreaterThan(0);
    expect(tight).toBeGreaterThanOrEqual(current);
  });

  it('with the live profile it calls less, and re-raises a larger share of the hands it plays', () => {
    const tally = (opts: HorseDecideOpts) => {
      let raises = 0;
      let calls = 0;
      for (const hole of HANDS)
        for (const a of play(facingOpen(hole), opts).actions) {
          if (RAISE.has(a)) raises++;
          else if (a === 'call') calls++;
        }
      return { raises, calls };
    };
    const c = tally({});
    const t = tally(style('tight'));
    // eslint-disable-next-line no-console
    console.log(
      `[facing an open, ${HANDS.length * SEEDS.length} decisions] current ${c.raises} re-raises ${c.calls} calls; tight ${t.raises} re-raises ${t.calls} calls`
    );
    expect(t.calls).toBeLessThan(c.calls);
    expect(t.raises / (t.raises + t.calls)).toBeGreaterThan(c.raises / (c.raises + c.calls));
  });
});

describe('the receipts say which style played', () => {
  it('tight and pressure at the unfloored table; the fallback at the floored one', () => {
    expect(styleFires(() => firstIn(4, { node: noFloor }), style('tight'))).toEqual([
      'horse_play_style_tight_seen',
    ]);
    expect(styleFires(() => firstIn(4, { node: noFloor }), style('pressure'))).toEqual([
      'horse_play_style_pressure_seen',
    ]);
    expect(styleFires(() => firstIn(4), style('tight'))).toEqual([
      'horse_play_style_table_fallback_seen',
    ]);
    expect(styleFires(() => firstIn(4), style('pressure'))).toEqual([
      'horse_play_style_pressure_seen',
    ]);
    expect(styleFires(() => firstIn(4, { node: noFloor }), style('current'))).toEqual([]);
    expect(styleFires(() => firstIn(4, { node: noFloor }), {})).toEqual([]);
  });
});

describe('the table rule at the decision', () => {
  const same = (v: Variation, s: HorsePlayStyle): void => {
    for (const seat of [1, 4] as const)
      for (const hole of HANDS.slice(0, 40)) {
        const base = play(() => firstIn(seat, { hole, ...v }), {});
        expect(play(() => firstIn(seat, { hole, ...v }), style(s)).bytes).toEqual(base.bytes);
      }
  };

  it('a table with a VPIP floor (50, and 30): tight plays current byte for byte', () => {
    same({}, 'tight');
    same(
      {
        node: (pn) => {
          pn.vpipFloor = 30;
        },
      },
      'tight'
    );
  });

  it('50 bb effective or less: tight and pressure play current', () => {
    const short = (pn: ComplaintPublicNode): void => {
      noFloor(pn);
      for (const row of pn.seats) if (row[0] === 1 || row[0] === 4) row[1] = 100 - row[2];
    };
    same({ node: short }, 'tight');
    same({ node: short }, 'pressure');
  });

  it('a tournament and Lightning: tight and pressure play current', () => {
    for (const gs of [
      (g: HorseGameStateV2) => {
        g.gameMode = 'tournament';
      },
      (g: HorseGameStateV2) => {
        g.publicMemoryDomain = { speed: 'lightning' } as never;
      },
    ])
      for (const s of ['tight', 'pressure'] as const) same({ node: noFloor, gs }, s);
  });

  it('hi-lo and PLO6 are not mapped: tight and pressure play current', () => {
    for (const variant of ['plo8', 'plo6'])
      for (const s of ['tight', 'pressure'] as const)
        same(
          {
            node: (pn) => {
              noFloor(pn);
              pn.variant = variant;
            },
          },
          s
        );
  });

  it('heads-up is not mapped', () => {
    const hu = (pn: ComplaintPublicNode): void => {
      noFloor(pn);
      pn.seats = pn.seats.filter((r) => r[0] === 4 || r[0] === 6);
    };
    for (const s of ['tight', 'pressure'] as const)
      for (const hole of HANDS.slice(0, 24)) {
        const base = play(() => firstIn(4, { hole, node: hu }), {});
        expect(play(() => firstIn(4, { hole, node: hu }), style(s)).bytes).toEqual(base.bytes);
      }
  });
});

describe('the owner rulings stay final for every style', () => {
  const WEAK = ['Kc9d7h5s3c', 'JcTd6h5s2c', 'Qc8d6h3s2c'];

  it.each(HORSE_PLAY_STYLES)(
    'omahaVpipFloorByLimp, style %s: the entry the floor makes is a limp, never a raise',
    (s) => {
      for (const hole of WEAK) {
        // Without the floor the hand is not played, whatever the style.
        expect(play(() => firstIn(4, { hole, node: noFloor }), { ...style(s) }).actions).toEqual(
          SEEDS.map(() => 'fold')
        );
        const on = play(() => firstIn(4, { hole }), { ...style(s), omahaVpipFloorByLimp: true });
        expect([hole, on.actions]).toEqual([hole, SEEDS.map(() => 'call')]);
        expect(on.fires.every((f) => f.includes('omaha_vpip_floor_limp'))).toBe(true);
      }
    }
  );

  it.each(HORSE_PLAY_STYLES)(
    'omahaNoCallColdFourBetWithoutPremium, style %s: the cold 4-bet is folded without aces or a premium structure',
    (s) => {
      for (const node of [undefined, noFloor]) {
        const on = play(() => recorded(13, { node }), {
          ...style(s),
          omahaNoCallColdFourBetWithoutPremium: true,
        });
        expect(on.actions).toEqual(SEEDS.map(() => 'fold'));
        // The tight style can fold the hand on its own bar before the ruling is asked.
        if (s !== 'tight')
          expect(
            on.fires.every((f) => f.includes('omaha_no_call_cold_four_bet_without_premium'))
          ).toBe(true);
      }
    }
  );
});

// ─── in the league ───────────────────────────────────────────────────────────

describe('in the league', () => {
  const CELLS = (['plo4', 'plo5'] as const).flatMap((variant) =>
    (['dev', 'horse'] as const).map((field) => ({ variant, field }))
  );
  const run = (
    cell: (typeof CELLS)[number],
    a: HorseDecideOpts,
    pairs: number
  ): ReturnType<typeof runMatchup> =>
    runMatchup(
      {
        name: `play_style_${cell.variant}_${cell.field}`,
        variant: cell.variant,
        seats: 6,
        stackBB: 100,
        pairs,
        a,
        b: {},
        ...(cell.field === 'horse'
          ? { productionStyles: true }
          : { opponentPopulation: HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID }),
      } as never,
      pairs,
      5560001
    );

  it('false and the current style play the same poker as unset on all four cells', async () => {
    for (const cell of CELLS)
      for (const a of [{ horsePlayStyles: false }, style('current')]) {
        const r = await run(cell, a, 150);
        expect([cell, r.divergentPairs]).toEqual([cell, 0]);
        expect(r.illegalActions).toBe(0);
      }
  }, 600_000);

  it('tight and pressure: different poker, no illegal action and no fallback', async () => {
    for (const cell of CELLS)
      for (const s of ['tight', 'pressure'] as const) {
        const r = await run(cell, style(s), 150);
        // eslint-disable-next-line no-console
        console.log(
          `[league ${cell.variant} ${cell.field} ${s}] divergent pairs ${r.divergentPairs}`
        );
        // One Horse among five field seats (dev) can go 150 pairs without a
        // pressure spot; three styled seats (horse) cannot.
        if (cell.field === 'horse' || s === 'tight') expect(r.divergentPairs).toBeGreaterThan(0);
        expect(r.illegalActions).toBe(0);
        expect(r.brainExceptionFallbacks).toBe(0);
      }
  }, 600_000);
});
