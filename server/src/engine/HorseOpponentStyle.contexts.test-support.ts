/**
 * A FIXED SET OF DECISION CONTEXTS for the style read (2026-11-13): hand-built
 * hold'em spots decided through HorseLogic.decide against a synthetic villain,
 * in cash and in tournament. It imports nothing the style read added, so the
 * same file runs unchanged on the commit before the change; its decisions on
 * that commit are pinned in HorseOpponentStyle.off.test.ts (OFF equals current).
 */
import { HorseMind } from './HorseMind.js';
import { HorseLogic } from './HorseLogic.js';
import { saveFastRandom, seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { ExploitCounters } from './HorseOpponentExploit.js';
import { callingStation, frequentBluffer, maniac, tightAggressive, valueHeavyGrinder, type Archetype } from './HorseOpponentStyle.test-support.js';
import type { Card, CardRank, CardSuit, HorseDecision, SeatPlayer } from '../types.js';

/** `bubble` is a tournament one place off the money; `tournament` is mid-field in the money. */
export type Mode = 'cash' | 'tournament' | 'bubble';
export const memoryModeOf = (mode: Mode): 'cash' | 'tournament' => (mode === 'cash' ? 'cash' : 'tournament');
const tournamentContext = (mode: Mode): Record<string, unknown> | undefined =>
  mode === 'cash'
    ? undefined
    : mode === 'bubble'
      ? { entrants: 100, playersLeft: 16, spotsPaid: 15, inMoney: false, nearBubble: true, avgStackChips: 600 }
      : { entrants: 100, playersLeft: 40, spotsPaid: 15, inMoney: true, nearBubble: false, avgStackChips: 400 };
export const HERO = 'aaaaaaaa-0000-4000-8000-000000000001';
export const VILLAIN = 'bbbbbbbb-0000-4000-8000-000000000002';
const FILL = [3, 4, 5, 6].map((n) => `cccccccc-0000-4000-8000-00000000000${n}`);

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
export const cards = (text: string): Card[] => {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
};

interface Seat {
  seat: number;
  id: string;
  stack: number;
  bet: number;
  invested: number;
  cards?: string;
  folded?: boolean;
  allIn?: boolean;
}
const seatOf = (s: Seat): SeatPlayer =>
  ({
    seat: s.seat,
    user_id: s.id,
    username: `p${s.seat}`,
    stack: s.stack,
    bet: s.bet,
    totalInvested: s.invested,
    cards: s.cards ? cards(s.cards) : [],
    is_folded: s.folded === true,
    is_all_in: s.allIn === true,
    is_sitting_out: false,
  }) as unknown as SeatPlayer;

type Act = { stage: string; seat: number; userId: string; action: string; amount: number; isFullRaise?: boolean };
const hist = (acts: Act[]) => acts.map((a, i) => ({ ...a, timestamp: (i + 1) * 4000 }));

export interface Spot {
  name: string;
  hero: SeatPlayer;
  gs: Record<string, unknown>;
}

function state(mode: Mode, stage: string, board: string, pot: number, currentBet: number, minRaise: number, seats: Seat[], acts: Act[], dealerSeat = 6): Record<string, unknown> {
  return {
    players: seats.map(seatOf),
    communityCards: cards(board),
    pot,
    currentBet,
    minRaise,
    stage,
    gameVariant: 'nlh',
    gameMode: mode === 'cash' ? 'cash' : 'tournament',
    ...(mode === 'cash' ? {} : { tournament: tournamentContext(mode) }),
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat,
    actionHistory: hist(acts),
  };
}
const fillers = (): Seat[] => FILL.map((id, i) => ({ seat: i + 3, id, stack: 400, bet: 0, invested: 0, folded: true }));

/** Villain pot-bets the turn into hero's top pair weak kicker (the V65 fixture shape). */
export const turnPotBet = (mode: Mode, heroCards = 'Ks5d', bet = 36): Spot => {
  const seats: Seat[] = [
    { seat: 1, id: HERO, stack: 400, bet: 0, invested: 18, cards: heroCards },
    { seat: 2, id: VILLAIN, stack: 400 - 18 - bet, bet, invested: 18 + bet },
    ...fillers(),
  ];
  const acts: Act[] = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 6 },
    { stage: 'preflop', seat: 1, userId: HERO, action: 'call', amount: 4 },
    { stage: 'flop', seat: 1, userId: HERO, action: 'check', amount: 0 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: 8 },
    { stage: 'flop', seat: 1, userId: HERO, action: 'call', amount: 8 },
    { stage: 'turn', seat: 1, userId: HERO, action: 'check', amount: 0 },
    { stage: 'turn', seat: 2, userId: VILLAIN, action: 'bet', amount: bet },
  ];
  const gs = state(mode, 'turn', 'Kh9d3s7c', 36 + bet, bet, bet, seats, acts, 1);
  return { name: `turn_pot_bet_${mode}${heroCards === 'Ks5d' && bet === 36 ? '' : '_' + heroCards + '_' + bet}`, hero: (gs.players as SeatPlayer[])[0], gs };
};

/** Villain bets 0.75 pot on the river into hero's top pair weak kicker. */
export const riverBigBet = (mode: Mode, heroCards = 'Ks5d', bet = 75): Spot => {
  const seats: Seat[] = [
    { seat: 1, id: HERO, stack: 350, bet: 0, invested: 50, cards: heroCards },
    { seat: 2, id: VILLAIN, stack: 350 - bet, bet, invested: 50 + bet },
    ...fillers(),
  ];
  const acts: Act[] = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 6 },
    { stage: 'preflop', seat: 1, userId: HERO, action: 'call', amount: 4 },
    { stage: 'flop', seat: 1, userId: HERO, action: 'check', amount: 0 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: 10 },
    { stage: 'flop', seat: 1, userId: HERO, action: 'call', amount: 10 },
    { stage: 'turn', seat: 1, userId: HERO, action: 'check', amount: 0 },
    { stage: 'turn', seat: 2, userId: VILLAIN, action: 'bet', amount: 24 },
    { stage: 'turn', seat: 1, userId: HERO, action: 'call', amount: 24 },
    { stage: 'river', seat: 1, userId: HERO, action: 'check', amount: 0 },
    { stage: 'river', seat: 2, userId: VILLAIN, action: 'bet', amount: bet },
  ];
  const gs = state(mode, 'river', 'Kh9d3s7c2d', 100 + bet, bet, bet, seats, acts, 1);
  return { name: `river_big_bet_${mode}${heroCards === 'Ks5d' && bet === 75 ? '' : '_' + heroCards + '_' + bet}`, hero: (gs.players as SeatPlayer[])[0], gs };
};

/** Hero bets the river and the villain raises. */
export const riverRaise = (mode: Mode, heroCards = 'Ks5d'): Spot => {
  const seats: Seat[] = [
    { seat: 1, id: HERO, stack: 330, bet: 40, invested: 80, cards: heroCards },
    { seat: 2, id: VILLAIN, stack: 240, bet: 130, invested: 170 },
    ...fillers(),
  ];
  const acts: Act[] = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 6 },
    { stage: 'preflop', seat: 1, userId: HERO, action: 'call', amount: 4 },
    { stage: 'flop', seat: 1, userId: HERO, action: 'check', amount: 0 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'check', amount: 0 },
    { stage: 'turn', seat: 1, userId: HERO, action: 'check', amount: 0 },
    { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0 },
    { stage: 'river', seat: 1, userId: HERO, action: 'bet', amount: 40 },
    { stage: 'river', seat: 2, userId: VILLAIN, action: 'raise', amount: 130 },
  ];
  const gs = state(mode, 'river', 'Kh9d3s7c2d', 250, 130, 90, seats, acts, 1);
  return { name: `river_raise_${mode}${heroCards === 'Ks5d' ? '' : '_' + heroCards}`, hero: (gs.players as SeatPlayer[])[0], gs };
};

/** Hero bets the flop and the villain raises; deep or short by stack. */
export const flopRaise = (mode: Mode, depth: 'deep' | 'short', heroCards = 'KdJc'): Spot => {
  const deep = depth === 'deep';
  const seats: Seat[] = [
    { seat: 1, id: HERO, stack: deep ? 400 : 70, bet: 10, invested: 16, cards: heroCards },
    { seat: 2, id: VILLAIN, stack: deep ? 370 : 45, bet: 40, invested: 46 },
    ...fillers(),
  ];
  const acts: Act[] = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 6 },
    { stage: 'preflop', seat: 1, userId: HERO, action: 'call', amount: 4 },
    { stage: 'flop', seat: 1, userId: HERO, action: 'bet', amount: 10 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'raise', amount: 40 },
  ];
  const gs = state(mode, 'flop', 'Kh9d3s', 62, 40, 30, seats, acts, 1);
  return { name: `flop_raise_${depth}_${mode}${heroCards === 'KdJc' ? '' : '_' + heroCards}`, hero: (gs.players as SeatPlayer[])[0], gs };
};

/** The villain checks to hero on the river (or the flop): hero decides whether and how much to bet. */
export const checkedTo = (mode: Mode, heroCards: string, stage: 'flop' | 'river' = 'river'): Spot => {
  const seats: Seat[] = [
    { seat: 1, id: HERO, stack: 350, bet: 0, invested: 50, cards: heroCards },
    { seat: 2, id: VILLAIN, stack: 350, bet: 0, invested: 50 },
    ...fillers(),
  ];
  const acts: Act[] = [
    { stage: 'preflop', seat: 1, userId: HERO, action: 'raise', amount: 6 },
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'call', amount: 4 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'check', amount: 0 },
    ...(stage === 'river'
      ? ([
          { stage: 'flop', seat: 1, userId: HERO, action: 'bet', amount: 10 },
          { stage: 'flop', seat: 2, userId: VILLAIN, action: 'call', amount: 10 },
          { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0 },
          { stage: 'turn', seat: 1, userId: HERO, action: 'bet', amount: 24 },
          { stage: 'turn', seat: 2, userId: VILLAIN, action: 'call', amount: 24 },
          { stage: 'river', seat: 2, userId: VILLAIN, action: 'check', amount: 0 },
        ] as Act[])
      : []),
  ];
  const gs = state(mode, stage, stage === 'river' ? 'Kh9d3s7c2d' : 'Kh9d3s', stage === 'river' ? 100 : 12, 0, 2, seats, acts, 2);
  return { name: `checked_to_${stage}_${mode}_${heroCards}`, hero: (gs.players as SeatPlayer[])[0], gs };
};

/** Hero in the big blind faces a 3bb open from under the gun, 100bb deep. */
export const preflopOpen = (mode: Mode, heroCards = 'Qs9s', stack = 200): Spot => {
  const seats: Seat[] = [
    { seat: 1, id: FILL[0], stack, bet: 0, invested: 1, folded: true },
    { seat: 2, id: HERO, stack: stack - 2, bet: 2, invested: 2, cards: heroCards },
    { seat: 3, id: VILLAIN, stack: stack - 6, bet: 6, invested: 6 },
    { seat: 4, id: FILL[1], stack, bet: 0, invested: 0, folded: true },
    { seat: 5, id: FILL[2], stack, bet: 0, invested: 0, folded: true },
    { seat: 6, id: FILL[3], stack, bet: 0, invested: 0, folded: true },
  ];
  const acts: Act[] = [
    { stage: 'preflop', seat: 3, userId: VILLAIN, action: 'raise', amount: 6 },
    { stage: 'preflop', seat: 4, userId: FILL[1], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 5, userId: FILL[2], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 6, userId: FILL[3], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 1, userId: FILL[0], action: 'fold', amount: 0 },
  ];
  const gs = state(mode, 'preflop', '', 9, 6, 4, seats, acts, 6);
  return { name: `preflop_open_${mode}_${heroCards}_${stack}`, hero: (gs.players as SeatPlayer[])[1], gs };
};

/** Hero opened from under the gun and faces a 3-bet from the button. */
export const preflopThreeBet = (mode: Mode, heroCards = 'AdJc', stack = 200): Spot => {
  const seats: Seat[] = [
    { seat: 1, id: FILL[0], stack, bet: 0, invested: 1, folded: true },
    { seat: 2, id: FILL[1], stack, bet: 0, invested: 2, folded: true },
    { seat: 3, id: HERO, stack: stack - 6, bet: 6, invested: 6, cards: heroCards },
    { seat: 4, id: FILL[2], stack, bet: 0, invested: 0, folded: true },
    { seat: 5, id: FILL[3], stack, bet: 0, invested: 0, folded: true },
    { seat: 6, id: VILLAIN, stack: stack - 20, bet: 20, invested: 20 },
  ];
  const acts: Act[] = [
    { stage: 'preflop', seat: 3, userId: HERO, action: 'raise', amount: 6 },
    { stage: 'preflop', seat: 4, userId: FILL[2], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 5, userId: FILL[3], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 6, userId: VILLAIN, action: 'raise', amount: 20 },
    { stage: 'preflop', seat: 1, userId: FILL[0], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 2, userId: FILL[1], action: 'fold', amount: 0 },
  ];
  const gs = state(mode, 'preflop', '', 29, 20, 14, seats, acts, 6);
  return { name: `preflop_3bet_${mode}_${heroCards}_${stack}`, hero: (gs.players as SeatPlayer[])[2], gs };
};

/** Hero in the big blind, 12bb, faces a lone button jam (push/fold depth). */
export const preflopJam = (mode: Mode): Spot => {
  const seats: Seat[] = [
    { seat: 1, id: FILL[0], stack: 40, bet: 0, invested: 1, folded: true },
    { seat: 2, id: HERO, stack: 22, bet: 2, invested: 2, cards: 'Ad9c' },
    { seat: 3, id: FILL[1], stack: 40, bet: 0, invested: 0, folded: true },
    { seat: 4, id: FILL[2], stack: 40, bet: 0, invested: 0, folded: true },
    { seat: 5, id: FILL[3], stack: 40, bet: 0, invested: 0, folded: true },
    { seat: 6, id: VILLAIN, stack: 0, bet: 24, invested: 24, allIn: true },
  ];
  const acts: Act[] = [
    { stage: 'preflop', seat: 3, userId: FILL[1], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 4, userId: FILL[2], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 5, userId: FILL[3], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 6, userId: VILLAIN, action: 'all_in', amount: 24, isFullRaise: true },
    { stage: 'preflop', seat: 1, userId: FILL[0], action: 'fold', amount: 0 },
  ];
  const gs = state(mode, 'preflop', '', 27, 24, 22, seats, acts, 6);
  return { name: `preflop_jam_12bb_${mode}`, hero: (gs.players as SeatPlayer[])[1], gs };
};

export const ALL_SPOTS = (mode: Mode): Spot[] => [
  turnPotBet(mode),
  riverBigBet(mode),
  riverRaise(mode),
  flopRaise(mode, 'deep'),
  flopRaise(mode, 'short'),
  preflopOpen(mode),
  preflopOpen(mode, 'KhJd'),
  preflopThreeBet(mode),
  preflopThreeBet(mode, 'QdQc'),
  preflopJam(mode),
];

export interface Villain {
  /** lifetime tallies, OpponentStats shape (HorseMind.importStats) */
  stats: Record<string, number>;
  counters: ExploitCounters | null;
  /** durable profile qualification */
  complete?: boolean;
}

/** Install the villain's read for one decision, in the decision's own format. */
export function install(v: Villain | null, mode: Mode, size: 'hu' | 'short' | 'full' = 'full'): void {
  const memoryMode = memoryModeOf(mode);
  HorseMind.reset();
  if (!v) return;
  HorseMind.importStats([{ user_id: VILLAIN, ...v.stats }]);
  if (v.counters)
    HorseMind.importDurableOpponentProfiles([
      {
        user_id: VILLAIN,
        variant: 'nlh',
        mode: memoryMode,
        size,
        observed_hands: Math.round(v.counters.hands),
        initialized: v.complete !== false,
        ...(v.complete === false ? {} : { public_memory_domain: { version: 1, speed: 'table', ante: 'none' } }),
        counters: v.counters,
      } as never,
    ]);
}

export interface Decided {
  decision: HorseDecision;
  /** action:amount|random-stream-position, the pinned digest of a decision */
  digest: string;
  fires: Record<string, number>;
}

/** Decide one spot with a fixed seed; the RNG position after the decision is part of the digest. */
export function decide(spot: Spot, opts: Record<string, unknown> = {}, seed = 0x57e1e): Decided {
  seedFastRandom(seed);
  enableBrainTelemetry();
  drainFires();
  const decision = HorseLogic.decide(spot.hero, spot.gs as never, 'balanced', {}, { telemetry: true, ...opts } as never);
  const fires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
  HorseMind.setDecisionScope(null);
  return { decision, digest: `${decision.action}:${decision.amount ?? ''}|${saveFastRandom()}`, fires };
}

const villainOf = (a: Archetype, complete = true): Villain => ({
  stats: { ...a.tallies } as Record<string, number>,
  counters: a.counters,
  complete,
});

/** The synthetic villains every fixed context is decided against (null: no read at all). */
export const VILLAINS: Record<string, Villain | null> = {
  none: null,
  grinder: villainOf(valueHeavyGrinder()),
  maniac: villainOf(maniac()),
  station: villainOf(callingStation()),
  bluffer: villainOf(frequentBluffer()),
  tag: villainOf(tightAggressive()),
};
export const VILLAIN_NAMES = Object.keys(VILLAINS);
