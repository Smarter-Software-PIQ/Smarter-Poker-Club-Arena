/**
 * NASH PUSH/FOLD V2 (2026-11-07): the CALL of a lone open-jam, ten-handed
 * seats and the bubble-factor (ICM) family, from one computed table
 * (HorseNashPushFoldV2.data.ts, server/scripts/nash-push-fold/solve.py --v2).
 * Flags nashCallVsJam and nashPushFoldIcm, both default off. End-to-end
 * numbers go through HorseLogic.decide, combo-weighted over the 169 classes.
 * See docs/changelog/2026-11-07-nash-push-fold-v2.md.
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import { nashJamUpTo } from './HorseAnteAwarePushFold.js';
import {
  NASH_V2_CALL_MAX_BB,
  nashV2CallUpTo,
  nashV2CallWidth,
  nashV2JamUpTo,
  nashV2JamWidth,
} from './HorseNashPushFoldV2.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
const BB = 2;
const SEEDS = 3;
const comboCount = (cls: string) => (cls.length === 2 ? 6 : cls.endsWith('s') ? 4 : 12);

function holeFor(cls: string, s: number): Card[] {
  const su = (s * 3) % 4;
  const suited = cls.length === 3 && cls[2] === 's';
  const s2 = suited ? su : (su + 1 + (s % 3)) % 4;
  return [{ rank: cls[0], suit: SUITS[su] } as Card, { rank: cls[1], suit: SUITS[s2] } as Card];
}

type Spot = {
  seats: number;
  stackBB: number;
  mode: 'cash' | 'tournament';
  ante: boolean;
  /** Index into the preflop order (UTG first ... SB) of the jammer, or 'open' for a folded-to hero. */
  jammer: number | null;
  /** Seat number of hero (2 = the big blind, 1 = the small blind). */
  heroSeat?: number;
  /** A caller of the jam before hero (layer must not answer). */
  calledBy?: number;
  /** The jam size in big blinds (default: the stack). */
  jamBB?: number;
  /** Tournament ICM inputs (stacks in chips by seat, payouts). */
  icm?: { stacks: number[]; payoutPct: number[]; playersLeft: number; spotsPaid: number };
  humans?: boolean;
};

function decide(spot: Spot, cls: string, seed: number, opts: Record<string, unknown>): string {
  const n = spot.seats;
  const hu = n === 2;
  const sbSeat = hu ? 2 : 1;
  const bbSeat = hu ? 1 : 2;
  // Preflop order before the big blind: UTG .. BTN, then the SB.
  const order = hu ? [2] : [...Array(n - 2).keys()].map((k) => 3 + k).concat([1]);
  const jammerSeat = spot.jammer === null ? null : order[spot.jammer];
  const heroSeat = spot.heroSeat ?? (spot.jammer === null ? order[0] : bbSeat);
  const hole = holeFor(cls, seed);
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const ante = spot.ante ? 2 : 0;
  const players: SeatPlayer[] = [];
  for (let seat = 1; seat <= n; seat++) {
    const bet = seat === sbSeat ? 1 : seat === bbSeat ? 2 : 0;
    players.push({
      seat,
      user_id: `nv2-${seat}`,
      username: `Nv2${seat}`,
      stack: spot.stackBB * BB - bet - (seat === bbSeat ? ante : 0),
      bet,
      totalInvested: bet + (seat === bbSeat ? ante : 0),
      cards: seat === heroSeat ? hole : [deck[seat * 2], deck[seat * 2 + 1]],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: spot.humans !== true,
    } as SeatPlayer);
  }
  const history: ActionRecord[] = [];
  let ts = 100;
  let pot = 3 + ante;
  let currentBet = 2;
  const full = order.concat([bbSeat]);
  let jammed = false;
  const act = (seat: number, action: string, amount: number, extra: object = {}) =>
    history.push({
      seat,
      userId: `nv2-${seat}`,
      action,
      amount,
      timestamp: ts++,
      stage: 'preflop',
      ...extra,
    } as ActionRecord);
  for (const seat of full) {
    if (seat === heroSeat) break;
    const p = players[seat - 1];
    if (seat === jammerSeat) {
      const to = Math.min(p.stack + p.bet, (spot.jamBB ?? spot.stackBB) * BB);
      pot += to - p.bet;
      p.stack -= to - p.bet;
      p.totalInvested += to - p.bet;
      p.bet = to;
      if (p.stack === 0) p.is_all_in = true;
      currentBet = to;
      act(seat, p.is_all_in ? 'all_in' : 'raise', to, p.is_all_in ? { isFullRaise: true } : {});
      jammed = true;
      continue;
    }
    if (jammed && spot.calledBy === seat) {
      const callTo = Math.min(p.stack + p.bet, currentBet);
      pot += callTo - p.bet;
      p.stack -= callTo - p.bet;
      p.bet = callTo;
      if (p.stack === 0) p.is_all_in = true;
      act(seat, p.is_all_in ? 'all_in' : 'call', callTo);
      continue;
    }
    p.is_folded = true;
    act(seat, 'fold', 0);
  }
  const gs = {
    players,
    communityCards: [],
    pot,
    currentBet,
    minRaise: 2,
    lastRaise: 2,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: BB,
    smallBlind: 1,
    dealerSeat: hu ? 2 : n,
    actionHistory: history,
    gameMode: spot.mode,
    ante,
    bigBlindAnte: spot.ante,
    format: spot.mode === 'cash' ? 'cash' : 'mtt',
    ...(spot.mode === 'tournament'
      ? {
          tournament: {
            schemaVersion: 1,
            contextStatus: 'complete',
            contextIssues: [],
            playersLeft: spot.icm?.playersLeft ?? 180,
            spotsPaid: spot.icm?.spotsPaid ?? 30,
            entrants: 300,
            avgStackChips: spot.stackBB * BB,
            medianStackChips: spot.stackBB * BB,
            seatsPerTable: n,
            playersAtTable: n,
            nearBubble: false,
            inMoney: false,
            payoutPct: spot.icm?.payoutPct ?? [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
            ...(spot.icm
              ? {
                  stacks: spot.icm.stacks,
                  stackByUser: Object.fromEntries(
                    spot.icm.stacks.map((chips, i) => [`nv2-${i + 1}`, chips])
                  ),
                }
              : {}),
            currentSmallBlind: 1,
            currentBigBlind: 2,
            currentAnte: ante,
            anteType: spot.ante ? 'big_blind' : 'none',
            nextSmallBlind: 2,
            nextBigBlind: 4,
            nextAnte: ante * 2,
            nextBlindInMin: 10,
          },
        }
      : {}),
  } as unknown as HorseGameStateV2;
  seedFastRandom(seed * 7919 + cls.charCodeAt(0) * 31 + cls.charCodeAt(1) * 17 + cls.length);
  const d = HorseLogic.decide(players[heroSeat - 1], gs, 'balanced', {}, {
    mind: false,
    telemetry: false,
    ...opts,
  } as never);
  return d.action === 'all_in' ? 'jam' : d.action;
}

/** Combo-weighted share (0..100) of hands whose answer is in `acts`. */
function width(spot: Spot, opts: Record<string, unknown>, acts: string[]): number {
  let w = 0;
  let tot = 0;
  for (const { cls } of HAND_CLASSES) {
    for (let s = 0; s < SEEDS; s++) {
      const a = decide(spot, cls, s, opts);
      if (acts.includes(a)) w += comboCount(cls);
      tot += comboCount(cls);
    }
  }
  return (100 * w) / tot;
}

function answers(spot: Spot, opts: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const { cls } of HAND_CLASSES)
    for (let s = 0; s < 2; s++) out.push(decide(spot, cls, s, opts));
  return out;
}

const ON = { nashCallVsJam: true };
const CALLS = ['call', 'jam'];

describe('Nash push/fold V2 table', () => {
  it('reproduces the V71 jam table exactly at bubble factor 1 and up to eight behind', () => {
    for (let n = 1; n <= 8; n++)
      for (const a of [0, 1, 2])
        for (const { cls } of HAND_CLASSES) {
          expect(nashV2JamUpTo(cls, n, a, 1)).toBe(nashJamUpTo(cls, n, a));
        }
  });

  it('calls a heads-up small-blind jam at the computed chip-EV width', () => {
    // HU, no ante: the big blind calls 37.3% at 10bb and 21.7% at 20bb.
    expect(nashV2CallWidth(1, 'bb', 10, 0)).toBeGreaterThan(35);
    expect(nashV2CallWidth(1, 'bb', 10, 0)).toBeLessThan(40);
    expect(nashV2CallWidth(1, 'bb', 20, 0)).toBeGreaterThan(19.5);
    expect(nashV2CallWidth(1, 'bb', 20, 0)).toBeLessThan(24);
  });

  it('calls tighter the more players were behind the jammer, wider with dead ante, wider shallower', () => {
    for (const depth of [8, 12, 16, 20]) {
      for (const a of [0, 1]) {
        let prev = Infinity;
        for (const n of [1, 2, 4, 6, 8]) {
          const w = nashV2CallWidth(n, 'bb', depth, a);
          expect(w).toBeLessThanOrEqual(prev + 0.5);
          prev = w;
        }
      }
      for (const n of [1, 2, 5, 8])
        expect(nashV2CallWidth(n, 'bb', depth, 1)).toBeGreaterThan(
          nashV2CallWidth(n, 'bb', depth, 0)
        );
    }
    for (const n of [1, 2, 5, 8])
      expect(nashV2CallWidth(n, 'bb', 8, 0)).toBeGreaterThan(nashV2CallWidth(n, 'bb', 20, 0));
  });

  it('a bubble factor only ever tightens hero, for the jam and for the call', () => {
    for (const n of [1, 2, 5, 9])
      for (const depth of [6, 10, 15, 20])
        for (const a of [0, 1]) {
          let prevJ = Infinity;
          let prevC = Infinity;
          for (const b of [1, 1.25, 1.5, 2, 2.5, 3]) {
            const j = nashV2JamWidth(n, depth, a, b);
            const c = nashV2CallWidth(n, 'bb', depth, a, b);
            expect(j).toBeLessThanOrEqual(prevJ + 1e-9);
            expect(c).toBeLessThanOrEqual(prevC + 1e-9);
            prevJ = j;
            prevC = c;
          }
        }
  });

  it('premiums always call, trash never calls', () => {
    for (let n = 1; n <= 9; n++)
      for (const kind of ['open', 'sb', 'bb'] as const) {
        expect(nashV2CallUpTo('AA', n, kind, 0)).toBeGreaterThanOrEqual(NASH_V2_CALL_MAX_BB);
        expect(nashV2CallUpTo('KK', n, kind, 1)).toBeGreaterThanOrEqual(NASH_V2_CALL_MAX_BB);
        expect(nashV2CallUpTo('72o', n, kind, 0)!).toBeLessThan(10);
      }
  });

  it('reads a ten-handed under-the-gun seat (nine behind) tighter than eight behind', () => {
    expect(nashV2JamWidth(9, 10, 1)).toBeLessThan(nashV2JamWidth(8, 10, 1));
    expect(nashV2JamWidth(9, 15, 0)).toBeLessThanOrEqual(nashV2JamWidth(8, 15, 0));
  });
});

describe('nashCallVsJam through HorseLogic.decide', () => {
  it('a cash big blind facing a 20bb button jam calls the Nash width (was a strength bar)', () => {
    const spot: Spot = { seats: 6, stackBB: 20, mode: 'cash', ante: false, jammer: 3 };
    const on = width(spot, ON, CALLS);
    const target = nashV2CallWidth(2, 'bb', 20, 0);
    expect(Math.abs(on - target)).toBeLessThan(1.5);
  });

  it('a tournament big blind facing a 12bb nine-handed under-the-gun jam calls the ante-aware width', () => {
    const spot: Spot = { seats: 9, stackBB: 12, mode: 'tournament', ante: true, jammer: 0 };
    const on = width(spot, ON, CALLS);
    // The big blind paid the 1bb ante: its whole stack is 11bb.
    const target = nashV2CallWidth(8, 'bb', 11, 1);
    expect(Math.abs(on - target)).toBeLessThan(1.5);
  });

  it('the small blind and an unposted seat read their own caller rows', () => {
    const sb: Spot = { seats: 6, stackBB: 10, mode: 'cash', ante: false, jammer: 3, heroSeat: 1 };
    expect(Math.abs(width(sb, ON, CALLS) - nashV2CallWidth(2, 'sb', 10, 0))).toBeLessThan(1.5);
    // CO (seat 5) facing a HJ (seat 4) jam, six-handed: four behind the jammer.
    const co: Spot = { seats: 6, stackBB: 10, mode: 'cash', ante: false, jammer: 1, heroSeat: 5 };
    expect(Math.abs(width(co, ON, CALLS) - nashV2CallWidth(4, 'open', 10, 0))).toBeLessThan(1.5);
  });

  it('is on by default; an explicit false keeps the strength bar', () => {
    const spot: Spot = { seats: 6, stackBB: 20, mode: 'cash', ante: false, jammer: 3 };
    expect(answers(spot, {})).toEqual(answers(spot, ON));
    expect(answers(spot, { nashCallVsJam: false })).not.toEqual(answers(spot, ON));
  });

  it('leaves the big blind against a small-blind jam without dead money to the sb_push chart', () => {
    const hu: Spot = { seats: 2, stackBB: 12, mode: 'cash', ante: false, jammer: 0 };
    expect(answers(hu, ON)).toEqual(answers(hu, { nashCallVsJam: false }));
    const bvb: Spot = { seats: 6, stackBB: 12, mode: 'cash', ante: false, jammer: 4 };
    expect(answers(bvb, ON)).toEqual(answers(bvb, { nashCallVsJam: false }));
    // With a big-blind ante the table answers it.
    const ante: Spot = { seats: 2, stackBB: 12, mode: 'tournament', ante: true, jammer: 0 };
    expect(Math.abs(width(ante, ON, CALLS) - nashV2CallWidth(1, 'bb', 11, 1))).toBeLessThan(1.5);
  });

  it('leaves a jam that was already called, and a jam deeper than 20bb, to the old path', () => {
    const called: Spot = {
      seats: 6,
      stackBB: 15,
      mode: 'cash',
      ante: false,
      jammer: 1,
      calledBy: 5,
    };
    expect(answers(called, ON)).toEqual(answers(called, { nashCallVsJam: false }));
    const deep: Spot = { seats: 6, stackBB: 30, mode: 'cash', ante: false, jammer: 3 };
    expect(answers(deep, ON)).toEqual(answers(deep, { nashCallVsJam: false }));
  });

  it('reads nobody: an all-human table gets the calls an all-horse table gets', () => {
    const horses: Spot = { seats: 6, stackBB: 15, mode: 'tournament', ante: true, jammer: 3 };
    expect(answers({ ...horses, humans: true }, ON)).toEqual(answers(horses, ON));
  });
});

describe('nashPushFoldIcm through HorseLogic.decide', () => {
  // Four left, three paid: hero (the big blind, 20bb) and the jammer are the
  // short stacks; two big stacks cover everybody. Hero's bubble factor is
  // well above 1.
  const bubble = {
    stacks: [400, 40, 400, 40],
    payoutPct: [50, 30, 20],
    playersLeft: 4,
    spotsPaid: 3,
  };

  it('on the bubble the big blind calls a jam tighter than chip EV', () => {
    const spot: Spot = {
      seats: 4,
      stackBB: 20,
      mode: 'tournament',
      ante: true,
      jammer: 1,
      icm: bubble,
    };
    const chipEv = width(spot, ON, CALLS);
    const icm = width(spot, { ...ON, nashPushFoldIcm: true }, CALLS);
    expect(icm).toBeLessThan(chipEv - 3);
  });

  it('on the bubble the folded-to jam (V71) is tighter than chip EV', () => {
    // Hero is the middle stack: two micro stacks are likely to bust first,
    // so hero's chips are worth far more kept than doubled.
    const spot: Spot = {
      seats: 4,
      stackBB: 12,
      mode: 'tournament',
      ante: true,
      jammer: null,
      heroSeat: 4,
      icm: { ...bubble, stacks: [400, 6, 6, 24] },
    };
    const chipEv = width(spot, {}, ['jam']);
    const icm = width(spot, { nashPushFoldIcm: true }, ['jam']);
    expect(icm).toBeLessThan(chipEv - 3);
  });

  it('without stacks in the context it is the chip-EV answer exactly', () => {
    const spot: Spot = { seats: 6, stackBB: 12, mode: 'tournament', ante: true, jammer: 3 };
    expect(answers(spot, { ...ON, nashPushFoldIcm: true })).toEqual(answers(spot, ON));
    const open: Spot = { seats: 6, stackBB: 12, mode: 'tournament', ante: true, jammer: null };
    expect(answers(open, { nashPushFoldIcm: true })).toEqual(answers(open, {}));
  });

  it('a ten-handed under-the-gun jam reads nine behind', () => {
    const spot: Spot = { seats: 10, stackBB: 10, mode: 'tournament', ante: true, jammer: null };
    const w = width(spot, { nashPushFoldIcm: true }, ['jam']);
    expect(Math.abs(w - nashV2JamWidth(9, 10, 1))).toBeLessThan(1.5);
  });
});
