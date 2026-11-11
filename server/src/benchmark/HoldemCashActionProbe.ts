/**
 * HOLD'EM CASH ACTION PROBE (2026-11-10). Plays the PREFLOP round of
 * no-limit hold'em cash hands at an all-horse table through
 * HorseLogic.decide, every seat on the source-assigned hybrid cash profile
 * the whole fleet plays, and reports what a player watching the table sees:
 * VPIP, PFR, 3-bet, squeeze, raise-first-in and open size, and the fold /
 * call / raise split of each seat group facing one open. Offline twin of
 * scripts/horse-measure/cash-action-by-table-size.sql (the same numbers from
 * production hand histories); the CLI is server/scripts/
 * holdem-cash-action-probe.ts. Conditional frequencies only: nothing here
 * measures profit (the league does). Pure and seeded.
 */
import { HorseLogic } from '../engine/HorseLogic.js';
import { seedFastRandom } from '../engine/HorseEval.js';
import { HORSE_HYBRID_PROFILES } from '../engine/HorseHybridProfile.js';
import { SUITS, RANKS } from '../engine/PokerEngine.js';
import type { ActionRecord, Card, HandStage, SeatPlayer } from '../types.js';

/** The V9 hourly mood hashes the hour: pin it so a measurement repeats. */
const PROBE_CLOCK_MS = Date.UTC(2026, 10, 10, 11, 0, 0);
const BB = 0.1;
const SB = 0.05;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledDeck(r: () => number): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (const rank of RANKS) d.push({ rank, suit: s } as Card);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export interface SeatHand {
  n: number;
  role: 'bb' | 'sb' | 'field';
  vpip: boolean;
  pfr: boolean;
  rfiOpp: boolean;
  rfi: boolean;
  openBB: number | null;
  /** First action facing exactly one raise and no caller. */
  vsOpen: 'fold' | 'call' | 'raise' | null;
  /** First action facing one raise and one or more callers. */
  vsOpenCaller: 'fold' | 'call' | 'raise' | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function playPreflop(
  n: number,
  depthBB: number,
  r: () => number,
  opts: Record<string, unknown>
): SeatHand[] {
  const cash = HORSE_HYBRID_PROFILES.cash;
  const deck = shuffledDeck(r);
  const seats = Array.from({ length: n }, (_, i) => i + 1);
  const dealerSeat = n;
  // Heads-up the dealer posts the small blind.
  const sbSeat = n === 2 ? dealerSeat : 1;
  const bbSeat = n === 2 ? 1 : 2;
  const players: SeatPlayer[] = seats.map((seat) => ({
    seat,
    user_id: 'u' + seat,
    username: 'U' + seat,
    stack: depthBB * BB,
    bet: 0,
    totalInvested: 0,
    cards: deck.splice(0, 2),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  }));
  const bySeat = new Map(players.map((p) => [p.seat, p]));
  const post = (seat: number, amt: number) => {
    const p = bySeat.get(seat)!;
    p.bet = amt;
    p.totalInvested = amt;
    p.stack = round2(p.stack - amt);
  };
  post(sbSeat, SB);
  post(bbSeat, BB);
  const out = new Map<number, SeatHand>(
    seats.map((s) => [
      s,
      {
        n,
        role: s === bbSeat ? 'bb' : s === sbSeat ? 'sb' : 'field',
        vpip: false,
        pfr: false,
        rfiOpp: false,
        rfi: false,
        openBB: null,
        vsOpen: null,
        vsOpenCaller: null,
      },
    ])
  );
  const history: ActionRecord[] = [];
  let currentBet = BB;
  let lastRaise = BB;
  let raises = 0;
  let callersOfLast = 0;
  let limpers = 0;
  const acted = new Set<number>();
  // Action starts left of the big blind.
  let idx = seats.indexOf(bbSeat);
  let guard = 0;
  for (;;) {
    if (guard++ > n * 8) throw new Error('preflop did not close');
    const live = players.filter((p) => !p.is_folded);
    if (live.length <= 1) break;
    const pending = live.filter((p) => !p.is_all_in && (!acted.has(p.seat) || p.bet < currentBet));
    if (pending.length === 0) break;
    idx = (idx + 1) % n;
    const hero = bySeat.get(seats[idx])!;
    if (hero.is_folded || hero.is_all_in) continue;
    if (acted.has(hero.seat) && hero.bet >= currentBet) continue;
    const pot = round2(players.reduce((a, p) => a + p.bet, 0));
    const gs = {
      players: players.map((p) => ({ ...p })),
      communityCards: [],
      pot,
      currentBet,
      minRaise: Math.max(BB, lastRaise),
      lastRaise,
      stage: 'preflop' as HandStage,
      gameVariant: 'nlh',
      bigBlind: BB,
      smallBlind: SB,
      dealerSeat,
      actionHistory: history.slice(),
      gameMode: 'cash',
      ante: 0,
      format: 'cash',
    };
    const first = !acted.has(hero.seat);
    const rec = out.get(hero.seat)!;
    const unopened = raises === 0 && limpers === 0;
    const dec = HorseLogic.decide(
      gs.players.find((p) => p.seat === hero.seat)!,
      gs as never,
      cash.style,
      { ...cash.mods },
      { mind: false, telemetry: false, decisionTimeMs: PROBE_CLOCK_MS, ...opts } as never
    );
    acted.add(hero.seat);
    let action = dec.action as string;
    const toCall = round2(currentBet - hero.bet);
    let raiseTo = 0;
    if (action === 'raise' || action === 'bet') raiseTo = round2(dec.amount ?? 0);
    if (action === 'all_in') {
      raiseTo = round2(hero.bet + hero.stack);
      action = raiseTo > currentBet ? 'raise' : 'call';
    }
    if (action === 'raise' && raiseTo <= currentBet) action = toCall > 0 ? 'call' : 'check';
    if (action === 'check' && toCall > 0) action = 'fold';
    const isRaise = action === 'raise';
    if (first) {
      if (unopened && hero.seat !== bbSeat) {
        rec.rfiOpp = true;
        if (isRaise) {
          rec.rfi = true;
          rec.openBB = raiseTo / BB;
        }
      }
      const kind = action === 'fold' ? 'fold' : isRaise ? 'raise' : 'call';
      if (raises === 1 && callersOfLast === 0) rec.vsOpen = kind;
      else if (raises === 1) rec.vsOpenCaller = kind;
    }
    if (action === 'fold') {
      hero.is_folded = true;
      history.push({
        seat: hero.seat,
        userId: hero.user_id,
        action: 'fold',
        amount: 0,
        timestamp: 1000 + history.length,
        stage: 'preflop',
      } as ActionRecord);
      continue;
    }
    if (action === 'check') {
      history.push({
        seat: hero.seat,
        userId: hero.user_id,
        action: 'check',
        amount: 0,
        timestamp: 1000 + history.length,
        stage: 'preflop',
      } as ActionRecord);
      continue;
    }
    rec.vpip = true;
    if (isRaise) {
      rec.pfr = true;
      const to = Math.min(raiseTo, round2(hero.bet + hero.stack));
      lastRaise = round2(Math.max(lastRaise, to - currentBet));
      hero.stack = round2(hero.stack - (to - hero.bet));
      hero.bet = to;
      hero.totalInvested = to;
      if (hero.stack <= 0) hero.is_all_in = true;
      currentBet = to;
      raises++;
      callersOfLast = 0;
      history.push({
        seat: hero.seat,
        userId: hero.user_id,
        action: 'raise',
        amount: to,
        timestamp: 1000 + history.length,
        stage: 'preflop',
      } as ActionRecord);
    } else {
      const pay = Math.min(toCall, hero.stack);
      hero.stack = round2(hero.stack - pay);
      hero.bet = round2(hero.bet + pay);
      hero.totalInvested = hero.bet;
      if (hero.stack <= 0) hero.is_all_in = true;
      if (raises === 0) limpers++;
      else callersOfLast++;
      history.push({
        seat: hero.seat,
        userId: hero.user_id,
        action: 'call',
        amount: hero.bet,
        timestamp: 1000 + history.length,
        stage: 'preflop',
      } as ActionRecord);
    }
  }
  return [...out.values()];
}

export interface TableReport {
  seats: number;
  hands: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  squeeze: number;
  rfi: number;
  openAvgBB: number;
  openMinBB: number;
  openMaxBB: number;
  vsOpen: Record<'bb' | 'sb' | 'field', { n: number; fold: number; call: number; raise: number }>;
  bbVsOpenCallerFold: number;
}

export function measureTable(
  n: number,
  hands: number,
  depthBB: number,
  seed: number,
  opts: Record<string, unknown> = {}
): TableReport {
  const r = rng(seed + n * 7919);
  // The brain draws from the shared fast generator: seed it so a run repeats.
  seedFastRandom((seed + n * 104729) >>> 0);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : 0);
  let rows = 0;
  let vpip = 0;
  let pfr = 0;
  let t3o = 0;
  let t3 = 0;
  let sqo = 0;
  let sq = 0;
  let rfiO = 0;
  let rfi = 0;
  let bbOcN = 0;
  let bbOcFold = 0;
  const opens: number[] = [];
  const vs = {
    bb: { n: 0, fold: 0, call: 0, raise: 0 },
    sb: { n: 0, fold: 0, call: 0, raise: 0 },
    field: { n: 0, fold: 0, call: 0, raise: 0 },
  };
  for (let h = 0; h < hands; h++) {
    for (const s of playPreflop(n, depthBB, r, opts)) {
      rows++;
      if (s.vpip) vpip++;
      if (s.pfr) pfr++;
      if (s.rfiOpp) rfiO++;
      if (s.rfi) rfi++;
      if (s.openBB !== null) opens.push(s.openBB);
      if (s.vsOpen) {
        t3o++;
        if (s.vsOpen === 'raise') t3++;
        const g = vs[s.role];
        g.n++;
        g[s.vsOpen]++;
      }
      if (s.vsOpenCaller) {
        t3o++;
        sqo++;
        if (s.vsOpenCaller === 'raise') {
          t3++;
          sq++;
        }
        if (s.role === 'bb') {
          bbOcN++;
          if (s.vsOpenCaller === 'fold') bbOcFold++;
        }
      }
    }
  }
  const norm = (g: { n: number; fold: number; call: number; raise: number }) => ({
    n: g.n,
    fold: pct(g.fold, g.n),
    call: pct(g.call, g.n),
    raise: pct(g.raise, g.n),
  });
  return {
    seats: n,
    hands,
    vpip: pct(vpip, rows),
    pfr: pct(pfr, rows),
    threeBet: pct(t3, t3o),
    squeeze: pct(sq, sqo),
    rfi: pct(rfi, rfiO),
    openAvgBB: opens.length
      ? Math.round((100 * opens.reduce((a, b) => a + b, 0)) / opens.length) / 100
      : 0,
    openMinBB: opens.length ? Math.round(100 * Math.min(...opens)) / 100 : 0,
    openMaxBB: opens.length ? Math.round(100 * Math.max(...opens)) / 100 : 0,
    vsOpen: { bb: norm(vs.bb), sb: norm(vs.sb), field: norm(vs.field) },
    bbVsOpenCallerFold: pct(bbOcFold, bbOcN),
  };
}
