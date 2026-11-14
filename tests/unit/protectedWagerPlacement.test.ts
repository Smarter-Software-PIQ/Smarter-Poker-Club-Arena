import { describe, expect, it } from 'vitest';
import {
  assignProtectedWagers,
  firstWagerOnFelt,
  insideClassicGreen,
  wagerBoxesOverlap,
} from '../../src/lib/protectedWagerPlacement';
const box = (left: number, top = 0) => ({ left, top, width: 36, height: 20 });
describe('shared measured wager rail assignment', () => {
  it('puts the new 430px big blind inside the gold on its first frame', () => {
    const canvas = { left: 36, top: 226, width: 528, height: 755.97 };
    const felt = { left: 106.22, top: 293.28, width: 386.5, height: 607.04 };
    const board = { left: 115.95, top: 500.75, width: 367.16, height: 100.94 };
    const blind = new DOMRect(106, 762.8125, 52.21875, 20);
    expect(insideClassicGreen(blind, canvas, 0)).toBe(false);
    const next = firstWagerOnFelt(blind, canvas, felt, 13.2, true, board);
    expect(insideClassicGreen(next, canvas, 13.2)).toBe(true);
    expect(next.left + next.width).toBeLessThan(300);
    expect(wagerBoxesOverlap(next, board)).toBe(false);
    expect(firstWagerOnFelt(next, canvas, felt, 13.2, true, board)).toBe(next);
  });
  it('preserves the sole slot of a constrained player instead of taking it greedily', () => {
    const first = box(0),
      second = box(40);
    expect(assignProtectedWagers([[first, second], [first]])).toEqual([second, first]);
  });
  it('returns no complete assignment when the measured rail cannot fit all wagers', () => {
    expect(assignProtectedWagers([[box(0)], [box(0)]])).toBeNull();
  });
  it('retains two pixels of daylight on both axes', () => {
    expect(wagerBoxesOverlap(box(0), box(37))).toBe(true);
    expect(wagerBoxesOverlap(box(0), box(38))).toBe(false);
    expect(wagerBoxesOverlap(box(0), box(0, 22))).toBe(false);
  });
});
