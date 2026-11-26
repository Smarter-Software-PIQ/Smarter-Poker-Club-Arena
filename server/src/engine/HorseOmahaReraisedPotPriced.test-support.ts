/**
 * Test support for omahaReraisedPotCallIsPriced / omahaReraisedPotReraiseIsPriced (PLO lead-6 2026-11-24): synthetic
 * PLO4/PLO5 cash preflop spots facing a 3-bet or more (synthetic cards, no recorded player, no id of anyone).
 */
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import { replayProfiles } from './HorseComplaintReplay.js';
import { drainFires } from './BrainTelemetry.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
export const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((t) => ({ rank: t[0] as CardRank, suit: SUIT[t[1]!]! }));

export const RR_HERO = '86000001-0000-4000-8000-00000000a1a1';
export const RR_RAISER = '40000000-0000-4000-8000-00000000b2b2';
export const rrOther = (n: number) => `4000000${n}-0000-4000-8000-00000000c${n}c${n}`;

/** Production's live re-raised-pot rows of 2026-11-24 (the rules this option sits outside of). */
export const RR_LIVE_OPTS: HorseDecideOpts = {
  omahaOopReraisedPotStrongRange: true,
  omahaPreflopReraiseDefencePricedInPosition: true,
  omahaManiacReRaiseWidthMeasured: true,
  omahaEliteContinuesVsMeasuredWideThreeBettor: true,
  omahaNoCallColdFourBetWithoutPremium: true,
  omahaReraiseRangeEarlyPosition: true,
} as HorseDecideOpts;
export const RR_ON: HorseDecideOpts = {
  omahaReraisedPotCallIsPriced: true,
  omahaReraisedPotReraiseIsPriced: true,
} as HorseDecideOpts;

export type RrSpotKind =
  /** BB (seat 2) facing the SB's 3-bet, the opener (seat 3) and a caller (seat 4) still to act behind */
  | 'bbVsSbSqueezeMw'
  /** the cutoff (seat 5) opened, the button (seat 6) 3-bets: heads-up, out of position */
  | 'oopHu'
  /** the button (seat 6) opened, the big blind (seat 2) 3-bets: heads-up, in position */
  | 'ipHu'
  /** the cutoff (hero) opened, the button 3-bet, the cutoff 4-bet, the button 5-bet: heads-up, out of position */
  | 'oopHuFiveBet';

export interface RrSpotOpts {
  variant?: 'plo4' | 'plo5';
  stack?: number;
  tournament?: boolean;
  /** the re-raiser is listed as a Horse instead of a person (identity flip) */
  raiserIsHorse?: boolean;
}

export function rrSpot(
  hole: string,
  kind: RrSpotKind,
  o: RrSpotOpts = {}
): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const variant = o.variant ?? 'plo5';
  const S = o.stack ?? 200;
  const bet: Record<number, number> = { 1: 1, 2: 2, 3: 0, 4: 0, 5: 0, 6: 0 };
  const inHand = new Set<number>();
  const hist: Array<Record<string, unknown>> = [];
  let t = 0;
  let heroSeat = 2;
  let raiserSeat = 1;
  const uid = (s: number) => (s === heroSeat ? RR_HERO : s === raiserSeat ? RR_RAISER : rrOther(s));
  const act = (seat: number, action: string, amount: number) => {
    hist.push({
      stage: 'preflop',
      seat,
      userId: uid(seat),
      action,
      amount,
      ...(action === 'raise' ? { isFullRaise: true } : {}),
      timestamp: ++t,
    });
    if (action !== 'fold') bet[seat] = amount;
    if (action === 'fold') inHand.delete(seat);
    else inHand.add(seat);
  };
  let currentBet = 0;
  if (kind === 'bbVsSbSqueezeMw') {
    heroSeat = 2;
    raiserSeat = 1;
    act(3, 'raise', 7);
    act(4, 'call', 7);
    act(5, 'fold', 0);
    act(6, 'fold', 0);
    act(1, 'raise', 32);
    inHand.add(2);
    currentBet = 32;
  } else if (kind === 'oopHu') {
    heroSeat = 5;
    raiserSeat = 6;
    act(3, 'fold', 0);
    act(4, 'fold', 0);
    act(5, 'raise', 7);
    act(6, 'raise', 24);
    act(1, 'fold', 0);
    act(2, 'fold', 0);
    currentBet = 24;
  } else if (kind === 'ipHu') {
    heroSeat = 6;
    raiserSeat = 2;
    act(3, 'fold', 0);
    act(4, 'fold', 0);
    act(5, 'fold', 0);
    act(6, 'raise', 7);
    act(1, 'fold', 0);
    act(2, 'raise', 24);
    currentBet = 24;
  } else {
    heroSeat = 5;
    raiserSeat = 6;
    act(3, 'fold', 0);
    act(4, 'fold', 0);
    act(5, 'raise', 7);
    act(6, 'raise', 24);
    act(1, 'fold', 0);
    act(2, 'fold', 0);
    act(5, 'raise', 76);
    act(6, 'raise', Math.min(S, 230));
    currentBet = Math.min(S, 230);
  }
  const seats = [1, 2, 3, 4, 5, 6];
  const folded = (n: number) => hist.some((h) => h.seat === n && h.action === 'fold');
  const players = seats.map(
    (n) =>
      ({
        seat: n,
        user_id: uid(n),
        username: `P${n}`,
        stack: S - bet[n]!,
        bet: bet[n],
        totalInvested: bet[n],
        cards: n === heroSeat ? cards(hole) : [],
        is_folded: folded(n),
        is_all_in: S - bet[n]! <= 0,
        is_sitting_out: false,
        is_horse: n === heroSeat || (n === raiserSeat && o.raiserIsHorse === true),
      }) as SeatPlayer
  );
  const heroBet = bet[heroSeat]!;
  const pot = seats.reduce((a, n) => a + bet[n]!, 0);
  const humanUserIds = seats
    .filter((n) => n !== heroSeat && !(n === raiserSeat && o.raiserIsHorse === true))
    .map(uid);
  const toCall = currentBet - heroBet;
  const gs = {
    players,
    communityCards: [],
    pot,
    currentBet,
    toCall,
    minRaise: toCall,
    minRaiseTo: currentBet + toCall,
    maxRaiseTo: Math.min(heroBet + (S - heroBet), currentBet + pot + toCall),
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'preflop',
    gameVariant: variant,
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 6,
    dealtSeatIds: seats,
    humanUserIds,
    gameMode: o.tournament ? 'tournament' : 'cash',
    ...(o.tournament ? { tournamentId: 't-1' } : {}),
    publicMemoryDomain: { speed: 'table' },
    actionHistory: hist,
  } as unknown as HorseGameStateV2;
  return { hero: players.find((p) => p.seat === heroSeat)!, gs };
}

/** A measured 3-bettor: `threeBet` of `opp` re-raise opportunities. */
export function rrSetRead(variant: string, threeBet: number, opp: number): void {
  HorseMind.reset();
  if (opp <= 0) return;
  const c: ExploitCounters = freshExploitCounters();
  Object.assign(c, {
    hands: opp * 2,
    vpip: opp,
    pfr: opp * 0.8,
    rfiOpp: opp,
    rfi: opp * 0.5,
    threeBetOpp: opp,
    threeBet,
    foldTo3BetOpp: 5,
    foldTo3Bet: 1,
  });
  const map = (HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> })
    .exploitCounters;
  for (const size of [2, 4, 6]) map.set(`${readScopeOf(variant, size)}|${RR_RAISER}`, { ...c });
}

export const RR_PROFILE = replayProfiles('cash').find((p) => p.live)!;

export function rrDecide(
  hole: string,
  kind: RrSpotKind,
  opts: HorseDecideOpts,
  seed = 7,
  o: RrSpotOpts = {},
  read: [number, number] = [0, 0]
) {
  const { hero, gs } = rrSpot(hole, kind, o);
  rrSetRead(o.variant ?? 'plo5', read[0], read[1]);
  drainFires();
  seedFastRandom(seed);
  const d = HorseLogic.decide(hero, gs, RR_PROFILE.style, { ...RR_PROFILE.mods }, {
    telemetry: true,
    observeMind: false,
    ...opts,
  } as never);
  const fires = drainFires().map((f) => f.feature);
  return { d, fires };
}

/** Deterministic synthetic hands (a seeded shuffle; no recorded holding). */
export function rrHands(n: number, size: 4 | 5, seed: number): string[] {
  const R = '23456789TJQKA';
  const S = 'cdhs';
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const deck: string[] = [];
    for (const s of S) for (const r of R) deck.push(r + s);
    for (let j = deck.length - 1; j > 0; j--) {
      const k = Math.floor(rnd() * (j + 1));
      [deck[j], deck[k]] = [deck[k]!, deck[j]!];
    }
    out.push(deck.slice(0, size).join(''));
  }
  return out;
}
