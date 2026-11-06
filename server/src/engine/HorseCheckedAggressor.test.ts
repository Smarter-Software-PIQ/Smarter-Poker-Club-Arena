import { describe, expect, it } from 'vitest';
import type { ActionRecord, HandStage } from '../types.js';
import { priorAggressorCheckedThisStreet } from './HorseCheckedAggressor.js';

const action = (
  userId: string,
  kind: ActionRecord['action'],
  stage: HandStage,
  isFullRaise?: boolean
): ActionRecord => ({
  userId,
  seat: Number(userId.slice(1)),
  action: kind,
  stage,
  amount: 1,
  timestamp: 1,
  isFullRaise,
});

type Case = [string, ActionRecord[] | undefined, HandStage, boolean];
const cases: Case[] = [
  ['missing history', undefined, 'river', false],
  ['empty history', [], 'river', false],
  [
    'actual aggressor checks',
    [action('p1', 'bet', 'turn'), action('p1', 'check', 'river')],
    'river',
    true,
  ],
  [
    'different opponent checks',
    [action('p1', 'bet', 'turn'), action('p2', 'check', 'river')],
    'river',
    false,
  ],
  [
    'earlier aggressor is not the last raiser',
    [action('p1', 'bet', 'turn'), action('p2', 'raise', 'turn'), action('p1', 'check', 'river')],
    'river',
    false,
  ],
  [
    'last raiser checks',
    [action('p1', 'bet', 'turn'), action('p2', 'raise', 'turn'), action('p2', 'check', 'river')],
    'river',
    true,
  ],
  [
    'check on another street',
    [action('p1', 'bet', 'turn'), action('p1', 'check', 'flop')],
    'river',
    false,
  ],
  // Match readInitiative exactly: only an explicit full raise takes the lead.
  // An all-in with no marker is ambiguous/call, not invented aggression.
  [
    'full all-in raise takes lead',
    [
      action('p1', 'bet', 'flop'),
      action('p2', 'all_in', 'turn', true),
      action('p1', 'check', 'river'),
    ],
    'river',
    false,
  ],
  [
    'unmarked all-in does not take lead',
    [action('p1', 'bet', 'turn'), action('p2', 'all_in', 'turn'), action('p1', 'check', 'river')],
    'river',
    true,
  ],
  [
    'short all-in does not take lead',
    [
      action('p1', 'bet', 'turn'),
      action('p2', 'all_in', 'turn', false),
      action('p1', 'check', 'river'),
    ],
    'river',
    true,
  ],
  [
    'current-street wager is not prior initiative',
    [action('p1', 'bet', 'turn'), action('p2', 'bet', 'river'), action('p2', 'check', 'river')],
    'river',
    false,
  ],
  [
    'latest prior street owns initiative',
    [
      action('p1', 'raise', 'preflop'),
      action('p2', 'bet', 'flop'),
      action('p3', 'bet', 'turn'),
      action('p2', 'check', 'river'),
    ],
    'river',
    false,
  ],
];

describe('the actual prior aggressor checked this street', () => {
  it.each(cases)('%s', (_name, history, street, expected) => {
    // The helper is a public-history reader, never a history writer.
    history?.forEach((record) => Object.freeze(record));
    if (history) Object.freeze(history);
    expect(priorAggressorCheckedThisStreet(history, street)).toBe(expected);
  });
});
