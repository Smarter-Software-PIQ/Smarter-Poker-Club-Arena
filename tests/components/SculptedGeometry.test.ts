import { describe, expect, it } from 'vitest';
import { sculptedGeometry } from '../../src/components/games/sculptedGeometry';

describe('sculpted bodies', () => {
  it('lights the outside, rather than culling the visible skin', () => {
    const shape = sculptedGeometry([
      [-1, -1, 1, 1],
      [0, -1, 1, 1],
      [1, -1, 1, 1],
    ]);
    const p = shape.getAttribute('position');
    const n = shape.getAttribute('normal');
    // Every surface normal on a straight circular shell points away from its axis.
    for (let i = 0; i < p.count; i++) {
      expect(p.getY(i) * n.getY(i) + p.getZ(i) * n.getZ(i)).toBeGreaterThan(0.98);
    }
    shape.dispose();
  });

  it('closes the silhouette at both tapered ends and preserves finite texture coordinates', () => {
    const shape = sculptedGeometry([
      [-1, 0, 0, 0],
      [0, -0.5, 0.7, 0.4],
      [1, 0.1, 0.1, 0],
    ]);
    const p = shape.getAttribute('position');
    for (const attribute of Object.values(shape.attributes)) {
      expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
    }
    for (const start of [0, p.count - 33]) {
      for (let i = start + 1; i < start + 33; i++) {
        expect(p.getY(i)).toBeCloseTo(p.getY(start), 6);
        expect(p.getZ(i)).toBeCloseTo(0, 6);
      }
    }
    shape.dispose();
  });
});
