/**
 * A STRAIGHT IS NOT A THIRD BARREL WHEN THE FLUSH GETS THERE.
 *
 * Hand 58796916 (PLO4 1/2, 2026-11-12): AsJcJs9s raised, flopped the straight
 * on 8d Tc 7d, bet 29 and 89 and was called twice by the same two players,
 * then moved all in for 225 into 397 when the Kd completed the flush. One of
 * the two callers held a flush. The public state of that river is the case.
 *
 * The law below it: a straight never fires a third barrel into a player who
 * called the first two when a flush or a full house is possible on the board,
 * in any Omaha high variant, against two such callers or one.
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
  variant?: 'plo4' | 'plo5' | 'plo6' | 'plo8';
  /** The first caller is all in: still in the hand, no longer a live caller. */
  firstCallerAllIn?: boolean;
  heroStack?: number;
  mode?: 'cash' | 'tournament';
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
  const input = omahaVariantSpot('plo8', 'river', 5, spot.mode ?? 'cash');
  const variant = spot.variant ?? 'plo4';
  input.state.gameVariant = variant;
  input.state.variantRules = horseVariantRulesFor(variant);
  const turnCalls = spot.turnChecked ? 0 : 89;
  const players = SEATS.map(([seat, stack, invested, dead, folded], index) => {
    const live = seat <= 3;
    return {
      ...input.state.players[index],
      seat,
      user_id: seat === 2 ? 'hero' : `v${seat}`,
      username: seat === 2 ? 'Hero' : `V${seat}`,
      stack:
        seat === 1 && spot.firstCallerAllIn
          ? 0
          : seat === 2 && spot.heroStack !== undefined
            ? spot.heroStack
            : live && spot.turnChecked
              ? stack + 89
              : stack,
      bet: 0,
      totalInvested: live ? invested - 89 + turnCalls : invested,
      deadInvested: dead,
      is_folded: folded || (seat === 1 && !!spot.firstCallerFolded),
      is_all_in: seat === 1 && !!spot.firstCallerAllIn,
      cards: [],
    } as SeatPlayer;
  });
  const hero: SeatPlayer = {
    ...players[1],
    // The extra cards make no pair, straight or flush with any board used here.
    cards: cards(
      (spot.hole ?? 'AsJcJs9s') +
        (variant === 'plo4' || variant === 'plo8' ? '' : variant === 'plo5' ? '2s' : '2s4c')
    ),
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
  if (state.tournament) {
    state.tournament.stacks = players.map((p) => p.stack + p.totalInvested);
    state.tournament.stackByUser = Object.fromEntries(
      players.map((p) => [p.user_id, p.stack + p.totalInvested])
    );
  }
  state.actionHistory = [
    ...PREFLOP,
    ...FLOP,
    ...(spot.turnChecked ? TURN_CHECKED : TURN),
    ...(spot.firstCallerFolded ? [] : RIVER),
  ];
  return { hero, gs: state };
}

function run(spot: Spot, seeds = 20, v40CalledThroughStraight = true) {
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
      { mind: false, telemetry: true, v40CalledThroughStraight }
    );
    actions.push(decision.action);
    if (drainFires().some((f: { feature: string }) => f.feature === FIRE)) fired++;
  }
  return { actions, fired, wagers: actions.filter((a) => a !== 'check').length };
}

const FLUSH_RIVER = '8dTc7d3hKd';
const PAIRED_RIVER = '8dTc7s3h8h';
const BLANK_RIVER = '8dTc7s3h2c';

describe('Omaha river: a straight is not a third barrel when a flush or a full house is possible', () => {
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

  it('checks it against the one opponent left who called both barrels', () => {
    const out = run({ firstCallerFolded: true });
    expect(out.wagers).toBe(0);
    expect(out.fired).toBe(20);
  });

  it('checks it when the river pairs the board, against two callers and against one', () => {
    for (const firstCallerFolded of [false, true]) {
      const out = run({ board: PAIRED_RIVER, firstCallerFolded });
      expect(out.wagers).toBe(0);
      expect(out.fired).toBe(20);
    }
  });

  it('holds in every Omaha high variant, on both boards, against two callers and one', () => {
    for (const variant of ['plo4', 'plo5', 'plo6'] as const)
      for (const board of [FLUSH_RIVER, PAIRED_RIVER])
        for (const firstCallerFolded of [false, true]) {
          const out = run({ variant, board, firstCallerFolded }, 8);
          expect([variant, board, firstCallerFolded, out.wagers]).toEqual([
            variant,
            board,
            firstCallerFolded,
            0,
          ]);
        }
  });

  it('keeps the earlier value bet behind the explicit off arm', () => {
    const out = run({}, 20, false);
    expect(out.fired).toBe(0);
    expect(out.wagers).toBe(20);
  });

  it('keeps betting the straight on a river that completes nothing, against two callers and one', () => {
    for (const firstCallerFolded of [false, true]) {
      const out = run({ board: BLANK_RIVER, firstCallerFolded });
      expect(out.fired).toBe(0);
      expect(out.wagers).toBe(20);
    }
  });

  it('keeps betting the nut flush on the same river', () => {
    const out = run({ hole: 'AdJdJs9s' });
    expect(out.fired).toBe(0);
    expect(out.wagers).toBe(20);
  });

  it('does not apply when the callers called one barrel, not two', () => {
    expect(run({ turnChecked: true }).fired).toBe(0);
    expect(run({ turnChecked: true, firstCallerFolded: true }).fired).toBe(0);
  });

  // Eligibility cases asked for by the study's analysis owner (E9, 2026-11-12).
  it('checks with a short stack behind as well', () => {
    const out = run({ heroStack: 40 });
    expect(out.wagers).toBe(0);
    expect(out.fired).toBe(20);
  });

  it('checks in a tournament as in a cash game', () => {
    const out = run({ mode: 'tournament' });
    expect(out.wagers).toBe(0);
    expect(out.fired).toBe(20);
  });

  it('does not apply in Hi-Lo when a low is possible', () => {
    // 8-7-3 on the flush river: half the pot can go to a low, so this is a
    // split-pot decision the rule leaves to the Hi-Lo logic.
    expect(run({ variant: 'plo8' }).fired).toBe(0);
  });

  it('does not count a caller who is all in as a live two-barrel caller', () => {
    // Two opponents remain but only one can still act: neither the two-caller
    // nor the heads-up form holds, and the rule stays out of the side pot.
    expect(run({ firstCallerAllIn: true }).fired).toBe(0);
  });

  it('never fires for a full house on the paired river', () => {
    for (const firstCallerFolded of [false, true])
      expect(run({ hole: 'TsTh2c4s', board: PAIRED_RIVER, firstCallerFolded }).fired).toBe(0);
  });
});
