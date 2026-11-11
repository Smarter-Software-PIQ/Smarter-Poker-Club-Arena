import { afterEach, describe, expect, it } from 'vitest';
import {
  ASK_STALE_MS,
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
  it('learns the durable basis from the first answer, then asks only at its line', () => {
    const asked: string[] = [];
    onLightningBankTheWin((r) => {
      asked.push(r.playerId);
      r.settle('not_ready', 100);
    });
    expect(hand(100, 100)).toEqual([HORSE]); // basis unknown: asked once to learn it
    expect(hand(100, LINE - 1)).toEqual([]);
    expect(hand(LINE - 1, LINE)).toEqual([HORSE]);
    expect(asked).toHaveLength(2);
  });

  it('a restart or a re-entry seen first with a carried stack cannot raise the line', () => {
    const asked: string[] = [];
    onLightningBankTheWin((r) => {
      asked.push(r.playerId);
      r.settle('not_ready', 100); // the session's durable basis, not the carried stack
    });
    expect(hand(1391.85, 1391.85, 'ps-carried')).toEqual([HORSE]);
    expect(hand(1391.85, 1391.85, 'ps-carried')).toEqual([HORSE]); // above the 4-6x of 100
  });

  it('never asks about a human, keeps one ask in flight, and ignores a second answer', () => {
    const pending: Array<(o: LightningBankOutcome, b?: number) => void> = [];
    onLightningBankTheWin((r) => pending.push(r.settle));
    expect(hand(700, 700, 'ps-h', false)).toEqual([]);
    expect(hand(700, 700)).toEqual([HORSE]);
    expect(hand(700, 700)).toEqual([]); // still in flight
    pending[0]('not_ready', 100);
    pending[0]('done'); // a second answer to the same ask is ignored
    expect(hand(700, 700)).toEqual([HORSE]); // not ready: asked again on a later hand
  });

  it('abandons an ask that is never answered, and ignores its late answer', () => {
    const pending: Array<(o: LightningBankOutcome, b?: number) => void> = [];
    onLightningBankTheWin((r) => pending.push(r.settle));
    const at = (now: number) =>
      noteLightningHandForBankTheWin(
        {
          clusterId: 'c1',
          maxBuyIn: 100,
          participants: [
            {
              playerId: HORSE,
              poolSessionId: 'ps-stale',
              isHorse: true,
              blindRole: 'none',
              stackBefore: 700,
            },
          ],
          stacksAfter: new Map([[HORSE, 700]]),
        },
        now
      );
    expect(at(1_000)).toEqual([HORSE]);
    expect(at(1_000 + ASK_STALE_MS - 1)).toEqual([]);
    expect(at(1_000 + ASK_STALE_MS)).toEqual([HORSE]);
    pending[0]('done'); // the abandoned ask's late answer changes nothing
    pending[1]('not_ready', 100);
    expect(at(1_000 + ASK_STALE_MS + 1)).toEqual([HORSE]);
  });

  it('stops after a leave, and after the bounded number of failed attempts', () => {
    let settle: ((o: LightningBankOutcome, b?: number) => void) | null = null;
    onLightningBankTheWin((r) => (settle = r.settle));
    hand(700, 700, 'ps-done');
    settle!('done', 100);
    expect(hand(700, 700, 'ps-done')).toEqual([]);
    for (let i = 0; i < MAX_LEAVE_ATTEMPTS; i++) {
      expect(hand(700, 700, 'ps-fail')).toEqual([HORSE]);
      settle!('attempt_failed', 100);
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
  it('is done when the horse is already leaving; not found is only transient', () => {
    expect(decideLightningBankTheWin(HORSE, { ...ready, leave_pending: true })).toBe('done');
    expect(decideLightningBankTheWin(HORSE, { found: false })).toBe('not_ready');
  });
});
