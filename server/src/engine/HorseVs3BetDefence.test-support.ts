/**
 * Harness for the V73 opener-facing-a-3-bet measurements
 * (HorseVs3BetDefence.test.ts, docs/changelog/2026-11-01-horse-nlh-vs-3bet-defence.md).
 *
 * Every number is measured end to end through HorseLogic.decide: the opener's
 * own range is measured first (raise first in from its seat, same harness),
 * then each class that opened faces a 3-bet from the named seat, and the
 * answer is weighted by how often the class opened. Seats: SB 1, BB 2, first
 * to act 3, ..., button = seats.
 */
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import type { ActionRecord, Card, HorseStyle, SeatPlayer } from '../types.js';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
export const BB = 2;

export type Vs3Ctx = {
  seats: number;
  stackBB: number;
  mode: 'cash' | 'tournament';
  ante: boolean;
  openBB: number;
  /** The 3-bet, raised-to, as a multiple of the open. */
  threeBetX: number;
};

export function holeFor(cls: string, s: number): Card[] {
  const su = (s * 3) % 4;
  const suited = cls.length === 3 && cls[2] === 's';
  const s2 = suited ? su : (su + 1 + (s % 3)) % 4;
  return [{ rank: cls[0], suit: SUITS[su] } as Card, { rank: cls[1], suit: SUITS[s2] } as Card];
}

function tournamentBlock(ctx: Vs3Ctx, n: number) {
  return ctx.mode === 'tournament'
    ? {
        tournament: {
          schemaVersion: 1,
          contextStatus: 'complete',
          contextIssues: [],
          playersLeft: 180,
          spotsPaid: 30,
          entrants: 300,
          avgStackChips: ctx.stackBB * BB,
          medianStackChips: ctx.stackBB * BB,
          seatsPerTable: n,
          playersAtTable: n,
          nearBubble: false,
          inMoney: false,
          payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
          currentSmallBlind: 1,
          currentBigBlind: 2,
          currentAnte: 2,
          anteType: 'big_blind',
          nextSmallBlind: 2,
          nextBigBlind: 4,
          nextAnte: 4,
          nextBlindInMin: 10,
        },
      }
    : {};
}

function actOrder(n: number): number[] {
  return [...Array(n - 2).keys()].map((k) => 3 + k).concat([1, 2]);
}

/**
 * The opener (hero) raised to `openBB`, everyone between folded, `threeSeat`
 * 3-bet to `threeBetX` times the open, everyone else folded: hero to act.
 * `threeSeat` = -1 builds the unopened node at hero's seat instead.
 */
export function stateFor(
  ctx: Vs3Ctx,
  heroSeat: number,
  threeSeat: number,
  hole: Card[],
  flipLabels = false
): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const n = ctx.seats;
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const openTo = ctx.openBB * BB;
  const threeTo = Math.round(openTo * ctx.threeBetX * 100) / 100;
  const unopened = threeSeat < 0;
  const players: SeatPlayer[] = [];
  for (let seat = 1; seat <= n; seat++) {
    const blind = seat === 1 ? 1 : seat === 2 ? 2 : 0;
    const bet = unopened
      ? blind
      : seat === heroSeat
        ? openTo
        : seat === threeSeat
          ? threeTo
          : blind;
    const ante = seat === 2 && ctx.ante ? 2 : 0;
    players.push({
      seat,
      user_id: `v3-${seat}`,
      username: `V3${seat}`,
      stack: ctx.stackBB * BB - bet - ante,
      bet,
      totalInvested: bet + ante,
      cards: seat === heroSeat ? hole : [deck[seat * 2], deck[seat * 2 + 1]],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: flipLabels ? seat === heroSeat : true,
    } as SeatPlayer);
  }
  const history: ActionRecord[] = [];
  let ts = 100;
  const order = actOrder(n);
  const push = (seat: number, action: string, amount: number, full = false) =>
    history.push({
      seat,
      userId: players[seat - 1].user_id,
      action,
      amount,
      timestamp: ts++,
      stage: 'preflop',
      ...(full ? { isFullRaise: true } : {}),
    } as ActionRecord);
  if (unopened) {
    for (const seat of order) {
      if (seat === heroSeat) break;
      players[seat - 1].is_folded = true;
      push(seat, 'fold', 0);
    }
  } else {
    // Round one: folds to hero, hero opens, folds to the 3-bettor, the
    // 3-bet, folds round to hero.
    const start = order.indexOf(heroSeat);
    for (let i = 0; i < start; i++) {
      players[order[i] - 1].is_folded = true;
      push(order[i], 'fold', 0);
    }
    push(heroSeat, 'raise', openTo, true);
    let i = start + 1;
    for (; i < order.length && order[i] !== threeSeat; i++) {
      players[order[i] - 1].is_folded = true;
      push(order[i], 'fold', 0);
    }
    push(threeSeat, 'raise', threeTo, true);
    for (i = i + 1; i < order.length; i++) {
      players[order[i] - 1].is_folded = true;
      push(order[i], 'fold', 0);
    }
  }
  const bets = players.reduce((s, p) => s + p.bet, 0);
  const currentBet = unopened ? BB : threeTo;
  const gs = {
    players,
    communityCards: [],
    pot: bets + (ctx.ante ? 2 : 0),
    currentBet,
    minRaise: unopened ? BB : threeTo - openTo,
    lastRaise: unopened ? BB : threeTo - openTo,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: BB,
    dealerSeat: n,
    actionHistory: history,
    gameMode: ctx.mode,
    ante: ctx.ante ? 2 : 0,
    bigBlindAnte: ctx.ante,
    format: ctx.mode === 'cash' ? 'cash' : 'mtt',
    dealtSeatIds: players.map((p) => p.seat),
    // The live engine publishes these on every turn; the hold'em premium
    // rule (dominated hands fold to a big 3-bet) reads them.
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    toCall: currentBet - players[heroSeat - 1].bet,
    minRaiseTo: unopened ? 2 * BB : 2 * threeTo - openTo,
    maxRaiseTo: players[heroSeat - 1].stack + players[heroSeat - 1].bet,
    ...tournamentBlock(ctx, n),
  } as unknown as HorseGameStateV2;
  return { hero: players[heroSeat - 1], gs };
}

export type Vs3Mix = {
  /** Percent of the OPEN range (combo- and open-frequency-weighted). */
  fold: number;
  call: number;
  fourBet: number;
  /** Width of the measured open range, percent of 1,326. */
  openWidth: number;
  /** Per class: share of opened combos that continued. */
  byClass: Map<string, number>;
};

function isRaise(a: string): boolean {
  return a === 'raise' || a === 'all_in' || a === 'bet';
}

const OPEN_CACHE = new Map<string, Map<string, number>>();

/** Raise-first-in frequency per class from `seat`. */
export function openFreq(
  ctx: Vs3Ctx,
  seat: number,
  seeds: number,
  style: HorseStyle = 'balanced'
): Map<string, number> {
  const key = JSON.stringify([ctx.seats, ctx.stackBB, ctx.mode, ctx.ante, seat, seeds, style]);
  const hit = OPEN_CACHE.get(key);
  if (hit) return hit;
  const out = new Map<string, number>();
  for (const h of HAND_CLASSES) {
    let r = 0;
    for (let s = 0; s < seeds; s++) {
      const { hero, gs } = stateFor(ctx, seat, -1, holeFor(h.cls, s));
      seedFastRandom((s + 1) * 6151 + seat * 9973 + h.cls.charCodeAt(0) * 31);
      const d = HorseLogic.decide(
        hero,
        gs,
        style,
        {} as never,
        {
          mind: false,
          telemetry: false,
        } as never
      );
      if (isRaise(d.action)) r++;
    }
    out.set(h.cls, r / seeds);
  }
  OPEN_CACHE.set(key, out);
  return out;
}

/** The opener's answer to the 3-bet, weighted by its own open range. */
export function vs3(
  ctx: Vs3Ctx,
  heroSeat: number,
  threeSeat: number,
  opts: Record<string, unknown> = {},
  seeds = 6,
  style: HorseStyle = 'balanced',
  flipLabels = false
): Vs3Mix {
  const open = openFreq(ctx, heroSeat, seeds, style);
  let fold = 0;
  let call = 0;
  let four = 0;
  let width = 0;
  const byClass = new Map<string, number>();
  for (const h of HAND_CLASSES) {
    const w = (open.get(h.cls) ?? 0) * h.combos;
    if (w <= 0) continue;
    width += w;
    let c = 0;
    for (let s = 0; s < seeds; s++) {
      const { hero, gs } = stateFor(ctx, heroSeat, threeSeat, holeFor(h.cls, s), flipLabels);
      seedFastRandom((s + 1) * 7919 + heroSeat * 104729 + threeSeat * 7 + h.cls.charCodeAt(0));
      const d = HorseLogic.decide(
        hero,
        gs,
        style,
        {} as never,
        {
          mind: false,
          telemetry: false,
          ...opts,
        } as never
      );
      if (d.action === 'call') {
        call += w / seeds;
        c++;
      } else if (isRaise(d.action)) {
        four += w / seeds;
        c++;
      } else fold += w / seeds;
    }
    byClass.set(h.cls, c / seeds);
  }
  const tot = Math.max(1e-9, fold + call + four);
  return {
    fold: (100 * fold) / tot,
    call: (100 * call) / tot,
    fourBet: (100 * four) / tot,
    openWidth: (100 * width) / 1326,
    byClass,
  };
}

/**
 * Hero opened, `villainSeat` 3-bet, hero 4-bet to `fourBetX` times the 3-bet
 * and the villain 5-bet to `fiveBetX` times the 4-bet: hero to act. The V73
 * read never applies here (it is the 3-bet node only); this pins that the
 * facing-a-4-bet-or-more branch, Dan's deep 5-bet rule included, is
 * untouched.
 */
export function fiveBetStateFor(
  ctx: Vs3Ctx,
  heroSeat: number,
  villainSeat: number,
  hole: Card[],
  fourBetX = 2.3,
  fiveBetX = 2.2
): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const { hero, gs } = stateFor(ctx, heroSeat, villainSeat, hole);
  const villain = gs.players[villainSeat - 1];
  const threeTo = villain.bet;
  const fourTo = Math.round(threeTo * fourBetX * 100) / 100;
  const fiveTo = Math.round(fourTo * fiveBetX * 100) / 100;
  const total = ctx.stackBB * BB;
  const ante = (seat: number) => (seat === 2 && ctx.ante ? 2 : 0);
  hero.bet = fourTo;
  hero.stack = total - fourTo - ante(heroSeat);
  hero.totalInvested = fourTo + ante(heroSeat);
  const vBet = Math.min(fiveTo, total - ante(villainSeat));
  villain.bet = vBet;
  villain.stack = total - vBet - ante(villainSeat);
  villain.totalInvested = vBet + ante(villainSeat);
  villain.is_all_in = villain.stack <= 0;
  let ts = 1000;
  gs.actionHistory!.push(
    {
      seat: heroSeat,
      userId: hero.user_id,
      action: 'raise',
      amount: fourTo,
      timestamp: ts++,
      stage: 'preflop',
      isFullRaise: true,
    } as ActionRecord,
    {
      seat: villainSeat,
      userId: villain.user_id,
      action: villain.is_all_in ? 'all_in' : 'raise',
      amount: vBet,
      timestamp: ts++,
      stage: 'preflop',
      isFullRaise: true,
    } as ActionRecord
  );
  const g = gs as unknown as Record<string, unknown>;
  g.currentBet = vBet;
  g.pot = gs.players.reduce((s, p) => s + p.bet, 0) + (ctx.ante ? 2 : 0);
  g.toCall = vBet - fourTo;
  g.minRaise = vBet - fourTo;
  g.lastRaise = vBet - fourTo;
  g.minRaiseTo = Math.min(hero.stack + hero.bet, 2 * vBet - fourTo);
  g.maxRaiseTo = hero.stack + hero.bet;
  return { hero, gs };
}

/**
 * ═══ V75 THE SQUEEZED OPENER (2026-11-01) ═══════════════════════════════
 * Hero opened to `openBB`, `callerSeats` called the open (in action order),
 * `threeSeat` squeezed to `threeBetX` times the open, everyone else folded:
 * hero to act, the callers still live behind. `threeSeat` must act after the
 * callers in the orbit (the squeeze shape).
 */
export function squeezeStateFor(
  ctx: Vs3Ctx,
  heroSeat: number,
  callerSeats: number[],
  threeSeat: number,
  hole: Card[],
  flipLabels = false
): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const { hero, gs } = stateFor(ctx, heroSeat, threeSeat, hole, flipLabels);
  const openTo = ctx.openBB * BB;
  const total = ctx.stackBB * BB;
  const ante = (seat: number) => (seat === 2 && ctx.ante ? 2 : 0);
  const history = gs.actionHistory!;
  const openIx = history.findIndex((a) => a.seat === heroSeat && a.action === 'raise');
  const threeIx = history.findIndex((a) => a.seat === threeSeat && a.action === 'raise');
  let ts = 500;
  for (const seat of callerSeats) {
    const caller = gs.players[seat - 1];
    caller.is_folded = false;
    caller.bet = openTo;
    caller.stack = total - openTo - ante(seat);
    caller.totalInvested = openTo + ante(seat);
    // Replace the fold the base builder recorded for this seat (it sits
    // between the open and the 3-bet) with the call of the open.
    const foldIx = history.findIndex(
      (a, i) => i > openIx && i < threeIx && a.seat === seat && a.action === 'fold'
    );
    if (foldIx < 0) throw new Error(`caller seat ${seat} does not sit between open and 3-bet`);
    history[foldIx] = {
      seat,
      userId: caller.user_id,
      action: 'call',
      amount: openTo,
      timestamp: ts++,
      stage: 'preflop',
    } as ActionRecord;
  }
  const g = gs as unknown as Record<string, unknown>;
  g.pot = gs.players.reduce((s, p) => s + p.bet, 0) + (ctx.ante ? 2 : 0);
  return { hero, gs };
}
