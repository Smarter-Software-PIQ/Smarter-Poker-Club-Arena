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

type Chips = {
  stack: number;
  bet: number;
  totalInvested: number;
  is_all_in?: boolean;
};

type Spot = {
  variant?: 'plo5' | 'plo6' | 'plo8';
  mode?: 'cash' | 'tournament';
  street?: 'turn' | 'river';
  hole?: string;
  board?: string;
  previousStreet?: ActionRecord[];
  /** The whole action record, when the facing street is not one pot bet. */
  history?: ActionRecord[];
  heroChips?: Chips;
  villainChips?: Chips;
  /** A third player who put money in and folded before the decision. */
  foldedChips?: Chips;
};

const act = (
  stage: ActionRecord['stage'],
  hero: boolean,
  action: ActionRecord['action'],
  amount: number,
  timestamp: number,
  extra: Partial<ActionRecord> = {}
): ActionRecord => ({
  stage,
  seat: hero ? 1 : 2,
  userId: hero ? 'hero' : 'v2',
  action,
  amount,
  timestamp,
  ...extra,
});

/** The third player, who folds before the decision. */
const third = (
  stage: ActionRecord['stage'],
  action: ActionRecord['action'],
  amount: number,
  timestamp: number
): ActionRecord => ({ stage, seat: 3, userId: 'v3', action, amount, timestamp });

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
  const heroChips = spot.heroChips ?? { stack: 936.25, bet: 0, totalInvested: 586 };
  const villainChips = spot.villainChips ?? { stack: 26.2, bet: 1212, totalInvested: 1798 };
  const input = omahaVariantSpot(
    variant,
    spot.street ?? 'turn',
    spot.foldedChips ? 3 : 2,
    spot.mode ?? 'cash'
  );
  input.hero.cards = cards(spot.hole ?? 'AsAcJc6d4d');
  Object.assign(input.hero, heroChips);
  Object.assign(input.state.players[0], { ...heroChips, cards: [] });
  Object.assign(input.state.players[1], villainChips);
  if (spot.foldedChips)
    Object.assign(input.state.players[2], { ...spot.foldedChips, is_folded: true });
  const owed = villainChips.bet - heroChips.bet;
  input.state.communityCards = cards(spot.board ?? '2d3sJh7d');
  input.state.pot = spot.heroChips
    ? input.state.players.reduce((sum, p) => sum + p.totalInvested, 0)
    : 2424;
  input.state.pots = calculatePots(input.state.players);
  input.state.currentBet = villainChips.bet;
  input.state.contestablePot = calculateContestablePot(
    input.state.players,
    input.hero.user_id,
    owed
  );
  input.state.toCall = owed;
  input.state.minRaise = owed;
  input.state.lastRaise = owed;
  input.state.legalActions = ['fold', 'call'];
  input.state.actionHistory = spot.history ?? [
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
  return {
    action: decision.action,
    amount: decision.amount,
    guard: decision.continuationGuard,
    fires,
  };
}

/** Three-handed flop: the 58656644 flop line with a third player calling the raise too. */
const THREE_WAY_FLOP: ActionRecord[] = [...CALLED_CHECK_RAISE, third('flop', 'call', 438, 5)];

/**
 * Turn, three-handed: the villain bets 300, the third player raises to 900, hero calls the 900,
 * the villain moves all in and the third player folds. Hero is heads-up for 3,637 more at a
 * price of 0.31 without having bet or raised the street.
 */
const JAM_OVER_A_RAISED_BET: Spot = {
  heroChips: { stack: 3637, bet: 900, totalInvested: 1486 },
  villainChips: { stack: 0, bet: 6000, totalInvested: 6586, is_all_in: true },
  foldedChips: { stack: 2000, bet: 900, totalInvested: 1486 },
  history: [
    ...THREE_WAY_FLOP,
    act('turn', false, 'bet', 300, 9),
    third('turn', 'raise', 900, 10),
    act('turn', true, 'call', 900, 11),
    act('turn', false, 'all_in', 6000, 12, { isFullRaise: true }),
    third('turn', 'fold', 0, 13),
  ],
};

/**
 * Turn, three-handed: the third player bets 300, hero calls, the villain raises to 4,000 and
 * the third player folds. Hero is heads-up for 2,400 more at a price of 0.32.
 */
const RAISE_OVER_A_CALLED_BET: Spot = {
  heroChips: { stack: 2400, bet: 300, totalInvested: 886 },
  villainChips: { stack: 500, bet: 4000, totalInvested: 4586 },
  foldedChips: { stack: 2600, bet: 300, totalInvested: 886 },
  history: [
    ...THREE_WAY_FLOP,
    third('turn', 'bet', 300, 9),
    act('turn', true, 'call', 300, 10),
    act('turn', false, 'raise', 4000, 11),
    third('turn', 'fold', 0, 12),
  ],
};

/**
 * Turn, three-handed: the villain bets 2,000, the third player folds, and hero is heads-up
 * for 1,600 at a price of 0.32 against the street's only wager.
 */
const ONE_BET_AFTER_A_THIRD_PLAYER_FOLDED: Spot = {
  heroChips: { stack: 1600, bet: 0, totalInvested: 586 },
  villainChips: { stack: 500, bet: 2000, totalInvested: 2586 },
  foldedChips: { stack: 2900, bet: 0, totalInvested: 586 },
  history: [...THREE_WAY_FLOP, act('turn', false, 'bet', 2000, 9), third('turn', 'fold', 0, 10)],
};

/** River of the same line: hero called 600 on the turn and faces 1,800 more on a blank king. */
const BLANK_RIVER: Spot = {
  street: 'river',
  board: '2d3sJh7dKc',
  heroChips: { stack: 1800, bet: 0, totalInvested: 1186 },
  villainChips: { stack: 50, bet: 2400, totalInvested: 3586 },
  history: [
    ...CALLED_CHECK_RAISE,
    act('turn', false, 'bet', 600, 6),
    act('turn', true, 'call', 600, 7),
    act('river', false, 'bet', 2400, 9),
  ],
};

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
    // The fold V88 replaces is the weak made hand whose capped equity missed the bar.
    expect(before.guard).toBe('dominated_commitment_floor');
    expect(before.fires).toContain('v40_omaha_pressure_cap');
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

  const honored: Array<[string, Spot]> = [
    [
      'the same wager made as an all-in, which adds the all-in premium to the capped bar',
      {
        villainChips: { stack: 0, bet: 1212, totalInvested: 1798, is_all_in: true },
        history: [
          ...CALLED_CHECK_RAISE,
          act('turn', false, 'all_in', 1212, 9, { isFullRaise: true }),
        ],
      },
    ],
    ['a called turn bet on a blank river', BLANK_RIVER],
    ['the only wager of a street a third player folded on', ONE_BET_AFTER_A_THIRD_PLAYER_FOLDED],
  ];
  it.each(honored)('honors %s', (_name, spot) => {
    const off = decide(spot, false);
    expect(off.action).toBe('fold');
    expect(off.guard).toBe('dominated_commitment_floor');
    const on = decide(spot, true);
    expect(on.action).toBe('call');
    expect(on.fires).toContain('v88_commitment_honored');
  });

  it('keeps the multiway floor when the street was bet, raised and jammed before it went heads-up', () => {
    const off = decide(JAM_OVER_A_RAISED_BET, false);
    expect(off.action).toBe('fold');
    expect(off.guard).toBe('multiway_commitment_floor');
    const on = decide(JAM_OVER_A_RAISED_BET, true);
    expect(on.action).toBe('fold');
    expect(on.guard).toBe('multiway_commitment_floor');
    expect(on.fires).not.toContain('v88_commitment_honored');
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
    [
      'a turn that completes a low straight the hand does not hold',
      { hole: 'AsAcKcQd9d', board: '2d3sJh4c' },
    ],
    [
      'a turn that completes a high straight the hand does not hold',
      { hole: 'AsAcKc6d4d', board: 'Td9s2hJc' },
    ],
    ['a raise over a bet the hand had called, after the bettor folded', RAISE_OVER_A_CALLED_BET],
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
