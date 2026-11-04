import { describe, expect, it } from 'vitest';
import type { Card } from '../../types.js';
import { snapshotEquityCards, snapshotEquityOptions } from './equityRequestBounds.js';

const card: Card = { rank: 'A', suit: 'spades' };
describe('bounded owned equity request snapshots', () => {
  it('retains only calculator scalars and does not keep caller-owned graphs', () => {
    const source = { ...card, unrelated: new Uint8Array(1024 * 1024) };
    const original = [[source]];
    const copy = snapshotEquityCards(original, [], []);
    original[0].length = 0;
    source.rank = 'K';
    expect(copy.hands).toEqual([[card]]);
    expect(Object.keys(copy.hands[0][0])).toEqual(['rank', 'suit']);
    const eligible = [0];
    const pots = [{ amount: 25, eligible }];
    const options = snapshotEquityOptions({ pots, exact: true }, 1);
    eligible.length = 0;
    pots[0].amount = 99;
    expect(options).toEqual({ exact: true, pots: [{ amount: 25, eligible: [0] }] });
  });

  it('rejects oversize lists before iterating their elements', () => {
    const huge = new Array(1_000_000);
    Object.defineProperty(huge, '0', {
      get() {
        throw new Error('must not visit');
      },
    });
    expect(() => snapshotEquityCards(huge, [])).toThrow('ten seats');
    expect(() => snapshotEquityCards([huge], [])).toThrow('supported bounds');
    expect(() => snapshotEquityCards([], huge)).toThrow('supported bounds');
    expect(() => snapshotEquityCards([], [], huge)).toThrow('supported bounds');
    expect(() => snapshotEquityOptions({ pots: huge }, 10)).toThrow('ten seats');
  });

  it('rejects sparse inputs instead of retaining holes for the worker', () => {
    expect(() => snapshotEquityCards(new Array(2), [])).toThrow();
    expect(() => snapshotEquityCards([new Array(2)], [])).toThrow();
    expect(() => snapshotEquityCards([], new Array(2))).toThrow();
    expect(() => snapshotEquityOptions({ pots: new Array(2) }, 2)).toThrow();
    expect(() =>
      snapshotEquityOptions({ pots: [{ amount: 1, eligible: new Array(2) }] }, 2)
    ).toThrow();
  });

  it('accepts every supported hole-card width and the largest field shape', () => {
    for (const width of [2, 3, 4, 5, 6]) {
      const hands = Array.from({ length: 10 }, () => Array.from({ length: width }, () => card));
      expect(snapshotEquityCards(hands, Array(5).fill(card), Array(52).fill(card)).hands).toEqual(
        hands
      );
    }
  });
});
