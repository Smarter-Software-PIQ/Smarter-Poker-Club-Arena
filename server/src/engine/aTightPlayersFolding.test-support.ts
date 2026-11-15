/**
 * RESPONSES TO TIGHT PLAYERS (2026-11-15): fixed hold'em spots and synthetic opponents for the regressions of
 * styleTightPlayerExploit and styleStealTightBlinds. Synthetic inputs only; no real player data. Counters are
 * stated at a SATURATED decayed sample (43 hands: the 30-hand half-life caps decayed hands at 43.78), so every
 * read here is one a live player can actually reach (audit F, section 5).
 *
 * Opponents: tightPassive (the target), tightAggressive (a tight player who raises and attacks: the steal and iso
 * rules stand aside), and the controls loose (a calling station), maniac, valueHeavy (tight, his big bets showed
 * down strong) and unknown (no read). Spots go through HorseLogic.decide exactly as the shared style contexts do.
 */
import { createHash } from 'node:crypto';
import { HorseMind } from './HorseMind.js';
import { saveFastRandom } from './HorseEval.js';
import { counters } from './HorseOpponentStyle.test-support.js';
import {
  cards,
  decide,
  HERO,
  VILLAIN,
  type Decided,
  type Spot,
} from './HorseOpponentStyle.contexts.test-support.js';
import { stableReceipt } from './horseDecision/replay/HorseDecisionReplay.js';
import type { SeatPlayer } from '../types.js';
import type { ExploitCounters } from './HorseOpponentExploit.js';

export { HERO, VILLAIN, decide };
export const FILL = [3, 4, 5, 6, 7].map((n) => `dddddddd-0000-4000-8000-00000000000${n}`);
/** A second villain for the steal spots (the other blind). */
export const VILLAIN2 = 'eeeeeeee-0000-4000-8000-000000000002';

export interface Opp {
  stats: Record<string, number>;
  counters: ExploitCounters | null;
  /** in-format river size buckets (shown strength is read from these) */
  buckets?: Record<string, { bets: number; shown: number; strong: number }>;
}

const opp = (
  c: ExploitCounters,
  t: { postAggr: number; postPassive: number; bigBetSD: number; bigBetSDStrong: number }
): Opp => ({
  stats: { hands: 400, rAggr: 3, rPassive: 8, ...t },
  counters: c,
});

/** Tight-passive: VPIP 8%, PFR 3%, no 3-bets, rarely bets when checked to, folds to bets, no big bets shown. */
export const tightPassive = (): Opp => {
  const c = counters({
    hands: 43,
    vpip: 0.08,
    pfr: 0.03,
    threeBetOpp: 18,
    threeBet: 0,
    betCheckedToOpp: 30,
    betCheckedTo: 3,
    foldToBetOpp: 24,
    foldToBet: 15,
  });
  c.riverCallOpp = 20;
  c.riverCall = 6;
  return opp(c, { postAggr: 30, postPassive: 120, bigBetSD: 0, bigBetSDStrong: 0 });
};

/** Tight-aggressive: VPIP 10%, PFR 9%, 3-bets often, bets when checked to. */
export const tightAggressive = (): Opp => {
  const c = counters({
    hands: 43,
    vpip: 0.1,
    pfr: 0.09,
    threeBetOpp: 18,
    threeBet: 3,
    betCheckedToOpp: 30,
    betCheckedTo: 20,
    foldToBetOpp: 24,
    foldToBet: 10,
  });
  c.riverCallOpp = 20;
  c.riverCall = 9;
  return opp(c, { postAggr: 150, postPassive: 50, bigBetSD: 0, bigBetSDStrong: 0 });
};

/** Value-heavy: the same tight-passive frequencies, and his big river bets showed down strong (9 of 10, in format). */
export const valueHeavy = (): Opp => {
  const o = tightPassive();
  return {
    ...o,
    stats: { ...o.stats, bigBetSD: 10, bigBetSDStrong: 9 },
    buckets: { large: { bets: 10, shown: 10, strong: 9 } },
  };
};

/** Loose-passive calling station. */
export const loose = (): Opp => {
  const c = counters({
    hands: 43,
    vpip: 0.55,
    pfr: 0.05,
    threeBetOpp: 18,
    threeBet: 0,
    betCheckedToOpp: 30,
    betCheckedTo: 4,
    foldToBetOpp: 24,
    foldToBet: 4,
  });
  c.riverCallOpp = 20;
  c.riverCall = 15;
  return opp(c, { postAggr: 40, postPassive: 160, bigBetSD: 0, bigBetSDStrong: 0 });
};

/** Maniac: enters and raises most pots, bets everything. */
export const maniac = (): Opp => {
  const c = counters({
    hands: 43,
    vpip: 0.75,
    pfr: 0.55,
    threeBetOpp: 18,
    threeBet: 7,
    betCheckedToOpp: 30,
    betCheckedTo: 26,
    foldToBetOpp: 24,
    foldToBet: 5,
  });
  c.riverCallOpp = 20;
  c.riverCall = 12;
  return opp(c, { postAggr: 300, postPassive: 60, bigBetSD: 12, bigBetSDStrong: 3 });
};

export const OPPONENTS: Record<string, (() => Opp) | null> = {
  tightPassive,
  tightAggressive,
  valueHeavy,
  loose,
  maniac,
  unknown: null,
};

/** Install opponents (id -> profile) for one decision; size is the table size of the decision. */
export function installAll(
  opps: Record<string, Opp | null>,
  size: 'hu' | 'short' | 'full' = 'full'
): void {
  HorseMind.reset();
  for (const [id, o] of Object.entries(opps)) {
    if (!o) continue;
    HorseMind.importStats([{ user_id: id, ...o.stats }] as never);
    if (o.buckets)
      HorseMind.importSizeBuckets([
        { user_id: id, variant: 'nlh', mode: 'cash', size, buckets: o.buckets } as never,
      ]);
    if (o.counters)
      HorseMind.importDurableOpponentProfiles([
        {
          user_id: id,
          variant: 'nlh',
          mode: 'cash',
          size,
          observed_hands: Math.round(o.counters.hands),
          initialized: true,
          public_memory_domain: { version: 1, speed: 'table', ante: 'none' },
          counters: o.counters,
        } as never,
      ]);
  }
}

interface S {
  seat: number;
  id: string;
  stack: number;
  bet: number;
  invested: number;
  cards?: string;
  folded?: boolean;
}
interface A {
  stage: string;
  seat: number;
  userId: string;
  action: string;
  amount: number;
  isFullRaise?: boolean;
}
function build(
  name: string,
  heroSeat: number,
  o: {
    stage: string;
    board: string;
    pot: number;
    currentBet: number;
    minRaise: number;
    dealerSeat: number;
    seats: S[];
    acts: A[];
  }
): Spot {
  const players = o.seats.map(
    (s) =>
      ({
        seat: s.seat,
        user_id: s.id,
        username: `p${s.seat}`,
        stack: s.stack,
        bet: s.bet,
        totalInvested: s.invested,
        cards: s.cards ? cards(s.cards) : [],
        is_folded: s.folded === true,
        is_all_in: false,
        is_sitting_out: false,
      }) as unknown as SeatPlayer
  );
  const gs: Record<string, unknown> = {
    players,
    communityCards: cards(o.board),
    pot: o.pot,
    currentBet: o.currentBet,
    minRaise: o.minRaise,
    stage: o.stage,
    gameVariant: 'nlh',
    gameMode: 'cash',
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: o.dealerSeat,
    actionHistory: o.acts.map((a, i) => ({ ...a, timestamp: (i + 1) * 4000 })),
  };
  return { name, hero: players.find((p) => p.seat === heroSeat)!, gs };
}

const deadFillers = (): S[] =>
  FILL.slice(0, 4).map((id, i) => ({
    seat: i + 3,
    id,
    stack: 400,
    bet: 0,
    invested: 0,
    folded: true,
  }));

/**
 * Heads-up single-raised pot, hero (seat 1, button) in position: the villain (seat 2) checked the flop, hero bet,
 * he called; on the turn he checks to hero (stage 'turn'), or the turn went bet-call and he checks the river.
 */
export const checkedToSpot = (heroCards: string, stage: 'turn' | 'river'): Spot => {
  const acts: A[] = [
    { stage: 'preflop', seat: 1, userId: HERO, action: 'raise', amount: 6 },
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'call', amount: 4 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'check', amount: 0 },
    { stage: 'flop', seat: 1, userId: HERO, action: 'bet', amount: 8 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'call', amount: 8 },
    { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0 },
  ];
  if (stage === 'river')
    acts.push(
      { stage: 'turn', seat: 1, userId: HERO, action: 'bet', amount: 20 },
      { stage: 'turn', seat: 2, userId: VILLAIN, action: 'call', amount: 20 },
      { stage: 'river', seat: 2, userId: VILLAIN, action: 'check', amount: 0 }
    );
  const invested = stage === 'river' ? 34 : 14;
  return build(`checked_to_${stage}_${heroCards}`, 1, {
    stage,
    board: stage === 'river' ? 'Kh9d3s7c2d' : 'Kh9d3s7c',
    pot: invested * 2 + 1,
    currentBet: 0,
    minRaise: 2,
    dealerSeat: 1,
    seats: [
      { seat: 1, id: HERO, stack: 400 - invested, bet: 0, invested, cards: heroCards },
      { seat: 2, id: VILLAIN, stack: 400 - invested, bet: 0, invested },
      ...deadFillers(),
    ],
    acts,
  });
};

/** The same pot with hero out of position (the villain has not acted on this street): not "checked to". */
export const firstToActSpot = (heroCards: string): Spot => {
  const s = checkedToSpot(heroCards, 'river');
  const gs = { ...s.gs, actionHistory: (s.gs.actionHistory as A[]).slice(0, -1) };
  return { ...s, name: `first_to_act_river_${heroCards}`, gs };
};

/**
 * Six-handed cash, blinds 1/2, 200 deep: the villain limps under the gun (seat 3), seat 4 folds, hero (seat 5 cutoff,
 * dealer seat 6) decides; the button and blinds are still to act behind.
 */
export const limpSpot = (heroCards: string, stack = 200): Spot =>
  build(`limp_${heroCards}_${stack}`, 5, {
    stage: 'preflop',
    board: '',
    pot: 5,
    currentBet: 2,
    minRaise: 2,
    dealerSeat: 6,
    seats: [
      { seat: 1, id: FILL[0], stack: stack - 1, bet: 1, invested: 1 },
      { seat: 2, id: FILL[1], stack: stack - 2, bet: 2, invested: 2 },
      { seat: 3, id: VILLAIN, stack: stack - 2, bet: 2, invested: 2 },
      { seat: 4, id: FILL[2], stack, bet: 0, invested: 0, folded: true },
      { seat: 5, id: HERO, stack, bet: 0, invested: 0, cards: heroCards },
      { seat: 6, id: FILL[3], stack, bet: 0, invested: 0 },
    ],
    acts: [
      { stage: 'preflop', seat: 3, userId: VILLAIN, action: 'call', amount: 2 },
      { stage: 'preflop', seat: 4, userId: FILL[2], action: 'fold', amount: 0 },
    ],
  });

/**
 * Six-handed cash, blinds 1/2, 200 deep, folded to hero on the button (seat 6, dealer); the small blind (VILLAIN2,
 * seat 1) and big blind (VILLAIN, seat 2) are left to act. `heroSeat` 5 is the cutoff (the button FILL[3] left to act).
 */
export const stealSpot = (heroCards: string, heroSeat: 5 | 6 = 6, stack = 200): Spot => {
  const seats: S[] = [
    { seat: 1, id: VILLAIN2, stack: stack - 1, bet: 1, invested: 1 },
    { seat: 2, id: VILLAIN, stack: stack - 2, bet: 2, invested: 2 },
    { seat: 3, id: FILL[0], stack, bet: 0, invested: 0, folded: true },
    { seat: 4, id: FILL[1], stack, bet: 0, invested: 0, folded: true },
    {
      seat: 5,
      id: heroSeat === 5 ? HERO : FILL[2],
      stack,
      bet: 0,
      invested: 0,
      folded: heroSeat !== 5,
      ...(heroSeat === 5 ? { cards: heroCards } : {}),
    },
    {
      seat: 6,
      id: heroSeat === 6 ? HERO : FILL[3],
      stack,
      bet: 0,
      invested: 0,
      ...(heroSeat === 6 ? { cards: heroCards } : {}),
    },
  ];
  const acts: A[] = [
    { stage: 'preflop', seat: 3, userId: FILL[0], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 4, userId: FILL[1], action: 'fold', amount: 0 },
  ];
  if (heroSeat === 6)
    acts.push({ stage: 'preflop', seat: 5, userId: FILL[2], action: 'fold', amount: 0 });
  return build(`steal_${heroSeat}_${heroCards}_${stack}`, heroSeat, {
    stage: 'preflop',
    board: '',
    pot: 3,
    currentBet: 2,
    minRaise: 2,
    dealerSeat: 6,
    seats,
    acts,
  });
};

/** The byte-level identity of a decision: the exact-replay identity plus the random stream position after it. */
export const pin = (d: Decided): string =>
  createHash('sha256')
    .update(JSON.stringify(stableReceipt(d.decision)) + '|' + d.digest)
    .digest('hex')
    .slice(0, 16);
export const pinAll = (ds: Decided[]): string =>
  createHash('sha256').update(ds.map(pin).join(',')).digest('hex').slice(0, 16);
export const seeds = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);
export const bets = (ds: Decided[]): number =>
  ds.filter(
    (d) =>
      d.decision.action === 'bet' || d.decision.action === 'raise' || d.decision.action === 'all_in'
  ).length;
export { saveFastRandom };
