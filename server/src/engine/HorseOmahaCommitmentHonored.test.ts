/**
 * V88: A COMMITMENT IS HONORED ON A BLANK.
 *
 * Hand 58656644 (PLO5 1/2, 2026-11-11): AAJ64 four-bet, bet J-3-2 rainbow,
 * called a check-raise that left 936 behind a 1,212 pot, then folded to a pot
 * bet on a 7 that completed nothing. The exact public state is the regression.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { omahaVariantSpot } from '../benchmark/OmahaVariantPolicyEvidence.js';
import { calculateContestablePot, calculatePots } from './PokerEngine.js';
import { HorseLogic, V88_COMMITMENT_MAX_PRICE } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { ActionRecord, Card, CardRank, CardSuit } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}

type Spot = {
  variant?: 'plo5' | 'plo6' | 'plo8';
  mode?: 'cash' | 'tournament';
  hole?: string;
  board?: string;
  previousStreet?: ActionRecord[];
};

const act = (
  stage: ActionRecord['stage'],
  hero: boolean,
  action: ActionRecord['action'],
  amount: number,
  timestamp: number
): ActionRecord => ({
  stage,
  seat: hero ? 1 : 2,
  userId: hero ? 'hero' : 'v2',
  action,
  amount,
  timestamp,
});

/** Flop: villain checks, hero bets 133, villain raises to 438, hero calls 305. */
const CALLED_CHECK_RAISE: ActionRecord[] = [
  act('flop', false, 'check', 0, 1),
  act('flop', true, 'bet', 133, 2),
  act('flop', false, 'raise', 438, 3),
  act('flop', true, 'call', 305, 4),
];

/** Turn of hand 58656644: 1,212 in the middle, villain pots it, hero has 936.25. */
function turnSpot(spot: Spot = {}) {
  const variant = spot.variant ?? 'plo5';
  const input = omahaVariantSpot(variant, 'turn', 2, spot.mode ?? 'cash');
  input.hero.cards = cards(spot.hole ?? 'AsAcJc6d4d');
  input.hero.stack = 936.25;
  input.hero.bet = 0;
  input.hero.totalInvested = 586;
  Object.assign(input.state.players[0], { stack: 936.25, bet: 0, totalInvested: 586, cards: [] });
  Object.assign(input.state.players[1], { stack: 26.2, bet: 1212, totalInvested: 1798 });
  input.state.communityCards = cards(spot.board ?? '2d3sJh7d');
  input.state.pot = 2424;
  input.state.pots = calculatePots(input.state.players);
  input.state.currentBet = 1212;
  input.state.contestablePot = calculateContestablePot(
    input.state.players,
    input.hero.user_id,
    1212
  );
  input.state.toCall = 1212;
  input.state.minRaise = 1212;
  input.state.lastRaise = 1212;
  input.state.legalActions = ['fold', 'call'];
  input.state.actionHistory = [
    ...(spot.previousStreet ?? CALLED_CHECK_RAISE),
    act('turn', false, 'bet', 1212, 9),
  ];
  return { hero: input.hero, gs: input.state };
}

function decide(spot: Spot, v88CommitmentHonored: boolean) {
  HorseMind.reset();
  drainFires();
  seedFastRandom(20261111);
  const { hero, gs } = turnSpot(spot);
  const decision = HorseLogic.decide(
    hero,
    gs as never,
    'balanced',
    {},
    {
      mind: false,
      telemetry: true,
      v88CommitmentHonored,
    }
  );
  const fires = drainFires().map((f: { feature: string }) => f.feature);
  return { action: decision.action, amount: decision.amount, fires };
}

describe('V88 a committed Omaha stack does not fold a blank', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('prices one third of the pot plus the rake margin and nothing dearer', () => {
    expect(V88_COMMITMENT_MAX_PRICE).toBe(0.345);
  });

  it('hand 58656644: folded the blank turn before, calls it now', () => {
    const before = decide({}, false);
    expect(before.action).toBe('fold');
    expect(before.fires).not.toContain('v88_commitment_honored');

    const after = decide({}, true);
    expect(after.action).toBe('call');
    expect(after.fires).toContain('v88_commitment_honored');
  });

  it('is on by default', () => {
    HorseMind.reset();
    seedFastRandom(20261111);
    const { hero, gs } = turnSpot();
    const decision = HorseLogic.decide(
      hero,
      gs as never,
      'balanced',
      {},
      {
        mind: false,
        telemetry: true,
      }
    );
    expect(decision.action).toBe('call');
  });

  const unchanged: Array<[string, Spot]> = [
    [
      'a hand that bet the previous street and was only called',
      { previousStreet: [act('flop', true, 'bet', 438, 1), act('flop', false, 'call', 438, 2)] },
    ],
    [
      'a hand that checked the previous street through',
      { previousStreet: [act('flop', false, 'check', 0, 1), act('flop', true, 'check', 0, 2)] },
    ],
    ['a turn that pairs the board under trips', { board: '2d3sJh3c' }],
    [
      'a turn that completes a flush the hand does not hold',
      { hole: 'AsAcJc6h4h', board: '2d3dJh9d' },
    ],
    ['a hand with no pair', { hole: 'KsQc9c6d4d' }],
    ['a tournament', { mode: 'tournament' }],
    ['Hi-Lo', { variant: 'plo8', hole: 'AsAcJc6d' }],
  ];
  it.each(unchanged)('leaves %s to the existing pricing', (_name, spot) => {
    const off = decide(spot, false);
    const on = decide(spot, true);
    expect(on.action).toBe(off.action);
    expect(on.amount).toBe(off.amount);
    expect(on.fires).not.toContain('v88_commitment_honored');
  });
});
