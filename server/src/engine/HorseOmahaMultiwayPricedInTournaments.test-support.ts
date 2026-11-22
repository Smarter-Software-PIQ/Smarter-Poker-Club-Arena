/**
 * Fixtures of omahaMultiwayIsPricedInTournaments: the auditor-F hands
 * (archive plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J/F-plo-tournament,
 * decisions.csv) rebuilt as public spots. Each carries the recorded Horse
 * cards, board, pot, price, stack, game and number of opponents; the
 * opponents' preflop lines are reconstructed to be consistent with the
 * recorded pot, price and the number of players still to act (the csv keeps
 * the counts, not the sequence). Chips: one big blind is 100.
 */
import type { ActionRecord, ActionType, Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { horseVariantRulesFor } from './VariantRules.js';

const BB = 100;

export function cards(value: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < value.length; i += 2)
    out.push({
      rank: value[i] as Card['rank'],
      suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[value[i + 1] as 'c'],
    });
  return out;
}

export interface FixtureOpponent {
  /** chips in the pot this hand, big blinds */
  inBB: number;
  /** chips behind, big blinds (0 when all in) */
  behindBB: number;
  allIn?: boolean;
  /** still to act this street: no action recorded for him */
  toAct?: boolean;
}

export interface MwFixture {
  id: string;
  ordinal: number;
  variant: 'plo4' | 'plo5' | 'plo6' | 'plo8';
  street: 'preflop' | 'flop' | 'turn' | 'river';
  hero: string;
  board: string;
  heroInBB: number;
  heroBehindBB: number;
  potBB: number;
  toCallBB: number;
  /** the auditor's bubble factor for the spot */
  bubbleFactor: number;
  opponents: FixtureOpponent[];
  /** the recorded preflop sequence: opponent index (0-based) and action */
  preflop: [number, ActionType, boolean?][];
  /** earlier postflop actions of the hand: opponent index (-1: the Horse), street, action */
  earlier?: [number, 'flop' | 'turn', ActionType][];
  /** the recorded Horse decision */
  decision: Pick<HorseDecision, 'action' | 'amount'>;
}

/** Preflop multiway call-offs with dead equity (REPORT.md class 2, CLEAR). */
export const CALL_OFF_FIXTURES: readonly MwFixture[] = [
  {
    id: '26481a02-3f27-430d-b5b8-870b64377305',
    ordinal: 5,
    variant: 'plo4',
    street: 'preflop',
    hero: '8hThKs9h',
    board: '',
    heroInBB: 0.5,
    heroBehindBB: 9.02,
    potBB: 13,
    toCallBB: 8.5,
    bubbleFactor: 1.3,
    // a 9 bb shove, a 2.5 bb all-in under it, the big blind to act
    opponents: [
      { inBB: 9, behindBB: 0, allIn: true },
      { inBB: 2.5, behindBB: 0, allIn: true },
      { inBB: 1, behindBB: 20, toAct: true },
    ],
    preflop: [
      [0, 'all_in', true],
      [1, 'all_in', false],
    ],
    decision: { action: 'call' },
  },
  {
    id: 'ab7eb573-038c-4e38-8125-0ba866c0a7ce',
    ordinal: 7,
    variant: 'plo8',
    street: 'preflop',
    hero: '4h8h3dTs',
    board: '',
    heroInBB: 0.5,
    heroBehindBB: 7.85,
    potBB: 15,
    toCallBB: 7.85,
    bubbleFactor: 1,
    // a limp, a short shove over it, an all-in caller, the big blind to act
    opponents: [
      { inBB: 1, behindBB: 25 },
      { inBB: 8.35, behindBB: 0, allIn: true },
      { inBB: 3.15, behindBB: 0, allIn: true },
      { inBB: 1, behindBB: 20, toAct: true },
    ],
    preflop: [
      [0, 'call'],
      [1, 'all_in', true],
      [2, 'all_in', false],
    ],
    decision: { action: 'all_in' },
  },
  {
    id: '3333550b-3239-42c7-a04c-abe4363948e0',
    ordinal: 4,
    variant: 'plo8',
    street: 'preflop',
    hero: '8hAdTdTc',
    board: '',
    heroInBB: 0,
    heroBehindBB: 11.12,
    potBB: 17,
    toCallBB: 11.12,
    bubbleFactor: 1,
    // a shove and an all-in caller in front, four players (blinds included) to act
    opponents: [
      { inBB: 11.5, behindBB: 0, allIn: true },
      { inBB: 4, behindBB: 0, allIn: true },
      { inBB: 0, behindBB: 30, toAct: true },
      { inBB: 0, behindBB: 30, toAct: true },
      { inBB: 0.5, behindBB: 30, toAct: true },
      { inBB: 1, behindBB: 30, toAct: true },
    ],
    preflop: [
      [0, 'all_in', true],
      [1, 'all_in', false],
    ],
    decision: { action: 'all_in' },
  },
  {
    id: '83b75804-b72e-4109-96b0-a2358b509f1d',
    ordinal: 7,
    variant: 'plo5',
    street: 'preflop',
    hero: '2dJs3hQsQh',
    board: '',
    heroInBB: 0,
    heroBehindBB: 23.62,
    potBB: 17,
    toCallBB: 12,
    bubbleFactor: 1,
    // an open to 3 and a re-raise to 12; the blinds to act
    opponents: [
      { inBB: 3, behindBB: 30 },
      { inBB: 12, behindBB: 25 },
      { inBB: 0.5, behindBB: 30, toAct: true },
      { inBB: 1, behindBB: 30, toAct: true },
    ],
    preflop: [
      [0, 'raise'],
      [1, 'raise'],
    ],
    decision: { action: 'call' },
  },
  {
    id: '6dade3bd-46f1-4c30-abb2-f8e6d2664f29',
    ordinal: 5,
    variant: 'plo8',
    street: 'preflop',
    hero: '6sTd2c7h',
    board: '',
    heroInBB: 0,
    heroBehindBB: 8.22,
    potBB: 16.11,
    toCallBB: 8.22,
    bubbleFactor: 1,
    opponents: [
      { inBB: 8.3, behindBB: 0, allIn: true },
      { inBB: 6.31, behindBB: 0, allIn: true },
      { inBB: 0, behindBB: 30, toAct: true },
      { inBB: 0.5, behindBB: 30, toAct: true },
      { inBB: 1, behindBB: 30, toAct: true },
    ],
    preflop: [
      [0, 'all_in', true],
      [1, 'all_in', false],
    ],
    decision: { action: 'all_in' },
  },
  {
    id: '88e6c8f3-f013-4e3e-b552-5145a75089dd',
    ordinal: 9,
    variant: 'plo8',
    street: 'preflop',
    hero: 'Jd5c2cQd',
    board: '',
    heroInBB: 1,
    heroBehindBB: 8.15,
    potBB: 26.96,
    toCallBB: 8.15,
    bubbleFactor: 1,
    // a shove, a caller with chips behind, two all-in callers; nobody to act
    opponents: [
      { inBB: 9.15, behindBB: 0, allIn: true },
      { inBB: 9.15, behindBB: 20 },
      { inBB: 4.33, behindBB: 0, allIn: true },
      { inBB: 3.33, behindBB: 0, allIn: true },
    ],
    preflop: [
      [0, 'all_in', true],
      [1, 'call'],
      [2, 'all_in', false],
      [3, 'all_in', false],
    ],
    decision: { action: 'all_in' },
  },
];

/** Postflop multiway bets that lose to the check (REPORT.md class 3, CLEAR). */
export const BET_FIXTURES: readonly MwFixture[] = [
  {
    id: 'b070b36b-28da-45ef-92bc-2505ce9b3943',
    ordinal: 13,
    variant: 'plo4',
    street: 'turn',
    hero: 'AsTh6dQc',
    board: '7dTc8hQh',
    heroInBB: 0,
    heroBehindBB: 28.6,
    potBB: 25,
    toCallBB: 0,
    bubbleFactor: 1,
    // an open and two calls before the flop; the Horse first to act on the turn
    opponents: [
      { inBB: 0, behindBB: 40, toAct: true },
      { inBB: 0, behindBB: 40, toAct: true },
      { inBB: 0, behindBB: 40, toAct: true },
    ],
    preflop: [
      [0, 'raise'],
      [1, 'call'],
      [2, 'call'],
    ],
    // the pot of 25 bb: a flop bet called three times
    earlier: [
      [0, 'flop', 'bet'],
      [1, 'flop', 'call'],
      [2, 'flop', 'call'],
      [-1, 'flop', 'call'],
    ],
    decision: { action: 'bet', amount: 1630.9 },
  },
  {
    id: 'f9962d3c-278c-433e-888e-c489a5820c52',
    ordinal: 10,
    variant: 'plo4',
    street: 'flop',
    hero: '8hJsKh7s',
    board: '4h8d5d',
    heroInBB: 0,
    heroBehindBB: 32.16,
    potBB: 13,
    toCallBB: 0,
    bubbleFactor: 1,
    // an open and two calls before the flop, checked to the button
    opponents: [
      { inBB: 0, behindBB: 40 },
      { inBB: 0, behindBB: 40 },
      { inBB: 0, behindBB: 40 },
    ],
    preflop: [
      [0, 'raise'],
      [1, 'call'],
      [2, 'call'],
    ],
    decision: { action: 'bet', amount: 536.9 },
  },
  {
    id: '583495d0-b3d8-451e-8f3a-f7d6d89db01f',
    ordinal: 14,
    variant: 'plo5',
    street: 'flop',
    hero: '7cKh7sTcAs',
    board: '3h8cJc',
    heroInBB: 0,
    heroBehindBB: 3.92,
    potBB: 12.5,
    toCallBB: 0,
    bubbleFactor: 1,
    opponents: [
      { inBB: 0, behindBB: 30 },
      { inBB: 0, behindBB: 30 },
    ],
    preflop: [
      [0, 'raise'],
      [1, 'call'],
    ],
    decision: { action: 'all_in' },
  },
];

/** The fixture as the engine hands it to the brain. */
export function fixtureSpot(f: MwFixture): {
  hero: SeatPlayer;
  state: HorseGameStateV2;
  decision: HorseDecision;
} {
  const chips = (bb: number) => Math.round(bb * BB * 100) / 100;
  const pre = f.street === 'preflop';
  const hero: SeatPlayer = {
    user_id: 'hero',
    username: 'Hero',
    seat: 1,
    stack: chips(f.heroBehindBB),
    bet: pre ? chips(f.heroInBB) : 0,
    totalInvested: chips(f.heroInBB),
    cards: cards(f.hero),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  } as SeatPlayer;
  const opps: SeatPlayer[] = f.opponents.map(
    (o, i) =>
      ({
        user_id: `v${i + 2}`,
        username: `V${i + 2}`,
        seat: i + 2,
        stack: chips(o.behindBB),
        bet: pre ? chips(o.inBB) : 0,
        totalInvested: chips(o.inBB),
        cards: [],
        is_folded: false,
        is_all_in: o.allIn === true,
        is_sitting_out: false,
      }) as SeatPlayer
  );
  const players = [hero, ...opps];
  const currentBet = pre ? Math.max(hero.bet, ...opps.map((p) => p.bet)) : 0;
  const history: ActionRecord[] = f.preflop.map(([i, action, full], k) => ({
    seat: i + 2,
    userId: `v${i + 2}`,
    action,
    amount: chips(f.opponents[i].inBB),
    timestamp: k + 1,
    stage: 'preflop',
    ...(full !== undefined ? { isFullRaise: full } : {}),
  }));
  if (!pre) {
    // the Horse called before the flop; later streets checked to it where it acts last
    history.push({
      seat: 1,
      userId: 'hero',
      action: 'call',
      amount: 0,
      timestamp: 50,
      stage: 'preflop',
    });
    (f.earlier ?? []).forEach(([i, street, action], k) => {
      history.push({
        seat: i < 0 ? 1 : i + 2,
        userId: i < 0 ? 'hero' : `v${i + 2}`,
        action,
        amount: 0,
        timestamp: 55 + k / 10,
        stage: street,
      });
    });
    f.opponents.forEach((o, i) => {
      if (o.toAct) return;
      history.push({
        seat: i + 2,
        userId: `v${i + 2}`,
        action: 'check',
        amount: 0,
        timestamp: 60 + i,
        stage: f.street,
      });
    });
  }
  const state: HorseGameStateV2 = {
    players,
    communityCards: cards(f.board),
    pot: chips(f.potBB),
    currentBet,
    contestablePot: chips(f.potBB),
    minRaise: BB,
    lastRaise: BB,
    stage: f.street,
    gameVariant: f.variant,
    bigBlind: BB,
    stateSchemaVersion: 1,
    gameMode: 'tournament',
    format: 'mtt',
    dealerSeat: players.length,
    heroSeat: 1,
    currentPlayerSeat: 1,
    bettingStructure: 'pot_limit',
    variantRules: horseVariantRulesFor(f.variant),
    fixedBetSize: null,
    wagersCapped: false,
    commitmentCapRemaining: null,
    legalActions: pre ? ['fold', 'call', 'raise', 'all_in'] : ['fold', 'check', 'bet', 'all_in'],
    toCall: chips(f.toCallBB),
    minRaiseTo: pre ? currentBet + BB : BB,
    maxRaiseTo: hero.stack + hero.bet,
    actionHistory: history,
  } as HorseGameStateV2;
  const decision = { ...f.decision, thinkTime: 1000 } as HorseDecision;
  if (decision.amount !== undefined) decision.amount = chips(decision.amount / BB);
  return { hero, state, decision };
}
