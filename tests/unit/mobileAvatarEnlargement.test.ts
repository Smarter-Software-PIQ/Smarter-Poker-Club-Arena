import { describe, expect, it } from 'vitest';
import {
  chooseMobileAvatarPaint,
  mobileGrowthReservation,
} from '../../src/components/table/mobileAvatarEnlargement';

const art = [{ left: 50, top: 40, width: 20, height: 40 }];
const viewport = { left: 0, top: 0, width: 300, height: 400 };
const awayFelt = { left: 200, top: 100, width: 80, height: 200 };
const choose = (
  obstacles: Parameters<typeof chooseMobileAvatarPaint>[3] = [],
  felt = awayFelt,
  ceiling = 1.15
) => chooseMobileAvatarPaint(art, [60, 80], Infinity, obstacles, felt, viewport, ceiling);

describe('mobile avatar paint fitting', () => {
  it('uses free rail space with a uniform scale', () => {
    const result = choose();
    expect(result.scale).toBe(1.15);
    expect(result.parts[0].width / art[0].width).toBeCloseTo(
      result.parts[0].height / art[0].height
    );
  });
  it('refuses extra coverage of a protected object', () => {
    expect(choose([{ box: viewport, ownLayer: false }]).scale).toBe(1);
  });
  it('allows only the explicitly permitted existing own-layer overlap', () => {
    expect(choose([{ box: viewport, ownLayer: true }]).scale).toBe(1.15);
    const obstacle = { left: 80, top: 0, width: 220, height: 400 };
    const result = choose([{ box: obstacle, ownLayer: true }]);
    expect(result.parts.every((p) => p.left + p.width <= obstacle.left)).toBe(true);
  });
  it('refuses growth when the original art is surrounded by felt', () => {
    expect(choose([], { left: 0, top: 0, width: 120, height: 300 }).scale).toBe(1);
  });
  it('honors the hero size ceiling and missing paint', () => {
    expect(choose([], awayFelt, 1.05).scale).toBe(1.05);
    expect(choose([], awayFelt, 1.01).scale).toBe(1);
    expect(chooseMobileAvatarPaint([], [0, 0], Infinity, [], awayFelt, viewport).scale).toBe(1);
  });
  it('keeps a clipped torso inside its original lower edge', () => {
    const result = chooseMobileAvatarPaint(art, [60, 80], 80, [], awayFelt, viewport);
    expect(result.scale).toBeGreaterThan(1);
    expect(result.parts.every((p) => p.top + p.height <= 80)).toBe(true);
  });
  it('reserves every allowed fixed pivot before a new shown hand is placed', () => {
    const bounds = mobileGrowthReservation(art[0], art, 1.3);
    for (const scale of [1.02, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3])
      for (const px of [-1, -0.5, 0, 0.5, 1])
        for (const py of [-1, 0, 1, 2]) {
          const result = chooseMobileAvatarPaint(
            art,
            [60, 80],
            80,
            [],
            awayFelt,
            viewport,
            1.3,
            Infinity,
            { scale, px, py }
          );
          for (const part of result.parts) {
            expect(part.left).toBeGreaterThanOrEqual(bounds.left - 1e-8);
            expect(part.top).toBeGreaterThanOrEqual(bounds.top - 1e-8);
            expect(part.left + part.width).toBeLessThanOrEqual(bounds.left + bounds.width + 1e-8);
            expect(part.top + part.height).toBeLessThanOrEqual(bounds.top + bounds.height + 1e-8);
          }
        }
  });
});
