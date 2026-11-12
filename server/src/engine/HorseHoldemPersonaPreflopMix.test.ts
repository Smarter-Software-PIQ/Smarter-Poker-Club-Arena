/**
 * PARTIAL wiring: the Hold'em persona reaches two V87 preflop limp mixes
 * (2026-11-12): the early-position premium trap and the suited-connector
 * limp-reraise bluff. The early suited-connector open-limp is withheld (its
 * scaled rate measured outside the approved 20% in play) and is pinned here
 * to its base behaviour. This does not make the persona requirement complete: nothing
 * here gives archetypes distinct VPIP bands or persona-specific ordinary
 * 3-bets. `nlh3BetMix` is documented for 3-bets, squeezes and reshoves; only
 * the suited-connector limp-reraise bluff reads it.
 *
 * Before this change `HorseHoldemPersona.epLimpTrapMix` and `nlh3BetMix` had
 * no reader outside tests, and the V87 preflop mix seed carried no Horse
 * identity. These tests run the real preflop decision function
 * (`decidePreflopV7`) and the real brain (`HorseLogic.decide`).
 *
 * The 1,000 ids used here are SYNTHETIC, UUID-shaped ids. They are not the
 * fleet's ids, which no test reads. What is proved is behaviour under equal
 * opportunity: every id is given the same states and hands. Whether the
 * approved rates hold when Horses meet opportunities at different rates in
 * play is a measurement, not a test (see the changelog).
 *
 * Deterministic throughout: the mixes consume no PRNG draw.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, HandStage, SeatPlayer } from '../types.js';
import * as preflopModule from './HorsePreflop.js';
import { decidePreflopV7, type PreflopAuthorityEvent, type PreflopCtx } from './HorsePreflop.js';
import {
  HOLDEM_ARCHETYPE_PREFLOP_MIX,
  HOLDEM_HASH_MODEL_MEAN_EP_LIMP_TRAP_MIX,
  HOLDEM_HASH_MODEL_MEAN_NLH_3BET_MIX,
  holdemPersonaFor,
  holdemPreflopPersonaMix,
  personaHash,
  type HorseHoldemArchetype,
} from './HorsePersona.js';
import { HorseLogic } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';

// Realised mean scales on the 1,000 synthetic ids (hash-model expectation 1).
const REALISED_MEAN_EP_SCALE = 0.98735;
const REALISED_MEAN_3BET_SCALE = 1.00332;
// Equal-opportunity sampling tolerance for (b). Each id plays 8 states x 18
// or 24 combos on a stratified lattice, so an archetype mean over 150 to 400
// ids resolves to a few parts in ten thousand: the largest deviation measured
// when this was written was 0.0007. 0.0015 is about twice that, under 1% of
// the smallest probability tested.
const POOLED_TOL = 0.0015;
const PINNED_TWINS = {
  ids: ['00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000047'],
  state: 0,
  hand: 7,
};
// Brain decisions (action:amount) recorded on base 4850f8534527, hero UTG at
// a nine-seat 1/2 table, 100bb, seed 20261112. See describe (g).
const RECORDED_BRAIN = {
  v87Off: [
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
  ].join('|'),
  plo: ['raise:6', 'raise:6', 'fold:'].join('|'),
  emptyId: [
    'call:2',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'call:2',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'call:2',
    'raise:8',
    'raise:8',
    'raise:8',
    'call:2',
    'raise:8',
    'raise:8',
    'raise:8',
    'call:2',
    'raise:8',
    'raise:8',
    'raise:8',
    'call:2',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'raise:8',
    'call:2',
    'raise:8',
    'raise:8',
    'raise:8',
    'call:2',
    'raise:8',
  ].join('|'),
};

const SUITS: Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];
const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const ARCHETYPES: HorseHoldemArchetype[] = [
  'lag_shark',
  'tricky_trap',
  'tag_crusher',
  'nit_hunter',
];

const BIG_PAIRS: [Card, Card][] = [];
for (const r of ['Q', 'K', 'A'] as const) {
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++) BIG_PAIRS.push([card(r, SUITS[i]), card(r, SUITS[j])]);
}
const SUITED_CONNECTORS: [Card, Card][] = [];
for (const [hi, lo] of [
  ['5', '4'],
  ['6', '5'],
  ['7', '6'],
  ['8', '7'],
  ['9', '8'],
  ['T', '9'],
] as const) {
  for (const s of SUITS) SUITED_CONNECTORS.push([card(hi, s), card(lo, s)]);
}

/** 1,000 synthetic UUID-shaped ids (not the fleet's ids). */
const SYNTHETIC_IDS: string[] = Array.from(
  { length: 1000 },
  (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
);
const IDS_BY_ARCHETYPE = Object.fromEntries(
  ARCHETYPES.map((a) => [a, SYNTHETIC_IDS.filter((id) => holdemPersonaFor(id).archetype === a)])
) as Record<HorseHoldemArchetype, string[]>;

/** 40 distinct eligible public states: UTG and UTG+1, five dealer seats, four stack depths. */
const STATES: Partial<PreflopCtx>[] = [];
for (const heroSeat of [3, 4]) {
  for (const dealerSeat of [9, 8, 7, 6, 5]) {
    for (const stackBB of [100, 117.5, 142, 180.25]) {
      STATES.push({ heroSeat, dealerSeat, stack: stackBB * 2, stackBB, effectiveStackBB: stackBB });
    }
  }
}
const EIGHT_STATES = STATES.filter((_, i) => i % 5 === 0);

function baseEpCtx(holeCards: [Card, Card], over: Partial<PreflopCtx> = {}): PreflopCtx {
  return {
    strength: 0.96,
    position: 'early',
    raiserPosition: null,
    raises: 0,
    limpers: 0,
    callers: 0,
    oppsLeft: 8,
    tableSize: 9,
    toCall: 2,
    currentBet: 2,
    pot: 3,
    bigBlind: 2,
    stack: 200,
    stackBB: 100,
    effectiveStackBB: 100,
    tightness: 1,
    bluffFreq: 0.35,
    aggression: 1,
    slowplayFreq: 0.2,
    sizingMultiplier: 1,
    isOmaha: false,
    isPotLimit: false,
    riskAdd: 0,
    mode: 'cash',
    cashActionSizes: true,
    holeCards,
    heroSeat: 3,
    dealerSeat: 9,
    rand: () => 0.5,
    ...over,
  };
}

const FACING_ISO: Partial<PreflopCtx> = {
  raises: 1,
  raiserPosition: 'late',
  currentBet: 9,
  toCall: 7,
  pot: 14,
  heroPreviouslyActed: true,
  heroWasInitialRaiser: false,
};

/** The context field the brain fills from the Horse's id. */
const identity = (horseId: string | null): Partial<PreflopCtx> =>
  horseId === null ? {} : { holdemPersonaMix: holdemPreflopPersonaMix(horseId) };

type Branch = PreflopAuthorityEvent['branch'];

function branchRate(
  horseId: string | null,
  hands: [Card, Card][],
  branch: Branch,
  over: Partial<PreflopCtx>,
  states: Partial<PreflopCtx>[] = STATES
): number {
  let hit = 0;
  let n = 0;
  for (const st of states) {
    for (const h of hands) {
      const events: PreflopAuthorityEvent[] = [];
      decidePreflopV7(
        baseEpCtx(h, { ...st, ...over, ...identity(horseId), noteAuthority: (e) => events.push(e) })
      );
      n++;
      if (events.some((e) => e.branch === branch)) hit++;
    }
  }
  return hit / n;
}

const MIXES = {
  trap: {
    p0: 3 / 18,
    axis: 'epLimpTrapMix',
    mean: HOLDEM_HASH_MODEL_MEAN_EP_LIMP_TRAP_MIX,
    rate: (id: string | null, states?: Partial<PreflopCtx>[]) =>
      branchRate(id, BIG_PAIRS, 'v87_ep_limp_trap', {}, states),
  },
  connector: {
    p0: 0.2,
    axis: 'epLimpTrapMix',
    mean: HOLDEM_HASH_MODEL_MEAN_EP_LIMP_TRAP_MIX,
    rate: (id: string | null, states?: Partial<PreflopCtx>[]) =>
      branchRate(id, SUITED_CONNECTORS, 'v87_ep_limp_suited_connector', { strength: 0.64 }, states),
  },
  rebluff: {
    p0: 0.22,
    axis: 'nlh3BetMix',
    mean: HOLDEM_HASH_MODEL_MEAN_NLH_3BET_MIX,
    rate: (id: string | null, states?: Partial<PreflopCtx>[]) =>
      branchRate(
        id,
        SUITED_CONNECTORS,
        'v87_ep_limp_reraise_bluff',
        { strength: 0.64, ...FACING_ISO },
        states
      ),
  },
} as const;
type MixName = keyof typeof MIXES;

/** The synthetic id with the highest / lowest value of an axis inside an archetype. */
function extreme(
  archetype: HorseHoldemArchetype,
  axis: 'epLimpTrapMix' | 'nlh3BetMix',
  pick: 'max' | 'min'
): string {
  return IDS_BY_ARCHETYPE[archetype].reduce((best, id) => {
    const a = holdemPersonaFor(id)[axis];
    const b = holdemPersonaFor(best)[axis];
    return (pick === 'max' ? a > b : a < b) ? id : best;
  });
}

function decide(over: Partial<PreflopCtx>, h: [Card, Card]): string {
  const events: PreflopAuthorityEvent[] = [];
  const res = decidePreflopV7(baseEpCtx(h, { ...over, noteAuthority: (e) => events.push(e) }));
  return `${res.a}:${res.to === undefined ? '' : res.to.toFixed(4)}:${events.map((e) => e.branch).join(',')}`;
}

function decisionFingerprint(over: Partial<PreflopCtx>, hands: [Card, Card][]): string {
  const out: string[] = [];
  for (const st of STATES) for (const h of hands) out.push(decide({ ...st, ...over }, h));
  return out.join('|');
}

describe('the hash-model mean constants are derived from the persona constants', () => {
  it('equals the exact expectation of each axis over the 25/20/40/15 split and the 1,000 equally likely hash buckets', () => {
    const table = HOLDEM_ARCHETYPE_PREFLOP_MIX;
    expect(Object.values(table).reduce((s, a) => s + a.sharePct, 0)).toBe(100);
    const mean = (pick: (a: (typeof table)[keyof typeof table]) => [number, number]): number => {
      let total = 0;
      for (const a of Object.values(table)) {
        const [b, span] = pick(a);
        let s = 0;
        for (let k = 0; k < 1000; k++) s += Math.round((b + (k / 1000) * span) * 100) / 100;
        total += (a.sharePct / 100) * (s / 1000);
      }
      return total;
    };
    const mEp = mean((a) => [a.limpTrapBase, a.limpTrapSpan]);
    const m3b = mean((a) => [a.threeBetBase, a.threeBetSpan]);
    expect(HOLDEM_HASH_MODEL_MEAN_EP_LIMP_TRAP_MIX).toBeCloseTo(mEp, 12);
    expect(HOLDEM_HASH_MODEL_MEAN_NLH_3BET_MIX).toBeCloseTo(m3b, 12);
    // Pinned values: an unweighted archetype mean (0.1775 / 0.405) or any
    // other wrong constant fails here.
    expect(HOLDEM_HASH_MODEL_MEAN_EP_LIMP_TRAP_MIX).toBeCloseTo(0.176463, 9);
    expect(HOLDEM_HASH_MODEL_MEAN_NLH_3BET_MIX).toBeCloseTo(0.42143, 9);
  });

  it('on the 1,000 synthetic ids the realised split and mean scales are what they are, not exactly the model', () => {
    // Exact counts for this id set (the model says 250 / 200 / 400 / 150).
    expect(ARCHETYPES.map((a) => IDS_BY_ARCHETYPE[a].length)).toEqual([256, 191, 400, 153]);
    let ep = 0;
    let tb = 0;
    for (const id of SYNTHETIC_IDS) {
      const p = holdemPersonaFor(id);
      const mix = holdemPreflopPersonaMix(id);
      expect(mix.epLimpTrapScale).toBe(p.epLimpTrapMix / HOLDEM_HASH_MODEL_MEAN_EP_LIMP_TRAP_MIX);
      expect(mix.threeBetScale).toBe(p.nlh3BetMix / HOLDEM_HASH_MODEL_MEAN_NLH_3BET_MIX);
      expect(mix.identitySeed).toBe(personaHash(`${id}|nlh_preflop_mix`));
      ep += mix.epLimpTrapScale;
      tb += mix.threeBetScale;
    }
    // The scales have expectation 1 under the hash model. On a finite id set
    // the realised mean is near 1, not 1.
    expect(ep / 1000).toBeCloseTo(REALISED_MEAN_EP_SCALE, 4);
    expect(tb / 1000).toBeCloseTo(REALISED_MEAN_3BET_SCALE, 4);
  });
});

describe('the persona table reproduces the personas that shipped before it', () => {
  it('nlh3BetMix and epLimpTrapMix equal the pre-change literal formulas for all 1,000 synthetic ids', () => {
    const OLD: Record<HorseHoldemArchetype, [number, number, number, number]> = {
      lag_shark: [0.46, 0.18, 0.14, 0.08],
      tricky_trap: [0.3, 0.14, 0.2, 0.08],
      tag_crusher: [0.34, 0.16, 0.12, 0.08],
      nit_hunter: [0.22, 0.12, 0.1, 0.06],
    };
    for (const id of SYNTHETIC_IDS) {
      const hArch = personaHash(`${id}|nlh_arch`) % 100;
      const arch: HorseHoldemArchetype =
        hArch < 25
          ? 'lag_shark'
          : hArch < 45
            ? 'tricky_trap'
            : hArch < 85
              ? 'tag_crusher'
              : 'nit_hunter';
      const h1 = (personaHash(`${id}|nlh_3bet`) % 1000) / 1000;
      const h2 = (personaHash(`${id}|nlh_limptrap`) % 1000) / 1000;
      const [b3, s3, bl, sl] = OLD[arch];
      const p = holdemPersonaFor(id);
      expect(p.archetype).toBe(arch);
      expect(p.nlh3BetMix).toBe(Math.round((b3 + h1 * s3) * 100) / 100);
      expect(p.epLimpTrapMix).toBe(Math.round((bl + h2 * sl) * 100) / 100);
    }
  });
});

describe('(a) one Horse takes each mix at its own scaled probability', () => {
  // 40 states x 18 or 24 combos per id. The stratified lattice puts the
  // per-state count within one combo of the probability, so 720 or 960
  // decisions resolve a rate to well under 0.015.
  const TOL = 0.015;
  it.each([
    ['trap', 'tricky_trap', 'max', 'nit_hunter', 'min'],
    ['rebluff', 'lag_shark', 'max', 'nit_hunter', 'min'],
  ] as const)('%s: the %s %s id against the %s %s id', (name, hiArch, hiPick, loArch, loPick) => {
    const mix = MIXES[name];
    const hi = extreme(hiArch, mix.axis, hiPick);
    const lo = extreme(loArch, mix.axis, loPick);
    const pHi = (mix.p0 * holdemPersonaFor(hi)[mix.axis]) / mix.mean;
    const pLo = (mix.p0 * holdemPersonaFor(lo)[mix.axis]) / mix.mean;
    expect(pHi).toBeGreaterThan(pLo + 0.1);
    const rHi = mix.rate(hi);
    const rLo = mix.rate(lo);
    expect(Math.abs(rHi - pHi)).toBeLessThan(TOL);
    expect(Math.abs(rLo - pLo)).toBeLessThan(TOL);
    // Neither is the fixed probability: a scale of exactly 1 fails both.
    expect(Math.abs(rHi - mix.p0)).toBeGreaterThan(0.05);
    expect(Math.abs(rLo - mix.p0)).toBeGreaterThan(0.05);
  });
});

describe('(b) equal-opportunity rates over the 1,000 synthetic ids', () => {
  // Every id gets the same 8 states and the same hands: this is the
  // equal-opportunity model by construction. It cannot show what happens when
  // archetypes meet opportunities at different rates in play.
  const perArchetype = (name: MixName): Record<HorseHoldemArchetype, number> =>
    Object.fromEntries(
      ARCHETYPES.map((a) => [
        a,
        IDS_BY_ARCHETYPE[a].reduce((s, id) => s + MIXES[name].rate(id, EIGHT_STATES), 0) /
          IDS_BY_ARCHETYPE[a].length,
      ])
    ) as Record<HorseHoldemArchetype, number>;
  const pooled = (r: Record<HorseHoldemArchetype, number>): number =>
    ARCHETYPES.reduce((s, a) => s + r[a] * IDS_BY_ARCHETYPE[a].length, 0) / SYNTHETIC_IDS.length;

  it.each([
    ['trap', ['tricky_trap', 'lag_shark', 'tag_crusher', 'nit_hunter'], REALISED_MEAN_EP_SCALE],
    [
      'rebluff',
      ['lag_shark', 'tag_crusher', 'tricky_trap', 'nit_hunter'],
      REALISED_MEAN_3BET_SCALE,
    ],
  ] as const)(
    '%s: archetypes are ordered and separated, and the pooled rate is p0 times the realised mean scale',
    (name, order, realisedScale) => {
      const mix = MIXES[name];
      const r = perArchetype(name);
      // Ordered and separated by more than the tolerance below. With a scale
      // of exactly 1 every archetype reads p0 and all three lines fail.
      for (let i = 0; i + 1 < order.length; i++) {
        expect(r[order[i]], `${order[i]} above ${order[i + 1]}`).toBeGreaterThan(
          r[order[i + 1]] + 0.012
        );
      }
      expect(r[order[0]] - r[order[3]]).toBeGreaterThan(0.08);
      // Each archetype sits at p0 times its own mean axis over the mean.
      for (const a of ARCHETYPES) {
        const ids = IDS_BY_ARCHETYPE[a];
        const expected =
          (mix.p0 * ids.reduce((s, id) => s + holdemPersonaFor(id)[mix.axis], 0)) /
          ids.length /
          mix.mean;
        expect(Math.abs(r[a] - expected), a).toBeLessThan(POOLED_TOL);
      }
      // Pooled over the ids: p0 times the realised mean scale of this id set
      // (not p0 itself), within POOLED_TOL.
      expect(Math.abs(pooled(r) - mix.p0 * realisedScale)).toBeLessThan(POOLED_TOL);
    }
  );
});

describe('(c) with no identity the decisions are exactly the pre-change decisions', () => {
  // Recorded on base 4850f8534527 before any source change: per state, which
  // of the 18 / 24 combos take each branch. One character per combo.
  const mask = (hands: [Card, Card][], branch: Branch, over: Partial<PreflopCtx>): string =>
    STATES.map((st) =>
      hands
        .map((h) => {
          const events: PreflopAuthorityEvent[] = [];
          decidePreflopV7(baseEpCtx(h, { ...st, ...over, noteAuthority: (e) => events.push(e) }));
          return events.some((e) => e.branch === branch) ? '1' : '0';
        })
        .join('')
    ).join('/');

  it('premium trap, connector limp and limp-reraise bluff masks match the recording', () => {
    expect(mask(BIG_PAIRS, 'v87_ep_limp_trap', {})).toBe(RECORDED_TRAP);
    expect(mask(SUITED_CONNECTORS, 'v87_ep_limp_suited_connector', { strength: 0.64 })).toBe(
      RECORDED_CONNECTOR
    );
    expect(
      mask(SUITED_CONNECTORS, 'v87_ep_limp_reraise_bluff', { strength: 0.64, ...FACING_ISO })
    ).toBe(RECORDED_REBLUFF);
  });

  it('exactly 3 of 18 premium combos in every state at the fixed probability', () => {
    expect(MIXES.trap.rate(null)).toBeCloseTo(3 / 18, 10);
  });
});

describe('(c2) the suited-connector open-limp is withheld: identity changes nothing', () => {
  // Its persona scaling measured outside the approved 20% in play, so it
  // ships exactly as on base: fixed 20% on the public-state seed.
  it('with any id, the connector open-limp mask equals the base recording', () => {
    const ids = [
      extreme('tricky_trap', 'epLimpTrapMix', 'max'),
      extreme('nit_hunter', 'epLimpTrapMix', 'min'),
      extreme('lag_shark', 'nlh3BetMix', 'max'),
      ...SYNTHETIC_IDS.slice(0, 20),
    ];
    for (const id of ids) {
      const got = STATES.map((st) =>
        SUITED_CONNECTORS.map((h) =>
          decide({ ...st, strength: 0.64, ...identity(id) }, h).includes(
            'v87_ep_limp_suited_connector'
          )
            ? '1'
            : '0'
        ).join('')
      ).join('/');
      expect(got, id).toBe(RECORDED_CONNECTOR);
    }
  });
});

describe('(d) ineligible cases are untouched by identity', () => {
  const tricky = extreme('tricky_trap', 'epLimpTrapMix', 'max');
  const lag = extreme('lag_shark', 'nlh3BetMix', 'max');
  const LIMP_CASES: [string, Partial<PreflopCtx>][] = [
    ['short stack (40bb cash)', { stack: 80, stackBB: 40, effectiveStackBB: 40 }],
    ['straddled', { straddled: true, straddleActive: true, currentBet: 4, toCall: 4, pot: 7 }],
    ['five seats', { tableSize: 5, oppsLeft: 4 }],
    ['facing a raise', { raises: 1, raiserPosition: 'early', currentBet: 6, toCall: 6, pot: 9 }],
    ['a limper ahead', { limpers: 1, pot: 5 }],
    ['middle position', { position: 'middle' }],
    ['pot-limit Omaha', { isOmaha: true, isPotLimit: true }],
    ['pot-limit hold em', { isPotLimit: true }],
    ['short deck', { isShortDeck: true }],
    ['fixed limit', { isFixedLimit: true }],
    ['V87 off', { v87HoldemOverhaul: false }],
    ['tournament under 35bb', { mode: 'tournament', stack: 60, stackBB: 30, effectiveStackBB: 30 }],
  ];
  it.each(LIMP_CASES)(
    'open-limp branches, %s: every decision equals the no-identity decision',
    (_l, over) => {
      for (const hands of [BIG_PAIRS, SUITED_CONNECTORS]) {
        const strength = hands === BIG_PAIRS ? 0.96 : 0.64;
        const plain = decisionFingerprint({ ...over, strength }, hands);
        for (const id of [tricky, lag]) {
          expect(decisionFingerprint({ ...over, strength, ...identity(id) }, hands)).toBe(plain);
        }
        expect(plain).not.toContain('v87_ep_limp_trap');
        expect(plain).not.toContain('v87_ep_limp_suited_connector');
      }
    }
  );

  const REBLUFF_CASES: [string, Partial<PreflopCtx>][] = [
    ['a confirmed maniac (no bluff)', { maniacNoBluff: true }],
    ['two callers of the iso-raise', { callers: 2 }],
    ['under 45bb effective', { stack: 80, stackBB: 40, effectiveStackBB: 40 }],
    ['under 28bb effective', { stack: 50, stackBB: 25, effectiveStackBB: 25 }],
    ['the raise does not reopen the betting', { reopenAllowed: false }],
    ['the raiser is all in', { raiserIsAllIn: true }],
    ['risk premium at 0.06', { riskAdd: 0.06 }],
    ['an iso-raise above 4.5 big blinds to call', { currentBet: 13, toCall: 11, pot: 18 }],
    ['pot-limit hold em', { isPotLimit: true }],
    ['pot-limit Omaha', { isOmaha: true, isPotLimit: true }],
    ['short deck', { isShortDeck: true }],
    ['fixed limit', { isFixedLimit: true }],
    ['V87 off', { v87HoldemOverhaul: false }],
    ['hero was the initial raiser', { heroWasInitialRaiser: true }],
  ];
  it.each(REBLUFF_CASES)(
    'limp-reraise bluff, %s: every decision equals the no-identity decision',
    (_l, over) => {
      const base = { strength: 0.64, ...FACING_ISO, ...over };
      const plain = decisionFingerprint(base, SUITED_CONNECTORS);
      for (const id of [tricky, lag]) {
        expect(decisionFingerprint({ ...base, ...identity(id) }, SUITED_CONNECTORS)).toBe(plain);
      }
      expect(plain).not.toContain('v87_ep_limp_reraise_bluff');
    }
  );

  it('the same facing-iso state without those blockers does reach the bluff, and identity changes it', () => {
    const base = { strength: 0.64, ...FACING_ISO };
    const plain = decisionFingerprint(base, SUITED_CONNECTORS);
    expect(plain).toContain('v87_ep_limp_reraise_bluff');
    expect(decisionFingerprint({ ...base, ...identity(lag) }, SUITED_CONNECTORS)).not.toBe(plain);
  });
});

describe('(e) the draw is per Horse', () => {
  // Two synthetic ids with the SAME archetype and the SAME epLimpTrapMix
  // (so the same probability), in one state with one hand, pinned: one limps
  // the aces and the other raises them. Only the identity seed separates them.
  it('two ids with equal probability answer differently in a state pinned to differ, and each repeats', () => {
    const [a, b] = PINNED_TWINS.ids;
    const pa = holdemPersonaFor(a);
    const pb = holdemPersonaFor(b);
    expect(pa.archetype).toBe(pb.archetype);
    expect(pa.epLimpTrapMix).toBe(pb.epLimpTrapMix);
    const st = STATES[PINNED_TWINS.state];
    const hand = BIG_PAIRS[PINNED_TWINS.hand];
    const da = decide({ ...st, ...identity(a) }, hand);
    const db = decide({ ...st, ...identity(b) }, hand);
    expect(da).toContain('v87_ep_limp_trap');
    expect(db).not.toContain('v87_ep_limp_trap');
    expect(decide({ ...st, ...identity(a) }, hand)).toBe(da);
    expect(decide({ ...st, ...identity(b) }, hand)).toBe(db);
  });

  it('twelve pairs of ids with identical archetype and epLimpTrapMix all draw differently over 40 states', () => {
    const byAxis = new Map<string, string[]>();
    for (const id of SYNTHETIC_IDS) {
      const p = holdemPersonaFor(id);
      const key = `${p.archetype}|${p.epLimpTrapMix}`;
      byAxis.set(key, [...(byAxis.get(key) ?? []), id]);
    }
    const twins = [...byAxis.values()].filter((ids) => ids.length >= 2).slice(0, 12);
    expect(twins.length).toBe(12);
    for (const [a, b] of twins) {
      expect(decisionFingerprint({ ...identity(a) }, BIG_PAIRS)).not.toBe(
        decisionFingerprint({ ...identity(b) }, BIG_PAIRS)
      );
    }
  });

  it('no identity-seeded id replays the anonymous draw', () => {
    const plain = decisionFingerprint({}, BIG_PAIRS);
    for (const id of SYNTHETIC_IDS.slice(0, 50)) {
      expect(decisionFingerprint({ ...identity(id) }, BIG_PAIRS)).not.toBe(plain);
    }
  });
});

describe('(f) the persona mix consumes no PRNG draw', () => {
  // A counting random source. Where the persona and the anonymous decision
  // end in the same branch and action, the number of draws must be equal:
  // the mix itself draws nothing. Where the persona flips the decision the
  // action differs, and a raise sizes itself with draws a limp does not make;
  // that is the changed action, not the mix, and is not compared.
  const run = (over: Partial<PreflopCtx>, h: [Card, Card]): { sig: string; draws: number } => {
    let draws = 0;
    const events: PreflopAuthorityEvent[] = [];
    const res = decidePreflopV7(
      baseEpCtx(h, {
        ...over,
        rand: () => {
          draws++;
          return 0.5;
        },
        noteAuthority: (e) => events.push(e),
      })
    );
    return { sig: `${res.a}:${events.map((e) => e.branch).join(',')}`, draws };
  };
  it.each([
    ['premium trap', BIG_PAIRS, 'v87_ep_limp_trap', { strength: 0.96 }],
    ['connector limp', SUITED_CONNECTORS, 'v87_ep_limp_suited_connector', { strength: 0.64 }],
    [
      'limp-reraise bluff',
      SUITED_CONNECTORS,
      'v87_ep_limp_reraise_bluff',
      { strength: 0.64, ...FACING_ISO },
    ],
  ] as const)(
    '%s: equal draws wherever the outcome is the same, taken and not taken',
    (_l, hands, branch, over) => {
      const ids = [
        extreme('tricky_trap', 'epLimpTrapMix', 'max'),
        extreme('lag_shark', 'nlh3BetMix', 'max'),
        extreme('nit_hunter', 'epLimpTrapMix', 'min'),
      ];
      let sameTaken = 0;
      let sameNotTaken = 0;
      const takenDraws = new Set<number>();
      for (const st of STATES) {
        for (const h of hands) {
          const anon = run({ ...st, ...over }, h);
          if (anon.sig.includes(branch)) takenDraws.add(anon.draws);
          for (const id of ids) {
            const withId = run({ ...st, ...over, ...identity(id) }, h);
            if (withId.sig.includes(branch)) takenDraws.add(withId.draws);
            if (withId.sig !== anon.sig) continue;
            expect(withId.draws).toBe(anon.draws);
            if (anon.sig.includes(branch)) sameTaken++;
            else sameNotTaken++;
          }
        }
      }
      expect(sameTaken).toBeGreaterThan(20);
      expect(sameNotTaken).toBeGreaterThan(200);
      // Taking the mix costs the same number of draws for every Horse.
      expect(takenDraws.size).toBe(1);
    }
  );
});

describe('(g) the brain attaches the persona mix only for V87 two-card no-limit hold em with an id', () => {
  const CLOCK_MS = Date.UTC(2026, 10, 10, 11, 0, 0);
  const ID = SYNTHETIC_IDS[7];
  afterEach(() => vi.restoreAllMocks());

  function brain(
    variant: 'nlh' | 'plo4',
    heroCards: Card[],
    heroId: string,
    opts: Record<string, unknown>
  ): { ctx: PreflopCtx | undefined; decision: string } {
    const bb = 2;
    const players: SeatPlayer[] = Array.from({ length: 9 }, (_, i) => ({
      seat: i + 1,
      user_id: i + 1 === 3 ? heroId : `opp-seat-${i + 1}`,
      username: `S${i + 1}`,
      stack: 200,
      bet: 0,
      totalInvested: 0,
      cards: i + 1 === 3 ? heroCards : [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    }));
    players[0].bet = 1;
    players[0].stack -= 1;
    players[1].bet = bb;
    players[1].stack -= bb;
    const gs = {
      players,
      communityCards: [],
      pot: 3,
      currentBet: bb,
      minRaise: bb,
      lastRaise: bb,
      stage: 'preflop' as HandStage,
      gameVariant: variant,
      bigBlind: bb,
      smallBlind: 1,
      dealerSeat: 9,
      actionHistory: [],
      gameMode: 'cash',
      format: 'cash',
      ante: 0,
    };
    let seen: PreflopCtx | undefined;
    const real = preflopModule.decidePreflopV7;
    vi.spyOn(preflopModule, 'decidePreflopV7').mockImplementation((ctx) => {
      seen ??= ctx;
      return real(ctx);
    });
    seedFastRandom(20261112);
    const cash = HORSE_HYBRID_PROFILES.cash;
    const dec = HorseLogic.decide(players[2], gs as never, cash.style, { ...cash.mods }, {
      mind: false,
      telemetry: false,
      decisionTimeMs: CLOCK_MS,
      ...opts,
    } as never);
    vi.restoreAllMocks();
    return { ctx: seen, decision: `${dec.action}:${dec.amount ?? ''}` };
  }
  const PLO_HANDS: Card[][] = [
    [card('A', 'spades'), card('A', 'hearts'), card('K', 'spades'), card('K', 'hearts')],
    [card('J', 'clubs'), card('T', 'clubs'), card('9', 'diamonds'), card('8', 'diamonds')],
    [card('7', 'spades'), card('2', 'hearts'), card('9', 'clubs'), card('3', 'diamonds')],
  ];

  it('present, and equal to the persona of that id, for V87-on two-card no-limit hold em', () => {
    for (const h of [BIG_PAIRS[0], BIG_PAIRS[7], SUITED_CONNECTORS[3]]) {
      const { ctx } = brain('nlh', h, ID, {});
      expect(ctx).toBeDefined();
      expect(ctx!.holdemPersonaMix).toEqual(holdemPreflopPersonaMix(ID));
    }
  });

  it('absent with V87 off, and the decisions equal the base recording', () => {
    const got = BIG_PAIRS.map((h) => {
      const { ctx, decision } = brain('nlh', h, ID, { v87HoldemOverhaul: false });
      expect(ctx).toBeDefined();
      expect(ctx!.holdemPersonaMix).toBeUndefined();
      return decision;
    });
    expect(got.join('|')).toBe(RECORDED_BRAIN.v87Off);
  });

  it('absent for pot-limit Omaha, and the decisions equal the base recording', () => {
    const got = PLO_HANDS.map((h) => {
      const { ctx, decision } = brain('plo4', h, ID, {});
      expect(ctx).toBeDefined();
      expect(ctx!.isOmaha).toBe(true);
      expect(ctx!.holdemPersonaMix).toBeUndefined();
      return decision;
    });
    expect(got.join('|')).toBe(RECORDED_BRAIN.plo);
  });

  it('absent with an empty id, and the decisions equal the base recording', () => {
    const got = [...BIG_PAIRS, ...SUITED_CONNECTORS].map((h) => {
      const { ctx, decision } = brain('nlh', h, '', {});
      expect(ctx).toBeDefined();
      expect(ctx!.holdemPersonaMix).toBeUndefined();
      return decision;
    });
    expect(got.join('|')).toBe(RECORDED_BRAIN.emptyId);
  });

  it('with an id the brain can answer differently from the empty-id answer on the same hands', () => {
    // Guards against a gate that never attaches: over 18 premium pairs some
    // id-bearing decision differs from the anonymous one.
    const anon = BIG_PAIRS.map((h) => brain('nlh', h, '', {}).decision);
    const differs = SYNTHETIC_IDS.slice(0, 6).some(
      (id) => BIG_PAIRS.map((h) => brain('nlh', h, id, {}).decision).join('|') !== anon.join('|')
    );
    expect(differs).toBe(true);
  });
});

const RECORDED_TRAP = [
  '100000100000000001',
  '000010000010000010',
  '100000100000000001',
  '000100000100001000',
  '000001000001000001',
  '000100000100000100',
  '001000001000001000',
  '010000010000010000',
  '000001000001000001',
  '001000001000001000',
  '100000100000100000',
  '000010000100000100',
  '001000010000010000',
  '000100001000001000',
  '001000010000010000',
  '000100000100001000',
  '000100001000001000',
  '010000010000010000',
  '100000100000100000',
  '001000001000001000',
  '000100000100000100',
  '000100001000001000',
  '010000010000100000',
  '000010000100000100',
  '000010000010000100',
  '001000001000010000',
  '000100001000001000',
  '000010000010000100',
  '100000000001000001',
  '001000010000010000',
  '010000100000100000',
  '010000010000100000',
  '000100000100001000',
  '000001000010000010',
  '000010000010000010',
  '000100000100000100',
  '000010000100000100',
  '000001000001000001',
  '100000100000100000',
  '100000100000100000',
].join('/');
const RECORDED_CONNECTOR = [
  '000100010001000000100010',
  '100010001000100000000001',
  '010000001000100010001000',
  '001000000100010001000100',
  '000010001000100010001000',
  '000100010001000100000010',
  '001000100010001000100000',
  '001000100000010001000100',
  '010000000000100010001000',
  '010001000000100010001000',
  '010000001000100010001000',
  '010001000100010001000000',
  '000100010000001000100010',
  '000000001000100010001000',
  '000001000100010001000100',
  '000000010001000100010001',
  '010000001000100010001000',
  '100010000000000000010001',
  '000100010001000100000010',
  '000100010000001000100010',
  '000100010000001000100010',
  '100010001000100010000000',
  '010000001000100010001000',
  '100000000001000100010001',
  '001000100010000001000100',
  '001000100010001000100000',
  '001000000100010001000100',
  '000000100010001000100000',
  '000000000001000100010001',
  '000100010000001000100010',
  '100010001000100010000000',
  '000000100010001000100000',
  '100010000000000100010001',
  '000001000100010001000100',
  '010000001000100010001000',
  '010001000100010000000000',
  '000100010001000100000010',
  '000100000010001000100010',
  '000001000100010001000100',
  '010001000100010000001000',
].join('/');
const RECORDED_REBLUFF = [
  '010010001000100010001000',
  '100010001000100010001000',
  '000000100010001000100010',
  '010001000100010001000100',
  '010010001000100010001000',
  '000100000010001000100010',
  '000100010001000100000010',
  '001000100100010001000100',
  '001000100010001001000100',
  '010010001000100010001000',
  '000100010001000100010001',
  '100010001000100000000001',
  '010010001000100010001000',
  '001000100000010001000100',
  '000100000010001000100010',
  '000100010001000100000010',
  '000000100010001000100010',
  '010001000100000010001000',
  '000100000010001000100010',
  '001000100010001000100100',
  '100010001000000000010001',
  '000100010001000000100010',
  '010001000100100010001000',
  '100010001000000000010001',
  '001000100010001000000100',
  '010001000000100010001000',
  '010001000000100010001000',
  '001000000100010001000100',
  '100010001000100010000000',
  '000100010001001000100010',
  '010001000100010000001000',
  '010010001000100010001000',
  '000100010001000100010001',
  '000001000100010001000100',
  '100010000000000100010001',
  '100010000000000100010001',
  '001000100000010001000100',
  '000100000010001000100010',
  '000100010001000100010000',
  '001000100010010001000100',
].join('/');
