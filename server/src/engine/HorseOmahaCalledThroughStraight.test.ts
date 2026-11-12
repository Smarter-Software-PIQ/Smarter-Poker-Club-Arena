/**
 * A STRAIGHT IS NOT A THIRD BARREL WHEN THE FLUSH GETS THERE.
 *
 * Hand 58796916 (PLO4 1/2, 2026-11-12): AsJcJs9s raised, flopped the straight
 * on 8d Tc 7d, bet 29 and 89 and was called twice by the same two players,
 * then moved all in for 225 into 397 when the Kd completed the flush. One of
 * the two callers held a flush. The public state of that river is the case.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { omahaVariantSpot } from '../benchmark/OmahaVariantPolicyEvidence.js';
import { calculateContestablePot, calculatePots } from './PokerEngine.js';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const FIRE = 'horse_continuation_omaha_called_through_straight_check';
const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}

let clock = 0;
const act = (
  seat: number,
  stage: ActionRecord['stage'],
  /** The hand record's own words, blind and ante postings included. */
  action: string,
  amount: number
): ActionRecord => ({
  stage,
  seat,
  userId: seat === 2 ? 'hero' : `v${seat}`,
  action: action as ActionRecord['action'],
  amount,
  timestamp: ++clock,
});

const PREFLOP: ActionRecord[] = [
  act(4, 'preflop', 'sb', 1),
  act(5, 'preflop', 'bb', 2),
  act(5, 'preflop', 'ante', 2),
  act(1, 'preflop', 'call', 2),
  act(2, 'preflop', 'raise', 10),
  act(3, 'preflop', 'call', 10),
  act(4, 'preflop', 'fold', 0),
  act(5, 'preflop', 'call', 8),
  act(1, 'preflop', 'call', 8),
];
const FLOP: ActionRecord[] = [
  act(5, 'flop', 'check', 0),
  act(1, 'flop', 'check', 0),
  act(2, 'flop', 'bet', 29),
  act(3, 'flop', 'call', 29),
  act(5, 'flop', 'fold', 0),
  act(1, 'flop', 'call', 29),
];
const TURN: ActionRecord[] = [
  act(1, 'turn', 'check', 0),
  act(2, 'turn', 'bet', 89),
  act(3, 'turn', 'call', 89),
  act(1, 'turn', 'call', 89),
];
const TURN_CHECKED: ActionRecord[] = [
  act(1, 'turn', 'check', 0),
  act(2, 'turn', 'check', 0),
  act(3, 'turn', 'check', 0),
];
const RIVER: ActionRecord[] = [act(1, 'river', 'check', 0)];

type Spot = {
  hole?: string;
  board?: string;
  /** The first caller has left the hand: one opponent remains. */
  firstCallerFolded?: boolean;
  /** Nobody bet the turn: each caller called one barrel, not two. */
  turnChecked?: boolean;
};

/** [seat, stack, total invested, dead, folded] at the river of hand 58796916. */
const SEATS: Array<[number, number, number, number, boolean]> = [
  [1, 279.7, 128, 0, false],
  [2, 225, 128, 0, false],
  [3, 243.9, 128, 0, false],
  [4, 390, 1, 0, true],
  [5, 447.6, 12, 2, true],
];

function riverSpot(spot: Spot = {}) {
  const input = omahaVariantSpot('plo8', 'river', 5, 'cash');
  input.state.gameVariant = 'plo4';
  input.state.variantRules = horseVariantRulesFor('plo4');
  const turnCalls = spot.turnChecked ? 0 : 89;
  const players = SEATS.map(([seat, stack, invested, dead, folded], index) => {
    const live = seat <= 3;
    return {
      ...input.state.players[index],
      seat,
      user_id: seat === 2 ? 'hero' : `v${seat}`,
      username: seat === 2 ? 'Hero' : `V${seat}`,
      stack: live && spot.turnChecked ? stack + 89 : stack,
      bet: 0,
      totalInvested: live ? invested - 89 + turnCalls : invested,
      deadInvested: dead,
      is_folded: folded || (seat === 1 && !!spot.firstCallerFolded),
      is_all_in: false,
      cards: [],
    } as SeatPlayer;
  });
  const hero: SeatPlayer = {
    ...players[1],
    cards: cards(spot.hole ?? 'AsJcJs9s'),
  };
  const state = input.state;
  state.players = players;
  state.heroSeat = 2;
  state.currentPlayerSeat = 2;
  state.dealerSeat = 3;
  state.blindSeats = { smallBlind: 4, bigBlind: 5 };
  state.communityCards = cards(spot.board ?? '8dTc7d3hKd');
  state.pot = players.reduce((sum, p) => sum + p.totalInvested, 0);
  state.pots = calculatePots(players);
  state.currentBet = 0;
  state.toCall = 0;
  state.contestablePot = calculateContestablePot(players, hero.user_id, 0);
  state.minRaise = 2;
  state.lastRaise = 2;
  state.minRaiseTo = 2;
  state.maxRaiseTo = Math.min(hero.stack, state.pot);
  state.legalActions = ['check', 'bet'];
  state.actionHistory = [
    ...PREFLOP,
    ...FLOP,
    ...(spot.turnChecked ? TURN_CHECKED : TURN),
    ...(spot.firstCallerFolded ? [] : RIVER),
  ];
  return { hero, gs: state };
}

function run(spot: Spot, seeds = 20) {
  const actions: string[] = [];
  let fired = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    HorseMind.reset();
    drainFires();
    seedFastRandom(20261112 + seed);
    const { hero, gs } = riverSpot(spot);
    const decision = HorseLogic.decide(
      hero,
      gs as never,
      'balanced',
      {},
      { mind: false, telemetry: true }
    );
    actions.push(decision.action);
    if (drainFires().some((f: { feature: string }) => f.feature === FIRE)) fired++;
  }
  return { actions, fired, wagers: actions.filter((a) => a !== 'check').length };
}

describe('Omaha river: a straight checks to two two-barrel callers when a flush is possible', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('checks the flopped straight of hand 58796916 when the third diamond comes', () => {
    const out = run({});
    expect(out.actions).toEqual(Array(20).fill('check'));
    expect(out.fired).toBe(20);
  });

  it('checks the same straight when it also holds the bare ace of the flush suit', () => {
    const out = run({ hole: 'AdJcJs9s' });
    expect(out.wagers).toBe(0);
    expect(out.fired).toBe(20);
  });

  it('keeps betting the straight on a river that completes no flush', () => {
    const out = run({ board: '8dTc7d3h2c' });
    expect(out.fired).toBe(0);
    expect(out.wagers).toBe(20);
  });

  it('keeps betting the nut flush on the same river', () => {
    const out = run({ hole: 'AdJdJs9s' });
    expect(out.fired).toBe(0);
    expect(out.wagers).toBe(20);
  });

  it('does not apply when one of the two callers has left the hand', () => {
    expect(run({ firstCallerFolded: true }).fired).toBe(0);
  });

  it('does not apply when the callers called one barrel, not two', () => {
    expect(run({ turnChecked: true }).fired).toBe(0);
  });
});
