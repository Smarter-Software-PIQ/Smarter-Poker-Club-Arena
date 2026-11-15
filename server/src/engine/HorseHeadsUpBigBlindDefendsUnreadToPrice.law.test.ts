/**
 * THE HEADS-UP BIG BLIND DEFENDS TO ITS PRICE AGAINST AN UNREAD OPENER
 * (2026-11-15, heads-up lane round 2, HU-NLH-001d; option
 * huBbDefendsUnreadToPrice, default OFF).
 *
 * Measured by the heads-up audit through the real HorseLogic.decide: the
 * heads-up big blind folds about 58.7% to every open at 15-50bb when it has no
 * read on the opener. The earlier option huBbDefendsToPrice was not supported
 * by its declared evaluation (HU-NLH-001c); its value was a no-read value and
 * its 0.8 realisation was too high for the hands it added.
 *
 * This option is a priced fold-to-call correction and nothing else:
 *  - it turns a fold into a call only when the class's equity against the
 *    heads-up reference open width, at a 0.7 realisation, covers the pot
 *    odds, so a larger open is called by fewer hands and one above 6bb by none;
 *  - it never adds a raise, changes a size or removes a call;
 *  - it acts only while the opener has no engaged read: an engaged read
 *    leaves today's answer;
 *  - it acts only at 20-50bb effective, in no-limit hold'em with exactly two
 *    dealt in: cash, or a tournament whose trusted context says exactly two
 *    players are left in the event and that is not a satellite;
 *  - its receipt counts only a call that is still the final decision;
 *  - off, or unset, every decision is the one made today.
 *
 * Every decision here is the real HorseLogic.decide with the live Hybrid
 * persona, over all 169 hand classes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { HAND_CLASSES, OPEN_TARGET_HU } from './HorseGtoOpeningRanges.js';
import {
  HU_BB_UNREAD_MAX_STACK_BB,
  HU_BB_UNREAD_REALIZATION,
  huBbEquityVsOpener,
  huBbUnreadRequiredEquity,
} from './HorseHuBbDefence.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import { HorseMind } from './HorseMind.js';
import {
  freshExploitCounters,
  opponentExploitRead,
  openerRangeWidth,
} from './HorseOpponentExploit.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
const BB = 2;
type Spot = {
  stackBB: number;
  openBB: number;
  mode?: 'cash' | 'tournament';
  /** Tournament context; absent in a tournament = no context. */
  tournament?: Record<string, unknown>;
  buttonFolded?: boolean;
  variant?: string;
  openerAllIn?: boolean;
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
/** Two left in the event, trusted: the payout is linear in chips. */
const TWO_LEFT = {
  schemaVersion: 1,
  contextStatus: 'complete',
  contextIssues: [],
  playersLeft: 2,
  spotsPaid: 2,
  entrants: 2,
  inMoney: true,
  nearBubble: false,
  payoutPct: [65, 35],
  seatsPerTable: 2,
  currentSmallBlind: 1,
  currentBigBlind: BB,
  currentAnte: 0,
};
/** Seat 1 is the button and small blind and opened; seat 2, the hero, is the big blind. */
function stateFor(spot: Spot, hole: Card[]) {
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const n = hole.length;
  const openTo = spot.openerAllIn ? spot.stackBB * BB : spot.openBB * BB;
  const seat = (s: number, bet: number, over: Partial<SeatPlayer> = {}): SeatPlayer =>
    ({
      seat: s,
      user_id: `bbu-${s}`,
      username: `Bbu${s}`,
      stack: spot.stackBB * BB - bet,
      bet,
      totalInvested: bet,
      cards: s === 2 ? hole : deck.slice(s * n, s * n + n),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
      ...over,
    }) as SeatPlayer;
  const players: SeatPlayer[] = [
    seat(1, openTo, spot.openerAllIn ? { is_all_in: true, stack: 0 } : {}),
    seat(2, BB),
  ];
  const history: ActionRecord[] = [];
  let ts = 100;
  let dealt = [1, 2];
  let dealerSeat = 1;
  const rec = (s: number, action: string, amount: number, full?: boolean) =>
    history.push({
      seat: s,
      userId: `bbu-${s}`,
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
  rec(1, spot.openerAllIn ? 'all_in' : 'raise', openTo, true);
  const mode = spot.mode ?? 'cash';
  const gs = {
    players,
    communityCards: [],
    pot: openTo + BB,
    currentBet: openTo,
    minRaise: openTo - BB,
    lastRaise: openTo - BB,
    stage: 'preflop',
    gameVariant: spot.variant ?? 'nlh',
    bigBlind: BB,
    dealerSeat,
    actionHistory: history,
    gameMode: mode,
    ante: 0,
    format: mode === 'cash' ? 'cash' : 'hu_sng',
    dealtSeatIds: dealt,
    ...(mode === 'tournament' && spot.tournament ? { tournament: spot.tournament } : {}),
    ...(spot.extra ?? {}),
  } as unknown as HorseGameStateV2;
  return { hero: players[1], gs };
}
/** The action of every one of the 169 classes, through the real HorseLogic.decide. */
function sweep(spot: Spot, opts: Record<string, unknown>, mind = false) {
  const hybrid = HORSE_HYBRID_PROFILES[spot.mode === 'tournament' ? 'tournament' : 'cash'];
  const out: Record<string, string> = {};
  for (const h of HAND_CLASSES) {
    const { hero, gs } = stateFor(spot, holeFor(h.cls, (spot.variant ?? 'nlh') !== 'nlh'));
    seedFastRandom(11 + h.cls.charCodeAt(0) * 31 + h.cls.charCodeAt(1));
    out[h.cls] = HorseLogic.decide(
      hero,
      gs,
      hybrid.style,
      { ...hybrid.mods },
      {
        mind,
        decisionTimeMs: Date.UTC(2026, 10, 15, 12, 0, 0),
        ...opts,
      }
    ).action;
  }
  return out;
}
const ON = { huBbDefendsUnreadToPrice: true };
const spot = (over: Partial<Spot> = {}): Spot => ({ stackBB: 40, openBB: 2, ...over });
const twoLeft = (over: Partial<Spot> = {}): Spot =>
  spot({ mode: 'tournament', tournament: TWO_LEFT, ...over });

/** What the option changes in a spot: the classes, and each change as off>on. */
function changes(s: Spot, on: Record<string, unknown> = ON, mind = false) {
  const withOn = sweep(s, on, mind);
  const withOff = sweep(s, {}, mind);
  const classes = Object.keys(withOn).filter((k) => withOn[k] !== withOff[k]);
  return {
    classes,
    kinds: [...new Set(classes.map((k) => `${withOff[k]}>${withOn[k]}`))],
    off: withOff,
    on: withOn,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('huBbDefendsUnreadToPrice: the heads-up big blind facing an unread open', () => {
  it('today the big blind folds most hands to a min-raise laying three to one', () => {
    const off = sweep(spot(), {});
    const folds = Object.values(off).filter((a) => a === 'fold').length;
    expect(folds).toBeGreaterThanOrEqual(60);
  });

  it('on, those hands call, and every change is a fold that became a call', () => {
    const c = changes(spot());
    expect(c.kinds).toEqual(['fold>call']);
    expect(c.classes.length).toBeGreaterThanOrEqual(30);
    // The bottom of the deck is still a fold against the min-raise.
    for (const cls of ['32o', '42o', '72o']) expect(c.on[cls], cls).toBe('fold');
  });

  it('every hand it calls has the equity the price asks for at the reference width and 0.7', () => {
    expect(HU_BB_UNREAD_REALIZATION).toBe(0.7);
    const c = changes(spot());
    // 1bb to call into 3bb: 0.25 before rake, so 0.357 after realisation.
    const need = huBbUnreadRequiredEquity(1 / 4);
    for (const cls of c.classes) {
      const eq = huBbEquityVsOpener(cls, OPEN_TARGET_HU.cash)!;
      expect(eq, cls).toBeGreaterThanOrEqual(need);
    }
  });

  it('the price decides: a larger open is called by no more hands, one above 6bb by none', () => {
    const counts = [2, 2.5, 3, 4].map((o) => changes(spot({ openBB: o })).classes.length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(counts[0]).toBeGreaterThan(counts[2]);
    expect(changes(spot({ openBB: 6.5 })).classes).toEqual([]);
  });

  it('acts at 20-50bb effective and not above or below', () => {
    expect(HU_BB_UNREAD_MAX_STACK_BB).toBe(50);
    expect(changes(spot({ stackBB: 25 })).kinds).toEqual(['fold>call']);
    expect(changes(spot({ stackBB: 50 })).kinds).toEqual(['fold>call']);
    expect(changes(spot({ stackBB: 55 })).classes).toEqual([]);
    expect(changes(spot({ stackBB: 80 })).classes).toEqual([]);
    expect(changes(spot({ stackBB: 15 })).classes).toEqual([]);
  });
});

describe('a tournament is in scope only heads-up for the title', () => {
  it('acts with exactly two players left in the event, trusted context', () => {
    expect(changes(twoLeft()).kinds).toEqual(['fold>call']);
    expect(changes(twoLeft({ stackBB: 25, openBB: 2.5 })).kinds).toEqual(['fold>call']);
  });

  const cases: readonly [string, Partial<Spot>][] = [
    ['three players left in the event', { tournament: { ...TWO_LEFT, playersLeft: 3 } }],
    ['a field still in progress', { tournament: { ...TWO_LEFT, playersLeft: 40, spotsPaid: 6 } }],
    ['a satellite', { tournament: { ...TWO_LEFT, satellite: true } }],
    ['an untrusted context', { tournament: { ...TWO_LEFT, contextStatus: 'partial' } }],
    ['no context at all', { tournament: undefined }],
  ];
  it.each(cases)('does not act with %s', (_name, over) => {
    expect(changes(twoLeft(over)).classes).toEqual([]);
  });
});

describe('it stands aside once the opener is read', () => {
  /** A real engaged read: an opener who raised every one of 100 first-in chances. */
  function engagedRead() {
    const row = freshExploitCounters();
    row.hands = 200;
    row.vpip = 200;
    row.pfr = 200;
    row.rfiOpp = 100;
    row.rfi = 100;
    const read = opponentExploitRead(row, 'holdem:hu', 'nlh');
    expect(openerRangeWidth(read)).not.toBeNull();
    return read;
  }

  it('with the mind on and no read, it acts', () => {
    vi.spyOn(HorseMind, 'opponentRead').mockReturnValue(null);
    expect(changes(spot(), ON, true).kinds).toEqual(['fold>call']);
  });

  it('with an engaged opener read, every decision is the one made today', () => {
    const read = engagedRead();
    vi.spyOn(HorseMind, 'opponentRead').mockReturnValue(read);
    expect(changes(spot(), ON, true).classes).toEqual([]);
    expect(changes(twoLeft(), ON, true).classes).toEqual([]);
  });
});

describe('out of scope', () => {
  const OUT_OF_SCOPE: readonly [string, Partial<Spot>][] = [
    ['blind against blind after a dealt-in button folded', { buttonFolded: true }],
    ['four-card Omaha', { variant: 'plo4' }],
    ['short deck', { variant: 'short_deck' }],
    ['fixed limit', { variant: 'flh' }],
    [
      "pot-limit hold'em",
      { extra: { variantRules: horseVariantRulesFor('nlh'), bettingStructure: 'pot_limit' } },
    ],
    ['an all-in open', { openerAllIn: true }],
    ['an all-in-or-fold table', { extra: { allInOrFold: true } }],
    ['a straddled pot', { extra: { straddleActive: true } }],
    ['a bomb pot', { extra: { bombPot: true } }],
  ];
  it.each(OUT_OF_SCOPE)('does not act in %s', (_name, over) => {
    expect(changes(spot(over)).classes).toEqual([]);
  });
});

describe('off, the option changes nothing', () => {
  it('explicit false is the same decision as unset, for every class', () => {
    for (const s of [spot(), spot({ stackBB: 25, openBB: 2.5 }), twoLeft()]) {
      expect(sweep(s, { huBbDefendsUnreadToPrice: false })).toEqual(sweep(s, {}));
    }
  });

  it('the brain reads the option in one place, and only an explicit true passes', () => {
    const src = readFileSync(fileURLToPath(new URL('./HorseLogic.ts', import.meta.url)), 'utf8');
    const reads = src.match(/opts\.huBbDefendsUnreadToPrice\b[^\n]*/g) ?? [];
    expect(reads.length).toBe(1);
    expect(reads[0]).toContain('opts.huBbDefendsUnreadToPrice === true');
  });
});

/**
 * The receipt is the final decision. Telemetry is switched on here and stays
 * on for the rest of the process, so this block runs last.
 */
describe('each receipt is a call that reached the final decision', () => {
  const KEY = 'hu_bb_defends_unread_to_price';
  function sweepWithReceipts(s: Spot, opts: Record<string, unknown>) {
    const hybrid = HORSE_HYBRID_PROFILES[s.mode === 'tournament' ? 'tournament' : 'cash'];
    const action: Record<string, string> = {};
    const fired: string[] = [];
    drainFires();
    for (const h of HAND_CLASSES) {
      const { hero, gs } = stateFor(s, holeFor(h.cls, false));
      seedFastRandom(11 + h.cls.charCodeAt(0) * 31 + h.cls.charCodeAt(1));
      action[h.cls] = HorseLogic.decide(
        hero,
        gs,
        hybrid.style,
        { ...hybrid.mods },
        { mind: false, decisionTimeMs: Date.UTC(2026, 10, 15, 12, 0, 0), telemetry: true, ...opts }
      ).action;
      const n = drainFires().find((r) => r.feature === KEY)?.fires ?? 0;
      expect(n, h.cls).toBeLessThanOrEqual(1);
      if (n === 1) fired.push(h.cls);
    }
    return { action, fired };
  }

  const cases: readonly [string, Spot][] = [
    ['cash, 40bb, 2bb open', spot()],
    ['cash, 25bb, 2.5bb open', spot({ stackBB: 25, openBB: 2.5 })],
    ['tournament, two left, 40bb, 2bb open', twoLeft()],
  ];

  it.each(cases)('%s: receipts equal the changed final decisions', (_name, s) => {
    enableBrainTelemetry();
    const withOn = sweepWithReceipts(s, ON);
    const withOff = sweepWithReceipts(s, {});
    expect(withOn.action).toEqual(sweep(s, ON));
    expect(withOff.action).toEqual(sweep(s, {}));
    const changed = Object.keys(withOn.action).filter(
      (k) => withOn.action[k] !== withOff.action[k]
    );
    expect(changed.length).toBeGreaterThan(0);
    expect(withOff.fired).toEqual([]);
    expect([...withOn.fired].sort()).toEqual([...changed].sort());
  });
});
