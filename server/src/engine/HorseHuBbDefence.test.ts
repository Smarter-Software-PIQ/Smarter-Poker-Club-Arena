/**
 * HU BIG BLIND DEFENDS TO ITS PRICE (2026-11-07, flag huBbDefendsToPrice,
 * default off). Scenario tests through the real HorseLogic.decide with the
 * live cash Hybrid persona: heads-up 80bb, the small blind opens, the big
 * blind decides. See docs/changelog/2026-11-07-horse-hu-bb-defends-to-its-price.md.
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import {
  HU_BB_EQUITY,
  HU_BB_EQUITY_WIDTHS,
  huBbDefendShare,
  huBbEquityVsOpener,
  huBbRequiredEquity,
} from './HorseHuBbDefence.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
const BB = 2;
const COMBOS: Record<string, number> = Object.fromEntries(
  HAND_CLASSES.map((h) => [h.cls, h.combos])
);
const combos = (cls: string) => COMBOS[cls];
const hybrid = HORSE_HYBRID_PROFILES.cash;

function holeFor(cls: string, s: number): Card[] {
  const su = s % 4;
  const suited = cls.length === 3 && cls[2] === 's';
  const s2 = suited ? su : (su + 1 + (s % 3)) % 4;
  return [{ rank: cls[0], suit: SUITS[su] } as Card, { rank: cls[1], suit: SUITS[s2] } as Card];
}

type Spot = { seats: 2 | 6; openBB: number; stackBB: number; mode: 'cash' | 'tournament' };
const HU: Spot = { seats: 2, openBB: 2.75, stackBB: 80, mode: 'cash' };

/**
 * Heads-up: seat 1 is the dealer and small blind, seat 2 the big blind.
 * Six-max: seat 1 SB, 2 BB, 3 UTG .. 6 BTN; the button opens.
 */
function stateFor(spot: Spot, hole: Card[]): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const n = spot.seats;
  const openTo = spot.openBB * BB;
  const opener = n === 2 ? 1 : 6;
  const players: SeatPlayer[] = [];
  for (let seat = 1; seat <= n; seat++) {
    const blind = seat === 1 ? 1 : seat === 2 ? 2 : 0;
    const bet = seat === opener ? openTo : blind;
    players.push({
      seat,
      user_id: `hu-bb-${seat}`,
      username: `Hu${seat}`,
      stack: spot.stackBB * BB - bet,
      bet,
      totalInvested: bet,
      cards: seat === 2 ? hole : [deck[seat * 2], deck[seat * 2 + 1]],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer);
  }
  const history: ActionRecord[] = [];
  let ts = 100;
  const order = n === 2 ? [1] : [3, 4, 5, 6, 1];
  for (const seat of order) {
    const p = players[seat - 1];
    if (seat === opener) {
      history.push({
        seat,
        userId: p.user_id,
        action: 'raise',
        amount: openTo,
        timestamp: ts++,
        stage: 'preflop',
        isFullRaise: true,
      } as ActionRecord);
      continue;
    }
    p.is_folded = true;
    history.push({
      seat,
      userId: p.user_id,
      action: 'fold',
      amount: 0,
      timestamp: ts++,
      stage: 'preflop',
    } as ActionRecord);
  }
  const gs = {
    players,
    communityCards: [],
    pot: openTo + (opener === 1 ? 2 : 3),
    currentBet: openTo,
    minRaise: openTo - BB,
    lastRaise: openTo - BB,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: BB,
    dealerSeat: n === 2 ? 1 : 6,
    actionHistory: history,
    gameMode: spot.mode,
    ante: 0,
    format: spot.mode === 'cash' ? 'cash' : 'mtt',
    dealtSeatIds: players.map((p) => p.seat),
  } as unknown as HorseGameStateV2;
  return { hero: players[1], gs };
}

function decide(spot: Spot, cls: string, s: number, on: boolean): string {
  const { hero, gs } = stateFor(spot, holeFor(cls, s));
  seedFastRandom(1 + s * 7919 + cls.charCodeAt(0) * 31 + cls.charCodeAt(1));
  const d = HorseLogic.decide(
    hero,
    gs,
    hybrid.style,
    { ...hybrid.mods },
    {
      mind: false,
      decisionTimeMs: Date.UTC(2026, 10, 7, 12, 0, 0),
      // Pins this feature's own base; V85 (owner direction 2026-11-09) widens
      // cash from it and is pinned by HorseCashAction.law.test.ts.
      v85CashAction: false,
      ...(on ? { huBbDefendsToPrice: true } : {}),
    }
  );
  return d.action;
}

/** Combo-weighted fold share (percent) over every class, two seeds each. */
function foldShare(spot: Spot, on: boolean): number {
  let fold = 0;
  let total = 0;
  for (const h of HAND_CLASSES)
    for (let s = 0; s < 2; s++) {
      if (decide(spot, h.cls, s, on) === 'fold') fold += h.combos;
      total += h.combos;
    }
  return (100 * fold) / total;
}

describe('the equity table', () => {
  it('covers every class at every width', () => {
    expect(Object.keys(HU_BB_EQUITY).sort()).toEqual(HAND_CLASSES.map((h) => h.cls).sort());
    for (const row of Object.values(HU_BB_EQUITY))
      expect(row.length).toBe(HU_BB_EQUITY_WIDTHS.length);
  });

  it('matches the known all-in equity against a random hand at 100%', () => {
    // Published hold'em equities vs one random hand.
    const known: Record<string, number> = { AA: 0.852, AKo: 0.653, '72o': 0.346, '32o': 0.323 };
    for (const [cls, eq] of Object.entries(known))
      expect(Math.abs(huBbEquityVsOpener(cls, 100)! - eq)).toBeLessThan(0.008);
  });

  it('a wider opener is worth more to a weak hand and the share defended grows with it', () => {
    for (const cls of ['K5o', 'Q9o', 'T6s', '96s'])
      expect(huBbEquityVsOpener(cls, 100)!).toBeGreaterThan(huBbEquityVsOpener(cls, 30)!);
    const odds = 1.75 / (3.75 + 1.75);
    expect(huBbDefendShare(odds, 100, combos)).toBeGreaterThan(huBbDefendShare(odds, 72, combos));
    expect(huBbDefendShare(odds, 72, combos)).toBeGreaterThan(huBbDefendShare(odds, 40, combos));
  });

  it('is sized to the price: a bigger open is defended narrower', () => {
    const share = (open: number) => huBbDefendShare((open - 1) / (open + 1 + open - 1), 72, combos);
    expect(share(2.5)).toBeGreaterThan(share(3));
    expect(share(3)).toBeGreaterThan(share(4));
    // Against the 72% heads-up open, 2.5bb: about four hands in five continue.
    expect(share(2.5)).toBeGreaterThan(70);
    expect(share(2.5)).toBeLessThan(85);
    expect(huBbRequiredEquity(0.3)).toBeCloseTo(0.375, 6);
  });
});

describe('heads-up big blind facing a 2.75bb small-blind open (80bb, live cash persona)', () => {
  it('flag off keeps today: Q9o, K5o, T6s and 96s fold', () => {
    for (const cls of ['Q9o', 'K5o', 'T6s', '96s'])
      for (let s = 0; s < 4; s++) expect(decide(HU, cls, s, false)).toBe('fold');
  });

  it('flag on: they are getting 3.1:1 and call', () => {
    for (const cls of ['Q9o', 'K5o', 'T6s', '96s'])
      for (let s = 0; s < 4; s++) expect(decide(HU, cls, s, true)).toBe('call');
  });

  it('flag on: hands the price does not cover still fold', () => {
    for (const cls of ['72o', '32o', '82o'])
      for (let s = 0; s < 4; s++) expect(decide(HU, cls, s, true)).toBe('fold');
  });

  it('widen-only: no hand that continued with the flag off folds with it on, and 3-bets are unchanged', () => {
    for (const h of HAND_CLASSES)
      for (let s = 0; s < 2; s++) {
        const off = decide(HU, h.cls, s, false);
        const on = decide(HU, h.cls, s, true);
        if (off !== 'fold') expect(on).toBe(off);
      }
  });

  it('the fold share falls from more than half to under a third', () => {
    const off = foldShare(HU, false);
    const on = foldShare(HU, true);
    expect(off).toBeGreaterThan(50);
    expect(on).toBeLessThan(33);
  });
});

describe('outside the scope the flag is inert', () => {
  const same = (spot: Spot) => {
    let calls = 0;
    for (const h of HAND_CLASSES)
      for (let s = 0; s < 2; s++) {
        const off = decide(spot, h.cls, s, false);
        expect(decide(spot, h.cls, s, true)).toBe(off);
        if (off === 'call') calls++;
      }
    // A live spot, not a degenerate one: the big blind does defend some hands.
    expect(calls).toBeGreaterThan(20);
  };
  it('six-max big blind facing a button open', () => {
    same({ seats: 6, openBB: 2.5, stackBB: 100, mode: 'cash' });
  });
  it('heads-up tournament', () => {
    same({ seats: 2, openBB: 2.5, stackBB: 40, mode: 'tournament' });
  });
  it('heads-up cash under 20bb effective', () => {
    same({ seats: 2, openBB: 2.5, stackBB: 18, mode: 'cash' });
  });
});

/**
 * HU-NLH-001 (2026-11-12). V85 (owner direction 2026-11-09) widens the cash
 * big blind only above V85_DEPTH_NONE_BB (50bb, the cash minimum buy-in). At
 * 50bb or less the V11 heads-up bars still decide, and they read neither the
 * price nor the opener's width. Live defaults here: V85 is NOT pinned off.
 */
describe('HU-NLH-001: at 50bb or less V85 leaves the heads-up big blind on the V11 bars', () => {
  const live = (spot: Spot, cls: string, s: number, on: boolean): string => {
    const { hero, gs } = stateFor(spot, holeFor(cls, s));
    seedFastRandom(1 + s * 7919 + cls.charCodeAt(0) * 31 + cls.charCodeAt(1));
    return HorseLogic.decide(
      hero,
      gs,
      hybrid.style,
      { ...hybrid.mods },
      {
        mind: false,
        decisionTimeMs: Date.UTC(2026, 10, 7, 12, 0, 0),
        ...(on ? { huBbDefendsToPrice: true } : {}),
      }
    ).action;
  };
  const liveFoldShare = (spot: Spot, on: boolean): number => {
    let fold = 0;
    let total = 0;
    for (const h of HAND_CLASSES)
      for (let s = 0; s < 2; s++) {
        if (live(spot, h.cls, s, on) === 'fold') fold += h.combos;
        total += h.combos;
      }
    return (100 * fold) / total;
  };
  const at = (stackBB: number, openBB: number): Spot => ({
    seats: 2,
    openBB,
    stackBB,
    mode: 'cash',
  });

  it('MEASURED: at 40bb the fold share is over half and the same at 2bb, 2.5bb and 3bb', () => {
    const shares = [2, 2.5, 3].map((open) => liveFoldShare(at(40, open), false));
    // A min-raise needs half its opens to fold to profit with any two cards.
    for (const share of shares) expect(share).toBeGreaterThan(50);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThan(1);
  });

  it('above the taper V85 already answers a min-raise with under a third folded', () => {
    expect(liveFoldShare(at(80, 2), false)).toBeLessThan(33);
  });

  it('the flag is what changes the 40bb answer, and it reads the price', () => {
    const min = liveFoldShare(at(40, 2), true);
    const three = liveFoldShare(at(40, 3), true);
    expect(min).toBeLessThan(10);
    expect(three).toBeGreaterThan(min + 20);
    expect(three).toBeLessThan(liveFoldShare(at(40, 3), false));
  });
});
