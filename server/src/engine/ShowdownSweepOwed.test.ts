import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { showdownSweepOwed } from './ShowdownSweepOwed.js';
import { HAND_COMPLETION as H, handCompletionHoldMs } from '../config/handCompletionSpec.js';

const preflop = [
  { stage: 'preflop', action: 'small_blind', amount: 0.5 },
  { stage: 'preflop', action: 'big_blind', amount: 1 },
  { stage: 'preflop', action: 'all_in', amount: 40 },
  { stage: 'preflop', action: 'call', amount: 39 },
];
const base = { wentToShowdown: true, ritRuns: 0, boardCardCount: 5 };

describe('the bets sweep is held only when the felt plays it (hand delay 2026-11-18)', () => {
  it('an all-in run out has nothing on the felt at pot_win: no sweep owed', () => {
    expect(showdownSweepOwed({ ...base, actions: preflop })).toBe(false);
  });

  it('a river checked through: no sweep owed', () => {
    const actions = [
      ...preflop.slice(0, 2),
      { stage: 'preflop', action: 'call', amount: 1 },
      { stage: 'flop', action: 'bet', amount: 2 },
      { stage: 'flop', action: 'call', amount: 2 },
      { stage: 'river', action: 'check', amount: 0 },
      { stage: 'river', action: 'check', amount: 0 },
    ];
    expect(showdownSweepOwed({ ...base, actions })).toBe(false);
  });

  it('any chip committed on the river keeps the sweep', () => {
    for (const action of ['bet', 'call', 'raise', 'all_in', 'small_blind']) {
      const actions = [...preflop, { stage: 'river', action, amount: 3 }];
      expect(showdownSweepOwed({ ...base, actions })).toBe(true);
    }
  });

  it('the uncalled-bet refund is not a commitment, but the bet it refunds is', () => {
    const refundOnly = [
      ...preflop,
      { stage: 'river', action: 'return', amount: 5, historyEvent: 'uncalled_bet_returned' },
    ];
    expect(showdownSweepOwed({ ...base, actions: refundOnly })).toBe(false);
    expect(
      showdownSweepOwed({
        ...base,
        actions: [...refundOnly, { stage: 'river', action: 'bet', amount: 5 }],
      })
    ).toBe(true);
  });

  it('anything unproven keeps the sweep', () => {
    // A fold win always leaves the winning bet or the blinds on the felt.
    expect(showdownSweepOwed({ ...base, wentToShowdown: false, actions: preflop })).toBe(true);
    // A multi-board reveal owns its own ship.
    expect(showdownSweepOwed({ ...base, ritRuns: 2, actions: preflop })).toBe(true);
    // A board short of a river.
    expect(showdownSweepOwed({ ...base, boardCardCount: 4, actions: preflop })).toBe(true);
    // No record at all.
    expect(showdownSweepOwed({ ...base, actions: [] })).toBe(true);
    // A variant whose streets are not flop-game streets.
    expect(
      showdownSweepOwed({ ...base, actions: [{ stage: 'seventh', action: 'check', amount: 0 }] })
    ).toBe(true);
    // An amount that is not a number.
    expect(
      showdownSweepOwed({
        ...base,
        actions: [...preflop, { stage: 'river', action: 'bet', amount: Number.NaN }],
      })
    ).toBe(true);
  });

  it('reads no horse marker: the same facts give the same answer for any seat', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./ShowdownSweepOwed.ts', import.meta.url)),
      'utf8'
    );
    expect(src).not.toMatch(/is_horse|isHorse|horse_policy/);
  });

  it('the hold drops exactly the sweep, and only it', () => {
    for (const allInShowdown of [false, true]) {
      const owed = handCompletionHoldMs({ wentToShowdown: true, showdownHands: 2, allInShowdown });
      const notOwed = handCompletionHoldMs({
        wentToShowdown: true,
        showdownHands: 2,
        allInShowdown,
        betsSweepOwed: false,
      });
      expect(owed - notOwed).toBe(H.BETS_SWEEP_MS);
    }
  });

  it('the engine hold passes the proof, computed from this hand', () => {
    const dealing = readFileSync(
      fileURLToPath(new URL('./ServerTableEngineDealing.ts', import.meta.url)),
      'utf8'
    );
    const at = dealing.indexOf('const resultDisplayMs = handCompletionHoldMs({');
    expect(at).toBeGreaterThan(0);
    const call = dealing.slice(at, dealing.indexOf('});', at));
    expect(call).toContain('betsSweepOwed: showdownSweepOwed({');
    expect(call).toContain('actions: this.currentHandActions');
    expect(call).toContain('boardCardCount: this.currentHandCommunityCards.length');
    expect(call).toContain('ritRuns: this.currentHandRitBoards');
  });
});
