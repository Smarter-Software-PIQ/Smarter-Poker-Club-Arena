import { describe, expect, it } from 'vitest';
import { PlaneGeometry } from 'three';
import { poseDonkeyArtwork } from '../../src/components/games/DonkeyCharacter';

describe('the painted Donkey mascot keeps its anatomy during a stride', () => {
  it('articulates the feet while keeping the skull, eyes and smile fixed', () => {
    const geometry = new PlaneGeometry(4.35, 2.9, 80, 54);
    poseDonkeyArtwork(geometry, [0, 0, 0, 0], [0, 0], 0, 0);
    const positions = geometry.getAttribute('position');
    const original = Array.from(positions.array);
    poseDonkeyArtwork(geometry, [1, -1, -1, 1], [0.4, -0.2], 0.3, 2);
    const uv = geometry.getAttribute('uv');
    let stableFace = 0;
    let walkingFeet = 0;
    for (let i = 0; i < positions.count; i++) {
      const x = uv.getX(i) * 1536;
      const y = (1 - uv.getY(i)) * 1024;
      expect(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i))).toBe(true);
      if (x > 810 && x < 1210 && y > 220 && y < 455) {
        expect(positions.getX(i)).toBe(original[i * 3]);
        expect(positions.getY(i)).toBe(original[i * 3 + 1]);
        stableFace++;
      }
      if (y > 850 && x > 400 && x < 1100 && positions.getX(i) !== original[i * 3]) walkingFeet++;
    }
    expect(stableFace).toBeGreaterThan(100);
    expect(walkingFeet).toBeGreaterThan(100);
    geometry.dispose();
  });

  it('returns precisely to the resting pose without accumulated mesh drift', () => {
    const geometry = new PlaneGeometry(4.35, 2.9, 80, 54);
    poseDonkeyArtwork(geometry, [0, 0, 0, 0], [0, 0], 0, 0);
    const rest = Array.from(geometry.getAttribute('position').array);
    for (let phase = 0; phase < 12; phase++)
      poseDonkeyArtwork(geometry, [Math.sin(phase), 0, 0, -Math.sin(phase)], [0.2, 0], 0.4, phase);
    poseDonkeyArtwork(geometry, [0, 0, 0, 0], [0, 0], 0, 0);
    expect(Array.from(geometry.getAttribute('position').array)).toEqual(rest);
    geometry.dispose();
  });
});
