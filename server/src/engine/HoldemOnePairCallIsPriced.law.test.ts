/**
 * LAW: THE ONE-PAIR TURN AND RIVER CALLS ARE PRICED WHEN v65TurnOnePairShadeIsPriced, v61RiverOnePairShadeIsPriced OR
 * v63LargeRiverBetShadeIsPriced IS ON, AND NOTHING CHANGES WHEN THEY ARE OFF (2026-11-21, Horse Switch lane; each
 * default OFF, read === true; HorseHoldemOnePairCallIsPriced).
 *
 *  1. The rules: the call is taken when EV(call) beats the fold (a tie folds); which river option prices a call.
 *  2. Off (absent, false, or any value that is not true): every decision and every receipt is what it was, seed for
 *     seed, with the parent shades (V65, V61, V63) on and off.
 *  3. Independent of the parents: on, the result is the same whether the parent is on, off or absent, and the
 *     parent's shade receipt does not fire.
 *  4. It acts, with receipts, and draws nothing: the same spot gives the same priced answer on every seed.
 *  5. It reads the opponent: a measured bettor gets a different answer than the population price.
 *  6. It defers to another rule that already cut the hand's equity (V79 here), and declines a multiway pot: the site
 *     is then exactly as with the option off.
 *  7. v63LargeRiverBetShadeIsPriced prices only above a half-pot river wager.
 *
 * Synthetic spots (no recorded hand, card or identity): 1/2 cash, three seats, button raises to 5, small blind folds,
 * big blind calls; the big blind (the Horse) checks and calls a 5 flop bet, then faces the button's wager on the turn
 * (or on the river after the turn checks through); opponent memory on, the opponent's counters written directly.
 */
import { describe, expect, it } from 'vitest';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import {
  holdemOnePairPricedCalls,
  holdemOnePairPricedRiverKind,
} from './HorseHoldemOnePairCallIsPriced.js';
import type { HoldemPricedVerdict } from './HorseHoldemValueAndCallsArePriced.js';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { seedFastRandom } from './HorseEval.js';
import type { Card } from '../types.js';

const SUIT = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const;
const cards = (text: string): Card[] =>
  (text.match(/.{2}/g) ?? []).map((t) => ({
    rank: (t[0] === 'T' ? '10' : t[0]) as Card['rank'],
    suit: SUIT[t[1] as keyof typeof SUIT],
  }));

const PREFLOP: ComplaintAction[] = [
  { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: 1 },
  { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: 2 },
  { ord: 3, seat: 3, stage: 'preflop', action: 'raise', amount: 5, isFullRaise: true },
  { ord: 4, seat: 1, stage: 'preflop', action: 'fold', amount: 0 },
  { ord: 5, seat: 2, stage: 'preflop', action: 'call', amount: 3 },
];

/** The big blind (the Horse, seat 2) facing the button's wager `bet` on `street`. `multiway`: the small blind's seat
 *  is still live in the snapshot (two live opponents). `stack`: each player's chips behind at the start of the
 *  street (190 deep; 24 puts the river call in the committed branch). */
function facing(
  hole: string,
  board: string,
  street: 'turn' | 'river',
  bet: number,
  multiway = false,
  stack = 190
): ReturnType<typeof stateAt> {
  const after: Omit<ComplaintAction, 'ord'>[] = [
    { seat: 2, stage: 'flop', action: 'check', amount: 0 },
    { seat: 3, stage: 'flop', action: 'bet', amount: 5, isFullRaise: true },
    { seat: 2, stage: 'flop', action: 'call', amount: 5 },
  ];
  if (street === 'river')
    after.push(
      { seat: 2, stage: 'turn', action: 'check', amount: 0 },
      { seat: 3, stage: 'turn', action: 'check', amount: 0 }
    );
  after.push(
    { seat: 2, stage: street, action: 'check', amount: 0 },
    { seat: 3, stage: street, action: 'bet', amount: bet, isFullRaise: true }
  );
  const node = {
    ord: 6 + after.length,
    seat: 2,
    stage: street,
    action: 'call',
    amount: bet,
    origin: 'horse_policy',
    publicNode: {
      pot: 21 + bet,
      ante: 0,
      anteType: 'none',
      mode: 'cash',
      seats: [
        [1, 199, 0, 1, 0, 0, multiway ? 0 : 1],
        [2, stack, 0, 10, 0, 0, 0],
        [3, stack - bet, bet, 10 + bet, 0, 0, 0],
      ],
      boards: [board],
      street,
      toCall: bet,
      currentBet: bet,
      minRaiseTo: 2 * bet,
      maxRaiseTo: stack,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      dealerSeat: 3,
      chipUnit: 1,
      bigBlind: 2,
      smallBlind: 1,
      variant: 'nlh',
      structure: 'no_limit',
      actorSeat: 2,
      bombPot: false,
      allInOrFold: false,
      tournamentStage: null,
    },
  } as unknown as ComplaintAction;
  const hand = {
    handId: 'one-pair-call-priced',
    variant: 'nlh',
    bigBlind: 2,
    smallBlind: 1,
    buttonSeat: 3,
    players: [1, 2, 3].map((seat) => ({ seat, userId: `p${seat}`, isHorse: true })),
    horseHoleCards: { p2: cards(hole) },
    actions: [...PREFLOP, ...after.map((a, i) => ({ ...a, ord: 6 + i })), node],
  } as unknown as ExtractedHand;
  return stateAt(hand, node);
}

const LIVE = replayProfiles('cash')[0];
const SCOPE = readScopeOf('nlh', 3);
type Setup = (() => void) | null;
/** The button measured over 60 spots: bets `betCheckedTo` of 60 checked to him, folds 25 of 60 bets. */
const bettor =
  (betCheckedTo: number): Setup =>
  () => {
    const c: ExploitCounters = freshExploitCounters();
    c.hands = 60;
    c.betCheckedToOpp = 60;
    c.betCheckedTo = betCheckedTo;
    c.foldToBetOpp = 60;
    c.foldToBet = 25;
    (HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> }).exploitCounters.set(
      `${SCOPE}|p3`,
      c
    );
  };
const AGGRESSIVE = bettor(50);
const PASSIVE = bettor(6);

/** Every decision (action and amount) and every receipt, seed by seed. */
function run(
  st: ReturnType<typeof stateAt>,
  opts: Record<string, unknown>,
  setup: Setup,
  seeds = 12
) {
  enableBrainTelemetry();
  const out: { decision: string; receipts: string[] }[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    HorseMind.reset();
    setup?.();
    drainFires();
    seedFastRandom(seed);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...opts,
    } as never);
    out.push({
      decision: `${d.action}:${d.amount ?? ''}`,
      receipts: drainFires()
        .map((f) => `${f.feature}x${f.fires}`)
        .sort(),
    });
  }
  HorseMind.reset();
  return out;
}
const count = (r: ReturnType<typeof run>, receipt: string) =>
  r.filter((x) => x.receipts.some((f) => f.startsWith(`${receipt}x`))).length;
const actions = (r: ReturnType<typeof run>) => r.map((x) => x.decision.split(':')[0]);

const TURN_ON = { v65TurnOnePairShadeIsPriced: true };
const RIVER_ON = { v61RiverOnePairShadeIsPriced: true };
const LARGE_ON = { v63LargeRiverBetShadeIsPriced: true };

/** Spots the price decides (name, state, opponent setup, option on, its parent, receipt it fires, action). */
const PRICED: ReadonlyArray<
  readonly [
    string,
    ReturnType<typeof stateAt>,
    Setup,
    Record<string, boolean>,
    string,
    string,
    string,
  ]
> = [
  [
    'turn: Q9 second pair folds 16 into 21 at the population price',
    facing('Qs9d', 'Kd9h4c2s', 'turn', 16),
    null,
    TURN_ON,
    'v65TurnOnePairShade',
    'holdem_one_pair_priced_turn_fold',
    'fold',
  ],
  [
    'turn: Q9 calls 16 into 21 against a measured heavy bettor',
    facing('Qs9d', 'Kd9h4c2s', 'turn', 16),
    AGGRESSIVE,
    TURN_ON,
    'v65TurnOnePairShade',
    'holdem_one_pair_priced_turn_call',
    'call',
  ],
  [
    'turn: J9 calls 12 into 21 at the population price',
    facing('Jd9c', 'Kd9h4c2s', 'turn', 12),
    null,
    TURN_ON,
    'v65TurnOnePairShade',
    'holdem_one_pair_priced_turn_call',
    'call',
  ],
  [
    'turn: J9 folds 12 into 21 against a measured passive bettor',
    facing('Jd9c', 'Kd9h4c2s', 'turn', 12),
    PASSIVE,
    TURN_ON,
    'v65TurnOnePairShade',
    'holdem_one_pair_priced_turn_fold',
    'fold',
  ],
  [
    'river: Q9 calls 16 into 21 at the population price',
    facing('Qs9d', 'Kd9h4c2s7c', 'river', 16),
    null,
    RIVER_ON,
    'v61RiverOnePairShade',
    'holdem_one_pair_priced_river_call',
    'call',
  ],
  [
    'river: Q4 bottom pair calls 12 into 21 at the population price',
    facing('Qh4d', 'Kd9h4c2s7c', 'river', 12),
    null,
    RIVER_ON,
    'v61RiverOnePairShade',
    'holdem_one_pair_priced_river_call',
    'call',
  ],
  [
    'river, committed branch (24 behind): K8 top pair calls 20 into 21 at the population price',
    facing('Kh8c', 'Kd9h4c2s7c', 'river', 20, false, 24),
    null,
    RIVER_ON,
    'v61RiverOnePairShade',
    'holdem_one_pair_priced_river_call',
    'call',
  ],
  [
    'river large: Q9 calls 16 into 21 (above half pot)',
    facing('Qs9d', 'Kd9h4c2s7c', 'river', 16),
    null,
    LARGE_ON,
    'v63LargeRiverBetShade',
    'holdem_one_pair_priced_river_large_call',
    'call',
  ],
];
const PARENT_RECEIPT: Record<string, string> = {
  v65TurnOnePairShade: 'v65_turn_one_pair_shade',
  v61RiverOnePairShade: 'v61_river_one_pair_shade',
  v63LargeRiverBetShade: 'v63_large_river_bet_shade',
};
/** Every spot used below, for the off law. */
const ALL: ReadonlyArray<readonly [string, ReturnType<typeof stateAt>, Setup]> = [
  ...PRICED.map(([n, st, setup]) => [n, st, setup] as const),
  [
    'river: K8 top pair weak kicker, 30 into 21 (V79 cell)',
    facing('Kh8c', 'Kd9h4c2s7c', 'river', 30),
    null,
  ],
  [
    'river: 98 second pair, 8 into 21 (under half pot)',
    facing('9s8s', 'Kd9h4c2s7c', 'river', 8),
    null,
  ],
  ['turn multiway: Q9 facing 12', facing('Qs9d', 'Kd9h4c2s', 'turn', 12, true), null],
  [
    'turn multiway: Q9 facing 16 (0.76 pot, the V87 deep-dive turn shade)',
    facing('Qs9d', 'Kd9h4c2s', 'turn', 16, true),
    null,
  ],
  ['turn: Q9 on a board-only four-flush facing 12', facing('Qs9c', 'Kd9d4d2d', 'turn', 12), null],
];
const ALL_OPTIONS = [
  'v65TurnOnePairShadeIsPriced',
  'v61RiverOnePairShadeIsPriced',
  'v63LargeRiverBetShadeIsPriced',
] as const;
const PARENTS_OFF = {
  v65TurnOnePairShade: false,
  v61RiverOnePairShade: false,
  v63LargeRiverBetShade: false,
};

describe('1. the rules', () => {
  const v = (options: HoldemPricedVerdict['options']): HoldemPricedVerdict => ({
    options,
    best: options[0],
    equity: 0.3,
  });
  it('calls only when EV(call) beats the fold; a tie folds; no call priced is no answer', () => {
    expect(
      holdemOnePairPricedCalls(
        v([
          { kind: 'fold', to: 0, ev: 0 },
          { kind: 'call', to: 8, ev: 0.5 },
        ])
      )
    ).toBe(true);
    expect(
      holdemOnePairPricedCalls(
        v([
          { kind: 'fold', to: 0, ev: 0 },
          { kind: 'call', to: 8, ev: 0 },
        ])
      )
    ).toBe(false);
    expect(
      holdemOnePairPricedCalls(
        v([
          { kind: 'fold', to: 0, ev: 0 },
          { kind: 'call', to: 8, ev: -3 },
        ])
      )
    ).toBe(false);
    expect(holdemOnePairPricedCalls(v([{ kind: 'check', to: 0, ev: 2 }]))).toBe(null);
  });
  it('the river option: v61 prices every price, v63 only above a half-pot wager, v61 first, only === true', () => {
    expect(holdemOnePairPricedRiverKind({ v61RiverOnePairShadeIsPriced: true }, 4, 30)).toBe(
      'river'
    );
    expect(holdemOnePairPricedRiverKind({ v63LargeRiverBetShadeIsPriced: true }, 4, 30)).toBe(null);
    expect(holdemOnePairPricedRiverKind({ v63LargeRiverBetShadeIsPriced: true }, 10, 30)).toBe(
      null
    ); // r = 1/3
    expect(holdemOnePairPricedRiverKind({ v63LargeRiverBetShadeIsPriced: true }, 16, 37)).toBe(
      'river_large'
    );
    expect(
      holdemOnePairPricedRiverKind(
        { v61RiverOnePairShadeIsPriced: true, v63LargeRiverBetShadeIsPriced: true },
        16,
        37
      )
    ).toBe('river');
    expect(holdemOnePairPricedRiverKind({ v61RiverOnePairShadeIsPriced: 1 }, 16, 37)).toBe(null);
    expect(holdemOnePairPricedRiverKind({ v63LargeRiverBetShadeIsPriced: 'true' }, 16, 37)).toBe(
      null
    );
  });
});

describe('2. off, nothing changes', () => {
  for (const [name, st, setup] of ALL) {
    it(`${name}: absent, false and a non-true value are the same decisions and receipts, parents on and off`, () => {
      for (const parents of [{}, PARENTS_OFF]) {
        const base = run(st, parents, setup);
        for (const opt of ALL_OPTIONS) {
          expect(run(st, { ...parents, [opt]: false }, setup), opt).toEqual(base);
          expect(run(st, { ...parents, [opt]: 1 }, setup), opt).toEqual(base);
        }
        for (const r of base)
          expect(r.receipts.filter((f) => f.startsWith('holdem_one_pair_priced'))).toEqual([]);
      }
    });
  }
});

describe('3. independent of the parent shade', () => {
  for (const [name, st, setup, on, parent] of PRICED) {
    it(`${name}: on, the parent on, off or absent gives the same result, and the parent's receipt does not fire`, () => {
      const alone = run(st, on, setup);
      expect(run(st, { ...on, [parent]: true }, setup)).toEqual(alone);
      expect(run(st, { ...on, [parent]: false }, setup)).toEqual(alone);
      expect(run(st, { ...on, ...PARENTS_OFF }, setup)).toEqual(alone);
      for (const r of alone)
        expect(r.receipts.filter((f) => f.startsWith(`${PARENT_RECEIPT[parent]}x`))).toEqual([]);
    });
  }
});

describe('4. it acts, with receipts, and draws nothing', () => {
  for (const [name, st, setup, on, , receipt, action] of PRICED) {
    it(`${name}: one priced answer on every seed`, () => {
      const r = run(st, on, setup);
      expect(count(r, receipt)).toBe(r.length);
      expect(new Set(actions(r))).toEqual(new Set([action]));
    });
  }
  it('committed branch: a priced call that clears the jam bar keeps the branch continuation (V51 flats it)', () => {
    const r = run(facing('Kh8c', 'Kd9h4c2s7c', 'river', 20, false, 24), RIVER_ON, null);
    expect(count(r, 'v51_river_flat')).toBe(r.length);
  });
  it('it changes a decision the shade makes today: the river Q9 call (16 into 21) folds today on every seed', () => {
    const st = facing('Qs9d', 'Kd9h4c2s7c', 'river', 16);
    expect(new Set(actions(run(st, {}, null)))).toEqual(new Set(['fold']));
    expect(new Set(actions(run(st, RIVER_ON, null)))).toEqual(new Set(['call']));
  });
});

describe('5. it reads the opponent', () => {
  it('turn Q9 facing 16: the population price folds, a measured heavy bettor (50 of 60) is called', () => {
    const st = facing('Qs9d', 'Kd9h4c2s', 'turn', 16);
    expect(new Set(actions(run(st, TURN_ON, null)))).toEqual(new Set(['fold']));
    expect(new Set(actions(run(st, TURN_ON, AGGRESSIVE)))).toEqual(new Set(['call']));
  });
  it('turn J9 facing 12: the population price calls, a measured passive bettor (6 of 60) is folded to', () => {
    const st = facing('Jd9c', 'Kd9h4c2s', 'turn', 12);
    expect(new Set(actions(run(st, TURN_ON, null)))).toEqual(new Set(['call']));
    expect(new Set(actions(run(st, TURN_ON, PASSIVE)))).toEqual(new Set(['fold']));
  });
});

describe('6. it defers to a rule that already cut the equity, and declines a multiway pot', () => {
  const strip = (r: ReturnType<typeof run>, receipt: string) =>
    r.map((x) => ({ ...x, receipts: x.receipts.filter((f) => !f.startsWith(`${receipt}x`)) }));
  it('K8 in the V79 cell: deferred, and otherwise exactly as the option off', () => {
    const st = facing('Kh8c', 'Kd9h4c2s7c', 'river', 30);
    for (const on of [RIVER_ON, LARGE_ON]) {
      const r = run(st, on, null);
      expect(count(r, 'v79_top_pair_weak_kicker')).toBe(r.length);
      expect(count(r, 'holdem_one_pair_priced_deferred')).toBe(r.length);
      expect(strip(r, 'holdem_one_pair_priced_deferred')).toEqual(run(st, {}, null));
    }
  });
  it('two live opponents: never priced (unpriced; deferred or decided earlier on a seed where another rule bit), otherwise exactly as the option off', () => {
    const st = facing('Qs9d', 'Kd9h4c2s', 'turn', 12, true);
    const r = run(st, TURN_ON, null);
    expect(count(r, 'holdem_one_pair_priced_unpriced')).toBeGreaterThan(r.length / 2);
    // never a priced answer (a seed another rule decides first carries no receipt of this option)
    for (const x of r)
      expect(x.receipts.filter((f) => /^holdem_one_pair_priced_turn_/.test(f))).toEqual([]);
    expect(
      strip(strip(r, 'holdem_one_pair_priced_unpriced'), 'holdem_one_pair_priced_deferred')
    ).toEqual(run(st, {}, null));
  });
});

describe('7. v63LargeRiverBetShadeIsPriced prices only above a half-pot wager', () => {
  it('98 facing 8 into 21 (r = 0.28): nothing priced, the same as off', () => {
    const st = facing('9s8s', 'Kd9h4c2s7c', 'river', 8);
    expect(run(st, LARGE_ON, null)).toEqual(run(st, {}, null));
  });
  it('with v61RiverOnePairShadeIsPriced also on, v61 prices the call', () => {
    const st = facing('Qs9d', 'Kd9h4c2s7c', 'river', 16);
    const r = run(st, { ...RIVER_ON, ...LARGE_ON }, null);
    expect(count(r, 'holdem_one_pair_priced_river_call')).toBe(r.length);
    expect(count(r, 'holdem_one_pair_priced_river_large_call')).toBe(0);
  });
});

describe('8. the V87 deep-dive turn shade (v87DeepDiveDiscipline, owner-held) is untouched', () => {
  const strip = (r: ReturnType<typeof run>) =>
    r.map((x) => ({
      ...x,
      receipts: x.receipts.filter((f) => !f.startsWith('holdem_one_pair_priced')),
    }));
  it('where the deep-dive shade decides today (a 0.76-pot multiway turn barrel), the priced option on changes no decision and no receipt, V65 on or off', () => {
    const st = facing('Qs9d', 'Kd9h4c2s', 'turn', 16, true);
    const today = run(st, {}, null);
    expect(count(today, 'v87_deep_dive_discipline')).toBe(today.length);
    for (const parents of [{}, { v65TurnOnePairShade: false }, { v87DeepDiveDiscipline: false }]) {
      const on = run(st, { ...parents, ...TURN_ON }, null);
      expect(strip(on)).toEqual(run(st, parents, null));
      expect(count(on, 'holdem_one_pair_priced_deferred')).toBe(
        'v87DeepDiveDiscipline' in parents ? 0 : on.length
      );
    }
  });
});

describe('9. independent of v69TurnCallGaps: the draw exemption is the hole-card draw', () => {
  it('Q9 on a board-only four-flush is priced the same with V69 on or off', () => {
    const st = facing('Qs9c', 'Kd9d4d2d', 'turn', 12);
    const decided = (r: ReturnType<typeof run>) =>
      r.map((x) => ({
        decision: x.decision,
        priced: x.receipts.filter((f) => f.startsWith('holdem_one_pair_priced')),
      }));
    const on = run(st, TURN_ON, null);
    expect(
      count(on, 'holdem_one_pair_priced_turn_call') + count(on, 'holdem_one_pair_priced_turn_fold')
    ).toBe(on.length);
    expect(decided(run(st, { ...TURN_ON, v69TurnCallGaps: false }, null))).toEqual(decided(on));
  });
});
