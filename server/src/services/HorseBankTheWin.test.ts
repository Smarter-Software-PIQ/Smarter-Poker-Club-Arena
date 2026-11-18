import { describe, expect, it } from 'vitest';
import {
  bankTheWinMultiple,
  isBigPot,
  orbitHandsOwed,
  reachedBankTheWin,
  shouldBankTheWin,
  startingStackFor,
} from './HorseBankTheWin.js';

const ids = Array.from({ length: 500 }, (_, i) => `horse-${i}-${(i * 7919).toString(16)}`);

describe('BANK THE WIN (owner 2026-11-10)', () => {
  it('every horse books between 4x and 6x its starting stack', () => {
    for (const id of ids) {
      const m = bankTheWinMultiple(id);
      expect(m).toBeGreaterThanOrEqual(4);
      expect(m).toBeLessThanOrEqual(6);
      expect(reachedBankTheWin(id, 600, 100)).toBe(true);
      expect(reachedBankTheWin(id, 399, 100)).toBe(false);
    }
  });

  it('the starting stack is the session baseline, else the max buy-in', () => {
    expect(startingStackFor(40, 100)).toBe(40);
    expect(startingStackFor(undefined, 100)).toBe(100);
    expect(startingStackFor(0, 100)).toBe(100);
    // A re-entry that carried its stack back, or a top-up, never raises the line.
    expect(startingStackFor(1391.85, 100)).toBe(100);
    expect(startingStackFor(548.91, 100)).toBe(100);
  });

  it('never leaves the hand after a big pot: one more orbit, then before its big blind', () => {
    const base = { horseId: ids[0], stack: 700, startingStack: 100, playersAtTable: 6 };
    expect(isBigPot(300, 700, 100)).toBe(true);
    expect(isBigPot(300, 340, 100)).toBe(false);
    expect(shouldBankTheWin({ ...base, handsSinceBigPot: 0, nextHandIsBigBlind: true })).toBe(
      false
    );
    expect(shouldBankTheWin({ ...base, handsSinceBigPot: 5, nextHandIsBigBlind: true })).toBe(
      false
    );
    expect(shouldBankTheWin({ ...base, handsSinceBigPot: 6, nextHandIsBigBlind: false })).toBe(
      false
    );
    expect(shouldBankTheWin({ ...base, handsSinceBigPot: 6, nextHandIsBigBlind: true })).toBe(true);
    expect(
      shouldBankTheWin({ ...base, handsSinceBigPot: undefined, nextHandIsBigBlind: true })
    ).toBe(true);
    expect(orbitHandsOwed(2, 6)).toBe(4);
  });
});
