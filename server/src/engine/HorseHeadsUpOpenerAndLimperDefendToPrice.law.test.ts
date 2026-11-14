/**
 * THE HEADS-UP OPENER AND LIMPER DEFEND TO THEIR PRICE (2026-11-14, heads-up
 * lane, HU-NLH-010 and HU-NLH-011; options huOpenerDefendsToPrice and
 * huLimpDefendsToPrice, both default OFF).
 *
 * Measured by the heads-up audit through the real HorseLogic.decide: the
 * button that opened folds 81-92% of its opens to a 3-bet whose break-even is
 * 62.5-67% (22-66 and A2s-A9s among them), and the small blind that limped
 * folds 99-100% of its limps to any raise, a min-raise included.
 *
 * Each option is a priced fold-to-call correction and nothing else:
 *  - it turns a fold into a call only when the class's equity against the
 *    raiser's range (HorseHuBbDefence), after a realisation discount, covers
 *    the pot odds, so a larger raise is called by fewer hands and a raise
 *    outside the band by none;
 *  - it never adds a raise, changes a size or removes a call;
 *  - it fires only in no-limit hold'em cash with exactly two dealt in: not
 *    blind against blind after a dealt-in button folded, not in a
 *    tournament, not in Omaha or short deck or fixed limit, not against an
 *    all-in raise, not on an all-in-or-fold table or in a straddled pot;
 *  - off, or unset, every decision is the one made today, and each option
 *    leaves the other's spot alone.
 *
 * Every decision here is the real HorseLogic.decide with the live Hybrid
 * persona, over all 169 hand classes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import {
  HU_DEFENCE_REFERENCE_WIDTH_PCT,
  HU_LIMP_REALIZATION,
  HU_OPENER_REALIZATION,
  huBbEquityVsOpener,
  huDefenceWidthPct,
  huLimpRequiredEquity,
  huOpenerRequiredEquity,
} from './HorseHuBbDefence.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
const BB = 2;
type Spot = {
  /** opener: hero opened and was 3-bet. limper: hero limped and was raised. */
  kind: 'opener' | 'limper';
  stackBB: number;
  openBB?: number;
  raiseBB: number;
  mode?: 'cash' | 'tournament';
  buttonFolded?: boolean;
  variant?: string;
  raiserAllIn?: boolean;
  extra?: Record<string, unknown>;
};
function holeFor(cls: string, omaha: boolean): Card[] {
  const suited = cls.length === 3 && cls[2] === 's';
  const h = [
    { rank: cls[0], suit: 'spades' } as Card,
    { rank: cls[1], suit: suited ? 'spades' : 'hearts' } as Card,
  ];
  if (omaha) h.push({ rank: '7', suit: 'diamonds' } as Card, { rank: '2', suit: 'clubs' } as Card);
  return h;
}
/** Seat 1, the hero, is the small blind on the button; seat 2 is the big blind and raised. */
function stateFor(spot: Spot, hole: Card[]) {
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const n = hole.length;
  const raiseTo = spot.raiseBB * BB;
  const heroBet = spot.kind === 'opener' ? (spot.openBB ?? 2.5) * BB : BB;
  const seat = (s: number, bet: number, over: Partial<SeatPlayer> = {}): SeatPlayer =>
    ({
      seat: s,
      user_id: `def-${s}`,
      username: `Def${s}`,
      stack: spot.stackBB * BB - bet,
      bet,
      totalInvested: bet,
      cards: s === 1 ? hole : deck.slice(s * n, s * n + n),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
      ...over,
    }) as SeatPlayer;
  const villainBet = spot.raiserAllIn ? spot.stackBB * BB : raiseTo;
  const players: SeatPlayer[] = [
    seat(1, heroBet),
    seat(2, villainBet, spot.raiserAllIn ? { is_all_in: true, stack: 0 } : {}),
  ];
  const history: ActionRecord[] = [];
  let ts = 100;
  let dealt = [1, 2];
  let dealerSeat = 1;
  const rec = (s: number, action: string, amount: number, full?: boolean) =>
    history.push({
      seat: s,
      userId: `def-${s}`,
      action,
      amount,
      timestamp: ts++,
      stage: 'preflop',
      ...(full ? { isFullRaise: true } : {}),
    } as ActionRecord);
  if (spot.buttonFolded) {
    players.push(seat(3, 0, { is_folded: true }));
    rec(3, 'fold', 0);
    dealt = [1, 2, 3];
    dealerSeat = 3;
  }
  if (spot.kind === 'opener') rec(1, 'raise', heroBet, true);
  else rec(1, 'call', BB);
  rec(2, spot.raiserAllIn ? 'all_in' : 'raise', villainBet, true);
  const mode = spot.mode ?? 'cash';
  const gs = {
    players,
    communityCards: [],
    pot: heroBet + villainBet,
    currentBet: villainBet,
    minRaise: villainBet - heroBet,
    lastRaise: villainBet - heroBet,
    stage: 'preflop',
    gameVariant: spot.variant ?? 'nlh',
    bigBlind: BB,
    dealerSeat,
    actionHistory: history,
    gameMode: mode,
    ante: 0,
    format: mode === 'cash' ? 'cash' : 'mtt',
    dealtSeatIds: dealt,
    ...(spot.extra ?? {}),
  } as unknown as HorseGameStateV2;
  return { hero: players[0], gs };
}
/** The action of every one of the 169 classes, through the real HorseLogic.decide. */
function sweep(spot: Spot, opts: Record<string, unknown>, mind = false) {
  const hybrid = HORSE_HYBRID_PROFILES[spot.mode === 'tournament' ? 'tournament' : 'cash'];
  const out: Record<string, string> = {};
  for (const h of HAND_CLASSES) {
    const { hero, gs } = stateFor(spot, holeFor(h.cls, (spot.variant ?? 'nlh') !== 'nlh'));
    seedFastRandom(7 + h.cls.charCodeAt(0) * 31 + h.cls.charCodeAt(1));
    out[h.cls] = HorseLogic.decide(
      hero,
      gs,
      hybrid.style,
      { ...hybrid.mods },
      {
        mind,
        decisionTimeMs: Date.UTC(2026, 10, 14, 12, 0, 0),
        ...opts,
      }
    ).action;
  }
  return out;
}
const OPENER = { huOpenerDefendsToPrice: true };
const LIMPER = { huLimpDefendsToPrice: true };
const opener = (over: Partial<Spot> = {}): Spot => ({
  kind: 'opener',
  stackBB: 40,
  openBB: 2.5,
  raiseBB: 8,
  ...over,
});
const limper = (over: Partial<Spot> = {}): Spot => ({
  kind: 'limper',
  stackBB: 40,
  raiseBB: 2,
  ...over,
});

/** What the option changes in a spot: the classes, and each change as off>on. */
function changes(spot: Spot, on: Record<string, unknown>, mind = false) {
  const withOn = sweep(spot, on, mind);
  const withOff = sweep(spot, {}, mind);
  const classes = Object.keys(withOn).filter((k) => withOn[k] !== withOff[k]);
  return {
    classes,
    kinds: [...new Set(classes.map((k) => `${withOff[k]}>${withOn[k]}`))],
    off: withOff,
    on: withOn,
  };
}

/** Spots neither option may touch, for each kind of spot. */
const OUT_OF_SCOPE: readonly [string, Partial<Spot>][] = [
  ['blind against blind after a dealt-in button folded', { buttonFolded: true }],
  ['a tournament', { mode: 'tournament' }],
  ['four-card Omaha', { variant: 'plo4' }],
  ['short deck', { variant: 'short_deck' }],
  ['fixed limit', { variant: 'flh' }],
  ['an all-in raise', { raiserAllIn: true }],
  ['an all-in-or-fold table', { extra: { allInOrFold: true } }],
  ['a straddled pot', { extra: { straddleActive: true } }],
  ['a bomb pot', { extra: { bombPot: true } }],
  ['a stack under 20bb', { stackBB: 15 }],
  ['a stack over 150bb', { stackBB: 200 }],
];

describe('huOpenerDefendsToPrice: the heads-up opener facing a 3-bet', () => {
  it('today the opener folds pairs and suited aces to a 3-bet of 2.5bb to 8bb', () => {
    const off = sweep(opener(), {});
    for (const cls of ['22', '55', '66', 'A2s', 'A5s', 'A9s']) expect(off[cls], cls).toBe('fold');
    const folds = Object.values(off).filter((a) => a === 'fold').length;
    expect(folds).toBeGreaterThanOrEqual(140);
  });

  it('on, those hands call, and every change is a fold that became a call', () => {
    const c = changes(opener(), OPENER);
    expect(c.kinds).toEqual(['fold>call']);
    expect(c.classes.length).toBeGreaterThanOrEqual(10);
    for (const cls of ['22', '55', '66', 'A2s', 'A5s', 'A9s']) expect(c.on[cls], cls).toBe('call');
    // A hand the price does not support is still folded.
    for (const cls of ['72o', '83o', '94o', 'T2o']) expect(c.on[cls], cls).toBe('fold');
  });

  it('every hand it calls has the equity the price asks for, read at the reference width', () => {
    const c = changes(opener(), OPENER);
    // 5.5bb to call into 10.5bb: 0.344 before rake, so 0.404 or a little more after realisation.
    const need = huOpenerRequiredEquity(5.5 / 16);
    for (const cls of c.classes) {
      const eq = huBbEquityVsOpener(cls, HU_DEFENCE_REFERENCE_WIDTH_PCT)!;
      expect(eq, cls).toBeGreaterThanOrEqual(need);
    }
  });

  it('the price decides: a larger 3-bet is called by no more hands, one outside the band by none', () => {
    const small = changes(opener({ openBB: 2, raiseBB: 6 }), OPENER).classes.length;
    const mid = changes(opener({ raiseBB: 8 }), OPENER).classes.length;
    const large = changes(opener({ raiseBB: 12 }), OPENER).classes.length;
    expect(small).toBeGreaterThanOrEqual(mid);
    expect(mid).toBeGreaterThanOrEqual(large);
    expect(mid).toBeGreaterThan(0);
    expect(changes(opener({ raiseBB: 20 }), OPENER).classes).toEqual([]);
  });

  it('fires at 25bb and 100bb, with the reads on as well as off', () => {
    expect(changes(opener({ stackBB: 25 }), OPENER).kinds).toEqual(['fold>call']);
    expect(changes(opener({ stackBB: 100, openBB: 3, raiseBB: 9 }), OPENER).kinds).toEqual([
      'fold>call',
    ]);
    expect(changes(opener(), OPENER, true).kinds).toEqual(['fold>call']);
  });

  it.each(OUT_OF_SCOPE)('does not fire in %s', (_name, over) => {
    expect(changes(opener(over), OPENER).classes).toEqual([]);
  });
});

describe('huLimpDefendsToPrice: the heads-up small blind that limped and was raised', () => {
  it('today almost nothing that would limp calls a min-raise laying three to one', () => {
    const off = sweep(limper(), {});
    for (const cls of ['T7s', '96s', '98o', 'J7o', 'Q6o']) expect(off[cls], cls).toBe('fold');
  });

  it('on, those hands call the min-raise, and every change is a fold that became a call', () => {
    const c = changes(limper(), LIMPER);
    expect(c.kinds).toEqual(['fold>call']);
    expect(c.classes.length).toBeGreaterThanOrEqual(50);
    for (const cls of ['T7s', '96s', '98o', 'J7o', 'Q6o']) expect(c.on[cls], cls).toBe('call');
    for (const cls of ['72o', '32o', '82o']) expect(c.on[cls], cls).toBe('fold');
  });

  it('every hand it calls has the equity the price asks for, read at the reference width', () => {
    const c = changes(limper(), LIMPER);
    // 1bb to call into 3bb: 0.25 before rake, so 0.3125 or a little more after realisation.
    const need = huLimpRequiredEquity(1 / 4);
    for (const cls of c.classes) {
      const eq = huBbEquityVsOpener(cls, HU_DEFENCE_REFERENCE_WIDTH_PCT)!;
      expect(eq, cls).toBeGreaterThanOrEqual(need);
    }
  });

  it('the price decides: a larger raise is called by fewer hands, one above 6bb by none', () => {
    const counts = [2, 2.5, 3, 4].map(
      (r) => changes(limper({ raiseBB: r }), LIMPER).classes.length
    );
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThan(counts[i - 1]);
    expect(changes(limper({ raiseBB: 6.5 }), LIMPER).classes).toEqual([]);
  });

  it('fires at 25bb and 100bb, with the reads on as well as off', () => {
    expect(changes(limper({ stackBB: 25 }), LIMPER).kinds).toEqual(['fold>call']);
    expect(changes(limper({ stackBB: 100 }), LIMPER).kinds).toEqual(['fold>call']);
    expect(changes(limper(), LIMPER, true).kinds).toEqual(['fold>call']);
  });

  it.each(OUT_OF_SCOPE)('does not fire in %s', (_name, over) => {
    expect(changes(limper(over), LIMPER).classes).toEqual([]);
  });
});

describe('off, both options change nothing, and each leaves the other spot alone', () => {
  const spots: readonly Spot[] = [
    opener(),
    opener({ stackBB: 25, openBB: 2, raiseBB: 6 }),
    limper(),
    limper({ raiseBB: 3 }),
  ];

  it('explicit false is the same decision as unset, for every class in every spot', () => {
    for (const spot of spots) {
      expect(sweep(spot, { huOpenerDefendsToPrice: false, huLimpDefendsToPrice: false })).toEqual(
        sweep(spot, {})
      );
    }
  });

  it('the opener option does nothing to a raised limp, the limper option nothing to a 3-bet open', () => {
    expect(changes(limper(), OPENER).classes).toEqual([]);
    expect(changes(limper({ raiseBB: 3 }), OPENER).classes).toEqual([]);
    expect(changes(opener(), LIMPER).classes).toEqual([]);
    expect(changes(opener({ stackBB: 25, openBB: 2, raiseBB: 6 }), LIMPER).classes).toEqual([]);
  });

  it('the brain reads each option in one place, and only an explicit true passes', () => {
    const src = readFileSync(fileURLToPath(new URL('./HorseLogic.ts', import.meta.url)), 'utf8');
    for (const key of ['huOpenerDefendsToPrice', 'huLimpDefendsToPrice']) {
      const reads = src.match(new RegExp(`opts\\.${key}\\b[^\\n]*`, 'g')) ?? [];
      expect(reads.length, key).toBe(1);
      expect(reads[0], key).toContain(`opts.${key} === true`);
    }
  });
});

describe('the width the price is read against', () => {
  it('is the 20% reference with no read, and never a column the table lacks', () => {
    expect(HU_DEFENCE_REFERENCE_WIDTH_PCT).toBe(20);
    expect(huDefenceWidthPct(null, true)).toBe(20);
    expect(huDefenceWidthPct(null, false)).toBe(20);
    // A read narrower than the narrowest column: the rule stands aside.
    expect(huDefenceWidthPct(0.08, true)).toBeNull();
    expect(huDefenceWidthPct(0.08, false)).toBeNull();
    expect(huDefenceWidthPct(Number.NaN, true)).toBeNull();
  });

  it('follows a wider read only where the read measures the raise being faced', () => {
    expect(huDefenceWidthPct(0.5, true)).toBe(50);
    expect(huDefenceWidthPct(1, true)).toBe(100);
    expect(huDefenceWidthPct(0.5, false)).toBe(20);
    expect(huDefenceWidthPct(1, false)).toBe(20);
  });

  it('pays for realisation: both discounts are below one', () => {
    expect(HU_OPENER_REALIZATION).toBeLessThan(1);
    expect(HU_LIMP_REALIZATION).toBeLessThan(1);
    expect(huOpenerRequiredEquity(0.34)).toBeGreaterThan(0.34);
    expect(huLimpRequiredEquity(0.25)).toBeGreaterThan(0.25);
  });
});
