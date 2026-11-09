/**
 * Constructed V82 big-blind node for HorseV82BbFacingOpen.controlled.test.ts
 * and HorseV82HandStartDepth.law.test.ts: two- or three-handed no-limit
 * hold'em, blinds posted, one sized open (heads-up by the small blind,
 * three-handed by the button with the small blind folding), the big blind to
 * act, answered through the real HorseLogic.decide. Test support only.
 */
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
export const V82_BB_CHIPS = 20;
const BB = V82_BB_CHIPS;
const SEEDS = 2;
const comboCount = (cls: string) => (cls.length === 2 ? 6 : cls.endsWith('s') ? 4 : 12);

export type V82Spot = {
  dealt: 2 | 3;
  mode: 'cash' | 'tournament';
  /** Hand-start stack of each seat in bb, in seat order (HU: SB, BB; 3: BTN, SB, BB). */
  stacksBB: number[];
  /** The open, raise-to in bb. */
  openToBB: number;
};

function holeFor(cls: string, s: number): Card[] {
  const su = (s * 3) % 4;
  const suited = cls.length === 3 && cls[2] === 's';
  const s2 = suited ? su : (su + 1 + (s % 3)) % 4;
  return [{ rank: cls[0], suit: SUITS[su] } as Card, { rank: cls[1], suit: SUITS[s2] } as Card];
}

/** The big blind's answer: fold | call | raise (short of all-in) | jam. */
export function bbAnswer(spot: V82Spot, cls: string, seed: number, opts: object = {}): string {
  const n = spot.dealt;
  const pos = n === 2 ? ['SB', 'BB'] : ['BTN', 'SB', 'BB'];
  const hole = holeFor(cls, seed);
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const players: SeatPlayer[] = pos.map(
    (p, i) =>
      ({
        seat: i + 1,
        user_id: `v82-${i + 1}`,
        username: `V82${i + 1}`,
        stack: Math.round(spot.stacksBB[i] * BB),
        bet: 0,
        totalInvested: 0,
        cards: p === 'BB' ? hole : [deck[2 * i], deck[2 * i + 1]],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      }) as SeatPlayer
  );
  const at = (p: string) => players[pos.indexOf(p)];
  let pot = 0;
  const put = (p: string, amt: number) => {
    const q = at(p);
    q.stack -= amt;
    q.bet += amt;
    q.totalInvested += amt;
    pot += amt;
  };
  put('SB', BB / 2);
  put('BB', BB);
  const history: ActionRecord[] = [];
  let ts = 100;
  const rec = (p: string, action: string, amount: number) =>
    history.push({
      seat: at(p).seat,
      userId: at(p).user_id,
      action,
      amount,
      timestamp: ts++,
      stage: 'preflop',
    } as ActionRecord);
  const opener = n === 2 ? 'SB' : 'BTN';
  const to = Math.round(spot.openToBB * BB);
  put(opener, to - at(opener).bet);
  rec(opener, 'raise', to);
  if (n === 3) {
    at('SB').is_folded = true;
    rec('SB', 'fold', 0);
  }
  const tourney = spot.mode === 'tournament';
  const gs = {
    players,
    communityCards: [],
    pot,
    currentBet: to,
    minRaise: to - BB,
    lastRaise: to - BB,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: BB,
    smallBlind: BB / 2,
    dealerSeat: 1,
    actionHistory: history,
    gameMode: spot.mode,
    ante: 0,
    format: tourney ? (n === 2 ? 'hu_sng' : 'spin') : 'cash',
    ...(tourney
      ? {
          tournament: {
            schemaVersion: 1,
            contextStatus: 'complete',
            contextIssues: [],
            playersLeft: n,
            spotsPaid: 1,
            entrants: n,
            avgStackChips: (spot.stacksBB.reduce((a, b) => a + b, 0) / n) * BB,
            medianStackChips: spot.stacksBB[0] * BB,
            seatsPerTable: n,
            playersAtTable: n,
            nearBubble: false,
            inMoney: false,
            payoutPct: [100],
            currentSmallBlind: BB / 2,
            currentBigBlind: BB,
            currentAnte: 0,
            anteType: 'none',
            nextSmallBlind: BB,
            nextBigBlind: BB * 2,
            nextAnte: 0,
            nextBlindInMin: 10,
          },
        }
      : {}),
  } as unknown as HorseGameStateV2;
  seedFastRandom(seed * 7919 + cls.charCodeAt(0) * 31 + cls.charCodeAt(1) * 17 + cls.length);
  const hero = at('BB');
  const d = HorseLogic.decide(hero, gs, 'balanced', {}, {
    mind: false,
    telemetry: false,
    ...opts,
  } as never);
  const allIn =
    d.action === 'all_in' ||
    ((d.action === 'raise' || d.action === 'bet') && (d.amount ?? 0) >= hero.stack + hero.bet);
  if (d.action === 'fold') return 'fold';
  if (allIn) return 'jam';
  return d.action === 'bet' ? 'raise' : d.action;
}

/** Combo-weighted shares (0..100) of each answer over the 169 classes x SEEDS. */
export function bbShares(spot: V82Spot, opts: object = {}): Record<string, number> {
  const w: Record<string, number> = { fold: 0, call: 0, raise: 0, jam: 0, check: 0 };
  let tot = 0;
  for (const { cls } of HAND_CLASSES)
    for (let s = 0; s < SEEDS; s++) {
      const a = bbAnswer(spot, cls, s, opts);
      w[a] = (w[a] ?? 0) + comboCount(cls);
      tot += comboCount(cls);
    }
  for (const k of Object.keys(w)) w[k] = (100 * w[k]) / tot;
  return w;
}
