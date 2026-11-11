import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_LEAVE_ATTEMPTS,
  decideLightningBankTheWin,
  noteLightningHandForBankTheWin,
  onLightningBankTheWin,
  resetLightningBankTheWin,
  type LightningBankOutcome,
  type LightningBankParticipant,
} from './LightningBankTheWin.js';
import { bankTheWinMultiple } from '../services/HorseBankTheWin.js';

const HORSE = 'horse-lightning-1';
const LINE = bankTheWinMultiple(HORSE) * 100;

function hand(stackBefore: number, after: number, session = 'ps-1', isHorse = true) {
  const participants: LightningBankParticipant[] = [
    { playerId: HORSE, poolSessionId: session, isHorse, blindRole: 'none', stackBefore },
  ];
  return noteLightningHandForBankTheWin({
    clusterId: 'c1',
    maxBuyIn: 100,
    participants,
    stacksAfter: new Map([[HORSE, after]]),
  });
}

afterEach(() => resetLightningBankTheWin());

describe('the Lightning pre-filter', () => {
  it('asks only at the line, measured from at most the maximum buy-in', () => {
    const asked: string[] = [];
    onLightningBankTheWin((r) => {
      asked.push(r.playerId);
      r.settle('not_ready');
    });
    expect(hand(100, LINE - 1)).toEqual([]);
    expect(hand(LINE - 1, LINE)).toEqual([HORSE]);
    // A pool session first seen with a carried 1,391.85 stack still measures from 100.
    expect(hand(1391.85, 1391.85, 'ps-carried')).toEqual([HORSE]);
    expect(asked).toHaveLength(2);
  });

  it('never asks about a human, and keeps one ask in flight per pool session', () => {
    const pending: Array<(o: LightningBankOutcome) => void> = [];
    onLightningBankTheWin((r) => pending.push(r.settle));
    expect(hand(700, 700, 'ps-h', false)).toEqual([]);
    expect(hand(700, 700)).toEqual([HORSE]);
    expect(hand(700, 700)).toEqual([]); // still in flight
    pending[0]('not_ready');
    pending[0]('done'); // a second answer to the same ask is ignored
    expect(hand(700, 700)).toEqual([HORSE]); // not ready: asked again on a later hand
  });

  it('stops after a leave, and after the bounded number of failed attempts', () => {
    let settle: ((o: LightningBankOutcome) => void) | null = null;
    onLightningBankTheWin((r) => (settle = r.settle));
    hand(700, 700, 'ps-done');
    settle!('done');
    expect(hand(700, 700, 'ps-done')).toEqual([]);
    for (let i = 0; i < MAX_LEAVE_ATTEMPTS; i++) {
      expect(hand(700, 700, 'ps-fail')).toEqual([HORSE]);
      settle!('attempt_failed');
    }
    expect(hand(700, 700, 'ps-fail')).toEqual([]);
  });
});

describe('the door decides from the pool facts alone', () => {
  const ready = {
    found: true,
    stack: LINE + 5,
    leave_pending: false,
    start_basis: 100,
    hands_since_big_pot: 12,
    hands_owed: 0,
    blind_rank: 1,
    pool_players: 24,
    players_per_hand: 6,
  };
  it('leaves when every condition holds', () => {
    expect(decideLightningBankTheWin(HORSE, ready)).toBe('leave');
    // Four hands form at once from 24 players: the front four of the blind order are due.
    expect(decideLightningBankTheWin(HORSE, { ...ready, blind_rank: 4 })).toBe('leave');
    expect(decideLightningBankTheWin(HORSE, { ...ready, blind_rank: 5 })).toBe('not_ready');
    expect(decideLightningBankTheWin(HORSE, { ...ready, hands_since_big_pot: null })).toBe('leave');
  });
  it('waits for every owed hand, the orbit after a big pot, its blind and the line', () => {
    expect(decideLightningBankTheWin(HORSE, { ...ready, hands_owed: 3 })).toBe('not_ready');
    expect(decideLightningBankTheWin(HORSE, { ...ready, hands_since_big_pot: 5 })).toBe(
      'not_ready'
    );
    expect(decideLightningBankTheWin(HORSE, { ...ready, blind_rank: null })).toBe('not_ready');
    expect(decideLightningBankTheWin(HORSE, { ...ready, stack: LINE - 1 })).toBe('not_ready');
  });
  it('is done when the horse is already leaving or out of the pool', () => {
    expect(decideLightningBankTheWin(HORSE, { ...ready, leave_pending: true })).toBe('done');
    expect(decideLightningBankTheWin(HORSE, { found: false })).toBe('done');
  });
});
