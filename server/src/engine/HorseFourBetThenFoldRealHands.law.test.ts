/**
 * Phase 3 (2026-11-02): the 83 real no-limit hold'em 4-bet-then-fold hands the
 * live (pre-rule-4) engine played between 2026-11-02 04:00 and 16:00 UTC
 * (ca_hand_facts four_bet, never saw the flop, not all in, lost chips; 58
 * cash of 441 4-bets, 25 tournament of 777; pot-limit Omaha, short deck and
 * limit 4-bet-then-fold: 2 of 1,000+), replayed through TODAY's brain at their
 * cards, effective depth and format. Every 5-bet in the sample came from the
 * 3-bettor (82 of 83; one cold 5-bet) and 70 of 83 were all in, so the replay
 * spot is the heads-up 3-bet / 4-bet / jam ladder.
 *
 * The law: no real shape still produces a non-all-in 4-bet followed by a fold
 * to the jam. Rule 4a (flat deep QQ/AK instead of 4-betting), rule 4 (no
 * 4-bet bluff) and rule 4b (a re-raised 4-bettor continues at the price) close
 * every path; a shape that would fold to the jam no longer 4-bets.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import type { Card, SeatPlayer } from '../types.js';

const suits: Record<string, Card['suit']> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  s ? s.split(' ').map((c) => ({ rank: c[0] as Card['rank'], suit: suits[c[1]] })) : [];
const SEEDS = [1, 7, 42, 99, 2026];
const STYLES = ['tag', 'lag', 'balanced', 'tricky', 'grinder'] as const;

function seat(
  n: number,
  stack: number,
  bet: number,
  over: Partial<SeatPlayer> & { hole?: string } = {}
): SeatPlayer {
  return {
    seat: n,
    user_id: `p${n}`,
    username: `p${n}`,
    stack,
    bet,
    totalInvested: bet,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    cards: cards(over.hole ?? ''),
    ...over,
  } as SeatPlayer;
}

function priceSpot(o: {
  hole: string;
  depthBB: number;
  mode: 'cash' | 'tournament';
  fiveBet?: boolean;
  villainDepthBB?: number;
}) {
  const bb = o.mode === 'cash' ? 2 : 100;
  const unit = (v: number) => (o.mode === 'cash' ? Math.round(v * 100) / 100 : Math.round(v));
  const heroTotal = o.depthBB * bb;
  const villainTotal = (o.villainDepthBB ?? o.depthBB) * bb;
  const open = unit(2.5 * bb);
  const three = unit(9 * bb);
  const four = unit(2.3 * three);
  const history = [
    { stage: 'preflop', seat: 2, userId: 'p2', action: 'sb', amount: bb / 2 },
    { stage: 'preflop', seat: 3, userId: 'p3', action: 'bb', amount: bb },
    { stage: 'preflop', seat: 5, userId: 'p5', action: 'raise', amount: open, isFullRaise: true },
    { stage: 'preflop', seat: 6, userId: 'p6', action: 'raise', amount: three, isFullRaise: true },
    { stage: 'preflop', seat: 2, userId: 'p2', action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 3, userId: 'p3', action: 'fold', amount: 0 },
  ];
  const heroBet = o.fiveBet ? four : open;
  const villainBet = o.fiveBet ? villainTotal : three;
  if (o.fiveBet) {
    history.push(
      { stage: 'preflop', seat: 5, userId: 'p5', action: 'raise', amount: four, isFullRaise: true },
      {
        stage: 'preflop',
        seat: 6,
        userId: 'p6',
        action: 'all_in',
        amount: villainTotal,
        isFullRaise: true,
      }
    );
  }
  const hero = seat(5, heroTotal - heroBet, heroBet, { hole: o.hole });
  const gs = {
    players: [
      seat(2, 500 * bb, bb / 2, { is_folded: true }),
      seat(3, 500 * bb, bb, { is_folded: true }),
      hero,
      seat(6, villainTotal - villainBet, villainBet, { is_all_in: !!o.fiveBet }),
    ],
    communityCards: [],
    pot: bb * 1.5 + heroBet + villainBet,
    currentBet: villainBet,
    stage: 'preflop',
    gameVariant: 'nlh',
    gameMode: o.mode,
    bigBlind: bb,
    dealerSeat: 5,
    toCall: villainBet - heroBet,
    legalActions: o.fiveBet ? ['fold', 'call', 'all_in'] : ['fold', 'call', 'raise', 'all_in'],
    minRaiseTo: o.fiveBet ? null : three * 2 - open,
    maxRaiseTo: heroTotal,
    bettingStructure: 'no_limit',
    actionHistory: history,
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

/** [format, hole, effective bb at the deal] for each real hand, deepest first. */
const REAL: Array<['cash' | 'tour', string, number]> = [
  ['cash', 'Qs Qh', 447],
  ['cash', '9s 9h', 433],
  ['cash', 'Ac Kd', 430],
  ['cash', 'Js Jh', 418],
  ['cash', 'Ac Kd', 389],
  ['cash', 'Ac Kd', 383],
  ['cash', 'Ac Kd', 359],
  ['cash', 'Ac Kc', 354],
  ['cash', 'Qs Qh', 341],
  ['cash', 'Ts Th', 336],
  ['cash', 'Ac Kd', 329],
  ['cash', 'Ac Kd', 323],
  ['cash', 'Ac Kc', 314],
  ['cash', 'Ac Kd', 310],
  ['cash', 'Ac Kd', 300],
  ['cash', 'Ac Kd', 298],
  ['cash', 'Qs Qh', 295],
  ['cash', 'Ac Kc', 267],
  ['cash', 'Ac Kd', 266],
  ['cash', 'Qs Qh', 252],
  ['cash', 'Js Jh', 249],
  ['cash', 'Ac Kd', 239],
  ['cash', 'Ac Kc', 238],
  ['cash', 'Ac Jc', 227],
  ['cash', 'Ac Kd', 227],
  ['cash', '9s 9h', 221],
  ['cash', 'Ac Kd', 219],
  ['cash', 'Ac Kd', 217],
  ['cash', 'Ac Kc', 217],
  ['cash', 'Qs Qh', 212],
  ['cash', 'Ac Kc', 208],
  ['cash', 'Ac Kc', 207],
  ['cash', 'Ac Kd', 203],
  ['cash', 'Qs Qh', 202],
  ['cash', 'Js Jh', 202],
  ['cash', 'Qs Qh', 199],
  ['cash', 'Ac Kd', 198],
  ['cash', 'Qs Qh', 197],
  ['cash', 'Ac Kd', 197],
  ['cash', 'Ac Kd', 193],
  ['cash', 'Ac Kd', 192],
  ['cash', 'Ac Kd', 190],
  ['cash', 'Ac Kd', 188],
  ['cash', 'Ac Kd', 188],
  ['cash', 'Qs Qh', 183],
  ['cash', 'Ac Kd', 180],
  ['cash', 'Qs Qh', 179],
  ['cash', 'Ac Kd', 179],
  ['cash', 'Ac Kd', 168],
  ['cash', 'Ac Kc', 166],
  ['cash', 'Ac Kd', 159],
  ['cash', 'Qs Qh', 158],
  ['cash', 'Ac Qc', 140],
  ['cash', 'Ac Kd', 140],
  ['cash', 'Ac Kd', 135],
  ['cash', 'Ac Kd', 111],
  ['cash', 'Ac Kd', 95],
  ['cash', 'Ac Kd', 85],
  ['tour', 'Ac Kc', 135],
  ['tour', 'Ks Kh', 129],
  ['tour', 'Ac Kd', 128],
  ['tour', 'Ks Kh', 111],
  ['tour', 'Qs Qh', 110],
  ['tour', 'Ac Kd', 107],
  ['tour', 'Ts Th', 102],
  ['tour', '9s 9h', 102],
  ['tour', 'Qs Qh', 89],
  ['tour', 'Js Jh', 89],
  ['tour', 'Qs Qh', 89],
  ['tour', 'Ac Kd', 80],
  ['tour', 'Ac Qd', 77],
  ['tour', 'Qs Qh', 72],
  ['tour', 'Ac Kd', 70],
  ['tour', 'Ac Kd', 63],
  ['tour', 'Qs Qh', 62],
  ['tour', 'Ac Kd', 47],
  ['tour', 'Qs Qh', 46],
  ['tour', 'Ts Th', 45],
  ['tour', 'Ac Kd', 43],
  ['tour', 'Ac Jc', 42],
  ['tour', 'Qs Qh', 42],
  ['tour', 'Qs Qh', 40],
  ['tour', 'Ac Kd', 26],
];

function decide(
  s: { hero: SeatPlayer; gs: HorseGameStateV2 },
  seed: number,
  style: (typeof STYLES)[number],
  opts: Record<string, unknown> = {}
) {
  seedFastRandom(seed);
  HorseMind.reset();
  return HorseLogic.decide(s.hero, s.gs, style, {}, { mind: false, ...opts } as never);
}

function fourBetThenFoldPaths(opts: Record<string, unknown> = {}): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const [fmt, hole, depthBB] of REAL) {
    const key = `${fmt}|${hole}|${depthBB}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mode = fmt === 'cash' ? 'cash' : 'tournament';
    for (const style of STYLES) {
      const fourBets = SEEDS.filter(
        (seed) => decide(priceSpot({ hole, depthBB, mode }), seed, style, opts).action === 'raise'
      ).length;
      if (fourBets === 0) continue;
      const folds = SEEDS.filter(
        (seed) =>
          decide(priceSpot({ hole, depthBB, mode, fiveBet: true }), seed, style, opts).action ===
          'fold'
      ).length;
      if (folds > 0) paths.push(`${key} ${style}: 4-bets ${fourBets}/5, folds the jam ${folds}/5`);
    }
  }
  return paths;
}

describe("Phase 3: the real 4-bet-then-fold hands are closed in today's brain", () => {
  afterEach(() => HorseMind.reset());

  it('carries all 83 recorded hands', () => {
    expect(REAL).toHaveLength(83);
    expect(REAL.filter((r) => r[0] === 'cash')).toHaveLength(58);
  });

  it('no real shape 4-bets (not all in) and then folds to the jam, for the same horse style', () => {
    expect(fourBetThenFoldPaths()).toEqual([]);
  });

  it('control: with rule 4 off the same replay reproduces the leak (the law is not vacuous)', () => {
    expect(fourBetThenFoldPaths({ holdemPremiumAggression: false }).length).toBeGreaterThan(0);
  });
});
